/* CrewCup demo UI — vanilla JS, no build step. All business rules live in the Python engine. */
"use strict";

const params = new URLSearchParams(location.search);

const S = {
  data: null,
  derived: null,
  now: 0,
  rev: -1,
  persona: params.get("persona") || localStorage.getItem("cc.persona") || null,
  lang: params.get("lang") || localStorage.getItem("cc.lang") || "en",
  tab: {},
  drafts: {},
  order: { cafe: null, item: null, spec: {}, slot: null, targetRun: null, mode: "pickup" },
  preview: null,
  previewKey: "",
  orderError: null,
  scanLog: {},
  modal: null,
  pendingRender: false,
  adminOffice: params.get("office") || "o_jkt",
  badgeResult: null,
  nlResult: null,
  lastRender: 0,
  offset: 0,
  offline: false,
  seenNotes: null,
  installEvent: null,
  live: false,
  token: sessionStorage.getItem("cc.token") || null,
  tokenPersona: sessionStorage.getItem("cc.tokenPersona") || null,
  loginPromise: null,
  auditRows: null,
  demoOpen: params.get("demo") === "1",
  notesSeenAt: Number(localStorage.getItem("cc.notesSeen") || 0),
};
if (params.get("tab")) {
  for (const kind of ["emp", "cafe", "admin"]) {
    S.tab[kind] = params.get("tab");
  }
}
if (params.get("persona")) {
  localStorage.setItem("cc.persona", params.get("persona"));
}


/* ------------------------------------------------------------------ icons (24px line icons, stroke = currentColor) */

const ICONS = {
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M7 21l3-6 3 2v5"/><path d="M10 15l1-6 3 3 3 1"/><path d="M11 9l-3 2-1 3"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M16 9h3a2 2 0 0 1 2 2v10"/><path d="M9 7h3M9 11h3M9 15h3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0Z"/><path d="m19 7-3 7a3 3 0 0 0 6 0Z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/>',
  refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  truck: '<path d="M1 4h14v12H1z"/><path d="M15 9h4l3 3v4h-7"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  package: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><path d="M7 7h.01"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "check-circle": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  droplet: '<path d="M12 2.69 17.66 8.35a8 8 0 1 1-11.31 0Z"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "wifi-off": '<path d="m1 1 22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  "rotate-ccw": '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8 11h8M8 15h5"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  rain: '<path d="M16 13v8M8 13v8M12 15v8M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  idcard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  "eye-off": '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  "thumbs-up": '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};

