const express = require('express');
const db = require('../db');
const { requireAuth } = require('../services/authMiddleware');

const router = express.Router();

router.get('/latest', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const row = db.prepare(
    'SELECT * FROM sensor_readings WHERE unit_id = ? ORDER BY ts DESC LIMIT 1'
  ).get(unitId);
  res.json(row || null);
});

router.get('/history', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const hours = Number(req.query.hours || 24);
  const limit = Number(req.query.limit || 500);

  const rows = db.prepare(`
    SELECT * FROM sensor_readings
    WHERE unit_id = ? AND ts >= datetime('now', ?)
    ORDER BY ts ASC
    LIMIT ?
  `).all(unitId, `-${hours} hours`, limit);

  res.json(rows);
});

router.get('/thresholds', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM thresholds').all();
  res.json(rows);
});

router.put('/thresholds/:param', requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'engineer') {
    return res.status(403).json({ error: 'Requires engineer or admin role' });
  }
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value required' });

  db.prepare('UPDATE thresholds SET value = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE param = ?')
    .run(value, req.user.username, req.params.param);

  db.prepare(`INSERT INTO audit_log (username, action, details) VALUES (?, ?, ?)`)
    .run(req.user.username, 'update_threshold', `${req.params.param} = ${value}`);

  res.json({ success: true });
});

module.exports = router;
