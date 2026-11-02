"use strict";
/* ==========================================================================
   Sortie · core — helpers, file categories, settings, app state,
   real-disk access (File System Access API) and synthesized sound effects.
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BAG_DIR_NAME = "_Vacuum bag";
const BAG_KEY = "__bag";
const DAY_MS = 864e5;
const MB = 1048576;

/* ---------------- formatting helpers ---------------- */
function fmtSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 && i ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

const sumSize = files => files.reduce((total, f) => total + f.size, 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const centerOf = rect => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, ch => map[ch]);
}

const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function hashHue(text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 360;
}

function sanitizeFolderName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 60);
}

function sanitizeFileName(name) {
  return String(name || "").replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 200);
}

function splitName(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/* ---------------- file categories ---------------- */
const TYPES = [
  { name: "Images",    icon: "image", color: "#c9637f", ext: "jpg jpeg png gif webp heic heif svg bmp tif tiff raw avif psd" },
  { name: "Documents", icon: "file-text", color: "#4f7cff", ext: "pdf doc docx txt md rtf odt xls xlsx csv ppt pptx key pages numbers epub" },
  { name: "Videos",    icon: "video", color: "#cf8a34", ext: "mp4 mov mkv avi webm m4v wmv" },
  { name: "Audio",     icon: "music", color: "#2f9e72", ext: "mp3 wav flac m4a ogg aac wma opus" },
  { name: "Archives",  icon: "archive", color: "#7f68c9", ext: "zip rar 7z tar gz bz2 xz iso" },
  { name: "Code",      icon: "code", color: "#2a93ad", ext: "js ts jsx tsx py html css json c cpp h cs java rs go rb php sh ipynb yml yaml xml" },
  { name: "3D & CAD",  icon: "cube", color: "#d9733a", ext: "stl step stp obj 3mf f3d sldprt sldasm slddrw iges igs blend fbx dwg dxf gcode" },
  { name: "Apps",      icon: "app", color: "#6b7385", ext: "exe msi dmg apk pkg deb appimage" },
].map(type => ({ ...type, extSet: new Set(type.ext.split(" ")) }));
const OTHER = { name: "Other", icon: "file", color: "#5d6576", extSet: new Set() };
const ALL_EXTS = new Set(TYPES.flatMap(type => [...type.extSet]));
const TEXT_EXTS = new Set("txt md csv json js ts jsx tsx py html css xml yml yaml ini log c cpp h cs java rs go rb php sh gcode".split(" "));
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/;

const EXT_INFO = {
  pdf: "Portable Document Format — a fixed-layout document that looks the same everywhere.",
  doc: "Old Microsoft Word document.", docx: "Microsoft Word document.",
  xls: "Old Excel spreadsheet.", xlsx: "Microsoft Excel spreadsheet.", csv: "Comma-separated values — a plain-text table that any spreadsheet can open.",
  ppt: "Old PowerPoint deck.", pptx: "Microsoft PowerPoint presentation.",
  txt: "Plain text.", md: "Markdown — plain text with light formatting (headings, **bold**, lists).",
  jpg: "JPEG photo — small, lossy compression.", jpeg: "JPEG photo — small, lossy compression.",
  png: "PNG image — lossless, supports transparency; great for screenshots.",
  heic: "HEIC photo — Apple's high-efficiency format from iPhones.", webp: "WebP image — modern, compact web format.",
  gif: "GIF — small (often animated) image.", svg: "SVG — scalable vector graphic, stays sharp at any size.",
  mp4: "MP4 video — the most widely supported video format.", mov: "QuickTime video, common from iPhones and Macs.",
  mkv: "Matroska video container.", mp3: "MP3 audio.", m4a: "AAC audio (voice memos, iTunes).", wav: "Uncompressed audio.", flac: "Lossless compressed audio.",
  zip: "ZIP archive — several files squashed into one.", "7z": "7-Zip archive with strong compression.", rar: "RAR archive.",
  exe: "Windows program / installer. Safe to delete once installed.", msi: "Windows installer package. Usually safe to delete after installing.",
  dmg: "macOS disk image installer.", apk: "Android app package.",
  py: "Python script.", js: "JavaScript code.", html: "Web page.", json: "Structured data (JavaScript Object Notation).",
  step: "STEP — neutral 3D CAD exchange format (solid models) that most CAD tools can open.",
  stp: "STEP — neutral 3D CAD exchange format (solid models).",
  stl: "STL — triangle mesh, the classic format for 3D printing.",
  "3mf": "3MF — modern 3D-printing format that keeps colours, materials and print settings.",
  f3d: "Autodesk Fusion design archive.", sldprt: "SOLIDWORKS part.", sldasm: "SOLIDWORKS assembly.",
  obj: "OBJ — 3D mesh, often with textures.", dxf: "DXF — 2D CAD drawing exchange (laser cutting, CNC).", dwg: "AutoCAD drawing.",
  gcode: "G-code — machine instructions for 3D printers and CNC machines.", blend: "Blender scene.",
  iges: "IGES — older CAD surface exchange format.", igs: "IGES — older CAD surface exchange format.",
};

const extOf = name => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};
const typeOf = name => TYPES.find(type => type.extSet.has(extOf(name))) || OTHER;
const KIND_NOUNS = {
  Images: "image", Documents: "document", Videos: "video", Audio: "audio file", Archives: "archive",
  Code: "source file", "3D & CAD": "CAD model", Apps: "application", Other: "file",
};
/** Finder-style kind, e.g. "PDF document", "STEP CAD model". */
function kindLabel(name) {
  const ext = extOf(name).toUpperCase();
  const noun = KIND_NOUNS[typeOf(name).name] || "file";
  return ext ? `${ext} ${noun}` : "File";
}

