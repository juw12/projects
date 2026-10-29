"""Free own-voice narration: edge-tts base voice + OpenVoice V2 tone-colour conversion (MIT, CPU).

    python voice_convert.py setup                      # one-time: fetch OpenVoice code + converter weights
    python voice_convert.py batch in1.mp3 out1.wav ... # convert clips to the owner's voice

The owner's timbre comes from secrets/voice/sample.wav (recorded with voice_recorder.py).
Rhythm/accent stay those of the base voice; only the voice colour is changed. No API, no cost.
Runs on CPU (~2x real time on an Intel laptop); works the same in GitHub Actions.

Needs: torch (CPU), librosa, soundfile, huggingface_hub, edge-tts.
Paths can be overridden with OPENVOICE_REPO / OPENVOICE_CKPT.
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOICE_DIR = HERE / "secrets" / "voice"
SAMPLE = VOICE_DIR / "sample.wav"
CACHE = HERE / ".openvoice"
REPO = Path(os.environ.get("OPENVOICE_REPO", CACHE / "OpenVoice"))
CKPT = Path(os.environ.get("OPENVOICE_CKPT", CACHE / "checkpoints_v2" / "converter"))
DEFAULT_BASE = "id-ID-ArdiNeural"

# Varied Indonesian text so the base-voice embedding covers many sounds (same text as the recorder).
REFERENCE_TEXT = (
    "Halo semuanya! Selamat datang di Galau Checkout. Channel buat kamu yang jempolnya lebih cepat dari "
    "otaknya, tiap kali lihat tulisan diskon. Coba kita hitung pelan-pelan. Harga HP-nya empat puluh lima "
    "juta, enam ratus tujuh puluh delapan ribu rupiah. Kalau dipakai tiga tahun, itu sekitar empat puluh "
    "satu ribu per hari. Setiap hari. Termasuk hari Minggu. Terus muncul suara kecil di kepala: tapi kan "
    "buat kerja, tapi kan lagi promo, tapi kan aku pantas dapat hadiah. Hmm. Familiar nggak? Itu namanya "
    "pembenaran. Otak kita jago banget cari alasan setelah hati sudah memutuskan. Jadi sebelum klik bayar, "
    "tanya satu hal sederhana: barang ini menyelesaikan masalah apa? Dan yang paling lucu, cicilan nol "
    "persen itu sering bikin kita merasa barangnya gratis. Padahal enggak, ya! Totalnya tetap sama."
)


def setup():
    if not REPO.exists():
        subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/myshell-ai/OpenVoice.git",
                        str(REPO)], check=True)
    from huggingface_hub import hf_hub_download

    for name in ("converter/config.json", "converter/checkpoint.pth"):
        hf_hub_download("myshell-ai/OpenVoiceV2", name, local_dir=str(CKPT.parent))
    print("OpenVoice ready:", REPO, CKPT)


def load_converter():
    import torch

    sys.path.insert(0, str(REPO))
    from openvoice.api import OpenVoiceBaseClass, ToneColorConverter

    torch.set_num_threads(max(1, os.cpu_count() or 1))
    converter = ToneColorConverter.__new__(ToneColorConverter)
    # base-class init skips the optional wavmark watermark model (extra heavy dependency)
    OpenVoiceBaseClass.__init__(converter, str(CKPT / "config.json"), device="cpu")
    converter.load_ckpt(str(CKPT / "checkpoint.pth"))
    converter.watermark_model = None
    converter.version = getattr(converter.hps, "_version_", "v1")
    return converter


def split_reference(wav_path, prefix, work_dir, seconds=10):
    import librosa
    import soundfile

    audio, rate = librosa.load(str(wav_path), sr=22050)
    step = seconds * rate
    pieces = []
    for start in range(0, max(1, len(audio) - 3 * rate), step):
        piece = Path(work_dir) / f"{prefix}_{start // step:02d}.wav"
        soundfile.write(str(piece), audio[start:start + step], rate)
        pieces.append(str(piece))
    return pieces


def embedding(converter, name, make_reference):
    """Speaker embedding cached in secrets/voice/<name>.pth (rebuilt if the sample changes)."""
    import tempfile

    import torch

    cache = VOICE_DIR / f"{name}.pth"
    if cache.exists() and (name != "target_se" or cache.stat().st_mtime >= SAMPLE.stat().st_mtime):
        return torch.load(str(cache))
    with tempfile.TemporaryDirectory() as work_dir:
        reference = make_reference(work_dir)
        result = converter.extract_se(split_reference(reference, name, work_dir))
    torch.save(result, str(cache))
    return result


def base_reference(base_voice):
    def make(work_dir):
        tool = str(Path(sys.executable).with_name("edge-tts"))
        out = Path(work_dir) / "base_ref.mp3"
        subprocess.run([tool, "--voice", base_voice, "--text", REFERENCE_TEXT, "--write-media", str(out)],
                       check=True, capture_output=True)
        return out

    return make


def batch(pairs, base_voice=DEFAULT_BASE, tau=0.3):
    if not SAMPLE.exists():
        raise SystemExit(f"Missing {SAMPLE}: record it with voice_recorder.py")
    converter = load_converter()
    target = embedding(converter, "target_se", lambda work_dir: SAMPLE)
    source = embedding(converter, f"source_se_{base_voice}", base_reference(base_voice))
    for src, dst in pairs:
        converter.convert(audio_src_path=str(src), src_se=source, tgt_se=target, output_path=str(dst), tau=tau)
        print("converted", dst, flush=True)


def main(argv):
    if argv[:1] == ["setup"]:
        setup()
    elif argv[:1] == ["batch"] and len(argv) >= 3 and len(argv) % 2 == 1:
        files = argv[1:]
        batch(list(zip(files[0::2], files[1::2])),
              base_voice=os.environ.get("OPENVOICE_BASE", DEFAULT_BASE),
              tau=float(os.environ.get("OPENVOICE_TAU", "0.3")))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
