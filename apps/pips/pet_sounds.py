"""
pet_sounds.py - little voices for the desktop pet.

Every animal has its own voice (a cat meows, a dog arfs, a frog ribbits, a bee
buzzes, a whale moans ...) and every voice changes with the pet's mood and with
what just happened (tickled, petted, eating, dizzy, sleepy, grumpy ...).

All sounds are synthesised here with the standard library - no audio files.
Clips are cached as small WAV files in %TEMP% and played through the Windows
MCI API, so they mix with (and never interrupt) the soundscape that audio.py
plays through winsound.
"""
from __future__ import annotations

import ctypes
import hashlib
import logging
import math
import random
import struct
import tempfile
import threading
import time
import wave
from pathlib import Path

logger = logging.getLogger("pet_sounds")

SR = 22050
CACHE_DIR = Path(tempfile.gettempdir()) / "pips_pet_sounds"
VARIANTS = 3          # a few takes per sound so it never feels like a loop
MIN_GAP_S = 0.35      # never stack sounds faster than this
MAX_PLAYING = 2

# ---------------------------------------------------------------------------
# Voices.  f0 = base pitch (Hz), timbre, call shape, note length (s), noise mix,
# vibrato depth, and an optional amplitude-modulation "texture" (rate Hz, depth).
VOICES = {
    # land
    "cat":       dict(f0=620, timbre="saw", shape="meow", dur=0.42, noise=0.02, vib=0.02),
    "dog":       dict(f0=360, timbre="square", shape="bark", dur=0.15, noise=0.18, vib=0.0),
    "bunny":     dict(f0=1500, timbre="sine", shape="squeak", dur=0.07, noise=0.0, vib=0.0),
    "bear":      dict(f0=150, timbre="saw", shape="growl", dur=0.48, noise=0.15, vib=0.01, am=(28, 0.45)),
    "panda":     dict(f0=430, timbre="tri", shape="bleat", dur=0.34, noise=0.03, vib=0.06),
    "fox":       dict(f0=880, timbre="saw", shape="yip", dur=0.12, noise=0.05, vib=0.0),
    "hamster":   dict(f0=2200, timbre="sine", shape="squeak", dur=0.055, noise=0.0, vib=0.0),
    "pig":       dict(f0=210, timbre="nasal", shape="oink", dur=0.22, noise=0.08, vib=0.0, am=(34, 0.5)),
    "sprout":    dict(f0=700, timbre="sine", shape="boop", dur=0.12, noise=0.0, vib=0.0),
    # water
    "fish":      dict(f0=480, timbre="sine", shape="bubble", dur=0.06, noise=0.0, vib=0.0),
    "whale":     dict(f0=170, timbre="tri", shape="moan", dur=0.95, noise=0.02, vib=0.015),
    "octopus":   dict(f0=300, timbre="sine", shape="blorp", dur=0.18, noise=0.0, vib=0.03),
    "axolotl":   dict(f0=1250, timbre="tri", shape="chirp", dur=0.10, noise=0.0, vib=0.0),
    "penguin":   dict(f0=520, timbre="nasal", shape="honk", dur=0.20, noise=0.08, vib=0.0, am=(22, 0.35)),
    "turtle":    dict(f0=190, timbre="tri", shape="hum", dur=0.36, noise=0.02, vib=0.01),
    "frog":      dict(f0=250, timbre="square", shape="ribbit", dur=0.22, noise=0.04, vib=0.0, am=(42, 0.75)),
    "jellyfish": dict(f0=1180, timbre="bell", shape="chime", dur=0.55, noise=0.0, vib=0.0),
    # sky
    "bird":      dict(f0=2500, timbre="sine", shape="tweet", dur=0.07, noise=0.0, vib=0.0),
    "owl":       dict(f0=410, timbre="sine", shape="hoot", dur=0.26, noise=0.02, vib=0.0),
    "bat":       dict(f0=3200, timbre="sine", shape="squeak", dur=0.04, noise=0.0, vib=0.0),
    "bee":       dict(f0=230, timbre="saw", shape="buzz", dur=0.42, noise=0.03, vib=0.01, am=(58, 0.4)),
    "butterfly": dict(f0=2000, timbre="bell", shape="sparkle", dur=0.09, noise=0.0, vib=0.0),
    "dragon":    dict(f0=220, timbre="saw", shape="rawr", dur=0.40, noise=0.22, vib=0.02, am=(31, 0.35)),
}

