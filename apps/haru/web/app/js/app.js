// Haru — cross-platform app shell (web / PWA, Android via Capacitor, Windows & macOS via Electron).
// Mirrors the native iOS app: Today · Days · Map · Memories, Capture, Tidy-up, Settings, onboarding.

import { C, DRAWERS, DRAWER_ICONS, LANGS, LANG_TITLES, lang, locale, setLang, short, t, weekday } from "./i18n.js";
import * as store from "./store.js";
import { currentScene, searchPlaces, sceneURL } from "./scene.js";
import { ClipClassifier, dHash, findExpiry, hamming } from "./classifier.js";
import { doodle, loadBitmap } from "./doodle.js";
import { WalkRecorder, currentPosition, formatDistance, geolocationAvailable, pathLength } from "./walk.js";
import * as demo from "./demo.js";
import * as widget from "./widget.js";

export const APP_VERSION = "0.2.0";
const DOWNLOADS_URL = "https://github.com/juw12/projects/releases/tag/haru-latest";
const WEB_URL = "https://juw12.github.io/projects/haru/app/";

const platform = window.Capacitor?.isNativePlatform?.() ? "android" : /Electron/i.test(navigator.userAgent) ? "desktop" : "web";
document.documentElement.dataset.platform = platform;

const state = {
  days: [],
  fragments: [],
  clips: [],
  walks: [],
  scene: null,
  classifier: null,
  recorder: null,
  deckIndex: 0,
  calendarMonth: null,
  search: "",
  realMap: false,
  map: null,
  capture: { kind: "moment", style: "crayon", bitmap: null, blob: null, mood: 0 },
  tidyOverride: null,
  onboardingPage: 0,
};

// ---------- helpers ----------

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

const ICONS = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></svg>',
  days: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4zM9 4v14M15 6v14"/></svg>',
  memories: '<svg viewBox="0 0 24 24"><path d="M12 3.5l1.9 5.2 5.4.3-4.2 3.4 1.4 5.3L12 14.8l-4.5 2.9 1.4-5.3L4.7 9l5.4-.3L12 3.5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/></svg>',
};

const moodStamp = (mood) => (mood ? C.moodStamps[Math.max(0, Math.min(4, mood - 1))] : "");

/** Note text that follows the language for sample entries (they carry all three languages). */
function noteText(moment) {
  if (!moment) return "";
  if (moment.label) {
    const mode = lang();
    return mode === "korean" ? moment.label.ko : mode === "english" ? moment.label.en : moment.label.ja;
  }
  return moment.text || "";
}

function fragmentText(fragment) {
  return noteText(fragment);
}

function isCJK(text) {
  return /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(text);
}

function noteClass(text) {
  return /[\uac00-\ud7af]/.test(text) && !/[\u3040-\u30ff]/.test(text) ? "note ko" : isCJK(text) ? "note ja" : "note";
}

function shortDate(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function dayFor(key) {
  return state.days.find((d) => d.date === key) || null;
}

function sceneLine(scene) {
  if (!scene) return "";
  const parts = [t(C.weather[scene.weather]), t(C.time[scene.time]), t(C.season[scene.season])];
  if (scene.tempC != null) parts.push(`${Math.round(scene.tempC)}°`);
  return parts.join(" · ");
}

function weatherOfDay(day) {
  const parts = [short(C.weather[day.weather] || C.weather.clear)];
  if (day.tempC != null) parts.push(`${Math.round(day.tempC)}°`);
  return parts.join(" ");
}

// ---------- data ----------

async function loadData() {
  state.days = (await store.all("days")).sort((a, b) => b.date.localeCompare(a.date));
  state.fragments = (await store.all("fragments")).sort((a, b) => b.at - a.at);
  state.clips = (await store.all("clips")).sort((a, b) => a.at - b.at);
  state.walks = (await store.all("walks")).sort((a, b) => b.start - a.start);
}

function savedPlace() {
  return JSON.parse(localStorage.getItem("weather.place") || "null");
}

async function refreshScene() {
  let position = savedPlace();
  if (localStorage.getItem("weather.useLocation") === "1" && geolocationAvailable()) {
    try {
      position = await currentPosition();
    } catch {
      // keep the saved town
    }
  }
  if (store.isSample() && !position) position = { lat: 35.7256, lon: 139.7683, name: "Yanaka, Tokyo" };
  state.scene = await currentScene(position);
}

async function ensureToday() {
  const key = store.dateKey();
  let day = dayFor(key);
  if (!day) {
    const scene = state.scene || (await currentScene(null));
    day = { date: key, weather: scene.weather, tempC: scene.tempC, scene: scene.scene, walkedMeters: 0, newMeters: 0, moments: [] };
    await store.put("days", day);
    state.days.unshift(day);
  } else if (state.scene?.live && key === store.dateKey()) {
    // Today's page follows the sky until the day ends.
    day.scene = state.scene.scene;
    day.weather = state.scene.weather;
    day.tempC = state.scene.tempC;
    await store.put("days", day);
  }
  return day;
}

async function hydratePhotos(root = document) {
  for (const img of $$("img[data-photo]", root)) {
    const url = await store.photoURL(img.dataset.photo);
    if (url) img.src = url;
    else img.closest(".polaroid")?.remove();
  }
}

// ---------- routing ----------

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "") || "today";
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/");
  return { tab: parts[0] || "today", sub: parts[1] || null, params: new URLSearchParams(query) };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function openSheet(name) {
  const route = parseRoute();
  const base = `#/${route.tab}${route.sub ? "/" + route.sub : ""}`;
  go(`${base}?sheet=${encodeURIComponent(name)}`);
}

function closeSheet() {
  const route = parseRoute();
  go(`#/${route.tab}${route.sub ? "/" + route.sub : ""}`);
}

// ---------- rendering ----------

function render() {
  const route = parseRoute();
  const main = $("#main");
  if (state.map && route.tab !== "map") {
    state.map.remove();
    state.map = null;
  }
  const views = { today: renderToday, days: renderDays, map: renderMap, memories: renderMemories };
  main.innerHTML = (store.isSample() ? `<button class="sample-banner" data-action="sheet" data-sheet="settings">${esc(t(C.sampleBanner))}</button>` : "") +
    (views[route.tab] || renderToday)(route);
  renderTabs(route.tab);
  hydratePhotos(main);
  if (route.tab === "map") mountMap();
  if (route.tab === "days" && (route.sub || "cards") === "cards") bindDeck();

  const sheet = route.params.get("sheet");
  renderSheet(sheet);
  if (route.params.get("onboarding") === "1" || localStorage.getItem("onboarding.done") !== "1") renderOnboarding();
  else $("#onboarding").innerHTML = "";
  document.body.dataset.ready = "1";
  widgetPublish();
}

