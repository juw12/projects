// Turns a photo into a cozy doodle on a canvas, entirely on the device.
// Styles mirror the Python/Core Image doodle prototypes: crayon, pencil, watercolor.

const MAX_SIDE = 720;

export async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img> decoding (older WebViews)
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function fitCanvas(source) {
  const w = source.width;
  const h = source.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function boxBlur(src, w, h, radius) {
  // Separable box blur on a single channel Float32Array.
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / size;
      const add = src[y * w + Math.min(w - 1, x + radius + 1)];
      const sub = src[y * w + Math.max(0, x - radius)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / size;
      const add = tmp[Math.min(h - 1, y + radius + 1) * w + x];
      const sub = tmp[Math.max(0, y - radius) * w + x];
      acc += add - sub;
    }
  }
  return out;
}

function channels(data, w, h) {
  const n = w * h;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = data[i * 4];
    g[i] = data[i * 4 + 1];
    b[i] = data[i * 4 + 2];
    lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  }
  return { r, g, b, lum };
}

function sobel(lum, w, h) {
  const edges = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1];
      const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      edges[i] = Math.min(255, Math.hypot(gx, gy) / 4);
    }
  }
  return edges;
}

// Deterministic noise so the same photo doodles the same way.
function grain(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const PAPER = [255, 250, 241];
const INK = [58, 50, 64];

function crayon(img, w, h) {
  const { r, g, b, lum } = channels(img.data, w, h);
  const blurred = [boxBlur(r, w, h, 2), boxBlur(g, w, h, 2), boxBlur(b, w, h, 2)];
  const edges = sobel(boxBlur(lum, w, h, 1), w, h);
  const levels = 6;
  for (let i = 0; i < w * h; i++) {
    const noise = grain(i) * 26 - 13;
    for (let c = 0; c < 3; c++) {
      let v = blurred[c][i];
      v = Math.round((v / 255) * (levels - 1)) / (levels - 1) * 255;
      // Warm, saturated wax colours over cream paper.
      v = v * 0.86 + PAPER[c] * 0.14 + noise;
      const line = Math.max(0, Math.min(1, (edges[i] - 22) / 60));
      v = v * (1 - line * 0.85) + INK[c] * line * 0.85;
      img.data[i * 4 + c] = Math.max(0, Math.min(255, v));
    }
  }
}

function pencil(img, w, h) {
  const { lum } = channels(img.data, w, h);
  const inverted = lum.map((v) => 255 - v);
  const blurred = boxBlur(inverted, w, h, 6);
  for (let i = 0; i < w * h; i++) {
    // Colour dodge of the luminance with its blurred inverse = graphite sketch.
    let v = blurred[i] >= 255 ? 255 : Math.min(255, (lum[i] * 255) / (255 - blurred[i]));
    v = 255 - (255 - v) * 1.35;
    v += grain(i) * 18 - 9;
    const tone = Math.max(0, Math.min(255, v)) / 255;
    for (let c = 0; c < 3; c++) {
      img.data[i * 4 + c] = INK[c] + (PAPER[c] - INK[c]) * tone;
    }
  }
}

function watercolor(img, w, h) {
  const { r, g, b, lum } = channels(img.data, w, h);
  const soft = [boxBlur(boxBlur(r, w, h, 3), w, h, 3), boxBlur(boxBlur(g, w, h, 3), w, h, 3), boxBlur(boxBlur(b, w, h, 3), w, h, 3)];
  const edges = sobel(boxBlur(lum, w, h, 2), w, h);
  const blotch = boxBlur(Float32Array.from({ length: w * h }, (_, i) => grain(i * 7.1)), w, h, 8);
  const levels = 8;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      let v = Math.round((soft[c][i] / 255) * (levels - 1)) / (levels - 1) * 255;
      // Pigment pools a little at edges and fades toward paper elsewhere.
      v = v * 0.72 + PAPER[c] * 0.28;
      v -= Math.min(40, edges[i] * 0.35);
      v += (blotch[i] - 0.5) * 60;
      img.data[i * 4 + c] = Math.max(0, Math.min(255, v));
    }
  }
}

const STYLES = { crayon, pencil, watercolor };

/** Returns a JPEG Blob of the doodled photo. style: crayon | pencil | watercolor | photo */
export async function doodle(source, style = "crayon") {
  const canvas = fitCanvas(source);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (STYLES[style]) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    STYLES[style](img, canvas.width, canvas.height);
    ctx.putImageData(img, 0, 0);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}
