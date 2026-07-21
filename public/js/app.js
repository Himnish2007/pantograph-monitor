const API = '/api';
let token = localStorage.getItem('pcms_token') || null;
let currentUser = null;
let socket = null;
let thresholdsCache = {};
const charts = {};

// ---------------- Auth ----------------
async function apiCall(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const data = await apiCall('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('pcms_token', token);
    initApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logoutBtn').addEventListener('click', logout);

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('pcms_token');
  if (socket) socket.disconnect();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

async function tryAutoLogin() {
  if (!token) return;
  try {
    currentUser = await apiCall('/auth/me');
    initApp();
  } catch {
    logout();
  }
}

// ---------------- App init ----------------
function initApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userLabel').textContent = `${currentUser.username} (${currentUser.role})`;
  document.getElementById('adminTabBtn').style.display = currentUser.role === 'admin' ? '' : 'none';

  loadThresholds();
  loadLatestReading();
  loadAlerts();
  loadAIData();
  loadHealthIndex();
  loadTrends();
  if (currentUser.role === 'admin') loadUsers();

  connectSocket();
}

function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('modbus_status', (status) => {
    const badge = document.getElementById('connBadge');
    if (status.connected) {
      badge.className = 'conn-badge ok';
      badge.innerHTML = '<i class="dot"></i> Modbus Link OK';
    } else {
      badge.className = 'conn-badge bad';
      badge.innerHTML = '<i class="dot"></i> Modbus Link Down';
    }
  });

  socket.on('sensor_reading', (reading) => {
    document.getElementById('unitBadge').textContent = reading.unit_id;
    renderLiveMetrics(reading);
    document.getElementById('lastUpdated').textContent = new Date(reading.ts).toLocaleString();
  });

  socket.on('new_alerts', () => {
    if (document.getElementById('tab-alerts').classList.contains('active')) loadAlerts();
  });

  socket.on('ai_update', (data) => {
    renderAI(data.wearPrediction, data.contactQuality);
    renderHealth(data.healthIndex);
  });
}

// ---------------- Live Monitoring ----------------
function renderLiveMetrics(r) {
  document.getElementById('mvForce').textContent = r.contact_force !== null ? r.contact_force.toFixed(1) : '--';
  document.getElementById('mvWear').textContent = r.carbon_strip_wear !== null ? r.carbon_strip_wear.toFixed(1) : '--';
  document.getElementById('mvHeight').textContent = r.height !== null ? r.height.toFixed(0) : '--';
  document.getElementById('mvCurrent').textContent = r.current !== null ? r.current.toFixed(1) : '--';

  const t = thresholdsCache;
  setRangeLabel('mrForce', r.contact_force, t.CONTACT_FORCE_MIN_N, t.CONTACT_FORCE_MAX_N);
  setRangeLabel('mrWear', r.carbon_strip_wear, null, t.CARBON_STRIP_WEAR_WARN_PCT, t.CARBON_STRIP_WEAR_CRITICAL_PCT);
  setRangeLabel('mrHeight', r.height, t.HEIGHT_MIN_MM, t.HEIGHT_MAX_MM);
  setRangeLabel('mrCurrent', r.current, null, t.CURRENT_MAX_A);
}

function setRangeLabel(elId, value, min, warnOrMax, critical) {
  const el = document.getElementById(elId);
  if (value === null || value === undefined) { el.textContent = ''; return; }
  if (critical !== undefined) {
    // wear-style: warn/critical thresholds
    if (value >= critical) { el.textContent = 'CRITICAL'; el.className = 'metric-range bad'; }
    else if (value >= warnOrMax) { el.textContent = 'WARNING'; el.className = 'metric-range warn'; }
    else { el.textContent = 'Normal'; el.className = 'metric-range ok'; }
  } else if (min !== null) {
    if (value < min || value > warnOrMax) { el.textContent = 'Out of range'; el.className = 'metric-range bad'; }
    else { el.textContent = 'In range'; el.className = 'metric-range ok'; }
  } else {
    if (value > warnOrMax) { el.textContent = 'Exceeds max'; el.className = 'metric-range bad'; }
    else { el.textContent = 'Normal'; el.className = 'metric-range ok'; }
  }
}

async function loadLatestReading() {
  const r = await apiCall('/sensors/latest');
  if (r) {
    document.getElementById('unitBadge').textContent = r.unit_id;
    renderLiveMetrics({ ...r, contact_force: r.contact_force, carbon_strip_wear: r.carbon_strip_wear, height: r.height, current: r.current });
    document.getElementById('lastUpdated').textContent = new Date(r.ts).toLocaleString();
  }
}

async function loadThresholds() {
  const rows = await apiCall('/sensors/thresholds');
  thresholdsCache = {};
  rows.forEach((row) => (thresholdsCache[row.param] = row.value));
  renderThresholdsTable(rows);
}

function renderThresholdsTable(rows) {
  const tbody = document.querySelector('#thresholdsTable tbody');
  tbody.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.param}</td>
      <td><input type="number" step="0.1" value="${row.value}" data-param="${row.param}" style="width:90px" /></td>
      <td>${row.updated_by || '-'}</td>
      <td><button class="btn-small" data-save="${row.param}">Save</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const param = btn.getAttribute('data-save');
      const input = tbody.querySelector(`input[data-param="${param}"]`);
      await apiCall(`/sensors/thresholds/${param}`, { method: 'PUT', body: JSON.stringify({ value: Number(input.value) }) });
      loadThresholds();
    });
  });
}

