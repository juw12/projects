// Local-only storage (IndexedDB). The real diary and the sample diary live in separate
// databases so sample days can never mix with real ones (same idea as the iOS in-memory demo store).

const STORES = ["days", "photos", "fragments", "clips", "walks"];
const VERSION = 1;

let db = null;
let currentName = null;

export function isSample() {
  return localStorage.getItem("diary.sample") === "1";
}

export function setSample(on) {
  localStorage.setItem("diary.sample", on ? "1" : "0");
}

function open(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of STORES) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: store === "days" ? "date" : "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function connect() {
  const name = isSample() ? "ashiato-sample" : "ashiato";
  if (db && currentName === name) return db;
  if (db) db.close();
  db = await open(name);
  currentName = name;
  return db;
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const all = (store) => wrap(tx(store).getAll());
export const get = (store, key) => wrap(tx(store).get(key));
export const put = (store, value) => wrap(tx(store, "readwrite").put(value));
export const del = (store, key) => wrap(tx(store, "readwrite").delete(key));
export const clear = (store) => wrap(tx(store, "readwrite").clear());

export async function count(store) {
  return wrap(tx(store).count());
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Local calendar date key, e.g. 2026-11-03. */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

// --- Photos: Blobs in IndexedDB, or a bundled URL for sample content ---

const urlCache = new Map();

export async function photoURL(ref) {
  if (!ref) return null;
  if (ref.startsWith("demo/") || ref.startsWith("shots/") || ref.startsWith("data:")) return ref;
  if (urlCache.has(ref)) return urlCache.get(ref);
  const record = await get("photos", ref);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  urlCache.set(ref, url);
  return url;
}

export async function savePhoto(blob) {
  const id = uid();
  await put("photos", { id, blob });
  return id;
}

// --- Backup (JSON with photos inlined as data URLs) ---

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  const response = await fetch(dataURL);
  return response.blob();
}

export async function exportAll() {
  const out = { app: "ashiato", version: 1, exportedAt: new Date().toISOString() };
  for (const store of STORES) {
    const rows = await all(store);
    if (store === "photos") {
      out.photos = [];
      for (const row of rows) out.photos.push({ id: row.id, data: await blobToDataURL(row.blob) });
    } else {
      out[store] = rows;
    }
  }
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== "ashiato") throw new Error("Not an Ashiato backup");
  for (const store of STORES) {
    for (const row of data[store] || []) {
      if (store === "photos") {
        await put("photos", { id: row.id, blob: await dataURLToBlob(row.data) });
      } else {
        await put(store, row);
      }
    }
  }
}

export async function wipe() {
  for (const store of STORES) await clear(store);
  urlCache.clear();
}
