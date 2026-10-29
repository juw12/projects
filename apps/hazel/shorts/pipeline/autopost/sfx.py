"""Procedural sound effects for Hazel Shorts "pop" videos (numpy only, no sample files, no licences).

The idea of "every visible action has a sound, generated in code and placed on its exact frame" comes
from lemomo-ai/lemo-opuscar (MIT); this is an independent, simplified implementation.

    cues = cues_for_timeline(scenes)          # scenes: [{start, dur, voDur, layout, n_items, ...}]
    write_wav(render_track(cues, total_seconds), "sfx.wav")
"""

import wave

import numpy as np

SR = 48000
_rng = np.random.default_rng(11)


def _t(seconds):
    return np.arange(int(round(seconds * SR))) / SR


def _noise(seconds):
    return _rng.standard_normal(int(round(seconds * SR)))


def _one_pole_lowpass(signal, cutoff_hz):
    alpha = 1.0 - np.exp(-2.0 * np.pi * cutoff_hz / SR)
    out = np.empty_like(signal)
    acc = 0.0
    for i, sample in enumerate(signal):
        acc += alpha * (sample - acc)
        out[i] = acc
    return out


def _normalise(signal, peak=1.0):
    top = np.abs(signal).max()
    return signal * (peak / top) if top > 0 else signal


# ------------------------------------------------------------------ sounds
def whoosh(seconds=0.32):
    """Air swish for scene transitions: noise swept through a rising then falling low-pass."""
    noise = _noise(seconds)
    t = _t(seconds)
    shape = np.sin(np.pi * t / seconds) ** 2
    bright = _one_pole_lowpass(noise, 2500.0) - _one_pole_lowpass(noise, 300.0)
    return _normalise(bright * shape, 0.9)


def pop(pitch=1.0):
    """Bubble pop for chat bubbles / poll options: fast downward pitch blip."""
    seconds = 0.09
    t = _t(seconds)
    freq = 900.0 * pitch * np.exp(-t * 28.0) + 250.0 * pitch
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return _normalise(np.sin(phase) * np.exp(-t * 45.0), 0.8)


def tick(pitch=1.0):
    """Short click for counters / typed lines / bars starting."""
    seconds = 0.03
    t = _t(seconds)
    body = np.sin(2 * np.pi * 2400.0 * pitch * t) * np.exp(-t * 260.0)
    return _normalise(body + 0.3 * _noise(seconds) * np.exp(-t * 400.0), 0.55)


def thump():
    """Low impact for the stamp slamming down."""
    seconds = 0.35
    t = _t(seconds)
    freq = 110.0 * np.exp(-t * 9.0) + 45.0
    phase = 2 * np.pi * np.cumsum(freq) / SR
    hit = np.sin(phase) * np.exp(-t * 11.0)
    crack = _one_pole_lowpass(_noise(seconds), 1800.0) * np.exp(-t * 60.0)
    return _normalise(hit + 0.6 * crack, 1.0)


def ding(pitch=1.0):
    """Bright two-partial bell for a result / key number landing."""
    seconds = 0.7
    t = _t(seconds)
    base = 1320.0 * pitch
    bell = np.sin(2 * np.pi * base * t) + 0.5 * np.sin(2 * np.pi * base * 2.76 * t)
    return _normalise(bell * np.exp(-t * 6.0), 0.6)


SOUNDS = {"whoosh": whoosh, "pop": pop, "tick": tick, "thump": thump, "ding": ding}


# ------------------------------------------------------------------ cue sheet
def cues_for_timeline(scenes):
    """Return [(time_s, sound, gain, pitch)] synced to the pop.js animation timings.

    Each scene dict needs: start, dur, voDur, layout, and the per-layout item counts
    (messages, bars, lines, options, rows, value) that pop.js animates.
    """
    cues = []
    for index, scene in enumerate(scenes):
        start = scene["start"]
        layout = scene.get("layout") or "hook"
        if index > 0:
            cues.append((start - 0.06, "whoosh", 0.55, 1.0))  # J-cut: the swish leads the cut slightly
        if layout == "hook":
            cues.append((start + 0.05, "pop", 0.5, 1.2))
            if scene.get("value"):
                for k in range(8):
                    cues.append((start + 0.4 + k * 0.09, "tick", 0.35, 1.0 + k * 0.03))
                cues.append((start + 1.15, "ding", 0.45, 1.0))
        elif layout == "chat":
            span = max(1.2, scene["voDur"] - 0.4)
            count = max(1, scene.get("messages", 0))
            for i in range(scene.get("messages", 0)):
                cues.append((start + 0.25 + span * i / count, "pop", 0.6, 1.0 if i % 2 == 0 else 0.8))
        elif layout == "bars":
            for i in range(scene.get("bars", 0)):
                cues.append((start + 0.6 + i * 0.35, "tick", 0.45, 1.0 + 0.1 * i))
            if scene.get("bars", 0):
                cues.append((start + 0.6 + (scene["bars"] - 1) * 0.35 + 0.9, "ding", 0.4, 1.0))
        elif layout == "math":
            lines = max(1, scene.get("lines", 0))
            per_line = max(0.6, scene["voDur"] * 0.45 / lines)
            for i in range(scene.get("lines", 0)):
                line_start = start + 0.4 + i * per_line
                for k in range(5):
                    cues.append((line_start + k * per_line * 0.14, "tick", 0.22, 1.3))
            if scene.get("result"):
                cues.append((start + 0.4 + scene.get("lines", 0) * per_line + 0.1, "ding", 0.55, 1.0))
        elif layout == "stamp":
            if scene.get("stamp"):
                cues.append((start + 0.9 + 0.2, "thump", 0.85, 1.0))
        elif layout == "price":
            for i in range(scene.get("rows", 0)):
                cues.append((start + 1.3 + i * 0.25, "tick", 0.4, 1.0))
            if scene.get("stamp"):
                cues.append((start + 2.0 + 0.22, "thump", 0.8, 1.0))
        elif layout == "poll":
            for i in range(scene.get("options", 0)):
                cues.append((start + 0.4 + i * 0.3, "pop", 0.6, 1.0 if i == 0 else 0.75))
            cues.append((start + 1.3, "ding", 0.35, 1.25))
    return [cue for cue in cues if cue[0] >= 0]


def render_track(cues, total_seconds):
    track = np.zeros(int(round((total_seconds + 1.0) * SR)), dtype=np.float64)
    cache = {}
    for at, name, gain, pitch in cues:
        key = (name, round(pitch, 3))
        if key not in cache:
            maker = SOUNDS[name]
            cache[key] = maker(pitch) if name in ("pop", "tick", "ding") else maker()
        sound = cache[key] * gain
        begin = int(round(at * SR))
        end = min(len(track), begin + len(sound))
        if begin < len(track):
            track[begin:end] += sound[: end - begin]
    return np.clip(track, -1.0, 1.0)


def write_wav(track, path):
    data = (track * 32767 * 0.9).astype("<i2")
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SR)
        wav_file.writeframes(data.tobytes())
    return path
