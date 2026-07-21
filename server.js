require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const bcrypt = require('bcryptjs');
const db = require('./db');
const ModbusClient = require('./services/modbusClient');
const alertEngine = require('./services/alertEngine');
const aiEngine = require('./services/aiEngine');

const authRoutes = require('./routes/auth');
const sensorRoutes = require('./routes/sensors');
const alertRoutes = require('./routes/alerts');
const aiRoutes = require('./routes/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Railway (and most PaaS platforms) sit behind a reverse proxy and set
// X-Forwarded-For. Express needs to be told to trust it, otherwise
// express-rate-limit throws on every request.
app.set('trust proxy', 1);

const UNIT_ID = process.env.UNIT_ID || 'PANTO-001';
const PORT = process.env.PORT || 3000;

// ---- Security & middleware ----
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200 });
app.use('/api/', apiLimiter);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
app.use('/api/auth/login', loginLimiter);

// ---- Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/sensors', sensorRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/ai', aiRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', unit_id: UNIT_ID, time: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({ authDisabled: process.env.AUTH_DISABLED === 'true' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Bootstrap first admin user (runs inside the actual server process,
//      so it always writes to the real database this server is using -
//      avoids the classic "seed ran locally, prod DB never got the user" trap) ----
(function bootstrapAdmin() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      '[Bootstrap] No users exist yet and ADMIN_USERNAME/ADMIN_PASSWORD are not set. ' +
      'Set them in your environment variables and redeploy to create the first admin login.'
    );
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
  console.log(`[Bootstrap] Created first admin user "${username}" from ADMIN_USERNAME/ADMIN_PASSWORD env vars.`);
})();

// ---- DB prepared statements for the poll loop ----
const insertReading = db.prepare(`
  INSERT INTO sensor_readings (unit_id, contact_force, carbon_strip_wear, height, current, connection_ok)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertPrediction = db.prepare(`
  INSERT INTO ai_predictions
    (unit_id, wear_rate_pct_per_day, days_to_replacement, predicted_replacement_date,
     ohe_contact_quality_score, ohe_contact_quality_label, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertHealthIndex = db.prepare(`
  INSERT INTO health_index_log (unit_id, score, label, breakdown)
  VALUES (?, ?, ?, ?)
`);

// ---- Modbus ingestion + processing pipeline ----
const modbus = new ModbusClient();

modbus.on('connected', () => io.emit('modbus_status', { connected: true }));
modbus.on('disconnected', () => io.emit('modbus_status', { connected: false }));
modbus.on('connection_error', (err) => io.emit('modbus_status', { connected: false, error: err.message }));

let cycleCount = 0;
const AI_EVAL_EVERY_N_CYCLES = 5; // don't recompute AI on every single poll tick

modbus.startPolling((reading) => {
  // 1. Persist raw reading
  insertReading.run(
    UNIT_ID,
    reading.contact_force,
    reading.carbon_strip_wear,
    reading.height,
    reading.current,
    reading.connection_ok ? 1 : 0
  );

  const readingWithTs = { ...reading, ts: new Date().toISOString() };

  // 2. Broadcast live reading immediately
  io.emit('sensor_reading', { unit_id: UNIT_ID, ...readingWithTs });

  // 3. Evaluate alert thresholds
  const raised = alertEngine.evaluate(UNIT_ID, reading);
  if (raised.length) io.emit('new_alerts', raised);

  // 4. Periodically run AI + health index (needs some history to be meaningful)
  cycleCount += 1;
  if (cycleCount % AI_EVAL_EVERY_N_CYCLES === 0) {
    const history = db.prepare(`
      SELECT * FROM sensor_readings WHERE unit_id = ? ORDER BY ts DESC LIMIT 200
    `).all(UNIT_ID).reverse();

    const thresholds = alertEngine.getThresholds();

    const wearPrediction = aiEngine.predictCarbonStripReplacement(
      history, thresholds.CARBON_STRIP_WEAR_CRITICAL_PCT
    );
    const contactQuality = aiEngine.ohecontactQualityScore(history.slice(-30), thresholds);
    const latest = history[history.length - 1];
    const healthIndex = aiEngine.computeHealthIndex(latest, wearPrediction, contactQuality, thresholds);

    insertPrediction.run(
      UNIT_ID,
      wearPrediction.wear_rate_pct_per_day,
      wearPrediction.days_to_replacement,
      wearPrediction.predicted_replacement_date,
      contactQuality.score,
      contactQuality.label,
      wearPrediction.confidence
    );
    insertHealthIndex.run(UNIT_ID, healthIndex.score, healthIndex.label, JSON.stringify(healthIndex.breakdown));

    io.emit('ai_update', { wearPrediction, contactQuality, healthIndex });
  }
});

io.on('connection', (socket) => {
  socket.emit('modbus_status', { connected: modbus.connected });
});

server.listen(PORT, () => {
  console.log(`Himnish Pantograph Monitoring System running on port ${PORT}`);
  console.log(`Unit: ${UNIT_ID} | Modbus mode: ${process.env.MODBUS_MODE || 'TCP'}`);
});
