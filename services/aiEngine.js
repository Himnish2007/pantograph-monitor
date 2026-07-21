/**
 * AI Modules
 * -----------
 * 1. Carbon Strip Replacement Prediction:
 *    Simple linear regression of wear% over time (last N readings) gives a
 *    wear rate (%/day). Projected forward to the critical threshold to
 *    estimate days-to-replacement. This is intentionally a transparent,
 *    explainable model appropriate for a POC - it can be swapped for a more
 *    sophisticated model (e.g. weighted recent-history regression, or a
 *    learned degradation curve) once enough field data is collected.
 *
 * 2. OHE Contact Quality Analysis:
 *    Scores contact quality 0-100 based on:
 *      - Contact force staying within the ideal band (deviation penalty)
 *      - Contact force stability (variance/jitter penalty - excessive
 *        bouncing indicates poor OHE geometry or pantograph spring issues)
 *      - Height staying within expected working range
 *    Weighted composite -> label (Excellent / Good / Fair / Poor).
 */

function linearRegression(points) {
  // points: [{x, y}] where x = minutes since first reading, y = wear%
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0 };

  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function predictCarbonStripReplacement(readings, criticalThresholdPct) {
  // readings: array of {carbon_strip_wear, ts} ordered oldest -> newest
  const valid = readings.filter((r) => r.carbon_strip_wear !== null && r.carbon_strip_wear !== undefined);

  if (valid.length < 3) {
    return {
      wear_rate_pct_per_day: null,
      days_to_replacement: null,
      predicted_replacement_date: null,
      confidence: 0,
      note: 'Insufficient history for prediction (need 3+ readings)',
    };
  }

  const t0 = new Date(valid[0].ts).getTime();
  const points = valid.map((r) => ({
    x: (new Date(r.ts).getTime() - t0) / 60000, // minutes
    y: r.carbon_strip_wear,
  }));

  const { slope, intercept } = linearRegression(points);
  const slopePerDay = slope * 60 * 24; // %/day
  const currentWear = valid[valid.length - 1].carbon_strip_wear;

  let daysToReplacement = null;
  let predictedDate = null;

  if (slopePerDay > 0.0001) {
    daysToReplacement = Math.max(0, (criticalThresholdPct - currentWear) / slopePerDay);
    const d = new Date();
    d.setDate(d.getDate() + Math.round(daysToReplacement));
    predictedDate = d.toISOString().slice(0, 10);
  }

  // crude confidence: more points + tighter fit = higher confidence, capped 0-1
  const confidence = Math.min(1, valid.length / 30);

  return {
    wear_rate_pct_per_day: Number(slopePerDay.toFixed(4)),
    days_to_replacement: daysToReplacement !== null ? Math.round(daysToReplacement) : null,
    predicted_replacement_date: predictedDate,
    confidence: Number(confidence.toFixed(2)),
  };
}

function ohecontactQualityScore(readings, thresholds) {
  const valid = readings.filter((r) => r.contact_force !== null && r.height !== null);
  if (valid.length === 0) {
    return { score: null, label: 'No Data' };
  }

  const forces = valid.map((r) => r.contact_force);
  const heights = valid.map((r) => r.height);

  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const stdDev = (arr) => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
  };

  const forceMean = mean(forces);
  const forceStd = stdDev(forces);
  const idealForceMid = (thresholds.CONTACT_FORCE_MIN_N + thresholds.CONTACT_FORCE_MAX_N) / 2;
  const forceRange = thresholds.CONTACT_FORCE_MAX_N - thresholds.CONTACT_FORCE_MIN_N;

  // 1. Force band deviation penalty (0-40 pts)
  const deviation = Math.abs(forceMean - idealForceMid);
  const deviationPenalty = Math.min(40, (deviation / (forceRange / 2)) * 40);

  // 2. Force stability / jitter penalty (0-35 pts) - high variance = poor OHE contact
  const jitterRatio = forceRange > 0 ? forceStd / forceRange : 0;
  const jitterPenalty = Math.min(35, jitterRatio * 100);

  // 3. Height out-of-range penalty (0-25 pts)
  const outOfRangeCount = heights.filter(
    (h) => h < thresholds.HEIGHT_MIN_MM || h > thresholds.HEIGHT_MAX_MM
  ).length;
  const heightPenalty = Math.min(25, (outOfRangeCount / heights.length) * 25);

  const score = Math.max(0, 100 - deviationPenalty - jitterPenalty - heightPenalty);

  let label = 'Excellent';
  if (score < 50) label = 'Poor';
  else if (score < 70) label = 'Fair';
  else if (score < 90) label = 'Good';

  return {
    score: Number(score.toFixed(1)),
    label,
    breakdown: {
      force_mean_N: Number(forceMean.toFixed(2)),
      force_std_dev: Number(forceStd.toFixed(2)),
      deviation_penalty: Number(deviationPenalty.toFixed(1)),
      jitter_penalty: Number(jitterPenalty.toFixed(1)),
      height_penalty: Number(heightPenalty.toFixed(1)),
    },
  };
}

function computeHealthIndex(latestReading, wearPrediction, contactQuality, thresholds) {
  if (!latestReading || !latestReading.connection_ok) {
    return { score: 0, label: 'Offline', breakdown: {} };
  }

  // Weighted composite: Contact Quality (40%), Wear headroom (35%), Current/electrical (25%)
  const contactScore = contactQuality.score ?? 50;

  const wearHeadroom =
    latestReading.carbon_strip_wear !== null
      ? Math.max(0, 100 - latestReading.carbon_strip_wear)
      : 50;

  let currentScore = 100;
  if (latestReading.current !== null && thresholds.CURRENT_MAX_A) {
    const ratio = latestReading.current / thresholds.CURRENT_MAX_A;
    currentScore = Math.max(0, 100 - Math.max(0, ratio - 0.8) * 500); // penalize above 80% of max
  }

  const score = contactScore * 0.4 + wearHeadroom * 0.35 + currentScore * 0.25;

  let label = 'Healthy';
  if (score < 50) label = 'Critical';
  else if (score < 70) label = 'Degraded';
  else if (score < 90) label = 'Watch';

  return {
    score: Number(score.toFixed(1)),
    label,
    breakdown: {
      contact_quality: Number(contactScore.toFixed(1)),
      wear_headroom: Number(wearHeadroom.toFixed(1)),
      electrical: Number(currentScore.toFixed(1)),
    },
  };
}

module.exports = {
  predictCarbonStripReplacement,
  ohecontactQualityScore,
  computeHealthIndex,
};