// ---------- iPhone widget (optional) ----------

/** What the home-screen widget shows: today's sky and a few counts. No diary text, photos or places. */
function widgetSnapshot() {
  const key = store.dateKey();
  const today = dayFor(key);
  const sky = state.scene; // the sky right now, so the time of day stays current
  const meters = state.walks.reduce((sum, walk) => sum + (walk.meters || 0), 0);
  return {
    day: key,
    scene: sky.scene,
    weather: sky.weather,
    tempC: sky.tempC,
    time: sky.time,
    season: sky.season,
    moments: today?.moments?.length ?? 0,
    days: state.days.length,
    walkKm: Math.round(meters / 100) / 10,
    inbox: state.clips.filter((clip) => clip.status === "inbox").length,
    sample: store.isSample(),
  };
}

function widgetPublish() {
  try {
    // wait for the sky and a finished welcome, so the first snapshot is already the real one
    if (!state.scene || localStorage.getItem("onboarding.done") !== "1") return;
    widget.publish(widgetSnapshot());
  } catch {
    // the widget is optional: it must never get in the way of the diary
  }
}

function renderTabs(active) {
  const tabs = [
    ["today", C.today],
    ["days", C.days],
    ["map", C.map],
    ["memories", C.memories],
  ];
  $("#tabs").innerHTML = tabs
    .map(([id, label]) => `<a href="#/${id}" class="tab ${id === active ? "on" : ""}" aria-label="${esc(t(label))}">${ICONS[id]}<span>${esc(short(label))}</span></a>`)
    .join("") + `<button class="fab" data-action="sheet" data-sheet="capture" aria-label="${esc(t(C.capture))}">${ICONS.plus}</button>`;
}

function pageHead(title, sub = "", gear = true) {
  return `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>${
    gear ? `<button class="icon-btn" data-action="sheet" data-sheet="settings" aria-label="${esc(t(C.settings))}">${ICONS.gear}</button>` : ""
  }</header>`;
}

function dayCard(day, { big = true } = {}) {
  const date = store.keyToDate(day.date);
  const lead = day.moments?.[day.moments.length - 1];
  const photoMoment = [...(day.moments || [])].reverse().find((m) => m.photo);
  const mood = Math.max(0, ...(day.moments || []).map((m) => m.mood || 0));
  const note = noteText(lead);
  const pills = [];
  if (day.walkedMeters > 0) pills.push(`<span class="pill matcha">${esc(t(C.walked(formatDistance(day.walkedMeters))))}</span>`);
  if (day.newMeters > 0) pills.push(`<span class="pill sakura">${esc(t(C.newRoads(formatDistance(day.newMeters))))}</span>`);
  return `<article class="day-card ${big ? "big" : ""}" data-action="day" data-date="${day.date}">
    <div class="dc-head"><div><div class="dc-date">${shortDate(date)}</div><div class="dc-wd">${esc(weekday(date))}</div></div>${
      mood ? `<div class="hanko">${moodStamp(mood)}</div>` : ""
    }</div>
    <div class="dc-scene"><img src="${sceneURL(day.scene)}" alt="" loading="lazy"><span class="chip">${esc(weatherOfDay(day))}</span>${
      photoMoment ? `<figure class="polaroid"><img data-photo="${esc(photoMoment.photo)}" alt=""></figure>` : ""
    }</div>
    ${note ? `<p class="${noteClass(note)}">${esc(note)}</p>` : `<p class="note muted">${esc(t(C.emptyToday))}</p>`}
    ${pills.length ? `<div class="pills">${pills.join("")}</div>` : ""}
  </article>`;
}

function weekStrip() {
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = store.dateKey(d);
    const day = dayFor(key);
    cells.push(`<button class="wk ${i === 0 ? "on" : ""}" ${day ? `data-action="day" data-date="${key}"` : "disabled"}>
      ${day ? `<img src="${sceneURL(day.scene)}" alt="">` : `<span class="wk-empty"></span>`}<span>${d.getDate()}</span></button>`);
  }
  return `<div class="week">${cells.join("")}</div>`;
}

function renderToday() {
  const today = dayFor(store.dateKey());
  const parts = [pageHead(t(C.today), sceneLine(state.scene))];
  parts.push(today ? dayCard(today) : dayCard({ date: store.dateKey(), scene: state.scene?.scene || "clear__noon__autumn", weather: state.scene?.weather || "clear", tempC: state.scene?.tempC, moments: [] }));
  parts.push(weekStrip());

  const promptIndex = Math.floor(Date.now() / 86400000) % C.prompts.length;
  if (localStorage.getItem("prompt.done") !== store.dateKey()) {
    parts.push(`<section class="card prompt"><p class="eyebrow">${esc(t(C.todaysPrompt))}</p><p class="prompt-text">${esc(t(C.prompts[promptIndex]))}</p>
      <div class="row"><button class="btn ghost" data-action="prompt-skip">${esc(t(C.letItGo))}</button><button class="btn" data-action="prompt-keep" data-index="${promptIndex}">${esc(t(C.keepIt))}</button></div></section>`);
  }

  // Walk card
  const recorder = state.recorder;
  if (platform === "desktop" || !geolocationAvailable()) {
    parts.push(`<section class="card walk"><span class="walk-dot"></span><div><p class="walk-title">${esc(t(C.goForWalk))}</p><p class="muted small">${esc(t(C.walksOnPhone))}</p></div></section>`);
  } else if (recorder?.active) {
    parts.push(`<section class="card walk on"><span class="walk-dot live"></span><div><p class="walk-title">${esc(t(C.walking))}</p><p class="muted small" id="walk-distance">${formatDistance(recorder.meters)}</p></div><button class="btn" data-action="walk-stop">${esc(t(C.stop))}</button></section>`);
  } else {
    parts.push(`<section class="card walk"><span class="walk-dot"></span><div><p class="walk-title">${esc(t(C.goForWalk))}</p><p class="muted small">${esc(t(C.kmOnFoot(state.walks.reduce((s, w) => s + w.meters, 0) / 1000)))}</p></div><button class="btn" data-action="walk-start">${esc(t(C.start))}</button></section>`);
  }

  const waiting = state.clips.filter((c) => c.status === "inbox").length;
  parts.push(`<section class="card tidy-invite" data-action="sheet" data-sheet="tidy"><div class="tidy-stack"><span></span><span></span><span></span></div><div><p class="walk-title">${esc(t(waiting ? C.screenshotsWaiting(waiting) : C.tidyInvite))}</p><p class="muted small">${esc(t(C.tidyPrivacy))}</p></div><span class="chev">›</span></section>`);

  const moments = (today?.moments || []).slice(0, -1).reverse();
  for (const moment of moments) parts.push(momentRow(moment));
  return parts.join("");
}

