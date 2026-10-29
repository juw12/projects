"""Shared helpers for the short-video renderers (audio, voice, captions, encoding)."""

import shutil
import subprocess
import wave
from functools import lru_cache
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageFont

WIDTH, HEIGHT = 1080, 1920
FPS = 30
SAMPLE_RATE = 48000
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SUPP = "/System/Library/Fonts/Supplemental/"
FONT_BLACK = SUPP + "Arial Black.ttf"
FONT_BOLD = SUPP + "Arial Bold.ttf"
FONT_REG = SUPP + "Arial.ttf"
FONT_SERIF_BOLD = SUPP + "Georgia Bold.ttf"
FONT_SERIF = SUPP + "Georgia.ttf"
FONT_SERIF_ITALIC = SUPP + "Georgia Italic.ttf"

VOICES = {
    "en": ("Daniel", 172),
    "id": ("Damayanti", 200),
}

# Neural voices (Microsoft Edge online TTS via edge-tts); falls back to `say` if offline.
NEURAL_VOICES = {
    "en": ("en-US-AndrewNeural", "+4%"),
    "id": ("id-ID-ArdiNeural", "+6%"),
}
EDGE_TTS = shutil.which("edge-tts") or "edge-tts"


@lru_cache(maxsize=None)
def font(path, size):
    return ImageFont.truetype(path, size)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(a, b, t):
    return tuple(int(lerp(a[i], b[i], t)) for i in range(3))


# --------------------------------------------------------------------------
# Voice
# --------------------------------------------------------------------------
def read_wav_mono(path):
    with wave.open(str(path), "rb") as handle:
        frames = handle.readframes(handle.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def synthesize_voice(build_dir, tag, text, lang):
    wav_path = build_dir / f"vo_{tag}.wav"
    mp3_path = build_dir / f"vo_{tag}.mp3"
    neural_voice, neural_rate = NEURAL_VOICES[lang]
    try:
        subprocess.run([EDGE_TTS, "--voice", neural_voice, f"--rate={neural_rate}", "--text", text,
                        "--write-media", str(mp3_path)], check=True, capture_output=True, timeout=60)
        source = mp3_path
    except (subprocess.SubprocessError, OSError) as error:
        print(f"edge-tts failed ({error}); falling back to macOS say", flush=True)
        voice, rate = VOICES[lang]
        source = build_dir / f"vo_{tag}.aiff"
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(source), text], check=True)
    # light cleanup: high-pass rumble, gentle compression, trim leading/trailing silence
    audio_filter = ("highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=80,"
                    "silenceremove=start_periods=1:start_threshold=-45dB,"
                    "areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(source), "-af", audio_filter,
                    "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav_path)], check=True)
    return read_wav_mono(wav_path)


def caption_chunks(caption, words_per_chunk=3, max_chars=None):
    words = caption.split()
    if max_chars is None:
        chunks = [" ".join(words[i:i + words_per_chunk]) for i in range(0, len(words), words_per_chunk)]
    else:
        chunks, current = [], []
        for word in words:
            candidate = " ".join(current + [word])
            if current and (len(candidate) > max_chars or len(current) >= words_per_chunk):
                chunks.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            chunks.append(" ".join(current))
    weights = np.array([len(c) + 4 for c in chunks], dtype=float)
    starts = np.concatenate([[0], np.cumsum(weights)[:-1]]) / weights.sum()
    return list(zip(chunks, starts))


def current_chunk(scene, global_t):
    progress = (global_t - scene["vo_start"]) / scene["vo_dur"]
    if progress < 0:
        return None
    current = None
    for chunk, start in scene["chunks"]:
        if progress >= start:
            current = chunk
    return current


def build_timeline(scenes, build_dir, lang, lead_in=0.15, tail=0.45):
    build_dir.mkdir(parents=True, exist_ok=True)
    cursor = 0.0
    for index, scene in enumerate(scenes):
        scene["index"] = index
        scene["voice"] = synthesize_voice(build_dir, f"{lang}_{index:02d}", scene["say"], lang)
        scene["vo_dur"] = len(scene["voice"]) / SAMPLE_RATE
        scene["dur"] = max(scene.get("min_dur", 3.0), scene["vo_dur"] + lead_in + tail)
        scene["start"] = cursor
        scene["vo_start"] = cursor + lead_in
        scene["chunks"] = caption_chunks(scene["caption"])
        cursor += scene["dur"]
    return cursor


def scene_at(scenes, time_s):
    for scene in scenes:
        if scene["start"] <= time_s < scene["start"] + scene["dur"]:
            return scene
    return scenes[-1]


# --------------------------------------------------------------------------
# Audio synthesis
# --------------------------------------------------------------------------
def midi_hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def smooth_noise(n, kernel, seed):
    generator = np.random.default_rng(seed)
    noise = generator.standard_normal(n + kernel)
    window = np.ones(kernel) / kernel
    return np.convolve(noise, window, mode="valid")[:n]


def make_pad_music(duration_s, chords, chord_len=4.0, bpm=96, pluck_gain=0.035, pulse=False):
    """Soft pad + bass + arpeggio pluck. Optional kick/hat pulse."""
    t_all = np.arange(int(duration_s * SAMPLE_RATE)) / SAMPLE_RATE
    music = np.zeros_like(t_all)
    beat = 60.0 / bpm
    for k, start in enumerate(np.arange(0, duration_s, chord_len)):
        chord = chords[k % len(chords)]
        i0 = int(start * SAMPLE_RATE)
        i1 = min(len(t_all), int((start + chord_len) * SAMPLE_RATE))
        tt = t_all[i0:i1] - start
        envelope = np.minimum(tt / 1.0, 1.0) * np.minimum((chord_len - tt) / 1.0, 1.0)
        for note in chord:
            f = midi_hz(note - 12)
            music[i0:i1] += envelope * (np.sin(2 * np.pi * f * tt)
                                        + np.sin(2 * np.pi * f * 1.003 * tt)
                                        + 0.15 * np.sin(2 * np.pi * 2 * f * tt)) * 0.022
        music[i0:i1] += envelope * np.sin(2 * np.pi * midi_hz(chord[0] - 24) * tt) * 0.06
        steps = int(chord_len / (beat / 2))
        for step in range(steps):
            if step % 2 == 1 and step % 3 != 0:
                continue
            p0 = i0 + int(step * beat / 2 * SAMPLE_RATE)
            p1 = min(i1, p0 + int(0.6 * SAMPLE_RATE))
            if p0 >= p1:
                continue
            pt = np.arange(p1 - p0) / SAMPLE_RATE
            note = chord[step % 3] + 12
            attack = np.minimum(pt / 0.012, 1.0)
            music[p0:p1] += np.sin(2 * np.pi * midi_hz(note) * pt) * np.exp(-pt * 4) * attack * pluck_gain
    if pulse:
        beat_count = int(duration_s / beat)
        hat = smooth_noise(int(0.05 * SAMPLE_RATE), 1, seed=3)
        for b in range(beat_count):
            k0 = int(b * beat * SAMPLE_RATE)
            kt = np.arange(int(0.25 * SAMPLE_RATE)) / SAMPLE_RATE
            kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 12) * 0.12
            music[k0:k0 + len(kick)] += kick[: len(music) - k0]
            h0 = int((b + 0.5) * beat * SAMPLE_RATE)
            ht = np.arange(len(hat)) / SAMPLE_RATE
            seg = hat * np.exp(-ht * 60) * 0.03
            music[h0:h0 + len(seg)] += seg[: max(0, len(music) - h0)]
    kernel = np.ones(24) / 24  # gentle low-pass for a warmer, less "beepy" tone
    return np.convolve(music, kernel, mode="same")


