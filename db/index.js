const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pantograph.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Seed default thresholds from env if not already present
const defaultThresholds = {
  CONTACT_FORCE_MIN_N: Number(process.env.CONTACT_FORCE_MIN_N || 60),
  CONTACT_FORCE_MAX_N: Number(process.env.CONTACT_FORCE_MAX_N || 140),
  CARBON_STRIP_WEAR_WARN_PCT: Number(process.env.CARBON_STRIP_WEAR_WARN_PCT || 70),
  CARBON_STRIP_WEAR_CRITICAL_PCT: Number(process.env.CARBON_STRIP_WEAR_CRITICAL_PCT || 90),
  HEIGHT_MIN_MM: Number(process.env.HEIGHT_MIN_MM || 1200),
  HEIGHT_MAX_MM: Number(process.env.HEIGHT_MAX_MM || 1950),
  CURRENT_MAX_A: Number(process.env.CURRENT_MAX_A || 1200),
};

const insertThreshold = db.prepare(
  `INSERT OR IGNORE INTO thresholds (param, value) VALUES (?, ?)`
);
for (const [param, value] of Object.entries(defaultThresholds)) {
  insertThreshold.run(param, value);
}

module.exports = db;