const typeByName = name => TYPES.find(type => type.name === name) || (name === OTHER.name ? OTHER : null);

/* ---------------- settings (persisted in localStorage) ---------------- */
const DEFAULT_SETTINGS = {
  mode: "smart",
  sound: true,
  speed: 1,
  confirmVacuum: false,
  view: "grid",
  cardSize: "m",
  orderBy: "name",
  accent: "#007aff",
  theme: "system",
  uiVersion: 3,
  rules: [
    { pattern: "invoice|receipt|tax|bank|statement", folder: "Finance" },
    { pattern: "screenshot|screen shot", folder: "Screenshots" },
  ],
  ai: { provider: "offline", jsonMode: true, configs: {} },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("sortie.settings") || "{}");
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
    merged.ai = { ...structuredClone(DEFAULT_SETTINGS.ai), ...(saved.ai || {}) };
    merged.ai.configs = merged.ai.configs || {};
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

const settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem("sortie.settings", JSON.stringify(settings));
  } catch {
    /* storage may be blocked (private mode) — settings just won't persist */
  }
}

/** Animation duration scaled by the user's speed setting. */
const D = ms => ms / settings.speed;

/* ---------------- smart rules & buckets ---------------- */
const MODES = {
  smart: { label: "Smart rules + type", icon: "tag", phrase: "using your smart rules, then file type" },
  type: { label: "File type", icon: "layers", phrase: "by file type" },
  date: { label: "Month", icon: "calendar", phrase: "by month" },
  size: { label: "Size", icon: "database", phrase: "by size" },
};

function ruleRegex(rule) {
  try {
    return new RegExp(rule.pattern, "i");
  } catch {
    return new RegExp(escapeRegex(rule.pattern), "i");
  }
}

function ruleFor(name) {
  return settings.rules.find(rule => rule.pattern && rule.folder && ruleRegex(rule).test(name));
}

function customBucket(name, iconName = "folder") {
  return { name, icon: iconName, color: `hsl(${hashHue(name)} 38% 52%)` };
}

function bucketForName(name) {
  return typeByName(name) || customBucket(name);
}

function bucketOf(file, mode = settings.mode) {
  if (mode === "smart") {
    const rule = ruleFor(file.name);
    if (rule) return customBucket(sanitizeFolderName(rule.folder));
    return typeOf(file.name);
  }
  if (mode === "date") {
    const d = new Date(file.modified);
    const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const hue = ((d.getFullYear() * 12 + d.getMonth()) * 47) % 360;
    return { name, icon: "calendar", color: `hsl(${hue} 38% 52%)` };
  }
  if (mode === "size") {
    const mb = file.size / MB;
    if (mb < 1) return { name: "Small - under 1 MB", icon: "database", color: "#2f9e72" };
    if (mb < 100) return { name: "Medium - 1 to 100 MB", icon: "database", color: "#cf8a34" };
    return { name: "Large - over 100 MB", icon: "database", color: "#c9637f" };
  }
  return typeOf(file.name);
}

/* ---------------- app state ---------------- */
const state = {
  source: "demo",          // demo | preview | live
  root: null,              // FileSystemDirectoryHandle (live mode)
  all: [],                 // every file loaded this session
  files: [],               // loose files shown in the grid
  folders: new Map(),      // key -> folder entry
  history: [],             // { kind: "move" | "rename", items }
  busy: false,
  uid: 0,
  anchor: null,            // last clicked file (shift-click range)
  filter: { text: "", chip: "all" },
  view: { kind: "inbox", key: null },   // inbox | folder
};

const bagEntry = {
  key: BAG_KEY,
  bucket: { name: BAG_DIR_NAME, icon: "inbox", color: "#6b7385" },
  count: 0,
  open: 0,
  dir: null,
  el: null,
  pinned: true,
};

