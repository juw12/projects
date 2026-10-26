/* Sync voice — listening-party voice chat.
 *
 * Mesh of WebRTC audio calls between everyone who joined voice (the room
 * state's members[].voice flags tell each browser who to call). To avoid
 * double calls, only the member with the smaller peer ID dials. A small
 * analyser per stream detects who is speaking so the app can light up
 * avatars and duck the music. Best for up to ~8 people in voice. */
(function () {
  'use strict';

  var SPEAKING_LEVEL = 0.025;   // RMS threshold
  var SPEAKING_HOLD_MS = 450;   // keep "speaking" briefly after the level drops

  function Voice(room) {
    this.room = room;
    this.on = false;
    this.muted = false;
    this.stream = null;
    this.calls = new Map();     // peerId -> { call, audio, analyser, lastLoud }
    this.listeners = {};
    this.context = null;
    this.local = null;
    this.speaking = new Set();
    this.timer = null;
  }

  Voice.prototype.addListener = function (name, fn) {
    (this.listeners[name] = this.listeners[name] || []).push(fn);
  };

  Voice.prototype.emit = function (name, detail) {
    (this.listeners[name] || []).forEach(function (fn) { fn(detail); });
  };

  Voice.prototype.audioContext = function () {
    if (!this.context) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      this.context = Ctx ? new Ctx() : null;
    }
    if (this.context && this.context.state === 'suspended') {
      this.context.resume();
    }
    return this.context;
  };

  Voice.prototype.join = function () {
    var self = this;
    if (this.on) {
      return Promise.resolve();
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Voice chat needs a secure (https) page and a browser with microphone support.'));
    }
    this.audioContext(); // created inside the click gesture
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then(function (stream) {
      self.stream = stream;
      self.on = true;
      self.muted = false;
      self.local = self.makeAnalyser(stream);
      self.startMeter();
      self.room.intent({ type: 'voice', on: true });
      self.reconcile(self.room.state);
      self.emit('change');
    }, function (error) {
      throw new Error(error && error.name === 'NotAllowedError'
        ? 'Microphone permission was blocked. Allow it in the address bar to talk.'
        : 'Could not start your microphone.');
    });
  };

  Voice.prototype.leave = function () {
    if (!this.on) {
      return;
    }
    this.on = false;
    var self = this;
    this.calls.forEach(function (entry, peerId) {
      self.drop(peerId);
    });
    if (this.stream) {
      this.stream.getTracks().forEach(function (track) { track.stop(); });
    }
    this.stream = null;
    this.local = null;
    clearInterval(this.timer);
    this.timer = null;
    this.speaking.clear();
    this.room.intent({ type: 'voice', on: false });
    this.emit('speaking', this.speaking);
    this.emit('change');
  };

  Voice.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.stream) {
      this.stream.getAudioTracks().forEach(function (track) { track.enabled = !muted; });
    }
    this.emit('change');
  };

  // Called on every room state update: dial missing peers, drop departed ones.
  Voice.prototype.reconcile = function (state) {
    if (!state) {
      return;
    }
    var me = this.room.myId();
    var self = this;
    var wanted = new Set();
    if (this.on) {
      state.members.forEach(function (m) {
        if (m.voice && m.id !== me) {
          wanted.add(m.id);
        }
      });
    }
    this.calls.forEach(function (entry, peerId) {
      if (!wanted.has(peerId)) {
        self.drop(peerId);
      }
    });
    if (!this.on || !this.room.peer || this.room.peer.destroyed) {
      return;
    }
    wanted.forEach(function (peerId) {
      if (!self.calls.has(peerId) && me < peerId) {
        var call = self.room.peer.call(peerId, self.stream, { metadata: { kind: 'voice' } });
        if (call) {
          self.attach(call);
        }
      }
    });
    // Re-announce after a host migration reset our flag.
    var mine = state.members.filter(function (m) { return m.id === me; })[0];
    if (this.on && mine && !mine.voice) {
      this.room.intent({ type: 'voice', on: true });
    }
  };

  Voice.prototype.handleIncoming = function (call) {
    if (!this.on || !this.stream) {
      call.close();
      return;
    }
    if (this.calls.has(call.peer)) {
      this.drop(call.peer);
    }
    call.answer(this.stream);
    this.attach(call);
  };

  Voice.prototype.attach = function (call) {
    var self = this;
    var entry = { call: call, audio: null, analyser: null, lastLoud: 0 };
    this.calls.set(call.peer, entry);
    call.on('stream', function (remote) {
      if (self.calls.get(call.peer) !== entry) {
        return;
      }
      var audio = entry.audio || document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.srcObject = remote;
      audio.dataset.peer = call.peer;
      audio.className = 'voice-audio';
      document.body.appendChild(audio);
      audio.play().catch(function () {
        self.emit('needs-gesture');
      });
      entry.audio = audio;
      entry.analyser = self.makeAnalyser(remote);
      self.emit('change');
    });
    var cleanup = function () {
      if (self.calls.get(call.peer) === entry) {
        self.drop(call.peer);
      }
    };
    call.on('close', cleanup);
    call.on('error', cleanup);
  };

  Voice.prototype.drop = function (peerId) {
    var entry = this.calls.get(peerId);
    if (!entry) {
      return;
    }
    this.calls.delete(peerId);
    try {
      entry.call.close();
    } catch (error) {
      // already closed
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    this.speaking.delete(peerId);
    this.emit('change');
  };

  Voice.prototype.makeAnalyser = function (stream) {
    var ctx = this.audioContext();
    if (!ctx) {
      return null;
    }
    try {
      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return { analyser: analyser, data: new Float32Array(analyser.fftSize) };
    } catch (error) {
      return null;
    }
  };

  function level(meter) {
    if (!meter) {
      return 0;
    }
    meter.analyser.getFloatTimeDomainData(meter.data);
    var sum = 0;
    for (var i = 0; i < meter.data.length; i++) {
      sum += meter.data[i] * meter.data[i];
    }
    return Math.sqrt(sum / meter.data.length);
  }

  Voice.prototype.startMeter = function () {
    var self = this;
    clearInterval(this.timer);
    var localLoud = 0;
    this.timer = setInterval(function () {
      var now = performance.now();
      var next = new Set();
      self.calls.forEach(function (entry, peerId) {
        if (level(entry.analyser) > SPEAKING_LEVEL) {
          entry.lastLoud = now;
        }
        if (now - entry.lastLoud < SPEAKING_HOLD_MS) {
          next.add(peerId);
        }
      });
      if (!self.muted && level(self.local) > SPEAKING_LEVEL) {
        localLoud = now;
      }
      if (!self.muted && now - localLoud < SPEAKING_HOLD_MS) {
        next.add(self.room.myId());
      }
      var changed = next.size !== self.speaking.size;
      next.forEach(function (id) {
        if (!self.speaking.has(id)) {
          changed = true;
        }
      });
      if (changed) {
        self.speaking = next;
        self.emit('speaking', next);
      }
    }, 100);
  };

  // True when someone *else* is talking (used for ducking the music).
  Voice.prototype.othersSpeaking = function () {
    var me = this.room.myId();
    var any = false;
    this.speaking.forEach(function (id) {
      if (id !== me) {
        any = true;
      }
    });
    return any;
  };

  Voice.prototype.connectedPeers = function () {
    var out = [];
    this.calls.forEach(function (entry, peerId) {
      if (entry.audio) {
        out.push(peerId);
      }
    });
    return out;
  };

  window.SyncVoice = { Voice: Voice };
})();