function momentRow(moment) {
  const time = new Date(moment.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  const text = noteText(moment);
  return `<div class="moment">${moment.photo ? `<img class="thumb" data-photo="${esc(moment.photo)}" alt="">` : ""}<div><p class="${noteClass(text)}">${esc(text)}</p><p class="muted small">${time}${moment.mood ? " · " + moodStamp(moment.mood) : ""}</p></div></div>`;
}

function filteredDays() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.days;
  return state.days.filter((day) => {
    const words = [
      ...(day.moments || []).map((m) => (m.label ? `${m.label.ja} ${m.label.ko} ${m.label.en}` : m.text)),
      ...Object.values(C.weather[day.weather] || {}),
      day.weather,
    ].join(" ").toLowerCase();
    return words.includes(q);
  });
}

function renderDays(route) {
  const mode = route.sub || "cards";
  const seg = [
    ["cards", C.cards],
    ["timeline", C.timeline],
    ["calendar", C.calendar],
  ].map(([id, label]) => `<a href="#/days/${id}" class="${id === mode ? "on" : ""}">${esc(short(label))}</a>`).join("");
  const head = `${pageHead(t(C.days))}<nav class="segmented">${seg}</nav>
    <input class="search" type="search" placeholder="${esc(t(C.searchDays))}" value="${esc(state.search)}" data-input="search">`;
  const days = filteredDays();
  if (!days.length) return `${head}<div class="empty"><p class="big-muted">${esc(t(C.nothingYet))}</p><p class="muted">${esc(t(C.daysWillStack))}</p></div>`;

  if (mode === "timeline") {
    return head + `<div class="timeline">${days.map((day) => {
      const date = store.keyToDate(day.date);
      const note = noteText(day.moments?.[day.moments.length - 1]);
      return `<button class="tl-row" data-action="day" data-date="${day.date}"><img src="${sceneURL(day.scene)}" alt=""><div><p class="tl-date">${shortDate(date)} · ${esc(weekday(date))}</p><p class="${noteClass(note)}">${esc(note || weatherOfDay(day))}</p></div></button>`;
    }).join("")}</div>`;
  }

  if (mode === "calendar") {
    const base = state.calendarMonth || new Date();
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const offset = first.getDay();
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span class="cal-cell blank"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = store.dateKey(new Date(base.getFullYear(), base.getMonth(), d));
      const day = dayFor(key);
      cells.push(day
        ? `<button class="cal-cell has" data-action="day" data-date="${key}"><img src="${sceneURL(day.scene)}" alt=""><span>${d}</span></button>`
        : `<span class="cal-cell"><span>${d}</span></span>`);
    }
    const title = first.toLocaleDateString(locale(), { year: "numeric", month: "long" });
    const weekdays = [...Array(7)].map((_, i) => new Date(2024, 8, 1 + i).toLocaleDateString(locale(), { weekday: "narrow" }));
    return head + `<div class="calendar"><div class="cal-head"><button class="icon-btn" data-action="cal" data-step="-1">‹</button><strong>${esc(title)}</strong><button class="icon-btn" data-action="cal" data-step="1">›</button></div>
      <div class="cal-grid">${weekdays.map((w) => `<span class="cal-wd">${esc(w)}</span>`).join("")}${cells.join("")}</div></div>`;
  }

  state.deckIndex = Math.min(state.deckIndex, days.length - 1);
  const order = days.slice(state.deckIndex).concat(days.slice(0, state.deckIndex)).slice(0, 3);
  return head + `<div class="deck">${order.map((day, depth) => `<div class="deck-card" style="--depth:${depth};z-index:${10 - depth}">${dayCard(day, { big: false })}</div>`).reverse().join("")}</div>
    <div class="deck-foot"><button class="icon-btn" data-action="deck" data-step="-1">‹</button><span class="muted small">${state.deckIndex + 1} / ${days.length} · ${esc(t(C.swipeHint))}</span><button class="icon-btn" data-action="deck" data-step="1">›</button></div>`;
}

function bindDeck() {
  const top = $$(".deck-card").pop();
  if (!top) return;
  let startX = 0;
  let dx = 0;
  let dragging = false;
  top.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX;
    dx = 0;
    top.setPointerCapture(event.pointerId);
    top.style.transition = "none";
  });
  top.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dx = event.clientX - startX;
    top.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg) rotateY(${-dx / 14}deg)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    top.style.transition = "";
    if (Math.abs(dx) > 90) {
      top.style.transform = `translateX(${Math.sign(dx) * 600}px) rotate(${Math.sign(dx) * 24}deg)`;
      top.style.opacity = "0";
      setTimeout(() => stepDeck(dx < 0 ? 1 : -1), 260);
    } else {
      top.style.transform = "";
      if (Math.abs(dx) < 6) {
        const date = top.querySelector("[data-date]")?.dataset.date;
        if (date) openSheet(`day:${date}`);
      }
    }
  };
  top.addEventListener("pointerup", end);
  top.addEventListener("pointercancel", end);
  top.querySelector(".day-card").removeAttribute("data-action");
}

function stepDeck(step) {
  const count = filteredDays().length;
  if (!count) return;
  state.deckIndex = (state.deckIndex + step + count) % count;
  render();
}

function renderMap() {
  const total = state.walks.reduce((sum, w) => sum + w.meters, 0) / 1000;
  return `${pageHead(t(C.yourMap), "", true)}<div id="map" class="${state.realMap ? "" : "paper"}"></div>
    <div class="map-stats card"><div><p class="walk-title">${esc(t(C.walksCount(state.walks.length)))}</p><p class="muted small">${esc(state.walks.length ? t(C.kmOnFoot(total)) : t(C.noWalksYet))}</p></div>
    <label class="switch"><span>${esc(t(C.realMap))}</span><input type="checkbox" data-action="realmap" ${state.realMap ? "checked" : ""}><i></i></label></div>`;
}