function ic(name, extraClass) {
  const body = ICONS[name];
  if (!body) {
    return "";
  }
  return `<svg class="i${extraClass ? " " + extraClass : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function replaceIcons(html) {
  return html.replace(/\{\{i:([a-z-]+)\}\}/g, (match, name) => ic(name));
}

function stripIcons(text) {
  return String(text).replace(/\{\{i:[a-z-]+\}\}\s?/g, "");
}

function logoMark(size) {
  return `<span class="logo-mark" style="width:${size}px;height:${size}px">${ic("coffee")}</span>`;
}

/* ------------------------------------------------------------------ helpers */

function t(text, vars) {
  let out = S.lang === "id" && window.I18N_ID && window.I18N_ID[text] ? window.I18N_ID[text] : text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.split("{" + key + "}").join(value);
    }
  }
  return out;
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function msg(error) {
  if (!error) {
    return "";
  }
  if (S.lang === "id") {
    return error.message_id || error.id_text || error.message || error.en;
  }
  return error.message || error.en || error.message_id;
}

function noteText(note) {
  return S.lang === "id" ? note.id_text : note.en;
}

function country(code) {
  return S.data.countries[code];
}

function money(countryCode, amount) {
  const c = country(countryCode);
  const value = amount / Math.pow(10, c.decimals);
  try {
    return new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.currency,
      minimumFractionDigits: c.decimals,
      maximumFractionDigits: c.decimals,
    }).format(value);
  } catch (error) {
    return c.currency + " " + value.toFixed(c.decimals);
  }
}

function toMinor(countryCode, major) {
  return Math.round(Number(major) * Math.pow(10, country(countryCode).decimals));
}

function hmAt(ts, tzMin) {
  if (!ts && ts !== 0) {
    return "—";
  }
  return new Date((ts + tzMin * 60) * 1000).toISOString().substr(11, 5);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const TZ_LABEL = { ID: "WIB", SG: "SGT", MY: "MYT", TH: "ICT", PH: "PHT", VN: "ICT" };

function dayHm(ts, tzMin) {
  const date = new Date((ts + tzMin * 60) * 1000);
  const names = S.lang === "id" ? WEEKDAYS_ID : WEEKDAYS;
  return names[date.getUTCDay()] + " " + date.toISOString().substr(11, 5);
}

function minutesLeft(ts) {
  return Math.round((ts - S.now) / 60);
}

function d(key, fallback) {
  return Object.prototype.hasOwnProperty.call(S.drafts, key) ? S.drafts[key] : fallback;
}

function persona() {
  if (!S.persona) {
    return { kind: "none", id: null };
  }
  const [kind, id] = S.persona.split(":");
  return { kind, id };
}

function authHeaders(extra) {
  const headers = Object.assign({ "Content-Type": "application/json" }, extra || {});
  if (S.token) {
    headers["X-CrewCup-Session"] = S.token;
  }
  return headers;
}

function login(persona) {
  if (!persona) {
    S.token = null;
    S.tokenPersona = null;
    sessionStorage.removeItem("cc.token");
    sessionStorage.removeItem("cc.tokenPersona");
    S.loginPromise = Promise.resolve(null);
    return S.loginPromise;
  }
  if (S.token && S.tokenPersona === persona) {
    return S.loginPromise || Promise.resolve(S.token);
  }
  S.loginPromise = fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, via: "demo-sso" }),
  })
    .then((response) => response.json())
    .then((payload) => {
      if (payload.ok) {
        S.token = payload.token;
        S.tokenPersona = persona;
        sessionStorage.setItem("cc.token", payload.token);
        sessionStorage.setItem("cc.tokenPersona", persona);
      }
      return S.token;
    })
    .catch(() => null);
  return S.loginPromise;
}

async function ensureSession() {
  if (!S.persona) {
    return null;
  }
  if (!S.token || S.tokenPersona !== S.persona) {
    S.token = null;
    await login(S.persona);
  }
  return S.token;
}

function setPersona(value) {
  S.persona = value;
  if (value) {
    localStorage.setItem("cc.persona", value);
  } else {
    localStorage.removeItem("cc.persona");
  }
  S.token = null;
  S.auditRows = null;
  login(value);
  S.order = { cafe: null, item: null, spec: {}, slot: null, targetRun: null, mode: "pickup" };
  S.preview = null;
  S.orderError = null;
  S.badgeResult = null;
  S.nlResult = null;
  S.seenNotes = null;
  markNotesSeen();
}

function notesTarget() {
  const p = persona();
  if (p.kind === "emp") {
    return p.id;
  }
  if (p.kind === "cafe") {
    return "cafe:" + p.id;
  }
  if (p.kind === "admin") {
    return "admin";
  }
  return null;
}

function markNotesSeen() {
  if (!S.data) {
    return;
  }
  S.seenNotes = new Set(S.data.notifications.map((note) => note.id));
}

function localNow() {
  if (!S.data) {
    return S.now;
  }
  const clock = S.data.clock;
  if (clock.paused) {
    return clock.anchor_sim;
  }
  const real = Date.now() / 1000 + S.offset;
  return Math.floor(clock.anchor_sim + (real - clock.anchor_real) * clock.speed);
}

function me() {
  const p = persona();
  return p.kind === "emp" ? S.data.employees[p.id] : null;
}

function officeOf(emp) {
  return S.data.offices[emp.office];
}

function cafeName(cafeId) {
  return S.data.cafes[cafeId] ? S.data.cafes[cafeId].name : cafeId;
}

function itemName(cafe, itemId) {
  const item = cafe.menu[itemId];
  if (!item) {
    return itemId;
  }
  return S.lang === "id" ? item.name_id : item.name;
}

function teamColor(team) {
  const colors = {
    Engineering: "#2563eb",
    Design: "#db2777",
    Marketing: "#ea580c",
    Sales: "#16a34a",
    Finance: "#7c3aed",
    Operations: "#0891b2",
    People: "#ca8a04",
  };
  return colors[team] || "#57534e";
}

function personTeam(who) {
  const emp = S.data.employees[who];
  return emp ? emp.team : "Guest";
}

function cupBadge(code, who) {
  return `<span class="cup" style="background:${teamColor(personTeam(who))}">${esc(code)}</span>`;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function describeSpec(cafe, spec) {
  const item = cafe.menu[spec.item];
  const parts = [itemName(cafe, spec.item)];
  if (spec.size === "L") {
    parts.push("L");
  }
  if (item && item.temps.length > 1) {
    parts.push(spec.temp === "iced" ? t("iced") : t("hot"));
  }
  if (spec.milk && item && spec.milk !== item.milk) {
    parts.push(t("{milk} milk", { milk: t(spec.milk) }));
  }
  if (spec.sugar != null && spec.sugar !== 100) {
    parts.push(t("sugar {n}%", { n: spec.sugar }));
  }
  if (spec.ice && spec.ice !== "normal") {
    parts.push(t("{ice} ice", { ice: t(spec.ice) }));
  }
  if (spec.reusable) {
    parts.push(t("own cup"));
  }
  return parts.join(", ");
}

function activeLines(run) {
  return run.lines.filter((line) => line.status === "active");
}

function peopleIn(run) {
  return [...new Set(activeLines(run).map((line) => line.who))];
}

function qrSvg(seed, size) {
  const n = 25;
  const cell = size / n;
  let hash = 2166136261;
  for (const ch of String(seed)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const rand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    hash >>>= 0;
    return hash / 4294967296;
  };
  let rects = "";
  const finder = (x, y) => {
    rects += `<rect x="${x * cell}" y="${y * cell}" width="${7 * cell}" height="${7 * cell}" fill="#111"/>`;
    rects += `<rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/>`;
    rects += `<rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#111"/>`;
  };
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!inFinder && rand() > 0.52) {
        rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#111"/>`;
      }
    }
  }
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`;
}

function qrImg(data, size, extraQuery) {
  const query = extraQuery ? extraQuery : "data=" + encodeURIComponent(data);
  return `<img class="qr" src="/api/qr.svg?${query}&scale=4" width="${size}" height="${size}" alt="QR">`;
}

function emvQuery(cafeOrOffice, amount, reference) {
  const c = country(cafeOrOffice.country);
  return "emv=1&amount=" + encodeURIComponent(c.decimals ? (amount / Math.pow(10, c.decimals)).toFixed(2) : amount)
    + "&ref=" + encodeURIComponent(reference) + "&merchant=" + encodeURIComponent((cafeOrOffice.name || "CREWCUP").toUpperCase())
    + "&city=" + encodeURIComponent((cafeOrOffice.area || cafeOrOffice.name || "JAKARTA").split(",").pop().trim().toUpperCase())
    + "&country=" + cafeOrOffice.country + "&currency=" + c.currency;
}

function toast(text, kind) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = stripIcons(text);
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 7000 : 4000);
}

/* ------------------------------------------------------------------ API */

async function refresh(force) {
  try {
    if (S.persona && !S.token) {
      await ensureSession();
    }
    const response = await fetch("/api/state", { cache: "no-store", headers: authHeaders() });
    const payload = await response.json();
    const changed = payload.state.rev !== S.rev;
    const wasOffline = S.offline;
    S.data = payload.state;
    S.derived = payload.derived;
    S.social = payload.social || null;
    S.rewards = payload.rewards || null;
    S.loyalty = payload.loyalty || null;
    S.now = payload.now;
    S.rev = payload.state.rev;
    S.offset = payload.real_now - Date.now() / 1000;
    S.offline = false;
    announceNewNotes();
    const stale = Date.now() - S.lastRender > 5000;
    if (force || changed || stale || wasOffline) {
      requestRender();
    } else {
      updateClock();
    }
  } catch (error) {
    if (!S.offline) {
      S.offline = true;
      requestRender();
    }
  }
}

function announceNewNotes() {
  if (!S.seenNotes) {
    markNotesSeen();
    return;
  }
  const target = notesTarget();
  const fresh = S.data.notifications.filter((note) => !S.seenNotes.has(note.id));
  for (const note of fresh) {
    S.seenNotes.add(note.id);
    if (!target || note.to !== target) {
      continue;
    }
    const text = noteText(note);
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      showSystemNotification(text, note);
    } else {
      toast(text, note.kind === "action" ? "" : "ok");
    }
  }
}

async function showSystemNotification(text, note) {
  const options = {
    body: text,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: note.id,
    data: { url: "/?tab=" + (persona().kind === "cafe" ? "board" : "runs") },
  };
  try {
    const registration = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (registration) {
      registration.showNotification("CrewCup", options);
    } else {
      new Notification("CrewCup", options);
    }
  } catch (error) {
    console.warn(error);
  }
}

async function postAction(action, args) {
  await ensureSession();
  let response = await fetch("/api/action", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action, args }) });
  if (response.status === 401 && S.persona) {
    S.token = null;
    await ensureSession();
    response = await fetch("/api/action", { method: "POST", headers: authHeaders(), body: JSON.stringify({ action, args }) });
  }
  return response.json();
}

async function api(action, args, options) {
  const opts = options || {};
  const payload = await postAction(action, args);
  if (!payload.ok) {
    if (!opts.silent) {
      toast(msg(payload.error), "error");
    }
    await refresh(true);
    return payload;
  }
  if (opts.success) {
    toast(opts.success, "ok");
  }
  await refresh(true);
  return payload;
}

let previewTimer = null;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(loadPreview, 120);
}

async function loadPreview() {
  const emp = me();
  if (!emp || !S.order.cafe || !S.order.item) {
    S.preview = null;
    return;
  }
  const body = {
    emp: emp.id,
    cafe: S.order.cafe,
    spec: Object.assign({}, S.order.spec, { item: S.order.item }),
    slot: S.order.slot,
    coupon: d("order_coupon", "") || null,
  };
  const key = JSON.stringify(body);
  await ensureSession();
  const response = await fetch("/api/preview", { method: "POST", headers: authHeaders(), body: key });
  S.preview = await response.json();
  S.previewKey = key;
  requestRender();
}

/* ------------------------------------------------------------------ render loop */

function isEditing() {
  const el = document.activeElement;
  return el && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) && el.type !== "checkbox" && el.type !== "range";
}

function requestRender() {
  if (isEditing()) {
    S.pendingRender = true;
    updateClock();
    return;
  }
  render();
}

function render() {
  if (!S.data) {
    return;
  }
  S.pendingRender = false;
  S.lastRender = Date.now();
  document.documentElement.lang = S.lang;
  if (!S.persona || !validPersona()) {
    S.persona = null;
    document.getElementById("app").innerHTML = replaceIcons(signIn());
    return;
  }
  const scrollY = window.scrollY;
  const offline = S.offline ? `<div class="banner warn offline">{{i:wifi-off}} ${esc(t("Offline — showing the last data. Orders will work again when you reconnect."))}</div>` : "";
  document.getElementById("app").innerHTML = replaceIcons(header() + tabsBar() + `<main class="kind-${persona().kind}">${offline}${body()}</main>` + modal());
  window.scrollTo(0, scrollY);
}

function validPersona() {
  const p = persona();
  if (p.kind === "emp") {
    return !!S.data.employees[p.id];
  }
  if (p.kind === "cafe") {
    return !!S.data.cafes[p.id];
  }
  return p.kind === "admin" || p.kind === "guest";
}

function contextTz() {
  const p = persona();
  if (p.kind === "emp") {
    return officeOf(me()).tz_min;
  }
  if (p.kind === "cafe") {
    return S.data.cafes[p.id].tz_min;
  }
  if (p.kind === "admin") {
    return S.data.offices[S.adminOffice].tz_min;
  }
  return 420;
}

function contextCountry() {
  const p = persona();
  if (p.kind === "emp") {
    return officeOf(me()).country;
  }
  if (p.kind === "cafe") {
    return S.data.cafes[p.id].country;
  }
  if (p.kind === "admin") {
    return S.data.offices[S.adminOffice].country;
  }
  return "ID";
}

function clockText() {
  return dayHm(localNow(), contextTz()) + " " + TZ_LABEL[contextCountry()];
}

function updateClock() {
  const el = document.getElementById("clock-time");
  if (el && S.data) {
    el.textContent = clockText();
  }
}

/* ------------------------------------------------------------------ header */

function personaOptions() {
  const options = [];
  for (const office of Object.values(S.data.offices)) {
    const people = Object.values(S.data.employees).filter((emp) => emp.office === office.id && emp.active);
    options.push(`<optgroup label="${esc(t("Employee") + " — " + office.name + " (" + office.country + ")")}">`);
    for (const emp of people) {
      const value = "emp:" + emp.id;
      options.push(`<option value="${value}" ${S.persona === value ? "selected" : ""}>${esc(emp.name)} · ${esc(emp.team)}</option>`);
    }
    options.push("</optgroup>");
  }
  options.push(`<optgroup label="${esc(t("Café partner (barista tablet)"))}">`);
  for (const cafe of Object.values(S.data.cafes)) {
    const value = "cafe:" + cafe.id;
    options.push(`<option value="${value}" ${S.persona === value ? "selected" : ""}>${esc(cafe.name)} (${cafe.country})</option>`);
  }
  options.push("</optgroup>");
  options.push(`<optgroup label="${esc(t("Company"))}"><option value="admin:co" ${persona().kind === "admin" ? "selected" : ""}>${esc(t("Admin / Finance / HR"))} — ${esc(S.data.company.name)}</option></optgroup>`);
  options.push(`<optgroup label="${esc(t("Shared link"))}"><option value="guest:" ${persona().kind === "guest" ? "selected" : ""}>${esc(t("Guest (no app, no login)"))}</option></optgroup>`);
  return options.join("");
}

function unreadCount() {
  const emp = me();
  if (!emp) {
    return 0;
  }
  const seen = S.notesSeenAt || 0;
  return S.data.notifications.filter((note) => note.to === emp.id && note.ts > seen).length;
}

/* Demo-only controls (switch user, simulated clock, reset) live in one drawer so the real app header stays clean. */
function demoPanel() {
  if (!S.demoOpen) {
    return "";
  }
  const speed = S.data.clock.paused ? 0 : S.data.clock.speed;
  return `<div class="demo-panel">
    <label class="field">${esc(t("View as"))}<select data-change="persona">${personaOptions()}</select></label>
    <div class="field"><span>${esc(t("Simulated time"))}</span>
      <div class="row" style="gap:6px">
        <button class="btn small" data-act="clock" data-min="5">+5m</button>
        <button class="btn small" data-act="clock" data-min="15">+15m</button>
        <button class="btn small" data-act="clock" data-min="60">+1h</button>
        <select data-change="speed">${[[0, t("Pause")], [1, "1×"], [10, "10×"], [60, "60×"]].map(([value, label]) => `<option value="${value}" ${Number(speed) === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      </div>
    </div>
    <div class="row demo-actions">
      ${S.installEvent ? `<button class="btn small primary" data-act="install">${ic("download")} ${esc(t("Install app"))}</button>` : ""}
      <button class="btn small" data-act="reset">${ic("rotate-ccw")} ${esc(t("Reset demo data"))}</button>
      <button class="btn small" data-act="signout">${ic("logout")} ${esc(t("Sign out"))}</button>
      <button class="btn small" data-act="demo">${ic("x")} ${esc(t("Close"))}</button>
    </div>
  </div>`;
}

function header() {
  const emp = me();
  const unread = unreadCount();
  const account = emp
    ? `<button class="avatar-btn" data-act="tab" data-tab="profile" title="${esc(t("Profile & settings"))}" style="background:${teamColor(emp.team)}">${esc(initials(emp.name))}</button>`
    : `<button data-act="signout" class="icon-btn" title="${esc(t("Sign out"))}">${ic("logout")}</button>`;
  return `
  <header class="top">
    <div class="brand">${logoMark(30)}<span class="wordmark">CrewCup</span></div>
    <div class="spacer"></div>
    <button class="demo-btn ${S.demoOpen ? "on" : ""}" data-act="demo" title="${esc(t("Demo controls: switch user, move time"))}">
      ${ic("clock")}<span class="time" id="clock-time">${esc(clockText())}</span><span class="demo-tag">${esc(t("Demo"))}</span>
    </button>
    <span class="live ${S.live ? "on" : ""}" title="${esc(S.live ? t("Live updates on") : t("Reconnecting…"))}"></span>
    ${emp ? `<button class="icon-btn bell" data-act="notes" title="${esc(t("Notifications"))}">${ic("bell")}${unread ? `<span class="dot-count">${unread > 9 ? "9+" : unread}</span>` : ""}</button>` : ""}
    <button data-act="lang" class="icon-btn" title="${esc(t("Language"))}">${S.lang === "id" ? "EN" : "ID"}</button>
    ${account}
  </header>
  ${demoPanel()}`;
}

const TABS = {
  emp: [["home", "Home"], ["order", "Order"], ["runs", "My orders"], ["gifts", "Rewards"], ["network", "Network"]],
  cafe: [["board", "Orders"], ["labels", "Labels"], ["slots", "Slots"], ["insights", "Payouts"], ["catering", "Catering"], ["network", "Network"]],
  admin: [["overview", "Overview"], ["policy", "Policy & budgets"], ["spend", "Spend & tax"], ["people", "People & fairness"], ["engage", "Engagement"], ["network", "Network"], ["rewards", "Rewards"], ["audit", "Audit log"], ["markets", "SEA markets"]],
  guest: [],
};

const TAB_ICONS = {
  home: "home", order: "coffee", runs: "users", meetings: "calendar", gifts: "gift", profile: "user",
  board: "clipboard", labels: "tag", slots: "timer", insights: "chart", catering: "package",
  overview: "dashboard", policy: "sliders", spend: "receipt", people: "scale", engage: "shuffle", audit: "search", markets: "globe",
  network: "share", rewards: "award",
};

function currentTab() {
  const kind = persona().kind;
  const tabs = TABS[kind];
  if (!tabs.length) {
    return null;
  }
  const chosen = S.tab[kind];
  const hidden = HIDDEN_TABS[kind] || [];
  return tabs.some(([key]) => key === chosen) || hidden.includes(chosen) ? chosen : tabs[0][0];
}

/* Reachable from the header / other screens, but not shown in the main nav. */
const HIDDEN_TABS = { emp: ["profile", "meetings"] };
const TAB_PARENT = { meetings: "runs" };

function tabsBar() {
  const kind = persona().kind;
  const tabs = TABS[kind];
  if (!tabs.length) {
    return "";
  }
  const cur = TAB_PARENT[currentTab()] || currentTab();
  let extra = "";
  if (kind === "admin") {
    extra = `<span class="tab-extra"><select data-change="adminOffice">${Object.values(S.data.offices).map((office) => `<option value="${office.id}" ${office.id === S.adminOffice ? "selected" : ""}>${esc(office.name)} (${office.country})</option>`).join("")}</select></span>`;
  }
  return `<nav class="tabs tabs-${kind}">${tabs.map(([key, label]) => `<button class="${key === cur ? "on" : ""}" data-act="tab" data-tab="${key}"><span class="ti">${ic(TAB_ICONS[key])}</span><span class="tl">${esc(t(label))}</span></button>`).join("")}${extra}</nav>`;
}

function body() {
  const p = persona();
  const tab = currentTab();
  if (p.kind === "emp") {
    return { home: empHome, order: empOrder, runs: () => empOrdersTab("runs"), network: empNetwork, meetings: () => empOrdersTab("meetings"), gifts: empGiftsTab, profile: empProfile }[tab]();
  }
  if (p.kind === "cafe") {
    return { board: cafeBoard, labels: cafeLabels, slots: cafeSlots, insights: cafeInsights, catering: cafeCatering, network: cafeNetwork }[tab]();
  }
  if (p.kind === "admin") {
    return { overview: adminOverview, policy: adminPolicy, spend: adminSpend, people: adminPeople, engage: adminEngage, network: adminNetwork, rewards: adminRewards, audit: adminAudit, markets: adminMarkets }[tab]();
  }
  return guestView();
}

/* ------------------------------------------------------------------ employee: home */

function myNotes(target, limit) {
  return S.data.notifications
    .filter((note) => note.to === target)
    .sort((a, b) => b.ts - a.ts || (b.id > a.id ? 1 : -1))
    .slice(0, limit || 14);
}

function notesList(target, tz, limit) {
  const notes = myNotes(target, limit);
  if (!notes.length) {
    return `<div class="empty">${esc(t("No notifications yet"))}</div>`;
  }
  return `<div class="notes">${notes.map((note) => `<div class="note ${note.kind}"><span class="tm">${hmAt(note.ts, tz)}</span><span>${esc(noteText(note))}</span></div>`).join("")}</div>`;
}

function badgeCard(emp) {
  const office = officeOf(emp);
  return `
  <div class="card badge-card">
    <div class="row between">
      <div>
        <div class="company">${esc(S.data.company.name)}</div>
        <div class="name">${esc(emp.name)}</div>
        <div>${esc(emp.team)} · ${esc(office.name)} ${esc(emp.floor)} · ${t("desk")} ${esc(emp.desk)}</div>
        <div class="small" style="opacity:.8;margin-top:6px">${t("Badge")} <b class="mono">${esc(emp.badge_id)}</b></div>
      </div>
      <div style="text-align:center">
        <div class="avatar" style="background:${teamColor(emp.team)}">${esc(initials(emp.name))}</div>
      </div>
    </div>
    <div class="row" style="margin-top:10px;gap:14px">
      ${qrImg("CREWCUP:BADGE:" + emp.badge_id, 84)}
      <div class="small" style="opacity:.9">${esc(t("Show this at the café counter to pick up your order."))}</div>
    </div>
  </div>`;
}

function walletCard(emp) {
  const office = officeOf(emp);
  const info = S.derived.employees[emp.id];
  const allowance = info.allowance;
  const reason = {
    ok: t("Usable at any partner café in {country} — office or near home", { country: country(office.country).name }),
    office_days_only: t("Company policy: allowance only on office days"),
    other_country: t("Not valid in this country"),
  }[allowance.reason];
  const pct = allowance.daily ? Math.round(((allowance.used + allowance.held) / allowance.daily) * 100) : 0;
  return `
  <div class="card stack">
    <div class="row between"><h3>${t("Wallet & allowance")}</h3><button class="btn small primary" data-act="topup">${t("Top up")}</button></div>
    <div class="grid g3">
      <div><div class="kpi-label">${t("CrewCup wallet")}</div><div class="kpi">${money(office.country, emp.wallet.balance)}</div><div class="small muted">${t("available")} ${money(office.country, info.wallet_available)}</div></div>
      <div><div class="kpi-label">${t("Gift credit")}</div><div class="kpi">${money(office.country, emp.wallet.gift)}</div><div class="small muted">${t("from teammates & company")}</div></div>
      <div><div class="kpi-label">${t("Today's allowance")}</div><div class="kpi">${money(office.country, allowance.remaining)}</div><div class="small muted">${t("of")} ${money(office.country, allowance.daily)} · ${t("held")} ${money(office.country, allowance.held)}</div></div>
    </div>
    <div class="bar ${pct > 90 ? "warn" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div>
    <div class="small ${allowance.eligible ? "muted" : ""}">${allowance.eligible ? "{{i:check}} " : "{{i:alert}} "}${esc(reason)}</div>
    <div class="small muted">${t("We use your allowance first, then gift credit, then your wallet.")}</div>
  </div>`;
}

function greeting(tzMin) {
  const hour = Math.floor((((localNow() + tzMin * 60) % 86400) + 86400) % 86400 / 3600);
  if (hour < 11) {
    return t("Good morning");
  }
  if (hour < 15) {
    return t("Good afternoon");
  }
  return t("Good evening");
}

function usualButton(emp) {
  const usual = emp.profile.usual;
  if (usual && S.data.cafes[usual.cafe]) {
    const cafe = S.data.cafes[usual.cafe];
    const spec = Object.assign({ size: "R", temp: cafe.menu[usual.spec.item] ? cafe.menu[usual.spec.item].temps[0] : "hot" }, usual.spec);
    return `<button class="btn primary hero-cta" data-act="reorder" data-which="usual">
      <span class="cta-main">${ic("coffee")} ${esc(t("Order my usual"))}</span>
      <small>${esc(describeSpec(cafe, spec))} · ${esc(cafe.name)}</small>
    </button>`;
  }
  if (emp.last_spec && emp.last_cafe && S.data.cafes[emp.last_cafe] && S.data.cafes[emp.last_cafe].menu[emp.last_spec.item]) {
    const cafe = S.data.cafes[emp.last_cafe];
    return `<button class="btn primary hero-cta" data-act="reorder" data-which="last">
      <span class="cta-main">${ic("refresh")} ${esc(t("Order again"))}</span>
      <small>${esc(describeSpec(cafe, emp.last_spec))} · ${esc(cafe.name)}</small>
    </button>`;
  }
  return `<button class="btn primary hero-cta" data-act="tab" data-tab="order"><span class="cta-main">${ic("coffee")} ${esc(t("Order a coffee"))}</span></button>`;
}

function openRunCount(emp) {
  return Object.values(S.data.runs).filter((run) => run.office === emp.office && run.kind === "group" && run.status === "open" && !peopleIn(run).includes(emp.id)).length;
}

function homeHero(emp, info) {
  const office = officeOf(emp);
  const where = info.in_office_today
    ? `${ic("building")} ${esc(t("In the office"))} · ${esc(office.name)} <button class="linkish" data-act="inoffice" data-v="0">${esc(t("Working from home?"))}</button>`
    : `${ic("home")} ${esc(t("Working from home"))} <button class="linkish" data-act="inoffice" data-v="1">${esc(t("In the office?"))}</button>`;
  return `<div class="card hero">
    <div class="hero-text">
      <h2>${esc(greeting(office.tz_min))}, ${esc(emp.name.split(" ")[0])}</h2>
      <div class="small muted row" style="gap:6px">${where}</div>
    </div>
    <div class="hero-actions">
      ${usualButton(emp)}
      <div class="row" style="gap:8px">
        <button class="btn" data-act="tab" data-tab="order">${ic("plus")} ${esc(t("Something else"))}</button>
        <button class="btn" data-act="tab" data-tab="runs">${ic("users")} ${esc(t("Team runs"))}${openRunCount(emp) ? ` <span class="chip">${openRunCount(emp)}</span>` : ""}</button>
      </div>
    </div>
  </div>`;
}

function statStrip(emp, info) {
  const office = officeOf(emp);
  const allowance = info.allowance;
  const data = typeof lx === "function" ? lx() : null;
  const tiles = [
    `<div class="stat" title="${esc(allowance.eligible ? t("Applied automatically at checkout") : t("Company policy: allowance only on office days"))}">
      <div class="kpi-label">${esc(t("Allowance today"))}</div>
      <div class="stat-v">${money(office.country, allowance.remaining)}</div>
      <div class="small muted">${allowance.eligible ? esc(t("of {total}", { total: money(office.country, allowance.daily) })) : esc(t("Not available today"))}</div>
    </div>`,
    `<button class="stat" data-act="topup">
      <div class="kpi-label">${esc(t("Wallet"))}</div>
      <div class="stat-v">${money(office.country, emp.wallet.balance + emp.wallet.gift)}</div>
      <div class="small link">${esc(t("Top up"))}</div>
    </button>`,
  ];
  if (data) {
    const coupons = data.coupons.filter((coupon) => coupon.status === "active").length;
    tiles.push(`<button class="stat" data-act="tab" data-tab="gifts">
      <div class="kpi-label">${esc(t("Points"))}</div>
      <div class="stat-v">${data.points.toLocaleString()}</div>
      <div class="small muted">${esc(t(data.tier.label))}${coupons ? " · " + esc(t("{n} coupons", { n: coupons })) : ""}</div>
    </button>`);
  }
  tiles.push(`<button class="stat" data-act="badge">
    <div class="kpi-label">${esc(t("Company badge"))}</div>
    <div class="stat-v">${ic("qr")}</div>
    <div class="small link">${esc(t("Show badge"))}</div>
  </button>`);
  return `<div class="stat-strip">${tiles.join("")}</div>`;
}

/* At most three short, actionable suggestions instead of a wall of cards. */
function forYou(emp, info) {
  const items = [];
  const data = typeof lx === "function" ? lx() : null;
  if (data) {
    const coupons = data.coupons.filter((coupon) => coupon.status === "active");
    if (coupons.length) {
      items.push([`ticket`, t("You have {n} coupons ready", { n: coupons.length }), t("They're applied at checkout when you pick one."), "gifts", t("View")]);
    }
    const nextAch = data.achievements.filter((row) => !row.unlocked).sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
    if (nextAch && nextAch.progress / nextAch.target >= 0.5) {
      items.push([`award`, t("Almost there: {title}", { title: t(nextAch.title) }), `${nextAch.progress} / ${nextAch.target}`, "gifts", t("View")]);
    }
  }
  if (typeof net === "function") {
    const s = net();
    if (s && s.enabled) {
      const pending = s.chats.filter((chat) => !chat.outgoing && chat.status === "pending").length;
      const next = s.meetups.find((meetup) => meetup.start > S.now);
      if (pending) {
        items.push([`share`, t("{n} coffee-chat invitations", { n: pending }), t("From people in your building"), "network", t("Reply")]);
      } else if (next) {
        items.push([`calendar`, next.title, dayHm(next.start, netTz()), "network", t("View")]);
      }
    }
  }
  const rec = info.recommendations.cafes[0];
  if (rec && S.data.cafes[rec.cafe]) {
    const cafe = S.data.cafes[rec.cafe];
    const deal = rec.next_free && rec.next_free.discount_pct ? " · " + t("{n}% off now", { n: rec.next_free.discount_pct }) : "";
    items.push([`coffee`, t("Try {cafe}", { cafe: cafe.name }), `${rec.walk} ${t("min walk")}${deal}`, "cafe:" + cafe.id, t("Order")]);
  }
  if (!items.length) {
    return "";
  }
  return `<div class="card"><h3>${esc(t("For you"))}</h3>
    <div class="list">${items.slice(0, 3).map(([icon, title, sub, target, label]) => `<div class="list-row">
      <span class="list-ic">${ic(icon)}</span>
      <div class="list-main"><b>${esc(title)}</b><div class="small muted">${esc(sub)}</div></div>
      ${target.startsWith("cafe:") ? `<button class="btn small" data-act="pickcafe" data-cafe="${target.slice(5)}">${esc(label)}</button>` : `<button class="btn small" data-act="tab" data-tab="${target}">${esc(label)}</button>`}
    </div>`).join("")}</div>
  </div>`;
}

function empHome() {
  const emp = me();
  const office = officeOf(emp);
  const info = S.derived.employees[emp.id];
  const banners = [];
  if (S.data.company.policy.ramadan_mode) {
    const iftar = S.derived.offices[office.id].iftar_slot;
    banners.push(`<div class="banner ramadan">{{i:moon}} <b>${t("Ramadan mode")}</b> · ${t("Plan a buka puasa run for {time}.", { time: hmAt(iftar + 600, office.tz_min) })} <button class="btn small" data-act="iftar">${t("Start buka puasa run")}</button></div>`);
  }
  const mine = myRuns(emp.id).filter((run) => !["done", "released", "cancelled"].includes(run.status) || (run.done_at && S.now - run.done_at < 3600));
  return `
  <div class="stack home">
    ${banners.join("")}
    ${homeHero(emp, info)}
    ${statStrip(emp, info)}
    <div class="split">
      <div class="stack">
        ${mine.length ? `<div class="card"><h3>${t("On the way")}</h3>${mine.map((run) => miniRun(run, emp)).join("")}</div>` : ""}
        ${forYou(emp, info)}
        ${loungeCard()}
      </div>
      <div class="card">
        <div class="row between"><h3 style="margin:0">${t("Updates")}</h3><button class="btn small flat-btn" data-act="notes">${t("See all")}</button></div>
        ${notesList(emp.id, office.tz_min, 5)}
      </div>
    </div>
  </div>`;
}

/* CrewCup Lounge: the 3D coffee lounge (Nongkrong) styled as CrewCup. Sit with your crew, be the barista, or run the cafe. */
const LOUNGE_URL = "https://juw12.github.io/nongkrong/?host=crewcup&role=home";

function loungeCard() {
  return `<div class="card">
    <div class="row between"><h3 style="margin:0">{{i:coffee}} ${esc(t("Lounge"))}</h3><a class="btn small" href="${LOUNGE_URL}" target="_blank" rel="noopener">${esc(t("Open the Lounge"))}</a></div>
    <div class="small muted">${esc(t("A 3D coffee lounge for your crew: sit at a table and talk, make the drinks behind the bar, or run the cafe for a day."))}</div>
  </div>`;
}

function quickReorder(emp) {
  const usual = emp.profile.usual;
  const buttons = [];
  if (usual && S.data.cafes[usual.cafe]) {
    const cafe = S.data.cafes[usual.cafe];
    buttons.push(`<button class="btn primary big" data-act="reorder" data-which="usual">{{i:star}} ${esc(t("My usual"))}<small>${esc(describeSpec(cafe, Object.assign({ size: "R", temp: cafe.menu[usual.spec.item] ? cafe.menu[usual.spec.item].temps[0] : "hot" }, usual.spec)))} · ${esc(cafe.name)}</small></button>`);
  }
  if (emp.last_spec && emp.last_cafe && S.data.cafes[emp.last_cafe] && (!usual || JSON.stringify(emp.last_spec) !== JSON.stringify(usual.spec) || emp.last_cafe !== usual.cafe)) {
    const cafe = S.data.cafes[emp.last_cafe];
    if (cafe.menu[emp.last_spec.item]) {
      buttons.push(`<button class="btn big" data-act="reorder" data-which="last">{{i:refresh}} ${esc(t("Same as last time"))}<small>${esc(describeSpec(cafe, emp.last_spec))} · ${esc(cafe.name)}</small></button>`);
    }
  }
  const alerts = "Notification" in window && Notification.permission === "default"
    ? `<button class="btn small" data-act="alerts">{{i:bell}} ${esc(t("Turn on alerts"))}</button>` : "";
  if (!buttons.length && !alerts) {
    return "";
  }
  return `<div class="card quick"><div class="row between"><h3>{{i:zap}} ${esc(t("One-tap order"))}</h3>${alerts}</div>
    <div class="row">${buttons.join("") || `<span class="muted small">${esc(t("Save a usual from the Order tab to enable one-tap ordering."))}</span>`}</div>
    <div class="small muted">${esc(t("Next free slot, allowance applied automatically. Cup code arrives as a notification."))}</div></div>`;
}

function recCard(rec, office) {
  const cafe = S.data.cafes[rec.cafe];
  const next = rec.next_free;
  return `<div class="card flat">
    <div class="row between"><b>${esc(cafe.name)}</b><span class="chip">{{i:star}} ${cafe.rating}</span></div>
    <div class="small muted">${esc(cafe.area)} · {{i:walk}} ${rec.walk} ${t("min")}</div>
    <div class="row small" style="margin-top:6px">
      <span class="chip ${rec.load_pct > 80 ? "bad" : rec.load_pct > 50 ? "warn" : "ok"}">${t("busy")} ${rec.load_pct}%</span>
      ${next ? `<span class="chip">${t("next slot")} ${hmAt(next.slot, cafe.tz_min)}</span>` : ""}
      ${next && next.discount_pct ? `<span class="chip ok">-${next.discount_pct}% ${t("off-peak")}</span>` : ""}
      ${cafe.company_perk_pct[S.data.company.id] ? `<span class="chip info">${t("company perk")} -${cafe.company_perk_pct[S.data.company.id]}%</span>` : ""}
    </div>
    <button class="btn small" style="margin-top:8px" data-act="pickcafe" data-cafe="${cafe.id}">${t("Order here")}</button>
  </div>`;
}

const STEPS = {
  pickup: ["open", "queued", "making", "ready", "picked", "done"],
  solo: ["queued", "making", "ready", "done"],
  delivery: ["open", "queued", "making", "courier", "at_lobby", "done"],
  delivery_up: ["open", "queued", "making", "courier", "done"],
};
const STEP_LABEL = {
  open: "Collecting",
  queued: "Scheduled",
  needs_ack: "Allergy check",
  making: "Making",
  ready: "Ready",
  picked: "On the way back",
  courier: "With courier",
  at_lobby: "At lobby",
  done: "Delivered",
  released: "Released",
  cancelled: "Cancelled",
};

function timeline(run) {
  const office = S.data.offices[run.office];
  let key = run.mode === "delivery" ? (office.courier_upstairs ? "delivery_up" : "delivery") : run.kind === "solo" || run.kind === "remake" ? "solo" : "pickup";
  const steps = STEPS[key];
  const status = run.status === "needs_ack" ? "queued" : run.status;
  const index = steps.indexOf(status);
  if (index < 0) {
    return `<div class="row"><span class="chip ${status === "cancelled" ? "bad" : "warn"}">${t(STEP_LABEL[status] || status)}</span></div>`;
  }
  return `<div class="timeline">${steps.map((step, i) => `<div class="st ${i < index ? "done" : i === index ? "cur" : ""}">${t(STEP_LABEL[step])}</div>`).join("")}</div>`;
}

function miniRun(run, emp) {
  const cafe = S.data.cafes[run.cafe];
  const view = S.derived.runs[run.id];
  const mine = activeLines(run).filter((line) => line.who === emp.id);
  return `<div class="card flat" style="margin-bottom:10px">
    <div class="row between"><b>${esc(run.title)}</b><span class="chip dark mono">${esc(run.code)}</span></div>
    <div class="small muted">${esc(cafe.name)} · ${t("slot")} ${view ? view.slot_hm : ""} · ${run.mode === "delivery" ? "{{i:truck}} " + esc(run.deliver_to || "") : "{{i:walk}} " + t("pickup")}</div>
    ${timeline(run)}
    <div class="row">${mine.map((line) => cupBadge(line.code, line.who) + `<span class="small">${esc(describeSpec(cafe, line.spec))}</span>`).join(" ")}</div>
    <div class="row" style="margin-top:6px"><button class="btn small" data-act="openrun" data-run="${run.id}">${t("Open")}</button></div>
  </div>`;
}

function myRuns(empId) {
  return Object.values(S.data.runs)
    .filter((run) => run.host === empId || run.runner === empId || run.co_runners.includes(empId) || run.lines.some((line) => line.who === empId && line.status !== "removed"))
    .sort((a, b) => b.created - a.created);
}

/* ------------------------------------------------------------------ employee: order */

function empOrder() {
  const emp = me();
  const office = officeOf(emp);
  const info = S.derived.employees[emp.id];
  const recIds = info.recommendations.cafes.map((rec) => rec.cafe);
  const others = Object.values(S.data.cafes).filter((cafe) => cafe.country === office.country && !recIds.includes(cafe.id)).map((cafe) => cafe.id);
  const cafeIds = recIds.concat(others);
  if (!S.order.cafe || !cafeIds.includes(S.order.cafe)) {
    S.order.cafe = cafeIds[0];
  }
  const cafe = S.data.cafes[S.order.cafe];
  const target = S.order.targetRun ? S.data.runs[S.order.targetRun] : null;
  const slots = S.derived.cafes[cafe.id].slots.filter((row) => row.slot > S.now + 4 * 60).slice(0, 10);
  if (!S.order.slot || !slots.some((row) => row.slot === S.order.slot)) {
    const free = slots.find((row) => row.free > 0);
    S.order.slot = free ? free.slot : null;
  }
  return `
  <div class="split">
    <div class="stack">
      ${target ? `<div class="banner warn">{{i:plus}} ${t("Adding to run")} <b>${esc(target.title)}</b> (${esc(target.code)}) · ${esc(cafe.name)} · ${t("slot")} ${hmAt(target.slot, cafe.tz_min)} <button class="btn small" data-act="cleartarget">${t("Cancel")}</button></div>` : ""}
      <div class="card">
        <h3>{{i:message}} ${t("Just type it")}</h3>
        <div class="row">
          <input type="text" style="flex:1" data-draft="nl" value="${esc(d("nl", ""))}" placeholder="${esc(t("e.g. same as yesterday but oat milk, large · es kopi susu aren kurang manis sedikit es"))}">
          <button class="btn primary" data-act="nl">${t("Understand")}</button>
        </div>
        ${S.nlResult ? `<div class="small muted" style="margin-top:6px">→ ${esc(S.lang === "id" ? S.nlResult.summary_id : S.nlResult.summary)}</div>` : ""}
      </div>
      <div class="card">
        <h3>1 · ${t("Café")}</h3>
        <div class="grid g3 cafe-list">
          ${cafeIds.map((id) => {
            const c = S.data.cafes[id];
            const rec = info.recommendations.cafes.find((row) => row.cafe === id);
            return `<div class="cafe ${id === cafe.id ? "on" : ""}" data-act="pickcafe" data-cafe="${id}">
              <b>${esc(c.name)}</b><div class="small muted">${esc(c.area)}</div>
              <div class="small">${rec ? "{{i:walk}} " + rec.walk + " " + t("min") + (rec.near === "home" ? " · {{i:home}}" : "") : t("not nearby")}</div></div>`;
          }).join("")}
        </div>
      </div>
      <div class="card">
        <h3>2 · ${t("Menu")} <span class="muted small">· ${t("same price as at the counter — no markup")}</span></h3>
        <div class="menu-grid">${Object.values(cafe.menu).map((item) => menuCard(cafe, item, emp)).join("")}</div>
      </div>
      ${S.order.item ? customizer(cafe, emp) : ""}
      <div class="card">
        <h3>3 · ${t("Pickup slot")} <span class="muted small">· ${t("capacity is shared by every company ordering here")}</span></h3>
        ${target ? `<div class="small muted">${t("Slot is set by the run.")}</div>` : `<div class="slots">${slots.map((row) => slotCell(row, cafe)).join("")}</div>`}
      </div>
    </div>
    <div class="stack" style="position:sticky;top:110px">${orderSummary(cafe, emp, target)}</div>
  </div>`;
}

function menuCard(cafe, item, emp) {
  const sold = cafe.stock["item:" + item.id] === false;
  const allergies = emp.profile.allergies || [];
  const conflict = item.allergens.filter((a) => allergies.includes(a));
  const halalBlock = emp.profile.halal_only && !item.halal;
  return `<div class="menu-item ${S.order.item === item.id ? "on" : ""} ${sold ? "off" : ""}" data-act="${sold ? "" : "pickitem"}" data-item="${item.id}">
    <span class="nm">${esc(itemName(cafe, item.id))}</span>
    <span class="pr">${money(cafe.country, item.price)}</span>
    <span class="row small">
      ${item.halal ? `<span class="chip ok">${t("halal")}</span>` : `<span class="chip ${halalBlock ? "bad" : "warn"}">${t("not halal-certified")}</span>`}
      ${sold ? `<span class="chip bad">${t("sold out")}</span>` : ""}
      ${conflict.length ? `<span class="chip bad">{{i:alert}} ${esc(conflict.join(", "))}</span>` : ""}
      ${item.milk ? `<span class="chip">{{i:droplet}} ${t(item.milk)}</span>` : ""}
    </span>
  </div>`;
}

function optButtons(field, values, current, labels) {
  return values.map((value) => `<button class="btn small ${String(current) === String(value) ? "sel" : ""}" data-act="spec" data-field="${field}" data-value="${value}">${esc(labels ? labels(value) : value)}</button>`).join(" ");
}

function customizer(cafe, emp) {
  const item = cafe.menu[S.order.item];
  if (!item) {
    return "";
  }
  const spec = (S.preview && S.preview.ok && S.preview.spec) ? S.preview.spec : Object.assign({}, S.order.spec);
  const allergies = emp.profile.allergies || [];
  const milkLabel = (milk) => {
    const bad = (S.data.config.milk_allergens[milk] || []).some((a) => allergies.includes(a));
    const sold = cafe.stock["milk:" + milk] === false;
    const price = cafe.milk_prices[milk];
    return t(milk) + (price ? " +" + money(cafe.country, price) : "") + (bad ? " {{i:alert}}" : "") + (sold ? " {{i:x}}" : "");
  };
  return `<div class="card stack">
    <h3>${t("Customize")} · ${esc(itemName(cafe, item.id))}</h3>
    ${item.sizes ? `<div class="row"><span class="small muted" style="width:70px">${t("Size")}</span>${optButtons("size", ["R", "L"], spec.size || "R", (v) => v === "L" ? t("Large") + " +" + money(cafe.country, cafe.size_prices.L) : t("Regular"))}</div>` : ""}
    ${item.temps.length > 1 ? `<div class="row"><span class="small muted" style="width:70px">${t("Temp")}</span>${optButtons("temp", item.temps, spec.temp || item.temps[0], (v) => t(v))}</div>` : ""}
    ${item.milk ? `<div class="row"><span class="small muted" style="width:70px">${t("Milk")}</span>${optButtons("milk", Object.keys(cafe.milk_prices), spec.milk || item.milk, milkLabel)}</div>` : ""}
    ${item.sugar ? `<div class="row"><span class="small muted" style="width:70px">${t("Sugar")}</span>${optButtons("sugar", [0, 25, 50, 75, 100], spec.sugar != null ? spec.sugar : 100, (v) => v + "%")}</div>` : ""}
    ${(spec.temp || item.temps[0]) === "iced" ? `<div class="row"><span class="small muted" style="width:70px">${t("Ice")}</span>${optButtons("ice", ["less", "normal", "extra"], spec.ice || "normal", (v) => t(v))}</div>` : ""}
    <div class="row"><label class="check"><input type="checkbox" data-act-change="reusable" ${spec.reusable ? "checked" : ""}> {{i:leaf}} ${t("I'll bring my own cup")} (-${money(cafe.country, cafe.reusable_discount)})</label></div>
  </div>`;
}

function slotCell(row, cafe) {
  const pct = Math.round((row.load / row.capacity) * 100);
  const full = row.free <= 0;
  return `<div class="slot ${S.order.slot === row.slot ? "on" : ""} ${full ? "full" : ""}" data-act="${full ? "" : "pickslot"}" data-slot="${row.slot}">
    <div class="t">${row.hm}</div>
    <div>${row.load}/${row.capacity} ${row.peak ? "· " + t("peak") : ""}</div>
    ${row.discount_pct ? `<div class="chip ok" style="margin-top:2px">-${row.discount_pct}%</div>` : ""}
    <div class="bar ${pct >= 100 ? "bad" : pct > 70 ? "warn" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div>
  </div>`;
}

function priceTable(price, countryCode) {
  const rows = [[t("Menu price (same as counter)"), price.list]];
  if (price.offpeak) {
    rows.push([t("Off-peak slot") + " -" + price.offpeak_pct + "%", -price.offpeak]);
  }
  if (price.perk) {
    rows.push([t("Company perk") + " -" + price.perk_pct + "%", -price.perk]);
  }
  if (price.reusable) {
    rows.push([t("Own cup"), -price.reusable]);
  }
  if (price.coupon) {
    rows.push([t("Coupon") + ": " + price.coupon_title, -price.coupon]);
  }
  const taxLabel = price.tax_name + " " + Math.round(price.tax_rate * 100) + "%" + (price.tax_inclusive ? " (" + t("included") + ")" : "");
  rows.push([taxLabel, price.tax_inclusive ? null : price.tax]);
  return `<table class="price-table">${rows.map(([label, value]) => `<tr><td>${esc(label)}</td><td class="right">${value == null ? `<span class="muted small">${money(countryCode, price.tax)}</span>` : money(countryCode, value)}</td></tr>`).join("")}
    <tr class="total"><td>${t("Total")}</td><td class="right">${money(countryCode, price.gross)}</td></tr></table>
    ${price.absorbed ? `<div class="small muted">${t("Substitution cost {x} absorbed — you're never charged more.", { x: money(countryCode, price.absorbed) })}</div>` : ""}`;
}

function orderSummary(cafe, emp, target) {
  const office = officeOf(emp);
  const preview = S.preview;
  const openRuns = Object.values(S.data.runs).filter((run) => run.cafe === cafe.id && run.office === emp.office && run.kind === "group" && (run.status === "open" || ["queued", "needs_ack"].includes(run.status)));
  let content = `<div class="empty">${t("Pick a drink to see the price and how it's paid.")}</div>`;
  if (S.order.item && preview) {
    if (!preview.ok) {
      content = errorBox(preview.error);
    } else {
      const split = preview.split;
      content = `
        <div><b>${esc(S.lang === "id" ? preview.summary_id : preview.summary)}</b></div>
        ${preview.allergens.length ? `<div class="small">${t("Contains")}: ${esc(preview.allergens.join(", "))}</div>` : ""}
        ${priceTable(preview.price, cafe.country)}
        ${couponPicker(cafe)}
        <h4>${t("How it's paid")}</h4>
        <table class="price-table">
          ${split.allowance ? `<tr><td>{{i:building}} ${t("Company allowance")}</td><td class="right">${money(cafe.country, split.allowance)}</td></tr>` : ""}
          ${split.gift ? `<tr><td>{{i:gift}} ${t("Gift credit")}</td><td class="right">${money(cafe.country, split.gift)}</td></tr>` : ""}
          <tr><td>{{i:wallet}} ${t("Your wallet")}</td><td class="right">${money(cafe.country, split.wallet)}</td></tr>
        </table>
        ${preview.wallet_ok ? "" : `<div class="banner warn small">${t("Wallet too low.")} <button class="btn small primary" data-act="topup">${t("Top up")}</button></div>`}`;
    }
  }
  if (S.orderError) {
    content += errorBox(S.orderError);
  }
  const canOrder = S.order.item && preview && preview.ok;
  let actions = "";
  if (target) {
    actions = `<button class="btn primary" ${canOrder ? "" : "disabled"} data-act="join" data-run="${target.id}">{{i:plus}} ${t("Add to {code}", { code: target.code })}</button>`;
  } else {
    actions = `
      <button class="btn primary" ${canOrder && S.order.slot ? "" : "disabled"} data-act="solo" data-mode="pickup">{{i:walk}} ${t("Order for me · pickup")}</button>
      <button class="btn" ${canOrder && S.order.slot ? "" : "disabled"} data-act="solo" data-mode="delivery">{{i:truck}} ${office.courier_upstairs ? t("Deliver to my desk") : t("Deliver to lobby")}</button>
      <button class="btn accent" ${canOrder && S.order.slot ? "" : "disabled"} data-act="newrun">{{i:users}} ${t("Start a group run")}</button>`;
  }
  return `<div class="card stack">
    <h3>${t("Your order")}</h3>
    ${content}
    <div class="row">${actions}</div>
    ${canOrder ? `<button class="btn small" data-act="saveusual">{{i:star}} ${t("Save as my usual")}</button>` : ""}
    ${!target && openRuns.length ? `<h4>${t("Or join a run already going to {cafe}", { cafe: cafe.name })}</h4>${openRuns.map((run) => `<div class="row between"><span>${esc(run.title)} · ${hmAt(run.slot, cafe.tz_min)} · ${peopleIn(run).length} ${t("people")}${run.status !== "open" ? " · " + t("late add") : ""}</span><button class="btn small" ${canOrder ? "" : "disabled"} data-act="join" data-run="${run.id}">${t("Join")}</button></div>`).join("")}` : ""}
  </div>`;
}

function errorBox(error) {
  let extra = "";
  if (error.code === "SLOT_FULL" && error.data && error.data.suggestions) {
    const cafe = S.data.cafes[S.order.cafe];
    extra = `<div class="row" style="margin-top:6px">${error.data.suggestions.map((row) => `<button class="btn small" data-act="pickslot" data-slot="${row.slot}">${hmAt(row.slot, cafe.tz_min)}${row.discount_pct ? " (-" + row.discount_pct + "%)" : ""}</button>`).join("")}</div>`;
  }
  if (error.code === "ALLERGEN" && error.data && error.data.safe_milks && error.data.safe_milks.length) {
    extra = `<div class="row" style="margin-top:6px">${t("Safe options")}: ${error.data.safe_milks.map((milk) => `<button class="btn small" data-act="spec" data-field="milk" data-value="${milk}">${t(milk)}</button>`).join("")}</div>`;
  }
  if (error.code === "INSUFFICIENT") {
    extra = `<div style="margin-top:6px"><button class="btn small primary" data-act="topup">${t("Top up")}</button></div>`;
  }
  if (error.code === "AT_CAFE") {
    extra = `<div style="margin-top:6px"><button class="btn small" data-act="solo" data-mode="pickup" data-confirm="1">${t("Order in app anyway")}</button></div>`;
  }
  return `<div class="banner warn" style="display:block">{{i:alert}} ${esc(msg(error))}${extra}</div>`;
}

/* ------------------------------------------------------------------ employee: my orders (runs + meetings) */

function empOrdersTab(view) {
  const segs = [["runs", "Orders & team runs"], ["meetings", "Meetings"]];
  return `<div class="stack">
    <div class="row seg">${segs.map(([key, label]) => `<button class="btn small ${view === key ? "sel" : ""}" data-act="tab" data-tab="${key}">${esc(t(label))}</button>`).join("")}</div>
    ${view === "meetings" ? empMeetings() : empRuns()}
  </div>`;
}

/* ------------------------------------------------------------------ employee: runs */

function empRuns() {
  const emp = me();
  const open = Object.values(S.data.runs).filter((run) => run.office === emp.office && run.kind === "group" && (run.status === "open" || ["queued", "needs_ack"].includes(run.status)));
  const mine = myRuns(emp.id).filter((run) => run.status !== "cancelled" || S.now - run.created < 3600);
  const focus = S.drafts.openRun;
  return `<div class="stack">
    <div class="card"><h3>{{i:users}} ${t("Runs you can join at {office}", { office: officeOf(emp).name })}</h3>
      ${open.length ? `<table><tr><th>${t("Run")}</th><th>${t("Café")}</th><th>${t("Slot")}</th><th>${t("Cutoff")}</th><th>${t("People")}</th><th></th></tr>${open.map((run) => {
        const cafe = S.data.cafes[run.cafe];
        const left = minutesLeft(run.cutoff);
        return `<tr><td><b>${esc(run.title)}</b> <span class="chip mono">${esc(run.code)}</span><div class="small muted">${t("host")}: ${esc(S.data.employees[run.host].name)} · ${t(payModeLabel(run.pay_mode))}</div></td><td>${esc(cafe.name)}</td><td>${hmAt(run.slot, cafe.tz_min)}</td><td>${run.status === "open" ? hmAt(run.cutoff, cafe.tz_min) + ` <span class="chip ${left < 5 ? "bad" : "warn"}">${left} ${t("min")}</span>` : `<span class="chip info">${t("late add until café starts")}</span>`}</td><td>${peopleIn(run).length}</td><td><button class="btn small primary" data-act="joinrun" data-run="${run.id}">${t("Join")}</button></td></tr>`;
      }).join("")}</table>` : `<div class="empty">${t("No team runs open right now. Start one from Order.")}</div>`}
    </div>
    ${mine.length ? mine.map((run) => runDetail(run, emp, focus === run.id)).join("") : `<div class="empty">${t("You have no orders yet.")}</div>`}
  </div>`;
}

function payModeLabel(mode) {
  return { each: "each pays own", host: "host treats", company: "company-paid", rotation: "rotation treat" }[mode] || mode;
}

function runDetail(run, emp, focused) {
  const cafe = S.data.cafes[run.cafe];
  const office = S.data.offices[run.office];
  const view = S.derived.runs[run.id] || {};
  const lines = activeLines(run);
  const isHost = run.host === emp.id;
  const isRunner = run.runner === emp.id || run.co_runners.includes(emp.id) || ((run.kind === "solo" || run.kind === "remake") && run.host === emp.id);
  const tz = cafe.tz_min;
  const info = [];
  info.push(`<span class="chip">${t("slot")} ${view.slot_hm || hmAt(run.slot, tz)}</span>`);
  if (run.status === "open") {
    info.push(`<span class="chip warn">${t("cutoff")} ${hmAt(run.cutoff, tz)} (${minutesLeft(run.cutoff)} ${t("min")})</span>`);
  }
  info.push(`<span class="chip">${t(payModeLabel(run.pay_mode))}${run.payer && run.pay_mode !== "each" ? ": " + esc(S.data.employees[run.payer].name) : ""}</span>`);
  info.push(`<span class="chip">${run.mode === "delivery" ? "{{i:truck}} " + esc(run.deliver_to || "") : "{{i:walk}} " + t("pickup")}</span>`);
  if (run.mode === "pickup" && run.kind === "group") {
    info.push(`<span class="chip ${view.carry && view.carry.carriers > 1 ? "warn" : ""}">{{i:package}} ${view.carry ? view.carry.cups : 0} ${t("cups")} · ${view.carry ? view.carry.trays : 0} ${t("tray(s)")} · ${view.carry ? view.carry.carriers : 1} ${t("carrier(s)")}</span>`);
  }
  if (view.fire_due_hm && ["open", "queued", "needs_ack"].includes(run.status)) {
    info.push(`<span class="chip info">{{i:flame}} ${t("café starts at")} ${view.fire_due_hm} (${t("prep")} ${view.prep_min} ${t("min")})</span>`);
  }
  if (view.arrival_hm) {
    info.push(`<span class="chip info">{{i:walk}} ${t("runner arrives")} ${view.arrival_hm}</span>`);
  }
  if (run.freshness_min != null) {
    info.push(`<span class="chip ${run.freshness_min <= 3 ? "ok" : "warn"}">{{i:coffee}} ${t("waited {n} min after ready", { n: run.freshness_min })}</span>`);
  }
  if (run.visitor_pass) {
    info.push(`<span class="chip ok">{{i:ticket}} ${t("visitor pass")} ${esc(run.visitor_pass)}</span>`);
  }
  if (run.priority) {
    info.push(`<span class="chip bad">${t("PRIORITY remake — free")}</span>`);
  }
  const runners = [run.runner, ...run.co_runners].filter(Boolean).map((id) => esc(S.data.employees[id].name));
  const linesTable = `<table><tr><th>${t("Who")}</th><th>${t("Drink")}</th><th>${t("Cup")}</th><th class="right">${t("Price")}</th><th>${t("Paid by")}</th><th></th></tr>
    ${run.lines.filter((line) => line.status !== "removed" || line.who === emp.id).map((line) => {
      const removable = line.status === "active" && (line.who === emp.id || isHost) && (run.status === "open" || ["queued", "needs_ack"].includes(run.status));
      const flaggable = line.status === "active" && line.who === emp.id && ["picked", "done"].includes(run.status) && !line.flag;
      const sources = line.pay.filter((part) => part.amount > 0).map((part) => ({ allowance: "{{i:building}}", gift: "{{i:gift}}", wallet: "{{i:wallet}}", budget: "{{i:calendar}}", guest: "{{i:phone}} " + (part.method || "") }[part.src])).join(" ");
      return `<tr style="${line.status !== "active" ? "opacity:.5" : ""}"><td>${esc(line.name)}${line.owner_allergies.length ? ` <span class="chip bad">{{i:alert}} ${esc(line.owner_allergies.join(", "))}</span>` : ""}</td>
        <td>${esc(describeSpec(cafe, line.spec))}${line.substitution ? `<div class="small muted">{{i:refresh}} ${t("was")}: ${esc(line.substitution.from)}</div>` : ""}${line.needs_choice ? `<div class="chip warn">${t("needs a replacement")}</div>` : ""}${line.status !== "active" ? ` <span class="chip">${esc(line.status)}</span>` : ""}${line.flag ? ` <span class="chip warn">${t("reported")}: ${esc(line.flag.remedy)}</span>` : ""}</td>
        <td>${cupBadge(line.code, line.who)}${run.scanned.includes(line.code) ? " {{i:check-circle}}" : ""}</td>
        <td class="right">${money(cafe.country, line.price.gross)}</td><td>${sources}</td>
        <td class="nowrap">${removable ? `<button class="btn small bad" data-act="removeline" data-run="${run.id}" data-line="${line.id}">{{i:x}}</button>` : ""}
        ${flaggable ? `<button class="btn small" data-act="flag" data-run="${run.id}" data-line="${line.id}" data-remedy="remake">${t("Remake")}</button> <button class="btn small" data-act="flag" data-run="${run.id}" data-line="${line.id}" data-remedy="credit">${t("Credit")}</button>` : ""}</td></tr>`;
    }).join("")}
    <tr><td colspan="3"><b>${t("Total")}</b> · ${lines.length} ${t("cups")}</td><td class="right"><b>${money(cafe.country, view.total || 0)}</b></td><td colspan="2"></td></tr></table>`;
  return `<div class="card stack" id="run-${run.id}" style="${focused ? "outline:3px solid var(--brand-2)" : ""}">
    <div class="row between"><h3>${esc(run.title)} <span class="chip dark mono">${esc(run.code)}</span></h3><span class="muted">${esc(cafe.name)} · ${run.kind}</span></div>
    ${timeline(run)}
    <div class="row">${info.join("")}</div>
    ${runners.length ? `<div class="small">{{i:walk}} ${t("Runner")}: <b>${runners.join(", ")}</b></div>` : ""}
    ${linesTable}
    ${isHost && run.status === "open" && run.kind === "group" ? hostTools(run, view) : ""}
    ${isRunner && run.mode === "pickup" && ["open", "queued", "needs_ack", "making", "ready"].includes(run.status) ? runnerTools(run, view, emp) : ""}
    ${run.status === "at_lobby" && (peopleIn(run).includes(emp.id) || isHost) ? `<div class="banner warn">{{i:bell}} ${t("Courier is waiting at")} <b>${esc(office.lobby_point)}</b>. <button class="btn small primary" data-act="lobby" data-run="${run.id}">${t("I collected it for everyone")}</button></div>` : ""}
  </div>`;
}

function shareMessage(run) {
  const cafe = S.data.cafes[run.cafe];
  const base = location.origin;
  if (S.lang === "id") {
    return `${run.title} — ${cafe.name}, ambil ${hmAt(run.slot, cafe.tz_min)}. Ikut sebelum ${hmAt(run.cutoff, cafe.tz_min)}: ${base}/#join/${run.code} · Tamu (bayar QRIS): ${base}/#guest/${run.code}`;
  }
  return `${run.title} — ${cafe.name}, pickup ${hmAt(run.slot, cafe.tz_min)}. Join before ${hmAt(run.cutoff, cafe.tz_min)}: ${base}/#join/${run.code} · Guests (pay by QRIS): ${base}/#guest/${run.code}`;
}

function hostTools(run, view) {
  const suggested = view.suggested_runner;
  const text = shareMessage(run);
  return `<div class="callout stack">
    <div class="row"><b>${t("Host tools")}</b>
      <a class="btn small good" target="_blank" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <button class="btn small" data-act="copy" data-text="${esc(text)}">${t("Copy for Telegram / Teams / Lark")}</button>
      <a class="btn small" href="#guest/${run.code}" target="_blank">${t("Open guest link")}</a>
      <button class="btn small" data-act="locknow" data-run="${run.id}">${t("Close orders now")}</button>
    </div>
    <div class="row">${qrImg(location.origin + "/#join/" + run.code, 110)}<div class="small muted">${t("Put this on the pantry screen or Teams call — colleagues scan with their phone camera to join.")}<br><span class="mono">${esc(location.origin + "/#join/" + run.code)}</span></div></div>
    ${suggested && suggested !== run.runner ? `<div class="row">{{i:scale}} ${t("Fair rotation suggests")} <b>${esc(S.data.employees[suggested].name)}</b> ${t("as runner (fewest runs).")} <button class="btn small" data-act="setrunner" data-run="${run.id}" data-emp="${suggested}">${t("Ask them")}</button></div>` : ""}
  </div>`;
}

function runnerTools(run, view, emp) {
  const cafe = S.data.cafes[run.cafe];
  const walk = cafe.walk_min[run.office] || cafe.walk_min["home:" + emp.id] || 5;
  if (run.status === "ready") {
    return scanPanel(run, emp);
  }
  const departed = run.departed_at != null;
  const remaining = departed ? Math.max(0, Math.round(run.eta_min - (S.now - run.departed_at) / 60)) : null;
  return `<div class="callout stack">
    <b>{{i:walk}} ${t("Runner — fire on approach")}</b>
    <div class="small muted">${t("The café starts your drinks when you're {prep} minutes away, so they're fresh when you arrive — not sitting on the counter.", { prep: view.prep_min || "?" })}</div>
    ${departed ? `<div>${t("You're on the way — ETA {n} min.", { n: remaining })} ${view.fire_due_hm ? t("Café fires at {time}.", { time: view.fire_due_hm }) : ""}</div>` : ""}
    <div class="row">
      <label class="field">${t("ETA (min)")}<input type="number" min="0" max="60" style="width:80px" data-draft="eta_${run.id}" value="${esc(d("eta_" + run.id, walk))}"></label>
      <button class="btn primary" data-act="depart" data-run="${run.id}">${departed ? t("Update ETA") : t("I'm leaving now")}</button>
      ${departed ? `<button class="btn" data-act="delay" data-run="${run.id}" data-rem="${remaining}">{{i:rain}} ${t("Rain / macet +5 min")}</button>` : ""}
    </div>
  </div>`;
}

function scanPanel(run, emp) {
  const view = S.derived.runs[run.id];
  const log = S.scanLog[run.id] || [];
  const others = Object.values(S.data.runs).filter((other) => other.id !== run.id && other.cafe === run.cafe && activeLines(other).length);
  const wrong = others.length ? activeLines(others[0])[0].code : null;
  return `<div class="callout stack">
    <b>{{i:scan}} ${t("Scan-to-verify pickup")}</b>
    <div class="small muted">${t("Scan every cup label before you leave. Missing or wrong cups are caught here, not back at the office.")}</div>
    <div class="row">
      <input type="text" style="width:140px" class="mono" data-draft="scan_${run.id}" value="${esc(d("scan_" + run.id, ""))}" placeholder="AB-123">
      <button class="btn" data-act="scan" data-run="${run.id}">${t("Scan")}</button>
      ${view.remaining_codes.map((code) => `<button class="btn small" data-act="scan" data-run="${run.id}" data-code="${code}">{{i:scan}} ${code}</button>`).join("")}
      ${wrong ? `<button class="btn small bad" data-act="scan" data-run="${run.id}" data-code="${wrong}">${t("Scan a wrong cup (demo)")}</button>` : ""}
    </div>
    ${log.length ? `<div class="scanlog">${log.map((entry) => `<div class="${entry.ok ? "ok" : "bad"}">${esc(entry.text)}</div>`).join("")}</div>` : ""}
    <div class="row">
      <button class="btn good" data-act="pickup" data-run="${run.id}">{{i:check-circle}} ${t("All cups collected — leave café")}</button>
      ${view.remaining_codes.length ? `<button class="btn bad" data-act="pickup" data-run="${run.id}" data-missing="1">${t("Report {n} missing → priority remake", { n: view.remaining_codes.length })}</button>` : ""}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ employee: meetings, gifts, profile */

function empMeetings() {
  const emp = me();
  const events = Object.values(S.data.events).filter((event) => event.office === emp.office).sort((a, b) => a.start - b.start);
  const office = officeOf(emp);
  const cafes = Object.values(S.data.cafes).filter((cafe) => cafe.walk_min[office.id] != null);
  return `<div class="stack">
    <div class="small muted">${t("Drinks for your meetings arrive when the meeting starts and are paid from the meeting budget.")}</div>
    ${events.map((event) => {
      const run = event.run ? S.data.runs[event.run] : null;
      const mine = event.attendees[emp.id];
      return `<div class="card stack">
        <div class="row between"><h3>${esc(event.title)}</h3><span class="chip">${esc(event.source)}</span></div>
        <div class="muted">${dayHm(event.start, office.tz_min)} · ${esc(event.room)} · ${t("organizer")}: ${esc(S.data.employees[event.organizer].name)}</div>
        <div class="row">${Object.entries(event.attendees).map(([id, rsvp]) => `<span class="chip ${rsvp === "yes" ? "ok" : rsvp === "no" ? "bad" : "warn"}">${esc(S.data.employees[id].name)} · ${t(rsvp)}${S.data.employees[id].profile.fasting && S.data.company.policy.ramadan_mode ? " {{i:moon}}" : ""}</span>`).join("")}</div>
        ${mine ? `<div class="row">${t("Your RSVP")}: ${["yes", "maybe", "no"].map((value) => `<button class="btn small ${mine === value ? "sel" : ""}" data-act="rsvp" data-event="${event.id}" data-v="${value}">${t(value)}</button>`).join("")}</div>` : ""}
        ${!run && event.organizer === emp.id ? `<div class="row"><select data-draft="mcafe_${event.id}">${cafes.map((cafe) => `<option value="${cafe.id}" ${d("mcafe_" + event.id, cafes[0] && cafes[0].id) === cafe.id ? "selected" : ""}>${esc(cafe.name)}</option>`).join("")}</select><button class="btn primary" data-act="meetingorder" data-event="${event.id}">{{i:coffee}} ${t("Order for this meeting (company-paid)")}</button></div>` : ""}
        ${run ? runDetail(run, emp, false) : !mine && event.organizer !== emp.id ? "" : !run && event.organizer !== emp.id ? `<div class="small muted">${t("The organizer hasn't ordered yet.")}</div>` : ""}
      </div>`;
    }).join("") || `<div class="empty">${t("No meetings today.")}</div>`}
  </div>`;
}

function empGifts() {
  const emp = me();
  const office = officeOf(emp);
  const colleagues = Object.values(S.data.employees).filter((other) => other.id !== emp.id && other.active && S.data.offices[other.office].country === office.country);
  const received = S.data.gifts.filter((gift) => gift.to === emp.id || gift.from === emp.id).slice(-8).reverse();
  const reward = office.karma_reward;
  const presets = [1, 2, 3].map((n) => n * reward);
  return `<div class="grid g2">
    <div class="card stack">
      <h3>{{i:gift}} ${t("Send a coffee")}</h3>
      <div class="small muted">${t("Works for remote teammates too — they can use it at any partner café, including near home.")}</div>
      <label class="field">${t("To")}<select data-draft="gift_to">${colleagues.map((other) => `<option value="${other.id}" ${d("gift_to", colleagues[0] && colleagues[0].id) === other.id ? "selected" : ""}>${esc(other.name)} · ${esc(other.team)}${S.derived.employees[other.id].in_office_today ? "" : " · WFH"}</option>`).join("")}</select></label>
      <div class="row">${presets.map((amount) => `<button class="btn small ${Number(d("gift_amt", presets[0])) === amount ? "sel" : ""}" data-act="giftamt" data-v="${amount}">${money(office.country, amount)}</button>`).join("")}</div>
      <label class="field">${t("Paid from")}<select data-draft="gift_src"><option value="kudos" ${d("gift_src", "kudos") === "kudos" ? "selected" : ""}>${t("Team kudos budget (company)")}</option><option value="personal" ${d("gift_src", "kudos") === "personal" ? "selected" : ""}>${t("My wallet")}</option></select></label>
      <label class="field">${t("Message")}<input type="text" data-draft="gift_msg" value="${esc(d("gift_msg", t("Thanks for the help today!")))}"></label>
      <button class="btn primary" data-act="gift">${t("Send coffee")}</button>
    </div>
    <div class="stack">
      <div class="card stack">
        <h3>{{i:star}} ${t("Runner karma")}</h3>
        <div class="row"><div class="kpi">${emp.karma}</div><div class="muted">${t("points · {n} runs done", { n: emp.runs_done })}</div></div>
        <div class="bar"><i style="width:${Math.min(100, emp.karma)}%"></i></div>
        <div class="small muted">${t("+10 per run plus 1 per cup carried. 100 points = a free drink ({x}).", { x: money(office.country, reward) })}</div>
        <button class="btn" ${emp.karma >= 100 ? "" : "disabled"} data-act="karma">${t("Redeem 100 karma")}</button>
      </div>
      <div class="card"><h3>${t("Gift history")}</h3>
        ${received.length ? received.map((gift) => `<div class="note"><span class="tm">${hmAt(gift.ts, office.tz_min)}</span><span>${gift.from === emp.id ? "→ " + esc(S.data.employees[gift.to].name) : "← " + esc(S.data.employees[gift.from].name)} · ${money(office.country, gift.amount)} · “${esc(gift.message)}”</span></div>`).join("") : `<div class="empty">${t("No gifts yet")}</div>`}
      </div>
    </div>
  </div>
  <div style="margin-top:16px">${empRewardsSection()}</div>`;
}

const ALLERGENS = ["dairy", "nuts", "soy", "gluten", "eggs", "fish"];
const MILKS = ["fresh", "oat", "soy", "almond"];

function empProfile() {
  const emp = me();
  const p = emp.profile;
  const office = officeOf(emp);
  const subs = p.subs || {};
  const sameCountryCafes = Object.values(S.data.cafes).filter((cafe) => cafe.country === office.country);
  const usual = p.usual ? `${esc(cafeName(p.usual.cafe))}: ${esc(describeSpec(S.data.cafes[p.usual.cafe], Object.assign({ size: "R", temp: "hot" }, p.usual.spec)))}` : t("not set");
  return `<div class="stack">
  <div class="card row between account-card">
    <div class="row" style="gap:12px"><div class="avatar" style="background:${teamColor(emp.team)}">${esc(initials(emp.name))}</div>
      <div><b>${esc(emp.name)}</b><div class="small muted">${esc(emp.team)} · ${esc(office.name)} · ${esc(emp.email)}</div></div></div>
    <div class="row" style="gap:8px"><button class="btn small" data-act="badge">${ic("qr")} ${t("Show badge")}</button><button class="btn small" data-act="signout">${ic("logout")} ${t("Sign out")}</button></div>
  </div>
  ${walletCard(emp)}
  <div class="grid g2">
    <div class="card stack">
      <h3>{{i:shield}} ${t("Allergies & diet")}</h3>
      <div class="small muted">${t("Printed on every cup label. The café confirms before making it.")}</div>
      <div class="row">${ALLERGENS.map((a) => `<label class="check"><input type="checkbox" data-act-change="allergy" data-v="${a}" ${(p.allergies || []).includes(a) ? "checked" : ""}> ${t(a)}</label>`).join("")}</div>
      <label class="check"><input type="checkbox" data-act-change="pflag" data-field="halal_only" ${p.halal_only ? "checked" : ""}> {{i:shield}} ${t("Halal-certified items only")}</label>
      <label class="check"><input type="checkbox" data-act-change="pflag" data-field="fasting" ${p.fasting ? "checked" : ""}> {{i:moon}} ${t("I'm fasting during Ramadan (skip my morning orders)")}</label>
      <h3>{{i:coffee}} ${t("Taste defaults")}</h3>
      <div class="row">${t("Sugar")}: ${[0, 25, 50, 75, 100].map((v) => `<button class="btn small ${Number(p.sugar) === v ? "sel" : ""}" data-act="pset" data-field="sugar" data-v="${v}">${v}%</button>`).join("")}</div>
      <div class="row">${t("Ice")}: ${["less", "normal", "extra"].map((v) => `<button class="btn small ${p.ice === v ? "sel" : ""}" data-act="pset" data-field="ice" data-v="${v}">${t(v)}</button>`).join("")}</div>
      <div class="row">${t("Milk")}: ${[null, ...MILKS].map((v) => `<button class="btn small ${p.milk_pref === v ? "sel" : ""}" data-act="pset" data-field="milk_pref" data-v="${v || ""}">${v ? t(v) : t("café default")}</button>`).join("")}</div>
      <label class="check"><input type="checkbox" data-act-change="pflag" data-field="reusable" ${p.reusable ? "checked" : ""}> {{i:leaf}} ${t("I bring my own cup / tumbler by default")}</label>
      <div class="small">{{i:star}} ${t("My usual")}: ${usual}</div>
    </div>
    <div class="stack">
      <div class="card stack">
        <h3>{{i:refresh}} ${t("If something runs out…")}</h3>
        <div class="small muted">${t("We swap automatically, never to anything unsafe for you, and never charge more.")}</div>
        <table><tr><th>${t("If out of")}</th><th>${t("1st choice")}</th><th>${t("2nd choice")}</th></tr>
        ${MILKS.map((milk) => {
          const list = subs[milk] || [];
          const options = (current) => [`<option value="">—</option>`].concat(MILKS.filter((m) => m !== milk).map((m) => `<option value="${m}" ${current === m ? "selected" : ""}>${t(m)}</option>`)).join("");
          return `<tr><td>${t(milk)}</td><td><select data-act-change="sub" data-milk="${milk}" data-i="0">${options(list[0])}</select></td><td><select data-act-change="sub" data-milk="${milk}" data-i="1">${options(list[1])}</select></td></tr>`;
        }).join("")}</table>
        <div class="row">${t("If nothing matches")}: ${["refund", "ask"].map((v) => `<button class="btn small ${p.fallback === v ? "sel" : ""}" data-act="pset" data-field="fallback" data-v="${v}">${t(v === "refund" ? "refund me" : "ask me before cutoff")}</button>`).join("")}</div>
      </div>
      <div class="card stack">
        <h3>{{i:calendar}} ${t("Office days")}</h3>
        <div class="row">${[0, 1, 2, 3, 4].map((day) => `<label class="check"><input type="checkbox" data-act-change="officeday" data-v="${day}" ${emp.office_days.includes(day) ? "checked" : ""}> ${(S.lang === "id" ? WEEKDAYS_ID : WEEKDAYS)[day + 1]}</label>`).join("")}</div>
        <div class="small muted">${t("Repeat orders skip your work-from-home days.")}</div>
      </div>
      <div class="card stack">
        <h3>{{i:pin}} ${t("Where are you? (demo)")}</h3>
        <div class="small muted">${t("If you're already at a café, we warn you before ordering twice.")}</div>
        <select data-change="atcafe"><option value="">${t("Not at a café")}</option>${sameCountryCafes.map((cafe) => `<option value="${cafe.id}" ${emp.at_cafe === cafe.id ? "selected" : ""}>${t("I'm at")} ${esc(cafe.name)}</option>`).join("")}</select>
      </div>
    </div>
  </div>
  </div>`;
}

/* ------------------------------------------------------------------ café views */

function cafeRuns(cafeId) {
  return Object.values(S.data.runs).filter((run) => run.cafe === cafeId);
}

function batchList(run) {
  const view = S.derived.runs[run.id];
  if (!view) {
    return "";
  }
  return `<ul class="batch">${view.batch.map((group) => `<li><b>${group.count}×</b> ${esc(group.desc)} ${group.allergy ? '<span class="chip bad">{{i:alert}}</span>' : ""}<div class="small muted mono">${group.codes.join(" ")}</div></li>`).join("")}</ul>`;
}

function ticket(run, cafe) {
  const view = S.derived.runs[run.id] || {};
  const tz = cafe.tz_min;
  const lines = activeLines(run);
  const allergyLines = lines.filter((line) => line.owner_allergies.length);
  const buttons = [];
  const notes = [];
  if (run.status === "open") {
    notes.push(`${t("still collecting · cutoff")} ${hmAt(run.cutoff, tz)}`);
  }
  if (["queued", "needs_ack"].includes(run.status)) {
    notes.push(`{{i:flame}} ${t("fire at")} <b>${view.fire_due_hm}</b> · ${t("prep")} ${view.prep_min} ${t("min")}`);
    if (run.departed_at != null) {
      notes.push(`{{i:walk}} ${t("runner arrives")} ${view.arrival_hm}`);
    }
    if (run.needs_ack) {
      buttons.push(`<button class="btn small bad" data-act="cafe" data-op="cafe.ack" data-run="${run.id}">{{i:check}} ${t("Confirm allergy handling")}</button>`);
    } else {
      buttons.push(`<button class="btn small" data-act="cafe" data-op="cafe.fire" data-run="${run.id}">${t("Fire now")}</button>`);
    }
  }
  if (run.status === "making") {
    notes.push(`${t("ready at")} ${hmAt(run.fired_at + run.prep_min * 60, tz)}`);
    buttons.push(`<button class="btn small good" data-act="cafe" data-op="cafe.ready" data-run="${run.id}">${t("Mark ready")}</button>`);
  }
  if (["ready", "at_lobby", "courier"].includes(run.status)) {
    const base = run.status === "at_lobby" ? run.lobby_at : run.ready_at;
    const waited = Math.round((S.now - base) / 60);
    notes.push(`{{i:timer}} ${t("waiting {n} min", { n: waited })}`);
    if (run.badge_verified) {
      notes.push(`{{i:idcard}} ${t("badge verified")}: ${esc(S.data.employees[run.badge_verified].name)}`);
    }
    if (run.status !== "courier") {
      const allowed = view.release_allowed_at && S.now >= view.release_allowed_at;
      buttons.push(`<button class="btn small" ${allowed ? "" : "disabled"} data-act="cafe" data-op="cafe.release" data-run="${run.id}">${t("Release unclaimed")}${allowed ? "" : " (" + Math.max(0, Math.ceil((view.release_allowed_at - S.now) / 60)) + "m)"}</button>`);
    }
  }
  if (["picked", "done"].includes(run.status) && run.freshness_min != null) {
    notes.push(`{{i:coffee}} ${t("collected {n} min after ready", { n: run.freshness_min })}`);
  }
  return `<div class="ticket ${run.priority ? "priority" : ""} ${allergyLines.length ? "allergy" : ""}">
    <div class="row between"><span class="code">${esc(run.code)}</span><span class="chip">${hmAt(run.slot, tz)}</span></div>
    <div class="small muted">${esc(run.kind === "remake" ? t("PRIORITY remake") : run.title)} · ${lines.length} ${t("cups")} · ${run.mode === "delivery" ? "{{i:truck}} " + esc(run.courier || t("courier")) : "{{i:walk}} " + t("pickup")}</div>
    ${batchList(run)}
    ${allergyLines.length ? `<div class="small" style="color:var(--bad)">{{i:alert}} ${allergyLines.map((line) => esc(line.code + ": " + line.owner_allergies.join("/"))).join(" · ")}</div>` : ""}
    <div class="small">${notes.join("<br>")}</div>
    <div class="row" style="margin-top:6px">${buttons.join("")}</div>
  </div>`;
}

function cafeBoard() {
  const cafe = S.data.cafes[persona().id];
  const runs = cafeRuns(cafe.id);
  const cols = [
    ["Incoming (collecting)", runs.filter((run) => run.status === "open")],
    ["Scheduled — fire on approach", runs.filter((run) => ["queued", "needs_ack"].includes(run.status))],
    ["Making", runs.filter((run) => run.status === "making")],
    ["Ready / waiting", runs.filter((run) => ["ready", "courier", "at_lobby"].includes(run.status))],
    ["Done", runs.filter((run) => ["picked", "done", "released"].includes(run.status)).slice(-6)],
  ];
  const info = S.derived.cafes[cafe.id];
  const current = info.slots.find((row) => row.slot <= S.now && S.now < row.slot + 600) || info.slots[0];
  return `<div class="stack">
    <div class="row between">
      <div><h2>{{i:coffee}} ${esc(cafe.name)}</h2><div class="muted small">${esc(cafe.area)} · ${t("orders injected into")} ${esc(cafe.pos)} (${t("simulated")}) · ${t("quality")} ${(info.quality_score * 100).toFixed(1)}%</div></div>
      <div class="card flat row">
        {{i:idcard}} <input type="text" class="mono" style="width:120px" data-draft="badge" value="${esc(d("badge", "NDG-1001"))}" placeholder="NDG-1001">
        <button class="btn small primary" data-act="badgetap">${t("Badge tap")}</button>
        ${S.badgeResult ? `<span class="small ${S.badgeResult.ok ? "" : "muted"}">${esc(msg(S.badgeResult))} ${S.badgeResult.runs ? S.badgeResult.runs.map((r) => r.code + " (" + t(STEP_LABEL[r.status] || r.status) + ")").join(", ") : ""}</span>` : ""}
      </div>
      ${cafeVoucherBox()}
    </div>
    <div class="row small">${t("Current slot")}: <b>${current ? current.hm : "—"}</b> · ${current ? current.load + "/" + current.capacity : ""} ${t("cups")} · ${t("capacity is enforced across all companies, so back-to-back orders can't flood the bar.")}</div>
    <div class="board">${cols.map(([title, list]) => `<div class="col"><h3>${t(title)} <span class="chip">${list.length}</span></h3>${list.map((run) => ticket(run, cafe)).join("") || `<div class="small muted">—</div>`}</div>`).join("")}</div>
    <div class="card"><h3>{{i:bell}} ${t("Café notifications")}</h3>${notesList("cafe:" + cafe.id, cafe.tz_min, 10)}</div>
  </div>`;
}

function cafeLabels() {
  const cafe = S.data.cafes[persona().id];
  const runs = cafeRuns(cafe.id).filter((run) => ["queued", "needs_ack", "making", "ready"].includes(run.status));
  const labels = [];
  for (const run of runs) {
    for (const line of activeLines(run)) {
      const emp = S.data.employees[line.who];
      const where = run.mode === "delivery" ? run.deliver_to : emp ? emp.floor + " · " + emp.desk : t("guest");
      labels.push(`<div class="label"><div class="strip" style="background:${teamColor(personTeam(line.who))}"></div>
        <div style="padding-left:8px">
          <div class="row between"><span class="lc">${esc(line.code)}</span><span class="chip mono">${esc(run.code)}</span></div>
          <div><b>${esc(line.name)}</b> · ${esc(personTeam(line.who))}</div>
          <div class="small">${esc(describeSpec(cafe, line.spec))}</div>
          <div class="small muted">{{i:pin}} ${esc(where || "")} · ${hmAt(run.slot, cafe.tz_min)}</div>
          ${line.owner_allergies.length ? `<div class="warn small">{{i:alert}} ${t("ALLERGY")}: ${esc(line.owner_allergies.join(", ").toUpperCase())}</div>` : ""}
          <div class="small">${line.halal ? "{{i:shield}} " + t("halal") : ""} ${line.spec.reusable ? "{{i:leaf}} " + t("own cup") : ""}</div>
        </div></div>`);
    }
  }
  return `<div class="stack"><div class="row between"><h2>{{i:tag}} ${t("Cup labels")}</h2><button class="btn" onclick="window.print()">{{i:printer}} ${t("Print")}</button></div>
    <div class="small muted">${t("Unique code + name + team color + where it goes. The runner scans each label at pickup.")}</div>
    <div class="labels">${labels.join("") || `<div class="empty">${t("No labels to print")}</div>`}</div></div>`;
}

function cafeSlots() {
  const cafe = S.data.cafes[persona().id];
  const info = S.derived.cafes[cafe.id];
  return `<div class="grid g2">
    <div class="card stack">
      <h3>${t("Capacity & off-peak incentive")}</h3>
      <div class="row">
        <label class="field">${t("Cups per 10-min slot")}<input type="number" min="1" style="width:100px" data-draft="cap" value="${esc(d("cap", cafe.capacity_per_slot))}"></label>
        <label class="field">${t("Off-peak discount %")}<input type="number" min="0" max="50" style="width:100px" data-draft="offpeak" value="${esc(d("offpeak", cafe.offpeak_discount_pct))}"></label>
        <button class="btn primary" data-act="cafesettings">${t("Save")}</button>
      </div>
      <div class="small muted">${t("Peak windows")}: ${cafe.peak.map((p) => p.join("–")).join(", ")}. ${t("Slots outside peak get the discount automatically, nudging offices to 8:40 instead of 9:00.")}</div>
      <table><tr><th>${t("Slot")}</th><th>${t("Load")}</th><th></th><th>${t("Incentive")}</th></tr>
      ${info.slots.map((row) => { const pct = Math.round((row.load / row.capacity) * 100); return `<tr><td>${row.hm}${row.peak ? ` <span class="chip warn">${t("peak")}</span>` : ""}</td><td>${row.load}/${row.capacity}</td><td style="width:40%"><div class="bar ${pct >= 100 ? "bad" : pct > 70 ? "warn" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div></td><td>${row.discount_pct ? `<span class="chip ok">-${row.discount_pct}%</span>` : ""}</td></tr>`; }).join("")}
      </table>
    </div>
    <div class="card stack">
      <h3>${t("Live stock (synced from POS)")}</h3>
      <div class="small muted">${t("Turn something off and every open order is fixed instantly using each customer's own substitution rule — or refunded.")}</div>
      <h4>${t("Milk")}</h4>
      ${Object.keys(cafe.milk_prices).map((milk) => stockRow(cafe, "milk:" + milk, t(milk) + " " + t("milk"))).join("")}
      <h4>${t("Menu")}</h4>
      ${Object.values(cafe.menu).map((item) => stockRow(cafe, "item:" + item.id, itemName(cafe, item.id))).join("")}
    </div>
  </div>`;
}

function stockRow(cafe, key, label) {
  const on = cafe.stock[key] !== false;
  return `<div class="row between" style="padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(label)}</span>
    <button class="btn small ${on ? "good" : "bad"}" data-act="stock" data-key="${key}" data-v="${on ? 0 : 1}">${on ? t("In stock") : t("Sold out")}</button></div>`;
}

function cafeInsights() {
  const cafe = S.data.cafes[persona().id];
  const info = S.derived.cafes[cafe.id];
  const forecast = info.forecast;
  const max = Math.max(1, ...forecast.slots.map((row) => Math.max(row.expected, row.baseline)));
  const payouts = S.data.payouts.filter((entry) => entry.cafe === cafe.id).slice(-12).reverse();
  return `<div class="grid g2">
    <div class="card stack">
      <h3>{{i:chart}} ${t("Tomorrow's corporate demand forecast")}</h3>
      <div class="small muted">${t("Built from desk bookings ({p}/{h} people in office tomorrow), recurring runs and history.", { p: forecast.planned_in_office, h: forecast.headcount })}</div>
      <div class="chart">${forecast.slots.map((row) => `<div class="c" title="${row.hm}: ${row.expected}"><span>${row.expected}</span><i style="height:${(row.expected / max) * 100}%"></i><span>${row.hm}</span></div>`).join("")}</div>
      <div class="row"><span class="chip">${t("Expected cups")}: ${forecast.slots.reduce((sum, row) => sum + row.expected, 0)}</span><span class="chip">{{i:droplet}} ~${forecast.milk_litres} L ${t("milk")}</span><span class="chip">${t("attendance")} ${Math.round(forecast.attendance_ratio * 100)}%</span></div>
    </div>
    <div class="card stack">
      <h3>{{i:banknote}} ${t("Instant payouts")}</h3>
      <div class="grid g3">
        <div><div class="kpi-label">${t("Gross")}</div><div class="kpi">${money(cafe.country, info.gross_total)}</div></div>
        <div><div class="kpi-label">${t("Commission")} ${S.data.config.commission_pct}%</div><div class="kpi">${money(cafe.country, info.commission_total)}</div></div>
        <div><div class="kpi-label">${t("Paid to")} ${esc(cafe.bank)}</div><div class="kpi">${money(cafe.country, info.payout_total)}</div></div>
      </div>
      <div class="small muted">${t("Paid right after each order closes. CrewCup invoices the company monthly and carries the net-30 wait — not the café.")}</div>
      <table><tr><th>${t("Time")}</th><th>${t("Ref")}</th><th class="right">${t("Gross")}</th><th class="right">${t("Net")}</th><th>${t("Status")}</th></tr>
      ${payouts.map((entry) => `<tr><td>${hmAt(entry.ts, cafe.tz_min)}</td><td class="mono small">${esc((S.data.runs[entry.run] || {}).code || entry.run)}</td><td class="right">${money(cafe.country, entry.gross)}</td><td class="right">${money(cafe.country, entry.net)}</td><td><span class="chip ${entry.status === "reversal" ? "warn" : "ok"}">${esc(entry.status)}</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">${t("No payouts yet")}</td></tr>`}
      </table>
      <div class="row"><span class="chip">${t("Quality score")} ${(info.quality_score * 100).toFixed(1)}%</span><span class="chip">${cafe.quality.flagged} ${t("flagged")} / ${cafe.quality.lines} ${t("cups")}</span><span class="small muted">${t("visible to the café only, for coaching")}</span></div>
    </div>
  </div>`;
}

function cafeCatering() {
  const cafe = S.data.cafes[persona().id];
  const requests = Object.values(S.data.catering).filter((request) => request.cafe === cafe.id).reverse();
  return `<div class="card stack"><h3>{{i:package}} ${t("Catering & bulk requests")}</h3>
    ${requests.map((request) => `<div class="card flat">
      <div class="row between"><b>${esc(request.desc)}</b><span class="chip">${esc(t(request.status))}</span></div>
      <div class="small muted">${esc(S.data.company.name)} · ${request.headcount} pax · ${dayHm(request.when, cafe.tz_min)} · ${t("by")} ${esc(S.data.employees[request.by].name)}</div>
      ${request.status === "requested" ? `<div class="row" style="margin-top:6px"><input type="number" data-draft="quote_${request.id}" placeholder="${esc(country(cafe.country).currency)}" value="${esc(d("quote_" + request.id, ""))}"><button class="btn primary small" data-act="quote" data-req="${request.id}">${t("Send quote")}</button></div>` : request.quote != null ? `<div>${t("Quote")}: ${money(cafe.country, request.quote)}</div>` : ""}
    </div>`).join("") || `<div class="empty">${t("No catering requests. Employees can request from the Meetings or Order tab.")}</div>`}
  </div>`;
}

/* ------------------------------------------------------------------ admin views */

function adminOverview() {
  const office = S.data.offices[S.adminOffice];
  const info = S.derived.offices[office.id];
  const today = S.derived.employees[Object.keys(S.data.employees).find((id) => S.data.employees[id].office === office.id)].local_date;
  const isToday = (ts) => new Date((ts + office.tz_min * 60) * 1000).toISOString().substr(0, 10) === today;
  const receipts = S.data.receipts.filter((r) => r.office === office.id && isToday(r.ts));
  const spendToday = S.data.spend.filter((s) => s.office === office.id && isToday(s.ts)).reduce((sum, s) => sum + s.amount, 0);
  const allowanceUsed = Object.values(S.data.employees).filter((emp) => emp.office === office.id).reduce((sum, emp) => sum + (emp.allowance.date === today ? emp.allowance.used : 0), 0);
  const fairness = info.fairness;
  const esg = S.data.esg;
  return `<div class="stack">
    <div class="grid g5">
      ${kpi(t("Headcount"), info.headcount)}
      ${kpi(t("In office today"), info.in_office_today + " / " + info.headcount)}
      ${kpi(t("Cups today"), receipts.length)}
      ${kpi(t("Company spend today"), money(office.country, spendToday))}
      ${kpi(t("Allowance used"), Math.round((allowanceUsed / Math.max(1, office.allowance_daily * info.headcount)) * 100) + "%")}
    </div>
    <div class="grid g3">
      <div class="card"><h3>{{i:scale}} ${t("Runner fairness")}</h3><div class="kpi">${fairness.jain}</div><div class="small muted">${t("Jain index (1.0 = perfectly shared). Top person does {p}% of runs.", { p: Math.round(fairness.top_share * 100) })}</div></div>
      <div class="card"><h3>{{i:leaf}} ${t("Sustainability")}</h3><div class="row"><span class="chip ok">{{i:leaf}} ${esg.reusable_cups} ${t("own cups")}</span><span class="chip ok">{{i:walk}} ${esg.trips_saved} ${t("trips saved")}</span><span class="chip">${esg.cups} ${t("cups")}</span></div></div>
      <div class="card"><h3>{{i:lock}} ${t("Identity")}</h3><div class="small">${esc(S.data.company.sso)}</div><div class="small muted">${t("Joiners/leavers sync automatically. Privacy mode")}: <b>${S.data.company.policy.privacy_aggregate_only ? t("aggregate only") : t("named")}</b></div></div>
    </div>
    <div class="card"><h3>{{i:bell}} ${t("Approvals & alerts")}</h3>${notesList("admin", office.tz_min, 8)}</div>
  </div>`;
}

function kpi(label, value) {
  return `<div class="card"><div class="kpi-label">${esc(label)}</div><div class="kpi">${esc(value)}</div></div>`;
}

function adminPolicy() {
  const office = S.data.offices[S.adminOffice];
  const policy = S.data.company.policy;
  const c = country(office.country);
  const major = (amount) => (amount / Math.pow(10, c.decimals)).toString();
  return `<div class="grid g2">
    <div class="card stack">
      <h3>${t("Company policy")}</h3>
      <label class="check"><input type="checkbox" data-act-change="policy" data-field="allowance_office_days_only" ${policy.allowance_office_days_only ? "checked" : ""}> ${t("Allowance only on office days (off = usable anywhere, fair to remote staff)")}</label>
      <label class="check"><input type="checkbox" data-act-change="policy" data-field="ramadan_mode" ${policy.ramadan_mode ? "checked" : ""}> {{i:moon}} ${t("Ramadan mode (skip fasting staff in morning runs & meetings, suggest buka puasa runs)")}</label>
      <label class="check"><input type="checkbox" data-act-change="policy" data-field="privacy_aggregate_only" ${policy.privacy_aggregate_only ? "checked" : ""}> {{i:lock}} ${t("Privacy: managers see aggregates only (no names in fairness stats)")}</label>
    </div>
    <div class="card stack">
      <h3>${esc(office.name)} · ${esc(c.currency)}</h3>
      <div class="grid g2">
        <label class="field">${t("Daily coffee allowance")}<input type="number" data-draft="pol_allow" value="${esc(d("pol_allow", major(office.allowance_daily)))}"></label>
        <label class="field">${t("Catering approval above")}<input type="number" data-draft="pol_cat" value="${esc(d("pol_cat", major(office.catering_threshold)))}"></label>
        ${Object.entries(office.budgets).map(([key, budget]) => `<label class="field">${t(key + " budget / month")}<input type="number" data-draft="pol_b_${key}" value="${esc(d("pol_b_" + key, major(budget.limit)))}"></label>`).join("")}
      </div>
      <button class="btn primary" data-act="officeupdate">${t("Save")}</button>
      ${Object.entries(office.budgets).map(([key, budget]) => { const pct = Math.round(((budget.spent + Object.values(budget.held).reduce((a, b) => a + b, 0)) / Math.max(1, budget.limit)) * 100); return `<div><div class="row between small"><span>${t(key + " budget / month")}</span><span>${money(office.country, budget.spent)} / ${money(office.country, budget.limit)}</span></div><div class="bar ${pct > 90 ? "bad" : pct > 70 ? "warn" : ""}"><i style="width:${Math.min(100, pct)}%"></i></div></div>`; }).join("")}
    </div>
  </div>`;
}

function adminSpend() {
  const office = S.data.offices[S.adminOffice];
  const spend = S.derived.offices[office.id].spend;
  const labels = { staff_allowance: "Staff allowance (all employees)", meeting: "Meetings & catering", gift_individual: "Individual gifts / kudos / rewards", client_gift: "Partner & client coffees" };
  const receipts = S.data.receipts.filter((r) => r.office === office.id).slice(-15).reverse();
  return `<div class="stack">
    <div class="grid g4">${Object.entries(labels).map(([key, label]) => `<div class="card"><div class="kpi-label">${t(label)}</div><div class="kpi">${money(office.country, spend.totals[key] || 0)}</div><div class="small muted">${esc(spend.notes[key] || "")}</div></div>`).join("")}</div>
    <div class="card row between"><div><b>${t("Consolidated invoice (to date)")}</b>: ${money(office.country, spend.invoice_total)} · <span class="muted small">${t("one monthly invoice, tax-coded per category, cafés already paid")}</span></div>
      <a class="btn primary" href="/api/export/expenses.csv?office=${office.id}">{{i:download}} ${t("Expense export (CSV for Concur / Xero / Jurnal)")}</a></div>
    <div class="banner warn small">{{i:scale}} ${t("Tax notes are demo assumptions for {c} and must be confirmed with a local tax advisor.", { c: country(office.country).name })}</div>
    <div class="card"><h3>{{i:receipt}} ${t("Zero-receipt log (auto e-receipts)")}</h3>
      <table><tr><th>${t("Time")}</th><th>${t("Employee")}</th><th>${t("Item")}</th><th>${t("Cost center")}</th><th class="right">${t("Net")}</th><th class="right">${t("Tax")}</th><th class="right">${t("Gross")}</th><th>${t("Paid by")}</th><th>${t("Attendees")}</th></tr>
      ${receipts.map((r) => `<tr><td>${hmAt(r.ts, office.tz_min)}</td><td>${esc(r.beneficiary_name)}</td><td>${esc(r.item)}<div class="small muted">${esc(cafeName(r.cafe))}</div></td><td>${esc(r.cost_center || "")}</td><td class="right">${money(office.country, r.net)}</td><td class="right">${money(office.country, r.tax)}<div class="small muted">${esc(r.tax_name)}</div></td><td class="right">${money(office.country, r.gross)}</td><td class="small">${r.parts.filter((p) => p.amount).map((p) => p.src).join(" + ")}</td><td class="small">${esc(r.attendees.join(", "))}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">${t("No receipts yet")}</td></tr>`}
      </table></div>
  </div>`;
}

function adminPeople() {
  const office = S.data.offices[S.adminOffice];
  const fairness = S.derived.offices[office.id].fairness;
  const people = Object.values(S.data.employees).filter((emp) => emp.office === office.id);
  const privacy = S.data.company.policy.privacy_aggregate_only;
  const sorted = people.filter((emp) => emp.active).sort((a, b) => b.runs_done - a.runs_done);
  const max = Math.max(1, ...sorted.map((emp) => emp.runs_done));
  return `<div class="grid g2">
    <div class="card stack">
      <h3>{{i:scale}} ${t("Who does the coffee runs?")}</h3>
      <div class="small muted">${t("Jain fairness index {j} · top person does {p}% of runs. Rotation suggestions and karma rebalance this over time.", { j: fairness.jain, p: Math.round(fairness.top_share * 100) })}</div>
      ${sorted.map((emp, i) => `<div><div class="row between small"><span>${privacy ? t("Person") + " " + String.fromCharCode(65 + i) : esc(emp.name)}</span><span>${emp.runs_done} ${t("runs")}</span></div><div class="bar ${emp.runs_done / max > 0.8 && i === 0 ? "warn" : ""}"><i style="width:${(emp.runs_done / max) * 100}%"></i></div></div>`).join("")}
      ${privacy ? `<div class="small muted">{{i:lock}} ${t("Names hidden by privacy policy. Individual drink choices are never shown to managers.")}</div>` : ""}
    </div>
    <div class="card stack">
      <h3>{{i:user}} ${t("People (SSO + SCIM)")}</h3>
      <table><tr><th>${t("Name")}</th><th>${t("Team")}</th><th>${t("Today")}</th><th>${t("Source")}</th><th></th></tr>
      ${people.map((emp) => `<tr style="${emp.active ? "" : "opacity:.5"}"><td>${esc(emp.name)}</td><td>${esc(emp.team)}</td><td>${S.derived.employees[emp.id].in_office_today ? "{{i:building}}" : "{{i:home}}"}</td><td><span class="chip">${esc(emp.source)}</span></td><td>${emp.active ? `<button class="btn small bad" data-act="deactivate" data-emp="${emp.id}">${t("Offboard")}</button>` : t("inactive")}</td></tr>`).join("")}
      </table>
      <div class="row"><input type="text" data-draft="scim_name" value="${esc(d("scim_name", "Nadia Kusuma"))}"><select data-draft="scim_team">${["Engineering", "Design", "Marketing", "Sales", "Finance", "Operations", "People"].map((team) => `<option ${d("scim_team", "People") === team ? "selected" : ""}>${team}</option>`).join("")}</select><button class="btn" data-act="scimadd">${t("Simulate SCIM new hire")}</button></div>
    </div>
  </div>`;
}

function adminEngage() {
  const office = S.data.offices[S.adminOffice];
  const lastRoulette = S.data.roulette.filter((entry) => entry.office === office.id).slice(-1)[0];
  const approvals = Object.values(S.data.catering).filter((request) => request.office === office.id);
  return `<div class="grid g2">
    <div class="card stack">
      <h3>{{i:shuffle}} ${t("Coffee roulette")}</h3>
      <div class="small muted">${t("Pairs random colleagues (office + remote) for a coffee chat; each gets a company-paid coffee usable at any partner café.")}</div>
      <button class="btn primary" data-act="roulette">${t("Run this week's roulette")}</button>
      ${lastRoulette ? `<div>${lastRoulette.groups.map((group) => `<div class="chip" style="margin:3px">${group.map((id) => esc(S.data.employees[id].name)).join(" {{i:coffee}} ")}</div>`).join("")}</div>` : ""}
    </div>
    <div class="card stack">
      <h3>{{i:package}} ${t("Catering approvals")}</h3>
      ${approvals.map((request) => `<div class="row between"><span>${esc(request.desc)} · ${request.headcount} pax · ${esc(cafeName(request.cafe))}${request.quote != null ? " · " + money(office.country, request.quote) : ""}</span><span>${request.status === "pending_approval" ? `<button class="btn small good" data-act="approve" data-req="${request.id}" data-v="1">${t("Approve")}</button> <button class="btn small bad" data-act="approve" data-req="${request.id}" data-v="0">${t("Decline")}</button>` : `<span class="chip">${esc(t(request.status))}</span>`}</span></div>`).join("") || `<div class="empty">${t("Nothing to approve")}</div>`}
      <h4>${t("New catering request")}</h4>
      <div class="row">
        <select data-draft="cat_cafe">${Object.values(S.data.cafes).filter((cafe) => cafe.walk_min[office.id] != null).map((cafe) => `<option value="${cafe.id}">${esc(cafe.name)}</option>`).join("")}</select>
        <input type="text" data-draft="cat_desc" value="${esc(d("cat_desc", "Kopi literan 1L ×10 + snack box"))}">
        <input type="number" style="width:80px" data-draft="cat_pax" value="${esc(d("cat_pax", 40))}">
        <button class="btn" data-act="catering">${t("Request quote")}</button>
      </div>
    </div>
  </div>`;
}

function adminAudit() {
  if (S.auditRows === null) {
    setTimeout(A.loadaudit, 0);
  }
  const rows = S.auditRows || [];
  const office = S.data.offices[S.adminOffice];
  return `<div class="card stack">
    <div class="row between"><h3>{{i:search}} ${t("Audit log")}</h3><button class="btn small" data-act="loadaudit">{{i:refresh}} ${t("Refresh")}</button></div>
    <div class="small muted">${t("Every sign-in, action, permission denial and payment webhook is recorded (append-only, SQLite). Secrets are redacted.")}</div>
    <table><tr><th>${t("Time")}</th><th>${t("Who")}</th><th>${t("Action")}</th><th>${t("Target")}</th><th>${t("Result")}</th></tr>
    ${rows.map((row) => `<tr><td class="nowrap">${row.sim_ts ? hmAt(row.sim_ts, office.tz_min) : ""}<div class="small muted">${new Date(row.real_ts * 1000).toLocaleTimeString()}</div></td>
      <td class="small">${esc(row.actor || "—")}</td><td class="mono small">${esc(row.action)}</td><td class="mono small">${esc(row.target || "")}</td>
      <td>${row.ok ? '<span class="chip ok">ok</span>' : `<span class="chip bad">${esc(row.code || "fail")}</span>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">${t("Loading…")}</td></tr>`}
    </table></div>`;
}

function adminMarkets() {
  return `<div class="card stack">
    <h3>{{i:globe}} ${t("Southeast Asia market configuration")}</h3>
    <div class="banner warn small">${t("Rates and methods are demo assumptions from public sources — verify with local tax advisors and payment partners before launch.")}</div>
    <table><tr><th>${t("Country")}</th><th>${t("Currency")}</th><th>${t("F&B tax")}</th><th>${t("Payments")}</th><th>${t("Gateways")}</th><th>${t("Couriers")}</th><th>${t("Team chat")}</th></tr>
    ${Object.entries(S.data.countries).map(([code, c]) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.currency)}</td><td>${esc(c.tax.name)} ${Math.round(c.tax.rate * 100)}% ${c.tax.inclusive ? t("incl.") : t("added")}<div class="small muted">${esc(c.tax.note)}</div></td><td class="small">${esc(c.payments.join(", "))}</td><td class="small">${esc(c.gateways.join(", "))}</td><td class="small">${esc(c.couriers.join(", "))}</td><td class="small">${esc(c.chat_apps.join(", "))}</td></tr>`).join("")}
    </table>
    <h4>${t("Why the wallet model")}</h4>
    <div class="small">${t("Most SEA payments (QRIS, PayNow, PromptPay, GCash…) are push payments with no card-style pre-authorisation. CrewCup uses a prepaid wallet topped up by QRIS/e-wallet, so a hold can be placed when someone joins a run and captured at cutoff.")}</div>
  </div>`;
}

/* ------------------------------------------------------------------ guest view */

function guestView() {
  const code = (S.drafts.guestCode || "").toUpperCase();
  const run = Object.values(S.data.runs).find((r) => r.code === code);
  const openRuns = Object.values(S.data.runs).filter((r) => r.kind === "group" && r.status === "open");
  if (!run) {
    return `<div class="card stack" style="max-width:560px;margin:auto">
      <h2>{{i:link}} ${t("Join a coffee run as a guest")}</h2>
      <div class="small muted">${t("Visitors and contractors can join from a shared link — no app, no account.")}</div>
      <div class="row"><input type="text" class="mono" data-draft="guestCode" value="${esc(code)}" placeholder="CODE"><button class="btn primary" data-act="noop">${t("Open")}</button></div>
      ${openRuns.map((r) => `<button class="btn small" data-act="guestcode" data-code="${r.code}">${esc(r.code)} · ${esc(r.title)}</button>`).join(" ")}
    </div>`;
  }
  const cafe = S.data.cafes[run.cafe];
  const c = country(cafe.country);
  const item = d("g_item", Object.keys(cafe.menu)[0]);
  const covered = run.pay_mode !== "each";
  const method = d("g_method", c.payments[0]);
  const menuItem = cafe.menu[item];
  return `<div class="card stack" style="max-width:620px;margin:auto">
    <h2>{{i:coffee}} ${esc(run.title)}</h2>
    <div class="muted">${esc(cafe.name)} · ${t("pickup")} ${hmAt(run.slot, cafe.tz_min)} · ${t("join before")} ${hmAt(run.cutoff, cafe.tz_min)} · ${t("host")}: ${esc(S.data.employees[run.host].name)}</div>
    ${run.status !== "open" ? `<div class="banner warn">${t("This run is closed.")}</div>` : `
    <label class="field">${t("Your name")}<input type="text" data-draft="g_name" value="${esc(d("g_name", ""))}" placeholder="Pak Joko"></label>
    <label class="field">${t("Drink")}<select data-draft="g_item" data-change="rerender">${Object.values(cafe.menu).map((m) => `<option value="${m.id}" ${m.id === item ? "selected" : ""}>${esc(itemName(cafe, m.id))} — ${money(cafe.country, m.price)}${m.halal ? "" : " (" + t("not halal-certified") + ")"}</option>`).join("")}</select></label>
    ${menuItem && menuItem.temps.length > 1 ? `<div class="row">${menuItem.temps.map((temp) => `<button class="btn small ${d("g_temp", menuItem.temps[0]) === temp ? "sel" : ""}" data-act="gset" data-k="g_temp" data-v="${temp}">${t(temp)}</button>`).join("")}</div>` : ""}
    ${menuItem && menuItem.sugar ? `<div class="row">${t("Sugar")}: ${[0, 50, 100].map((v) => `<button class="btn small ${Number(d("g_sugar", 100)) === v ? "sel" : ""}" data-act="gset" data-k="g_sugar" data-v="${v}">${v}%</button>`).join("")}</div>` : ""}
    ${covered ? `<div class="banner ok">{{i:check-circle}} ${t("Your drink is covered by the host.")}</div>` : `
      <label class="field">${t("Pay with")}<select data-draft="g_method" data-change="rerender">${c.payments.map((p) => `<option ${p === method ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      <div class="row">${qrImg("", 132, emvQuery(cafe, menuItem ? menuItem.price : 0, "GUEST-" + run.code))}<div class="small muted">${esc(method)} · ${esc(c.gateways[0])} (${t("test QR — EMVCo/QRIS format, not payable")})<br>${t("Scan with any banking or e-wallet app. Paid instantly; refunded automatically if the drink can't be made.")}</div></div>`}
    <button class="btn primary" data-act="guestjoin" data-run="${run.id}">${covered ? t("Join") : t("Pay & join")}</button>`}
    <div class="small muted">${peopleIn(run).length} ${t("people already in")}</div>
  </div>`;
}

/* ------------------------------------------------------------------ sign in */

function signIn() {
  if (!S.data) {
    return "";
  }
  const step = S.drafts.signin_step || "start";
  const langButton = `<button class="btn small" data-act="lang">${S.lang === "id" ? "English" : "Bahasa Indonesia"}</button>`;
  let content = "";
  if (step === "accounts") {
    const provider = S.drafts.signin_provider || "Google";
    const groups = Object.values(S.data.offices).map((office) => {
      const people = Object.values(S.data.employees).filter((emp) => emp.office === office.id && emp.active);
      return `<h4>${esc(office.name)} · ${esc(country(office.country).name)}</h4>` + people.map((emp) => `
        <button class="account" data-act="signin" data-persona="emp:${emp.id}">
          <span class="avatar-sm" style="background:${teamColor(emp.team)}">${esc(initials(emp.name))}</span>
          <span><b>${esc(emp.name)}</b><br><span class="small muted">${esc(emp.email)} · ${esc(emp.team)}</span></span>
        </button>`).join("");
    }).join("");
    content = `
      <div class="row between"><button class="btn small" data-act="signinstep" data-step="start">← ${esc(t("Back"))}</button><span class="chip">${esc(provider)} SSO · ${esc(t("simulated"))}</span></div>
      <h2>${esc(t("Choose an account"))}</h2>
      <div class="small muted">${esc(t("to continue to CrewCup · {company}", { company: S.data.company.name }))}</div>
      <div class="accounts">${groups}</div>`;
  } else if (step === "partner") {
    content = `
      <div class="row between"><button class="btn small" data-act="signinstep" data-step="start">← ${esc(t("Back"))}</button></div>
      <h2>{{i:coffee}} ${esc(t("Café partner sign-in"))}</h2>
      <div class="accounts">${Object.values(S.data.cafes).map((cafe) => `<button class="account" data-act="signin" data-persona="cafe:${cafe.id}"><span class="avatar-sm" style="background:#7a4a2a">{{i:coffee}}</span><span><b>${esc(cafe.name)}</b><br><span class="small muted">${esc(cafe.area)} · ${esc(cafe.pos)}</span></span></button>`).join("")}</div>`;
  } else {
    const emailError = S.drafts.signin_error ? `<div class="small" style="color:var(--bad)">${esc(S.drafts.signin_error)}</div>` : "";
    content = `
      <h1>${esc(t("Coffee for the whole office, in one tap."))}</h1>
      <p class="muted">${esc(t("Order solo or as a team, paid by your company allowance, ready exactly when you arrive."))}</p>
      <button class="sso" data-act="signinstep" data-step="accounts" data-provider="Google Workspace">${ic("key")} ${esc(t("Continue with Google Workspace"))}</button>
      <button class="sso" data-act="signinstep" data-step="accounts" data-provider="Microsoft Entra ID">${ic("building")} ${esc(t("Continue with Microsoft"))}</button>
      <div class="or"><span>${esc(t("or"))}</span></div>
      <div class="row"><input type="email" style="flex:1" data-draft="signin_email" value="${esc(d("signin_email", ""))}" placeholder="andi@nusantara.co.id"><button class="btn primary" data-act="emailsignin">${esc(t("Continue"))}</button></div>
      ${emailError}
      <div class="row signin-links">
        <button class="btn small" data-act="signinstep" data-step="partner">{{i:coffee}} ${esc(t("I'm a café partner"))}</button>
        <button class="btn small" data-act="signin" data-persona="admin:co">{{i:building}} ${esc(t("Company admin"))}</button>
        <button class="btn small" data-act="signin" data-persona="guest:">{{i:link}} ${esc(t("Join with a code"))}</button>
      </div>`;
  }
  return `<div class="signin-wrap">
    <div class="signin-card">
      <div class="row between"><div class="brand-lg">${logoMark(40)}<span>CrewCup</span></div>${langButton}</div>
      ${content}
      <div class="small muted signin-foot">${esc(t("Demo build · sign-in, payments and café systems are simulated."))}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ modal */

function modal() {
  if (!S.modal) {
    return "";
  }
  if (S.modal.type.startsWith("net_")) {
    return networkModal();
  }
  if (S.modal.type === "badge") {
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3 style="margin:0">${t("Company badge")}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      ${badgeCard(me())}
    </div></div>`;
  }
  if (S.modal.type === "notes") {
    const emp = me();
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3 style="margin:0">{{i:bell}} ${t("Notifications")}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      ${notesList(emp.id, officeOf(emp).tz_min, 30)}
    </div></div>`;
  }
  if (S.modal.type === "topup") {
    const emp = me();
    const office = officeOf(emp);
    const c = country(office.country);
    const method = d("tp_method", c.payments[0]);
    const amounts = { ID: [50000, 100000, 200000], SG: [1000, 2000, 5000], MY: [2000, 5000, 10000], TH: [20000, 50000, 100000], PH: [20000, 50000, 100000], VN: [100000, 200000, 500000] }[office.country];
    const amount = Number(d("tp_amt", amounts[1]));
    const charge = S.modal.charge;
    if (charge) {
      const payment = S.data.payments ? S.data.payments[charge.id] : null;
      const status = payment ? payment.status : charge.status;
      return `<div class="modal-bg"><div class="modal stack">
        <div class="row between"><h3>${t("Pay {amount} with {method}", { amount: money(office.country, charge.amount), method: charge.method })}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
        <div class="row"><span class="chip ${status === "PAID" ? "ok" : "warn"}">${esc(t(status))}</span><span class="small muted mono">${esc(charge.reference)} · ${esc(charge.id)}</span></div>
        ${charge.qr_string ? `<div class="row">${qrImg(charge.qr_string, 180)}<div class="small muted">${t("Scan with any banking or e-wallet app.")}<br>${t("EMVCo / QRIS-format payload with CRC check. Test merchant — real apps will refuse it.")}<div class="mono" style="word-break:break-all;font-size:10px;margin-top:6px">${esc(charge.qr_string)}</div></div></div>`
          : `<div class="banner info">{{i:phone}} ${t("Approve in the {method} app", { method: charge.method })} <span class="mono small">${esc(charge.deeplink || "")}</span></div>`}
        <div class="small muted">${t("Your balance updates only when the payment provider confirms via a signed webhook — never from the app itself.")}</div>
        ${status === "PAID" ? `<button class="btn good" data-act="closemodal">{{i:check}} ${t("Done")}</button>` : `<button class="btn primary" data-act="simpaid" data-payment="${charge.id}">${t("Simulate: customer paid in their app")}</button>`}
      </div></div>`;
    }
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>${t("Top up CrewCup wallet")}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <div class="row">${amounts.map((a) => `<button class="btn ${a === amount ? "sel" : ""}" data-act="tpamt" data-v="${a}">${money(office.country, a)}</button>`).join("")}</div>
      <div class="row">${c.payments.map((p) => `<button class="btn small ${p === method ? "sel" : ""}" data-act="tpmethod" data-v="${esc(p)}">${esc(p)}</button>`).join("")}</div>
      <div class="small muted">${esc(method)} · ${t("via")} ${esc(c.gateways[0])} (${t("simulated")})</div>
      <button class="btn primary" data-act="dotopup">${t("Continue to pay")} · ${money(office.country, amount)}</button>
    </div></div>`;
  }
  if (S.modal.type === "newrun") {
    const emp = me();
    const cafe = S.data.cafes[S.order.cafe];
    const slot = S.order.slot;
    const cutoffDefault = slot - 15 * 60;
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>{{i:users}} ${t("Start a group run")}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <div class="muted">${esc(cafe.name)} · ${t("pickup slot")} ${hmAt(slot, cafe.tz_min)}</div>
      <label class="field">${t("Title")}<input type="text" data-draft="nr_title" value="${esc(d("nr_title", t("{name}'s coffee run", { name: emp.name.split(" ")[0] })))}"></label>
      <label class="field">${t("Who pays")}<select data-draft="nr_pay">${[["each", "Each pays own (held now, charged at cutoff)"], ["host", "I treat everyone"], ["rotation", "Fair rotation treat (lowest treat balance pays)"]].map(([v, l]) => `<option value="${v}" ${d("nr_pay", "each") === v ? "selected" : ""}>${t(l)}</option>`).join("")}</select></label>
      <label class="field">${t("How it gets here")}<select data-draft="nr_mode"><option value="pickup">${t("Someone picks up (runner)")}</option><option value="delivery" ${d("nr_mode", "pickup") === "delivery" ? "selected" : ""}>${t("Courier delivery")}</option></select></label>
      <label class="field">${t("Cutoff")}<select data-draft="nr_cutoff">${[25, 20, 15, 10].map((m) => { const ts = slot - m * 60; return ts > S.now ? `<option value="${ts}" ${Number(d("nr_cutoff", cutoffDefault)) === ts ? "selected" : ""}>${hmAt(ts, cafe.tz_min)} (${m} ${t("min before pickup")})</option>` : ""; }).join("")}<option value="" ${d("nr_cutoff", "") === "" ? "selected" : ""}>${t("Smart cutoff (prep + walk time)")}</option></select></label>
      <div class="small muted">${t("Your drink is added first. Share the link on WhatsApp — everyone's money is held when they join, so you never front cash.")}</div>
      <button class="btn primary" data-act="createrun">${t("Create run & add my drink")}</button>
    </div></div>`;
  }
  if (S.modal.type === "flag") {
    return `<div class="modal-bg"><div class="modal stack">
      <div class="row between"><h3>${t("Report a problem")}</h3><button class="btn small" data-act="closemodal">{{i:x}}</button></div>
      <label class="field">${t("What went wrong?")}<select data-draft="flag_reason">${["wrong drink", "too sweet", "cold", "spilled", "missing"].map((r) => `<option>${t(r)}</option>`).join("")}</select></label>
      <div class="small muted">${S.modal.remedy === "remake" ? t("The café gets a PRIORITY remake ticket, free of charge.") : t("Instant credit back to where it was paid from (allowance / wallet).")}</div>
      <button class="btn primary" data-act="doflag">${S.modal.remedy === "remake" ? t("Remake it now") : t("Credit me now")}</button>
    </div></div>`;
  }
  return "";
}

/* ------------------------------------------------------------------ actions */

const A = {};

A.tab = (ds) => {
  S.tab[persona().kind] = ds.tab;
  render();
};
A.lang = () => {
  S.lang = S.lang === "id" ? "en" : "id";
  localStorage.setItem("cc.lang", S.lang);
  render();
};
A.clock = (ds) => api("clock.advance", { minutes: Number(ds.min) });
A.reset = async () => {
  if (!confirm(t("Reset all demo data?"))) {
    return;
  }
  await ensureSession();
  await fetch("/api/reset", { method: "POST", headers: authHeaders(), body: "{}" });
  S.drafts = {};
  S.order = { cafe: null, item: null, spec: {}, slot: null, targetRun: null, mode: "pickup" };
  S.preview = null;
  S.scanLog = {};
  await refresh(true);
};
A.noop = () => render();
A.demo = () => {
  S.demoOpen = !S.demoOpen;
  render();
};
A.badge = () => {
  S.modal = { type: "badge" };
  render();
};
A.notes = () => {
  S.modal = { type: "notes" };
  S.notesSeenAt = S.now;
  localStorage.setItem("cc.notesSeen", String(S.now));
  render();
};
A.signinstep = (ds) => {
  S.drafts.signin_step = ds.step;
  S.drafts.signin_error = "";
  if (ds.provider) {
    S.drafts.signin_provider = ds.provider;
  }
  render();
};
A.signin = (ds) => {
  S.drafts.signin_step = "start";
  setPersona(ds.persona);
  if (ds.persona.startsWith("emp:")) {
    S.tab.emp = S.tab.emp || "home";
  }
  render();
};
A.emailsignin = () => {
  const email = String(d("signin_email", "")).trim().toLowerCase();
  const emp = Object.values(S.data.employees).find((item) => item.active && item.email.toLowerCase() === email);
  if (!emp) {
    S.drafts.signin_error = t("No CrewCup account for that work email. Try andi@nusantara.co.id");
    render();
    return;
  }
  toast(t("One-time code sent to {email} (demo: auto-filled)", { email }), "ok");
  A.signin({ persona: "emp:" + emp.id });
};
A.signout = () => {
  setPersona(null);
  S.drafts.signin_step = "start";
  render();
};
A.install = async () => {
  if (!S.installEvent) {
    return;
  }
  S.installEvent.prompt();
  await S.installEvent.userChoice;
  S.installEvent = null;
  render();
};
A.alerts = async () => {
  if (!("Notification" in window)) {
    return;
  }
  const result = await Notification.requestPermission();
  toast(result === "granted" ? t("Alerts on — we'll tell you when your coffee is ready") : t("Alerts are off"), result === "granted" ? "ok" : "");
  render();
};
A.reorder = async (ds) => {
  const result = await api("solo.reorder", { emp: me().id, which: ds.which }, { silent: true });
  if (!result.ok) {
    if (result.error.code === "AT_CAFE") {
      if (confirm(msg(result.error))) {
        await api("solo.reorder", { emp: me().id, which: ds.which, confirm_duplicate: true }, { success: t("Ordered!") });
      }
      return;
    }
    toast(msg(result.error), "error");
    return;
  }
  const cafeTz = officeOf(me()).tz_min;
  toast(t("Ordered! Cup {code}, ready {time}", { code: result.result.code, time: hmAt(result.result.slot, cafeTz) }), "ok");
  S.drafts.openRun = result.result.run;
};
A.topup = () => {
  S.modal = { type: "topup" };
  render();
};
A.closemodal = () => {
  S.modal = null;
  render();
};
A.tpamt = (ds) => {
  S.drafts.tp_amt = ds.v;
  render();
};
A.tpmethod = (ds) => {
  S.drafts.tp_method = ds.v;
  render();
};
A.dotopup = async () => {
  const emp = me();
  const c = country(officeOf(emp).country);
  const amounts = { ID: 100000, SG: 2000, MY: 5000, TH: 50000, PH: 50000, VN: 200000 };
  const amount = Number(d("tp_amt", amounts[officeOf(emp).country]));
  const method = d("tp_method", c.payments[0]);
  const result = await api("payment.create_topup", { emp: emp.id, amount, method });
  if (result.ok) {
    S.modal = { type: "topup", charge: result.result };
    render();
  }
};
A.simpaid = async (ds) => {
  const result = await api("payment.simulate_paid", { payment: ds.payment }, { success: t("Payment confirmed by provider webhook — wallet credited") });
  if (result.ok) {
    schedulePreview();
    render();
  }
};
A.loadaudit = async () => {
  await ensureSession();
  const response = await fetch("/api/audit?limit=150", { headers: authHeaders() });
  const payload = await response.json();
  S.auditRows = payload.ok ? payload.rows : [];
  if (!payload.ok) {
    toast(msg(payload.error), "error");
  }
  render();
};
A.inoffice = (ds) => api("office.today", { emp: me().id, in_office: ds.v === "1" });
A.iftar = async () => {
  const emp = me();
  const office = officeOf(emp);
  const slot = S.derived.offices[office.id].iftar_slot;
  const cafe = S.derived.employees[emp.id].recommendations.cafes[0];
  if (!cafe) {
    return;
  }
  S.order.cafe = cafe.cafe;
  S.order.slot = slot;
  S.drafts.nr_title = t("Buka puasa run");
  S.tab.emp = "order";
  render();
};
A.pickcafe = (ds) => {
  if (S.order.cafe !== ds.cafe) {
    S.order.cafe = ds.cafe;
    S.order.item = null;
    S.order.spec = {};
    S.order.slot = null;
    S.order.targetRun = null;
    S.preview = null;
    S.orderError = null;
  }
  S.tab.emp = "order";
  render();
};
A.pickitem = (ds) => {
  S.order.item = ds.item;
  S.order.spec = {};
  S.orderError = null;
  S.preview = null;
  render();
  schedulePreview();
};
A.spec = (ds) => {
  const value = ds.field === "sugar" ? Number(ds.value) : ds.value;
  if (S.preview && S.preview.ok) {
    S.order.spec = Object.assign({}, S.preview.spec);
  }
  S.order.spec[ds.field] = value;
  S.orderError = null;
  schedulePreview();
};
A.pickslot = (ds) => {
  S.order.slot = Number(ds.slot);
  S.orderError = null;
  render();
  schedulePreview();
};
A.cleartarget = () => {
  S.order.targetRun = null;
  render();
};
A.nl = async () => {
  const emp = me();
  const text = d("nl", "");
  if (!text.trim()) {
    return;
  }
  const payload = await postAction("nl.parse", { emp: emp.id, cafe: S.order.cafe, text });
  if (!payload.ok) {
    toast(msg(payload.error), "error");
    return;
  }
  S.nlResult = payload.result;
  S.order.item = payload.result.spec.item;
  S.order.spec = Object.assign({}, payload.result.spec);
  render();
  schedulePreview();
};
A.solo = async (ds) => {
  const emp = me();
  const spec = Object.assign({}, S.preview && S.preview.ok ? S.preview.spec : S.order.spec, { item: S.order.item });
  const office = officeOf(emp);
  const result = await api("solo.order", {
    emp: emp.id,
    cafe: S.order.cafe,
    spec,
    slot: S.order.slot,
    mode: ds.mode,
    confirm_duplicate: ds.confirm === "1",
    deliver_to: ds.mode === "delivery" ? (office.courier_upstairs ? emp.floor + " — desk " + emp.desk : office.lobby_point) : null,
    coupon: S.preview && S.preview.ok && !S.preview.coupon_error ? d("order_coupon", "") || null : null,
  }, { silent: true, success: t("Order placed — cup code is in your notifications") });
  if (!result.ok) {
    S.orderError = result.error;
    render();
    return;
  }
  S.orderError = null;
  S.order.item = null;
  S.preview = null;
  S.drafts.order_coupon = "";
  S.drafts.openRun = result.result;
  S.tab.emp = "runs";
  render();
};
A.newrun = () => {
  S.modal = { type: "newrun" };
  render();
};
A.createrun = async () => {
  const emp = me();
  const spec = Object.assign({}, S.preview && S.preview.ok ? S.preview.spec : S.order.spec, { item: S.order.item });
  const cutoff = d("nr_cutoff", S.order.slot - 15 * 60);
  const created = await api("run.create", {
    host: emp.id,
    cafe: S.order.cafe,
    slot: S.order.slot,
    cutoff: cutoff === "" ? null : Number(cutoff),
    pay_mode: d("nr_pay", "each"),
    mode: d("nr_mode", "pickup"),
    title: d("nr_title", ""),
  }, { silent: true });
  if (!created.ok) {
    S.modal = null;
    S.orderError = created.error;
    render();
    return;
  }
  S.modal = null;
  const joined = await api("run.join", { run: created.result, who: emp.id, spec }, { silent: true });
  if (!joined.ok) {
    S.orderError = joined.error;
  }
  S.order.item = null;
  S.preview = null;
  S.drafts.openRun = created.result;
  S.tab.emp = "runs";
  toast(t("Run created — share it on WhatsApp from the Runs tab"), "ok");
  render();
};
A.join = async (ds) => {
  const emp = me();
  const spec = Object.assign({}, S.preview && S.preview.ok ? S.preview.spec : S.order.spec, { item: S.order.item });
  const run = S.data.runs[ds.run];
  const coupon = run && run.pay_mode === "each" && S.preview && S.preview.ok && !S.preview.coupon_error ? d("order_coupon", "") || null : null;
  const result = await api("run.join", { run: ds.run, who: emp.id, spec, coupon }, { silent: true, success: t("You're in! Money is held now and charged at cutoff.") });
  if (!result.ok) {
    S.orderError = result.error;
    render();
    return;
  }
  S.orderError = null;
  S.order.targetRun = null;
  S.order.item = null;
  S.preview = null;
  S.drafts.order_coupon = "";
  S.drafts.openRun = ds.run;
  S.tab.emp = "runs";
  render();
};
A.joinrun = (ds) => {
  const run = S.data.runs[ds.run];
  S.order.cafe = run.cafe;
  S.order.targetRun = run.id;
  S.order.slot = run.slot;
  S.order.item = null;
  S.preview = null;
  S.tab.emp = "order";
  render();
};
A.openrun = (ds) => {
  S.drafts.openRun = ds.run;
  S.tab.emp = "runs";
  render();
  const el = document.getElementById("run-" + ds.run);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};
A.saveusual = async () => {
  const emp = me();
  const spec = Object.assign({}, S.preview.spec);
  await api("profile.update", { emp: emp.id, fields: { usual: { cafe: S.order.cafe, spec } } }, { success: t("Saved as your usual") });
};
A.removeline = (ds) => api("run.remove_line", { run: ds.run, line: ds.line, by: me().id }, { success: t("Removed — hold released / refunded") });
A.locknow = (ds) => api("run.lock_now", { run: ds.run, by: me().id }, { success: t("Orders closed and sent to the café") });
A.setrunner = (ds) => api("run.set_runner", { run: ds.run, emp: ds.emp }, { success: t("Runner updated") });
A.copy = (ds) => {
  navigator.clipboard && navigator.clipboard.writeText(ds.text);
  toast(t("Copied"), "ok");
};
A.depart = (ds) => api("run.depart", { run: ds.run, by: me().id, eta: Number(d("eta_" + ds.run, 5)) }, { success: t("Café notified — they'll start when you're close") });
A.delay = (ds) => api("run.depart", { run: ds.run, by: me().id, eta: Number(ds.rem) + 5 }, { success: t("ETA updated — café will fire later") });
A.scan = async (ds) => {
  const code = ds.code || d("scan_" + ds.run, "");
  const payload = await postAction("pickup.scan", { run: ds.run, code, by: me().id });
  const result = payload.result || {};
  S.scanLog[ds.run] = (S.scanLog[ds.run] || []).concat([{ ok: result.ok, text: msg(result) }]);
  S.drafts["scan_" + ds.run] = "";
  if (!result.ok) {
    toast(msg(result), "error");
  }
  await refresh(true);
};
A.pickup = async (ds) => {
  const result = await api("pickup.complete", { run: ds.run, by: me().id, report_missing: ds.missing === "1" }, { success: ds.missing ? t("Missing cups reported — priority remake started") : t("Great — everyone is notified") });
  if (!result.ok && result.error.code === "MISSING") {
    S.scanLog[ds.run] = (S.scanLog[ds.run] || []).concat([{ ok: false, text: msg(result.error) }]);
    render();
  }
};
A.lobby = (ds) => api("lobby.handoff", { run: ds.run, by: me().id }, { success: t("Collected from lobby") });
A.flag = (ds) => {
  S.modal = { type: "flag", run: ds.run, line: ds.line, remedy: ds.remedy };
  render();
};
A.doflag = async () => {
  const m = S.modal;
  S.modal = null;
  await api("line.flag", { run: m.run, line: m.line, by: me().id, remedy: m.remedy, reason: d("flag_reason", "wrong drink") }, { success: m.remedy === "remake" ? t("Remake on the way") : t("Credited") });
};
A.rsvp = (ds) => api("event.rsvp", { event: ds.event, emp: me().id, rsvp: ds.v });
A.meetingorder = (ds) => {
  const office = officeOf(me());
  const cafes = Object.values(S.data.cafes).filter((cafe) => cafe.walk_min[office.id] != null);
  return api("meeting.order", { event: ds.event, cafe: d("mcafe_" + ds.event, cafes[0].id), by: me().id }, { success: t("Meeting order created from RSVPs") });
};
A.giftamt = (ds) => {
  S.drafts.gift_amt = ds.v;
  render();
};
A.gift = () => {
  const emp = me();
  const reward = officeOf(emp).karma_reward;
  const colleagues = Object.values(S.data.employees).filter((other) => other.id !== emp.id && other.active && S.data.offices[other.office].country === officeOf(emp).country);
  return api("gift.send", {
    from: emp.id,
    to: d("gift_to", colleagues[0].id),
    amount: Number(d("gift_amt", reward)),
    source: d("gift_src", "kudos"),
    message: d("gift_msg", t("Thanks for the help today!")),
  }, { success: t("Coffee sent") });
};
A.karma = () => api("karma.redeem", { emp: me().id }, { success: t("Free drink credit added") });
A.pset = (ds) => {
  let value = ds.v;
  if (ds.field === "sugar") {
    value = Number(value);
  }
  if (ds.field === "milk_pref" && value === "") {
    value = null;
  }
  return api("profile.update", { emp: me().id, fields: { [ds.field]: value } });
};
A.badgetap = async () => {
  const cafe = persona().id;
  const payload = await postAction("cafe.badge", { cafe, badge: d("badge", "NDG-1001") });
  S.badgeResult = payload.result || payload.error;
  await refresh(true);
};
A.cafe = (ds) => api(ds.op, { run: ds.run });
A.stock = (ds) => api("cafe.stock", { cafe: persona().id, key: ds.key, available: ds.v === "1" }, { success: ds.v === "1" ? t("Back in stock") : t("Marked sold out — open orders updated with each customer's rule") });
A.cafesettings = () => api("cafe.settings", { cafe: persona().id, capacity: Number(d("cap", 8)), offpeak: Number(d("offpeak", 10)) }, { success: t("Saved") });
A.quote = (ds) => {
  const cafe = S.data.cafes[persona().id];
  const amount = toMinor(cafe.country, d("quote_" + ds.req, 0));
  return api("cafe.quote", { request: ds.req, amount }, { success: t("Quote sent") });
};
A.officeupdate = () => {
  const office = S.data.offices[S.adminOffice];
  const c = office.country;
  const budgets = {};
  for (const key of Object.keys(office.budgets)) {
    budgets[key] = toMinor(c, d("pol_b_" + key, office.budgets[key].limit / Math.pow(10, country(c).decimals)));
  }
  return api("office.update", {
    office: office.id,
    allowance_daily: toMinor(c, d("pol_allow", office.allowance_daily / Math.pow(10, country(c).decimals))),
    catering_threshold: toMinor(c, d("pol_cat", office.catering_threshold / Math.pow(10, country(c).decimals))),
    budgets,
  }, { success: t("Saved") });
};
A.deactivate = (ds) => api("scim.deactivate", { emp: ds.emp }, { success: t("Offboarded via SCIM — open holds released") });
A.scimadd = () => api("scim.add", { office: S.adminOffice, name: d("scim_name", "Nadia Kusuma"), team: d("scim_team", "People"), email: "" }, { success: t("New hire provisioned") });
A.roulette = () => api("roulette.run", { office: S.adminOffice }, { success: t("Pairs announced") });
A.approve = (ds) => api("catering.approve", { request: ds.req, approve: ds.v === "1" });
A.catering = () => {
  const office = S.data.offices[S.adminOffice];
  const cafes = Object.values(S.data.cafes).filter((cafe) => cafe.walk_min[office.id] != null);
  const by = Object.values(S.data.employees).find((emp) => emp.office === office.id && emp.role === "admin") || Object.values(S.data.employees).find((emp) => emp.office === office.id);
  return api("catering.request", {
    by: by.id,
    cafe: d("cat_cafe", cafes[0].id),
    desc: d("cat_desc", "Kopi literan 1L ×10 + snack box"),
    headcount: Number(d("cat_pax", 40)),
    when: S.now + 24 * 3600,
  }, { success: t("Request sent to café") });
};
A.guestcode = (ds) => {
  S.drafts.guestCode = ds.code;
  render();
};
A.gset = (ds) => {
  S.drafts[ds.k] = ds.v;
  render();
};
A.guestjoin = async (ds) => {
  const run = S.data.runs[ds.run];
  const cafe = S.data.cafes[run.cafe];
  const item = d("g_item", Object.keys(cafe.menu)[0]);
  const name = d("g_name", "").trim();
  if (!name) {
    toast(t("Please enter your name"), "error");
    return;
  }
  const spec = { item, temp: d("g_temp", null), sugar: Number(d("g_sugar", 100)) };
  const result = await api("run.join", { run: run.id, who: null, spec, guest_name: name, guest_method: d("g_method", country(cafe.country).payments[0]) }, { success: t("You're in! Look for your name on the cup.") });
  if (result.ok) {
    S.drafts.g_name = "";
  }
};

/* change handlers (checkboxes / selects) */
const C = {};
C.persona = (el) => {
  setPersona(el.value);
  render();
};
C.speed = (el) => {
  const value = Number(el.value);
  api("clock.config", value === 0 ? { paused: true } : { speed: value, paused: false });
};
C.adminOffice = (el) => {
  S.adminOffice = el.value;
  render();
};
C.atcafe = (el) => api("cafe.at", { emp: me().id, cafe: el.value || null });
C.rerender = () => render();
C.reusable = (el) => {
  if (S.preview && S.preview.ok) {
    S.order.spec = Object.assign({}, S.preview.spec);
  }
  S.order.spec.reusable = el.checked;
  schedulePreview();
};
C.allergy = (el) => {
  const emp = me();
  const set = new Set(emp.profile.allergies || []);
  if (el.checked) {
    set.add(el.dataset.v);
  } else {
    set.delete(el.dataset.v);
  }
  api("profile.update", { emp: emp.id, fields: { allergies: [...set] } });
};
C.pflag = (el) => api("profile.update", { emp: me().id, fields: { [el.dataset.field]: el.checked } });
C.sub = (el) => {
  const emp = me();
  const subs = JSON.parse(JSON.stringify(emp.profile.subs || {}));
  const list = (subs[el.dataset.milk] || []).slice(0, 2);
  list[Number(el.dataset.i)] = el.value || null;
  subs[el.dataset.milk] = list.filter(Boolean);
  api("profile.update", { emp: emp.id, fields: { subs } });
};
C.officeday = (el) => {
  const emp = me();
  const days = new Set(emp.office_days);
  if (el.checked) {
    days.add(Number(el.dataset.v));
  } else {
    days.delete(Number(el.dataset.v));
  }
  api("profile.update", { emp: emp.id, fields: { office_days: [...days] } });
};
C.policy = (el) => api("policy.update", { [el.dataset.field]: el.checked });

/* ------------------------------------------------------------------ wiring */

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-act]");
  if (!el || !el.dataset.act || el.disabled) {
    return;
  }
  if (el.tagName === "A" && el.getAttribute("href") && !el.getAttribute("href").startsWith("#")) {
    return;
  }
  const handler = A[el.dataset.act];
  if (handler) {
    event.preventDefault();
    handler(el.dataset, el);
  }
});

document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset && el.dataset.draft) {
    S.drafts[el.dataset.draft] = el.type === "checkbox" ? el.checked : el.value;
  }
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset && el.dataset.draft) {
    S.drafts[el.dataset.draft] = el.type === "checkbox" ? el.checked : el.value;
  }
  const name = el.dataset ? (el.dataset.change || el.dataset.actChange) : null;
  if (name && C[name]) {
    C[name](el);
    el.blur();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  const el = event.target;
  if (el.dataset && el.dataset.draft === "nl") {
    el.blur();
    A.nl();
  }
  if (el.dataset && el.dataset.draft && el.dataset.draft.startsWith("scan_")) {
    el.blur();
    A.scan({ run: el.dataset.draft.slice(5) });
  }
  if (el.dataset && el.dataset.draft === "guestCode") {
    el.blur();
    render();
  }
});

document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (S.pendingRender && !isEditing()) {
      render();
    }
  }, 50);
});