# Pitch contour of one call, as multipliers of f0 spread over the note.
SHAPES = {
    "meow":    [0.82, 1.18, 1.05, 0.72],
    "bark":    [1.25, 1.0, 0.78],
    "squeak":  [1.0, 1.12],
    "growl":   [1.0, 1.08, 0.95],
    "bleat":   [1.0, 1.05, 0.98],
    "yip":     [0.85, 1.35],
    "oink":    [1.05, 1.0, 0.86],
    "boop":    [1.3, 0.9],
    "bubble":  [0.7, 1.6],
    "moan":    [0.88, 1.28, 1.15, 0.8],
    "blorp":   [1.15, 0.78, 1.05],
    "chirp":   [0.9, 1.3],
    "honk":    [1.0, 1.04, 0.96],
    "hum":     [1.0, 1.02, 0.98],
    "ribbit":  [1.0, 1.06, 0.92],
    "chime":   [1.0, 1.0],
    "tweet":   [0.8, 1.45],
    "hoot":    [1.04, 1.0],
    "buzz":    [1.0, 1.03, 0.99],
    "sparkle": [1.0, 1.1],
    "rawr":    [0.78, 1.25, 0.95],
}

# How each mood / event colours the voice.
#   pitch: f0 multiplier, speed: >1 = shorter notes, reps: calls in a row,
#   tilt: bends the contour up (+) or down (-), gain, extra noise (harsh),
#   special: a dedicated generator (yawn, snore, giggle, purr, crunch, warble).
EMOTIONS = {
    "happy":    dict(pitch=1.22, speed=1.15, reps=2, tilt=0.22, gain=1.0),
    "content":  dict(pitch=1.08, speed=1.0, reps=1, tilt=0.08, gain=0.9),
    "okay":     dict(pitch=1.0, speed=1.0, reps=1, tilt=0.0, gain=0.8),
    "sad":      dict(pitch=0.86, speed=0.72, reps=1, tilt=-0.25, gain=0.7, vib=0.025),
    "very_sad": dict(pitch=0.76, speed=0.6, reps=2, tilt=-0.32, gain=0.65, vib=0.035),
    "tired":    dict(special="yawn", pitch=0.82, gain=0.7),
    "hungry":   dict(pitch=1.05, speed=1.1, reps=3, tilt=0.15, gain=0.85),
    "grumpy":   dict(pitch=0.78, speed=1.25, reps=1, tilt=-0.2, gain=0.9, noise=0.22),
    "sleeping": dict(special="snore", pitch=0.7, gain=0.45),
    # events
    "tickle":   dict(special="giggle", pitch=1.3, gain=0.95),
    "pet":      dict(special="purr", pitch=1.0, gain=0.8),
    "eat":      dict(special="crunch", pitch=1.1, gain=0.85),
    "dizzy":    dict(special="warble", pitch=1.0, gain=0.85),
    "angry":    dict(pitch=0.72, speed=1.35, reps=2, tilt=-0.15, gain=1.0, noise=0.3),
    "wake":     dict(pitch=1.05, speed=0.9, reps=1, tilt=0.18, gain=0.8),
    "greet":    dict(pitch=1.18, speed=1.1, reps=2, tilt=0.25, gain=0.95),
}

MOODS = ("happy", "content", "okay", "sad", "very_sad", "tired", "hungry", "grumpy", "sleeping")
EVENTS = ("tickle", "pet", "eat", "dizzy", "angry", "wake", "greet")


