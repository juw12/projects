/* Sync room — peer-to-peer networking (WebRTC via PeerJS).
 *
 * Topology: star. The host's browser owns the room state and relays chat,
 * reactions and shared files. Guests connect straight to the host; no server
 * ever sees the music, voice or messages. If the host leaves, the
 * longest-standing guest claims the room ID and everyone reconnects to them.
 *
 * Events (room.on(name, fn)): ready, state, chat, react, error, status,
 * file-progress, file-ready, call, not-found, code-taken, kicked. */
(function () {
  'use strict';

  var core = window.SyncCore;
  var config = window.SYNC_CONFIG || {};
  var ID_PREFIX = 'syncroom-v1-';
  var CHUNK_SIZE = 64 * 1024;
  var MAX_BUFFERED = 2 * 1024 * 1024;
  var PING_INTERVAL_MS = 3000;
  var TICK_INTERVAL_MS = 3000;
  // WebRTC can take 30 s+ to notice a peer that vanished (tab killed, lid
  // closed, Wi-Fi dropped). Heartbeats let us notice within seconds instead.
  var HOST_SILENCE_MS = 9000;
  var GUEST_SILENCE_MS = 15000;

  function hostPeerId(code) {
    return ID_PREFIX + code.toLowerCase();
  }

  function peerOptions() {
    var options = { config: { iceServers: config.iceServers || [] }, debug: 0 };
    if (config.peerServer) {
      Object.keys(config.peerServer).forEach(function (key) {
        options[key] = config.peerServer[key];
      });
    }
    return options;
  }

  function toArrayBuffer(data) {
    if (data instanceof ArrayBuffer) {
      return data;
    }
    if (ArrayBuffer.isView(data)) {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    return null;
  }

  var CLAIM_TRIES_BEFORE_PROBE = 1; // a taken host ID usually means the host is alive: check right away
  var PROBE_MS = 6000;              // how long a guest probe may take before claiming again
  var PENDING_CONNECT_MS = 5000;    // one host connection attempt in flight at a time

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function Room(options) {
    this.code = options.code;
    this.name = options.name || 'Guest';
    this.wantsHost = !!options.create;
    this.listeners = {};
    this.state = null;
    this.isHost = false;
    this.offset = 0;            // host clock - local clock (ms)
    this.samples = [];
    this.peer = null;
    this.guests = new Map();    // host: peerId -> DataConnection
    this.hostConn = null;       // guest: DataConnection to host (control)
    this.filesConn = null;      // guest: second DataConnection for file transfer
    this.fileConns = new Map(); // host: peerId -> file DataConnection
    this.lastHeard = 0;         // guest: performance.now() of last host message
    this.guestSeen = new Map(); // host: peerId -> performance.now() of last message
    this.files = new Map();     // fileId -> { meta, blob, url, chunks, received }
    this.uploadsToHost = new Map();
    this.closed = false;
    this.everConnected = false;
    this.migrating = false;
    this.timers = [];
  }

  Room.prototype.on = function (name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
    return this;
  };

  Room.prototype.emit = function (name, detail) {
    (this.listeners[name] || []).forEach(function (fn) {
      try {
        fn(detail);
      } catch (error) {
        console.error(error);
      }
    });
  };

  Room.prototype.hostNow = function () {
    return Date.now() + this.offset;
  };

  Room.prototype.myId = function () {
    return this.peer && this.peer.id;
  };

  Room.prototype.start = function () {
    if (this.wantsHost) {
      this.becomeHost(null);
    } else {
      this.joinAsGuest();
    }
  };

  /* ================= host ================= */

  Room.prototype.becomeHost = function (previousState, attempt) {
    var self = this;
    var peer = new window.Peer(hostPeerId(this.code), peerOptions());
    this.peer = peer;
    peer.on('open', function (id) {
      self.isHost = true;
      self.offset = 0;
      self.migrating = false;
      if (previousState) {
        var me = { id: id, name: self.name, joinedAt: Date.now(), voice: false };
        self.state = core.rebaseState(previousState, id, self.lastOffset || 0, [me]);
      } else {
        self.state = core.initialState(id, self.name, Date.now());
      }
      self.emit('status', { level: 'good', text: 'Hosting' });
      self.emit('ready', { host: true, code: self.code });
      self.emit('state', self.state);
      self.startHostTimers();
    });
    peer.on('connection', function (conn) {
      self.acceptGuest(conn);
    });
    peer.on('call', function (call) {
      self.emit('call', call);
    });
    peer.on('disconnected', function () {
      // Lost the signaling server only; open peer links keep working.
      if (!self.closed && !peer.destroyed) {
        setTimeout(function () {
          if (!peer.destroyed) {
            peer.reconnect();
          }
        }, 2000);
      }
    });
    peer.on('error', function (error) {
      if (error.type === 'unavailable-id') {
        peer.destroy();
        if (previousState) {
          // The old host's ID is still registered. Usually it frees up within seconds,
          // but if it stays taken the host may still be there and only *our* link dropped
          // (phone slept, Wi-Fi -> mobile data). Then rejoin as a guest instead.
          if ((attempt || 1) >= CLAIM_TRIES_BEFORE_PROBE) {
            self.probeHostThenClaim(previousState, attempt || 1);
          } else {
            self.retryClaim(previousState, attempt || 1);
          }
        } else {
          self.emit('code-taken', self.code);
        }
        return;
      }
      if (previousState && !self.isHost) {
        peer.destroy();
        self.retryClaim(previousState, attempt || 1);
        return;
      }
      self.emit('error', self.describeError(error));
    });
  };

  Room.prototype.startHostTimers = function () {
    var self = this;
    this.clearTimers();
    this.timers.push(setInterval(function () {
      self.broadcast({ t: 'tick', v: self.state.v, hostNow: Date.now() });
      var now = performance.now();
      self.guests.forEach(function (conn, peerId) {
        if (now - (self.guestSeen.get(peerId) || now) > GUEST_SILENCE_MS) {
          self.dropGuest(peerId, conn);
        }
      });
    }, TICK_INTERVAL_MS));
  };

  Room.prototype.dropGuest = function (peerId, conn) {
    if (this.guests.get(peerId) !== conn) {
      return;
    }
    this.guests.delete(peerId);
    this.guestSeen.delete(peerId);
    var files = this.fileConns.get(peerId);
    if (files) {
      this.fileConns.delete(peerId);
      try {
        files.close();
      } catch (error) {
        // already closed
      }
    }
    try {
      conn.close();
    } catch (error) {
      // already closed
    }
    this.apply({ type: 'leave', id: peerId }, this.myId());
  };

  Room.prototype.acceptGuest = function (conn) {
    var self = this;
    // File transfers get their own channel so large uploads never delay
    // clock pings or playback commands queued behind them.
    if (conn.metadata && conn.metadata.kind === 'files') {
      conn.on('open', function () {
        self.fileConns.set(conn.peer, conn);
      });
      conn.on('data', function (message) {
        self.onHostMessage(conn, message);
      });
      conn.on('close', function () {
        if (self.fileConns.get(conn.peer) === conn) {
          self.fileConns.delete(conn.peer);
        }
      });
      return;
    }
    conn.on('open', function () {
      self.guests.set(conn.peer, conn);
      self.guestSeen.set(conn.peer, performance.now());
    });
    conn.on('data', function (message) {
      self.guestSeen.set(conn.peer, performance.now());
      self.onHostMessage(conn, message);
    });
    var gone = function () {
      self.dropGuest(conn.peer, conn);
    };
    conn.on('close', gone);
    conn.on('error', gone);
  };

  Room.prototype.onHostMessage = function (conn, msg) {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    switch (msg.t) {
      case 'hello': {
        var joined = this.apply({ type: 'join', member: { id: conn.peer, name: msg.name } }, conn.peer);
        if (joined.error) {
          this.send(conn, { t: 'error', message: joined.error });
          setTimeout(function () { conn.close(); }, 500);
          return;
        }
        this.send(conn, { t: 'welcome', state: this.state, hostNow: Date.now() });
        break;
      }
      case 'ping':
        this.send(conn, { t: 'pong', sent: msg.sent, remote: Date.now() });
        break;
      case 'need-state':
        this.send(conn, { t: 'state', state: this.state });
        break;
      case 'intent': {
        var result = this.apply(msg.intent, conn.peer);
        if (result.error) {
          this.send(conn, { t: 'error', message: result.error });
        }
        break;
      }
      case 'chat':
      case 'react':
        this.relaySocial(msg, conn.peer);
        break;
      case 'file-meta':
      case 'file-chunk':
        this.receiveFilePart(msg);
        break;
      case 'file-request':
        this.sendFile(conn, msg.fileId);
        break;
      default:
        break;
    }
  };

  Room.prototype.apply = function (intent, actor) {
    var result = core.reduce(this.state, intent, { now: Date.now(), actor: actor });
    if (result.changed) {
      this.state = result.state;
      this.broadcast({ t: 'state', state: this.state });
      this.emit('state', this.state);
    }
    return result;
  };

  Room.prototype.broadcast = function (message) {
    var self = this;
    this.guests.forEach(function (conn) {
      self.send(conn, message);
    });
  };

  Room.prototype.relaySocial = function (msg, fromId) {
    var name = '';
    this.state.members.forEach(function (m) {
      if (m.id === fromId) {
        name = m.name;
      }
    });
    var out = msg.t === 'chat'
      ? { t: 'chat', from: fromId, name: name || 'Guest', text: String(msg.text || '').slice(0, 500), at: Date.now() }
      : { t: 'react', from: fromId, name: name || 'Guest', emoji: String(msg.emoji || '').slice(0, 8) };
    if (out.t === 'chat' && !out.text.trim()) {
      return;
    }
    this.broadcast(out);
    this.emit(out.t, out);
  };

  /* ================= guest ================= */

  Room.prototype.joinAsGuest = function () {
    var self = this;
    var guestId = ID_PREFIX + this.code.toLowerCase() + '-' + Math.random().toString(36).slice(2, 10);
    var peer = new window.Peer(guestId, peerOptions());
    this.peer = peer;
    this.isHost = false;
    peer.on('open', function () {
      self.connectToHost();
    });
    peer.on('call', function (call) {
      self.emit('call', call);
    });
    peer.on('disconnected', function () {
      if (!self.closed && !peer.destroyed) {
        setTimeout(function () {
          if (!peer.destroyed) {
            peer.reconnect();
          }
        }, 2000);
      }
    });
    peer.on('error', function (error) {
      if (error.type === 'peer-unavailable') {
        if (!self.everConnected) {
          self.emit('not-found', self.code);
        }
        return; // during migration we keep retrying
      }
      self.emit('error', self.describeError(error));
    });
  };

  Room.prototype.connectToHost = function () {
    var self = this;
    if (this.closed || !this.peer || this.peer.destroyed) {
      return;
    }
    if (this.pendingConn && performance.now() - this.pendingAt < PENDING_CONNECT_MS) {
      return; // an attempt is still in flight
    }
    var conn = this.peer.connect(hostPeerId(this.code), { reliable: true });
    this.pendingConn = conn;
    this.pendingAt = performance.now();
    conn.on('open', function () {
      if (self.pendingConn === conn) {
        self.pendingConn = null;
      }
      if (self.hostConn && self.hostConn !== conn) {
        conn.close(); // a newer link already won
        return;
      }
      self.claimProbe = null;
      self.hostConn = conn;
      self.everConnected = true;
      self.migrating = false;
      self.lastHeard = performance.now();
      self.send(conn, { t: 'hello', name: self.name });
      self.emit('status', { level: 'good', text: 'Connected' });
      self.syncClock();
      self.openFilesChannel();
    });
    conn.on('data', function (msg) {
      self.lastHeard = performance.now();
      self.onGuestMessage(msg);
    });
    conn.on('close', function () {
      if (self.pendingConn === conn) {
        self.pendingConn = null;
      }
      if (self.hostConn === conn) {
        self.hostConn = null;
        self.onHostLost();
      }
    });
    conn.on('error', function () {
      if (self.pendingConn === conn) {
        self.pendingConn = null;
      }
      if (self.hostConn === conn) {
        self.hostConn = null;
        self.onHostLost();
      }
    });
  };

  Room.prototype.openFilesChannel = function () {
    var self = this;
    var files = this.peer.connect(hostPeerId(this.code), { reliable: true, metadata: { kind: 'files' } });
    files.on('open', function () {
      self.filesConn = files;
      if (self.pendingFileRequests) {
        self.pendingFileRequests.forEach(function (fileId) {
          self.send(files, { t: 'file-request', fileId: fileId });
        });
        self.pendingFileRequests = null;
      }
    });
    files.on('data', function (msg) {
      self.lastHeard = performance.now();
      self.onGuestMessage(msg);
    });
    files.on('close', function () {
      if (self.filesConn === files) {
        self.filesConn = null;
      }
    });
  };

  // Guest side: the channel to use for file traffic.
  Room.prototype.fileChannel = function () {
    if (this.filesConn && this.filesConn.open) {
      return this.filesConn;
    }
    return this.hostConn;
  };

  Room.prototype.syncClock = function () {
    var self = this;
    this.clearTimers();
    this.samples = [];
    var burst = 0;
    var ping = function () {
      if (self.hostConn) {
        self.send(self.hostConn, { t: 'ping', sent: Date.now() });
      }
    };
    var burstTimer = setInterval(function () {
      ping();
      burst += 1;
      if (burst >= 8) {
        clearInterval(burstTimer);
      }
    }, 120);
    this.timers.push(burstTimer);
    this.timers.push(setInterval(function () {
      if (self.hostConn && performance.now() - self.lastHeard > HOST_SILENCE_MS) {
        var silent = self.hostConn;
        self.hostConn = null;
        try {
          silent.close();
        } catch (error) {
          // already closed
        }
        if (self.filesConn) {
          try {
            self.filesConn.close();
          } catch (error) {
            // already closed
          }
          self.filesConn = null;
        }
        self.onHostLost();
        return;
      }
      ping();
    }, PING_INTERVAL_MS));
  };

  Room.prototype.onGuestMessage = function (msg) {
    if (!msg || typeof msg !== 'object') {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        if (!this.samples.length && msg.hostNow) {
          this.offset = msg.hostNow - Date.now(); // rough until pings arrive
        }
        this.setState(msg.state);
        this.emit('ready', { host: false, code: this.code });
        break;
      case 'state':
        this.setState(msg.state);
        break;
      case 'tick':
        if (!this.state || msg.v !== this.state.v) {
          this.send(this.hostConn, { t: 'need-state' });
        }
        break;
      case 'pong': {
        this.samples.push({ sent: msg.sent, received: Date.now(), remote: msg.remote });
        if (this.samples.length > 16) {
          this.samples.shift();
        }
        var estimate = core.estimateOffset(this.samples);
        if (estimate) {
          this.offset = estimate.offset;
          this.rtt = estimate.rtt;
        }
        break;
      }
      case 'chat':
      case 'react':
        this.emit(msg.t, msg);
        break;
      case 'error':
        this.emit('error', msg.message);
        break;
      case 'file-meta':
      case 'file-chunk':
        this.receiveFilePart(msg);
        break;
      case 'file-missing':
        this.emit('error', 'The host no longer has “' + (msg.name || 'that file') + '”. Ask whoever added it to re-share.');
        break;
      default:
        break;
    }
  };

  Room.prototype.setState = function (state) {
    if (!state || (this.state && state.v < this.state.v && state.hostId === this.state.hostId)) {
      return;
    }
    this.state = state;
    this.emit('state', state);
  };

  Room.prototype.onHostLost = function () {
    if (this.closed || this.migrating) {
      return;
    }
    this.migrating = true;
    this.clearTimers();
    this.pendingFileRequests = null;
    var self = this;
    this.files.forEach(function (entry, fileId) {
      if (!entry.url) {
        self.files.delete(fileId);
      }
    });
    var last = this.state;
    if (!last) {
      this.emit('status', { level: 'bad', text: 'Host left' });
      return;
    }
    var next = core.successor(last, last.hostId);
    this.emit('status', { level: 'warn', text: 'Host left — reconnecting…' });
    if (next === this.myId()) {
      this.lastOffset = this.offset;
      var oldPeer = this.peer;
      this.peer = null;
      oldPeer.destroy();
      this.retryClaim(last, 0);
    } else {
      this.retryConnect(0);
    }
  };

  Room.prototype.retryClaim = function (previousState, attempt) {
    var self = this;
    var tries = attempt || 0;
    if (this.closed) {
      return;
    }
    if (tries > 20) {
      this.migrating = false; // let resume() rejoin as a guest later
      this.emit('status', { level: 'bad', text: 'Could not take over the room' });
      return;
    }
    setTimeout(function () {
      if (!self.closed) {
        self.becomeHost(previousState, tries + 1);
      }
    }, tries === 0 ? 300 : 1500);
  };

  Room.prototype.retryConnect = function (attempt) {
    var self = this;
    if (!attempt) {
      this.retryToken = (this.retryToken || 0) + 1; // a fresh loop replaces any older one
    }
    var token = this.retryToken;
    if (this.closed || this.hostConn) {
      return;
    }
    if (attempt > 25) {
      this.emit('status', { level: 'bad', text: 'Room closed' });
      return;
    }
    setTimeout(function () {
      if (token === self.retryToken && !self.hostConn && !self.closed) {
        self.connectToHost();
        self.retryConnect(attempt + 1);
      }
    }, 2000);
  };

  // Our claim on the host ID keeps failing: try to reach the room as a guest first.
  Room.prototype.probeHostThenClaim = function (previousState, attempt) {
    var self = this;
    if (this.closed) {
      return;
    }
    this.claimProbe = { state: previousState, attempt: attempt };
    this.emit('status', { level: 'warn', text: 'Reconnecting…' });
    this.joinAsGuest();
    setTimeout(function () {
      var probe = self.claimProbe;
      if (self.closed || self.hostConn || !probe) {
        return;
      }
      self.claimProbe = null;
      if (self.peer) {
        self.peer.destroy();
        self.peer = null;
      }
      self.retryClaim(probe.state, probe.attempt);
    }, PROBE_MS);
  };

  // Called when the app comes back to the foreground or the network returns.
  Room.prototype.resume = function () {
    if (this.closed) {
      return;
    }
    var peer = this.peer;
    if (peer && !peer.destroyed && peer.disconnected) {
      try {
        peer.reconnect(); // signaling only; open WebRTC links keep working
      } catch (error) {
        // reconnect throws if the peer was destroyed meanwhile
      }
    }
    if (this.isHost || this.hostConn || this.claimProbe) {
      return;
    }
    if (this.migrating && !peer) {
      return; // we are claiming the host ID right now
    }
    if (!peer || peer.destroyed) {
      this.joinAsGuest();
    } else {
      this.connectToHost();
    }
    this.retryConnect(0);
  };

  /* ================= actions (both roles) ================= */

  Room.prototype.intent = function (intent) {
    if (this.isHost) {
      var result = this.apply(intent, this.myId());
      if (result.error) {
        this.emit('error', result.error);
      }
      return;
    }
    if (!this.hostConn) {
      this.emit('error', 'Not connected to the room yet.');
      return;
    }
    this.send(this.hostConn, { t: 'intent', intent: intent });
  };

  Room.prototype.chat = function (text) {
    var clean = String(text || '').trim().slice(0, 500);
    if (!clean) {
      return;
    }
    if (this.isHost) {
      this.relaySocial({ t: 'chat', text: clean }, this.myId());
    } else if (this.hostConn) {
      this.send(this.hostConn, { t: 'chat', text: clean });
    }
  };

  Room.prototype.react = function (emoji) {
    if (this.isHost) {
      this.relaySocial({ t: 'react', emoji: emoji }, this.myId());
    } else if (this.hostConn) {
      this.send(this.hostConn, { t: 'react', emoji: emoji });
    }
  };

  Room.prototype.send = function (conn, message) {
    if (conn && conn.open) {
      try {
        conn.send(message);
      } catch (error) {
        console.warn('send failed', error);
      }
    }
  };

  /* ================= files (peer-to-peer) ================= */

  Room.prototype.fileUrl = function (fileId) {
    var entry = this.files.get(fileId);
    return entry && entry.url ? entry.url : null;
  };

  Room.prototype.fileProgress = function (fileId) {
    var entry = this.files.get(fileId);
    if (!entry) {
      return 0;
    }
    if (entry.url) {
      return 1;
    }
    return entry.meta.total ? entry.received / entry.meta.total : 0;
  };

  // Share a local File with the room. Resolves with the track source descriptor.
  Room.prototype.shareFile = function (file) {
    var self = this;
    var meta = {
      fileId: core.makeId('f'),
      name: file.name,
      size: file.size,
      mime: file.type || 'audio/mpeg',
      total: Math.ceil(file.size / CHUNK_SIZE),
    };
    var url = URL.createObjectURL(file);
    this.files.set(meta.fileId, { meta: meta, blob: file, url: url, chunks: null, received: meta.total });
    var source = { fileId: meta.fileId, name: meta.name, size: meta.size, mime: meta.mime };
    if (this.isHost) {
      return Promise.resolve(source);
    }
    // Guests upload to the host first so it can serve everyone else.
    return this.streamFile(this.fileChannel(), meta.fileId).then(function () {
      return source;
    });
  };

  Room.prototype.requestFile = function (fileId) {
    if (this.files.has(fileId) || this.isHost || !this.hostConn) {
      return;
    }
    this.files.set(fileId, { meta: { fileId: fileId, total: 0 }, chunks: [], received: 0, url: null });
    if (this.filesConn && this.filesConn.open) {
      this.send(this.filesConn, { t: 'file-request', fileId: fileId });
    } else {
      // Files channel still opening: ask as soon as it is ready.
      this.pendingFileRequests = (this.pendingFileRequests || []).concat([fileId]);
    }
  };

  Room.prototype.sendFile = function (conn, fileId) {
    var entry = this.files.get(fileId);
    if (!entry || !entry.blob) {
      var name = '';
      (this.state ? this.state.queue : []).forEach(function (t) {
        if (t.sources.file && t.sources.file.fileId === fileId) {
          name = t.sources.file.name;
        }
      });
      this.send(conn, { t: 'file-missing', fileId: fileId, name: name });
      return;
    }
    this.streamFile(conn, fileId);
  };

  Room.prototype.streamFile = function (conn, fileId) {
    var self = this;
    var entry = this.files.get(fileId);
    if (!conn || !entry || !entry.blob) {
      return Promise.reject(new Error('Cannot send that file right now.'));
    }
    var meta = entry.meta;
    this.send(conn, { t: 'file-meta', fileId: fileId, name: meta.name, size: meta.size, mime: meta.mime, total: meta.total });
    var seq = 0;
    var next = function () {
      if (seq >= meta.total) {
        return Promise.resolve();
      }
      if (!conn.open) {
        return Promise.reject(new Error('Connection closed while sending.'));
      }
      var channel = conn.dataChannel;
      if (channel && channel.bufferedAmount > MAX_BUFFERED) {
        return wait(30).then(next);
      }
      var start = seq * CHUNK_SIZE;
      return entry.blob.slice(start, start + CHUNK_SIZE).arrayBuffer().then(function (buffer) {
        self.send(conn, { t: 'file-chunk', fileId: fileId, seq: seq, data: buffer });
        seq += 1;
        if (seq % 16 === 0) {
          self.emit('file-progress', { fileId: fileId, progress: seq / meta.total, direction: 'up' });
        }
        return next();
      });
    };
    return next();
  };

  Room.prototype.receiveFilePart = function (msg) {
    var entry = this.files.get(msg.fileId);
    if (msg.t === 'file-meta') {
      if (entry && entry.url) {
        return; // already have it
      }
      entry = { meta: msg, chunks: new Array(msg.total), received: 0, url: null };
      this.files.set(msg.fileId, entry);
      if (msg.total === 0) {
        this.finishFile(entry);
      }
      return;
    }
    if (!entry || entry.url || !entry.chunks) {
      return;
    }
    var buffer = toArrayBuffer(msg.data);
    if (!buffer || entry.chunks[msg.seq]) {
      return;
    }
    entry.chunks[msg.seq] = buffer;
    entry.received += 1;
    if (entry.received % 16 === 0) {
      this.emit('file-progress', { fileId: msg.fileId, progress: entry.received / entry.meta.total, direction: 'down' });
    }
    if (entry.received >= entry.meta.total) {
      this.finishFile(entry);
    }
  };

  Room.prototype.finishFile = function (entry) {
    entry.blob = new Blob(entry.chunks, { type: entry.meta.mime || 'audio/mpeg' });
    entry.chunks = null;
    entry.url = URL.createObjectURL(entry.blob);
    this.emit('file-ready', { fileId: entry.meta.fileId });
  };

  /* ================= lifecycle ================= */

  Room.prototype.describeError = function (error) {
    var map = {
      'browser-incompatible': 'This browser does not support live rooms. Try Chrome, Safari, Edge or Firefox.',
      network: 'Lost connection to the matchmaking server. Retrying…',
      'server-error': 'The matchmaking server is having trouble. Try again in a minute.',
      'socket-error': 'Lost connection to the matchmaking server. Retrying…',
      'socket-closed': 'Lost connection to the matchmaking server. Retrying…',
      webrtc: 'A direct connection could not be made (strict network). Try another network or add a TURN relay in config.js.',
    };
    return map[error.type] || (error.message || 'Connection problem.');
  };

  Room.prototype.clearTimers = function () {
    this.timers.forEach(function (timer) { clearInterval(timer); });
    this.timers = [];
  };

  Room.prototype.leave = function () {
    this.closed = true;
    this.clearTimers();
    if (this.peer) {
      this.peer.destroy();
    }
    this.files.forEach(function (entry) {
      if (entry.url) {
        URL.revokeObjectURL(entry.url);
      }
    });
  };

  window.SyncRoom = { Room: Room, hostPeerId: hostPeerId };
})();
