const express = require('express');
const db = require('../db');
const { requireAuth } = require('../services/authMiddleware');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const unitId = req.query.unit_id || process.env.UNIT_ID || 'PANTO-001';
  const limit = Number(req.query.limit || 100);
  const onlyActive = req.query.active === 'true';

  let query = 'SELECT * FROM alerts WHERE unit_id = ?';
  if (onlyActive) query += ' AND acknowledged = 0';
  query += ' ORDER BY ts DESC LIMIT ?';

  const rows = db.prepare(query).all(unitId, limit);
  res.json(rows);
});

router.post('/:id/acknowledge', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET acknowledged = 1, acknowledged_by = ? WHERE id = ?')
    .run(req.user.username, req.params.id);
  res.json({ success: true });
});

module.exports = router;