# ---------------------------------------------------------------- synthesis
def _wave(timbre: str, phase: float) -> float:
    if timbre == "sine":
        return math.sin(phase)
    if timbre == "tri":
        return (2 / math.pi) * math.asin(math.sin(phase))
    if timbre == "square":  # soft square: first odd harmonics
        return (math.sin(phase) + math.sin(3 * phase) / 3 + math.sin(5 * phase) / 5) * 0.85
    if timbre == "saw":     # soft saw: first harmonics
        return (math.sin(phase) - math.sin(2 * phase) / 2 + math.sin(3 * phase) / 3
                - math.sin(4 * phase) / 4) * 0.62
    if timbre == "nasal":   # narrow pulse-ish
        return (math.sin(phase) + 0.8 * math.sin(2 * phase) + 0.6 * math.sin(3 * phase)
                + 0.4 * math.sin(4 * phase)) * 0.38
    return math.sin(phase)


def _contour_at(points, x):
    if len(points) == 1:
        return points[0]
    pos = x * (len(points) - 1)
    i = min(int(pos), len(points) - 2)
    frac = pos - i
    return points[i] + (points[i + 1] - points[i]) * frac


def _note(rng, f0, dur, timbre, contour, vib=0.0, noise=0.0, am=None, attack=0.012,
          release=0.05, amp=1.0):
    n = max(1, int(dur * SR))
    out = [0.0] * n
    if timbre == "bell":
        partials = ((1.0, 1.0), (2.76, 0.5), (5.4, 0.25), (8.93, 0.12))
        for k in range(n):
            tt = k / SR
            env = math.exp(-tt * 7.0) * min(1.0, k / (0.004 * SR))
            f = f0 * _contour_at(contour, k / n)
            s = sum(a * math.sin(2 * math.pi * f * m * tt) for m, a in partials)
            out[k] = s * 0.5 * env * amp
        return out
    phase = 0.0
    lp = 0.0
    vib_rate = rng.uniform(5.5, 7.5)
    att = max(1, int(attack * SR))
    rel = max(1, int(min(release, dur * 0.6) * SR))
    for k in range(n):
        x = k / n
        f = f0 * _contour_at(contour, x)
        if vib:
            f *= 1.0 + vib * math.sin(2 * math.pi * vib_rate * k / SR)
        phase += 2 * math.pi * f / SR
        s = _wave(timbre, phase)
        if noise:
            lp += 0.35 * (rng.uniform(-1, 1) - lp)
            s = s * (1 - noise) + lp * noise * 2.2
        if am:
            rate, depth = am
            s *= 1 - depth * (0.5 + 0.5 * math.sin(2 * math.pi * rate * k / SR))
        env = 1.0
        if k < att:
            env = k / att
        elif k > n - rel:
            env = max(0.0, (n - k) / rel)
        out[k] = s * env * amp
    return out


def _silence(seconds):
    return [0.0] * int(seconds * SR)


def _noise_burst(rng, dur, cutoff=0.25, amp=1.0, decay=30.0):
    n = int(dur * SR)
    lp = 0.0
    out = []
    for k in range(n):
        lp += cutoff * (rng.uniform(-1, 1) - lp)
        out.append(lp * amp * math.exp(-decay * k / SR) * 2.5)
    return out


def _tilted(contour, tilt):
    if not tilt:
        return list(contour)
    last = len(contour) - 1 or 1
    return [c * (1 + tilt * (i / last)) for i, c in enumerate(contour)]


