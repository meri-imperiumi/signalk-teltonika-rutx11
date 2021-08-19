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
        if (readErr) {
          reject(err);
          return;
        }
        resolve(res.response.data);
      });
    });
  });
}

module.exports = function createPlugin(app) {
  const plugin = {};
  plugin.id = 'signalk-teltonika-rutx11';
  plugin.name = 'Teltonika Modem Modbus';
  plugin.description = 'Plugin that retrieves status from a Teltonika RUT modem via Modbus';

  let timeout = null;
  plugin.start = function start(options) {
    app.setPluginStatus('Initializing');
    plugin.setMeta();
    plugin.fetchStatus(options);
  };
  plugin.setMeta = function setMeta() {
    app.handleMessage('net-ais-plugin', {
      context: 'vessels.self',
      updates: [
        {
          meta: [
              { path: 'networking.modem.temperature', value: { units: 'K' } },
          ]
        }
      ]
    })
  };
  plugin.fetchStatus = function fetchStatus(options) {
    const values = [];
    getData(1, 38, options)
      .then((data) => {
        const modemUptime = Buffer.concat(data.slice(0, 2)).readUInt32BE();
        values.push({
          path: 'networking.modem.uptime',
          value: modemUptime,
        });
        const signalStrength = Buffer.concat(data.slice(2, 5)).readInt32BE();
        values.push({
          path: 'networking.lte.rssi',
          value: signalStrength,
        });
        const signalBars = Math.min(Math.floor((signalStrength + 100) / 8), 5);
        values.push({
          path: 'networking.lte.bars',
          value: signalBars,
        });
        const radioQuality = Math.min((signalStrength + 100) / 8, 5) / 5;
        values.push({
          path: 'networking.lte.radioQuality',
          value: radioQuality,
        });
        const modemTemperature = Buffer.concat(data.slice(4, 7)).readInt32BE() / 10 + 273.15;
        values.push({
          path: 'networking.modem.temperature',
          value: modemTemperature,
        });
        const operator = Buffer.concat(data.slice(22)).toString().replace(/\0.*$/g, '');
        values.push({
          path: 'networking.lte.registerNetworkDisplay',
          value: operator,
        });
        app.setPluginStatus(`Connected to ${operator}, signal strength ${signalStrength}dBm`);
        return getData(119, 16, options);
      })
      .then((data) => {
        const connectionType = Buffer.concat(data.slice(0, 15)).toString().replace(/\0.*$/g, '');
        values.push({
          path: 'networking.lte.connectionText',
          value: connectionType,
        });
        return getData(87, 16, options);
      })
      .then((data) => {
        const activeSim = Buffer.concat(data.slice(0, 15)).toString();
        switch (activeSim.slice(0, 4)) {
          case 'sim2': {
            return getData(300, 4, options);
          }
          default: {
            if (options.RUT240) {
              return getData(135, 4, options);  
            } else {
              return getData(185, 4, options);
            }
          }
        }
      })
      .then((data) => {
        const rx = Buffer.concat([data[0], data[1]]).readUInt32BE();
        const tx = Buffer.concat([data[2], data[3]]).readUInt32BE();
        values.push(
          {
          path: 'networking.lte.usage.tx',
          value: tx,
          },
          {
          path: 'networking.lte.usage.rx',
          value: rx,
          }
        );
      })
      .then(() => {
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
      })
      .catch((err) => {
        app.setPluginError(err.message);
      });

    timeout = setTimeout(() => {
      plugin.fetchStatus(options);
    }, options.interval * 1000);
  };

  plugin.stop = function stop() {
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
        title: 'Select only in case using RUT240',
        default: false
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
