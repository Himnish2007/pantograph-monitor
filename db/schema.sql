-- Himnish Pantograph Monitoring System - SQLite Schema

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','engineer','viewer')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  contact_force REAL,
  carbon_strip_wear REAL,
  height REAL,
  current REAL,
  connection_ok INTEGER DEFAULT 1,
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readings_ts ON sensor_readings(ts);
CREATE INDEX IF NOT EXISTS idx_readings_unit ON sensor_readings(unit_id);

CREATE TABLE IF NOT EXISTS thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  param TEXT UNIQUE NOT NULL,
  value REAL NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  parameter TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  value REAL,
  acknowledged INTEGER DEFAULT 0,
  acknowledged_by TEXT,
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);

CREATE TABLE IF NOT EXISTS ai_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  wear_rate_pct_per_day REAL,
  days_to_replacement REAL,
  predicted_replacement_date TEXT,
  ohe_contact_quality_score REAL,
  ohe_contact_quality_label TEXT,
  confidence REAL,
  ts TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_index_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL,
  score REAL NOT NULL,
  label TEXT NOT NULL,
  breakdown TEXT,
  ts TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  action TEXT NOT NULL,
  details TEXT,
  ts TEXT DEFAULT (datetime('now'))
);