function mountMap() {
  if (!window.L) return;
  const el = $("#map");
  const map = L.map(el, { zoomControl: false, attributionControl: false });
  L.control.attribution({ position: "topright", prefix: false }).addTo(map);
  state.map = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "tiles",
    attribution: "© OpenStreetMap",
  }).addTo(map);
  const bounds = [];
  for (const walk of state.walks) {
    const latlngs = walk.points.map((p) => [p[0], p[1]]);
    L.polyline(latlngs, { color: "#F4B9C6", weight: 12, opacity: 0.5, lineCap: "round", lineJoin: "round" }).addTo(map);
    L.polyline(latlngs, { color: "#E8875A", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
    bounds.push(...latlngs);
  }
  if (state.recorder?.active && state.recorder.points.length) {
    const live = state.recorder.points.map((p) => [p[0], p[1]]);
    L.polyline(live, { color: "#4F5D7E", weight: 5, dashArray: "2 8", lineCap: "round" }).addTo(map);
    bounds.push(...live);
  }
  const place = savedPlace();
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
  else map.setView(place ? [place.lat, place.lon] : [35.7256, 139.7683], 15);
  setTimeout(() => map.invalidateSize(), 60);
}

function seededPick(list, seed) {
  if (!list.length) return null;
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return list[Math.floor((x - Math.floor(x)) * list.length)];
}

function renderMemories() {
  const parts = [pageHead(t(C.memories))];
  const today = new Date();
  const sameDay = state.days.filter((d) => {
    const date = store.keyToDate(d.date);
    return date.getMonth() === today.getMonth() && date.getDate() === today.getDate() && date.getFullYear() < today.getFullYear();
  });
  let memory = sameDay[0];
  let ago = memory ? C.yearsAgo(today.getFullYear() - store.keyToDate(memory.date).getFullYear()) : null;
  if (!memory) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    memory = state.days.find((d) => d.date <= store.dateKey(weekAgo) && d.date !== store.dateKey());
    ago = memory ? C.weekAgo : null;
  }
  if (memory) {
    const lead = memory.moments?.[memory.moments.length - 1];
    const photo = [...(memory.moments || [])].reverse().find((m) => m.photo)?.photo;
    parts.push(`<p class="section">${esc(t(C.onThisDay))}</p><button class="card memory" data-action="day" data-date="${memory.date}">
      ${photo ? `<img class="thumb" data-photo="${esc(photo)}" alt="">` : `<img class="thumb" src="${sceneURL(memory.scene)}" alt="">`}
      <div><p class="walk-title">${esc(t(ago))}</p><p class="${noteClass(noteText(lead))}">${esc(noteText(lead))}</p></div><span class="chev">›</span></button>`);
  }

  const fragment = seededPick(state.fragments, Math.floor(Date.now() / 86400000));
  if (fragment) {
    parts.push(`<p class="section">${esc(t(C.fragmentCameBack))}</p><div class="card fragment-back"><p class="quote">“${esc(fragmentText(fragment))}”</p><p class="muted small">${new Date(fragment.at).toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" })}</p></div>`);
  }

  const kept = state.clips.filter((c) => c.status === "kept");
  parts.push(`<p class="section">${esc(t(C.drawers))}</p>`);
  if (!kept.length) parts.push(`<div class="card"><p class="muted">${esc(t(C.drawersEmpty))}</p></div>`);
  else {
    const rows = DRAWERS.filter((d) => kept.some((c) => c.drawer === d)).map((d) =>
      `<button class="list-row" data-action="sheet" data-sheet="drawer:${d}"><span class="ico">${DRAWER_ICONS[d]}</span><span>${esc(t(C.drawerLabels[d]))}</span><span class="count">${kept.filter((c) => c.drawer === d).length}</span><span class="chev">›</span></button>`
    );
    parts.push(`<div class="card list">${rows.join("")}</div>`);
  }

  if (state.fragments.length) {
    parts.push(`<p class="section">${esc(t(C.fragments))}</p><div class="card list">${state.fragments.map((f) => `<div class="list-row"><span class="${noteClass(fragmentText(f))}">${esc(fragmentText(f))}</span></div>`).join("")}</div>`);
  }
  return parts.join("");
}

// ---------- sheets ----------

function sheetFrame(title, body, { left = C.close, right = null, rightAction = "" } = {}) {
  return `<div class="sheet-backdrop" data-action="close-sheet"></div><section class="sheet" role="dialog" aria-label="${esc(title)}">
    <header class="sheet-head"><button class="link" data-action="close-sheet">${esc(t(left))}</button><strong>${esc(title)}</strong>${
      right ? `<button class="link strong" data-action="${rightAction}">${esc(t(right))}</button>` : "<span></span>"
    }</header><div class="sheet-body">${body}</div></section>`;
}

function renderSheet(name) {
  const host = $("#sheet");
  if (!name) {
    host.innerHTML = "";
    document.body.classList.remove("sheet-open");
    return;
  }
  document.body.classList.add("sheet-open");
  if (name === "capture") host.innerHTML = captureSheet();
  else if (name === "tidy") host.innerHTML = tidySheet();
  else if (name === "settings") host.innerHTML = settingsSheet();
  else if (name.startsWith("day:")) host.innerHTML = daySheet(name.slice(4));
  else if (name.startsWith("drawer:")) host.innerHTML = drawerSheet(name.slice(7));
  else if (name.startsWith("clip:")) host.innerHTML = clipSheet(name.slice(5));
  hydratePhotos(host);
  if (name === "tidy") bindTidy();
  if (name === "capture") refreshCapturePreview();
}

function captureSheet() {
  const cap = state.capture;
  const seg = `<nav class="segmented">${[["moment", C.moment], ["fragment", C.fragment]].map(([id, label]) => `<button class="${cap.kind === id ? "on" : ""}" data-action="cap-kind" data-kind="${id}">${esc(t(label))}</button>`).join("")}</nav>`;
  let body;
  if (cap.kind === "fragment") {
    body = `<textarea id="cap-text" maxlength="80" rows="3" placeholder="${esc(t(C.passingThought))}">${esc(cap.text || "")}</textarea><p class="muted small" id="cap-count">${esc(t(C.fragmentFooter((cap.text || "").length, 80)))}</p>`;
  } else {
    const styles = ["crayon", "pencil", "watercolor", "photo"].map((s) => `<button class="chip-btn ${cap.style === s ? "on" : ""}" data-action="cap-style" data-style="${s}">${esc(t(C.styles[s]))}</button>`).join("");
    const moods = [1, 2, 3, 4, 5].map((m) => `<button class="mood ${cap.mood === m ? "on" : ""}" data-action="cap-mood" data-mood="${m}" aria-label="${m}">${cap.mood === m ? moodStamp(m) : ""}</button>`).join("");
    body = `<label class="photo-pick">${cap.blob ? `<img id="cap-preview" alt="">` : `<span>🖼️ ${esc(t(C.addPhoto))}</span>`}<input type="file" accept="image/*" data-input="cap-photo" hidden></label>
      ${cap.bitmap ? `<p class="eyebrow">${esc(t(C.style))}</p><div class="chips">${styles}</div>` : ""}
      ${cap.prompt ? `<p class="eyebrow">${esc(cap.prompt)}</p>` : ""}
      <textarea id="cap-text" rows="3" placeholder="${esc(t(C.whatHappened))}">${esc(cap.text || "")}</textarea>
      <div class="mood-row"><span>${esc(t(C.mood))}</span><div class="moods">${moods}</div></div>`;
  }
  return sheetFrame(t(C.capture), seg + body, { left: C.cancel, right: C.save, rightAction: "cap-save" });
}

