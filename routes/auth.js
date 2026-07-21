const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, requireAuth, requireRole } = require('../services/authMiddleware');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  db.prepare(`INSERT INTO audit_log (username, action, details) VALUES (?, ?, ?)`)
    .run(username, 'login', 'User logged in');

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Admin-only: create new users
router.post('/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, role required' });
  }
  if (!['admin', 'engineer', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'invalid role' });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(username, hash, role);
    db.prepare(`INSERT INTO audit_log (username, action, details) VALUES (?, ?, ?)`)
      .run(req.user.username, 'create_user', `Created user ${username} (${role})`);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

router.get('/users', requireAuth, requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  res.json(users);
});

router.delete('/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
