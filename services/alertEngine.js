const db = require('../db');

function getThresholds() {
  const rows = db.prepare('SELECT param, value FROM thresholds').all();
  const t = {};
  for (const r of rows) t[r.param] = r.value;
  return t;
}

const insertAlert = db.prepare(`
  INSERT INTO alerts (unit_id, parameter, severity, message, value)
  VALUES (?, ?, ?, ?, ?)
`);

// avoid spamming duplicate alerts - only re-raise if none of same param+severity in last 5 min
const recentSimilarAlert = db.prepare(`
  SELECT id FROM alerts
  WHERE unit_id = ? AND parameter = ? AND severity = ?
  AND ts >= datetime('now', '-5 minutes')
  LIMIT 1
`);

function raise(unitId, parameter, severity, message, value) {
  const existing = recentSimilarAlert.get(unitId, parameter, severity);
  if (existing) return null;
  const info = insertAlert.run(unitId, parameter, severity, message, value);
  return { id: info.lastInsertRowid, unit_id: unitId, parameter, severity, message, value };
}

function evaluate(unitId, reading) {
  const t = getThresholds();
  const raised = [];

  if (!reading.connection_ok) {
    const a = raise(unitId, 'connection', 'critical', 'Sensor/Modbus link down - no data received', null);
    if (a) raised.push(a);
    return raised;
  }

  if (reading.contact_force !== null) {
    if (reading.contact_force < t.CONTACT_FORCE_MIN_N) {
      const a = raise(unitId, 'contact_force', 'warning',
        `Contact force ${reading.contact_force.toFixed(1)}N below minimum ${t.CONTACT_FORCE_MIN_N}N`, reading.contact_force);
      if (a) raised.push(a);
    } else if (reading.contact_force > t.CONTACT_FORCE_MAX_N) {
      const a = raise(unitId, 'contact_force', 'warning',
        `Contact force ${reading.contact_force.toFixed(1)}N above maximum ${t.CONTACT_FORCE_MAX_N}N`, reading.contact_force);
      if (a) raised.push(a);
    }
  }

  if (reading.carbon_strip_wear !== null) {
    if (reading.carbon_strip_wear >= t.CARBON_STRIP_WEAR_CRITICAL_PCT) {
      const a = raise(unitId, 'carbon_strip_wear', 'critical',
        `Carbon strip wear ${reading.carbon_strip_wear.toFixed(1)}% - CRITICAL, replace immediately`, reading.carbon_strip_wear);
      if (a) raised.push(a);
    } else if (reading.carbon_strip_wear >= t.CARBON_STRIP_WEAR_WARN_PCT) {
      const a = raise(unitId, 'carbon_strip_wear', 'warning',
        `Carbon strip wear ${reading.carbon_strip_wear.toFixed(1)}% - approaching replacement threshold`, reading.carbon_strip_wear);
      if (a) raised.push(a);
    }
  }

  if (reading.height !== null) {
    if (reading.height < t.HEIGHT_MIN_MM || reading.height > t.HEIGHT_MAX_MM) {
      const a = raise(unitId, 'height', 'warning',
        `Pantograph height ${reading.height.toFixed(0)}mm outside expected range [${t.HEIGHT_MIN_MM}-${t.HEIGHT_MAX_MM}mm]`, reading.height);
      if (a) raised.push(a);
    }
  }

  if (reading.current !== null && reading.current > t.CURRENT_MAX_A) {
    const a = raise(unitId, 'current', 'critical',
      `Current draw ${reading.current.toFixed(0)}A exceeds maximum ${t.CURRENT_MAX_A}A`, reading.current);
    if (a) raised.push(a);
  }

  return raised;
}

module.exports = { evaluate, getThresholds };
