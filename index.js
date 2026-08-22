const modbus = require('modbus-stream');

function getData(address, quantity, options) {
  return new Promise((resolve, reject) => {
    modbus.tcp.connect(options.port, options.ip, {
      debug: null,
    }, (err, connection) => {
      if (err) {
        reject(err);
        return;
      }
      connection.once('error', (connErr) => {
        reject(connErr);
      });
      connection.readHoldingRegisters({
        address,
        quantity,
      }, (readErr, res) => {
        // The RUTX11 only supports a limited number of concurrent
        // Modbus TCP sessions, so always close the connection after
        // a read to avoid exhausting them
        connection.close();
        if (readErr) {
          reject(new Error(`readHoldingRegisters ${address}/${quantity}: ${readErr.message}`));
          return;
        }
        resolve(res.response.data);
      });
    });
  });
}

function asciiValue(data) {
  return Buffer.concat(data).toString().replace(/\0.*$/g, '');
}

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = 'signalk-teltonika-rutx11';
  plugin.name = 'Teltonika Modem Modbus';
  plugin.description = 'Plugin that retrieves status from a Teltonika RUT modem via Modbus';

  let timeout = null;
  let stopped = false;
  plugin.start = function start(options) {
    stopped = false;
    app.setPluginStatus('Initializing');
    plugin.setMeta();
    plugin.fetchStatus(options);
  };
  plugin.setMeta = function setMeta() {
    app.handleMessage(plugin.id, {
      context: `vessels.${app.selfId}`,
      updates: [
        {
          meta: [
            {
              path: 'networking.modem.uptime',
              value: {
                displayName: 'Modem uptime',
                description: 'Time since the modem last rebooted',
                units: 's',
              },
            },
            {
              path: 'networking.modem.temperature',
              value: {
                displayName: 'Modem temperature',
                description: 'Internal temperature of the modem',
                units: 'K',
              },
            },
            {
              path: 'networking.lte.rssi',
              value: {
                displayName: 'Signal strength',
                description: 'Mobile network received signal strength',
                units: 'dBm',
                zones: [
                  {
                    state: 'alarm',
                    upper: -110,
                    message: 'No usable signal',
                  },
                  {
                    state: 'warn',
                    lower: -110,
                    upper: -95,
                    message: 'Weak signal',
                  },
                  {
                    state: 'nominal',
                    lower: -95,
                    message: 'Good signal',
                  },
                ],
              },
            },
            {
              path: 'networking.lte.bars',
              value: {
                displayName: 'Signal bars',
                description: 'Mobile network signal strength as bars, from 0 to 5',
                zones: [
                  {
                    state: 'alarm',
                    upper: 0,
                    message: 'No service',
                  },
                  {
                    state: 'warn',
                    lower: 1,
                    upper: 2,
                    message: 'Weak signal',
                  },
                  {
                    state: 'nominal',
                    lower: 3,
                    upper: 5,
                    message: 'Good signal',
                  },
                ],
              },
            },
            {
              path: 'networking.lte.radioQuality',
              value: {
                displayName: 'Radio quality',
                description: 'Mobile network signal quality, normalized from 0 to 1',
                units: 'ratio',
                zones: [
                  {
                    state: 'alarm',
                    upper: 0.2,
                    message: 'No service',
                  },
                  {
                    state: 'warn',
                    lower: 0.2,
                    upper: 0.6,
                    message: 'Weak signal',
                  },
                  {
                    state: 'nominal',
                    lower: 0.6,
                    upper: 1,
                    message: 'Good signal',
                  },
                ],
              },
            },
            {
              path: 'networking.lte.registerNetworkDisplay',
              value: {
                displayName: 'Network operator',
                description: 'Name of the registered mobile network operator',
              },
            },
            {
              path: 'networking.lte.connectionText',
              value: {
                displayName: 'Connection type',
                description: 'Mobile network technology in use, for example LTE',
              },
            },
            {
              path: 'networking.wan.ip',
              value: {
                displayName: 'WAN IP address',
                description: 'IP address of the router WAN interface',
              },
            },
            {
              path: 'networking.lte.usage.rx',
              value: {
                displayName: 'Data received',
                description: 'Mobile data received today on the active SIM',
                units: 'B',
              },
            },
            {
              path: 'networking.lte.usage.tx',
              value: {
                displayName: 'Data transmitted',
                description: 'Mobile data transmitted today on the active SIM',
                units: 'B',
              },
            },
            {
              path: 'navigation.gnss.satellites',
              value: {
                displayName: 'Satellites',
                description: 'Number of satellites used in the GNSS position fix',
              },
            },
            {
              path: 'navigation.gnss.horizontalDilution',
              value: {
                displayName: 'HDOP',
                description: 'Horizontal dilution of precision of the GNSS fix',
                units: 'ratio',
              },
            },
          ],
        },
      ],
    });
  };
  plugin.fetchStatus = async function fetchStatus(options) {
    function sendValues(values) {
      app.handleMessage(plugin.id, {
        context: `vessels.${app.selfId}`,
        updates: [
          {
            source: {
              label: plugin.id,
            },
            timestamp: (new Date().toISOString()),
            values,
          },
        ],
      });
    }

    // Optional reads (for example the operator name when the modem has
    // no service) must not abort the whole poll
    async function safeGetData(address, quantity) {
      try {
        return await getData(address, quantity, options);
      } catch (err) {
        return null;
      }
    }

    let signalStrength = null;
    try {
      const data = await getData(1, 22, options);
      if (data) {
        const buf = Buffer.concat(data);
        const modemUptime = buf.readUInt32BE(0);
        signalStrength = buf.readInt32BE(4);
        const modemTemperature = buf.readInt32BE(8) / 10 + 273.15;
        const signalBars = Math.min(Math.floor((signalStrength + 100) / 8), 5);
        const radioQuality = Math.min((signalStrength + 100) / 8, 5) / 5;
        sendValues([
          { path: 'networking.modem.uptime', value: modemUptime },
          { path: 'networking.lte.rssi', value: signalStrength },
          { path: 'networking.lte.bars', value: signalBars },
          { path: 'networking.lte.radioQuality', value: radioQuality },
          { path: 'networking.modem.temperature', value: modemTemperature },
        ]);
      }

      // GSM operator name (register 23). Unavailable while the modem
      // is out of service, in which case the router returns an
      // exception instead of data
      const operatorData = await safeGetData(23, 16);
      let operator = '';
      if (operatorData) {
        operator = asciiValue(operatorData);
        if (operator) {
          sendValues([
            { path: 'networking.lte.registerNetworkDisplay', value: operator },
          ]);
        }
      }

      // WAN IP address (register 139, four 8 bit octets)
      const wanData = await safeGetData(139, 2);
      let wanIp = '';
      if (wanData) {
        wanIp = Array.from(Buffer.concat(wanData)).join('.');
        if (wanIp !== '0.0.0.0') {
          sendValues([
            { path: 'networking.wan.ip', value: wanIp },
          ]);
        }
      }

      // Network type (register 119)
      const netData = await safeGetData(119, 16);
      let networkType = '';
      if (netData) {
        networkType = asciiValue(netData);
        if (networkType) {
          sendValues([
            { path: 'networking.lte.connectionText', value: networkType },
          ]);
        }
      }

      if (operator) {
        app.setPluginStatus(`Mobile: ${operator} ${signalStrength}dBm, WAN IP ${wanIp}`);
      } else {
        app.setPluginStatus(`Mobile: ${networkType}, WAN IP ${wanIp}`);
      }

      // Active SIM card (register 87)
      const simData = await safeGetData(87, 16);
      let activeSim = '';
      if (simData) {
        activeSim = Buffer.concat(simData).toString();
      }
      let usageAddress;
      switch (activeSim.slice(0, 4)) {
        case 'sim2': {
          usageAddress = 300;
          break;
        }
        default: {
          usageAddress = options.RUT240 ? 135 : 185;
          break;
        }
      }

      // Mobile data usage for the active SIM
      const usageData = await safeGetData(usageAddress, 4);
      if (usageData) {
        const usageBuf = Buffer.concat(usageData);
        const rx = usageBuf.readUInt32BE(0);
        const tx = usageBuf.readUInt32BE(4);
        sendValues([
          { path: 'networking.lte.usage.rx', value: rx },
          { path: 'networking.lte.usage.tx', value: tx },
        ]);
      }

      if (!options.RUT240 && options.enable_gps) {
        // GPS position (registers 143-146)
        const posData = await safeGetData(143, 4);
        if (posData) {
          const posBuf = Buffer.concat(posData);
          const modemLat = options.GPSBE
            ? posBuf.readFloatBE(0)
            : posBuf.readFloatLE(0);
          const modemLon = options.GPSBE
            ? posBuf.readFloatBE(4)
            : posBuf.readFloatLE(4);
          sendValues([
            {
              path: 'navigation.position',
              value: {
                latitude: modemLat,
                longitude: modemLon,
              },
            },
          ]);
        }

        // GPS speed (register 179, float), satellites (register 181),
        // accuracy/HDOP (register 183, float)
        const gpsData = await safeGetData(179, 6);
        if (gpsData) {
          const gpsBuf = Buffer.concat(gpsData);
          const modemSpeed = options.GPSBE
            ? gpsBuf.readFloatBE(0)
            : gpsBuf.readFloatLE(0);
          const modemSats = gpsBuf.readUInt32BE(4);
          const modemHdop = options.GPSBE
            ? gpsBuf.readFloatBE(8)
            : gpsBuf.readFloatLE(8);
          sendValues([
            { path: 'navigation.speedOverGround', value: modemSpeed },
            { path: 'navigation.gnss.satellites', value: modemSats },
            { path: 'navigation.gnss.horizontalDilution', value: modemHdop },
          ]);
        }
      }
    } catch (err) {
      app.setPluginError(err.message);
    }

    if (!stopped) {
      timeout = setTimeout(() => {
        plugin.fetchStatus(options);
      }, options.interval * 1000);
    }
  };

  plugin.stop = function stop() {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  plugin.schema = {
    type: 'object',
    description: 'For Teltonika RUT240, 360, 950, 955, X9, X11, X14 modems',
    properties: {
      RUT240: {
        type: 'boolean',
        title: 'Select only in case using RUT240 with older firmware than 7.x',
        default: false,
      },
      enable_gps: {
        type: 'boolean',
        title: 'Get GPS position from the RUT',
        default: true,
      },
      GPSBE: {
        type: 'boolean',
        title: 'Select only in case GPS data is big endian (usualy identified by unexpected values for longitude and latitude).',
        default: false,
      },
      ip: {
        type: 'string',
        default: '192.168.1.1',
        title: 'Modem IP address',
      },
      port: {
        type: 'integer',
        default: 502,
        title: 'Modem Modbus port (note: Modbus must be enabled on the router)',
      },
      interval: {
        type: 'integer',
        default: 60,
        title: 'How often to fetch the status (in seconds)',
      },
    },
  };
  return plugin;
};