def _call(rng, voice, emo, pitch_jitter=0.04):
    """One call of the animal coloured by the emotion."""
    f0 = voice["f0"] * emo.get("pitch", 1.0) * (1 + rng.uniform(-pitch_jitter, pitch_jitter))
    dur = voice["dur"] / emo.get("speed", 1.0)
    contour = _tilted(SHAPES[voice["shape"]], emo.get("tilt", 0.0))
    vib = max(voice.get("vib", 0.0), emo.get("vib", 0.0))
    noise = min(0.6, voice.get("noise", 0.0) + emo.get("noise", 0.0))
    shape = voice["shape"]
    if shape == "ribbit":       # two quick pulses
        half = _note(rng, f0, dur * 0.45, voice["timbre"], contour, vib, noise, voice.get("am"))
        return half + _silence(0.03) + _note(rng, f0 * 0.94, dur * 0.5, voice["timbre"], contour, vib,
                                              noise, voice.get("am"))
    if shape == "hoot":         # hoo-hoo
        a = _note(rng, f0, dur * 0.5, voice["timbre"], contour, vib, noise, attack=0.03, release=0.08)
        b = _note(rng, f0 * 0.86, dur * 0.7, voice["timbre"], contour, vib, noise, attack=0.03, release=0.12)
        return a + _silence(0.07) + b
    if shape == "tweet":        # trill of three chirps
        seq = []
        for i in range(3):
            seq += _note(rng, f0 * (1 + 0.08 * i), dur, "sine", contour, 0, 0, attack=0.004, release=0.02)
            seq += _silence(0.025)
        return seq
    if shape == "bubble":       # blub-blub
        seq = []
        for i in range(3):
            seq += _note(rng, f0 * rng.uniform(0.85, 1.25), dur, "sine", contour, 0, 0, attack=0.003,
                         release=0.03, amp=0.9)
            seq += _silence(rng.uniform(0.03, 0.07))
        return seq
    if shape == "sparkle":      # twinkles
        seq = []
        for i in range(4):
            seq += _note(rng, f0 * (1.0 + 0.12 * rng.randint(0, 4)), dur, "bell", contour)[: int(dur * SR)]
            seq += _silence(0.02)
        return seq
    if shape == "chime":
        return _note(rng, f0, dur, "bell", contour)
    release = 0.12 if shape in ("moan", "hum", "growl", "buzz") else 0.05
    attack = 0.04 if shape in ("moan", "hum") else 0.012
    return _note(rng, f0, dur, voice["timbre"], contour, vib, noise, voice.get("am"), attack, release)


def _special(rng, voice, emo):
    kind = emo["special"]
    f0 = voice["f0"] * emo.get("pitch", 1.0)
    timbre = voice["timbre"] if voice["timbre"] != "bell" else "sine"
    if kind == "giggle":        # quick rising hee-hee-hee
        seq = []
        steps = 4 if voice["dur"] > 0.08 else 5
        for i in range(steps):
            seq += _note(rng, f0 * (1 + 0.1 * i), min(0.09, voice["dur"] * 0.6 + 0.03), timbre,
                         [1.0, 1.15], 0, voice.get("noise", 0) * 0.5, attack=0.004, release=0.03)
            seq += _silence(0.035)
        return seq
    if kind == "purr":          # soft rumble + happy little call
        base = max(70.0, min(f0 * 0.25, 160.0))
        rumble = _note(rng, base, 0.75, "saw", [1.0, 1.02, 0.98], 0, 0.35, (24, 0.8),
                       attack=0.08, release=0.2, amp=0.7)
        return rumble + _call(rng, voice, EMOTIONS["content"])
    if kind == "crunch":        # nom nom crunches + happy call
        seq = []
        for _ in range(3):
            seq += _noise_burst(rng, 0.07, cutoff=0.6, amp=0.8, decay=45)
            seq += _silence(0.06)
        return seq + _call(rng, voice, EMOTIONS["happy"])
    if kind == "warble":        # dizzy wobble
        return _note(rng, f0, 0.7, timbre, [1.0, 1.3, 0.8, 1.25, 0.75, 1.1], 0.09,
                     voice.get("noise", 0), voice.get("am"), attack=0.02, release=0.15)
    if kind == "yawn":          # long, low, breathy glide down
        dur = max(0.7, voice["dur"] * 2.2)
        yawn = _note(rng, f0, dur, timbre, [1.0, 1.25, 1.1, 0.62], 0.01,
                     min(0.6, voice.get("noise", 0) + 0.3), attack=0.08, release=0.25)
        return yawn
    if kind == "snore":         # two soft breaths, in and out
        seq = []
        for _ in range(2 if voice["dur"] < 0.3 else 1):
            inhale = _note(rng, max(60.0, min(f0 * 0.3, 140.0)), 0.55, "saw", [0.95, 1.05], 0, 0.7,
                           (18, 0.6), attack=0.2, release=0.25, amp=0.6)
            exhale = _noise_burst(rng, 0.5, cutoff=0.08, amp=0.35, decay=3)
            seq += inhale + exhale + _silence(0.15)
        return seq
    return _call(rng, voice, EMOTIONS["okay"])


