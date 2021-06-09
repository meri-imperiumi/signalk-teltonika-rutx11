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
      connection.once('error', (err2) => {
        reject(err);
        return;
      });
      connection.readHoldingRegisters({
        address,
        quantity,
      }, (err, res) => {
        if (err) {
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
  plugin.name = 'Teltonika RUTX11 status';
  plugin.description = 'Plugin that retrieves status from a Teltonika RUTX11 modem via Modbus';

  let timeout = null;
  plugin.start = function start(options) {
    app.setPluginStatus('Initializing');
    plugin.fetchStatus(options);
  }
  plugin.fetchStatus = function fetchStatus(options) {
    const values = [];
    getData(1, 38)
      .then((data) => {
        const signalStrength = Buffer.concat(data.slice(2, 5)).readInt32BE();
        values.push({
          path: 'networking.lte.rssi',
          value: signalStrength,
        });
        const operator = Buffer.concat(data.slice(22)).toString();
        values.push({
          path: 'networking.lte.registerNetworkDisplay',
          value: operator,
        });
        app.setPluginStatus(`Connected to ${operator}, signal strength ${signalStrength}dBm`);
        return getData(119, 16);
      })
    .then((data) => {
      const connectionType = Buffer.concat(data.slice(0, 15)).toString();
      values.push({
        path: 'networking.lte.connectionText',
        value: connectionType,
      });
      return getData(87, 16);
    })
    .then((data) => {
      const activeSim = Buffer.concat(data.slice(0, 15)).toString();
      switch (activeSim.slice(0, 4)) {
        case 'sim1': {
          return getData(185, 4)
        }
        case 'sim2': {
          return getData(300, 4)
        }
      }
    })
    .then((data) => {
      const tx = Buffer.concat([data[0], data[1]]).readUInt32BE();
      const rx = Buffer.concat([data[2], data[3]]).readUInt32BE();
      values.push({
        path: 'networking.lte.usage',
        value: tx + rx,
      });
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
  }
  plugin.stop = function stop() {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  plugin.schema = {
    type: 'object',
    properties: {
      ip: {
        type: 'string',
        default: '198.168.1.1',
        title: 'RUTX11 IP address',
      },
      port: {
        type: 'integer',
        default: 502,
        title: 'RUTX11 Modbus port (note: Modbus must be enabled on the router)',
      },
      interval: {
        type: 'integer',
        default: 60,
        title: 'How often to fetch the status (in seconds)',
      },
    },
  };
}

