/**
 * Modbus ingestion service.
 *
 * Two supported paths, chosen via MODBUS_MODE:
 *  - TCP: RUT200 configured as a Modbus TCP-to-RTU gateway. We connect over
 *         the LAN/LTE IP of the router and it forwards our requests to the
 *         RS485 field bus where the sensor transmitters / PLC sit.
 *  - RTU: Direct serial (e.g. USB-RS485 dongle) - useful for bench testing
 *         at the office without the router in the loop.
 *
 * Register map (holding registers, function code 03) and scale factors are
 * fully configurable via .env - see .env.example for the layout used on the
 * POC bench: Contact Force, Carbon Strip Wear, Height, Current.
 */

const ModbusRTU = require('modbus-serial');
const EventEmitter = require('events');

class ModbusClient extends EventEmitter {
  constructor() {
    super();
    this.client = new ModbusRTU();
    this.connected = false;
    this.pollTimer = null;
    this.consecutiveFailures = 0;

    this.mode = process.env.MODBUS_MODE || 'TCP';
    this.unitId = Number(process.env.MODBUS_UNIT_ID || 1);
    this.pollInterval = Number(process.env.MODBUS_POLL_INTERVAL_MS || 2000);
    this.timeout = Number(process.env.MODBUS_TIMEOUT_MS || 1500);

    this.registers = {
      contact_force: {
        addr: Number(process.env.REG_CONTACT_FORCE || 0),
        scale: Number(process.env.REG_CONTACT_FORCE_SCALE || 10),
      },
      carbon_strip_wear: {
        addr: Number(process.env.REG_CARBON_STRIP_WEAR || 1),
        scale: Number(process.env.REG_CARBON_STRIP_WEAR_SCALE || 100),
      },
      height: {
        addr: Number(process.env.REG_HEIGHT || 2),
        scale: Number(process.env.REG_HEIGHT_SCALE || 10),
      },
      current: {
        addr: Number(process.env.REG_CURRENT || 3),
        scale: Number(process.env.REG_CURRENT_SCALE || 10),
      },
    };
  }

  async connect() {
    try {
      this.client.setTimeout(this.timeout);

      if (this.mode === 'RTU') {
        const path = process.env.MODBUS_SERIAL_PATH || 'COM4';
        const baudRate = Number(process.env.MODBUS_BAUD_RATE || 9600);
        await this.client.connectRTUBuffered(path, { baudRate });
        console.log(`[Modbus] Connected RTU on ${path} @ ${baudRate}bps`);
      } else {
        const host = process.env.MODBUS_HOST || '192.168.1.1';
        const port = Number(process.env.MODBUS_PORT || 502);
        await this.client.connectTCP(host, { port });
        console.log(`[Modbus] Connected TCP to RUT200 gateway ${host}:${port}`);
      }

      this.client.setID(this.unitId);
      this.connected = true;
      this.consecutiveFailures = 0;
      this.emit('connected');
    } catch (err) {
      this.connected = false;
      console.error('[Modbus] Connection failed:', err.message);
      this.emit('connection_error', err);
      // retry after a delay
      setTimeout(() => this.connect(), 5000);
    }
  }

  async readOnce() {
    const result = {
      contact_force: null,
      carbon_strip_wear: null,
      height: null,
      current: null,
      connection_ok: false,
    };

    if (!this.connected) {
      return result;
    }

    try {
      for (const [key, cfg] of Object.entries(this.registers)) {
        const res = await this.client.readHoldingRegisters(cfg.addr, 1);
        result[key] = res.data[0] / cfg.scale;
      }
      result.connection_ok = true;
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      console.error('[Modbus] Read failed:', err.message);
      this.emit('read_error', err);
      if (this.consecutiveFailures >= 3) {
        this.connected = false;
        this.emit('disconnected');
        this.connect();
      }
    }

    return result;
  }

  startPolling(onReading) {
    this.connect();
    this.pollTimer = setInterval(async () => {
      const reading = await this.readOnce();
      onReading(reading);
    }, this.pollInterval);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

module.exports = ModbusClient;
