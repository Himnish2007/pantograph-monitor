const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// role hierarchy: admin > engineer > viewer
const ROLE_LEVEL = { viewer: 1, engineer: 2, admin: 3 };

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const userLevel = ROLE_LEVEL[req.user.role] || 0;
    const minLevel = ROLE_LEVEL[minRole] || 99;
    if (userLevel < minLevel) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, JWT_SECRET };
