/* AIRIZ Console 1.10.0 - Talk & listen.
 *
 * Talk:   hold the button and speak (phone or PC microphone). The message goes to the AIRIZ
 *         speaker a few seconds later: it is sent over the 115200-baud USB console first,
 *         turned back into a WAV on the AIRIZ, then played.
 * Listen: the AIRIZ microphone records clips one after the other and sends them as text;
 *         this page plays them about a clip length + 2 s behind live, with a short gap between
 *         clips. The clip length is a setting (1 s up to an hour since 1.11.2).
 * The PC that has the AIRIZ on USB does the device work for everyone. Phones that control it
 * by code send their messages to that PC and get the sound from it (remote-control.js, v3).
 * Demo mode simulates the AIRIZ so everything can be tried without hardware.
 */
(function () {
  'use strict';

  const api = window.AirizConsole;
  const core = window.AirizAudioLink;
  if (!api || !core) return;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const remote = () => window.AirizRemoteControl || null;
  const SETTINGS_KEY = 'airiz.voice.v1';
  // 1.11.2: the listen clip length is up to the user (seconds; the AIRIZ checks its memory).
  const MIN_CLIP = core.MIN_LISTEN_SECONDS || 1;
  const MAX_CLIP = core.MAX_LISTEN_SECONDS || 4;
  const DEFAULTS = Object.freeze({
    speaker: 80,
    gain: 80,
    clip: 2,
    format: 'stereo16',
    record: core.DEFAULT_RECORD_COMMAND,
    play: core.DEFAULT_PLAY_COMMAND,
    volume: 100,
  });

  class VoiceError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  // ------------------------------------------------------------------ settings
  function loadSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (ignored) {
      saved = {};
    }
    const settings = Object.assign({}, DEFAULTS, saved);
    settings.speaker = clamp(settings.speaker, 0, 100, DEFAULTS.speaker);
    settings.gain = clamp(settings.gain, 1, 100, DEFAULTS.gain);
    settings.clip = clamp(settings.clip, MIN_CLIP, MAX_CLIP, DEFAULTS.clip);
    settings.volume = clamp(settings.volume, 0, 300, DEFAULTS.volume);
    if (!core.FORMATS[settings.format]) settings.format = DEFAULTS.format;
    settings.record = core.recordTemplate(settings.record);
    if (typeof settings.play !== 'string' || !settings.play.trim()) settings.play = DEFAULTS.play;
    return settings;
  }

  function clamp(value, low, high, fallback) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
  }

  let settings = loadSettings();

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (ignored) { /* private mode */ }
  }

  // ------------------------------------------------------------------ where we are
  // usb: this PC has the AIRIZ on USB. remote: this device controls a PC by code.
  function currentMode() {
    const status = api.getStatus();
    if (!status.connected) {
      return { kind: 'off', reason: 'Connect the AIRIZ by USB, or control it by code, to talk and listen.' };
    }
    if (status.demoMode) return { kind: 'demo' };
    const label = String(status.transportLabel || '');
    if (/^Remote/.test(label)) {
      const peer = remote() && remote().voicePeer;
      if (!peer) return { kind: 'off', reason: 'Waiting for the PC…' };
      if (peer.pcVersion < 3) {
        return { kind: 'off', reason: 'The PC runs an older AIRIZ Console. Update it to 1.10 or later for talk and listen.' };
      }
      return { kind: 'remote' };
    }
    if (window.airizMobile || /^Bluetooth/.test(label)) {
      return { kind: 'off', reason: 'Talk and listen need the AIRIZ on USB (on this PC, or on the PC you control by code).' };
    }
    return { kind: 'usb' };
  }

  // ------------------------------------------------------------------ UI
  const ui = {
    card: $('voice-card'),
    talk: $('voice-talk'),
    listen: $('voice-listen'),
    status: $('voice-status'),
    meter: $('voice-meter'),
    progress: $('voice-progress'),
    replay: $('voice-replay'),
    volume: $('voice-volume'),
    settings: $('voice-settings'),
    speaker: $('voice-speaker'),
    gain: $('voice-gain'),
    clip: $('voice-clip'),
    format: $('voice-format'),
    record: $('voice-record-command'),
    play: $('voice-play-command'),
  };
  if (!ui.card || !ui.talk || !ui.listen) return;

  const view = {
    mode: { kind: 'off' },
    caps: null,          // phone: what the PC can do
    recording: false,
    talkBusy: false,
    listening: false,    // this device plays the AIRIZ microphone
    listenState: 'off',
    message: '',
  };

  function setStatus(text) {
    view.message = text;
    if (ui.status) ui.status.textContent = text;
  }

  function setProgress(fraction) {
    if (!ui.progress) return;
    if (fraction == null) {
      ui.progress.hidden = true;
      return;
    }
    ui.progress.hidden = false;
    const bar = ui.progress.firstElementChild;
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
  }

  function setMeter(level) {
    const bar = ui.meter && ui.meter.firstElementChild;
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, level)) * 100) + '%';
  }

  function canTalk() {
    const kind = view.mode.kind;
    if (kind === 'usb' || kind === 'demo') return true;
    return kind === 'remote' && !!(view.caps && view.caps.talk);
  }

  function canListen() {
    const kind = view.mode.kind;
    if (kind === 'usb' || kind === 'demo') return true;
    return kind === 'remote' && !!(view.caps && view.caps.listen);
  }

  function render() {
    const host = view.mode.kind === 'usb' || view.mode.kind === 'demo';
    ui.card.dataset.mode = view.mode.kind;
    ui.talk.disabled = !canTalk() || (view.talkBusy && !view.recording);
    ui.talk.classList.toggle('is-recording', view.recording);
    ui.talk.textContent = view.recording ? 'Release to send' : 'Hold to talk';
    ui.listen.disabled = !canListen() && !view.listening;
    ui.listen.setAttribute('aria-pressed', String(view.listening));
    ui.listen.textContent = view.listening ? 'Stop listening' : 'Listen';
    ui.listen.classList.toggle('is-on', view.listening);
    if (ui.replay) ui.replay.disabled = !canTalk() || view.talkBusy || !(host ? hostState.lastTalk : view.caps && view.caps.replay);
    if (ui.settings) ui.settings.hidden = view.mode.kind === 'remote';
    if (!view.recording && !view.talkBusy && !view.listening && view.mode.kind === 'off') setStatus(view.mode.reason || '');
  }

  // ------------------------------------------------------------------ playback (listen)
  let audioContext = null;
  const MAX_BEHIND_SECONDS = 5;
  const BLOCK_SECONDS = core.BLOCK_SAMPLES / core.RATE;

  function context() {
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new VoiceError('no-audio', 'This browser cannot play sound here.');
      audioContext = new Context();
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  }

  function createPlayer() {
    const ctx = context();
    const gain = ctx.createGain();
    gain.gain.value = settings.volume / 100;
    gain.connect(ctx.destination);
    let resampler = core.createStreamResampler(core.RATE, ctx.sampleRate);
    let lastSeg = -1;
    let lastBlk = -1;
    let nextTime = 0;
    let target = 0.45;
    let sources = new Set();
    let stopped = false;
    let ducked = false;
    let underruns = 0;
    let dropped = 0;
    // Longest clip seen so far: a clip comes in faster than real time once it has been
    // recorded, so up to a whole clip may wait to be played (1.11.2: clips of any length).
    let longestClip = 0;
    function schedule(samples) {
      if (!samples.length || stopped) return;
      const now = ctx.currentTime;
      if (nextTime < now + 0.03) {
        if (nextTime > 0) underruns++;
        nextTime = now + target;
      }
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel ? buffer.copyToChannel(samples, 0) : buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => sources.delete(source);
      source.start(nextTime);
      sources.add(source);
      nextTime += samples.length / ctx.sampleRate;
    }
    return {
      push(frame) {
        if (stopped) return;
        longestClip = Math.max(longestClip, (frame.blk + 1) * BLOCK_SECONDS);
        if (nextTime - ctx.currentTime > MAX_BEHIND_SECONDS + longestClip) {
          // a burst of old sound (the PC or the network was busy): drop it to stay near live
          dropped++;
          resampler.reset();
          lastSeg = -1;
          return;
        }
        const contiguous = frame.seg === lastSeg && frame.blk === lastBlk + 1;
        if (!contiguous && lastSeg !== -1) schedule(resampler.flush());
        lastSeg = frame.seg;
        lastBlk = frame.blk;
        const decoded = core.decodeFrame(frame);
        stats.framesPlayed++;
        let sum = 0;
        for (let i = 0; i < decoded.length; i++) sum += decoded[i] * decoded[i];
        setMeter(Math.min(1, Math.sqrt(sum / decoded.length) / 6000));
        schedule(resampler.process(core.toFloat(decoded)));
      },
      setVolume(value) {
        gain.gain.value = ducked ? 0 : value / 100;
      },
      duck(on) {
        ducked = !!on;
        gain.gain.value = ducked ? 0 : settings.volume / 100;
      },
      get behind() {
        return Math.max(0, nextTime - ctx.currentTime);
      },
      get underruns() {
        return underruns;
      },
      get dropped() {
        return dropped;
      },
      stop() {
        stopped = true;
        for (const source of sources) {
          try {
            source.stop();
          } catch (ignored) { /* already ended */ }
        }
        sources = new Set();
        try {
          gain.disconnect();
        } catch (ignored) { /* gone */ }
        resampler.reset();
        setMeter(0);
      },
    };
  }

  let player = null;
  const stats = { framesIn: 0, framesPlayed: 0, forwarded: 0 };

  // play a whole message (demo AIRIZ speaker)
  function playSamples(samples, rate) {
    const ctx = context();
    const data = core.resample(core.toFloat(samples), rate, ctx.sampleRate);
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = settings.speaker / 100;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    return new Promise(resolve => {
      source.onended = resolve;
      setTimeout(resolve, (data.length / ctx.sampleRate) * 1000 + 500);
    });
  }

  // ------------------------------------------------------------------ microphone (talk)
  const recorder = { stream: null, node: null, source: null, chunks: [], rate: 48000, started: 0, timer: null, cancelled: false, starting: false };

  async function startRecording() {
    if (recorder.stream || recorder.starting) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new VoiceError('no-mic', 'This browser cannot use the microphone here (it needs https or the Windows app).');
    }
    recorder.starting = true;
    try {
      const ctx = context();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      if (!recorder.starting) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      recorder.stream = stream;
      recorder.chunks = [];
      recorder.rate = ctx.sampleRate;
      recorder.cancelled = false;
      recorder.source = ctx.createMediaStreamSource(stream);
      recorder.node = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      recorder.node.onaudioprocess = event => {
        const input = event.inputBuffer.getChannelData(0);
        recorder.chunks.push(new Float32Array(input));
        let peak = 0;
        for (let i = 0; i < input.length; i += 8) peak = Math.max(peak, Math.abs(input[i]));
        setMeter(Math.min(1, peak * 1.4));
      };
      recorder.source.connect(recorder.node);
      recorder.node.connect(mute);
      mute.connect(ctx.destination);
      recorder.started = Date.now();
      view.recording = true;
      if (player) player.duck(true);
      render();
      recorder.timer = setInterval(() => {
        const seconds = (Date.now() - recorder.started) / 1000;
        setStatus('Recording… ' + seconds.toFixed(1) + ' s of ' + core.MAX_TALK_SECONDS + ' s. Release to send.');
        setProgress(seconds / core.MAX_TALK_SECONDS);
        if (seconds >= core.MAX_TALK_SECONDS) finishRecording(false);
      }, 100);
    } finally {
      recorder.starting = false;
    }
  }

  function stopTracks() {
    clearInterval(recorder.timer);
    recorder.timer = null;
    if (recorder.node) {
      recorder.node.onaudioprocess = null;
      try {
        recorder.node.disconnect();
      } catch (ignored) { /* gone */ }
    }
    if (recorder.source) {
      try {
        recorder.source.disconnect();
      } catch (ignored) { /* gone */ }
    }
    if (recorder.stream) recorder.stream.getTracks().forEach(track => track.stop());
    recorder.stream = null;
    recorder.node = null;
    recorder.source = null;
    view.recording = false;
    if (player) player.duck(false);
    setMeter(0);
  }

  // Turn the recording into a message: 8 kHz, cleaned up, IMA ADPCM.
  function buildMessage(chunks, rate) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const all = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const voice = core.prepareVoice(core.resample(all, rate, core.RATE));
    if (voice.silent || voice.samples.length < core.RATE * 0.2) return null;
    const bytes = core.encodeAdpcm(voice.samples);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      samples: voice.samples.length,
      seconds: voice.samples.length / core.RATE,
      bytes,
      base64: core.bytesToBase64(bytes),
      md5: core.md5Hex(bytes),
    };
  }

  async function finishRecording(cancel) {
    if (recorder.starting) {
      // released while the microphone was still starting (often the first permission prompt)
      recorder.starting = false;
      setStatus('Microphone ready. Hold the button while you speak.');
      return;
    }
    if (!recorder.stream) return;
    const seconds = (Date.now() - recorder.started) / 1000;
    const chunks = recorder.chunks;
    const rate = recorder.rate;
    recorder.chunks = [];
    stopTracks();
    setProgress(null);
    render();
    if (cancel) {
      setStatus('Cancelled - nothing was sent.');
      return;
    }
    if (seconds < core.MIN_TALK_SECONDS) {
      setStatus('Too short. Hold the button while you speak.');
      return;
    }
    const message = buildMessage(chunks, rate);
    if (!message) {
      setStatus('Nothing to send - no voice was heard. Check the microphone.');
      return;
    }
    await sendMessage(message);
  }

  async function sendMessage(message) {
    const kind = view.mode.kind;
    if (kind === 'usb' || kind === 'demo') {
      view.talkBusy = true;
      render();
      try {
        await hostTalk(message, localTalkReport);
      } finally {
        view.talkBusy = false;
        render();
      }
      return;
    }
    if (kind === 'remote') {
      phoneSendTalk(message);
      return;
    }
    setStatus(view.mode.reason || 'Not connected.');
  }

  function talkText(report) {
    const estimate = report.eta != null ? ' (about ' + Math.max(1, Math.round(report.eta)) + ' s)' : '';
    switch (report.state) {
      case 'sending':
        return 'Sending the message to the PC…';
      case 'queued':
        return 'Waiting for the AIRIZ…';
      case 'pausing':
        return 'Pausing listening for the message…';
      case 'installing':
        return 'Installing the voice helper on the AIRIZ (first time after power-up)…';
      case 'uploading':
        return 'Sending to the AIRIZ ' + Math.round((report.pct || 0) * 100) + ' %' + estimate + '…';
      case 'preparing':
        return 'The AIRIZ is preparing the sound' + estimate + '…';
      case 'playing':
        return 'Playing on the AIRIZ speaker…';
      case 'done':
        return 'Played on the AIRIZ.';
      case 'busy':
        return 'The AIRIZ is busy with another message. Try again in a moment.';
      case 'error':
        return report.note || 'The message could not be played.';
      default:
        return report.note || '';
    }
  }

  function localTalkReport(report) {
    setStatus(talkText(report));
    const steps = { sending: 0.02, queued: 0.03, pausing: 0.04, installing: 0.06, uploading: null, preparing: 0.85, playing: 1 };
    if (report.state === 'uploading') setProgress(0.08 + 0.72 * (report.pct || 0));
    else if (report.state in steps) setProgress(steps[report.state]);
    else setProgress(null);
  }

  // ------------------------------------------------------------------ host (AIRIZ on USB)
  const hostState = {
    listen: 'off',        // off | starting | on | stopping
    listeners: new Map(), // id -> client ('local' = this PC)
    outbox: [],
    flushTimer: null,
    renewTimer: null,
    startTimer: null,
    talk: null,
    talkQueue: Promise.resolve(),
    lastTalk: null,
    scriptsOk: false,
    uploadMethod: 'fast',
    uploads: new Map(),   // phone uploads in progress
    clients: new Map(),   // phones that said hello (for caps updates)
    orphanFrames: 0,
    skips: 0,
    devicePid: '',        // listen.sh run that this PC started (1.11.2)
    oldPid: '',           // older run that is finishing its clip
    stopNote: '',         // why the AIRIZ stopped (no room for the clip)
    activeClip: 0,        // clip length of the running listen session
    previousClip: 0,
    lastNote: '',
    lease: null,
    demo: null,
  };

  const filter = core.createStreamFilter({
    frame: (frame, line) => hostFrame(frame, line),
    status: status => hostStatus(status),
    marker: name => {
      if (name === 'PLAYED') hostPlayed();
    },
  });
  api.setIncomingFilter(text => filter.feed(text));

  function hostListening() {
    return hostState.listen === 'on' || hostState.listen === 'starting';
  }

  function hostFrame(frame, line) {
    if (!hostListening()) {
      // voice lines from an earlier session: ask the AIRIZ to stop once
      hostState.orphanFrames++;
      if (hostState.orphanFrames === 20 && currentMode().kind === 'usb') {
        withLease('listen-stop', io => io.run(core.commands.listenStop(), /__AZLX__/, 4000)).catch(() => {});
      }
      return;
    }
    if (hostState.listen === 'starting') hostSetListen('on');
    stats.framesIn++;
    if (hostState.listeners.has('local') && player) player.push(frame);
    if ([...hostState.listeners.keys()].some(id => id !== 'local')) {
      hostState.outbox.push(line);
      if (!hostState.flushTimer) hostState.flushTimer = setTimeout(hostFlush, 180);
    }
  }

  function hostFlush() {
    hostState.flushTimer = null;
    const lines = hostState.outbox;
    hostState.outbox = [];
    if (!lines.length) return;
    for (const [id, client] of hostState.listeners) {
      if (id === 'local') continue;
      if (!client.connected) {
        hostState.listeners.delete(id);
        continue;
      }
      for (let i = 0; i < lines.length; i += 40) client.send({ type: 'voice-frames', f: lines.slice(i, i + 40) });
      stats.forwarded += lines.length;
    }
  }

  function hostBroadcastListen(state, note) {
    for (const [id, client] of hostState.listeners) {
      if (id !== 'local' && client.connected) client.send({ type: 'voice-listen', state, note: note || '', clip: hostState.activeClip || settings.clip });
    }
    if (hostState.listeners.has('local')) localListenReport(state, note, hostState.activeClip || settings.clip);
  }

  function hostSetListen(state, note) {
    hostState.listen = state;
    if (state === 'on') clearTimeout(hostState.startTimer);
    hostBroadcastListen(state, note);
  }

  function hostStatus(status) {
    // 1.11.2: "start" and "stopped" name their listen.sh run; an older run that ends late
    // (it finishes its clip after Stop) must not stop the new session.
    const pid = status.event === 'start' ? (status.args[2] || '') : status.event === 'stopped' ? (status.args[0] || '') : '';
    if (status.event === 'start') {
      hostState.devicePid = pid;
      if (hostState.listen === 'starting') hostSetListen('on');
    } else if (status.event === 'wait') {
      // the previous clip is still being recorded: the new one starts after it
      hostState.oldPid = status.args[0] || '';
      if (hostState.listen === 'starting') {
        armStartTimer(12000 + (hostState.previousClip + hostState.activeClip) * 2000);
        hostBroadcastListen('starting', 'The AIRIZ is finishing its previous clip first…');
      }
    } else if (status.event === 'nospace') {
      const free = Math.floor(Number(status.args[0]) / 1024);
      const need = Math.ceil(Number(status.args[1]) / 1024);
      hostState.stopNote = 'The AIRIZ has only ' + (Number.isFinite(free) ? free : '?') + ' MB free for clips of '
        + (hostState.activeClip || settings.clip) + ' s (about ' + (Number.isFinite(need) ? need : '?')
        + ' MB needed). Choose a shorter listen clip length.';
      hostBroadcastListen(hostState.listen === 'starting' ? 'starting' : hostState.listen === 'off' ? 'off' : 'on', hostState.stopNote);
    } else if (status.event === 'stopped' && pid
        && (pid === hostState.oldPid || (hostState.devicePid ? pid !== hostState.devicePid : hostState.listen === 'starting'))) {
      return; // an older listen.sh run ended (ours has not started yet, or is another run)
    } else if (status.event === 'skip') {
      hostState.skips++;
      hostBroadcastListen('on', 'The AIRIZ could not keep up and skipped a clip.');
    } else if (status.event === 'norec') {
      const detail = status.args.join(' ').trim();
      hostBroadcastListen(hostState.listen === 'off' ? 'off' : 'on', 'The AIRIZ could not record' + (detail ? ': ' + detail : '.'));
    } else if (status.event === 'stopped') {
      const wanted = hostState.listen === 'stopping';
      hostState.listen = 'off';
      clearInterval(hostState.renewTimer);
      hostState.renewTimer = null;
      if (!wanted && hostState.listeners.size && !hostState.talk) {
        hostBroadcastListen('error', hostState.stopNote || 'The AIRIZ stopped listening (its recorder failed or time ran out).');
        hostState.listeners.clear();
        if (player) {
          player.stop();
          player = null;
        }
        view.listening = false;
        render();
      }
    }
  }

  // ---- console lease: the voice job owns the AIRIZ console for a moment
  async function withLease(owner, job) {
    let lease = null;
    let io = null;
    for (let waited = 0; waited < 8000 && !lease; waited += 100) {
      lease = api.acquireSerial({ owner, abort: reason => (io ? io.abort(reason) : Promise.resolve()) });
      if (!lease) await sleep(100);
    }
    if (!lease) throw new VoiceError('busy', 'The AIRIZ console is busy. Try again in a moment.');
    io = createIo(lease);
    hostState.lease = lease;
    try {
      return await job(io);
    } finally {
      if (hostState.lease === lease) hostState.lease = null;
      lease.release();
    }
  }

  function createIo(lease) {
    let text = '';
    let counting = false;
    let echoed = 0;
    let writing = Promise.resolve();
    const io = {
      aborted: false,
      abortReason: '',
      get echoed() {
        return echoed;
      },
      startCounting() {
        counting = true;
        echoed = 0;
      },
      stopCounting() {
        counting = false;
      },
      clear() {
        text = '';
      },
      async send(line) {
        if (io.aborted) throw new VoiceError('aborted', 'Stopped.');
        text = '';
        const sent = await api.sendCommand(line, { lease, quiet: true });
        if (!sent) throw new VoiceError('send', 'The PC could not send to the AIRIZ.');
      },
      raw(chunk) {
        if (io.aborted) return Promise.reject(new VoiceError('aborted', 'Stopped.'));
        writing = writing.then(() => api.writeRaw(chunk, lease)).then(ok => {
          if (!ok) throw new VoiceError('send', 'The PC could not send to the AIRIZ.');
        });
        return writing;
      },
      async waitFor(pattern, timeoutMs) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          if (io.aborted) throw new VoiceError('aborted', 'Stopped.');
          const match = typeof pattern === 'function' ? pattern(text) : pattern.exec(text);
          if (match) return { match, text };
          await sleep(25);
        }
        throw new VoiceError('timeout', 'The AIRIZ did not answer in time.');
      },
      async run(line, pattern, timeoutMs) {
        await io.send(line);
        return io.waitFor(pattern, timeoutMs);
      },
      async interrupt() {
        try {
          await api.writeRaw('\x03', lease);
          await sleep(250);
        } catch (ignored) { /* port gone */ }
      },
      async abort(reason) {
        io.aborted = true;
        io.abortReason = reason || 'stop';
        try {
          await Promise.race([writing.catch(() => {}), sleep(800)]);
        } catch (ignored) { /* nothing */ }
        await io.interrupt();
      },
    };
    lease.tap = chunk => {
      text += chunk;
      if (text.length > 200000) text = text.slice(-100000);
      if (counting) {
        const found = chunk.match(/[A-Za-z0-9+/=]/g);
        if (found) echoed += found.length;
      }
    };
    return io;
  }

  const PROMPT = /#\s*$/;

  async function ensureScripts(io, report) {
    const scripts = core.deviceScripts();
    if (hostState.scriptsOk) return;
    const answer = await io.run(core.commands.sums(), /__AZSUMS__/, 6000);
    const missing = scripts.filter(script => !answer.text.includes(script.md5 + '  ' + script.path));
    if (missing.length && report) report({ state: 'installing' });
    for (const script of missing) await uploadFile(io, script.path, core.utf8Bytes(script.text), script.md5);
    hostState.scriptsOk = true;
  }

  async function uploadFile(io, path, bytes, md5, onProgress) {
    const text = core.bytesToBase64(bytes);
    if (hostState.uploadMethod === 'fast') {
      try {
        await uploadFast(io, path, text, onProgress);
        if (await verifyUpload(io, path, md5)) return;
      } catch (error) {
        if (io.aborted) throw error;
        await io.interrupt();
      }
      hostState.uploadMethod = 'lines';
    }
    await uploadLines(io, path, text, onProgress);
    if (!(await verifyUpload(io, path, md5))) {
      throw new VoiceError('upload', 'The AIRIZ did not receive the message correctly. Try again.');
    }
  }

  // "head -c": the whole message streams at line speed; the device's echo paces it.
  async function uploadFast(io, path, text, onProgress) {
    const plan = core.uploadPlan(text, core.UPLOAD_LINE_CHARS);
    await io.run(core.commands.receive(path, plan.byteCount), /__AZRDY__/, 8000);
    io.startCounting();
    let sent = 0;
    let lastEcho = 0;
    let lastEchoAt = Date.now();
    let echoWorks = true;
    for (const line of plan.lines) {
      while (echoWorks && sent - io.echoed > 2400) {
        if (io.aborted) throw new VoiceError('aborted', 'Stopped.');
        if (io.echoed !== lastEcho) {
          lastEcho = io.echoed;
          lastEchoAt = Date.now();
        } else if (Date.now() - lastEchoAt > 1500) {
          echoWorks = false; // the console does not echo: send at a steady pace instead
        }
        await sleep(10);
      }
      await io.raw(line);
      sent += line.length - 1;
      if (!echoWorks) await sleep(Math.ceil(line.length / 10));
      if (onProgress) onProgress(sent / plan.chars);
    }
    io.stopCounting();
    await io.waitFor(/__AZHD_0__/, 5000 + Math.max(0, plan.chars - io.echoed) / 8);
  }

  // Slow and proven: "echo <512 chars> >> file", one prompt each (the Bluetooth installer's way).
  async function uploadLines(io, path, text, onProgress) {
    await io.run(core.commands.clear(path), PROMPT, 4000);
    for (let offset = 0; offset < text.length; offset += core.FALLBACK_LINE_CHARS) {
      await io.run(core.commands.appendLine(path, text.slice(offset, offset + core.FALLBACK_LINE_CHARS)), PROMPT, 5000);
      if (onProgress) onProgress(Math.min(1, (offset + core.FALLBACK_LINE_CHARS) / text.length));
    }
  }

  async function verifyUpload(io, path, md5) {
    const answer = await io.run(core.commands.decodeCheck(path), /__AZM5__/, 10000);
    return answer.text.includes(md5 + '  ' + path);
  }

  // ---- talk
  function hostTalk(message, report) {
    const job = hostState.talkQueue.then(() => runTalk(message, report));
    hostState.talkQueue = job.catch(() => {});
    return job;
  }

  async function runTalk(message, report) {
    if (hostState.talk) {
      report({ state: 'busy' });
      return false;
    }
    hostState.talk = message;
    const resumeListening = hostListening() && hostState.listeners.size > 0;
    try {
      if (resumeListening) {
        report({ state: 'pausing' });
        await hostStopDevice();
      }
      const estimate = core.estimateTalk(message.seconds, settings.format);
      if (view.mode.kind === 'demo' || api.getStatus().demoMode) {
        await demoTalk(message, report, estimate);
      } else {
        await withLease('talk', async io => {
          await ensureScripts(io, report);
          const started = Date.now();
          await uploadFile(io, core.TALK_ADPCM, message.bytes, message.md5, pct => {
            const elapsed = (Date.now() - started) / 1000;
            const eta = pct > 0.05 ? elapsed / pct - elapsed : estimate.upload;
            report({ state: 'uploading', pct, eta });
          });
          report({ state: 'preparing', eta: estimate.decode });
          const answer = await io.run(core.commands.buildWav(message.samples, settings.format), /__AZWV__/,
            20000 + message.seconds * 8000);
          const size = /(\d+)\s*\r?\n[^\n]*__AZWV__/.exec(answer.text);
          const expected = core.talkWavSize(message.samples, settings.format);
          if (!size || Number(size[1]) !== expected) {
            throw new VoiceError('decode', 'The AIRIZ could not build the sound file (awk or base64 failed).');
          }
          await io.run(core.commands.play(settings.speaker, settings.play), /__AZGO__/, 8000);
        });
        report({ state: 'playing' });
        await waitPlayed(message.seconds);
      }
      hostState.lastTalk = { samples: message.samples, seconds: message.seconds, bytes: message.bytes, md5: message.md5 };
      report({ state: 'done' });
      return true;
    } catch (error) {
      const note = error && error.code === 'aborted'
        ? 'Stopped (Stop motor was pressed).'
        : (error && error.message) || 'The message could not be played.';
      report({ state: 'error', note });
      return false;
    } finally {
      hostState.talk = null;
      // listening goes on (or starts, if someone pressed Listen during the message)
      if ((resumeListening || hostState.listeners.size) && hostState.listeners.size && api.getStatus().connected
          && !hostListening()) {
        hostStartDevice().catch(error => hostBroadcastListen('error', error.message));
      }
      render();
    }
  }

  let playedWaiter = null;

  function hostPlayed() {
    if (playedWaiter) playedWaiter();
  }

  function waitPlayed(seconds) {
    return new Promise(resolve => {
      const timer = setTimeout(done, (seconds + 8) * 1000);
      function done() {
        clearTimeout(timer);
        playedWaiter = null;
        resolve();
      }
      playedWaiter = done;
    });
  }

  async function hostReplay(report) {
    const last = hostState.lastTalk;
    if (!last) {
      report({ state: 'error', note: 'No message to play again yet.' });
      return false;
    }
    if (view.mode.kind === 'demo' || api.getStatus().demoMode) {
      return hostTalk(Object.assign({ id: 'replay' }, last), report);
    }
    if (hostState.talk) {
      report({ state: 'busy' });
      return false;
    }
    hostState.talk = last;
    try {
      await withLease('replay', io => io.run(core.commands.play(settings.speaker, settings.play), /__AZGO__/, 8000));
      report({ state: 'playing' });
      await waitPlayed(last.seconds);
      report({ state: 'done' });
      return true;
    } catch (error) {
      report({ state: 'error', note: error.message });
      return false;
    } finally {
      hostState.talk = null;
      render();
    }
  }

  // ---- listen
  async function hostStartDevice() {
    if (hostListening()) return;
    hostState.orphanFrames = 0;
    hostState.skips = 0;
    hostState.devicePid = '';
    hostState.oldPid = '';
    hostState.stopNote = '';
    hostState.previousClip = hostState.activeClip;
    hostState.activeClip = settings.clip;
    hostSetListen('starting');
    if (view.mode.kind === 'demo' || api.getStatus().demoMode) {
      demoListenStart();
      return;
    }
    try {
      await withLease('listen', async io => {
        await ensureScripts(io);
        await io.run(core.commands.listenStart(settings.gain, settings.clip, settings.record), /__AZLS__/, 12000);
      });
    } catch (error) {
      hostState.listen = 'off';
      throw error;
    }
    armStartTimer(12000 + settings.clip * 2000);
    clearInterval(hostState.renewTimer);
    hostState.renewTimer = setInterval(() => {
      if (!hostListening() || currentMode().kind !== 'usb') return;
      withLease('listen-renew', io => io.run(core.commands.listenRenew(), /__AZLR__/, 3000)).catch(() => {});
    }, 60000);
  }

  // The first sound arrives after the first clip has been recorded and encoded.
  function armStartTimer(ms) {
    clearTimeout(hostState.startTimer);
    hostState.startTimer = setTimeout(() => {
      if (hostState.listen === 'starting') {
        hostState.listen = 'off';
        hostBroadcastListen('error', 'The AIRIZ did not start listening. Its recorder log is /tmp/airiz/listen/rec.log.');
      }
    }, ms);
  }

  async function hostStopDevice() {
    clearInterval(hostState.renewTimer);
    hostState.renewTimer = null;
    clearTimeout(hostState.startTimer);
    if (!hostListening()) return;
    hostState.listen = 'stopping';
    if (view.mode.kind === 'demo' || api.getStatus().demoMode || hostState.demo) {
      demoListenStop();
      return;
    }
    try {
      await withLease('listen-stop', io => io.run(core.commands.listenStop(), /__AZLX__/, 4000));
    } catch (ignored) { /* disconnected */ }
    for (let waited = 0; hostState.listen === 'stopping' && waited < 5000; waited += 100) await sleep(100);
    // Listen may have been pressed again meanwhile (1.11.2: the AIRIZ waits for its last clip)
    if (hostState.listen === 'stopping') hostState.listen = 'off';
  }

  async function hostAddListener(id, client) {
    hostState.listeners.set(id, client);
    if (hostState.listen === 'on') {
      if (id === 'local') localListenReport('on', '', hostState.activeClip || settings.clip);
      else client.send({ type: 'voice-listen', state: 'on', clip: hostState.activeClip || settings.clip });
      return;
    }
    if (hostState.listen === 'starting') return;
    if (hostState.talk) return; // starts after the message
    await hostStartDevice();
  }

  async function hostRemoveListener(id) {
    hostState.listeners.delete(id);
    if (!hostState.listeners.size) await hostStopDevice();
  }

  // ---- phones (remote-control.js routes their voice-* messages here)
  function hostCaps() {
    const kind = currentMode().kind;
    const ok = kind === 'usb' || kind === 'demo';
    return {
      type: 'voice-caps',
      v: core.PROTOCOL,
      talk: ok,
      listen: ok,
      replay: ok && !!hostState.lastTalk,
      maxTalk: core.MAX_TALK_SECONDS,
      reason: ok ? '' : 'The PC has no AIRIZ on USB right now.',
    };
  }

  function hostMessage(client, message) {
    hostState.clients.set(client.id, client);
    const kind = currentMode().kind;
    const ready = kind === 'usb' || kind === 'demo';
    switch (message.type) {
      case 'voice-hello':
        client.send(hostCaps());
        return;
      case 'voice-listen':
        if (message.on) {
          if (!ready) {
            client.send({ type: 'voice-listen', state: 'error', note: 'The PC has no AIRIZ on USB right now.' });
            return;
          }
          hostAddListener(client.id, client).catch(error => client.send({ type: 'voice-listen', state: 'error', note: error.message }));
        } else {
          hostRemoveListener(client.id).catch(() => {});
          client.send({ type: 'voice-listen', state: 'off' });
        }
        return;
      case 'voice-talk-start': {
        const samples = Number(message.n);
        const size = Number(message.bytes);
        if (!ready || !message.id || !Number.isInteger(samples) || samples < 1 || samples > core.RATE * (core.MAX_TALK_SECONDS + 1)
            || size !== Math.ceil(samples / 2) || !/^[0-9a-f]{32}$/.test(String(message.md5))) {
          client.send({ type: 'voice-talk', id: message.id, state: 'error', note: ready ? 'The message was refused (bad size).' : 'The PC has no AIRIZ on USB right now.' });
          return;
        }
        if (hostState.talk) {
          client.send({ type: 'voice-talk', id: message.id, state: 'busy' });
          return;
        }
        hostState.uploads.set(client.id, { id: String(message.id), samples, size, md5: String(message.md5), parts: [], started: Date.now() });
        client.send({ type: 'voice-talk', id: message.id, state: 'accepted' });
        return;
      }
      case 'voice-talk-data': {
        const upload = hostState.uploads.get(client.id);
        if (!upload || upload.id !== String(message.id) || typeof message.data !== 'string' || message.seq !== upload.parts.length
            || message.data.length > core.TALK_CHUNK_CHARS + 16) {
          if (upload) hostState.uploads.delete(client.id);
          client.send({ type: 'voice-talk', id: message.id, state: 'error', note: 'The message arrived incomplete. Try again.' });
          return;
        }
        upload.parts.push(message.data);
        return;
      }
      case 'voice-talk-end': {
        const upload = hostState.uploads.get(client.id);
        hostState.uploads.delete(client.id);
        if (!upload || upload.id !== String(message.id)) return;
        const bytes = core.base64ToBytes(upload.parts.join(''));
        if (!bytes || bytes.length !== upload.size || core.md5Hex(bytes) !== upload.md5) {
          client.send({ type: 'voice-talk', id: upload.id, state: 'error', note: 'The message arrived damaged. Try again.' });
          return;
        }
        const talk = { id: upload.id, samples: upload.samples, seconds: upload.samples / core.RATE, bytes, md5: upload.md5, from: client.label };
        if (!hostState.listeners.has('local') && !view.talkBusy) setStatus(client.label + ' sent a voice message to the AIRIZ.');
        hostTalk(talk, report => {
          if (client.connected) client.send(Object.assign({ type: 'voice-talk', id: upload.id }, report));
        });
        return;
      }
      case 'voice-talk-cancel':
        hostState.uploads.delete(client.id);
        return;
      case 'voice-replay':
        hostReplay(report => {
          if (client.connected) client.send(Object.assign({ type: 'voice-talk', id: 'replay' }, report));
        });
        return;
      default:
        return;
    }
  }

  function hostClientGone(id) {
    hostState.clients.delete(id);
    hostState.uploads.delete(id);
    if (hostState.listeners.has(id)) hostRemoveListener(id).catch(() => {});
  }

  // ------------------------------------------------------------------ phone (remote by code)
  const phoneState = { helloAt: 0, talkId: null, peerKey: '' };

  function phoneVoiceMessage(message) {
    switch (message.type) {
      case 'voice-caps':
        view.caps = message;
        render();
        if (!view.recording && !view.talkBusy && !view.listening) {
          setStatus(message.talk ? 'Ready. Hold to talk, or press Listen.' : (message.reason || 'Talk and listen are not available on the PC right now.'));
        }
        return;
      case 'voice-frames':
        if (!view.listening || !Array.isArray(message.f)) return;
        if (!player) {
          try {
            player = createPlayer();
          } catch (error) {
            setStatus(error.message);
            return;
          }
        }
        for (const line of message.f) {
          const frame = core.parseFrameLine(line);
          if (frame) {
            stats.framesIn++;
            player.push(frame);
          }
        }
        return;
      case 'voice-listen':
        if (view.listening) localListenReport(message.state, message.note, Number(message.clip) || 0);
        return;
      case 'voice-talk':
        if (message.id !== phoneState.talkId && message.id !== 'replay') return;
        if (message.state === 'accepted') return;
        localTalkReport(message);
        if (['done', 'error', 'busy'].includes(message.state)) {
          phoneState.talkId = null;
          view.talkBusy = false;
          if (message.state === 'done' && view.caps) view.caps.replay = true;
          render();
        }
        return;
      case 'voice-state':
        if (message.state === 'unsupported') {
          view.caps = { talk: false, listen: false, reason: 'The PC cannot talk or listen (older version).' };
          render();
        }
        return;
      default:
        return;
    }
  }

  function phoneSendTalk(message) {
    const control = remote();
    if (!control || !control.sendVoice({ type: 'voice-talk-start', id: message.id, n: message.samples, bytes: message.bytes.length, md5: message.md5, codec: 'ima8' })) {
      setStatus('Not connected to the PC.');
      return;
    }
    phoneState.talkId = message.id;
    view.talkBusy = true;
    render();
    localTalkReport({ state: 'sending' });
    const chunks = core.chunkText(message.base64, core.TALK_CHUNK_CHARS);
    chunks.forEach((data, seq) => control.sendVoice({ type: 'voice-talk-data', id: message.id, seq, data }));
    control.sendVoice({ type: 'voice-talk-end', id: message.id });
    const id = message.id;
    setTimeout(() => {
      if (phoneState.talkId === id) {
        phoneState.talkId = null;
        view.talkBusy = false;
        setStatus('No answer from the PC about the message.');
        setProgress(null);
        render();
      }
    }, 30000 + message.seconds * 6000);
  }

  // ------------------------------------------------------------------ listen UI (this device)
  function localListenReport(state, note, clip) {
    view.listenState = state;
    if (!view.listening) return;
    const seconds = clip > 0 ? clip : settings.clip;
    if (state === 'starting') setStatus(note || 'Starting the AIRIZ microphone…');
    else if (state === 'on') {
      setStatus(note || ('Listening to the AIRIZ in ' + seconds + ' s clips - about ' + (seconds + 2) + ' s behind live, with a short gap between clips.'));
    } else if (state === 'off') setStatus(note || 'Listening stopped.');
    else if (state === 'error') {
      setStatus(note || 'Listening failed.');
      stopLocalListening(true);
    }
  }

  async function startLocalListening() {
    try {
      player = player || createPlayer();
    } catch (error) {
      setStatus(error.message);
      return;
    }
    view.listening = true;
    render();
    localListenReport('starting');
    const kind = view.mode.kind;
    if (kind === 'remote') {
      if (!remote() || !remote().sendVoice({ type: 'voice-listen', on: true })) {
        setStatus('Not connected to the PC.');
        stopLocalListening(true);
      }
      return;
    }
    try {
      await hostAddListener('local', { id: 'local', label: 'This PC', connected: true, send() {} });
    } catch (error) {
      setStatus(error.message || 'Listening failed.');
      stopLocalListening(true);
    }
  }

  async function stopLocalListening(quiet) {
    const wasListening = view.listening;
    view.listening = false;
    if (player) {
      player.stop();
      player = null;
    }
    render();
    if (!wasListening) return;
    if (view.mode.kind === 'remote') {
      if (remote()) remote().sendVoice({ type: 'voice-listen', on: false });
    } else if (hostState.listeners.has('local')) {
      await hostRemoveListener('local').catch(() => {});
    }
    if (!quiet && !view.listening) setStatus('Listening stopped.');
  }

  // ------------------------------------------------------------------ demo AIRIZ
  async function demoTalk(message, report, estimate) {
    const speed = window.AirizVoiceDemoSpeed || 1;
    report({ state: 'uploading', pct: 0, eta: estimate.upload });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await sleep((estimate.upload * 1000 / steps) / speed);
      report({ state: 'uploading', pct: i / steps, eta: estimate.upload * (1 - i / steps) });
    }
    report({ state: 'preparing', eta: estimate.decode });
    await sleep((estimate.decode * 1000) / speed);
    report({ state: 'playing' });
    // the demo AIRIZ "speaker" is this PC: hear exactly what the AIRIZ would play
    const samples = core.decodeAdpcm(message.bytes, message.samples);
    window.AirizVoiceDemoLastPlayed = { samples: samples.length, md5: message.md5 };
    try {
      await playSamples(samples, core.RATE);
    } catch (ignored) {
      await sleep(message.seconds * 1000);
    }
  }

  function demoTone(seg, seconds, offset) {
    const rate = core.RATE;
    const out = new Int16Array(Math.round(rate * seconds));
    const notes = [523.25, 659.25, 783.99, 659.25];
    const first = Math.round((offset || 0) * rate);
    for (let i = 0; i < out.length; i++) {
      const t = (first + i) / rate;
      const note = notes[(Math.floor(t / 0.25) + seg) % notes.length];
      const local = t % 0.25;
      const envelope = Math.min(1, local / 0.01) * Math.exp(-local * 9);
      const noise = (Math.sin(i * 12.9898 + seg * 78.233) * 43758.5453) % 1;
      out[i] = Math.round(7000 * envelope * Math.sin(2 * Math.PI * note * t) + 300 * noise);
    }
    return out;
  }

  function demoListenStart() {
    const demo = { seg: 0, timer: null, queue: [], sender: null, running: true };
    hostState.demo = demo;
    const speed = window.AirizVoiceDemoSpeed || 1;
    api.injectDemoOutput('@AS1,0,start,' + settings.gain + ',' + settings.clip + '\r\n');
    const clipMs = settings.clip * 1000;
    function nextClip() {
      if (!demo.running) return;
      demo.seg += 1;
      const encoder = core.createListenEncoder(demo.seg);
      for (let start = 0; start < settings.clip; start += 1) {
        const piece = demoTone(demo.seg, Math.min(1, settings.clip - start), start);
        const lines = [];
        for (let i = 0; i < piece.length; i++) encoder.push(piece[i], lines);
        for (const line of lines) demo.queue.push(line);
      }
      for (const line of encoder.end([])) demo.queue.push(line);
      demo.timer = setTimeout(nextClip, (clipMs + 150) / speed);
    }
    demo.timer = setTimeout(nextClip, clipMs / speed);
    // the serial link carries about 11.5 kB/s: release lines at that pace
    demo.sender = setInterval(() => {
      let budget = (core.LINK_BYTES_PER_SECOND * 0.05) * speed;
      while (demo.queue.length && budget > 0) {
        const line = demo.queue.shift();
        budget -= line.length + 2;
        api.injectDemoOutput(line + '\r\n');
      }
    }, 50);
  }

  function demoListenStop() {
    const demo = hostState.demo;
    hostState.demo = null;
    if (!demo) {
      hostState.listen = 'off';
      return;
    }
    demo.running = false;
    clearTimeout(demo.timer);
    clearInterval(demo.sender);
    if (api.getStatus().demoMode) api.injectDemoOutput('@AS1,' + demo.seg + ',stopped\r\n');
    hostState.listen = 'off';
  }

  // ------------------------------------------------------------------ buttons
  let pointerTalk = false;

  async function talkDown(event) {
    if (event) event.preventDefault();
    if (ui.talk.disabled || view.recording || pointerTalk) return;
    pointerTalk = true;
    if (event && event.pointerId != null && ui.talk.setPointerCapture) {
      try {
        ui.talk.setPointerCapture(event.pointerId);
      } catch (ignored) { /* not capturable */ }
    }
    try {
      await startRecording();
      if (!pointerTalk) await finishRecording(false);
    } catch (error) {
      pointerTalk = false;
      stopTracks();
      render();
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setStatus(denied ? 'Microphone blocked. Allow the microphone for this page, then try again.' : (error.message || 'The microphone could not start.'));
    }
  }

  function talkUp(event, cancel) {
    if (!pointerTalk) return;
    pointerTalk = false;
    if (event && event.pointerId != null && ui.talk.releasePointerCapture) {
      try {
        ui.talk.releasePointerCapture(event.pointerId);
      } catch (ignored) { /* already released */ }
    }
    if (recorder.stream || recorder.starting) finishRecording(!!cancel);
  }

  // Slide the finger (or mouse) well away from the button before releasing = cancel.
  let slideAway = false;

  function releaseTalk(event, cancel) {
    const away = slideAway;
    slideAway = false;
    ui.talk.classList.remove('will-cancel');
    talkUp(event, cancel || away);
  }

  ui.talk.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    slideAway = false;
    talkDown(event);
  });
  ui.talk.addEventListener('pointerup', event => releaseTalk(event, false));
  ui.talk.addEventListener('pointercancel', event => releaseTalk(event, true));
  ui.talk.addEventListener('pointermove', event => {
    if (!pointerTalk) return;
    const box = ui.talk.getBoundingClientRect();
    slideAway = event.clientX < box.left - 40 || event.clientX > box.right + 40
      || event.clientY < box.top - 60 || event.clientY > box.bottom + 60;
    ui.talk.classList.toggle('will-cancel', slideAway);
  });
  ui.talk.addEventListener('lostpointercapture', event => {
    if (pointerTalk) releaseTalk(event, false);
  });
  ui.talk.addEventListener('contextmenu', event => event.preventDefault());
  ui.talk.addEventListener('keydown', event => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) talkDown(event);
    if (event.key === 'Escape') talkUp(event, true);
  });
  ui.talk.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') talkUp(event, false);
  });
  // a pointerup that the capture missed (window lost focus)
  window.addEventListener('blur', () => {
    if (pointerTalk) talkUp(null, false);
  });

  ui.listen.addEventListener('click', () => {
    if (view.listening) stopLocalListening(false);
    else startLocalListening();
  });

  if (ui.replay) {
    ui.replay.addEventListener('click', async () => {
      const kind = view.mode.kind;
      if (kind === 'remote') {
        phoneState.talkId = 'replay';
        view.talkBusy = true;
        render();
        if (!remote() || !remote().sendVoice({ type: 'voice-replay' })) {
          view.talkBusy = false;
          setStatus('Not connected to the PC.');
          render();
        }
        return;
      }
      view.talkBusy = true;
      render();
      try {
        await hostReplay(localTalkReport);
      } finally {
        view.talkBusy = false;
        render();
      }
    });
  }

  if (ui.volume) {
    ui.volume.value = String(settings.volume);
    ui.volume.addEventListener('input', () => {
      settings.volume = clamp(ui.volume.value, 0, 300, DEFAULTS.volume);
      saveSettings();
      if (player) player.setVolume(settings.volume);
    });
  }

  function bindSetting(input, key, parse) {
    if (!input) return;
    input.value = String(settings[key]);
    input.addEventListener('change', () => {
      settings[key] = parse(input.value);
      input.value = String(settings[key]);
      saveSettings();
    });
  }
  bindSetting(ui.speaker, 'speaker', value => clamp(value, 0, 100, DEFAULTS.speaker));
  bindSetting(ui.gain, 'gain', value => clamp(value, 1, 100, DEFAULTS.gain));
  if (ui.clip) {
    ui.clip.min = String(MIN_CLIP);
    ui.clip.max = String(MAX_CLIP);
  }
  bindSetting(ui.clip, 'clip', value => clamp(value, MIN_CLIP, MAX_CLIP, DEFAULTS.clip));
  bindSetting(ui.format, 'format', value => (core.FORMATS[value] ? value : DEFAULTS.format));
  bindSetting(ui.record, 'record', value => core.recordTemplate(value));
  bindSetting(ui.play, 'play', value => (/^[A-Za-z0-9 ._\/{}-]+$/.test(value.trim()) && value.trim() ? value.trim() : DEFAULTS.play));

  // ------------------------------------------------------------------ connection changes
  function refresh() {
    const previous = view.mode.kind;
    view.mode = currentMode();
    const kind = view.mode.kind;
    if (kind !== previous) {
      if (previous === 'remote' || kind === 'off') view.caps = null;
      if (previous === 'usb' || previous === 'demo') {
        hostState.scriptsOk = false;
        hostState.uploadMethod = 'fast';
        if (hostState.demo) demoListenStop();
        hostState.listen = 'off';
        hostState.lastTalk = null;
      }
      if (view.listening) stopLocalListening(true);
      if (view.recording) finishRecording(true);
      if (kind === 'remote') phoneState.helloAt = 0;
      if (kind === 'usb' || kind === 'demo') setStatus('Ready. Hold to talk, or press Listen.');
      // tell phones what this PC can do now
      for (const client of hostState.clients.values()) {
        if (client.connected) client.send(hostCaps());
      }
    }
    if (kind === 'remote' && !view.caps && Date.now() - phoneState.helloAt > 4000) {
      phoneState.helloAt = Date.now();
      if (remote()) remote().sendVoice({ type: 'voice-hello', v: core.PROTOCOL });
    }
    render();
  }

  if (remote() && remote().setVoiceHandler) remote().setVoiceHandler(phoneVoiceMessage);
  else {
    window.addEventListener('load', () => {
      if (remote() && remote().setVoiceHandler) remote().setVoiceHandler(phoneVoiceMessage);
    });
  }
  setInterval(refresh, 700);
  refresh();

  // stop the AIRIZ microphone when this console closes (best effort; it also stops by itself)
  window.addEventListener('pagehide', () => {
    if (hostListening() && currentMode().kind === 'usb') {
      api.sendCommand(core.commands.listenStop(), { quiet: true, internal: true, leaseWaitMs: 0 }).catch(() => {});
    }
  });

  window.AirizVoice = Object.freeze({
    hostMessage,
    hostClientGone,
    get state() {
      return {
        mode: view.mode.kind,
        listening: view.listening,
        listen: hostState.listen,
        listeners: [...hostState.listeners.keys()],
        talkBusy: view.talkBusy || !!hostState.talk,
        lastTalk: hostState.lastTalk ? { samples: hostState.lastTalk.samples, md5: hostState.lastTalk.md5 } : null,
        uploadMethod: hostState.uploadMethod,
        caps: view.caps,
        status: view.message,
        skips: hostState.skips,
        orphanFrames: hostState.orphanFrames,
        clip: settings.clip,
        playerBehind: player ? player.behind : null,
        dropped: player ? player.dropped : 0,
        frames: Object.assign({}, stats),
      };
    },
    // test hooks: a ready-made message (no microphone needed)
    buildMessage(float32, rate) {
      return buildMessage([float32], rate);
    },
    send(message) {
      return sendMessage(message);
    },
    startListening: startLocalListening,
    stopListening: stopLocalListening,
  });
})();