/** Ids of files that look like extra copies: "name (1).ext", "name copy.ext", … */
function duplicateIds(pool = state.files) {
  const groups = new Map();
  for (const file of pool) {
    const [base, ext] = splitName(file.name.toLowerCase());
    const key = base
      .replace(/\s*\(\d+\)$/, "")
      .replace(/[\s_-]*(copy|kopie|copia)(\s*\d+)?$/, "")
      .trim() + ext;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const ids = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const original =
      group.find(f => !/(\(\d+\)|copy|kopie|copia)(\s*\d+)?$/i.test(splitName(f.name)[0])) ||
      group.reduce((a, b) => (a.modified <= b.modified ? a : b));
    group.forEach(f => {
      if (f !== original) ids.add(f.id);
    });
  }
  return ids;
}

/* ---------------- real disk access (File System Access API) ---------------- */
async function entryExists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    try {
      await dir.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

async function uniqueName(dir, name) {
  const [base, ext] = splitName(name);
  let candidate = name;
  let n = 1;
  while (await entryExists(dir, candidate)) {
    candidate = `${base} (${n++})${ext}`;
  }
  return candidate;
}

/** Move a file on disk into destDir. No-op for demo / preview files. */
async function moveFile(file, destDir) {
  if (!file.handle || !destDir) return;
  const name = await uniqueName(destDir, file.name);
  if (typeof file.handle.move === "function") {
    try {
      await file.handle.move(destDir, name);
      file.dir = destDir;
      file.name = name;
      return;
    } catch (err) {
      console.warn("handle.move() failed, falling back to copy + delete", err);
    }
  }
  const data = await file.handle.getFile();
  const newHandle = await destDir.getFileHandle(name, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(data);
  await writable.close();
  await file.dir.removeEntry(file.name);
  file.handle = newHandle;
  file.dir = destDir;
  file.name = name;
}

/** Rename a file in place (disk in live mode, memory otherwise). */
async function renameOnDisk(file, newName) {
  if (newName === file.name) return;
  if (!file.handle) {
    file.name = newName;
    return;
  }
  const name = newName.toLowerCase() === file.name.toLowerCase() ? newName : await uniqueName(file.dir, newName);
  if (typeof file.handle.move === "function") {
    try {
      await file.handle.move(name);
      file.name = name;
      return;
    } catch (err) {
      console.warn("handle.move(name) failed, falling back to copy + delete", err);
    }
  }
  const data = await file.handle.getFile();
  const newHandle = await file.dir.getFileHandle(name, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(data);
  await writable.close();
  await file.dir.removeEntry(file.name);
  file.handle = newHandle;
  file.name = name;
}

async function getBagDir() {
  if (!state.root) return null;
  if (!bagEntry.dir) {
    bagEntry.dir = await state.root.getDirectoryHandle(BAG_DIR_NAME, { create: true });
  }
  return bagEntry.dir;
}

async function readBlob(file) {
  if (file.blob) return file.blob;
  if (file.handle) return file.handle.getFile();
  return null;
}

/* ---------------- sound (Web Audio, no files needed) ---------------- */
const Snd = {
  ctx: null,
  vacNodes: null,
  lastWhoosh: 0,
  ensure() {
    if (!settings.sound) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  },
  noiseBuffer(ctx, seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  },
  sweep(f0, f1, dur, vol) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.3;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  },
  tone(f0, f1, dur, vol = 0.12, type = "sine", delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  whoosh() {
    const now = performance.now();
    if (now - this.lastWhoosh < 70) return;
    this.lastWhoosh = now;
    this.sweep(500, 2400, 0.35, 0.1);
  },
  slurp() { this.sweep(300, 3800, 0.5, 0.22); },
  pop() { this.tone(720, 220, 0.12, 0.1); },
  pick() { this.tone(400, 640, 0.08, 0.06, "triangle"); },
  tick() { this.tone(1400, 1100, 0.035, 0.035, "triangle"); },
  ding() { this.tone(880, 1320, 0.14, 0.05, "sine"); },
  chime() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.3, 0.07, "triangle", i * 0.09));
  },
  vacStart() {
    const ctx = this.ensure();
    if (!ctx || this.vacNodes) return;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx, 2);
    noise.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1100;
    const motor = ctx.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.setValueAtTime(60, t);
    motor.frequency.exponentialRampToValueAtTime(150, t + 0.6);
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0.035;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.2, t + 0.4);
    noise.connect(lowpass).connect(master);
    motor.connect(motorGain).connect(master);
    master.connect(ctx.destination);
    noise.start(t);
    motor.start(t);
    this.vacNodes = { noise, motor, master };
  },
  vacStop() {
    const nodes = this.vacNodes;
    if (!nodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    nodes.master.gain.cancelScheduledValues(t);
    nodes.master.gain.setValueAtTime(nodes.master.gain.value, t);
    nodes.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    nodes.motor.frequency.exponentialRampToValueAtTime(40, t + 0.5);
    nodes.noise.stop(t + 0.55);
    nodes.motor.stop(t + 0.55);
    this.vacNodes = null;
  },
};
