/**
 * Web Audio engine for Keyin.
 *
 * Synthesizes switch sounds from parameters, plays them with sub-frame
 * latency when a key event arrives, and reports measured round-trip
 * latency (event arrival -> audio output scheduled).
 *
 * Why synth and not samples?
 *   1. Zero asset licensing risk (CC0 mech recordings are rare and small).
 *   2. Randomization per event is easier (pitch jitter, micro-variation).
 *   3. Bundle stays tiny.
 *   Later, we can layer pre-recorded WAVs on top for ultimate realism.
 */

import type { SwitchProfile } from '@shared/types';

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
}

export interface PlaybackStats {
  /** Average latency from event arrival to audio output scheduled, ms. */
  avgLatencyMs: number;
  /** Number of events played. */
  voicesPlayed: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private activeVoices: ActiveVoice[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private recentLatencies: number[] = [];
  private voicesPlayed = 0;
  private ctxStartMs: number | null = null;
  private ctxStartSec: number | null = null;

  /** Lazily create the AudioContext (browsers require a user gesture). */
  ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    // latencyHint: 'interactive' requests the smallest buffer the OS allows.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive', sampleRate: 48000 });
    this.ctxStartMs = performance.now();
    this.ctxStartSec = this.ctx.currentTime;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoiseBuffer(this.ctx, 0.5);
    return this.ctx;
  }

  /** Resume the context if it was suspended (e.g. after user gesture). */
  async resume(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  /**
   * Trigger a key sound. `eventArrivalMs` is performance.now() at the moment
   * the IPC event landed in the renderer; we use it to report latency.
   */
  trigger(profile: SwitchProfile, eventArrivalMs: number, isRelease = false): void {
    const ctx = this.ensure();
    const now = ctx.currentTime;
    if (!this.master || !this.noiseBuffer) return;

    // For releases, duck the click and skip the body — that's how most
    // switches actually behave (release has less energy than press).
    const clickGainScale = isRelease ? 0.35 : 1;
    const bodyGainScale = isRelease ? 0.15 : 1;

    const pitchCents = (Math.random() - 0.5) * 2 * profile.pitchJitterCents;
    const pitchFactor = Math.pow(2, pitchCents / 1200);

    const voice: ActiveVoice = { source: this.makeVoice(profile, pitchFactor, clickGainScale, bodyGainScale), gain: this.master, startedAt: now };
    voice.source.connect(voice.gain);
    voice.source.start(now);

    // Track for cleanup.
    this.activeVoices.push(voice);
    voice.source.onended = () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    };

    // Latency = how long after the IPC event arrived did we schedule audio.
    // Align the two clocks at AudioContext creation so we can compare.
    let audioNowMs = eventArrivalMs;
    if (this.ctxStartMs !== null && this.ctxStartSec !== null) {
      audioNowMs = this.ctxStartMs + (now - this.ctxStartSec) * 1000;
    }
    const latency = audioNowMs - eventArrivalMs;
    if (latency >= 0 && latency < 500) {
      this.recentLatencies.push(latency);
      if (this.recentLatencies.length > 50) this.recentLatencies.shift();
    }
    this.voicesPlayed++;
  }

  stats(): PlaybackStats {
    const arr = this.recentLatencies;
    const avg = arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
    return { avgLatencyMs: avg, voicesPlayed: this.voicesPlayed };
  }

  // --- private helpers ---

  private makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /**
   * Build one voice: short bandpass-filtered noise burst (the click) +
   * optional low-frequency body tone. Returns an AudioBufferSourceNode
   * that's already filled and ready to start.
   */
  private makeVoice(
    profile: SwitchProfile,
    pitchFactor: number,
    clickGainScale: number,
    bodyGainScale: number,
  ): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const data = buf.getChannelData(0);
    // White noise with a sharp envelope.
    const total = data.length;
    for (let i = 0; i < total; i++) {
      const env = Math.exp(-i / (total * 0.08));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitchFactor;

    // Click branch: bandpass-filtered noise burst.
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = profile.clickFreq * pitchFactor;
    clickFilter.Q.value = profile.clickQ;

    const clickGain = ctx.createGain();
    clickGain.gain.value = profile.clickGain * clickGainScale;
    // Click envelope: 2ms attack, ~20ms decay.
    clickGain.gain.setValueAtTime(0, ctx.currentTime);
    clickGain.gain.linearRampToValueAtTime(profile.clickGain * clickGainScale, ctx.currentTime + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);

    src.connect(clickFilter).connect(clickGain);

    // Body branch: low-frequency tone with longer decay (the "thock").
    if (profile.bodyGain > 0 && bodyGainScale > 0) {
      const bodyOsc = ctx.createOscillator();
      bodyOsc.type = 'sine';
      bodyOsc.frequency.value = 110 * pitchFactor;
      const bodyGain = ctx.createGain();
      const bodyDecay = profile.bodyDecayMs / 1000;
      bodyGain.gain.setValueAtTime(0, ctx.currentTime);
      bodyGain.gain.linearRampToValueAtTime(profile.bodyGain * bodyGainScale, ctx.currentTime + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + bodyDecay);
      bodyOsc.connect(bodyGain);
      bodyOsc.start(ctx.currentTime);
      bodyOsc.stop(ctx.currentTime + bodyDecay + 0.05);
    }

    return src;
  }
}

/** Singleton — only one engine per renderer. */
export const audioEngine = new AudioEngine();