async function refreshCapturePreview() {
  const img = $("#cap-preview");
  if (img && state.capture.blob) img.src = URL.createObjectURL(state.capture.blob);
}

function tidyQueue() {
  return state.clips.filter((c) => c.status === "inbox");
}

function tidySheet() {
  const queue = tidyQueue();
  const top = queue[0];
  const drawerOf = (clip, depth) => (depth === 0 && state.tidyOverride) || clip.drawer;
  let body = `<p class="muted small center">→ ${esc(t(C.keep))} · ← ${esc(t(C.letGo))} · ↑ ${esc(t(C.later))}</p>
    <label class="btn ghost add-shots">＋ ${esc(t(C.addScreenshots))}<input type="file" accept="image/*" multiple data-input="shots" hidden></label>`;
  if (top) {
    body += `<div class="tidy-deck">${queue.slice(0, 3).map((clip, depth) => clipCard(clip, drawerOf(clip, depth), depth)).reverse().join("")}</div>
      <div class="row center"><button class="btn ghost" data-action="tidy" data-decision="letGo">← ${esc(short(C.letGo))}</button><button class="btn ghost" data-action="tidy" data-decision="later">↑ ${esc(short(C.later))}</button><button class="btn" data-action="tidy" data-decision="keep">${esc(short(C.keep))} →</button></div>`;
  } else {
    const kept = state.clips.filter((c) => c.status === "kept").length;
    const later = state.clips.filter((c) => c.status === "later").length;
    body += `<div class="card summary">${ICONS.leaf}<h2>${esc(t(C.allTidy))}</h2><p class="${noteClass(t(C.tidyMotto))}">${esc(t(C.tidyMotto))}</p>
      <p class="muted small">${DRAWERS.filter((d) => state.clips.some((c) => c.status === "kept" && c.drawer === d)).map((d) => `${DRAWER_ICONS[d]} ${esc(short(C.drawerLabels[d]))} ${state.clips.filter((c) => c.status === "kept" && c.drawer === d).length}`).join(" · ") || ""}</p>
      ${later ? `<p class="muted small">${esc(t(C.laterCount(later)))}</p>` : ""}${kept ? "" : `<p class="muted small">${esc(t(C.tidyPrivacy))}</p>`}</div>`;
  }
  const highlighted = top ? state.tidyOverride || top.drawer : null;
  body += `<div class="chest">${DRAWERS.map((d) => `<button class="drawer ${d === highlighted ? "on" : ""}" data-action="tidy-drawer" data-drawer="${d}"><span>${DRAWER_ICONS[d]}</span>${esc(short(C.drawerLabels[d]))}</button>`).join("")}
    <button class="drawer trash" data-action="tidy" data-decision="letGo"><span>🍃</span>${esc(short(C.letGo))}</button></div>
    <p class="muted tiny center">${esc(t(C.letGoNote))}</p>`;
  return sheetFrame(t(C.tidy), body);
}

function clipCard(clip, drawer, depth) {
  const headline = (clip.text || "").split("\n").slice(0, 4).map((s) => s.trim()).sort((a, b) => b.length - a.length)[0] || "";
  const expiry = clip.expiry ? new Date(clip.expiry) : null;
  return `<div class="clip-card" style="--depth:${depth};z-index:${10 - depth}" ${depth === 0 ? 'data-top="1"' : ""}>
    <figure class="shot"><img data-photo="${esc(clip.image)}" alt=""></figure>
    <span class="pill matcha">${DRAWER_ICONS[drawer]} ${esc(t(C.goesInto(t(C.drawerLabels[drawer]))))}</span>
    ${headline ? `<p class="${noteClass(headline)} one-line">${esc(headline)}</p>` : ""}
    <div class="pills">${expiry ? `<span class="pill yuzu">${esc(t(C.until(expiry.toLocaleDateString(locale(), { month: "short", day: "numeric" }))))}</span>` : ""}${clip.duplicateOf ? `<span class="pill indigo">${esc(t(C.lookalike))}</span>` : ""}</div>
    <span class="stamp keep">${esc(short(C.keep))}</span><span class="stamp letgo">${esc(short(C.letGo))}</span><span class="stamp later">${esc(short(C.later))}</span>
  </div>`;
}