// ---------------- Trends ----------------
function makeLineChart(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '22', tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true }, y: { display: true } } },
  });
}

async function loadTrends() {
  charts.force = charts.force || makeLineChart('chartForce', 'Contact Force (N)', '#0b2545');
  charts.wear = charts.wear || makeLineChart('chartWear', 'Carbon Strip Wear (%)', '#f36f21');
  charts.height = charts.height || makeLineChart('chartHeight', 'Height (mm)', '#16a34a');
  charts.current = charts.current || makeLineChart('chartCurrent', 'Current (A)', '#d97706');

  const hours = document.getElementById('trendsRange').value;
  const rows = await apiCall(`/sensors/history?hours=${hours}`);
  const labels = rows.map((r) => new Date(r.ts).toLocaleTimeString());

  updateChart(charts.force, labels, rows.map((r) => r.contact_force));
  updateChart(charts.wear, labels, rows.map((r) => r.carbon_strip_wear));
  updateChart(charts.height, labels, rows.map((r) => r.height));
  updateChart(charts.current, labels, rows.map((r) => r.current));
}

function updateChart(chart, labels, data) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update('none');
}

document.getElementById('trendsRange').addEventListener('change', loadTrends);

// ---------------- Alerts ----------------
async function loadAlerts() {
  const activeOnly = document.getElementById('activeOnlyToggle').checked;
  const rows = await apiCall(`/alerts?active=${activeOnly}`);
  const tbody = document.querySelector('#alertsTable tbody');
  tbody.innerHTML = '';
  rows.forEach((a) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(a.ts).toLocaleString()}</td>
      <td>${a.parameter}</td>
      <td class="severity-${a.severity}">${a.severity.toUpperCase()}</td>
      <td>${a.message}</td>
      <td>${a.acknowledged ? `Ack by ${a.acknowledged_by}` : 'Active'}</td>
      <td>${a.acknowledged ? '' : `<button class="btn-small" data-ack="${a.id}">Acknowledge</button>`}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-ack]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiCall(`/alerts/${btn.getAttribute('data-ack')}/acknowledge`, { method: 'POST' });
      loadAlerts();
    });
  });
}
document.getElementById('activeOnlyToggle').addEventListener('change', loadAlerts);

// ---------------- AI Insights ----------------
function renderAI(wearPrediction, contactQuality) {
  if (wearPrediction) {
    document.getElementById('aiWearRate').textContent = wearPrediction.wear_rate_pct_per_day ?? '--';
    document.getElementById('aiDaysLeft').textContent = wearPrediction.days_to_replacement ?? 'N/A';
    document.getElementById('aiPredDate').textContent = wearPrediction.predicted_replacement_date || 'N/A';
    document.getElementById('aiConfidence').textContent = wearPrediction.confidence !== undefined ? `${Math.round(wearPrediction.confidence * 100)}%` : '--';
  }
  if (contactQuality) {
    document.getElementById('aiQualityScore').textContent = contactQuality.score ?? '--';
    document.getElementById('aiQualityLabel').textContent = contactQuality.label || '--';
    const bd = contactQuality.breakdown || {};
    document.getElementById('aiBreakdown').innerHTML = Object.entries(bd)
      .map(([k, v]) => `<div><span>${k.replace(/_/g, ' ')}</span><b>${v}</b></div>`).join('');
  }
}

async function loadAIData() {
  const pred = await apiCall('/ai/prediction');
  if (pred) {
    renderAI({
      wear_rate_pct_per_day: pred.wear_rate_pct_per_day,
      days_to_replacement: pred.days_to_replacement,
      predicted_replacement_date: pred.predicted_replacement_date,
      confidence: pred.confidence,
    }, {
      score: pred.ohe_contact_quality_score,
      label: pred.ohe_contact_quality_label,
      breakdown: {},
    });
  }
}

// ---------------- Health Index ----------------
function renderHealth(healthIndex) {
  document.getElementById('healthScore').textContent = healthIndex.score;
  document.getElementById('healthLabel').textContent = healthIndex.label;
}

async function loadHealthIndex() {
  const latest = await apiCall('/ai/health-index/latest');
  if (latest) renderHealth({ score: latest.score, label: latest.label });

  charts.health = charts.health || makeLineChart('chartHealth', 'Health Index', '#0b2545');
  const rows = await apiCall('/ai/health-index?hours=24');
  updateChart(charts.health, rows.map((r) => new Date(r.ts).toLocaleTimeString()), rows.map((r) => r.score));
}

// ---------------- Admin: Users ----------------
document.getElementById('createUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;
  try {
    await apiCall('/auth/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
    document.getElementById('createUserForm').reset();
    loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

async function loadUsers() {
  const rows = await apiCall('/auth/users');
  const tbody = document.querySelector('#usersTable tbody');
  tbody.innerHTML = '';
  rows.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.username}</td><td>${u.role}</td><td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.username !== currentUser.username ? `<button class="btn-small" data-del="${u.id}">Delete</button>` : ''}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user?')) return;
      await apiCall(`/auth/users/${btn.getAttribute('data-del')}`, { method: 'DELETE' });
      loadUsers();
    });
  });
}

// ---------------- Tab navigation ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    if (btn.dataset.tab === 'trends') loadTrends();
    if (btn.dataset.tab === 'alerts') loadAlerts();
    if (btn.dataset.tab === 'health') loadHealthIndex();
    if (btn.dataset.tab === 'admin' && currentUser.role === 'admin') { loadThresholds(); loadUsers(); }
  });
});

// ---------------- Boot ----------------
tryAutoLogin();
