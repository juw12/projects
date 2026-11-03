// Walk recording with the browser/WebView Geolocation API (foreground only on the web;
// the native iOS app records in the background). Noisy fixes are dropped, distance is summed
// with the haversine formula, and "new roads" are metres through ~25 m grid cells never walked before.

import * as store from "./store.js";

const MAX_ACCURACY_M = 35;
const MIN_STEP_M = 4;
const MAX_SPEED_MPS = 4; // faster than a brisk jog → probably a vehicle or a GPS jump
const CELL_DEG = 0.00025; // ≈ 25 m

export function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

const cell = (p) => `${Math.round(p[0] / CELL_DEG)}:${Math.round(p[1] / CELL_DEG)}`;

export function geolocationAvailable() {
  return "geolocation" in navigator && !/Electron/i.test(navigator.userAgent);
}

export async function permissionState() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state; // granted | prompt | denied
  } catch {
    return "prompt";
  }
}

export function currentPosition(timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!geolocationAvailable()) return reject(new Error("unavailable"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout, maximumAge: 10 * 60 * 1000 }
    );
  });
}

export class WalkRecorder {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.watchId = null;
    this.points = [];
    this.meters = 0;
    this.start = null;
    this.wakeLock = null;
  }

  get active() {
    return this.watchId !== null;
  }

  async begin() {
    if (this.active || !geolocationAvailable()) return;
    this.points = [];
    this.meters = 0;
    this.start = Date.now();
    try {
      this.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      this.wakeLock = null;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.add(p),
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    this.onUpdate?.(this);
  }

  add(position) {
    const { latitude, longitude, accuracy } = position.coords;
    if (accuracy > MAX_ACCURACY_M) return;
    const point = [latitude, longitude, position.timestamp];
    const last = this.points[this.points.length - 1];
    if (last) {
      const step = haversine(last, point);
      const seconds = Math.max(1, (point[2] - last[2]) / 1000);
      if (step < MIN_STEP_M || step / seconds > MAX_SPEED_MPS) return;
      this.meters += step;
    }
    this.points.push(point);
    this.onUpdate?.(this);
  }

  /** Stops, saves the walk and adds distance + new roads to today's page. */
  async finish() {
    if (!this.active) return null;
    navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.wakeLock?.release?.();
    this.onUpdate?.(this);
    if (this.points.length < 2) return null;

    const earlier = await store.all("walks");
    const seen = new Set();
    for (const walk of earlier) for (const p of walk.points) seen.add(cell(p));
    let newMeters = 0;
    for (let i = 1; i < this.points.length; i++) {
      if (!seen.has(cell(this.points[i]))) newMeters += haversine(this.points[i - 1], this.points[i]);
    }

    const walk = { id: store.uid(), start: this.start, end: Date.now(), points: this.points, meters: this.meters };
    await store.put("walks", walk);
    return { walk, newMeters };
  }
}

export function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`;
}