def synthesize(species: str, kind: str, variant: int = 0) -> list:
    voice = VOICES.get(species) or VOICES["cat"]
    emo = EMOTIONS.get(kind) or EMOTIONS["okay"]
    seed = int(hashlib.md5(f"{species}:{kind}:{variant}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    if emo.get("special"):
        samples = _special(rng, voice, emo)
    else:
        samples = []
        for i in range(emo.get("reps", 1)):
            if samples and len(samples) / SR > 1.2:   # keep long voices (whale ...) short enough
                break
            samples += _call(rng, voice, emo)
            samples += _silence(rng.uniform(0.05, 0.11) / emo.get("speed", 1.0))
    peak = max((abs(s) for s in samples), default=0.0) or 1.0
    gain = emo.get("gain", 1.0) / peak
    return [s * gain for s in samples] + _silence(0.03)


def _write_wav(path: Path, samples, volume: float):
    frames = bytearray()
    level = 0.75 * max(0.0, min(1.0, volume))
    for s in samples:
        frames += struct.pack("<h", int(max(-1.0, min(1.0, s * level)) * 32767))
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))
    tmp.replace(path)


# ---------------------------------------------------------------- playback
class PetVoice:
    """Plays pet sounds without blocking the UI and without stopping the soundscape."""

    def __init__(self):
        self._lock = threading.Lock()
        self._playing = 0
        self._last = 0.0
        self._counter = 0
        try:
            self._mci = ctypes.windll.winmm.mciSendStringW
        except Exception:  # not Windows
            self._mci = None

    @property
    def available(self) -> bool:
        return self._mci is not None

    def clip_path(self, species: str, kind: str, volume: float, variant: int | None = None) -> Path:
        if variant is None:
            variant = random.randrange(VARIANTS)
        vol_step = int(round(max(0.0, min(1.0, volume)) * 10))
        path = CACHE_DIR / f"{species}_{kind}_{variant}_v{vol_step}.wav"
        if not path.exists():
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _write_wav(path, synthesize(species, kind, variant), vol_step / 10)
        return path

    def play(self, species: str, kind: str, volume: float = 0.6) -> bool:
        if not self.available or volume <= 0:
            return False
        now = time.monotonic()
        with self._lock:
            if now - self._last < MIN_GAP_S or self._playing >= MAX_PLAYING:
                return False
            self._last = now
            self._playing += 1
            self._counter += 1
            alias = f"pipspet{self._counter}"
        threading.Thread(target=self._worker, args=(species, kind, volume, alias), daemon=True).start()
        return True

    def _worker(self, species, kind, volume, alias):
        try:
            path = self.clip_path(species, kind, volume)
            buf = ctypes.create_unicode_buffer(128)
            rc = self._mci(f'open "{path}" type waveaudio alias {alias}', buf, 127, 0)
            if rc == 0:
                self._mci(f"play {alias} wait", buf, 127, 0)
                self._mci(f"close {alias}", buf, 127, 0)
            else:
                logger.debug("MCI open failed (%s) for %s", rc, path)
        except Exception as exc:
            logger.debug("pet sound failed: %s", exc)
        finally:
            with self._lock:
                self._playing -= 1


if __name__ == "__main__":  # quick listening test: python pet_sounds.py cat
    import sys
    species = sys.argv[1] if len(sys.argv) > 1 else "cat"
    voice = PetVoice()
    for kind in MOODS + EVENTS:
        print(species, kind)
        voice._last = 0
        voice.play(species, kind, 0.7)
        time.sleep(1.8)
