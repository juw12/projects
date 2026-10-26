'use strict';

const { publicPort, isAppUrl } = require('./security.cjs');

function createSerialChooser(session, getWindow) {
  let pending = null;

  function sendPorts() {
    if (!pending || pending.owner.isDestroyed()) return;
    pending.owner.send('airiz:serial-ports', {
      ports: [...pending.ports.values()].map(publicPort)
    });
  }

  function cancel() {
    if (!pending) return;
    const previous = pending;
    pending = null;
    previous.callback('');
  }

  function choose(owner, portId) {
    if (!pending || pending.owner !== owner) return false;
    if (portId !== '' && !pending.ports.has(portId)) return false;
    const request = pending;
    pending = null;
    request.callback(portId);
    return true;
  }

  session.on('select-serial-port', (event, ports, owner, callback) => {
    event.preventDefault();
    const window = getWindow();
    if (!window || owner !== window.webContents || !isAppUrl(owner.getURL())) {
      callback('');
      return;
    }
    cancel();
    pending = { owner, callback, ports: new Map(ports.map(port => [port.portId, port])) };
    sendPorts();
  });

  session.on('serial-port-added', (_event, port, owner) => {
    if (pending && pending.owner === owner) {
      pending.ports.set(port.portId, port);
      sendPorts();
    }
  });

  session.on('serial-port-removed', (_event, port, owner) => {
    if (pending && pending.owner === owner) {
      pending.ports.delete(port.portId);
      sendPorts();
    }
  });

  // Electron's default, per-WebContents grants are retained. No device is
  // auto-approved and no serial blocklist is disabled.
  return { choose, cancel, hasPending: () => !!pending };
}

module.exports = { createSerialChooser };
