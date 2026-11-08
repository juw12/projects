"use strict";

// Voice engine for phones and browsers where the built-in speech service fails or is missing:
// iPhone home-screen apps (speech recognition is unavailable or silent there), Firefox, and
// desktops where Google's speech servers are blocked. It records the microphone itself,
// makes a small 16 kHz WAV and asks Tally's speech server (Whisper) for the text.
// Audio is sent only while you record and is not stored by the server.
const TallyVoice = (() => {
  const API = "https://tally-api.juwenmondial.workers.dev/transcribe";
  const ENGINE_KEY = "tally.voice.engine";
  const TARGET_RATE = 16000;
  const MAX_SECONDS = 25;
  const SILENCE_STOP_MS = 1600; // stop on its own after this much quiet once speech was heard
  const SPEECH_LEVEL = 0.025; // RMS above this counts as speech
  const UPLOAD_TIMEOUT_MS = 25000;
  const NO_AUDIO_MS = 3000; // a microphone that delivers nothing this long is treated as stuck

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function recorderSupported() {
    return Boolean(AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // Use the recorder instead of the browser's speech service when that service is known not to work.
  function preferRecorder(hasRecognition) {
    if (!recorderSupported()) {
      return false;
    }
    if (!hasRecognition || isIos) {
      return true;
    }
    try {
      return localStorage.getItem(ENGINE_KEY) === "cloud";
    } catch {
      return false;
    }
  }

  // Remember that the browser's speech service failed here, so next time goes straight to the recorder.
  function rememberRecorder() {
    try {
      localStorage.setItem(ENGINE_KEY, "cloud");
    } catch {
      // Private mode: fine, we just retry the browser service next time.
    }
  }

  function downsample(chunks, inputRate) {
    let length = 0;
    for (const chunk of chunks) {
      length += chunk.length;
    }
    const input = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      input.set(chunk, offset);
      offset += chunk.length;
    }
    if (inputRate === TARGET_RATE) {
      return input;
    }
    // Average each output sample over its input window (a simple low-pass that avoids aliasing).
    const ratio = inputRate / TARGET_RATE;
    const output = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += input[j];
      }
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }

  function encodeWav(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeText = (at, text) => {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(at + i, text.charCodeAt(i));
      }
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, TARGET_RATE, true);
    view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let at = 44;
    for (let i = 0; i < samples.length; i++, at += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  class VoiceError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  async function transcribe(wav, lang) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(`${API}?lang=${encodeURIComponent((lang || "").slice(0, 2))}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        throw new VoiceError("busy", data.error);
      }
      if (!response.ok) {
        throw new VoiceError("server", data.error);
      }
      return String(data.text || "").trim();
    } catch (err) {
      if (err instanceof VoiceError) {
        throw err;
      }
      throw new VoiceError(navigator.onLine === false ? "offline" : "network");
    } finally {
      clearTimeout(timer);
    }
  }

  // One recording. Call create() inside the tap handler (iPhone only allows audio to start there),
  // then start(). Callbacks: onLevel(0..1), onState("listening" | "transcribing").
  function create({ lang, onLevel, onState }) {
    const context = new AudioCtx();
    // Resume inside the tap: iPhone starts audio contexts suspended.
    context.resume().catch(() => {});
    let stream = null;
    let processor = null;
    let source = null;
    let chunks = [];
    let heardSpeech = false;
    let lastLoud = 0;
    let startedAt = 0;
    let finished = false;
    let cancelled = false;
    let frames = 0;
    let noAudio = false;
    let resolveStop;
    const stopped = new Promise((resolve) => {
      resolveStop = resolve;
    });

    function release() {
      try {
        processor && processor.disconnect();
        source && source.disconnect();
      } catch {
        // already disconnected
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      context.close().catch(() => {});
    }

    function stop() {
      if (!finished) {
        finished = true;
        resolveStop();
      }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (err) {
        release();
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          throw new VoiceError("blocked");
        }
        throw new VoiceError("nomic");
      }
      if (cancelled) {
        release();
        throw new VoiceError("cancelled");
      }
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      startedAt = Date.now();
      processor.onaudioprocess = (event) => {
        if (finished) {
          return;
        }
        frames += 1;
        const data = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / (data.length / 4));
        onLevel && onLevel(Math.min(1, rms * 8));
        const now = Date.now();
        if (rms > SPEECH_LEVEL) {
          heardSpeech = true;
          lastLoud = now;
        }
        if ((heardSpeech && now - lastLoud > SILENCE_STOP_MS) || now - startedAt > MAX_SECONDS * 1000) {
          stop();
        }
      };
      source.connect(processor);
      // ScriptProcessor only runs while connected to the output; it writes silence, so nothing is heard.
      processor.connect(context.destination);
      if (context.state === "suspended") {
        await context.resume().catch(() => {});
      }
      if (context.state === "suspended") {
        release();
        throw new VoiceError("needtap");
      }
      onState && onState("listening");
      // Timers, not the audio callback, enforce the limits: a stalled microphone must still end.
      const maxTimer = setTimeout(stop, MAX_SECONDS * 1000 + 500);
      const noAudioTimer = setTimeout(() => {
        if (!frames) {
          noAudio = true;
          stop();
        }
      }, NO_AUDIO_MS);

      await stopped;
      clearTimeout(maxTimer);
      clearTimeout(noAudioTimer);
      const rate = context.sampleRate;
      release();
      if (cancelled) {
        throw new VoiceError("cancelled");
      }
      if (noAudio) {
        throw new VoiceError("needtap");
      }
      if (!heardSpeech) {
        throw new VoiceError("nospeech");
      }
      onState && onState("transcribing");
      const wav = encodeWav(downsample(chunks, rate));
      chunks = [];
      const text = await transcribe(wav, lang);
      if (!text) {
        throw new VoiceError("nospeech");
      }
      return text;
    }

    function cancel() {
      cancelled = true;
      stop();
    }

    return { start, stop, cancel };
  }

  return { recorderSupported, preferRecorder, rememberRecorder, create, isIos, VoiceError, _encodeWav: encodeWav, _downsample: downsample };
})();
