/* eslint-disable no-bitwise */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const createPlugin = require('./index');

// Modbus TCP function codes used by the plugin
const FC_READ_HOLDING = 3;
const EXCEPTION_DEVICE = 4;

/**
 * Build a register bank (address -> 16 bit value) and serve it
 * over Modbus TCP, mimicking how RUTOS behaves: requesting a range
 * that contains unknown registers results in exception code 4
 */
function startModbusMock(registers) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', (chunk) => {
      if (chunk.length < 8 || chunk.readUInt16BE(2) !== 0) {
        return;
      }
      const transactionId = chunk.readUInt16BE(0);
      const unitId = chunk[6];
      const functionCode = chunk[7];
      if (functionCode !== FC_READ_HOLDING) {
        return;
      }
      const address = chunk.readUInt16BE(8);
      const quantity = chunk.readUInt16BE(10);

      const values = [];
      for (let i = 0; i < quantity; i += 1) {
        const value = registers.get(address + i);
        if (typeof value !== 'number') {
          // RUTOS returns ServerDeviceFailure for unknown registers
          const exc = Buffer.from([
            transactionId >> 8, transactionId & 0xff, 0, 0, 0, 3, unitId,
            FC_READ_HOLDING + 0x80, EXCEPTION_DEVICE,
          ]);
          socket.write(exc);
          return;
        }
        values.push(value);
      }

      const response = Buffer.alloc(9 + values.length * 2);
      response.writeUInt16BE(transactionId, 0);
      response.writeUInt16BE(0, 2);
      response.writeUInt16BE(3 + values.length * 2, 4);
      response.writeUInt8(unitId, 6);
      response.writeUInt8(FC_READ_HOLDING, 7);
      response.writeUInt8(values.length * 2, 8);
      values.forEach((value, i) => {
        response.writeUInt16BE(value & 0xffff, 9 + i * 2);
      });
      socket.write(response);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        sockets,
        port: server.address().port,
      });
    });
  });
}

// Register bank writers, per the Teltonika register map
function writeU32(registers, address, value) {
  registers.set(address, (value >>> 16) & 0xffff);
  registers.set(address + 1, value & 0xffff);
}

function writeAscii(registers, address, quantity, text) {
  const buf = Buffer.alloc(quantity * 2);
  buf.write(text, 0, 'ascii');
  for (let i = 0; i < quantity; i += 1) {
    registers.set(address + i, buf.readUInt16BE(i * 2));
  }
}

function writeFloatBE(registers, address, value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  registers.set(address, buf.readUInt16BE(0));
  registers.set(address + 1, buf.readUInt16BE(2));
}

function buildRegisters(withService = true) {
  const registers = new Map();
  // System uptime, signal strength, temperature, hostname
  writeU32(registers, 1, 86400);
  writeU32(registers, 3, -73 | 0);
  writeU32(registers, 5, 420);
  writeAscii(registers, 7, 16, 'Teltonika-RUTX11.com');
  if (withService) {
    // GSM operator name (register 23)
    writeAscii(registers, 23, 16, 'TestOperator');
  }
  // Serial number, LAN MAC, device name
  writeAscii(registers, 39, 16, '90811076137');
  writeAscii(registers, 55, 16, 'AABBCCDDEEFF');
  writeAscii(registers, 71, 16, 'Lille_Oe_RUTX11');
  // Active SIM (register 87)
  writeAscii(registers, 87, 16, 'sim1');
  // Network type (register 119)
  writeAscii(registers, 119, 16, withService ? 'LTE' : 'No service');
  // WAN IP address (register 139), four 8 bit octets
  registers.set(139, 0x644b);
  registers.set(140, 0x5bcd);
  // GPS position (registers 143-146)
  writeFloatBE(registers, 143, -18.864042);
  writeFloatBE(registers, 145, -159.800064);
  // GPS speed, satellites, accuracy (registers 179-184)
  writeFloatBE(registers, 179, 0.5);
  writeU32(registers, 181, 12);
  writeFloatBE(registers, 183, 0.6);
  // Mobile data usage this day, SIM1 (registers 185-188)
  writeU32(registers, 185, 123456);
  writeU32(registers, 187, 654321);
  return registers;
}