def whoosh(length_s=0.9, seed=11):
    n = int(length_s * SAMPLE_RATE)
    noise = smooth_noise(n, 8, seed) - smooth_noise(n, 80, seed)
    t = np.arange(n) / n
    return noise * np.sin(np.pi * t) ** 2 * 1.4


def click(freq=1800, length_s=0.06):
    t = np.arange(int(length_s * SAMPLE_RATE)) / SAMPLE_RATE
    return (np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2.7 * t)) * np.exp(-t * 90)


def blip(freq=880, length_s=0.12):
    t = np.arange(int(length_s * SAMPLE_RATE)) / SAMPLE_RATE
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 30)


def place(track, clip, time_s, gain=1.0):
    i0 = int(time_s * SAMPLE_RATE)
    if i0 >= len(track):
        return
    end = min(len(track), i0 + len(clip))
    track[i0:end] += clip[: end - i0] * gain


def write_mix(path, scenes, total_s, music, sfx, music_gain=0.45):
    n = int(total_s * SAMPLE_RATE)
    voice = np.zeros(n, dtype=np.float32)
    for scene in scenes:
        place(voice, scene["voice"], scene["vo_start"])
    music = np.pad(music, (0, max(0, n - len(music))))[:n]
    sfx = np.pad(sfx, (0, max(0, n - len(sfx))))[:n]
    # duck music under voice
    voice_env = np.convolve(np.abs(voice), np.ones(SAMPLE_RATE // 5) / (SAMPLE_RATE // 5), mode="same")
    duck = 1.0 - 0.45 * np.clip(voice_env / 0.05, 0, 1)
    fade = np.minimum(1.0, (n - np.arange(n)) / (1.5 * SAMPLE_RATE))
    mix = voice + music * music_gain * duck * fade + sfx
    mix = mix / max(1e-6, np.abs(mix).max()) * 0.9
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes((mix * 32767).astype(np.int16).tobytes())
    return path


# --------------------------------------------------------------------------
# Encoding / preview
# --------------------------------------------------------------------------
def encode(output_path, audio_path, total_s, frame_fn, cover_path=None, cover_time=2.0):
    frame_count = int(total_s * FPS)
    command = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-i", str(audio_path),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
        str(output_path),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    for frame_index in range(frame_count):
        global_t = frame_index / FPS
        frame = frame_fn(global_t)
        encoder.stdin.write(frame.tobytes())
        if frame_index % 90 == 0:
            print(f"frame {frame_index}/{frame_count}", flush=True)
        if cover_path and frame_index == int(cover_time * FPS):
            frame.save(cover_path)
    encoder.stdin.close()
    encoder.wait()
    print(f"Done: {output_path}", flush=True)


def contact_sheet(path, scenes, frame_fn, fracs=(0.3, 0.85)):
    stills = []
    for scene in scenes:
        for frac in fracs:
            t = scene["start"] + scene["dur"] * frac
            stills.append(frame_fn(t).resize((270, 480), Image.LANCZOS))
    columns = len(scenes)
    sheet = Image.new("RGB", (270 * columns, 480 * len(fracs)), (0, 0, 0))
    for i, still in enumerate(stills):
        sheet.paste(still, ((i // len(fracs)) * 270, (i % len(fracs)) * 480))
    sheet.save(path)
    return path
