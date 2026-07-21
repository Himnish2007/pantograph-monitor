/**
 * Run once to create the first admin user:
 *   node seed.js <username> <password>
 * Example:
 *   node seed.js admin Himnish@2026
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error('Usage: node seed.js <username> <password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

try {
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, 'admin');
  console.log(`Admin user "${username}" created successfully.`);
} catch (err) {
  console.error('Error creating user (may already exist):', err.message);
}
