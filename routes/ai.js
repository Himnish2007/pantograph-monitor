const express = require('express');
const db = require('../db');
const { requireAuth } = require('../services/authMiddleware');

const router = express.Router();

router.get('/prediction', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const row = db.prepare(
    'SELECT * FROM ai_predictions WHERE unit_id = ? ORDER BY ts DESC LIMIT 1'
  ).get(unitId);
  res.json(row || null);
});

router.get('/health-index', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const hours = Number(req.query.hours || 24);
  const rows = db.prepare(`
    SELECT * FROM health_index_log
    WHERE unit_id = ? AND ts >= datetime('now', ?)
    ORDER BY ts ASC
  `).all(unitId, `-${hours} hours`);
  res.json(rows);
});

router.get('/health-index/latest', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const row = db.prepare(
    'SELECT * FROM health_index_log WHERE unit_id = ? ORDER BY ts DESC LIMIT 1'
  ).get(unitId);
  res.json(row || null);
});

module.exports = router;