function bindTidy() {
  const top = $('.clip-card[data-top="1"]');
  if (!top) return;
  let sx = 0;
  let sy = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  const stamps = { keep: $(".stamp.keep", top), letgo: $(".stamp.letgo", top), later: $(".stamp.later", top) };
  top.addEventListener("pointerdown", (event) => {
    dragging = true;
    sx = event.clientX;
    sy = event.clientY;
    dx = dy = 0;
    top.setPointerCapture(event.pointerId);
    top.style.transition = "none";
  });
  top.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    dx = event.clientX - sx;
    dy = event.clientY - sy;
    top.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg) rotateY(${-dx / 12}deg)`;
    stamps.keep.style.opacity = Math.max(0, dx / 110);
    stamps.letgo.style.opacity = Math.max(0, -dx / 110);
    stamps.later.style.opacity = Math.abs(dx) < 60 ? Math.max(0, -dy / 110) : 0;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    top.style.transition = "";
    if (dx > 110) decideTidy("keep");
    else if (dx < -110) decideTidy("letGo");
    else if (dy < -110 && Math.abs(dx) < 90) decideTidy("later");
    else {
      top.style.transform = "";
      Object.values(stamps).forEach((s) => (s.style.opacity = 0));
    }
  };
  top.addEventListener("pointerup", end);
  top.addEventListener("pointercancel", end);
}

async function decideTidy(decision) {
  const clip = tidyQueue()[0];
  if (!clip) return;
  const top = $('.clip-card[data-top="1"]');
  if (top) {
    top.style.transform = decision === "keep" ? "translateY(420px) scale(.2)" : decision === "letGo" ? "translate(-520px, 300px) rotate(-30deg)" : "translateY(-700px)";
    top.style.opacity = "0.2";
  }
  navigator.vibrate?.(8);
  await new Promise((resolve) => setTimeout(resolve, 280));
  if (decision === "keep") {
    clip.drawer = state.tidyOverride || clip.drawer;
    clip.status = "kept";
    clip.reviewedAt = Date.now();
    await store.put("clips", clip);
    if (clip.drawer === "words" && clip.text && clip.text.length <= 80) {
      const fragment = { id: store.uid(), text: clip.text.replace(/\n/g, " "), at: Date.now() };
      await store.put("fragments", fragment);
      state.fragments.unshift(fragment);
    }
  } else if (decision === "later") {
    clip.status = "later";
    clip.reviewedAt = Date.now();
    await store.put("clips", clip);
  } else {
    await store.del("clips", clip.id);
    if (clip.image && !clip.image.startsWith("shots/")) await store.del("photos", clip.image);
    state.clips = state.clips.filter((c) => c.id !== clip.id);
  }
  state.tidyOverride = null;
  renderSheet("tidy");
}

async function addScreenshots(files) {
  const list = [...files];
  let worker = null;
  try {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    worker = await window.Tesseract.createWorker(["jpn", "kor", "eng"]);
  } catch {
    worker = null; // offline: clips are still added, just without text
  }
  const hashes = state.clips.filter((c) => c.hash).map((c) => [c.id, c.hash]);
  for (const [index, file] of list.entries()) {
    toast(t(C.reading(index + 1, list.length)));
    const bitmap = await loadBitmap(file);
    const hash = await dHash(bitmap);
    let text = "";
    if (worker) {
      try {
        const result = await worker.recognize(file);
        text = result.data.text.replace(/[ \t]+\n/g, "\n").trim();
        // Tesseract spaces out CJK characters; join them back.
        text = text.replace(/(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]) (?=[\u3040-\u30ff\u4e00-\u9fff])/g, "");
      } catch {
        text = "";
      }
    }
    const { drawer } = state.classifier.classify(text);
    const expiry = findExpiry(text);
    const duplicate = hashes.find(([, h]) => hamming(h, hash) <= 6);
    const image = await store.savePhoto(file);
    const clip = {
      id: store.uid(),
      at: file.lastModified || Date.now(),
      image,
      text,
      suggested: drawer,
      drawer,
      status: "inbox",
      expiry: expiry ? store.dateKey(expiry) : null,
      duplicateOf: duplicate ? duplicate[0] : null,
      hash,
    };
    hashes.push([clip.id, hash]);
    await store.put("clips", clip);
    state.clips.push(clip);
  }
  await worker?.terminate();
  renderSheet("tidy");
}

function daySheet(key) {
  const day = dayFor(key);
  if (!day) return sheetFrame("", `<p class="muted">${esc(t(C.nothingYet))}</p>`);
  const date = store.keyToDate(key);
  const clips = state.clips.filter((c) => store.dateKey(new Date(c.at)) === key && c.status === "kept");
  const body = `${dayCard(day)}
    ${(day.moments || []).slice(0, -1).reverse().map(momentRow).join("")}
    ${clips.length ? `<p class="section">${esc(t(C.thisDaysScreenshots))}</p><div class="shot-grid">${clips.map((c) => `<button data-action="sheet" data-sheet="clip:${c.id}"><img data-photo="${esc(c.image)}" alt=""></button>`).join("")}</div>` : ""}`;
  return sheetFrame(`${shortDate(date)} · ${weekday(date)}`, body);
}

function drawerSheet(drawer) {
  const clips = state.clips.filter((c) => c.status === "kept" && c.drawer === drawer);
  const body = clips.length
    ? `<div class="shot-grid">${clips.map((c) => `<button data-action="sheet" data-sheet="clip:${c.id}"><img data-photo="${esc(c.image)}" alt=""></button>`).join("")}</div>`
    : `<p class="muted center">${esc(t(C.empty))}</p>`;
  return sheetFrame(`${DRAWER_ICONS[drawer]} ${t(C.drawerLabels[drawer])}`, body);
}

function clipSheet(id) {
  const clip = state.clips.find((c) => c.id === id);
  if (!clip) return sheetFrame("", "");
  const options = DRAWERS.map((d) => `<option value="${d}" ${d === clip.drawer ? "selected" : ""}>${DRAWER_ICONS[d]} ${esc(t(C.drawerLabels[d]))}</option>`).join("");
  const body = `<figure class="shot big"><img data-photo="${esc(clip.image)}" alt=""></figure>
    ${clip.text ? `<p class="eyebrow">${esc(t(C.readText))}</p><pre class="ocr">${esc(clip.text)}</pre><button class="btn ghost" data-action="copy-clip" data-id="${clip.id}">${esc(t(C.copy))}</button>` : ""}
    <p class="eyebrow">${esc(t(C.changeDrawer))}</p><select data-input="clip-drawer" data-id="${clip.id}">${options}</select>
    <button class="btn danger" data-action="clip-letgo" data-id="${clip.id}">🍃 ${esc(t(C.letGo))}</button>`;
  return sheetFrame(t(C.drawerLabels[clip.drawer]), body);
}

function settingsSheet() {
  const place = savedPlace();
  const useLocation = localStorage.getItem("weather.useLocation") === "1";
  const widgetCode = widget.code();
  const langs = LANGS.map((l) => `<button class="list-row" data-action="lang" data-lang="${l}"><span>${LANG_TITLES[l]}</span>${l === lang() ? '<span class="check">✓</span>' : ""}</button>`).join("");
  const body = `<p class="section">${esc(t(C.language))}</p><div class="card list">${langs}</div>
    <p class="section">${esc(t(C.sampleDays))}</p><div class="card list"><label class="list-row switch"><span>${esc(t(C.lookAround))}</span><input type="checkbox" data-action="sample" ${store.isSample() ? "checked" : ""}><i></i></label></div>
    <p class="section">${esc(t(C.weatherPlace))}</p><div class="card list">
      ${geolocationAvailable() ? `<label class="list-row switch"><span>${esc(t(C.myLocation))}</span><input type="checkbox" data-action="use-location" ${useLocation ? "checked" : ""}><i></i></label>` : ""}
      <div class="list-row"><input class="search" type="search" placeholder="${esc(t(C.searchCity))}" data-input="city" value=""></div>
      <div id="city-results"></div>
      ${place ? `<div class="list-row"><span>📍 ${esc(place.name)}</span></div>` : ""}
    </div>
    <p class="section">${esc(t(C.backup))}</p><div class="card"><p class="muted small">${esc(t(C.backupNote))}</p>
      <div class="row"><button class="btn ghost" data-action="export">${esc(t(C.exportData))}</button><label class="btn ghost">${esc(t(C.importData))}<input type="file" accept="application/json,.json" data-input="import" hidden></label></div></div>
    <p class="section">${esc(t(C.widgetTitle))}</p><div class="card"><p class="muted small">${esc(t(C.widgetNote))} <a href="${widget.SETUP_URL}" target="_blank" rel="noopener">${esc(t(C.widgetSetup))}</a></p>
      <div class="row"><input class="search" type="text" id="widget-code" placeholder="jw-..." value="${esc(widgetCode)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${esc(t(C.widgetCode))}"></div>
      <div class="row"><button class="btn ghost" data-action="widget-save">${esc(t(C.widgetSave))}</button>${widgetCode ? `<button class="btn ghost" data-action="widget-clear">${esc(t(C.widgetUnpair))}</button>` : ""}</div>
      <p class="muted small" id="widget-status" role="status">${esc(t(widgetCode ? C.widgetPaired : C.widgetNotPaired))}</p></div>
    <p class="section">${esc(t(C.getApps))}</p><div class="card"><p class="muted small">${esc(t(C.getAppsNote))}</p>
      <div class="row"><a class="btn ghost" href="${DOWNLOADS_URL}" target="_blank" rel="noopener">Android · Windows · Mac</a>${platform !== "web" ? `<a class="btn ghost" href="${WEB_URL}" target="_blank" rel="noopener">Web</a>` : ""}</div></div>
    <p class="muted tiny center">Haru ${APP_VERSION} · ${platform} · © OpenStreetMap contributors · Open-Meteo</p>`;
  return sheetFrame(t(C.settings), body);
}

// ---------- onboarding ----------

function renderOnboarding() {
  const page = state.onboardingPage;
  const dots = [0, 1, 2].map((i) => `<span class="${i === page ? "on" : ""}"></span>`).join("");
  let body;
  if (page === 0) {
    body = `<img class="ob-scene" src="scenes/clear__dusk__spring.jpg" alt=""><h2 class="ob-title">Haru</h2><p class="muted center">${esc(t(C.tagline))}</p>
      <div class="ob-foot"><div class="dots">${dots}</div><button class="btn wide" data-action="ob-next">${esc(t(C.next))}</button></div>`;
  } else if (page === 1) {
    body = `<h2 class="center">${esc(t(C.language))}</h2><div class="card list">${LANGS.map((l) => `<button class="list-row" data-action="lang" data-lang="${l}"><span>${LANG_TITLES[l]}</span>${l === lang() ? '<span class="check">✓</span>' : ""}</button>`).join("")}</div>
      <div class="ob-foot"><div class="dots">${dots}</div><button class="btn wide" data-action="ob-next">${esc(t(C.next))}</button></div>`;
  } else {
    body = `<img class="ob-scene small" src="scenes/clear__morning__spring.jpg" alt=""><p class="muted center">${esc(t(C.locationWhy))}</p>
      ${geolocationAvailable() ? `<button class="btn ghost wide" data-action="ob-location">📍 ${esc(t(C.allowLocation))}</button>` : ""}
      <div class="ob-foot"><div class="dots">${dots}</div><button class="btn wide" data-action="ob-finish" data-sample="1">${esc(t(C.lookAround))}</button><button class="btn ghost wide" data-action="ob-finish" data-sample="0">${esc(t(C.startMine))}</button></div>`;
  }
  $("#onboarding").innerHTML = `<div class="onboarding">${body}</div>`;
}

async function finishOnboarding(sample) {
  localStorage.setItem("onboarding.done", "1");
  store.setSample(sample);
  await reloadDiary();
  go("#/today");
}

async function reloadDiary() {
  await store.connect();
  if (store.isSample()) await demo.seed();
  await loadData();
  await refreshScene();
  await ensureToday();
  render();
}

// ---------- actions ----------

async function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (el.tagName === "INPUT") return; // handled by change
  switch (action) {
    case "sheet":
      event.preventDefault();
      if (el.dataset.sheet === "capture") state.capture = { kind: "moment", style: "crayon", bitmap: null, blob: null, mood: 0 };
      openSheet(el.dataset.sheet);
      break;
    case "close-sheet":
      closeSheet();
      break;
    case "day":
      openSheet(`day:${el.dataset.date}`);
      break;
    case "deck":
      stepDeck(Number(el.dataset.step));
      break;
    case "cal": {
      const base = state.calendarMonth || new Date();
      state.calendarMonth = new Date(base.getFullYear(), base.getMonth() + Number(el.dataset.step), 1);
      render();
      break;
    }
    case "prompt-skip":
      localStorage.setItem("prompt.done", store.dateKey());
      render();
      break;
    case "prompt-keep":
      localStorage.setItem("prompt.done", store.dateKey());
      state.capture = { kind: "moment", style: "crayon", bitmap: null, blob: null, mood: 0, prompt: t(C.prompts[Number(el.dataset.index)]) };
      openSheet("capture");
      break;
    case "walk-start":
      state.recorder = state.recorder || new WalkRecorder(onWalkUpdate);
      await state.recorder.begin();
      render();
      break;
    case "walk-stop": {
      const result = await state.recorder.finish();
      if (result) {
        const day = await ensureToday();
        day.walkedMeters = (day.walkedMeters || 0) + result.walk.meters;
        day.newMeters = (day.newMeters || 0) + result.newMeters;
        await store.put("days", day);
        await loadData();
      }
      render();
      break;
    }
    case "cap-kind":
      state.capture.text = $("#cap-text")?.value || "";
      state.capture.kind = el.dataset.kind;
      renderSheet("capture");
      break;
    case "cap-style":
      state.capture.text = $("#cap-text")?.value || "";
      state.capture.style = el.dataset.style;
      toast(t(C.doodling));
      state.capture.blob = await doodle(state.capture.bitmap, state.capture.style);
      renderSheet("capture");
      break;
    case "cap-mood":
      state.capture.text = $("#cap-text")?.value || "";
      state.capture.mood = Number(el.dataset.mood) === state.capture.mood ? 0 : Number(el.dataset.mood);
      renderSheet("capture");
      break;
    case "cap-save":
      await saveCapture();
      break;
    case "tidy":
      await decideTidy(el.dataset.decision);
      break;
    case "tidy-drawer":
      state.tidyOverride = el.dataset.drawer;
      renderSheet("tidy");
      break;
    case "copy-clip": {
      const clip = state.clips.find((c) => c.id === el.dataset.id);
      await navigator.clipboard?.writeText(clip.text);
      toast(t(C.copied));
      break;
    }
    case "clip-letgo": {
      const clip = state.clips.find((c) => c.id === el.dataset.id);
      await store.del("clips", clip.id);
      if (clip.image && !clip.image.startsWith("shots/")) await store.del("photos", clip.image);
      state.clips = state.clips.filter((c) => c.id !== clip.id);
      closeSheet();
      break;
    }
    case "lang":
      setLang(el.dataset.lang);
      render();
      break;
    case "city-pick": {
      const place = { name: el.dataset.name, lat: Number(el.dataset.lat), lon: Number(el.dataset.lon) };
      localStorage.setItem("weather.place", JSON.stringify(place));
      await refreshScene();
      await ensureToday();
      await loadData();
      render();
      break;
    }
    case "export":
      await exportBackup();
      break;
    case "widget-save": {
      const typed = ($("#widget-code")?.value || "").trim();
      const result = typed ? await widget.setCode(typed) : "invalid";
      if (result === "ok") {
        renderSheet("settings");
        widgetPublish();
        toast(t(C.widgetPaired));
      } else {
        const status = $("#widget-status");
        if (status) status.textContent = t(result === "offline" ? C.widgetOffline : C.widgetBadCode);
      }
      break;
    }
    case "widget-clear":
      await widget.setCode("");
      renderSheet("settings");
      break;
    case "ob-next":
      state.onboardingPage += 1;
      renderOnboarding();
      break;
    case "ob-location":
      try {
        await currentPosition(12000);
        localStorage.setItem("weather.useLocation", "1");
        el.textContent = "✓";
      } catch {
        toast(t(C.noLocation));
      }
      break;
    case "ob-finish":
      await finishOnboarding(el.dataset.sample === "1");
      break;
    default:
      break;
  }
}

async function onChange(event) {
  const el = event.target;
  const input = el.dataset.input || el.dataset.action;
  if (input === "cap-photo" && el.files?.[0]) {
    state.capture.text = $("#cap-text")?.value || "";
    toast(t(C.doodling));
    state.capture.bitmap = await loadBitmap(el.files[0]);
    state.capture.blob = await doodle(state.capture.bitmap, state.capture.style);
    renderSheet("capture");
  } else if (input === "shots" && el.files?.length) {
    await addScreenshots(el.files);
  } else if (input === "realmap") {
    state.realMap = el.checked;
    $("#map")?.classList.toggle("paper", !el.checked);
  } else if (input === "sample") {
    store.setSample(el.checked);
    await reloadDiary();
    openSheet("settings");
  } else if (input === "use-location") {
    if (el.checked) {
      try {
        await currentPosition(12000);
        localStorage.setItem("weather.useLocation", "1");
      } catch {
        el.checked = false;
        toast(t(C.noLocation));
      }
    } else {
      localStorage.setItem("weather.useLocation", "0");
    }
    await refreshScene();
    render();
  } else if (input === "import" && el.files?.[0]) {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (store.isSample()) store.setSample(false);
      await store.connect();
      await store.importAll(data);
      await reloadDiary();
      toast(t(C.imported));
    } catch (error) {
      toast(String(error.message || error));
    }
  } else if (input === "clip-drawer") {
    const clip = state.clips.find((c) => c.id === el.dataset.id);
    clip.drawer = el.value;
    await store.put("clips", clip);
    renderSheet(`clip:${clip.id}`);
  }
}

let citySearchTimer = null;
function onInput(event) {
  const el = event.target;
  if (el.dataset.input === "search") {
    state.search = el.value;
    state.deckIndex = 0;
    const caret = el.selectionStart;
    render();
    const box = $('[data-input="search"]');
    box.focus();
    box.setSelectionRange(caret, caret);
  } else if (el.id === "cap-text" && state.capture.kind === "fragment") {
    $("#cap-count").textContent = t(C.fragmentFooter(el.value.length, 80));
  } else if (el.dataset.input === "city") {
    clearTimeout(citySearchTimer);
    const query = el.value.trim();
    if (query.length < 2) return;
    citySearchTimer = setTimeout(async () => {
      try {
        const results = await searchPlaces(query, lang() === "korean" ? "ko" : lang() === "english" ? "en" : "ja");
        $("#city-results").innerHTML = results.map((r) => `<button class="list-row" data-action="city-pick" data-name="${esc(r.name)}" data-lat="${r.lat}" data-lon="${r.lon}"><span>${esc(r.name)}</span></button>`).join("");
      } catch {
        $("#city-results").innerHTML = "";
      }
    }, 350);
  }
}

function onWalkUpdate(recorder) {
  const label = $("#walk-distance");
  if (label) label.textContent = formatDistance(recorder.meters);
}

async function saveCapture() {
  const cap = state.capture;
  const text = ($("#cap-text")?.value || "").trim();
  if (cap.kind === "fragment") {
    if (!text) return closeSheet();
    const fragment = { id: store.uid(), text: text.slice(0, 80), at: Date.now() };
    await store.put("fragments", fragment);
  } else {
    if (!text && !cap.blob && !cap.mood) return closeSheet();
    const day = await ensureToday();
    const photo = cap.blob ? await store.savePhoto(cap.blob) : null;
    day.moments = day.moments || [];
    day.moments.push({ id: store.uid(), at: Date.now(), text: cap.prompt && text ? `${cap.prompt}\n${text}` : text, mood: cap.mood || 0, photo });
    await store.put("days", day);
  }
  state.capture = { kind: "moment", style: "crayon", bitmap: null, blob: null, mood: 0 };
  await loadData();
  closeSheet();
}

async function exportBackup() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const name = `haru-backup-${store.dateKey()}.json`;
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch {
      // fall back to a download link
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- boot ----------

async function boot() {
  setLang(lang());
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("sheet-open")) closeSheet();
    const route = parseRoute();
    if (route.params.get("sheet") === "tidy") {
      if (event.key === "ArrowRight") decideTidy("keep");
      if (event.key === "ArrowLeft") decideTidy("letGo");
      if (event.key === "ArrowUp") decideTidy("later");
    } else if (route.tab === "days" && !route.params.get("sheet") && document.activeElement?.tagName !== "INPUT") {
      if (event.key === "ArrowRight") stepDeck(1);
      if (event.key === "ArrowLeft") stepDeck(-1);
    }
  });

  state.classifier = await ClipClassifier.load();
  await store.connect();
  if (store.isSample()) await demo.seed();
  await loadData();
  // "Later" screenshots come back the next day.
  for (const clip of state.clips.filter((c) => c.status === "later" && store.dateKey(new Date(c.reviewedAt || 0)) !== store.dateKey())) {
    clip.status = "inbox";
    await store.put("clips", clip);
  }
  render();
  refreshScene().then(async () => {
    if (localStorage.getItem("onboarding.done") === "1") await ensureToday();
    await loadData();
    if (!document.body.classList.contains("sheet-open")) render();
    else widgetPublish();
  });

  // iPhone widget: only paired browsers fetch the relay script; a code paired later starts the feed at once
  window.addEventListener("juw12-widget-code", widgetPublish);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) widgetPublish();
  });
  if (widget.wanted()) widget.load().then(widgetPublish);

  if ("serviceWorker" in navigator && platform === "web" && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
