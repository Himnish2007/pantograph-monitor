# Himnish PCMS — Pantograph Condition Monitoring System (v1.0 POC)

AI-based real-time monitoring dashboard for a single Indian Railways pantograph unit, built to match the sensor set and AI features on the Himnish marketing collateral: **Contact Force, Carbon Strip Wear, Height, Current**, with **Carbon Strip Replacement Prediction** and **OHE Contact Quality Analysis**.

## Stack
- Node.js / Express backend
- SQLite (better-sqlite3) — zero-config, file-based, perfect for single-unit POC
- Socket.io — live push to dashboard (no polling from browser)
- modbus-serial — reads from RUT200 (Modbus TCP gateway mode) or direct RTU serial
- Vanilla JS + Chart.js frontend (matches your EMU/RAIP dashboard pattern)
- JWT auth with 3 roles: admin / engineer / viewer

## Folder structure
```
pantograph-monitor/
├── server.js              # Express + Socket.io + Modbus poll loop
├── seed.js                 # creates first admin user
├── db/
│   ├── schema.sql
│   └── index.js
├── services/
│   ├── modbusClient.js     # RUT200/RTU ingestion
│   ├── aiEngine.js         # wear prediction + contact quality scoring
│   ├── alertEngine.js      # threshold evaluation
│   └── authMiddleware.js
├── routes/
│   ├── auth.js  sensors.js  alerts.js  ai.js
└── public/                 # dashboard UI
```

## 1. Local setup
```bash
cd pantograph-monitor
npm install
cp .env.example .env
```

Edit `.env` — most importantly the **Modbus section**:
- `MODBUS_MODE=TCP` if using RUT200 as a Modbus TCP→RTU gateway (recommended — same pattern as your other RUT200 projects). Set `MODBUS_HOST` to the router's LAN/LTE IP.
- `MODBUS_MODE=RTU` for direct bench testing with a USB-RS485 dongle on `COM4` (or whatever port).

### Register map (edit to match your actual transmitter/PLC)
| Sensor | Register (holding, FC03) | Scale factor | Formula |
|---|---|---|---|
| Contact Force | `REG_CONTACT_FORCE` (default 0) | `/10` | raw ÷ scale = Newtons |
| Carbon Strip Wear | `REG_CARBON_STRIP_WEAR` (default 1) | `/100` | raw ÷ scale = % |
| Height | `REG_HEIGHT` (default 2) | `/10` | raw ÷ scale = mm |
| Current | `REG_CURRENT` (default 3) | `/10` | raw ÷ scale = Amps |

These are placeholder addresses — **update them to match the actual sensor transmitter / PLC register map on the bench** before connecting to real hardware. Everything is env-driven, no code changes needed.

```bash
node seed.js admin YourStrongPassword    # create first admin login
node server.js
```
Open `http://localhost:3000` and log in.

## 2. What's implemented
- **Live Monitoring** — real-time cards for all 4 sensors, pushed via WebSocket every poll cycle (default 2s)
- **Trends** — historical charts (1h / 6h / 24h / 7d)
- **Alerts** — auto-raised on threshold breach (contact force band, wear warn/critical, height range, current max, Modbus link loss), with acknowledge workflow, deduped (won't spam same alert within 5 min)
- **AI Insights**:
  - *Carbon Strip Replacement Prediction* — linear regression on wear% history → wear rate (%/day) → days-to-replacement + predicted calendar date + confidence score
  - *OHE Contact Quality Analysis* — composite 0–100 score from contact-force band deviation, force jitter/stability, and height range compliance → Excellent/Good/Fair/Poor label
- **Health Index** — weighted composite (contact quality 40%, wear headroom 35%, electrical 25%) logged over time with trend chart
- **RBAC** — admin (full control + user management), engineer (edit thresholds), viewer (read-only)
- **Admin tab** — live threshold editing, user create/delete

## 3. Deploying to Railway.app (same pattern as your other dashboards)

```bash
git init
git add .
git commit -m "Initial commit: Himnish PCMS v1.0 POC"
git branch -M main
git remote add origin https://github.com/<your-org>/pantograph-monitor.git
git push -u origin main
```

Then in Railway:
1. New Project → Deploy from GitHub repo → select `pantograph-monitor`
2. Add environment variables from `.env.example` in the Railway dashboard (**do not commit `.env`**)
3. Since Railway containers can't reach your office LAN/RUT200 directly, for a cloud-hosted deployment you'll want the RUT200 to either:
   - expose a static WAN IP / VPN endpoint Railway can reach for Modbus TCP, or
   - (more robust long-term, matches your EMU project pattern) push readings via an RUT200 Lua script over HTTP to a small `/api/ingest` endpoint instead of Railway polling Modbus directly — happy to add that ingestion mode if you want cloud deployment with the router behind NAT.
4. Railway auto-detects `npm start` from `package.json` and deploys.

**For the current POC stage** (bench testing at office with real Modbus RTU/RUT200), running it locally or on an office PC/mini-PC on the same network as the RUT200 is simplest — no NAT/firewall issues, lowest latency.

## 4. Updating after code changes
Following your standing workflow — never delete the deployed folder, copy files over to preserve `.git`:
```bash
git add .
git commit -m "describe the change"
git push
```
Railway redeploys automatically on push if GitHub integration is connected.

## Next steps / open items
- Real register addresses need to be confirmed against actual transmitter/PLC datasheet and updated in `.env`
- If cloud deployment is needed while RUT200 stays behind NAT, add HTTP-push ingestion mode (RUT200 Lua script → `/api/ingest`) instead of Railway→Modbus TCP polling
- Multi-unit fleet support (schema already has `unit_id` on every table, so scaling to a fleet later is straightforward)