function createMockApp() {
  const state = {
    values: new Map(),
    meta: new Map(),
    statuses: [],
    errors: [],
  };
  const app = {
    selfId: 'self',
    handleMessage: (id, delta) => {
      (delta.updates || []).forEach((update) => {
        (update.meta || []).forEach((m) => {
          state.meta.set(m.path, m.value);
        });
        (update.values || []).forEach((v) => {
          state.values.set(v.path, v.value);
        });
      });
    },
    setPluginStatus: (status) => {
      state.statuses.push(status);
    },
    setPluginError: (message) => {
      state.errors.push(message);
    },
  };

  // Resolves when all the given paths have been received
  state.waitFor = (paths) => {
    const missing = () => paths.filter((p) => !state.values.has(p));
    if (missing().length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for: ${missing().join(', ')}`));
      }, 5000);
      const interval = setInterval(() => {
        if (missing().length === 0) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 25);
    });
  };
  return { app, state };
}

const baseOptions = (port) => ({
  RUT240: false,
  enable_gps: true,
  GPSBE: true,
  ip: '127.0.0.1',
  port,
  interval: 2,
});

test('plugin publishes modem, WAN and GPS values', async (t) => {
  const mock = await startModbusMock(buildRegisters(true));
  t.after(() => {
    mock.sockets.forEach((socket) => socket.destroy());
    mock.server.close();
  });
  const { app, state } = createMockApp();
  const plugin = createPlugin(app);

  const expected = [
    'networking.modem.uptime',
    'networking.lte.rssi',
    'networking.lte.bars',
    'networking.lte.radioQuality',
    'networking.modem.temperature',
    'networking.lte.registerNetworkDisplay',
    'networking.wan.ip',
    'networking.lte.connectionText',
    'networking.lte.usage.rx',
    'networking.lte.usage.tx',
    'navigation.position',
    'navigation.speedOverGround',
    'navigation.gnss.satellites',
    'navigation.gnss.horizontalDilution',
  ];

  plugin.start(baseOptions(mock.port));
  t.after(() => plugin.stop());

  await state.waitFor(expected);

  assert.deepEqual(state.errors, []);
  assert.equal(state.values.get('networking.modem.uptime'), 86400);
  assert.equal(state.values.get('networking.lte.rssi'), -73);
  assert.equal(state.values.get('networking.lte.bars'), 3);
  assert.equal(state.values.get('networking.lte.radioQuality'), 0.675);
  assert.ok(Math.abs(state.values.get('networking.modem.temperature') - 315.15) < 0.01);
  assert.equal(state.values.get('networking.lte.registerNetworkDisplay'), 'TestOperator');
  assert.equal(state.values.get('networking.wan.ip'), '100.75.91.205');
  assert.equal(state.values.get('networking.lte.connectionText'), 'LTE');
  assert.equal(state.values.get('networking.lte.usage.rx'), 123456);
  assert.equal(state.values.get('networking.lte.usage.tx'), 654321);

  const position = state.values.get('navigation.position');
  assert.ok(Math.abs(position.latitude - -18.864042) < 0.0001);
  assert.ok(Math.abs(position.longitude - -159.800064) < 0.0001);
  assert.equal(state.values.get('navigation.speedOverGround'), 0.5);
  assert.equal(state.values.get('navigation.gnss.satellites'), 12);
  assert.ok(Math.abs(state.values.get('navigation.gnss.horizontalDilution') - 0.6) < 0.0001);

  // Meta is published for all custom paths, making them render nicely
  // in Signal K consumers
  const metaPaths = [
    'networking.modem.uptime',
    'networking.modem.temperature',
    'networking.lte.rssi',
    'networking.lte.bars',
    'networking.lte.radioQuality',
    'networking.lte.registerNetworkDisplay',
    'networking.lte.connectionText',
    'networking.wan.ip',
    'networking.lte.usage.rx',
    'networking.lte.usage.tx',
    'navigation.gnss.satellites',
    'navigation.gnss.horizontalDilution',
  ];
  metaPaths.forEach((path) => {
    assert.ok(state.meta.has(path), `missing meta for ${path}`);
  });
  assert.equal(state.meta.get('networking.modem.temperature').units, 'K');
  assert.equal(state.meta.get('networking.modem.uptime').units, 's');
  assert.equal(state.meta.get('networking.lte.rssi').units, 'dBm');
  assert.equal(state.meta.get('networking.lte.radioQuality').units, 'ratio');
  assert.equal(state.meta.get('networking.lte.usage.rx').units, 'B');
  const rssiZones = state.meta.get('networking.lte.rssi').zones;
  assert.equal(rssiZones.length, 3);
  assert.deepEqual(rssiZones.map((zone) => zone.state), ['alarm', 'warn', 'nominal']);

  assert.match(state.statuses.at(-1), /TestOperator/);
  assert.match(state.statuses.at(-1), /100\.75\.91\.205/);

  // The plugin must close its Modbus connections after each read
  plugin.stop();
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  assert.equal(mock.sockets.size, 0, 'plugin leaked Modbus TCP connections');
});

test('plugin survives the modem having no service', async (t) => {
  // No operator registers: reads for them return exception code 4,
  // exactly like a RUTX11 whose SIM has no service
  const mock = await startModbusMock(buildRegisters(false));
  t.after(() => {
    mock.sockets.forEach((socket) => socket.destroy());
    mock.server.close();
  });
  const { app, state } = createMockApp();
  const plugin = createPlugin(app);

  const expected = [
    'networking.modem.uptime',
    'networking.lte.rssi',
    'networking.wan.ip',
    'networking.lte.connectionText',
    'networking.lte.usage.rx',
    'networking.lte.usage.tx',
    'navigation.position',
  ];

  plugin.start(baseOptions(mock.port));
  t.after(() => plugin.stop());

  await state.waitFor(expected);

  assert.deepEqual(state.errors, []);
  assert.equal(state.values.get('networking.lte.registerNetworkDisplay'), undefined);
  assert.equal(state.values.get('networking.wan.ip'), '100.75.91.205');
  assert.equal(state.values.get('networking.lte.connectionText'), 'No service');
  assert.match(state.statuses.at(-1), /No service/);
});
