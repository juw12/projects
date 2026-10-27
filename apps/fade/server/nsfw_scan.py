"""Server-side copy of the on-device safety check: the NSFWJS MobileNetV2 model run with numpy.

The apps classify uploads on the uploader's phone (web/scan.js), but a modified app can lie about the
result. A Fade server therefore re-checks every upload itself with the *same* model files the apps use
(web/vendor/nsfw/model), so its verdict doesn't depend on trusting the client.

    model = NsfwModel.load(numpy_module)
    probabilities = model.classify(rgb_uint8_array)   # {"Drawing":..,"Hentai":..,"Neutral":..,"Porn":..,"Sexy":..}

Only numpy is needed (the server fetches it into its data folder when missing, see ensure_numpy()).
Frames are decoded by ffmpeg (frames_for_scan()), which the server already provisions for transcoding.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

CLASSES = ("Drawing", "Hentai", "Neutral", "Porn", "Sexy")
MODEL_NAME = "nsfwjs-mobilenetv2"
MODEL_DIR = Path(__file__).resolve().parent.parent / "web" / "vendor" / "nsfw" / "model"
INPUT_SIZE = 224
FRAME_SIZE = 448          # the apps draw frames on a canvas of at most 448 px before classifying
MAX_VIDEO_FRAMES = 8      # the server samples more of a video than the phone does (3 frames)
MAX_VIDEO_SECONDS = 60
NUMPY_SPEC = "numpy>=1.21,<3"


def ensure_numpy(pylib: Path, install=True, timeout=600):
    """Import numpy; if missing, pip-install a binary wheel into <data>/pylib once and import it from there."""
    try:
        import numpy  # noqa: F401
        return numpy, "system"
    except ImportError:
        pass
    pylib = Path(pylib)
    if str(pylib) not in sys.path:
        sys.path.insert(0, str(pylib))
    try:
        import numpy  # noqa: F811
        return numpy, "downloaded"
    except ImportError:
        if not install:
            raise RuntimeError("numpy is not installed")
    pylib.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--quiet",
               "--only-binary=:all:", "--no-deps", "--target", str(pylib), NUMPY_SPEC]
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    if result.returncode != 0:
        tail = (result.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or ["pip failed"]
        raise RuntimeError(f"could not install numpy: {tail[0][:160]}")
    import importlib
    importlib.invalidate_caches()
    import numpy  # noqa: F811
    return numpy, "downloaded"


class NsfwModel:
    """Minimal Keras-layers interpreter for the 162-layer NSFWJS MobileNetV2 (TF.js uint8-quantized weights)."""

    SUPPORTED = {"InputLayer", "ZeroPadding2D", "Conv2D", "DepthwiseConv2D", "BatchNormalization", "ReLU", "Add",
                 "AveragePooling2D", "Flatten", "Dense", "Dropout"}

    def __init__(self, np, spec, weights):
        self.np = np
        config = spec["modelTopology"]["model_config"]["config"]
        self.layers = config["layers"]
        self.output_name = config["output_layers"][0][0]
        unknown = {layer["class_name"] for layer in self.layers} - self.SUPPORTED
        if unknown:
            raise ValueError(f"unsupported layers: {sorted(unknown)}")
        self.w = weights
        self._fold_batchnorm()

    @classmethod
    def load(cls, np, model_dir=MODEL_DIR):
        model_dir = Path(model_dir)
        spec = json.loads((model_dir / "model.json").read_text())
        weights = {}
        for group in spec["weightsManifest"]:
            blob = b"".join((model_dir / name).read_bytes() for name in group["paths"])
            offset = 0
            for entry in group["weights"]:
                count = 1
                for dim in entry["shape"]:
                    count *= dim
                quant = entry.get("quantization")
                if quant:
                    width = {"uint8": 1, "uint16": 2}[quant["dtype"]]
                    raw = np.frombuffer(blob, dtype=quant["dtype"], count=count, offset=offset)
                    value = raw.astype(np.float32) * np.float32(quant["scale"]) + np.float32(quant["min"])
                else:
                    width = 4
                    value = np.frombuffer(blob, dtype=np.float32, count=count, offset=offset).copy()
                offset += count * width
                weights[entry["name"]] = value.reshape(entry["shape"]).astype(np.float32)
        return cls(np, spec, weights)

    def _fold_batchnorm(self):
        """Pre-compute BatchNormalization as a per-channel multiply + add."""
        np = self.np
        self.bn = {}
        for layer in self.layers:
            if layer["class_name"] != "BatchNormalization":
                continue
            name = layer["config"]["name"]
            eps = layer["config"].get("epsilon", 1e-3)
            gamma = self.w.get(f"{name}/gamma")
            beta = self.w.get(f"{name}/beta")
            mean = self.w[f"{name}/moving_mean"]
            var = self.w[f"{name}/moving_variance"]
            gamma = np.ones_like(mean) if gamma is None else gamma
            beta = np.zeros_like(mean) if beta is None else beta
            scale = gamma / np.sqrt(var + np.float32(eps))
            self.bn[name] = (scale.astype(np.float32), (beta - mean * scale).astype(np.float32))

    # ----- ops (single image, HWC float32) -----
    def _same_pad(self, x, kernel, stride):
        np = self.np
        pads = []
        for axis, k in ((0, kernel[0]), (1, kernel[1])):
            size = x.shape[axis]
            out = -(-size // stride[axis])
            total = max((out - 1) * stride[axis] + k - size, 0)
            pads.append((total // 2, total - total // 2))
        if any(p for pair in pads for p in pair):
            x = np.pad(x, (pads[0], pads[1], (0, 0)))
        return x

    @staticmethod
    def _out_size(size, k, s):
        return (size - k) // s + 1

    def _conv2d(self, x, layer):
        np = self.np
        cfg = layer["config"]
        kernel = self.w[f"{cfg['name']}/kernel"]
        kh, kw, cin, cout = kernel.shape
        sh, sw = cfg["strides"]
        if cfg["padding"] == "same":
            x = self._same_pad(x, (kh, kw), (sh, sw))
        if kh == kw == 1 and sh == sw == 1:
            out = x.reshape(-1, cin) @ kernel.reshape(cin, cout)
            out = out.reshape(x.shape[0], x.shape[1], cout)
        else:
            oh, ow = self._out_size(x.shape[0], kh, sh), self._out_size(x.shape[1], kw, sw)
            cols = [x[i:i + sh * (oh - 1) + 1:sh, j:j + sw * (ow - 1) + 1:sw, :] for i in range(kh) for j in range(kw)]
            patches = np.concatenate(cols, axis=-1).reshape(oh * ow, kh * kw * cin)
            out = (patches @ kernel.reshape(kh * kw * cin, cout)).reshape(oh, ow, cout)
        if cfg.get("use_bias"):
            out = out + self.w[f"{cfg['name']}/bias"]
        return self._activation(out, cfg.get("activation"))

    def _depthwise(self, x, layer):
        cfg = layer["config"]
        kernel = self.w[f"{cfg['name']}/depthwise_kernel"]
        kh, kw, channels, multiplier = kernel.shape
        if multiplier != 1:
            raise ValueError("depth_multiplier != 1 not supported")
        sh, sw = cfg["strides"]
        if cfg["padding"] == "same":
            x = self._same_pad(x, (kh, kw), (sh, sw))
        oh, ow = self._out_size(x.shape[0], kh, sh), self._out_size(x.shape[1], kw, sw)
        out = None
        for i in range(kh):
            for j in range(kw):
                term = x[i:i + sh * (oh - 1) + 1:sh, j:j + sw * (ow - 1) + 1:sw, :] * kernel[i, j, :, 0]
                out = term if out is None else out + term
        if cfg.get("use_bias"):
            out = out + self.w[f"{cfg['name']}/bias"]
        return self._activation(out, cfg.get("activation"))

    def _activation(self, x, name):
        np = self.np
        if name in (None, "linear"):
            return x
        if name == "relu":
            return np.maximum(x, 0)
        if name == "relu6":
            return np.clip(x, 0, 6)
        if name == "softmax":
            shifted = np.exp(x - x.max())
            return shifted / shifted.sum()
        raise ValueError(f"unsupported activation {name}")

    def _run_layer(self, layer, inputs):
        np = self.np
        kind = layer["class_name"]
        cfg = layer["config"]
        x = inputs[0]
        if kind in ("InputLayer", "Dropout"):
            return x
        if kind == "ZeroPadding2D":
            (top, bottom), (left, right) = cfg["padding"]
            return np.pad(x, ((top, bottom), (left, right), (0, 0)))
        if kind == "Conv2D":
            return self._conv2d(x, layer)
        if kind == "DepthwiseConv2D":
            return self._depthwise(x, layer)
        if kind == "BatchNormalization":
            scale, shift = self.bn[cfg["name"]]
            return x * scale + shift
        if kind == "ReLU":
            if cfg.get("negative_slope") or cfg.get("threshold"):
                raise ValueError("leaky/thresholded ReLU not supported")
            top = cfg.get("max_value")
            return np.clip(x, 0, top) if top is not None else np.maximum(x, 0)
        if kind == "Add":
            total = inputs[0]
            for other in inputs[1:]:
                total = total + other
            return total
        if kind == "AveragePooling2D":
            ph, pw = cfg["pool_size"]
            sh, sw = cfg["strides"] or cfg["pool_size"]
            oh, ow = self._out_size(x.shape[0], ph, sh), self._out_size(x.shape[1], pw, sw)
            out = np.empty((oh, ow, x.shape[2]), dtype=np.float32)
            for r in range(oh):
                for c in range(ow):
                    out[r, c] = x[r * sh:r * sh + ph, c * sw:c * sw + pw].mean(axis=(0, 1))
            return out
        if kind == "Flatten":
            return x.reshape(-1)
        if kind == "Dense":
            out = x @ self.w[f"{cfg['name']}/kernel"]
            if cfg.get("use_bias", True):
                out = out + self.w[f"{cfg['name']}/bias"]
            return self._activation(out, cfg.get("activation"))
        raise ValueError(kind)

    def predict(self, tensor):
        """tensor: (224, 224, 3) float32 in [0, 1]. Returns the 5 class probabilities."""
        values = {}
        for layer in self.layers:
            name = layer["config"]["name"]
            if layer["class_name"] == "InputLayer":
                values[name] = tensor
                continue
            sources = [values[node[0]] for node in layer["inbound_nodes"][0]]
            values[name] = self._run_layer(layer, sources)
        return values[self.output_name]

    # ----- preprocessing (same as nsfwjs.classify: /255 then bilinear resize with align_corners) -----
    def prepare(self, rgb):
        np = self.np
        image = np.asarray(rgb, dtype=np.float32)[..., :3] / np.float32(255)
        return self._resize_align_corners(image, INPUT_SIZE, INPUT_SIZE)

    def _resize_align_corners(self, image, out_h, out_w):
        np = self.np
        in_h, in_w = image.shape[:2]
        if (in_h, in_w) == (out_h, out_w):
            return image

        def axis(in_size, out_size):
            scale = (in_size - 1) / (out_size - 1) if out_size > 1 else 0.0
            src = np.arange(out_size, dtype=np.float32) * np.float32(scale)
            low = np.floor(src).astype(np.int64)
            high = np.minimum(low + 1, in_size - 1)
            return low, high, (src - low).astype(np.float32)

        y0, y1, fy = axis(in_h, out_h)
        x0, x1, fx = axis(in_w, out_w)
        top = image[y0][:, x0] + (image[y0][:, x1] - image[y0][:, x0]) * fx[None, :, None]
        bottom = image[y1][:, x0] + (image[y1][:, x1] - image[y1][:, x0]) * fx[None, :, None]
        return (top + (bottom - top) * fy[:, None, None]).astype(np.float32)

    def classify(self, rgb):
        probabilities = self.predict(self.prepare(rgb))
        return {name: float(probabilities[i]) for i, name in enumerate(CLASSES)}


def summarize(results):
    """Worst case over frames, same scoring as web/scan.js: nsfw = porn + hentai, sexy separately."""
    worst = {"nsfw": 0.0, "sexy": 0.0}
    for probs in results:
        worst["nsfw"] = max(worst["nsfw"], probs["Porn"] + probs["Hentai"])
        worst["sexy"] = max(worst["sexy"], probs["Sexy"])
    return {"nsfw": round(worst["nsfw"], 4), "sexy": round(worst["sexy"], 4), "frames": len(results), "model": MODEL_NAME}


def media_duration(ffmpeg, path):
    result = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, timeout=60)
    match = re.search(rb"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr or b"")
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def frames_for_scan(np, ffmpeg, path, kind, max_frames=MAX_VIDEO_FRAMES):
    """Decode the photo, or up to max_frames evenly spread over the first 60 s of a video, as 448x448 RGB."""
    size = FRAME_SIZE
    frame_bytes = size * size * 3
    scale = f"scale={size}:{size}:flags=bilinear,format=rgb24"
    command = [ffmpeg, "-hide_banner", "-loglevel", "error"]
    if kind == "image":
        command += ["-i", str(path), "-frames:v", "1", "-vf", scale]
    else:
        duration = min(media_duration(ffmpeg, path) or 3.0, MAX_VIDEO_SECONDS)
        count = max(1, min(max_frames, int(duration / 0.75) or 1))
        stamps = [duration * (i + 0.5) / count for i in range(count)]
        frames = []
        for stamp in stamps:  # seeking per frame stays fast on long files and keeps memory flat
            one = [ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", f"{stamp:.3f}", "-i", str(path),
                   "-frames:v", "1", "-vf", scale, "-f", "rawvideo", "-"]
            result = subprocess.run(one, capture_output=True, timeout=60)
            if result.returncode == 0 and len(result.stdout) >= frame_bytes:
                frames.append(np.frombuffer(result.stdout[:frame_bytes], dtype=np.uint8).reshape(size, size, 3))
        return frames
    command += ["-f", "rawvideo", "-"]
    result = subprocess.run(command, capture_output=True, timeout=60)
    if result.returncode != 0 or len(result.stdout) < frame_bytes:
        return []
    return [np.frombuffer(result.stdout[:frame_bytes], dtype=np.uint8).reshape(size, size, 3)]


class ServerScanner:
    """Loads numpy + the model lazily (thread-safe enough for the server's background threads)."""

    def __init__(self, pylib: Path, install=True, model_dir=MODEL_DIR):
        self.pylib = Path(pylib)
        self.install = install
        self.model_dir = Path(model_dir)
        self.model = None
        self.np = None
        self.status = "idle"

    def ready(self):
        if self.model is None:
            self.status = "loading"
            np, source = ensure_numpy(self.pylib, self.install)
            self.np = np
            self.model = NsfwModel.load(np, self.model_dir)
            self.status = f"ready ({source} numpy {np.__version__})"
        return self.model

    def scan_file(self, ffmpeg, path, kind):
        model = self.ready()
        frames = frames_for_scan(self.np, ffmpeg, path, kind)
        if not frames:
            return None
        return summarize([model.classify(frame) for frame in frames])


if __name__ == "__main__":  # python3 nsfw_scan.py /path/to/ffmpeg file.jpg|file.mp4
    import time
    scanner = ServerScanner(Path(__file__).resolve().parent / "data" / "pylib")
    started = time.time()
    target = Path(sys.argv[2])
    kind = "image" if target.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".gif") else "video"
    print(json.dumps(scanner.scan_file(sys.argv[1], target, kind)), f"{time.time() - started:.2f}s", scanner.status)