function applyHash() {
  const hash = location.hash.replace(/^#/, "");
  const [route, code] = hash.split("/");
  if (route === "guest" && code) {
    setPersona("guest:");
    S.drafts.guestCode = code.toUpperCase();
  }
  if (route === "join" && code && S.data) {
    const run = Object.values(S.data.runs).find((r) => r.code === code.toUpperCase());
    if (run) {
      if (persona().kind !== "emp") {
        const host = S.data.employees[run.host];
        const colleague = Object.values(S.data.employees).find((emp) => emp.office === host.office && emp.id !== host.id && !run.lines.some((line) => line.who === emp.id));
        setPersona("emp:" + (colleague || host).id);
      }
      S.order.cafe = run.cafe;
      S.order.targetRun = run.id;
      S.order.slot = run.slot;
      S.tab.emp = "order";
    }
  }
}

window.addEventListener("hashchange", () => {
  applyHash();
  render();
});

function connectLive() {
  if (!("EventSource" in window)) {
    setInterval(() => refresh(false), 1000);
    return;
  }
  const source = new EventSource("/api/events");
  source.addEventListener("rev", () => {
    S.live = true;
    refresh(false);
  });
  source.onopen = () => {
    S.live = true;
    updateLiveDot();
  };
  source.onerror = () => {
    S.live = false;
    updateLiveDot();
  };
}

function updateLiveDot() {
  const dot = document.querySelector(".live");
  if (dot) {
    dot.classList.toggle("on", S.live);
  }
}

function registerServiceWorker() {
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!("serviceWorker" in navigator) || !secure) {
    return;
  }
  navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("SW", error));
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "open") {
      const url = new URL(event.data.url, location.origin);
      const tab = url.searchParams.get("tab");
      if (tab) {
        S.tab[persona().kind] = tab;
        render();
      }
    }
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  S.installEvent = event;
  requestRender();
});

window.addEventListener("appinstalled", () => {
  S.installEvent = null;
  toast(t("CrewCup installed — find it in your apps"), "ok");
  requestRender();
});

window.addEventListener("online", () => refresh(true));

(async function start() {
  if (S.persona) {
    await ensureSession();
  }
  await refresh(true);
  applyHash();
  render();
  if (params.get("live") !== "0") {
    registerServiceWorker();
    connectLive();
  }
  setInterval(() => refresh(false), 5000);
  setInterval(updateClock, 1000);
})();
