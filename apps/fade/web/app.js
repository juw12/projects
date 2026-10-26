/* Fade — barber booking + haircut shorts marketplace.
 * Runs fully offline as a local demo (data stays in this browser), or connected to the
 * Fade server (server/server.py) for real multi-user accounts, bookings, a payments
 * ledger, shorts uploads, follows, chat and creator commissions.
 * Roles: customer / creator, barber (rents chairs anywhere), shop owner (rents chairs out).
 */
(function () {
  'use strict';

  const SEED = window.SEED;
  const VERSION = '2.0.0';
  const LOCAL_KEY = 'fade.state';
  const REMOTE_KEY = 'fade.remote';
  const STATE_VERSION = 1;

  // ---------- Business rules (mirrored in server/server.py, checked by tests) ----------
  const TIERS = {
    standard: { label: 'Standard', fee: 3 },
    premium: { label: 'Premium', fee: 6 },
    luxe: { label: 'Luxe', fee: 10 },
  };
  const PLANS = [
    { id: 'free', name: 'Free', price: 0, disc: 0, mult: 1, noFee: false, perks: ['Pay per booking', '1× points', 'Full access to every barber'] },
    { id: 'club', name: 'Fade Club', price: 9.99, disc: 5, mult: 2, noFee: true, perks: ['No booking fees', '5% off every service', '2× points', 'Members-only product drops'] },
    { id: 'pro', name: 'Fade Club Pro', price: 24.99, disc: 10, mult: 3, noFee: true, perks: ['Everything in Club', '10% off every service', 'Priority slots + free late cancel', '3× points', 'Free lineup every month'] },
  ];
  const BOOKING_FEE = 0.99;      // platform fee per booking (waived for members)
  const DEPOSIT_PCT = 0.2;       // deposit share of the service price
  const POINT_VALUE = 0.01;      // 100 pts = $1
  const FULL_PAY_BONUS = 50;     // pts for paying in full up front
  const REVIEW_BONUS = 50;
  const DELIVERY_FEE = 3;
  const CANCEL_FREE_HOURS = 24;
  const MAX_TIP = 500;
  const COMMISSION_RATES = { featured: 0.05, sponsored: 0.10 };
  const MIN_WITHDRAW = 1;
  const ATTRIBUTION_HOURS = 24;  // a booking/purchase counts for a short tapped in the last 24 h
  const SHORT_CATEGORIES = ['Cut reveal', 'Before / after', 'Tutorial', 'Shop tour', 'Products', 'Behind the chair'];
  const MAX_SHORT_SECONDS = 90;
  const MAX_SHORT_MB = 60;
  const UPLOAD_TYPES = {
    'video/mp4': 'video',
    'video/webm': 'video',
    'video/quicktime': 'video',
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
  };
  const RANKS = [
    { name: 'Fresh', min: 0, color: '#9a9aa8' },
    { name: 'Sharp', min: 1000, color: '#4db8ff' },
    { name: 'Clean', min: 3000, color: '#c8ff3d' },
    { name: 'Legend', min: 7500, color: '#ffc83d' },
  ];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LOCAL_CITY = 'Jakarta';
  const DEFAULT_LOCATION = { lat: -6.225, lng: 106.809, label: 'Senopati, Jakarta' };
  const USER_TZ = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (err) {
      return 'UTC';
    }
  })();

  // ---------- Utilities ----------
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const round2 = (n) => Math.round(n * 100) / 100;
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(round2(n)).toFixed(2);
  const fmtNum = (n) => Math.round(n).toLocaleString('en-US');
  const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = (prefix = 'id') => prefix + Math.random().toString(36).slice(2, 9);
  const firstName = (name) => name.split(' ')[0];

  function esc(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, (ch) => map[ch]);
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function dkey(date) {
    const d = new Date(date);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function fmtDate(key) {
    const d = parseKey(key);
    return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
  }

  function fmtTime(h) {
    const hr = Math.floor(h);
    const min = Math.round((h - hr) * 60);
    const suffix = hr >= 12 ? 'PM' : 'AM';
    const h12 = ((hr + 11) % 12) + 1;
    return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
  }

  function fmtHours(from, to) {
    return `${fmtTime(from).replace(':00', '')}–${fmtTime(to).replace(':00', '')}`;
  }

  function nowHours() {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60;
  }

  function ago(ts) {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 1440)}d`;
  }

  function km(a, b) {
    const R = 6371;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // ---------- Timezones (barbers work in many cities; slot times are the shop's local time) ----------
  const tzFormatters = {};

  function tzParts(tz, date = new Date()) {
    if (!(tz in tzFormatters)) {
      try {
        tzFormatters[tz] = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        });
      } catch (err) {
        tzFormatters[tz] = null;
      }
    }
    const fmt = tzFormatters[tz];
    if (!fmt) {
      const hh = date.getHours();
      const mm = date.getMinutes();
      return { key: dkey(date), y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), hh, mm, h: hh + mm / 60 };
    }
    const parts = {};
    fmt.formatToParts(date).forEach((part) => {
      parts[part.type] = part.value;
    });
    const hh = Number(parts.hour) % 24;
    const mm = Number(parts.minute);
    return {
      key: `${parts.year}-${parts.month}-${parts.day}`,
      y: Number(parts.year),
      m: Number(parts.month),
      d: Number(parts.day),
      hh,
      mm,
      h: hh + mm / 60,
    };
  }

  function placeTz(place) {
    return (place && place.tz) || USER_TZ;
  }

  function placeNow(place) {
    return tzParts(placeTz(place));
  }

  // Wall-clock time at a place -> real Date (handles DST via Intl).
  function placeTimeToDate(place, key, hours) {
    const [y, m, d] = key.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, 0, Math.round(hours * 60));
    const local = tzParts(placeTz(place), new Date(guess));
    const offset = Date.UTC(local.y, local.m - 1, local.d, local.hh, local.mm) - guess;
    return new Date(guess - offset);
  }

  function tzNote(place) {
    if (!place || placeTz(place) === USER_TZ) return '';
    return tzParts(placeTz(place)).hh === tzParts(USER_TZ).hh ? '' : ` · ${place.city} time`;
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  // ---------- Icons ----------
  const ICONS = {
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    play: '<rect x="3" y="3" width="18" height="18" rx="4"/><polygon points="10 8 16 12 10 16 10 8"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    chev: '<polyline points="9 18 15 12 9 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    crown: '<path d="M2 18h20l-2-11-5 5-3-7-3 7-5-5z"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    wallet: '<path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/><path d="M21 11h-4a2 2 0 0 0 0 4h4z"/>',
    history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v8h14v-8"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    flame: '<path d="M12 22c4.4 0 8-3 8-8 0-3-1.5-5.5-3.5-7.5-.4 2-1.5 3.5-3 4C14 7 12 4 9 2c.5 3-1 5.5-3 7.5S4 13 4 14c0 5 3.6 8 8 8z"/>',
  };

  function icon(name, size = 20, extra = '') {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] || ''}</svg>`;
  }

  const verifiedBadge = `<span class="verified" title="Verified barber"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.4 13 2.1 9.8l3-1.7.9-3.3 3.4.4z"/><path d="M8 12.5l2.6 2.5L16 9.5" stroke="#0b0b0f" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

  // ---------- Generated art (stand-ins for real photos) ----------
  let artSeq = 0;
  const SKINS = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#5c3a21', '#a86b3c'];

  function cutArt(style, hue, opts = {}) {
    const id = `ca${artSeq++}`;
    const skin = opts.skin || SKINS[hue % SKINS.length];
    const hair = opts.color || '#121214';
    let back = '';
    let front = '';
    const cap = (o = 1) => `<path d="M30 42 Q29 21 50 20 Q71 21 70 42 Q66 30 50 29 Q34 30 30 42Z" fill="${hair}" opacity="${o}"/>`;
    const sides = (o = 0.35) => `<ellipse cx="30.5" cy="44" rx="2.4" ry="7" fill="${hair}" opacity="${o}"/><ellipse cx="69.5" cy="44" rx="2.4" ry="7" fill="${hair}" opacity="${o}"/>`;
    switch (style) {
      case 'fade':
        front = `<path d="M31 37 Q31 16 50 15 Q69 16 69 37 Q61 28 50 28 Q39 28 31 37Z" fill="${hair}"/>${sides(0.3)}`;
        break;
      case 'design':
        front = `<path d="M31 37 Q31 16 50 15 Q69 16 69 37 Q61 28 50 28 Q39 28 31 37Z" fill="${hair}"/>${sides(0.3)}<path d="M33 30 L38 35 L34 38 L39 44" stroke="hsl(${hue},100%,70%)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
        break;
      case 'crop':
        front = `<path d="M30 41 Q29 17 50 17 Q71 17 70 41 L67 33 Q61 36 55 32 Q49 37 43 33 Q37 36 33 33Z" fill="${hair}"/>${sides(0.4)}`;
        break;
      case 'pomp':
        front = `<path d="M30 39 Q27 9 55 7 Q76 9 70 37 Q64 25 50 26 Q37 27 30 39Z" fill="${hair}"/>${sides(0.4)}`;
        break;
      case 'curly': {
        const curls = [32, 38, 44, 50, 56, 62, 68].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 19 : 24}" r="7" fill="${hair}"/>`).join('');
        front = `${curls}<path d="M30 40 Q30 24 50 23 Q70 24 70 40 Q64 31 50 31 Q36 31 30 40Z" fill="${hair}"/>`;
        break;
      }
      case 'afro':
        back = `<circle cx="50" cy="36" r="29" fill="${hair}"/>`;
        break;
      case 'braids': {
        const rows = [38, 44, 50, 56, 62].map((x) => `<path d="M${x} 21 Q${x - 2} 30 ${x - 6} 41" stroke="hsl(${hue},40%,35%)" stroke-width="1.2" fill="none"/>`).join('');
        front = `${cap()}${rows}`;
        back = `<path d="M30 44 Q28 70 33 86 M70 44 Q72 70 67 86" stroke="${hair}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
        break;
      }
      case 'locs': {
        const locs = [30, 36, 42, 58, 64, 70].map((x) => `<rect x="${x - 2.5}" y="30" width="5" height="${44 + (x % 3) * 6}" rx="2.5" fill="${hair}"/>`).join('');
        back = locs;
        front = cap();
        break;
      }
      case 'beard':
        front = `${cap(0.85)}<path d="M29 48 Q31 77 50 79 Q69 77 71 48 Q66 64 50 66 Q34 64 29 48Z" fill="${hair}"/>`;
        break;
      case 'buzz':
      default:
        front = `${cap(0.75)}${sides(0.25)}`;
    }
    return `<svg class="cutart" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},70%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,10%)"/>
      </linearGradient></defs>
      <rect width="100" height="100" fill="url(#${id})"/>
      <circle cx="78" cy="18" r="22" fill="hsl(${hue},90%,60%)" opacity=".18"/>
      ${back}
      <path d="M12 100 Q16 79 50 78 Q84 79 88 100Z" fill="hsl(${hue},25%,16%)"/>
      <rect x="42" y="64" width="16" height="16" rx="5" fill="${skin}"/>
      <ellipse cx="50" cy="47" rx="20" ry="25" fill="${skin}"/>
      <ellipse cx="29.5" cy="49" rx="3" ry="5" fill="${skin}"/><ellipse cx="70.5" cy="49" rx="3" ry="5" fill="${skin}"/>
      ${front}
    </svg>`;
  }

  function avatar(name, hue, size = 44, img) {
    const initials = String(name).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const bg = `linear-gradient(135deg,hsl(${hue},90%,66%),hsl(${(hue + 55) % 360},85%,52%))`;
    const inner = img ? `<img src="${img}" alt="">` : esc(initials);
    return `<span class="avatar" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.38)}px">${inner}</span>`;
  }

  function barberAvatar(b, size = 44) {
    return avatar(b.name, b.hue, size, b.photo);
  }

  function tile(item, opts = {}) {
    const visual = item.img ? `<img src="${esc(mediaUrl(item.img))}" alt="" loading="lazy">` : cutArt(item.style, item.hue, { color: item.color });
    const likes = opts.likes === false ? '' : `<span class="likes">${icon('heart', 10)} ${compact(item.likes || 0)}</span>`;
    return `<div class="tile">${visual}${likes}${opts.tag === false ? '' : `<span class="tile-tag ellip">${esc(item.title)}</span>`}</div>`;
  }

  function placeCover(p) {
    return `background:
      radial-gradient(120px 80px at 80% 20%, hsla(${p.hue},90%,60%,.55), transparent 70%),
      radial-gradient(160px 100px at 10% 100%, hsla(${(p.hue + 60) % 360},90%,50%,.4), transparent 70%),
      linear-gradient(135deg, hsl(${p.hue},40%,16%), hsl(${(p.hue + 40) % 360},40%,8%))`;
  }

  function tierBadge(p) {
    return `<span class="badge ${p.tier}">${p.tier === 'luxe' ? '✦ ' : ''}${TIERS[p.tier].label}</span>`;
  }

  function stars(r) {
    return `<span class="gold">★</span> <b>${Number(r).toFixed(r >= 4.95 && r < 5 ? 2 : 1)}</b>`;
  }

  // ---------- State ----------
  let S = null;
  let storeKey = LOCAL_KEY;

  function loadState(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && saved.v === STATE_VERSION) return saved;
    } catch (err) {
      console.warn('Could not read saved state', err);
    }
    return key === REMOTE_KEY ? initRemoteState() : initState();
  }

  function save() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(S));
    } catch (err) {
      toast('Storage is full — remove some photos or shorts');
    }
  }

  function baseState() {
    return {
      v: STATE_VERSION,
      onboarded: false,
      role: 'customer',
      user: {
        id: 'me', name: '', handle: '', hue: 210, points: 0, lifetime: 0, wallet: 0, plan: 'free',
        method: 'wallet', cards: [], location: { ...DEFAULT_LOCATION }, followers: 0, bio: '',
      },
      places: [],
      barbers: [],
      products: [],
      creators: [],
      shorts: [],
      bookings: [],
      txns: [],
      orders: [],
      cart: [],
      threads: [],
      following: [],
      saved: [],
      boosts: {},
      claimed: {},
      referrals: 0,
      rentPaid: {},
      commissions: [],
      commissionsOwed: [],
      readMarks: {},
      lastRef: null,
      meBarberId: null,
      mePlaceId: null,
    };
  }

  function initRemoteState() {
    return { ...baseState(), remote: true };
  }

  function initState() {
    const now = Date.now();
    const state = baseState();
    Object.assign(state.user, {
      name: 'Juwen Lie',
      handle: 'juwen',
      points: 1240,
      lifetime: 2380,
      wallet: 85,
      cards: [{ id: 'c1', brand: 'Visa', last4: '4242', exp: '08/28' }],
      followers: 128,
      bio: 'Fresh cut every 3 weeks. Jakarta.',
      refCode: 'JUWEN-FRESH',
    });
    state.places = clone(SEED.places);
    state.barbers = clone(SEED.barbers);
    state.products = clone(SEED.products);
    state.creators = clone(SEED.creators);
    state.shorts = seedShorts(now);
    state.threads = clone(SEED.threads).map((t) => ({
      ...t,
      messages: t.messages.map((m) => ({ from: m.from, name: m.from, text: m.text, t: now - m.ago * 60000 })),
    }));
    state.following = ['barber:b1', 'user:u2', 'place:p3'];
    state.meBarberId = 'b1';
    state.mePlaceId = 'p1';
    S = state;
    state.bookings = seedBookings();
    state.txns = [
      { id: 'tx1', label: 'Top up from Visa •••• 4242', amount: 100, method: 'Visa •••• 4242', date: addDays(TODAY, -20).toISOString() },
      { id: 'tx2', label: 'Booking · Marcus Reyes', amount: -15, method: 'Wallet', date: addDays(TODAY, -12).toISOString() },
    ];
    return state;
  }

  function seedShorts(now) {
    const list = SEED.shorts.map((source) => {
      const copy = clone(source);
      copy.createdAt = now - source.agoHours * 3600000;
      delete copy.agoHours;
      copy.likedByMe = false;
      return copy;
    });
    // A creator tagged Marcus (your demo barber) and Kings Lounge (your demo shop): approve it in Studio / My Place.
    list.push({
      id: 'sh_u3_req', authorType: 'user', authorId: 'u3', category: 'Cut reveal',
      caption: 'Tried the mid taper at Kings — tagging the legend 🙏 #taper #jakarta',
      media: { kind: 'art', style: 'fade', hue: 70 }, likes: 420, views: 5100, shares: 12, conversions: 0,
      createdAt: now - 2 * 3600000, likedByMe: false,
      tags: [
        { type: 'barber', id: 'b1', kind: 'featured', status: 'pending' },
        { type: 'place', id: 'p1', kind: 'sponsored', status: 'pending' },
      ],
    });
    return list;
  }

  function seedBookings() {
    const make = (id, barberId, placeId, serviceId, offset, time, status, extra = {}) => {
      const b = barberById(barberId);
      const svc = b.services.find((s) => s.id === serviceId);
      const q = quote({ price: svc.price, place: placeById(placeId), plan: 'free', payMode: 'full', usePoints: false, points: 0 });
      return {
        id, barberId, placeId, serviceId, serviceName: svc.name, mins: svc.mins,
        date: dkey(addDays(TODAY, offset)), time, status, quote: q, paidNow: q.dueNow, payLater: 0,
        rated: false, tip: 0, notes: '', style: 'fade', createdAt: Date.now(), userId: 'me', method: 'wallet', ...extra,
      };
    };
    const marcus = barberById('b1');
    const next = nextShift(marcus, 1);
    const upcoming = make('bk1', 'b1', next.shift.placeId, 's1', next.offset, next.shift.from + 3, 'upcoming', { style: 'fade', paidNow: 5.39, payLater: 0 });
    upcoming.payLater = round2(upcoming.quote.total - upcoming.paidNow);
    return [
      upcoming,
      make('bk2', 'b1', 'p3', 's2', -12, 15.5, 'completed', { rated: true, rB: 5, rP: 5, tip: 5, style: 'beard', notes: '#1 skin fade, 2" scissor on top, beard faded into sideburns.' }),
      make('bk3', 'b2', 'p3', 's1', -33, 11, 'completed', { rated: true, rB: 5, rP: 4, tip: 4, style: 'crop', notes: 'Textured crop, point-cut fringe, sea salt spray.' }),
      make('bk4', 'b3', 'p2', 's1', -51, 18, 'completed', { rated: true, rB: 4, rP: 4, tip: 0, style: 'buzz', notes: '#2 all over, sharp lineup, no beard.' }),
      make('bk5', 'b4', 'p4', 's1', -3, 16, 'completed', { style: 'crop', notes: 'Two-block, 6mm sides, matte clay finish.' }),
    ];
  }

  // ---------- Lookups ----------
  function barberById(id) {
    return (S && S.barbers ? S.barbers : SEED.barbers).find((b) => b.id === id);
  }

  function placeById(id) {
    return (S && S.places ? S.places : SEED.places).find((p) => p.id === id);
  }

  function productById(id) {
    return S.products.find((p) => p.id === id);
  }

  function planOf(id) {
    return PLANS.find((p) => p.id === id) || PLANS[0];
  }

  function rankFor(pts) {
    let current = RANKS[0];
    for (const r of RANKS) {
      if (pts >= r.min) current = r;
    }
    const next = RANKS[RANKS.indexOf(current) + 1] || null;
    return { current, next };
  }

  function distanceKm(place) {
    return km(S.user.location, place);
  }

  function distLabel(place) {
    const d = distanceKm(place);
    if (d > 150) return place.city;
    return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
  }

  function isLocal(place) {
    return distanceKm(place) < 150;
  }

  function mediaUrl(url) {
    if (!url) return '';
    if (url.startsWith('/media/') && API.base) return API.base + url;
    return url;
  }

  function creatorById(id) {
    if (id === 'me' || (S.user.id && id === S.user.id)) return { ...S.user, isMe: true };
    return S.creators.find((c) => c.id === id);
  }

  function isMyShort(sh) {
    return API.on ? sh.userId === S.user.id : !!sh.byMe;
  }

  function authorInfo(sh) {
    if (sh.authorType === 'barber') {
      const b = barberById(sh.authorId);
      if (b) {
        return { type: 'barber', id: b.id, name: b.name, handle: b.handle, hue: b.hue, img: b.photo, verified: b.verified, path: `/barber/${b.id}` };
      }
    }
    if (sh.authorType === 'place') {
      const pl = placeById(sh.authorId);
      if (pl) {
        return { type: 'place', id: pl.id, name: pl.name, handle: pl.short.toLowerCase().replace(/\s+/g, ''), hue: pl.hue, verified: pl.tier === 'luxe', path: `/place/${pl.id}` };
      }
    }
    const c = creatorById(sh.authorId) || { id: sh.authorId, name: 'Fade user', handle: 'user', hue: 200, followers: 0 };
    const id = c.isMe ? 'me' : c.id;
    return { type: 'user', id, name: c.name, handle: c.handle, hue: c.hue, verified: (c.followers || 0) > 40000, path: `/user/${id}` };
  }

  function followKey(type, id) {
    return `${type}:${id}`;
  }

  function isFollowing(type, id) {
    return S.following.includes(followKey(type, id));
  }

  function followersOf(type, doc) {
    if (!doc) return 0;
    const base = doc.followers || 0;
    return API.on ? base : base + (isFollowing(type, doc.id) ? 1 : 0);
  }

  function tagTarget(tag) {
    return tag.type === 'barber' ? barberById(tag.id) : placeById(tag.id);
  }

  // ---------- Scheduling ----------
  const SLOT_CACHE = {};
  const SLOT_PENDING = {};

  function shiftsOn(b, key) {
    const dow = parseKey(key).getDay();
    return b.schedule.filter((s) => s.dow === dow).sort((a, c) => a.from - c.from);
  }

  function nextShift(b, startOffset = 0) {
    for (let i = startOffset; i < startOffset + 14; i++) {
      const key = dkey(addDays(TODAY, i));
      const shifts = shiftsOn(b, key);
      if (shifts.length) return { offset: i, key, shift: shifts[0], shifts };
    }
    return null;
  }

  function overlaps(aStart, aMins, bStart, bMins) {
    return aStart < bStart + bMins / 60 && bStart < aStart + aMins / 60;
  }

  // You can't be in two chairs at once.
  function myBookingClash(key, t, mins, excludeId) {
    return S.bookings.some((bk) => isMine(bk) && bk.status === 'upcoming' && bk.date === key &&
      bk.id !== excludeId && overlaps(bk.time, bk.mins, t, mins));
  }

  function slotCacheKey(b, key, mins) {
    return `${b.id}|${key}|${mins}|${(BK && BK.rescheduleId) || ''}`;
  }

  // Returns [{shift, place, slots:[{t, taken}]}] for a barber on a date (times are the shop's local time).
  function slotsFor(b, key, mins) {
    const excludeId = BK && BK.rescheduleId;
    const cached = API.on ? SLOT_CACHE[slotCacheKey(b, key, mins)] : null;
    if (cached) {
      return cached.map((g) => ({
        shift: { placeId: g.placeId, from: g.from, to: g.to },
        place: placeById(g.placeId),
        slots: g.slots.map((s) => ({ t: s.t, taken: s.taken || myBookingClash(key, s.t, mins, excludeId) })),
        live: true,
      }));
    }
    return shiftsOn(b, key).map((shift) => {
      const place = placeById(shift.placeId);
      const now = placeNow(place);
      const slots = [];
      for (let t = shift.from; t + mins / 60 <= shift.to + 1e-9; t += 0.5) {
        let taken = hash(`${b.id}|${key}|${t}`) % 100 < 34;
        const clash = S.bookings.some((bk) =>
          bk.barberId === b.id && bk.date === key && bk.status === 'upcoming' && bk.id !== excludeId &&
          overlaps(bk.time, bk.mins, t, mins));
        if (clash || myBookingClash(key, t, mins, excludeId)) taken = true;
        if (key < now.key || (key === now.key && t <= now.h + 0.25)) taken = true;
        slots.push({ t, taken });
      }
      return { shift, place, slots };
    });
  }

  // Server mode: fetch real availability (other customers' bookings included).
  async function fetchSlots(b, key, mins) {
    const cacheKey = slotCacheKey(b, key, mins);
    if (!API.on || SLOT_CACHE[cacheKey] || SLOT_PENDING[cacheKey]) return false;
    SLOT_PENDING[cacheKey] = true;
    const exclude = BK && BK.rescheduleId ? `&exclude=${encodeURIComponent(BK.rescheduleId)}` : '';
    try {
      const data = await API.req('GET', `/api/slots?barber=${encodeURIComponent(b.id)}&date=${key}&mins=${mins}${exclude}`);
      SLOT_CACHE[cacheKey] = data.groups;
      return true;
    } catch (err) {
      return false;
    } finally {
      delete SLOT_PENDING[cacheKey];
    }
  }

  function clearSlotCache() {
    Object.keys(SLOT_CACHE).forEach((key) => {
      delete SLOT_CACHE[key];
    });
  }

  function nextFree(b) {
    for (let i = 0; i < 7; i++) {
      const key = dkey(addDays(TODAY, i));
      for (const group of slotsFor(b, key, 30)) {
        const open = group.slots.find((s) => !s.taken);
        if (open) return { key, offset: i, t: open.t, place: group.place };
      }
    }
    return null;
  }

  function dayLabel(offset) {
    if (offset === 0) return 'Today';
    if (offset === 1) return 'Tomorrow';
    return DOW[addDays(TODAY, offset).getDay()];
  }

  function offsetOf(key) {
    return Math.round((parseKey(key) - TODAY) / 86400000);
  }

  // ---------- Pricing ----------
  function quote({ price, place, plan, payMode, usePoints, points }) {
    const p = planOf(plan);
    const discount = round2(price * p.disc / 100);
    const service = round2(price - discount);
    const facility = round2(service * place.fee / 100);
    const bookingFee = p.noFee ? 0 : BOOKING_FEE;
    const gross = round2(service + facility + bookingFee);
    const deposit = round2(bookingFee + facility + service * DEPOSIT_PCT);
    const payNowBase = payMode === 'full' ? gross : deposit;
    const pointsUsed = usePoints ? Math.min(points, Math.floor(payNowBase / POINT_VALUE)) : 0;
    const pointsValue = round2(pointsUsed * POINT_VALUE);
    const total = round2(gross - pointsValue);
    const dueNow = round2(payNowBase - pointsValue);
    return {
      price, discount, service, facility, facilityPct: place.fee, bookingFee, gross, deposit,
      pointsUsed, pointsValue, total, dueNow, payLater: round2(total - dueNow), payMode,
      toBarber: service, toPlace: facility, toPlatform: bookingFee,
    };
  }

  function pointsEarned(amount, planId, fullPay) {
    return Math.floor(amount * 10 * planOf(planId).mult) + (fullPay ? FULL_PAY_BONUS : 0);
  }

  // ---------- Payments ----------
  function methodLabel(method) {
    if (method === 'wallet') return 'Wallet';
    if (method === 'apple') return 'Apple Pay';
    const card = S.user.cards.find((c) => c.id === method);
    return card ? `${card.brand} •••• ${card.last4}` : 'Card';
  }

  function brandClass(brand) {
    return { Visa: 'visa', Mastercard: 'mc', Amex: 'amex', Discover: 'disc' }[brand] || 'other';
  }

  function charge(amount, method, label) {
    const value = round2(amount);
    if (value <= 0) return true;
    if (method === 'wallet') {
      if (S.user.wallet < value) {
        toast(`Wallet has ${money(S.user.wallet)} — top up or choose a card`);
        return false;
      }
      S.user.wallet = round2(S.user.wallet - value);
    }
    S.txns.unshift({ id: uid('tx'), label, amount: -value, method: methodLabel(method), date: new Date().toISOString() });
    return true;
  }

  // Refunds go back to the original payment method.
  function refund(amount, method, label) {
    const value = round2(amount);
    if (value <= 0) return;
    const toWallet = !method || method === 'wallet';
    if (toWallet) S.user.wallet = round2(S.user.wallet + value);
    S.txns.unshift({
      id: uid('tx'),
      label: toWallet ? label : `${label} → ${methodLabel(method)}`,
      amount: value,
      method: toWallet ? 'Wallet' : methodLabel(method),
      date: new Date().toISOString(),
    });
  }

  function addPoints(n) {
    S.user.points += n;
    if (n > 0) S.user.lifetime += n;
  }

  function paymentMethodsHTML(selected, actionName) {
    const rows = [
      { id: 'wallet', brand: 'wallet', label: 'Fade Wallet', sub: `Balance ${money(S.user.wallet)}`, mark: 'W' },
      ...S.user.cards.map((c) => ({ id: c.id, brand: brandClass(c.brand), label: `${c.brand} •••• ${c.last4}`, sub: `Expires ${c.exp}`, mark: c.brand.slice(0, 4).toUpperCase() })),
      { id: 'apple', brand: 'apple', label: 'Apple Pay', sub: 'Face ID', mark: '' },
    ];
    return rows.map((r) => `
      <button class="paym ${selected === r.id ? 'on' : ''}" data-act="${actionName}" data-id="${r.id}">
        <span class="brand ${r.brand}">${r.mark}</span>
        <span class="grow"><b class="small">${esc(r.label)}</b><div class="xs muted">${esc(r.sub)}</div></span>
        <span class="radio"></span>
      </button>`).join('') +
      `<button class="btn ghost sm mt8" data-act="addCard">${icon('plus', 16)} Add card</button>`;
  }

  // ---------- Leaderboards ----------
  function boostOf(id) {
    return S.boosts[id] || 0;
  }

  function barberScore(b, period) {
    const s = b.stats[period];
    const scale = period === 'all' ? 0.02 : 1;
    return Math.round((s.cuts * 10 + s.tips * 2 + s.reviews * 6) * scale + s.rating * s.rating * 40 + boostOf(b.id));
  }

  function placeScore(p, period) {
    const s = p.stats[period];
    const scale = period === 'all' ? 0.02 : period === 'month' ? 0.25 : 1;
    return Math.round(s.visits * 5 * scale + s.rating * s.rating * 60 + boostOf(p.id));
  }

  function creatorScore(authorId, period) {
    const days = period === 'week' ? 7 : period === 'month' ? 31 : 100000;
    const cutoff = Date.now() - days * 86400000;
    return Math.round(S.shorts
      .filter((sh) => sh.authorType === 'user' && sh.authorId === authorId && sh.createdAt >= cutoff)
      .reduce((sum, sh) => sum + sh.likes * 0.05 + sh.shares * 0.3 + (sh.conversions || 0) * 20 + sh.views * 0.002, 0));
  }

  function leaderboard(type, period, scope) {
    if (type === 'creators') {
      const myId = API.on ? S.user.id : 'me';
      const factor = period === 'week' ? 0.1 : period === 'month' ? 0.4 : 1;
      const people = [
        ...S.creators.map((c) => ({ ...c, me: false })),
        { id: myId, name: `${S.user.name} (you)`, hue: S.user.hue, followers: S.user.followers, me: true },
      ];
      return people
        .map((c) => ({
          id: c.me ? 'me' : c.id,
          name: c.name,
          hue: c.hue,
          sub: `${compact(c.me ? S.user.followers || 0 : followersOf('user', c))} followers`,
          score: creatorScore(c.id, period) + Math.round(((c.followers || 0) / 100) * factor),
          kind: 'creator',
          me: c.me,
        }))
        .sort((a, c) => c.score - a.score);
    }
    if (type === 'barbers') {
      return S.barbers
        .filter((b) => scope === 'global' || b.city === LOCAL_CITY)
        .map((b) => ({ id: b.id, name: b.name, hue: b.hue, sub: b.title, score: barberScore(b, period), img: b.photo, kind: 'barber' }))
        .sort((a, c) => c.score - a.score);
    }
    if (type === 'places') {
      return S.places
        .filter((p) => scope === 'global' || p.city === LOCAL_CITY)
        .map((p) => ({ id: p.id, name: p.name, hue: p.hue, sub: `${p.area}, ${p.city}`, score: placeScore(p, period), kind: 'place' }))
        .sort((a, c) => c.score - a.score);
    }
    const factor = period === 'week' ? 0.12 : period === 'month' ? 0.4 : 1;
    const mine = period === 'all' ? S.user.lifetime : Math.round(S.user.lifetime * factor);
    return [...SEED.clients.map((c) => ({ name: c.name, hue: c.hue, score: Math.round(c.pts * factor), sub: rankFor(c.pts).current.name, kind: 'client' })),
      { name: `${S.user.name} (you)`, hue: S.user.hue, score: mine, sub: rankFor(S.user.lifetime).current.name, kind: 'client', me: true }]
      .sort((a, c) => c.score - a.score);
  }

  function resetCountdown(period) {
    const now = new Date();
    let end;
    if (period === 'week') {
      end = new Date(TODAY);
      const daysToMonday = ((8 - end.getDay()) % 7) || 7;
      end.setDate(end.getDate() + daysToMonday);
    } else if (period === 'month') {
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else {
      return 'All-time Hall of Fame';
    }
    const ms = end - now;
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return `Resets in ${d}d ${h}h`;
  }

  // ---------- Bookings helpers ----------
  function isMine(bk) {
    return API.on ? bk.userId === S.user.id : (bk.userId || 'me') === 'me';
  }

  function myBookings() {
    return S.bookings.filter(isMine);
  }

  function upcomingBookings() {
    return myBookings()
      .filter((b) => b.status === 'upcoming')
      .sort((a, c) => bookingStart(a) - bookingStart(c));
  }

  function bookingStart(bk) {
    return placeTimeToDate(placeById(bk.placeId), bk.date, bk.time);
  }

  function whenLabel(bk) {
    const off = offsetOf(bk.date);
    const when = off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : fmtDate(bk.date);
    return `${when} · ${fmtTime(bk.time)}${tzNote(placeById(bk.placeId))}`;
  }

  function countdownLabel(bk) {
    const ms = bookingStart(bk) - new Date();
    if (ms < 0) return 'Now';
    const h = Math.floor(ms / 3600000);
    if (h < 1) return `In ${Math.round(ms / 60000)} min`;
    if (h < 24) return `In ${h}h`;
    return `In ${Math.floor(h / 24)}d ${h % 24}h`;
  }

  function downloadIcs(bk) {
    const b = barberById(bk.barberId);
    const p = placeById(bk.placeId);
    const start = bookingStart(bk);
    const end = new Date(start.getTime() + bk.mins * 60000);
    const f = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fade//Booking//EN', 'BEGIN:VEVENT',
      `UID:${bk.id}@fade.app`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
      `SUMMARY:${bk.serviceName} with ${b.name}`, `LOCATION:${p.name}\\, ${p.area}\\, ${p.city}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    link.download = 'fade-booking.ics';
    link.click();
    toast('Calendar invite downloaded');
  }

  function directionsUrl(p) {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  }

  // The balance due at the shop is paid in person, so it is recorded, not charged to the wallet.
  function finishLocalBooking(bk) {
    bk.status = 'completed';
    if (bk.payLater > 0) {
      S.txns.unshift({
        id: uid('tx'),
        label: `Paid at shop (in person) · ${bk.serviceName}`,
        amount: -bk.payLater,
        method: 'In person',
        date: new Date().toISOString(),
      });
      bk.paidNow = round2(bk.paidNow + bk.payLater);
      bk.payLater = 0;
    }
  }

  // Local demo: appointments whose end time has passed complete automatically.
  function autoCompleteLocal() {
    if (API.on || !S.onboarded) return false;
    let changed = false;
    S.bookings.forEach((bk) => {
      if (bk.status !== 'upcoming') return;
      if (bookingStart(bk).getTime() + bk.mins * 60000 < Date.now()) {
        finishLocalBooking(bk);
        changed = true;
      }
    });
    if (changed) save();
    return changed;
  }

  // ---------- UI primitives ----------
  let toastTimer = null;

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function confetti() {
    const fx = $('#fx');
    const colors = ['#c8ff3d', '#7c5cff', '#ff4d6d', '#ffc83d', '#4dffd2', '#ffffff'];
    for (let i = 0; i < 70; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.4}s`;
      piece.style.animationDuration = `${1.2 + Math.random() * 0.9}s`;
      fx.appendChild(piece);
    }
    setTimeout(() => {
      fx.innerHTML = '';
    }, 2600);
  }

  function openSheet(html) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="backdrop" data-act="closeSheet"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
    root.classList.add('open');
  }

  function setSheet(html) {
    const sheet = $('#sheet-root .sheet');
    if (!sheet) {
      openSheet(html);
      return;
    }
    const scroll = sheet.scrollTop;
    sheet.innerHTML = `<div class="grab"></div>${html}`;
    sheet.scrollTop = scroll;
  }

  function closeSheet() {
    const root = $('#sheet-root');
    root.innerHTML = '';
    root.classList.remove('open');
    BK = null;
    RT = null;
    if (UP && UP.url) URL.revokeObjectURL(UP.url);
    UP = null;
  }

  async function shareLink(path, title) {
    const url = `${location.origin}${location.pathname}#${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Link copied — paste it anywhere');
    } catch (err) {
      toast('Link: ' + url);
    }
  }

  function pageHead(title, opts = {}) {
    const back = opts.noBack ? '' : `<button class="iconbtn" data-act="back">${icon('back')}</button>`;
    return `<div class="pagehead">${back}<h1>${title}</h1>${opts.right || ''}</div>`;
  }

  // ---------- Router ----------
  let currentPath = '';

  function defaultPath() {
    if (!S.onboarded) return '/welcome';
    if (S.role === 'barber' && S.meBarberId) return '/pro';
    if (S.role === 'owner' && S.mePlaceId) return '/owner';
    return '/home';
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#/, '') || defaultPath();
    const [page, arg] = raw.replace(/^\//, '').split('/');
    return { raw, page, arg: arg ? decodeURIComponent(arg) : undefined };
  }

  function go(path) {
    if (location.hash === `#${path}`) {
      render();
    } else {
      location.hash = path;
    }
  }

  const FLUSH_PAGES = new Set(['feed', 'barber', 'place', 'welcome', 'user']);
  const FULL_PAGES = new Set(['welcome', 'thread']);

  function render(keepScroll = false) {
    const route = parseRoute();
    if (!S.onboarded && route.page !== 'welcome') {
      location.replace('#/welcome');
      return;
    }
    autoCompleteLocal();
    const view = VIEWS[route.page] ? route.page : defaultPath().slice(1);
    const el = $('#view');
    const active = document.activeElement;
    const keep = active && active.id && el.contains(active) && 'value' in active
      ? { id: active.id, value: active.value, pos: active.selectionStart }
      : null;
    const scroll = el.scrollTop;
    el.className = 'view' + (FLUSH_PAGES.has(view) ? ' flush' : '') + (FULL_PAGES.has(view) ? ' full' : '');
    el.innerHTML = VIEWS[view](route.arg);
    el.scrollTop = keepScroll && currentPath === route.raw ? scroll : 0;
    currentPath = route.raw;
    renderTabbar(view);
    if (keep) {
      const again = document.getElementById(keep.id);
      if (again) {
        again.value = keep.value;
        again.focus();
        try {
          again.setSelectionRange(keep.pos, keep.pos);
        } catch (err) {
          // number inputs don't support selection ranges
        }
      }
    }
    afterRender(view);
  }

  function afterRender(view) {
    hydrateMedia($('#view'));
    if (view === 'feed') {
      setupReels();
    } else {
      teardownReels();
    }
    if (view === 'thread') {
      const el = $('#view');
      el.scrollTop = el.scrollHeight;
    }
  }

  function refresh() {
    render(true);
  }

  const TABS = {
    customer: [['home', 'Home', 'home'], ['explore', 'Explore', 'compass'], ['create', 'Post', 'plus'], ['feed', 'Shorts', 'play'], ['chat', 'Chat', 'chat']],
    barber: [['pro', 'Studio', 'grid'], ['feed', 'Shorts', 'play'], ['create', 'Post', 'plus'], ['chat', 'Chat', 'chat'], ['me', 'Me', 'user']],
    owner: [['owner', 'My Place', 'store'], ['feed', 'Shorts', 'play'], ['create', 'Post', 'plus'], ['chat', 'Chat', 'chat'], ['me', 'Me', 'user']],
  };

  function threadUnread(t) {
    if (t.type === 'group' && !t.joined) return 0;
    if (!API.on) return t.unread || 0;
    const mark = S.readMarks[t.id] || 0;
    return t.messages.filter((m) => m.t > mark && m.from !== 'me').length;
  }

  function renderTabbar(view) {
    const bar = $('#tabbar');
    if (FULL_PAGES.has(view)) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const unread = S.threads.reduce((sum, t) => sum + threadUnread(t), 0);
    const tabs = TABS[S.role] || TABS.customer;
    bar.innerHTML = tabs.map(([page, label, ic]) => {
      if (page === 'create') {
        return `<button class="tab create" data-act="create" aria-label="Post a short"><span class="plus">${icon('plus', 24, 'stroke-width="3"')}</span></button>`;
      }
      const dot = page === 'chat' && unread ? `<span class="dot">${unread > 99 ? '99+' : unread}</span>` : '';
      return `<button class="tab ${view === page ? 'on' : ''}" data-act="go" data-to="/${page}" aria-label="${label}">${icon(ic, 22)}${label}${dot}</button>`;
    }).join('');
  }

  // =====================================================================
  // VIEWS
  // =====================================================================
  const VIEWS = {};

  // ---------- Welcome / sign in ----------
  const AUTH = { mode: 'signup', role: 'customer', values: {} };

  VIEWS.welcome = function () {
    const art = (S.barbers.length ? S.barbers : SEED.barbers).flatMap((b) => b.portfolio).slice(0, 12);
    return `
      <div class="welcome">
        <div class="collage">${art.map((item) => tile(item, { tag: false, likes: false })).join('')}</div>
        <div class="fadeover"></div>
        <div class="content">
          <div class="logo">fade<i>.</i></div>
          <p class="muted mt8" style="font-size:16px;line-height:1.45">Book barbers anywhere, watch real cuts in Shorts, and earn when people book from your videos.</p>
          ${API.on ? authForm() : localRoles()}
        </div>
      </div>`;
  };

  function localRoles() {
    return `
      <div class="label">Continue as</div>
      <button class="rolecard" data-act="onboard" data-role="customer">
        <span class="ri" style="background:rgba(200,255,61,.15);color:var(--acc)">${icon('user', 22)}</span>
        <span class="grow"><b>I want a cut</b><div class="small muted">Book, pay, tip, post shorts & earn</div></span>${icon('chev')}
      </button>
      <button class="rolecard" data-act="onboard" data-role="barber">
        <span class="ri" style="background:rgba(124,92,255,.2);color:#b7a6ff">${icon('scissors', 22)}</span>
        <span class="grow"><b>I'm a barber</b><div class="small muted">Rent chairs anywhere, get booked & paid</div></span>${icon('chev')}
      </button>
      <button class="rolecard" data-act="onboard" data-role="owner">
        <span class="ri" style="background:rgba(255,200,61,.15);color:var(--gold)">${icon('store', 22)}</span>
        <span class="grow"><b>I own a barbershop</b><div class="small muted">Fill chairs, earn rent + facility fees</div></span>${icon('chev')}
      </button>
      <p class="xs muted center mt16">Offline demo on this device · no real charges ·
        <a class="acc" data-act="connectServer">connect a Fade server</a></p>`;
  }

  function authValue(id, fallback = '') {
    return esc(AUTH.values[id] !== undefined ? AUTH.values[id] : fallback);
  }

  function authForm() {
    const signup = AUTH.mode === 'signup';
    const roles = [['customer', 'Client / creator'], ['barber', 'Barber'], ['owner', 'Shop owner']];
    const tiers = [['standard', 'Standard 3%'], ['premium', 'Premium 6%'], ['luxe', 'Luxe 10%']];
    return `
      <div class="seg mt16">
        <button class="${signup ? 'on' : ''}" data-act="authMode" data-v="signup">Create account</button>
        <button class="${signup ? '' : 'on'}" data-act="authMode" data-v="login">Log in</button>
      </div>
      <form id="auth-form" onsubmit="return false">
        ${signup ? `<div class="field"><label for="au-name">Name</label><input id="au-name" autocomplete="name" maxlength="60" value="${authValue('au-name')}"></div>` : ''}
        <div class="field"><label for="au-email">Email</label><input id="au-email" type="email" autocomplete="email" value="${authValue('au-email')}"></div>
        <div class="field"><label for="au-pass">Password</label><input id="au-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'At least 8 characters' : ''}" value="${authValue('au-pass')}"></div>
        ${signup ? `
          <div class="label">I am a…</div>
          <div class="seg">${roles.map(([v, l]) => `<button type="button" class="${AUTH.role === v ? 'on' : ''}" data-act="authRole" data-v="${v}">${l}</button>`).join('')}</div>
          ${AUTH.role === 'barber' ? `
            <div class="frow">
              <div class="field"><label for="au-price">Main cut price ($)</label><input id="au-price" type="number" min="1" value="${authValue('au-price', '15')}"></div>
              <div class="field"><label for="au-city">City</label><input id="au-city" value="${authValue('au-city', 'Jakarta')}"></div>
            </div>
            <div class="field"><label for="au-tags">Specialties</label><input id="au-tags" placeholder="Skin fade, Beard" value="${authValue('au-tags')}"></div>` : ''}
          ${AUTH.role === 'owner' ? `
            <div class="field"><label for="au-shop">Shop name</label><input id="au-shop" placeholder="e.g. Kings Lounge" value="${authValue('au-shop')}"></div>
            <div class="frow">
              <div class="field"><label for="au-city">City</label><input id="au-city" value="${authValue('au-city', 'Jakarta')}"></div>
              <div class="field"><label for="au-tier">Tier</label><select id="au-tier">${tiers.map(([v, l]) => `<option value="${v}" ${AUTH.values['au-tier'] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            </div>` : ''}` : ''}
        <div class="field"><span class="err" id="au-err" role="alert"></span></div>
        <button class="btn primary block" data-act="authSubmit">${signup ? 'Create account' : 'Log in'}</button>
      </form>
      <p class="xs muted center mt12">Connected to ${esc(API.base)} · <a class="acc" data-act="disconnectServer">use offline demo</a></p>`;
  }

  // ---------- Home ----------
  VIEWS.home = function () {
    const u = S.user;
    const up = upcomingBookings()[0];
    const pending = myBookings().find((b) => b.status === 'completed' && !b.rated);
    const nearToday = S.barbers
      .filter((b) => b.city === LOCAL_CITY)
      .map((b) => ({ b, free: nextFree(b) }))
      .filter((x) => x.free)
      .sort((a, c) => a.free.offset - c.free.offset || distanceKm(a.free.place) - distanceKm(c.free.place))
      .slice(0, 8);
    const topBarbers = leaderboard('barbers', 'week', 'local').slice(0, 3);
    const nearPlaces = S.places.filter(isLocal).sort((a, c) => distanceKm(a) - distanceKm(c)).slice(0, 6);
    const drops = [...S.products].sort((a, c) => c.sold - a.sold).slice(0, 8);
    const cartCount = S.cart.reduce((n, i) => n + i.qty, 0);
    const upcomingCount = upcomingBookings().length;
    const hotShorts = trendingShorts().slice(0, 10);
    const hotProfiles = trendingProfiles().slice(0, 8);

    return `
      <header class="topbar">
        <button class="loc" data-act="go" data-to="/explore">${icon('pin', 16)}<span>${esc(u.location.label)}</span></button>
        <div class="row gap8">
          <button class="iconbtn" data-act="go" data-to="/bookings" aria-label="Bookings">${icon('calendar', 18)}${upcomingCount ? `<span class="dot">${upcomingCount}</span>` : ''}</button>
          <button class="pill pts" data-act="go" data-to="/rewards" aria-label="Points">${icon('zap', 14)} ${fmtNum(u.points)}</button>
          <button data-act="go" data-to="/me" aria-label="Profile"><span class="ring">${avatar(u.name || 'You', u.hue, 34)}</span></button>
        </div>
      </header>
      <section class="hero">
        <h1>Fresh cut,<br><span class="grad">${esc(firstName(u.name || 'friend'))}?</span></h1>
        <div class="search">${icon('search', 18)}<input id="q" placeholder="Barbers, shops, creators, #hashtags…" autocomplete="off" aria-label="Search"></div>
        <div id="search-results" class="search-results"></div>
      </section>

      ${up ? upcomingCard(up) : ''}
      ${pending ? `
        <button class="card tap glow mt12 row gap12" data-act="rate" data-id="${pending.id}">
          ${barberAvatar(barberById(pending.barberId), 44)}
          <span class="grow"><b>How was your ${esc(pending.serviceName)}?</b><div class="small muted">Rate ${esc(firstName(barberById(pending.barberId).name))} & ${esc(placeById(pending.placeId).short)} · tip · +${REVIEW_BONUS} pts</div></span>
          <span class="gold" style="font-size:22px">★</span>
        </button>` : ''}

      <div class="quick">
        <button data-act="go" data-to="/ranks"><span class="qi" style="background:rgba(255,200,61,.15);color:var(--gold)">${icon('trophy')}</span>Ranks</button>
        <button data-act="go" data-to="/shop"><span class="qi" style="background:rgba(255,77,109,.15);color:var(--hot)">${icon('bag')}</span>Shop${cartCount ? ` (${cartCount})` : ''}</button>
        <button data-act="go" data-to="/creator"><span class="qi" style="background:rgba(200,255,61,.15);color:var(--acc)">${icon('dollar')}</span>Earn</button>
        <button data-act="go" data-to="/membership"><span class="qi" style="background:rgba(124,92,255,.2);color:#b7a6ff">${icon('crown')}</span>Club</button>
      </div>

      <h2 class="sec">🔥 Trending shorts <a data-act="go" data-to="/feed">Watch all</a></h2>
      <div class="hscroll">${hotShorts.map((sh) => shortTile(sh, { type: 'trending' })).join('')}</div>

      <h2 class="sec">Trending barbers, shops & creators</h2>
      <div class="hscroll">${hotProfiles.map(profileChip).join('')}</div>

      <h2 class="sec">Free soon near you <a data-act="go" data-to="/explore">Map</a></h2>
      <div class="hscroll">${nearToday.map(({ b, free }) => barberMini(b, free)).join('') || '<div class="empty">No open slots this week</div>'}</div>

      <h2 class="sec">Top barbers this week <a data-act="go" data-to="/ranks">All ranks</a></h2>
      <div>${topBarbers.map((row, i) => {
        const b = barberById(row.id);
        return `<button class="listitem" data-act="go" data-to="/barber/${b.id}">
          <span style="width:22px;font-weight:900;color:${['var(--gold)', '#c9d2e6', '#d08a4a'][i]}">#${i + 1}</span>
          ${barberAvatar(b, 44)}
          <span class="grow"><b class="row gap4">${esc(b.name)} ${b.verified ? verifiedBadge : ''}</b><div class="small muted ellip">${esc(b.title)}</div></span>
          <span class="small">${stars(b.rating)}</span>
        </button>`;
      }).join('')}</div>

      <h2 class="sec">Places near you <a data-act="go" data-to="/explore">See all</a></h2>
      <div class="hscroll">${nearPlaces.map(placeMini).join('')}</div>

      <h2 class="sec">Drops from the shops <a data-act="go" data-to="/shop">Shop</a></h2>
      <div class="hscroll">${drops.map((item) => `<div style="width:150px">${productCard(item)}</div>`).join('')}</div>

      <h2 class="sec">Communities <a data-act="go" data-to="/chat">Open</a></h2>
      ${S.threads.filter((t) => t.type === 'group').slice(0, 3).map((t) => communityRow(t)).join('')}
      <div style="height:10px"></div>`;
  };

  function upcomingCard(bk) {
    const b = barberById(bk.barberId);
    const p = placeById(bk.placeId);
    return `
      <div class="upnext">
        <div class="row between"><span class="countdown">${countdownLabel(bk)}</span><span class="badge acc">${bk.payLater > 0 ? `${money(bk.payLater)} due at shop` : 'Paid'}</span></div>
        <div class="row gap12 mt12">
          ${barberAvatar(b, 52)}
          <div class="grow">
            <b style="font-size:17px">${esc(bk.serviceName)}</b>
            <div class="small">with ${esc(b.name)}</div>
            <div class="small muted">${whenLabel(bk)} · ${esc(p.name)}</div>
          </div>
        </div>
        <div class="bk-actions">
          <a class="btn sm" href="${directionsUrl(p)}" target="_blank" rel="noopener">${icon('nav', 16)} Directions</a>
          <button class="btn sm" data-act="dm" data-id="${b.id}">${icon('chat', 16)} Chat</button>
          <button class="btn sm" data-act="go" data-to="/bookings">Manage</button>
        </div>
      </div>`;
  }

  function barberMini(b, free) {
    const feature = b.portfolio[0];
    return `
      <button class="bmini" data-act="go" data-to="/barber/${b.id}">
        <div class="art">${feature.img ? `<img src="${esc(mediaUrl(feature.img))}" alt="" style="width:100%;height:100%;object-fit:cover">` : cutArt(feature.style, feature.hue, { color: feature.color })}${barberAvatar(b, 34)}</div>
        <b class="small row gap4 ellip">${esc(firstName(b.name))} ${b.verified ? verifiedBadge : ''}</b>
        <div class="xs muted ellip">${esc(b.title)}</div>
        ${free ? `<div class="nextfree mt4 ellip">${dayLabel(free.offset)} ${fmtTime(free.t)} · ${esc(free.place.short)}</div>` : ''}
      </button>`;
  }

  function placeMini(p) {
    const today = barbersAtPlaceOn(p.id, dkey(new Date())).length;
    return `
      <button class="pmini" data-act="go" data-to="/place/${p.id}">
        <div class="cover" style="${placeCover(p)}">${tierBadge(p)}</div>
        <div class="body">
          <b class="ellip" style="display:block">${esc(p.name)}</b>
          <div class="xs muted mt4">${stars(p.rating)} · ${distLabel(p)} · ${today} barber${today === 1 ? '' : 's'} today</div>
        </div>
      </button>`;
  }

  function communityRow(t) {
    const last = t.messages[t.messages.length - 1];
    return `
      <button class="listitem" data-act="go" data-to="/thread/${t.id}">
        <span class="thumb" style="background:linear-gradient(135deg,hsl(${t.hue},80%,60%),hsl(${(t.hue + 60) % 360},80%,45%))">${icon('users', 22)}</span>
        <span class="grow"><b class="ellip" style="display:block">${esc(t.title)}</b><div class="xs muted">${compact(t.members)} members${last ? ` · ${esc(ago(last.t))}` : ''}</div></span>
        ${t.joined ? `<span class="badge acc">Joined</span>` : `<span class="badge standard">Join</span>`}
      </button>`;
  }

  function renderSearch(query) {
    const box = $('#search-results');
    if (!box) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      box.innerHTML = '';
      return;
    }
    const term = q.replace(/^[#@]/, '');
    const barbers = S.barbers.filter((b) => [b.name, b.handle, b.title, b.city, ...b.tags].join(' ').toLowerCase().includes(term)).slice(0, 4);
    const places = S.places.filter((pl) => [pl.name, pl.area, pl.city, pl.tier].join(' ').toLowerCase().includes(term)).slice(0, 3);
    const creators = S.creators.filter((c) => [c.name, c.handle].join(' ').toLowerCase().includes(term)).slice(0, 3);
    const tags = {};
    S.shorts.forEach((sh) => {
      (sh.caption.match(/#[\w]+/g) || []).forEach((tag) => {
        const lower = tag.toLowerCase();
        if (lower.includes(term)) tags[lower] = (tags[lower] || 0) + 1;
      });
    });
    const hashtags = Object.entries(tags).sort((a, c) => c[1] - a[1]).slice(0, 3);
    if (!barbers.length && !places.length && !creators.length && !hashtags.length) {
      box.innerHTML = `<div class="empty">No matches for “${esc(query)}”</div>`;
      return;
    }
    box.innerHTML = hashtags.map(([tag, count]) => `
        <button class="listitem" data-act="hashtag" data-tag="${esc(tag)}"><span class="thumb" style="width:40px;height:40px;background:var(--card2);color:var(--acc)">#</span>
          <span class="grow"><b class="small">${esc(tag)}</b><div class="xs muted">${count} short${count > 1 ? 's' : ''}</div></span>${icon('play', 16)}</button>`).join('') +
      barbers.map((b) => `
        <button class="listitem" data-act="go" data-to="/barber/${b.id}">${barberAvatar(b, 40)}
          <span class="grow"><b class="small">${esc(b.name)}</b><div class="xs muted">${esc(b.title)} · ${esc(b.city)}</div></span>${stars(b.rating)}</button>`).join('') +
      places.map((pl) => `
        <button class="listitem" data-act="go" data-to="/place/${pl.id}"><span class="thumb" style="width:40px;height:40px;${placeCover(pl)}"></span>
          <span class="grow"><b class="small">${esc(pl.name)}</b><div class="xs muted">${esc(pl.area)}, ${esc(pl.city)} · ${distLabel(pl)}</div></span>${tierBadge(pl)}</button>`).join('') +
      creators.map((c) => `
        <button class="listitem" data-act="go" data-to="/user/${c.id}">${avatar(c.name, c.hue, 40)}
          <span class="grow"><b class="small">${esc(c.name)}</b><div class="xs muted">@${esc(c.handle)} · ${compact(followersOf('user', c))} followers</div></span><span class="badge acc">Creator</span></button>`).join('');
  }

  function barbersAtPlaceOn(placeId, key) {
    const dow = parseKey(key).getDay();
    return S.barbers.filter((b) => b.schedule.some((s) => s.placeId === placeId && s.dow === dow));
  }

  // ---------- Explore (map + list) ----------
  const EX = { tab: 'places', filter: 'near', sel: null };

  VIEWS.explore = function () {
    const local = S.places.filter((p) => p.city === LOCAL_CITY);
    const filters = EX.tab === 'places'
      ? [['near', 'Nearest'], ['today', 'Open today'], ['luxe', 'Luxe'], ['premium', 'Premium'], ['standard', 'Standard'], ['global', '🌍 Global']]
      : [['near', 'Nearest today'], ['top', 'Top rated'], ['verified', 'Verified'], ['global', '🌍 Global']];
    return `
      ${pageHead('Explore', { noBack: true, right: `<button class="iconbtn" data-act="locate" title="Use my location">${icon('nav', 18)}</button>` })}
      ${mapHTML(local)}
      <div class="seg mt12">
        <button class="${EX.tab === 'places' ? 'on' : ''}" data-act="exTab" data-v="places">Places</button>
        <button class="${EX.tab === 'barbers' ? 'on' : ''}" data-act="exTab" data-v="barbers">Barbers near me</button>
      </div>
      <div class="chips mt12">${filters.map(([v, l]) => `<button class="chip ${EX.filter === v ? 'on' : ''}" data-act="exFilter" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="mt12">${EX.tab === 'places' ? explorePlaces() : exploreBarbers()}</div>`;
  };

  function mapHTML(places) {
    const pts = places.map((p) => ({ lat: p.lat, lng: p.lng }));
    const me = S.user.location;
    const meLocal = places.some((p) => km(me, p) < 60);
    if (meLocal) pts.push(me);
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const pad = 0.012;
    const minLat = Math.min(...lats) - pad;
    const maxLat = Math.max(...lats) + pad;
    const minLng = Math.min(...lngs) - pad;
    const maxLng = Math.max(...lngs) + pad;
    const x = (lng) => ((lng - minLng) / (maxLng - minLng)) * 84 + 8;
    const y = (lat) => ((maxLat - lat) / (maxLat - minLat)) * 76 + 16;
    const streets = Array.from({ length: 9 }, (_, i) => {
      const k = hash('st' + i);
      return `<path d="M${-10} ${(k % 100)} Q ${50 + (k % 40) - 20} ${(k >> 3) % 100} 110 ${(k >> 7) % 100}" stroke="#1e2030" stroke-width="${1 + (i % 3)}" fill="none"/>`;
    }).join('');
    const placed = [];
    const positions = places.map((p) => {
      const pos = { left: x(p.lng), top: y(p.lat) };
      let guard = 0;
      while (placed.some((q) => Math.abs(q.left - pos.left) < 22 && Math.abs(q.top - pos.top) < 9) && guard < 12) {
        pos.top += 9;
        guard += 1;
      }
      pos.top = Math.min(pos.top, 90);
      placed.push(pos);
      return pos;
    });
    const pins = places.map((p, i) => `
      <button class="pin ${p.tier} ${EX.sel === p.id ? 'sel' : ''}" style="left:${positions[i].left}%;top:${positions[i].top}%" data-act="exSel" data-id="${p.id}">
        <span class="bubble">${p.tier === 'luxe' ? '✦' : ''}${esc(p.short)} · ${p.fee}%</span><span class="stem"></span>
      </button>`).join('');
    const meDot = meLocal ? `<span class="me-dot" style="left:${x(me.lng)}%;top:${y(me.lat)}%"></span>` : '';
    const sel = EX.sel ? placeById(EX.sel) : null;
    return `
      <div class="map">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect width="100" height="100" fill="#0f1016"/>
          <path d="M0 8 Q30 2 60 10 T100 6 L100 0 L0 0Z" fill="#0d1a2b"/>
          ${streets}
          <path d="M0 55 Q40 45 100 62" stroke="#252a40" stroke-width="3" fill="none"/>
          <path d="M45 0 Q52 50 40 100" stroke="#252a40" stroke-width="3" fill="none"/>
        </svg>
        ${pins}${meDot}
        <div class="map-ctrl"><span class="pill xs">${esc(LOCAL_CITY)} · ${places.length} places</span></div>
      </div>
      ${sel ? `
        <div class="card mt8 row gap12">
          <span class="thumb" style="${placeCover(sel)}"></span>
          <div class="grow"><b>${esc(sel.name)}</b><div class="xs muted">${tierBadge(sel)} · ${distLabel(sel)} · facility fee ${sel.fee}%</div>
          <div class="xs muted mt4">Today: ${barbersAtPlaceOn(sel.id, dkey(new Date())).map((b) => esc(firstName(b.name))).join(', ') || 'no barbers scheduled'}</div></div>
          <button class="btn sm primary" data-act="go" data-to="/place/${sel.id}">Open</button>
        </div>` : ''}`;
  }

  function explorePlaces() {
    let list = [...S.places];
    const todayKey = dkey(new Date());
    if (EX.filter === 'global') {
      list = list.filter((p) => !isLocal(p));
    } else {
      list = list.filter(isLocal);
    }
    if (['luxe', 'premium', 'standard'].includes(EX.filter)) list = list.filter((p) => p.tier === EX.filter);
    if (EX.filter === 'today') list = list.filter((p) => barbersAtPlaceOn(p.id, todayKey).length > 0);
    list.sort((a, c) => distanceKm(a) - distanceKm(c));
    if (!list.length) return `<div class="empty">Nothing here yet</div>`;
    return list.map((p) => {
      const today = barbersAtPlaceOn(p.id, todayKey);
      return `
        <button class="listitem" data-act="go" data-to="/place/${p.id}">
          <span class="thumb" style="${placeCover(p)}"></span>
          <span class="grow">
            <span class="row gap6"><b class="ellip">${esc(p.name)}</b>${tierBadge(p)}</span>
            <div class="xs muted mt4">${stars(p.rating)} (${compact(p.reviews)}) · ${distLabel(p)} · ${p.fee}% facility fee</div>
            <div class="xs mt4" style="color:var(--acc)">${today.length ? `${today.length} barber${today.length > 1 ? 's' : ''} today: ${today.slice(0, 3).map((b) => esc(firstName(b.name))).join(', ')}` : '<span class="muted">No barbers today</span>'}</div>
          </span>
        </button>`;
    }).join('');
  }

  function exploreBarbers() {
    let list = S.barbers.map((b) => {
      const nf = nextFree(b);
      const todayShifts = shiftsOn(b, dkey(new Date()));
      const nearestToday = todayShifts.map((s) => placeById(s.placeId)).sort((a, c) => distanceKm(a) - distanceKm(c))[0];
      const ns = nextShift(b, 0);
      const refPlace = nearestToday || (ns && placeById(ns.shift.placeId)) || placeById(b.schedule[0].placeId);
      return { b, nf, nearestToday, ns, refPlace, dist: distanceKm(refPlace) };
    });
    if (EX.filter === 'global') {
      list = list.filter((x) => x.dist > 150);
    } else {
      list = list.filter((x) => x.dist <= 150);
    }
    if (EX.filter === 'verified') list = list.filter((x) => x.b.verified);
    if (EX.filter === 'top') {
      list.sort((a, c) => c.b.rating - a.b.rating);
    } else {
      list.sort((a, c) => (a.nearestToday ? 0 : 1) - (c.nearestToday ? 0 : 1) || a.dist - c.dist);
    }
    if (!list.length) return `<div class="empty">No barbers match</div>`;
    return list.map(({ b, nf, nearestToday, ns, refPlace }) => {
      const where = nearestToday
        ? `<span class="acc">Today @ ${esc(nearestToday.short)}</span> · ${distLabel(nearestToday)}`
        : ns ? `Next: ${dayLabel(ns.offset)} @ ${esc(placeById(ns.shift.placeId).short)} · ${distLabel(refPlace)}` : 'No upcoming shifts';
      const placesCount = new Set(b.schedule.map((s) => s.placeId)).size;
      return `
        <button class="listitem" data-act="go" data-to="/barber/${b.id}">
          ${barberAvatar(b, 52)}
          <span class="grow">
            <b class="row gap4">${esc(b.name)} ${b.verified ? verifiedBadge : ''}</b>
            <div class="xs muted ellip">${esc(b.title)} · ${stars(b.rating)}</div>
            <div class="xs mt4">${where}</div>
            ${placesCount > 1 ? `<div class="xs muted mt4">${icon('pin', 11)} Works at ${placesCount} places</div>` : ''}
          </span>
          ${nf ? `<span class="badge acc">${fmtTime(nf.t).replace(':00', '')}</span>` : ''}
        </button>`;
    }).join('');
  }

  // ---------- Barber profile ----------
  let BTAB = 'portfolio';
  let lastBarberId = null;

  VIEWS.barber = function (id) {
    const b = barberById(id);
    if (!b) return `${pageHead('Not found')}<div class="empty">Barber not found</div>`;
    if (lastBarberId !== id) {
      BTAB = 'portfolio';
      lastBarberId = id;
    }
    const following = isFollowing('barber', b.id);
    const rank = leaderboard('barbers', 'week', 'global').findIndex((r) => r.id === b.id) + 1;
    const placesCount = new Set(b.schedule.map((s) => s.placeId)).size;
    const minPrice = Math.min(...b.services.map((s) => s.price));
    const feature = b.portfolio[0] || { style: 'fade', hue: b.hue };
    const tabs = [['portfolio', 'Portfolio'], ['shorts', 'Shorts'], ['schedule', 'Schedule'], ['services', 'Services'], ['reviews', 'Reviews'], ['shop', 'Shop']];
    return `
      <div class="cover">
        <div class="art-bg">${feature.img ? `<img src="${esc(mediaUrl(feature.img))}" alt="" style="width:100%;height:100%;object-fit:cover;filter:blur(2px) brightness(.6)">` : cutArt(feature.style, feature.hue)}</div>
        <div class="cover-top">
          <button class="iconbtn" data-act="back">${icon('back')}</button>
          <button class="iconbtn" data-act="share" data-path="/barber/${b.id}" data-title="${esc(b.name)} on Fade">${icon('share', 18)}</button>
        </div>
      </div>
      <div class="prof">
        <div class="row between" style="align-items:flex-end">
          <span class="ring">${barberAvatar(b, 84)}</span>
          <div class="row gap8">
            <button class="btn sm" data-act="dm" data-id="${b.id}" aria-label="Message ${esc(b.name)}">${icon('chat', 16)}</button>
            <button class="btn sm ${following ? '' : 'violet'}" data-act="follow" data-type="barber" data-id="${b.id}">${following ? 'Following' : 'Follow'}</button>
          </div>
        </div>
        <h1 class="mt12">${esc(b.name)} ${b.verified ? verifiedBadge : ''}</h1>
        <div class="small muted">@${esc(b.handle)} · ${esc(b.title)} · ${esc(b.city)}</div>
        <p class="small mt8" style="line-height:1.5">${esc(b.bio)}</p>
        <div class="row gap6 wrap mt8">${b.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}<span class="tag">🗣 ${b.langs.join(' · ')}</span></div>
        <div class="statrow">
          <div class="stat"><b>${stars(b.rating).replace(/<span class="gold">★<\/span> /, '')}</b><span>${compact(b.reviews)} reviews</span></div>
          <div class="stat"><b>${compact(followersOf('barber', b))}</b><span>followers</span></div>
          <div class="stat"><b>#${rank}</b><span>this week</span></div>
          <div class="stat"><b>${placesCount}</b><span>place${placesCount > 1 ? 's' : ''}</span></div>
        </div>
        <div class="tabs">${tabs.map(([v, l]) => `<button class="${BTAB === v ? 'on' : ''}" data-act="btab" data-v="${v}">${l}</button>`).join('')}</div>
        <div>${barberTab(b)}</div>
      </div>
      <div class="sticky-cta">
        <button class="btn primary block" data-act="book" data-id="${b.id}">${icon('calendar', 18)} Book · from ${money(minPrice)}</button>
      </div>`;
  };

  function barberTab(b) {
    if (BTAB === 'portfolio') {
      if (!b.portfolio.length) return `<div class="empty">No portfolio yet</div>`;
      return `<div class="grid3">${b.portfolio.map((p) => `<button data-act="bookStyle" data-id="${b.id}" data-pf="${p.id}" style="text-align:left">${tile(p)}</button>`).join('')}</div>
        <p class="xs muted mt8 center">Tap a cut to book it as your reference</p>`;
    }
    if (BTAB === 'shorts') {
      return shortsGrid(shortsAbout('barber', b.id), { type: 'barber', id: b.id }, `No shorts yet. Tag @${esc(b.handle)} in your next short ✂️`);
    }
    if (BTAB === 'schedule') {
      const days = Array.from({ length: 7 }, (_, i) => i);
      const nearestId = b.schedule.map((s) => placeById(s.placeId)).sort((a, c) => distanceKm(a) - distanceKm(c))[0].id;
      const placesUsed = [...new Set(b.schedule.map((s) => s.placeId))].map(placeById);
      return `
        <div class="card small" style="line-height:1.5">
          <b>${esc(firstName(b.name))} works at ${placesUsed.length} place${placesUsed.length > 1 ? 's' : ''}</b> — pick the day that's closest to you.
          <div class="row gap6 wrap mt8">${placesUsed.map((p) => `<button class="tag" data-act="go" data-to="/place/${p.id}">${icon('pin', 10)} ${esc(p.short)} · ${distLabel(p)}${p.id === nearestId ? ' · closest' : ''}</button>`).join('')}</div>
        </div>
        <div class="mt12">${days.map((i) => {
          const key = dkey(addDays(TODAY, i));
          const d = parseKey(key);
          const shifts = shiftsOn(b, key);
          if (!shifts.length) {
            return `<div class="shift" style="opacity:.45"><div class="when"><span>${dayLabel(i).slice(0, 3)}</span><b>${d.getDate()}</b></div><div class="grow muted small">Day off</div></div>`;
          }
          return shifts.map((s, j) => {
            const p = placeById(s.placeId);
            return `
              <div class="shift ${i === 0 ? 'today' : ''}">
                <div class="when">${j === 0 ? `<span>${dayLabel(i).slice(0, 3)}</span><b>${d.getDate()}</b>` : ''}</div>
                <div class="grow">
                  <b class="small">${esc(p.name)}</b> ${p.id === nearestId ? '<span class="badge acc">Closest</span>' : ''}
                  <div class="xs muted mt4">${fmtHours(s.from, s.to)}${tzNote(p)} · ${esc(p.area)} · ${distLabel(p)} · ${tierBadge(p)}</div>
                </div>
                <button class="btn xs primary" data-act="book" data-id="${b.id}" data-date="${key}">Book</button>
              </div>`;
          }).join('');
        }).join('')}</div>`;
    }
    if (BTAB === 'services') {
      return b.services.map((s) => `
        <div class="svc">
          <div><b>${esc(s.name)}</b><div class="small muted">${s.mins} min</div></div>
          <div class="row gap10"><b>${money(s.price)}</b><button class="btn xs primary" data-act="book" data-id="${b.id}" data-svc="${s.id}">Book</button></div>
        </div>`).join('') +
        `<p class="xs muted mt12">Shop facility fee (3–10%) depends on the place you choose and is shown before you pay.</p>`;
    }
    if (BTAB === 'reviews') {
      const mine = S.bookings.filter((bk) => bk.barberId === b.id && bk.rated && bk.review);
      const generated = Array.from({ length: 5 }, (_, i) => {
        const h = hash(b.id + i);
        return {
          name: SEED.names[h % SEED.names.length],
          text: SEED.reviewPool[(h >> 4) % SEED.reviewPool.length],
          r: (h % 7) === 0 ? 4 : 5,
          days: 1 + (h % 40),
          tip: (h >> 2) % 3 === 0,
        };
      });
      return `
        <div class="card row gap16">
          <div class="center"><div style="font-size:38px;font-weight:900">${b.rating.toFixed(2)}</div><div class="gold">★★★★★</div><div class="xs muted">${compact(b.reviews)} reviews</div></div>
          <div class="grow">${[5, 4, 3, 2, 1].map((n) => {
            const pct = n === 5 ? 88 : n === 4 ? 9 : n === 3 ? 2 : 1;
            return `<div class="row gap8 xs"><span style="width:8px">${n}</span><div class="bar grow"><span style="width:${pct}%;background:var(--gold)"></span></div></div>`;
          }).join('')}</div>
        </div>
        <div class="mt12">
          ${mine.map((bk) => reviewHTML(`${S.user.name} (you)`, S.user.hue, bk.rB, bk.review, offsetOf(bk.date) * -1, bk.tip > 0)).join('')}
          ${generated.map((r) => reviewHTML(r.name, hash(r.name) % 360, r.r, r.text, r.days, r.tip)).join('')}
        </div>`;
    }
    const prods = S.products.filter((p) => p.sellerType === 'barber' && p.sellerId === b.id);
    if (!prods.length) return `<div class="empty">${esc(firstName(b.name))} hasn't opened a shop yet</div>`;
    return `<div class="grid2">${prods.map(productCard).join('')}</div>`;
  }

  function reviewHTML(name, hue, rating, text, daysAgo, tipped) {
    return `
      <div class="review">
        <div class="row gap10">${avatar(name, hue, 32)}<div class="grow"><b class="small">${esc(name)}</b><div class="xs muted">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} · ${daysAgo <= 0 ? 'today' : daysAgo + 'd ago'}</div></div>${tipped ? '<span class="badge gold">Tipped</span>' : ''}</div>
        <p class="small mt8" style="line-height:1.45">${esc(text)}</p>
      </div>`;
  }

  // ---------- Place profile ----------
  VIEWS.place = function (id) {
    const p = placeById(id);
    if (!p) return `${pageHead('Not found')}<div class="empty">Place not found</div>`;
    const todayKey = dkey(new Date());
    const todayBarbers = barbersAtPlaceOn(p.id, todayKey);
    const prods = S.products.filter((x) => x.placeId === p.id);
    const allBarbers = S.barbers.filter((b) => b.schedule.some((s) => s.placeId === p.id));
    const rank = leaderboard('places', 'week', 'global').findIndex((r) => r.id === p.id) + 1;
    const group = S.threads.find((t) => t.placeId === p.id);
    return `
      <div class="cover" style="${placeCover(p)};height:190px">
        <div class="cover-top">
          <button class="iconbtn" data-act="back">${icon('back')}</button>
          <button class="iconbtn" data-act="share" data-path="/place/${p.id}" data-title="${esc(p.name)}">${icon('share', 18)}</button>
        </div>
      </div>
      <div class="prof" style="margin-top:-30px">
        ${tierBadge(p)}
        <h1 class="mt8">${esc(p.name)}</h1>
        <div class="small muted">${esc(p.area)}, ${esc(p.city)} · ${distLabel(p)} · ${esc(p.hours)}</div>
        <div class="statrow">
          <div class="stat"><b>${p.rating}</b><span>${compact(p.reviews)} reviews</span></div>
          <div class="stat"><b>${p.fee}%</b><span>facility fee</span></div>
          <div class="stat"><b>#${rank}</b><span>this week</span></div>
          <div class="stat"><b>${compact(followersOf('place', p))}</b><span>followers</span></div>
        </div>
        <div class="row gap6 wrap mt12">${p.amenities.map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>
        <div class="row gap8 mt12">
          <button class="btn sm ${isFollowing('place', p.id) ? '' : 'violet'}" data-act="follow" data-type="place" data-id="${p.id}">${isFollowing('place', p.id) ? 'Following' : 'Follow'}</button>
          <a class="btn sm grow" href="${directionsUrl(p)}" target="_blank" rel="noopener">${icon('nav', 16)} Directions</a>
          ${group ? `<button class="btn sm grow" data-act="go" data-to="/thread/${group.id}">${icon('users', 16)} Community</button>` : ''}
        </div>

        <h2 class="sec">Cutting today</h2>
        ${todayBarbers.length ? todayBarbers.map((b) => {
          const s = shiftsOn(b, todayKey).find((x) => x.placeId === p.id);
          return `<div class="listitem">${barberAvatar(b, 44)}
            <button class="grow" style="text-align:left" data-act="go" data-to="/barber/${b.id}"><b class="small row gap4">${esc(b.name)} ${b.verified ? verifiedBadge : ''}</b><div class="xs muted">${fmtHours(s.from, s.to)} · ${stars(b.rating)}</div></button>
            <button class="btn xs primary" data-act="book" data-id="${b.id}" data-date="${todayKey}">Book</button></div>`;
        }).join('') : `<div class="empty">No barbers scheduled today</div>`}

        ${shortsAbout('place', p.id).length ? `<h2 class="sec">Shorts</h2>${shortsGrid(shortsAbout('place', p.id), { type: 'place', id: p.id }, '')}` : ''}

        <h2 class="sec">Weekly chair roster</h2>
        <div class="card">${DOW_ORDER.map((dow) => {
          const here = allBarbers.filter((b) => b.schedule.some((s) => s.placeId === p.id && s.dow === dow));
          return `<div class="roster"><b class="small">${DOW[dow]}</b><div class="row gap4 wrap">${here.length ? here.map((b) => `<button data-act="go" data-to="/barber/${b.id}" title="${esc(b.name)}">${barberAvatar(b, 26)}</button>`).join('') : '<span class="xs muted">—</span>'}<span class="xs muted" style="margin-left:auto">${here.length}/${p.chairs}</span></div></div>`;
        }).join('')}</div>

        <h2 class="sec">Pricing here</h2>
        <div class="card small" style="line-height:1.55">
          Barbers set their own prices. ${esc(p.name)} adds a <b>${p.fee}% facility fee</b> (${TIERS[p.tier].label} tier) for the space, products and amenities. Barbers pay the shop <b>${money(p.rent)}/day</b> chair rent, so the facility fee stays small.
        </div>

        ${prods.length ? `<h2 class="sec">Shop at ${esc(p.short)}</h2><div class="grid2">${prods.map(productCard).join('')}</div>` : ''}
        <div style="height:20px"></div>
      </div>`;
  };

  // ---------- Booking sheet ----------
  let BK = null;

  function openBooking(barberId, opts = {}) {
    const b = barberById(barberId);
    const firstFree = nextFree(b);
    BK = {
      barberId,
      serviceId: opts.serviceId || b.services[0].id,
      date: opts.date || (firstFree ? firstFree.key : dkey(TODAY)),
      time: null,
      placeId: null,
      payMode: 'deposit',
      usePoints: false,
      method: S.user.method,
      step: 1,
      styleRef: opts.styleRef || null,
      rescheduleId: opts.rescheduleId || null,
      refShortId: opts.refShortId || activeRef(),
    };
    openSheet(bookingHTML());
    ensureLiveSlots();
  }

  // Server mode: refresh the selected day's availability from the server.
  function ensureLiveSlots() {
    if (!API.on || !BK || BK.step !== 1) return;
    const b = barberById(BK.barberId);
    const svc = b.services.find((s) => s.id === BK.serviceId);
    const key = BK.date;
    fetchSlots(b, key, svc.mins).then((fresh) => {
      if (fresh && BK && BK.step === 1 && BK.date === key) setSheet(bookingHTML());
    });
  }

  function bookingHTML() {
    const b = barberById(BK.barberId);
    const svc = b.services.find((s) => s.id === BK.serviceId);
    const ref = BK.styleRef ? b.portfolio.find((p) => p.id === BK.styleRef) : null;

    if (BK.step === 1) {
      const groups = slotsFor(b, BK.date, svc.mins);
      const days = Array.from({ length: 14 }, (_, i) => i);
      return `
        <div class="sheet-head">${barberAvatar(b, 44)}
          <div class="grow"><h2>${BK.rescheduleId ? 'Reschedule' : 'Book'} ${esc(firstName(b.name))}</h2><div class="small muted">${esc(b.title)}</div></div>
          <button class="iconbtn" data-act="closeSheet">${icon('x')}</button>
        </div>
        ${ref ? `<div class="card row gap12 mt12"><div style="width:52px">${tile(ref, { tag: false, likes: false })}</div><div class="grow small"><b>Reference cut</b><div class="muted">${esc(ref.title)} — attached to your booking</div></div></div>` : ''}
        <div class="label">Service</div>
        ${b.services.map((s) => `
          <button class="svc ${s.id === BK.serviceId ? 'on' : ''}" data-act="bkService" data-id="${s.id}" ${BK.rescheduleId ? 'disabled' : ''}>
            <div><b>${esc(s.name)}</b><div class="small muted">${s.mins} min</div></div><b>${money(s.price)}</b>
          </button>`).join('')}
        <div class="label">Day — and where ${esc(firstName(b.name))} is that day</div>
        <div class="hscroll">${days.map((i) => {
          const key = dkey(addDays(TODAY, i));
          const shifts = shiftsOn(b, key);
          const d = parseKey(key);
          const where = shifts.length === 0 ? 'Off' : shifts.length === 1 ? placeById(shifts[0].placeId).short : `${shifts.length} spots`;
          return `<button class="day ${key === BK.date ? 'on' : ''} ${shifts.length ? '' : 'off'}" data-act="bkDate" data-k="${key}" ${shifts.length ? '' : 'disabled'}>
            <span>${i === 0 ? 'Today' : DOW[d.getDay()]}</span><b>${d.getDate()}</b><em>${esc(where)}</em></button>`;
        }).join('')}</div>
        ${groups.length ? groups.map((g) => `
          <div class="placestrip">
            <span class="thumb" style="width:44px;height:44px;${placeCover(g.place)}"></span>
            <div class="grow"><b class="small">${esc(g.place.name)}</b> ${tierBadge(g.place)}
              <div class="xs muted mt4">${fmtHours(g.shift.from, g.shift.to)}${tzNote(g.place)} · ${distLabel(g.place)} · ${g.place.fee}% facility fee</div>
              ${API.on ? `<div class="xs mt4 ${g.live ? 'ok' : 'muted'}">${g.live ? '● Live availability' : 'Checking live availability…'}</div>` : ''}</div>
          </div>
          <div class="times">${g.slots.map((s) => `
            <button class="time ${BK.time === s.t && BK.placeId === g.place.id ? 'on' : ''}" data-act="bkTime" data-t="${s.t}" data-p="${g.place.id}" ${s.taken ? 'disabled' : ''}>${fmtTime(s.t).replace(' ', '')}</button>`).join('')}
          </div>
          ${g.slots.every((s) => s.taken) ? `<div class="xs muted mt8">Fully booked here — try another day.</div>` : ''}`).join('') : `<div class="empty">Day off</div>`}
        <button class="btn primary block mt20" data-act="bkNext" ${BK.time == null ? 'disabled' : ''}>
          ${BK.time == null ? 'Pick a time' : `${fmtTime(BK.time)} at ${esc(placeById(BK.placeId).short)} · Continue`}
        </button>`;
    }

    if (BK.step === 2) {
      const place = placeById(BK.placeId);
      if (BK.rescheduleId) {
        const old = S.bookings.find((x) => x.id === BK.rescheduleId);
        return `
          <div class="sheet-head"><button class="iconbtn" data-act="bkBack">${icon('back')}</button><h2 class="grow">Confirm reschedule</h2></div>
          <div class="card mt12 small" style="line-height:1.6">
            <div class="muted strike">${whenLabel(old)} · ${esc(placeById(old.placeId).name)}</div>
            <b>${fmtDate(BK.date)} · ${fmtTime(BK.time)} · ${esc(place.name)}</b>
            ${old.placeId !== place.id ? `<div class="xs muted mt8">Facility fee changes to ${place.fee}%. Any difference is settled at the shop.</div>` : ''}
          </div>
          <button class="btn primary block mt20" data-act="bkConfirm">${icon('check', 18)} Move my booking — free</button>`;
      }
      const q = quote({ price: svc.price, place, plan: S.user.plan, payMode: BK.payMode, usePoints: BK.usePoints, points: S.user.points });
      const earn = pointsEarned(q.dueNow, S.user.plan, BK.payMode === 'full');
      const sum = q.toBarber + q.toPlace + q.toPlatform || 1;
      const plan = planOf(S.user.plan);
      const clubSave = plan.id === 'free' ? round2(svc.price * PLANS[1].disc / 100 + BOOKING_FEE) : 0;
      return `
        <div class="sheet-head"><button class="iconbtn" data-act="bkBack">${icon('back')}</button><h2 class="grow">Checkout</h2></div>
        <div class="card row gap12 mt12">
          ${barberAvatar(b, 48)}
          <div class="grow"><b>${esc(svc.name)}</b><div class="small muted">${esc(b.name)} · ${svc.mins} min</div>
          <div class="small">${fmtDate(BK.date)} · ${fmtTime(BK.time)}</div><div class="xs muted">${esc(place.name)}, ${esc(place.area)}</div></div>
        </div>
        <div class="label">Pay now</div>
        <div class="seg">
          <button class="${BK.payMode === 'deposit' ? 'on' : ''}" data-act="bkPay" data-mode="deposit">Deposit ${money(q.deposit)}</button>
          <button class="${BK.payMode === 'full' ? 'on' : ''}" data-act="bkPay" data-mode="full">Full · +${FULL_PAY_BONUS} pts</button>
        </div>
        ${S.user.points >= 100 ? `
          <label class="toggle-row"><span class="small"><b>Use points</b><div class="xs muted">${fmtNum(S.user.points)} pts available · 100 pts = $1</div></span>
          <span class="switch"><input type="checkbox" data-act="bkPoints" ${BK.usePoints ? 'checked' : ''}><span></span></span></label>` : ''}
        <div class="label">Payment method</div>
        ${paymentMethodsHTML(BK.method, 'bkMethod')}
        <div class="label">Breakdown</div>
        <div class="card breakdown">
          <div class="ln"><span>${esc(svc.name)}</span><span>${money(q.price)}</span></div>
          ${q.discount ? `<div class="ln acc"><span>${plan.name} −${plan.disc}%</span><span>−${money(q.discount)}</span></div>` : ''}
          <div class="ln"><span>Facility fee · ${esc(place.short)} ${TIERS[place.tier].label} ${q.facilityPct}%</span><span>${money(q.facility)}</span></div>
          <div class="ln"><span>Booking fee</span><span>${q.bookingFee ? money(q.bookingFee) : '<span class="acc">Waived</span>'}</span></div>
          ${q.pointsValue ? `<div class="ln acc"><span>Points (${fmtNum(q.pointsUsed)})</span><span>−${money(q.pointsValue)}</span></div>` : ''}
          <div class="ln total"><span>Total</span><span>${money(q.total)}</span></div>
          <div class="ln"><b>Due now</b><b>${money(q.dueNow)}</b></div>
          ${q.payLater ? `<div class="ln muted"><span>Pay at the shop</span><span>${money(q.payLater)}</span></div>` : ''}
          <div class="split">
            <span style="width:${(q.toBarber / sum) * 100}%;background:var(--acc)"></span>
            <span style="width:${(q.toPlace / sum) * 100}%;background:var(--acc2)"></span>
            <span style="width:${(q.toPlatform / sum) * 100}%;background:var(--hot)"></span>
          </div>
          <div class="legend"><span><i style="background:var(--acc)"></i>Barber ${money(q.toBarber)}</span><span><i style="background:var(--acc2)"></i>${esc(place.short)} ${money(q.toPlace)}</span><span><i style="background:var(--hot)"></i>Fade ${money(q.toPlatform)}</span></div>
        </div>
        ${clubSave > 0 ? `<button class="card tap mt12 row gap10" data-act="go" data-to="/membership"><span class="acc">${icon('crown')}</span><span class="grow small">Fade Club would save you <b class="acc">${money(clubSave)}</b> on this cut + 2× points</span>${icon('chev', 16)}</button>` : ''}
        ${refNoteHTML(BK.refShortId, b.id, place.id)}
        <p class="xs muted mt12">Free cancellation up to ${CANCEL_FREE_HOURS}h before. You'll earn <b class="acc">+${fmtNum(earn)} pts</b>.</p>
        <button class="btn primary block mt12" data-act="bkConfirm">${icon('zap', 18)} Pay ${money(q.dueNow)} & book</button>`;
    }

    const bk = S.bookings.find((x) => x.id === BK.resultId);
    const place = placeById(bk.placeId);
    return `
      <div class="success">
        <div class="big">${icon('check', 44, 'stroke-width="3"')}</div>
        <h2 style="font-size:26px;font-weight:900">${BK.rescheduleId ? 'Moved!' : "You're booked!"}</h2>
        <p class="muted mt8">${esc(bk.serviceName)} with ${esc(b.name)}<br>${whenLabel(bk)} · ${esc(place.name)}</p>
        ${BK.earned ? `<div class="pill pts mt16" style="display:inline-flex">${icon('zap', 14)} +${fmtNum(BK.earned)} points</div>` : ''}
        <div class="row gap8 mt20">
          <button class="btn grow" data-act="ics" data-id="${bk.id}">${icon('calendar', 16)} Calendar</button>
          <button class="btn grow" data-act="dm" data-id="${b.id}">${icon('chat', 16)} Message</button>
        </div>
        <button class="btn violet block mt8" data-act="share" data-path="/barber/${b.id}" data-title="I just booked ${esc(b.name)} on Fade">${icon('share', 16)} Share & get 500 pts per friend</button>
        <button class="btn ghost block mt8" data-act="closeSheet">Done</button>
      </div>`;
  }

  async function confirmBooking() {
    const b = barberById(BK.barberId);
    const svc = b.services.find((s) => s.id === BK.serviceId);
    const place = placeById(BK.placeId);
    const ref = BK.styleRef ? b.portfolio.find((item) => item.id === BK.styleRef) : null;

    if (API.on) {
      const button = document.querySelector('[data-act="bkConfirm"]');
      if (button) button.disabled = true;
      try {
        if (BK.rescheduleId) {
          await API.req('POST', `/api/bookings/${BK.rescheduleId}/reschedule`, { date: BK.date, time: BK.time, placeId: BK.placeId });
          BK.resultId = BK.rescheduleId;
          BK.earned = 0;
        } else {
          const result = await API.req('POST', '/api/bookings', {
            barberId: b.id, serviceId: svc.id, date: BK.date, time: BK.time, placeId: place.id,
            payMode: BK.payMode, usePoints: BK.usePoints, method: BK.method, refShortId: BK.refShortId,
            notes: ref ? `Reference: ${ref.title}` : '', style: ref ? ref.style : '',
          });
          BK.resultId = result.booking.id;
          BK.earned = result.earned;
        }
        clearSlotCache();
        await pull();
        BK.step = 3;
        setSheet(bookingHTML());
        if (!BK.rescheduleId) confetti();
        refresh();
      } catch (err) {
        toast(err.message);
        if (err.status === 409) {
          clearSlotCache();
          BK.step = 1;
          BK.time = null;
          setSheet(bookingHTML());
          ensureLiveSlots();
        } else if (button) {
          button.disabled = false;
        }
      }
      return;
    }

    // Local: re-check the slot right before taking payment.
    const stillFree = slotsFor(b, BK.date, svc.mins)
      .some((g) => g.place.id === BK.placeId && g.slots.some((s) => s.t === BK.time && !s.taken));
    if (!stillFree) {
      toast('That slot is no longer available — pick another time');
      BK.step = 1;
      BK.time = null;
      setSheet(bookingHTML());
      return;
    }

    if (BK.rescheduleId) {
      const moved = S.bookings.find((x) => x.id === BK.rescheduleId);
      moved.date = BK.date;
      moved.time = BK.time;
      moved.placeId = BK.placeId;
      save();
      BK.resultId = moved.id;
      BK.earned = 0;
      BK.step = 3;
      setSheet(bookingHTML());
      return;
    }

    const q = quote({ price: svc.price, place, plan: S.user.plan, payMode: BK.payMode, usePoints: BK.usePoints, points: S.user.points });
    if (!charge(q.dueNow, BK.method, `Booking · ${b.name}`)) return;
    S.user.method = BK.method;
    S.user.points -= q.pointsUsed;
    const earned = pointsEarned(q.dueNow, S.user.plan, BK.payMode === 'full');
    addPoints(earned);
    const bk = {
      id: uid('bk'), userId: 'me', barberId: b.id, placeId: place.id, serviceId: svc.id, serviceName: svc.name,
      mins: svc.mins, date: BK.date, time: BK.time, status: 'upcoming', quote: q, paidNow: q.dueNow,
      payLater: q.payLater, method: BK.method, rated: false, tip: 0,
      notes: ref ? `Reference: ${ref.title}` : '',
      style: ref ? ref.style : (b.portfolio[0] || {}).style || 'fade',
      refShortId: BK.refShortId || null, createdAt: Date.now(),
    };
    S.bookings.unshift(bk);
    const short = bk.refShortId ? S.shorts.find((sh) => sh.id === bk.refShortId) : null;
    if (short && !isMyShort(short) && short.authorType === 'user' && approvedTagFor(short, b.id, place.id)) {
      short.conversions = (short.conversions || 0) + 1;
    }
    S.boosts[b.id] = boostOf(b.id) + 10;
    S.boosts[place.id] = boostOf(place.id) + 5;
    save();
    BK.resultId = bk.id;
    BK.earned = earned;
    BK.step = 3;
    setSheet(bookingHTML());
    confetti();
    refresh();
  }

  // ---------- Rating + tip sheet ----------
  let RT = null;

  function openRate(id) {
    RT = { id, rB: 5, rP: 5, tipPct: 15, custom: null, text: '', method: S.user.method };
    openSheet(rateHTML());
  }

  function tipAmount() {
    const bk = S.bookings.find((x) => x.id === RT.id);
    if (RT.custom != null) return Math.min(MAX_TIP, Math.max(0, round2(RT.custom || 0)));
    return round2(bk.quote.price * RT.tipPct / 100);
  }

  function rateButtonLabel() {
    const tip = tipAmount();
    return tip > 0 ? `Submit & tip ${money(tip)}` : 'Submit review';
  }

  function rateHTML() {
    const bk = S.bookings.find((x) => x.id === RT.id);
    const b = barberById(bk.barberId);
    const p = placeById(bk.placeId);
    const starRow = (who, value) => `<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="${n <= value ? 'on' : ''}" data-act="rtStar" data-who="${who}" data-v="${n}">★</button>`).join('')}</div>`;
    return `
      <div class="sheet-head">${barberAvatar(b, 44)}<div class="grow"><h2>Rate your cut</h2><div class="small muted">${esc(bk.serviceName)} · ${fmtDate(bk.date)}</div></div><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
      <div class="label">${esc(b.name)}</div>${starRow('b', RT.rB)}
      <div class="label">${esc(p.name)} (place)</div>${starRow('p', RT.rP)}
      <div class="label">Tip ${esc(firstName(b.name))} — 100% goes to the barber</div>
      <div class="row gap8 wrap">${[0, 10, 15, 20, 25].map((pct) => `<button class="chip ${RT.custom == null && RT.tipPct === pct ? 'on' : ''}" data-act="rtTip" data-v="${pct}">${pct ? `${pct}% · ${money(bk.quote.price * pct / 100)}` : 'No tip'}</button>`).join('')}</div>
      <div class="field"><label>Custom tip ($)</label><input id="rt-custom" type="number" min="0" step="0.5" inputmode="decimal" placeholder="e.g. 7" value="${RT.custom != null ? RT.custom : ''}"></div>
      <div class="field"><label>Review (optional)</label><textarea id="rt-text" placeholder="What did you love?">${esc(RT.text)}</textarea></div>
      <div class="label">Pay tip with</div>
      ${paymentMethodsHTML(RT.method, 'rtMethod')}
      <p class="xs muted mt12">Ratings feed the weekly leaderboard for both ${esc(firstName(b.name))} and ${esc(p.short)}. +${REVIEW_BONUS} pts for you.</p>
      <button class="btn primary block mt12" id="rt-submit" data-act="rtSubmit">${rateButtonLabel()}</button>`;
  }

  async function submitRating() {
    const bk = S.bookings.find((x) => x.id === RT.id);
    const b = barberById(bk.barberId);
    const tip = tipAmount();
    if (API.on) {
      try {
        const result = await API.req('POST', `/api/bookings/${bk.id}/rate`, {
          rB: RT.rB, rP: RT.rP, tip, review: RT.text.trim(), method: RT.method,
        });
        await pull();
        closeSheet();
        confetti();
        toast(`Thanks! +${result.earned} pts${tip ? ` · ${money(tip)} tip sent` : ''}`);
        refresh();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (tip > 0 && !charge(tip, RT.method, `Tip · ${b.name}`)) return;
    bk.rated = true;
    bk.rB = RT.rB;
    bk.rP = RT.rP;
    bk.tip = round2((bk.tip || 0) + tip);
    bk.review = RT.text.trim();
    const earned = REVIEW_BONUS + Math.floor(tip * 10);
    addPoints(earned);
    S.boosts[bk.barberId] = boostOf(bk.barberId) + RT.rB * 8 + Math.round(tip * 3);
    S.boosts[bk.placeId] = boostOf(bk.placeId) + RT.rP * 8;
    save();
    closeSheet();
    confetti();
    toast(`Thanks! +${earned} pts${tip ? ` · ${money(tip)} tip sent` : ''}`);
    refresh();
  }

  // ---------- Bookings ----------
  let BOOK_TAB = 'upcoming';

  VIEWS.bookings = function () {
    const up = upcomingBookings();
    const past = myBookings().filter((b) => b.status !== 'upcoming').sort((a, c) => c.date.localeCompare(a.date));
    const list = BOOK_TAB === 'upcoming' ? up : past;
    return `
      ${pageHead('Bookings', { noBack: S.role === 'customer', right: `<button class="iconbtn" data-act="go" data-to="/history" title="Cut history">${icon('history', 18)}</button>` })}
      <div class="seg">
        <button class="${BOOK_TAB === 'upcoming' ? 'on' : ''}" data-act="bookTab" data-v="upcoming">Upcoming (${up.length})</button>
        <button class="${BOOK_TAB === 'past' ? 'on' : ''}" data-act="bookTab" data-v="past">Past (${past.length})</button>
      </div>
      <div class="mt12">${list.length ? list.map(bookingCard).join('') : `
        <div class="empty">${BOOK_TAB === 'upcoming' ? 'No upcoming cuts. Time for a fresh one?' : 'No past bookings yet'}</div>
        ${BOOK_TAB === 'upcoming' ? `<button class="btn primary block" data-act="go" data-to="/explore">Find a barber</button>` : ''}`}</div>`;
  };

  function bookingCard(bk) {
    const b = barberById(bk.barberId);
    const p = placeById(bk.placeId);
    const hoursAway = (bookingStart(bk) - new Date()) / 3600000;
    const statusColor = { upcoming: 'acc', completed: 'muted', cancelled: 'hot' }[bk.status];
    let actions = '';
    if (bk.status === 'upcoming') {
      actions = `
        <a class="btn xs" href="${directionsUrl(p)}" target="_blank" rel="noopener">${icon('nav', 14)} Directions</a>
        <button class="btn xs" data-act="dm" data-id="${b.id}">${icon('chat', 14)} Chat</button>
        <button class="btn xs" data-act="ics" data-id="${bk.id}">${icon('calendar', 14)} Calendar</button>
        <button class="btn xs" data-act="reschedule" data-id="${bk.id}">Reschedule</button>
        <button class="btn xs" data-act="cancel" data-id="${bk.id}">Cancel</button>
        ${API.on ? '' : `<button class="btn xs violet" data-act="complete" data-id="${bk.id}" title="Demo: simulate the appointment finishing">Finish now (demo)</button>`}`;
    } else if (bk.status === 'completed') {
      actions = `
        ${bk.rated ? `<span class="small">${'★'.repeat(bk.rB)} <span class="muted">· tip ${money(bk.tip)}</span></span>` : `<button class="btn xs primary" data-act="rate" data-id="${bk.id}">★ Rate & tip</button>`}
        <button class="btn xs" data-act="book" data-id="${b.id}" data-svc="${bk.serviceId}">Rebook</button>`;
    }
    return `
      <div class="bk">
        <div class="row between"><span class="status ${statusColor}">${bk.status}${bk.status === 'upcoming' ? ` · ${countdownLabel(bk)}` : ''}</span><span class="xs muted">${money(bk.quote.total)}${bk.payLater > 0 && bk.status === 'upcoming' ? ` · ${money(bk.payLater)} at shop` : ''}</span></div>
        <button class="row gap12 mt8" style="text-align:left;width:100%" data-act="go" data-to="/barber/${b.id}">
          ${barberAvatar(b, 46)}
          <div class="grow"><b>${esc(bk.serviceName)}</b><div class="small">${esc(b.name)}</div><div class="xs muted">${whenLabel(bk)} · ${esc(p.name)}</div></div>
        </button>
        ${bk.status === 'upcoming' && hoursAway < CANCEL_FREE_HOURS && hoursAway > 0 ? `<div class="xs muted mt8">Inside ${CANCEL_FREE_HOURS}h: cancelling keeps the deposit for the barber.</div>` : ''}
        <div class="bk-actions">${actions}</div>
      </div>`;
  }

  async function cancelBooking(id) {
    const bk = S.bookings.find((x) => x.id === id);
    const hoursAway = (bookingStart(bk) - new Date()) / 3600000;
    const free = hoursAway >= CANCEL_FREE_HOURS || planOf(S.user.plan).id === 'pro';
    const where = bk.method && bk.method !== 'wallet' ? methodLabel(bk.method) : 'your wallet';
    const msg = free
      ? `Cancel and refund ${money(bk.paidNow)} to ${where}?`
      : `Less than ${CANCEL_FREE_HOURS}h away — the ${money(bk.paidNow)} deposit goes to the barber. Cancel anyway?`;
    if (!window.confirm(msg)) return;
    if (API.on) {
      await remoteDo(() => API.req('POST', `/api/bookings/${id}/cancel`), (r) => (r.refunded ? `Cancelled · ${money(r.refunded)} refunded` : 'Cancelled'));
      clearSlotCache();
      return;
    }
    bk.status = 'cancelled';
    if (free) refund(bk.paidNow, bk.method || 'wallet', `Refund · ${bk.serviceName}`);
    save();
    toast(free ? `Cancelled · ${money(bk.paidNow)} refunded to ${where}` : 'Cancelled');
    refresh();
  }

  // Local demo only: pretend the appointment just finished (balance is paid in person).
  function completeBooking(id) {
    const bk = S.bookings.find((x) => x.id === id);
    finishLocalBooking(bk);
    if (dkey(new Date()) < bk.date) bk.date = dkey(new Date());
    save();
    refresh();
    openRate(id);
  }

  // ---------- Cut history ----------
  VIEWS.history = function () {
    const done = myBookings().filter((b) => b.status === 'completed').sort((a, c) => c.date.localeCompare(a.date));
    const barbersTried = new Set(done.map((b) => b.barberId)).size;
    const spent = done.reduce((s, b) => s + b.quote.total + (b.tip || 0), 0);
    return `
      ${pageHead('Cut history')}
      <div class="kpis">
        <div class="kpi"><span>Cuts</span><b>${done.length}</b></div>
        <div class="kpi"><span>Barbers tried</span><b>${barbersTried}</b></div>
        <div class="kpi"><span>Spent incl. tips</span><b>${money(spent)}</b></div>
        <div class="kpi"><span>Avg. days between</span><b>${done.length > 1 ? Math.round((parseKey(done[0].date) - parseKey(done[done.length - 1].date)) / 86400000 / (done.length - 1)) : '—'}</b></div>
      </div>
      <div class="mt16">${done.map((bk) => {
        const b = barberById(bk.barberId);
        const p = placeById(bk.placeId);
        return `
          <div class="card row gap12" style="align-items:flex-start;margin-bottom:10px">
            <div style="width:84px;flex-shrink:0">${tile({ style: bk.style, hue: b.hue, title: '' }, { tag: false, likes: false })}</div>
            <div class="grow">
              <div class="xs muted">${fmtDate(bk.date)}</div>
              <b>${esc(bk.serviceName)}</b>
              <div class="small">${esc(b.name)} · <span class="muted">${esc(p.short)}</span></div>
              ${bk.notes ? `<div class="xs mt4" style="color:#cfcfd8;line-height:1.45">📝 ${esc(bk.notes)}</div>` : ''}
              <div class="row gap6 mt8 wrap">
                <button class="btn xs primary" data-act="book" data-id="${b.id}" data-svc="${bk.serviceId}">Rebook this cut</button>
                ${bk.rated ? `<span class="xs gold">${'★'.repeat(bk.rB)}</span>` : `<button class="btn xs" data-act="rate" data-id="${bk.id}">Rate</button>`}
              </div>
            </div>
          </div>`;
      }).join('') || '<div class="empty">No cuts yet</div>'}</div>`;
  };

  // ---------- Server connection (optional; the app works fully offline without it) ----------
  const API = {
    base: '',
    on: false,
    token: localStorage.getItem('fade.token'),

    async detect() {
      const fromParam = new URLSearchParams(location.search).get('api');
      if (fromParam) localStorage.setItem('fade.api', fromParam);
      const candidates = [];
      const saved = localStorage.getItem('fade.api');
      if (saved) candidates.push(saved);
      if (/^https?:$/.test(location.protocol) && !/github\.io$/.test(location.hostname)) candidates.push(location.origin);
      for (const raw of candidates) {
        const base = raw.replace(/\/+$/, '');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`${base}/api/health`, { cache: 'no-store', signal: controller.signal });
          clearTimeout(timer);
          const data = await res.json();
          if (data.app === 'fade') {
            this.base = base;
            this.on = true;
            return true;
          }
        } catch (err) {
          // not a Fade server; keep looking
        }
      }
      return false;
    },

    setToken(token) {
      this.token = token || null;
      if (token) {
        localStorage.setItem('fade.token', token);
      } else {
        localStorage.removeItem('fade.token');
      }
    },

    async req(method, path, body) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      let res;
      try {
        res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (err) {
        const offline = new Error('Can’t reach the Fade server — check your connection');
        offline.status = 0;
        throw offline;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = new Error(data.error || `Request failed (${res.status})`);
        failure.status = res.status;
        throw failure;
      }
      return data;
    },

    upload(path, blob, contentType, extraHeaders, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', this.base + path);
        xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
        xhr.setRequestHeader('Content-Type', contentType);
        Object.entries(extraHeaders || {}).forEach(([name, value]) => xhr.setRequestHeader(name, value));
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
          let data = {};
          try {
            data = JSON.parse(xhr.responseText);
          } catch (err) {
            data = {};
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            const failure = new Error(data.error || `Upload failed (${xhr.status})`);
            failure.status = xhr.status;
            reject(failure);
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed — network error'));
        xhr.send(blob);
      });
    },
  };

  let pullSeq = 0;
  let appliedSeq = 0;

  // Server is the source of truth: fetch a fresh snapshot after every change.
  async function pull() {
    const seq = ++pullSeq;
    const snapshot = await API.req('GET', '/api/state');
    if (seq < appliedSeq) return;
    appliedSeq = seq;
    applyServerState(snapshot);
    save();
  }

  function normalizeThread(t, u) {
    const barberSide = t.type === 'dm' && !!u.barberId && t.barberId === u.barberId && t.userId !== u.id;
    const isMe = (m) => m.from === `u:${u.id}` || (barberSide && m.from === u.barberId);
    return { ...t, barberSide, messages: t.messages.map((m) => ({ ...m, from: isMe(m) ? 'me' : m.from })) };
  }

  function applyServerState(st) {
    const u = st.user;
    S.user = {
      ...S.user,
      id: u.id, name: u.name, handle: u.handle, hue: u.hue, email: u.email, bio: u.bio || '', role: u.role,
      points: u.points, lifetime: u.lifetime, wallet: u.wallet, plan: u.plan, method: u.method,
      cards: u.cards || [], followers: u.followers || 0,
      refCode: `${(u.handle || 'fade').toUpperCase().replace(/[^A-Z0-9]/g, '')}-FRESH`,
      location: S.user.location && S.user.location.label ? S.user.location : { ...DEFAULT_LOCATION },
    };
    S.places = st.places;
    S.barbers = st.barbers;
    S.products = st.products;
    S.creators = st.creators;
    S.bookings = st.bookings;
    S.txns = st.txns;
    S.orders = st.orders;
    S.threads = st.threads.map((t) => normalizeThread(t, u));
    S.shorts = st.shorts.map((sh) => ({ ...sh, createdAt: sh.createdAt * 1000 }));
    S.following = u.following || [];
    S.commissions = st.commissions.map((c) => ({ ...c, createdAt: c.createdAt * 1000 }));
    S.commissionsOwed = st.commissionsOwed;
    S.creatorSummary = st.creator;
    S.boosts = st.boosts || {};
    S.claimed = u.claimed || {};
    S.referrals = u.referrals || 0;
    S.progress = st.progress;
    S.rentPaidThisWeek = st.rentPaidThisWeek || [];
    S.meBarberId = u.barberId || null;
    S.mePlaceId = u.placeId || null;
    S.onboarded = true;
    if (S.role === 'barber' && !S.meBarberId) S.role = 'customer';
    if (S.role === 'owner' && !S.mePlaceId) S.role = 'customer';
    S.threads.forEach((t) => {
      if (S.readMarks[t.id] === undefined) S.readMarks[t.id] = lastT(t);
    });
  }

  // Run a server mutation, then re-sync and re-render.
  async function remoteDo(action, success) {
    try {
      const result = await action();
      await pull();
      refresh();
      if (success) toast(typeof success === 'function' ? success(result) : success);
      return result;
    } catch (err) {
      toast(err.message || 'Something went wrong');
      if (err.status === 401) logoutLocal();
      return null;
    }
  }

  function logoutLocal() {
    API.setToken(null);
    S = initRemoteState();
    save();
    location.hash = '#/welcome';
    render();
  }

  // ---------- On-device media (IndexedDB) for shorts recorded/uploaded in offline mode ----------
  const Media = {
    db: null,
    urls: {},

    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('fade-media', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('blobs');
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        request.onerror = () => reject(request.error);
      });
    },

    async run(mode, work) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', mode);
        const result = work(tx.objectStore('blobs'));
        tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
      });
    },

    put(key, blob) {
      return this.run('readwrite', (store) => store.put(blob, key));
    },

    get(key) {
      return this.run('readonly', (store) => store.get(key));
    },

    async del(key) {
      if (this.urls[key]) {
        URL.revokeObjectURL(this.urls[key]);
        delete this.urls[key];
      }
      return this.run('readwrite', (store) => store.delete(key));
    },

    clear() {
      return this.run('readwrite', (store) => store.clear());
    },

    async url(key) {
      if (this.urls[key]) return this.urls[key];
      const blob = await this.get(key);
      if (!blob) return null;
      this.urls[key] = URL.createObjectURL(blob);
      return this.urls[key];
    },
  };

  let ACTIVE_SID = null;

  function hydrateMedia(root) {
    if (!root) return;
    root.querySelectorAll('[data-media-key]').forEach((el) => {
      Media.url(el.dataset.mediaKey).then((url) => {
        if (!url) {
          const wrap = el.closest('.media-wrap');
          if (wrap) wrap.classList.add('missing');
          return;
        }
        el.src = url;
        const reel = el.closest('.reel');
        if (el.tagName === 'VIDEO' && reel && reel.dataset.sid === ACTIVE_SID) {
          el.muted = FEED.muted;
          const playing = el.play();
          if (playing && playing.catch) playing.catch(() => {});
        }
      }).catch(() => {});
    });
  }

  // ---------- Shorts ----------
  const FEED = { tab: 'foryou', tag: null, ctx: null, start: null, muted: true };
  const VIEWED = new Set();
  const viewTimers = {};
  let reelObserver = null;
  let UP = null;

  function trendScore(sh) {
    const hours = Math.max(0, (Date.now() - sh.createdAt) / 3600000);
    return (sh.likes * 2 + sh.shares * 4 + sh.views * 0.1 + (sh.conversions || 0) * 25 + 50) / Math.pow(hours + 2, 1.3);
  }

  function trendingShorts(days = 7) {
    const cutoff = Date.now() - days * 86400000;
    return S.shorts.filter((sh) => sh.createdAt >= cutoff).sort((a, c) => trendScore(c) - trendScore(a));
  }

  function profileInfo(key) {
    const [type, id] = key.split(':');
    if (type === 'barber') {
      const b = barberById(id);
      return b && { key, name: b.name, hue: b.hue, img: b.photo, path: `/barber/${b.id}`, label: 'Barber' };
    }
    if (type === 'place') {
      const pl = placeById(id);
      return pl && { key, name: pl.name, place: pl, path: `/place/${pl.id}`, label: 'Shop' };
    }
    const c = creatorById(id);
    return c && { key, name: c.name, hue: c.hue, path: `/user/${c.isMe ? 'me' : c.id}`, label: c.isMe ? 'You' : 'Creator' };
  }

  // Barbers, shops and creators ranked by the engagement of shorts by or about them this week.
  function trendingProfiles() {
    const scores = {};
    const add = (key, value) => {
      scores[key] = (scores[key] || 0) + value;
    };
    trendingShorts(7).forEach((sh) => {
      const score = trendScore(sh);
      add(`${sh.authorType}:${sh.authorId}`, score);
      (sh.tags || []).filter((t) => t.status === 'approved').forEach((t) => add(`${t.type}:${t.id}`, score * 0.6));
    });
    return Object.entries(scores)
      .sort((a, c) => c[1] - a[1])
      .map(([key]) => profileInfo(key))
      .filter(Boolean);
  }

  function profileChip(info, index) {
    const visual = info.place
      ? `<span class="thumb" style="width:56px;height:56px;border-radius:50%;${placeCover(info.place)}"></span>`
      : avatar(info.name, info.hue, 56, info.img);
    return `
      <button class="pchip" data-act="go" data-to="${info.path}">
        <span class="ring">${visual}</span>
        <b class="xs ellip">${esc(info.name)}</b>
        <span class="xs muted">${index < 3 ? '🔥 ' : ''}${info.label}</span>
      </button>`;
  }

  function isSponsored(sh) {
    return (sh.tags || []).some((t) => t.kind === 'sponsored' && t.status === 'approved');
  }

  function shortsAbout(type, id) {
    return S.shorts
      .filter((sh) => (sh.authorType === type && sh.authorId === id) ||
        (sh.tags || []).some((t) => t.type === type && t.id === id && t.status === 'approved'))
      .sort((a, c) => c.createdAt - a.createdAt);
  }

  function shortsByUser(id) {
    const me = id === 'me' || id === S.user.id;
    return S.shorts
      .filter((sh) => sh.authorType === 'user' && (me ? isMyShort(sh) : sh.authorId === id))
      .sort((a, c) => c.createdAt - a.createdAt);
  }

  function shortVisual(sh, mode) {
    const m = sh.media || {};
    if (!m.kind || m.kind === 'art') {
      return `<div class="art-wrap ${mode === 'reel' ? 'kb' : ''}">${cutArt(m.style || 'fade', m.hue || 200, { color: m.color })}</div>`;
    }
    const src = m.url ? `src="${esc(mediaUrl(m.url))}"` : '';
    const keyAttr = m.key ? `data-media-key="${esc(m.key)}"` : '';
    if (mode === 'tile') {
      if (m.poster) return `<img class="sv" src="${esc(m.poster)}" alt="" loading="lazy">`;
      if (m.kind === 'image') return `<img class="sv" ${src} ${keyAttr} alt="" loading="lazy">`;
      return `<video class="sv" ${src} ${keyAttr} muted playsinline preload="metadata"></video>`;
    }
    if (m.kind === 'image') return `<img class="sv" ${src} ${keyAttr} alt="">`;
    const poster = m.poster ? `poster="${esc(m.poster)}"` : '';
    return `<video class="sv" ${src} ${keyAttr} ${poster} playsinline muted loop preload="metadata"></video>`;
  }

  function shortTile(sh, ctx) {
    const a = authorInfo(sh);
    return `
      <button class="stile" data-act="openShort" data-sid="${sh.id}" data-ctype="${ctx.type}" data-cid="${esc(ctx.id || '')}" aria-label="Play short by @${esc(a.handle)}">
        <div class="media-wrap">${shortVisual(sh, 'tile')}</div>
        <span class="sviews">${icon('play', 10)} ${compact(sh.views)}</span>
        ${isSponsored(sh) ? '<span class="spons">Sponsored</span>' : ''}
        <span class="sauthor ellip">@${esc(a.handle)}</span>
      </button>`;
  }

  function shortsGrid(list, ctx, emptyText) {
    if (!list.length) return emptyText ? `<div class="empty">${emptyText}</div>` : '';
    return `<div class="grid3">${list.map((sh) => shortTile(sh, ctx)).join('')}</div>`;
  }

  function captionHTML(text) {
    return esc(text).replace(/(^|[^&\w])#([A-Za-z_]\w*)/g, (match, before, tag) =>
      `${before}<button class="ht" data-act="hashtag" data-tag="#${tag.toLowerCase()}">#${tag}</button>`);
  }

  function tagsHTML(sh) {
    const tags = (sh.tags || []).filter((t) => t.status !== 'declined');
    if (!tags.length) return '';
    return `<div class="row gap6 wrap mt8">${tags.map((t) => {
      const target = tagTarget(t);
      if (!target) return '';
      return `<button class="tagchip ${t.kind}" data-act="go" data-to="/${t.type}/${t.id}">${icon(t.type === 'barber' ? 'scissors' : 'store', 12)} ${esc(target.name)} · ${t.kind === 'sponsored' ? 'Sponsored' : 'Featured'}${t.status === 'pending' ? ' (pending)' : ''}</button>`;
    }).join('')}</div>`;
  }

  // Who can you book / buy from this short?
  function shortTargets(sh) {
    const tags = (sh.tags || []).filter((t) => t.status !== 'declined');
    let barber = sh.authorType === 'barber' ? barberById(sh.authorId) : null;
    let place = sh.authorType === 'place' ? placeById(sh.authorId) : null;
    if (!barber) {
      const tag = tags.find((t) => t.type === 'barber');
      barber = tag ? barberById(tag.id) : null;
    }
    if (!place) {
      const tag = tags.find((t) => t.type === 'place');
      place = tag ? placeById(tag.id) : null;
    }
    const sellers = [barber && `barber:${barber.id}`, place && `place:${place.id}`].filter(Boolean);
    const products = S.products.filter((pr) => sellers.includes(`${pr.sellerType}:${pr.sellerId}`));
    return { barber, place, products };
  }

  function authorFollow(sh) {
    if (sh.authorType === 'user') {
      if (isMyShort(sh)) return null;
      return { type: 'user', id: sh.authorId };
    }
    return { type: sh.authorType, id: sh.authorId };
  }

  function followsShort(sh) {
    const author = authorFollow(sh);
    if (author && isFollowing(author.type, author.id)) return true;
    return (sh.tags || []).some((t) => isFollowing(t.type, t.id));
  }

  function isLocalShort(sh) {
    if (sh.authorType === 'barber') return (barberById(sh.authorId) || {}).city === LOCAL_CITY;
    if (sh.authorType === 'place') return (placeById(sh.authorId) || {}).city === LOCAL_CITY;
    return (sh.tags || []).some((t) => (tagTarget(t) || {}).city === LOCAL_CITY);
  }

  function personalScore(sh) {
    const fresh = isMyShort(sh) && Date.now() - sh.createdAt < 3600000 ? 5 : 1;
    return trendScore(sh) * (followsShort(sh) ? 1.6 : 1) * (isLocalShort(sh) ? 1.3 : 1) * fresh;
  }

  function feedList() {
    let list;
    if (FEED.ctx) {
      if (FEED.ctx.type === 'user') list = shortsByUser(FEED.ctx.id);
      else if (FEED.ctx.type === 'trending') list = trendingShorts(30);
      else list = shortsAbout(FEED.ctx.type, FEED.ctx.id);
    } else if (FEED.tab === 'trending') {
      list = trendingShorts(7);
    } else if (FEED.tab === 'following') {
      list = S.shorts.filter(followsShort).sort((a, c) => c.createdAt - a.createdAt);
    } else if (FEED.tab === 'near') {
      list = S.shorts.filter(isLocalShort).sort((a, c) => trendScore(c) - trendScore(a));
    } else {
      list = [...S.shorts].sort((a, c) => personalScore(c) - personalScore(a));
    }
    if (FEED.tag) list = list.filter((sh) => sh.caption.toLowerCase().includes(FEED.tag));
    if (FEED.start) {
      const index = list.findIndex((sh) => sh.id === FEED.start);
      if (index > 0) {
        list = [list[index], ...list.slice(0, index), ...list.slice(index + 1)];
      } else if (index < 0) {
        const found = S.shorts.find((sh) => sh.id === FEED.start);
        if (found) list = [found, ...list];
      }
    }
    return list;
  }

  function contextTitle(ctx) {
    if (ctx.type === 'user') {
      const person = creatorById(ctx.id) || {};
      return ctx.id === 'me' ? 'Your shorts' : `@${person.handle || 'creator'}`;
    }
    if (ctx.type === 'barber') return `${(barberById(ctx.id) || {}).name || 'Barber'} · shorts`;
    if (ctx.type === 'place') return `${(placeById(ctx.id) || {}).name || 'Shop'} · shorts`;
    return 'Trending';
  }

  VIEWS.feed = function (arg) {
    if (arg !== 'ctx') {
      FEED.ctx = null;
      if (arg) FEED.start = arg;
    }
    const list = feedList();
    const tabs = [['foryou', 'For you'], ['trending', 'Trending'], ['following', 'Following'], ['near', 'Near me']];
    const emptyText = FEED.tab === 'following' ? 'Follow barbers, shops and creators to fill this feed' : 'No shorts here yet';
    return `
      <div class="feed" id="feed">
        <div class="feed-top">
          ${FEED.ctx
            ? `<button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button><b class="ctx-title ellip">${esc(contextTitle(FEED.ctx))}</b>`
            : tabs.map(([v, l]) => `<button class="${FEED.tab === v ? 'on' : ''}" data-act="feedTab" data-v="${v}">${l}</button>`).join('')}
        </div>
        ${FEED.tag ? `<button class="tagpill" data-act="clearTag">${esc(FEED.tag)} ${icon('x', 14)}</button>` : ''}
        ${list.length ? list.map(reelHTML).join('') : `
          <section class="reel empty-reel"><div class="empty">${emptyText}
            <div class="mt12"><button class="btn primary" data-act="create">${icon('plus', 16)} Post a short</button></div></div></section>`}
      </div>`;
  };

  function reelHTML(sh) {
    const a = authorInfo(sh);
    const mine = isMyShort(sh);
    const author = authorFollow(sh);
    const following = author && isFollowing(author.type, author.id);
    const target = shortTargets(sh);
    const sponsor = (sh.tags || []).find((t) => t.kind === 'sponsored' && t.status === 'approved');
    const saved = S.saved.includes(sh.id);
    const isVideo = sh.media && sh.media.kind === 'video';
    const fromPrice = target.barber ? Math.min(...target.barber.services.map((s) => s.price)) : 0;
    return `
      <section class="reel" data-sid="${sh.id}">
        <div class="art-full media-wrap" ${isVideo ? 'data-act="mute"' : ''}>${shortVisual(sh, 'reel')}</div>
        <div class="shade"></div>
        ${sponsor ? `<div class="pp">${icon('tag', 12)} Paid partnership · ${esc((tagTarget(sponsor) || {}).name || '')}</div>` : ''}
        ${isVideo ? `<button class="mutebtn" data-act="mute" aria-label="Toggle sound">${icon(FEED.muted ? 'mute' : 'volume', 18)}</button>` : ''}
        <div class="rail">
          <button class="${sh.likedByMe ? 'liked' : ''}" data-act="like" data-sid="${sh.id}" aria-label="Like"><span class="rb">${icon('heart', 22)}</span><span class="cnt">${compact(sh.likes)}</span></button>
          ${target.barber ? `<button data-act="dm" data-id="${target.barber.id}" aria-label="Ask the barber"><span class="rb">${icon('chat', 22)}</span>Ask</button>` : ''}
          <button class="${saved ? 'liked' : ''}" data-act="save" data-sid="${sh.id}" aria-label="Save"><span class="rb">${icon('bookmark', 22)}</span>Save</button>
          <button data-act="shareShort" data-sid="${sh.id}" aria-label="Share"><span class="rb">${icon('share', 22)}</span><span class="cnt">${compact(sh.shares)}</span></button>
          ${mine ? `<button data-act="deleteShort" data-sid="${sh.id}" aria-label="Delete short"><span class="rb">${icon('trash', 20)}</span>Delete</button>` : ''}
        </div>
        <div class="meta">
          <div class="row gap10">
            <button class="row gap10" data-act="go" data-to="${a.path}">${avatar(a.name, a.hue, 40, a.img)}<b>@${esc(a.handle)}</b>${a.verified ? verifiedBadge : ''}</button>
            ${author && !following ? `<button class="btn xs" data-act="follow" data-type="${author.type}" data-id="${esc(author.id)}">Follow</button>` : ''}
          </div>
          <div class="row gap6 mt8"><span class="badge standard">${esc(sh.category || 'Cut reveal')}</span><span class="xs muted">${compact(sh.views)} views · ${ago(sh.createdAt)}</span></div>
          <p class="caption">${captionHTML(sh.caption)}</p>
          ${tagsHTML(sh)}
          <div class="row gap8 mt12">
            ${target.barber
              ? `<button class="btn primary" data-act="bookFromShort" data-sid="${sh.id}">${icon('scissors', 18)} Book ${esc(firstName(target.barber.name))} · from ${money(fromPrice)}</button>`
              : target.place ? `<button class="btn primary" data-act="placeFromShort" data-sid="${sh.id}">${icon('pin', 18)} Visit ${esc(target.place.short)}</button>` : ''}
            ${target.products.length ? `<button class="btn" data-act="shopFromShort" data-sid="${sh.id}">${icon('bag', 16)} Shop</button>` : ''}
          </div>
        </div>
      </section>`;
  }

  function setupReels() {
    teardownReels();
    const feed = $('#feed');
    if (!feed || !('IntersectionObserver' in window)) return;
    reelObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const reel = entry.target;
        const sid = reel.dataset.sid;
        const video = reel.querySelector('video');
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          ACTIVE_SID = sid;
          if (video && video.src) {
            video.muted = FEED.muted;
            const playing = video.play();
            if (playing && playing.catch) playing.catch(() => {});
          }
          if (sid && !VIEWED.has(sid)) viewTimers[sid] = setTimeout(() => countView(sid), 1200);
        } else {
          if (video) video.pause();
          clearTimeout(viewTimers[sid]);
        }
      });
    }, { root: feed, threshold: [0, 0.6, 1] });
    feed.querySelectorAll('.reel[data-sid]').forEach((reel) => reelObserver.observe(reel));
  }

  function teardownReels() {
    if (reelObserver) {
      reelObserver.disconnect();
      reelObserver = null;
    }
    Object.keys(viewTimers).forEach((sid) => clearTimeout(viewTimers[sid]));
    ACTIVE_SID = null;
  }

  function countView(sid) {
    if (VIEWED.has(sid)) return;
    VIEWED.add(sid);
    const sh = S.shorts.find((x) => x.id === sid);
    if (!sh) return;
    sh.views += 1;
    if (API.on) {
      API.req('POST', `/api/shorts/${sid}/view`).catch(() => {});
    } else {
      save();
    }
  }

  function openShortCtx(sid, ctx) {
    FEED.ctx = ctx;
    FEED.start = sid;
    go('/feed/ctx');
  }

  // ----- attribution: bookings / purchases within 24 h of tapping a short credit its creator -----
  function setRef(sid) {
    S.lastRef = { sid, at: Date.now() };
    save();
  }

  function activeRef() {
    return S.lastRef && Date.now() - S.lastRef.at < ATTRIBUTION_HOURS * 3600000 ? S.lastRef.sid : null;
  }

  function approvedTagFor(sh, barberId, placeId) {
    return (sh.tags || []).find((t) => t.status === 'approved' &&
      ((t.type === 'barber' && t.id === barberId) || (t.type === 'place' && t.id === placeId)));
  }

  function refNoteHTML(sid, barberId, placeId) {
    const sh = sid && S.shorts.find((x) => x.id === sid);
    if (!sh || sh.authorType !== 'user' || isMyShort(sh)) return '';
    const tag = approvedTagFor(sh, barberId, placeId);
    if (!tag) return '';
    const a = authorInfo(sh);
    return `
      <div class="card mt12 row gap10 small">
        <span class="acc">${icon('tag', 18)}</span>
        <span class="grow">Booked via <b>@${esc(a.handle)}</b>'s short — they earn a ${Math.round(COMMISSION_RATES[tag.kind] * 100)}% ${tag.kind} commission paid by the ${tag.type === 'barber' ? 'barber' : 'shop'}. Your price doesn't change.</span>
      </div>`;
  }

  // ----- upload -----
  function fileType(file) {
    if (file.type) return file.type.toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const map = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    return map[ext] || '';
  }

  function posterFrom(source, width, height) {
    const scale = Math.min(1, 540 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  function readVideoMeta(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      let done = false;
      const finish = (meta) => {
        if (done) return;
        done = true;
        resolve({ url, duration: null, poster: null, ...meta });
      };
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        const known = Number.isFinite(video.duration) ? video.duration : 1;
        video.currentTime = Math.min(0.5, known / 2);
      };
      video.onseeked = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : null;
        try {
          finish({ duration, poster: posterFrom(video, video.videoWidth, video.videoHeight) });
        } catch (err) {
          finish({ duration });
        }
      };
      video.onerror = () => finish({ error: true });
      setTimeout(() => finish({ duration: Number.isFinite(video.duration) ? video.duration : null }), 8000);
      video.src = url;
    });
  }

  function readImageMeta(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          resolve({ url, duration: null, poster: posterFrom(img, img.naturalWidth, img.naturalHeight) });
        } catch (err) {
          resolve({ url, duration: null, poster: null });
        }
      };
      img.onerror = () => resolve({ url, duration: null, poster: null, error: true });
      img.src = url;
    });
  }

  function openUpload() {
    UP = {
      file: null, url: null, kind: null, type: '', duration: null, poster: null, caption: '', category: '',
      tags: [], agreement: false, busy: false, progress: 0,
      as: S.role === 'barber' && S.meBarberId ? 'barber' : S.role === 'owner' && S.mePlaceId ? 'place' : 'user',
    };
    openSheet(uploadHTML());
  }

  async function handleShortFile(file) {
    if (!file || !UP) return;
    const type = fileType(file);
    const kind = UPLOAD_TYPES[type];
    if (!kind) {
      toast('Use an MP4, MOV, WebM, JPG, PNG or WebP file');
      return;
    }
    if (file.size > MAX_SHORT_MB * 1024 * 1024) {
      toast(`Max ${MAX_SHORT_MB} MB — trim the clip first`);
      return;
    }
    const meta = kind === 'video' ? await readVideoMeta(file) : await readImageMeta(file);
    if (meta.error || (!meta.poster && !meta.duration)) {
      URL.revokeObjectURL(meta.url);
      toast('Can’t read this file — try another video or photo');
      return;
    }
    if (kind === 'video' && meta.duration && meta.duration > MAX_SHORT_SECONDS + 0.5) {
      URL.revokeObjectURL(meta.url);
      toast(`Shorts are up to ${MAX_SHORT_SECONDS}s — this clip is ${Math.round(meta.duration)}s`);
      return;
    }
    if (!UP) return;
    Object.assign(UP, { file, url: meta.url, kind, type, duration: meta.duration, poster: meta.poster });
    setSheet(uploadHTML());
  }

  function uploadHTML() {
    if (!UP.file) {
      return `
        <div class="sheet-head"><h2 class="grow">New short</h2><button class="iconbtn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div>
        <div class="dropzone mt12">
          <div class="dz-icon">${icon('video', 34)}</div>
          <b>Share a haircut moment</b>
          <p class="small muted mt4">Cut reveals, before/after, tutorials, shop tours and products. Up to ${MAX_SHORT_SECONDS}s and ${MAX_SHORT_MB} MB.</p>
          <div class="row gap8 mt16" style="justify-content:center">
            <label class="btn primary">${icon('camera', 18)} Record<input id="up-record" type="file" accept="video/*" capture="environment" hidden></label>
            <label class="btn">${icon('upload', 18)} Upload<input id="up-file" type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" hidden></label>
          </div>
        </div>
        <div class="card mt12 small" style="line-height:1.5">${icon('dollar', 16)} <b>Earn from your shorts.</b> Tag the barber or shop. When people book or buy from your short you earn <b class="acc">5%</b> (Featured) or <b class="acc">10%</b> (Sponsored), paid by them once they approve the tag and the cut is done.</div>`;
    }
    const preview = UP.kind === 'video'
      ? `<video src="${UP.url}" muted playsinline loop autoplay controls></video>`
      : `<img src="${UP.url}" alt="Selected photo">`;
    const sponsored = UP.tags.some((t) => t.kind === 'sponsored');
    const asOptions = [['user', 'Me']];
    if (S.meBarberId && (API.on || S.role === 'barber')) asOptions.push(['barber', 'My barber page']);
    if (S.mePlaceId && (API.on || S.role === 'owner')) asOptions.push(['place', 'My shop']);
    const tagged = (type, id) => UP.tags.some((t) => t.type === type && t.id === id);
    return `
      <div class="sheet-head">
        <button class="iconbtn" data-act="upReset" aria-label="Choose another file">${icon('back')}</button>
        <h2 class="grow">New short</h2>
        <button class="iconbtn" data-act="closeSheet" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="up-preview mt12">${preview}${UP.duration ? `<span class="badge standard dur">${Math.round(UP.duration)}s</span>` : ''}</div>
      <div class="field"><label for="up-caption">Caption</label><textarea id="up-caption" maxlength="300" placeholder="Fresh mid fade by @barber #skinfade">${esc(UP.caption)}</textarea></div>
      <div class="label">What is it? (haircut-related only)</div>
      <div class="row gap6 wrap">${SHORT_CATEGORIES.map((c) => `<button class="chip ${UP.category === c ? 'on' : ''}" data-act="upCat" data-v="${esc(c)}">${c}</button>`).join('')}</div>
      ${asOptions.length > 1 ? `<div class="label">Post as</div><div class="seg">${asOptions.map(([v, l]) => `<button class="${UP.as === v ? 'on' : ''}" data-act="upAs" data-v="${v}">${l}</button>`).join('')}</div>` : ''}
      <div class="label">Tag a barber or shop (max 4)</div>
      ${UP.tags.map((t, i) => {
        const target = tagTarget(t);
        return `
          <div class="listitem">
            <span class="grow small"><b>${esc(target ? target.name : t.id)}</b><div class="xs muted">${t.type === 'barber' ? 'Barber' : 'Shop'}</div></span>
            <div class="seg kindseg">
              <button class="${t.kind === 'featured' ? 'on' : ''}" data-act="upTagKind" data-i="${i}" data-v="featured">Featured 5%</button>
              <button class="${t.kind === 'sponsored' ? 'on' : ''}" data-act="upTagKind" data-i="${i}" data-v="sponsored">Sponsored 10%</button>
            </div>
            <button class="iconbtn" data-act="upRemoveTag" data-i="${i}" aria-label="Remove tag">${icon('x', 16)}</button>
          </div>`;
      }).join('')}
      ${UP.tags.length < 4 ? `
        <div class="frow mt8">
          <select class="input" id="up-tag-barber" data-change="upTagBarber" aria-label="Tag a barber"><option value="">+ Tag a barber</option>${S.barbers.filter((b) => !tagged('barber', b.id)).map((b) => `<option value="${b.id}">${esc(b.name)} · ${esc(b.city)}</option>`).join('')}</select>
          <select class="input" id="up-tag-place" data-change="upTagPlace" aria-label="Tag a shop"><option value="">+ Tag a shop</option>${S.places.filter((pl) => !tagged('place', pl.id)).map((pl) => `<option value="${pl.id}">${esc(pl.name)}</option>`).join('')}</select>
        </div>` : ''}
      ${sponsored ? `
        <label class="toggle-row"><span class="small"><b>Paid partnership</b><div class="xs muted">I have a paid agreement with the sponsored profile. The short shows “Paid partnership”.</div></span>
        <span class="switch"><input type="checkbox" data-act="upAgree" ${UP.agreement ? 'checked' : ''}><span></span></span></label>` : ''}
      <p class="xs muted mt12">Tagged barbers/shops approve tags before commissions apply. You never earn on your own bookings.</p>
      ${UP.busy ? `<div class="progress mt12"><span style="width:${Math.round(UP.progress * 100)}%"></span></div>` : ''}
      <button class="btn primary block mt12" data-act="upPost" ${UP.busy ? 'disabled' : ''}>${UP.busy ? 'Posting…' : 'Post short'}</button>`;
  }

  async function postShort() {
    if (!UP || !UP.file || UP.busy) return;
    const caption = UP.caption.trim();
    if (!caption) {
      toast('Add a caption');
      return;
    }
    if (!UP.category) {
      toast('Pick what the short is about');
      return;
    }
    if (UP.tags.some((t) => t.kind === 'sponsored') && !UP.agreement) {
      toast('Confirm the paid partnership for sponsored tags');
      return;
    }
    if (API.on) {
      UP.busy = true;
      setSheet(uploadHTML());
      try {
        const meta = {
          caption, category: UP.category, tags: UP.tags, sponsoredAgreement: UP.agreement,
          poster: UP.poster, duration: UP.duration, as: UP.as,
        };
        const result = await API.upload('/api/shorts', UP.file, UP.type, { 'X-Fade-Meta': utf8ToBase64(JSON.stringify(meta)) }, (fraction) => {
          if (!UP) return;
          UP.progress = fraction;
          const bar = $('#sheet-root .progress > span');
          if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
        });
        await pull();
        const sh = result.short;
        closeSheet();
        toast('Posted 🎬');
        openShortCtx(sh.id, sh.authorType === 'user' ? { type: 'user', id: 'me' } : { type: sh.authorType, id: sh.authorId });
      } catch (err) {
        if (UP) {
          UP.busy = false;
          setSheet(uploadHTML());
        }
        toast(err.message);
      }
      return;
    }
    const id = uid('sh');
    const key = `short:${id}`;
    try {
      await Media.put(key, UP.file);
    } catch (err) {
      toast('Could not save the video on this device (storage full or private browsing)');
      return;
    }
    const authorType = UP.as;
    const authorId = UP.as === 'barber' ? S.meBarberId : UP.as === 'place' ? S.mePlaceId : 'me';
    const short = {
      id, authorType, authorId, byMe: true, caption, category: UP.category,
      tags: UP.tags.map((t) => ({ ...t, status: 'pending' })),
      media: { kind: UP.kind, key, type: UP.type, poster: UP.poster, duration: UP.duration },
      likes: 0, views: 0, shares: 0, conversions: 0, createdAt: Date.now(), likedByMe: false,
    };
    S.shorts.unshift(short);
    save();
    const tagged = short.tags.map(tagTarget).filter(Boolean);
    closeSheet();
    toast('Posted 🎬');
    openShortCtx(id, authorType === 'user' ? { type: 'user', id: 'me' } : { type: authorType, id: authorId });
    if (tagged.length) {
      setTimeout(() => {
        short.tags.forEach((t) => {
          t.status = 'approved';
        });
        save();
        toast(`${tagged.map((x) => firstName(x.name)).join(' & ')} approved your tag ✅ (demo)`);
        if (parseRoute().page === 'feed' || parseRoute().page === 'creator') refresh();
      }, 2500);
    }
  }

  // ----- creator profile -----
  VIEWS.user = function (id) {
    const me = !id || id === 'me' || id === S.user.id;
    const person = me ? { ...S.user, isMe: true } : creatorById(id);
    if (!person) return `${pageHead('Profile')}<div class="empty">Profile not found</div>`;
    const list = shortsByUser(me ? 'me' : person.id);
    const likes = list.reduce((sum, sh) => sum + sh.likes, 0);
    const following = !me && isFollowing('user', person.id);
    const followingCount = me ? S.following.length : person.following || 0;
    const sharePath = `/user/${me ? (API.on ? S.user.id : 'me') : person.id}`;
    return `
      <div class="cover" style="height:130px;background:linear-gradient(135deg,hsl(${person.hue},70%,30%),hsl(${(person.hue + 60) % 360},70%,12%))">
        <div class="cover-top">
          <button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button>
          <button class="iconbtn" data-act="share" data-path="${sharePath}" data-title="${esc(person.name)} on Fade" aria-label="Share profile">${icon('share', 18)}</button>
        </div>
      </div>
      <div class="prof">
        <div class="row between" style="align-items:flex-end">
          <span class="ring">${avatar(person.name || 'You', person.hue, 84)}</span>
          <div class="row gap8">${me
            ? `<button class="btn sm" data-act="go" data-to="/creator">${icon('dollar', 16)} Earnings</button><button class="btn sm primary" data-act="create">${icon('plus', 16)} Post</button>`
            : `<button class="btn sm ${following ? '' : 'violet'}" data-act="follow" data-type="user" data-id="${esc(person.id)}">${following ? 'Following' : 'Follow'}</button>`}</div>
        </div>
        <h1 class="mt12">${esc(person.name)} ${(person.followers || 0) > 40000 ? verifiedBadge : ''}</h1>
        <div class="small muted">@${esc(person.handle || '')}</div>
        ${person.bio ? `<p class="small mt8" style="line-height:1.5">${esc(person.bio)}</p>` : ''}
        <div class="statrow">
          <div class="stat"><b>${compact(me ? S.user.followers || 0 : followersOf('user', person))}</b><span>followers</span></div>
          <div class="stat"><b>${compact(followingCount)}</b><span>following</span></div>
          <div class="stat"><b>${compact(likes)}</b><span>likes</span></div>
          <div class="stat"><b>${list.length}</b><span>shorts</span></div>
        </div>
        <h2 class="sec">Shorts</h2>
        ${shortsGrid(list, { type: 'user', id: me ? 'me' : person.id }, me ? 'Post your first short — tag your barber and earn when people book 💸' : 'No shorts yet')}
        <div style="height:20px"></div>
      </div>`;
  };

  // ----- creator earnings -----
  function creatorSummary() {
    if (API.on && S.creatorSummary) return S.creatorSummary;
    const sum = (status) => round2(S.commissions.filter((c) => c.status === status).reduce((total, c) => total + c.amount, 0));
    return { pending: sum('pending'), available: sum('earned'), paid: sum('paid') };
  }

  function payerName(c) {
    const target = c.payerType === 'barber' ? barberById(c.payerId) : placeById(c.payerId);
    return target ? target.name : c.payerId;
  }

  VIEWS.creator = function () {
    const sum = creatorSummary();
    const mine = shortsByUser('me');
    const views = mine.reduce((total, sh) => total + sh.views, 0);
    const conversions = mine.reduce((total, sh) => total + (sh.conversions || 0), 0);
    const history = [...S.commissions].sort((a, c) => c.createdAt - a.createdAt);
    const statusBadge = { pending: 'standard', earned: 'acc', paid: 'premium', void: 'hot' };
    return `
      ${pageHead('Creator earnings')}
      <div class="ccard">
        <div class="row between"><span class="small muted">Available to withdraw</span><span class="badge acc">Commissions</span></div>
        <div class="bal">${money(sum.available)}</div>
        <div class="row gap16 small mt8"><span class="muted">Pending <b style="color:var(--text)">${money(sum.pending)}</b></span><span class="muted">Paid out <b style="color:var(--text)">${money(sum.paid)}</b></span></div>
        <button class="btn sm primary mt12" data-act="withdraw" ${sum.available < MIN_WITHDRAW ? 'disabled' : ''}>${icon('wallet', 16)} Withdraw to wallet</button>
      </div>
      <div class="card mt12 small" style="line-height:1.55">
        <b>How you earn</b><br>
        Tag a barber or shop in your short. Featured tags pay <b class="acc">5%</b> and sponsored (paid partnership) tags pay <b class="acc">10%</b> of the service price on bookings, and of product sales, made within ${ATTRIBUTION_HOURS} h of someone tapping your short. The tagged barber/shop pays it, it turns <i>earned</i> when the cut is completed, and your own bookings never count.
      </div>
      <div class="kpis mt12">
        <div class="kpi"><span>Shorts</span><b>${mine.length}</b></div>
        <div class="kpi"><span>Views</span><b>${compact(views)}</b></div>
        <div class="kpi"><span>Bookings from your shorts</span><b>${conversions}</b></div>
        <div class="kpi"><span>Followers</span><b>${compact(S.user.followers || 0)}</b></div>
      </div>
      <h2 class="sec">Your shorts <a data-act="create">+ New</a></h2>
      ${mine.length ? mine.map((sh) => `
        <div class="listitem">
          <div style="width:54px;flex-shrink:0">${shortTile(sh, { type: 'user', id: 'me' })}</div>
          <span class="grow"><b class="small ellip" style="display:block">${esc(sh.caption)}</b>
            <span class="xs muted">${compact(sh.views)} views · ${compact(sh.likes)} likes · ${sh.conversions || 0} bookings</span>
            ${(sh.tags || []).map((t) => `<span class="badge ${t.status === 'approved' ? 'acc' : t.status === 'declined' ? 'hot' : 'standard'} mt4">${esc((tagTarget(t) || {}).name || t.id)} · ${t.kind} · ${t.status}</span>`).join(' ')}
          </span>
        </div>`).join('') : '<div class="empty">No shorts yet — post one and tag your barber</div>'}
      <h2 class="sec">Commission history</h2>
      ${history.length ? history.map((c) => `
        <div class="row gap12" style="padding:10px 0;border-bottom:1px solid var(--line)">
          <span class="thumb" style="width:36px;height:36px;background:var(--card2);color:var(--acc)">${icon(c.sourceType === 'booking' ? 'scissors' : 'bag', 16)}</span>
          <span class="grow"><b class="small">${c.sourceType === 'booking' ? 'Booking' : 'Product sale'} · ${esc(payerName(c))}</b>
            <div class="xs muted">${Math.round(c.rate * 100)}% ${c.kind} of ${money(c.base)}${c.viewer ? ` · ${esc(c.viewer)}` : ''}</div></span>
          <span class="right"><b class="small">${money(c.amount)}</b><div><span class="badge ${statusBadge[c.status] || 'standard'}">${c.status}</span></div></span>
        </div>`).join('') : '<div class="empty">No commissions yet</div>'}
      ${API.on ? '' : `<button class="btn block mt16" data-act="simulateViewer">${icon('zap', 16)} Simulate a viewer booking from your short (demo)</button>`}
      <div style="height:16px"></div>`;
  };

  // ---------- Chat ----------
  let CHAT_TAB = 'dms';

  function dmPeer(t) {
    if (t.barberSide) return { name: t.customerName || 'Client', hue: t.customerHue || 200, path: null, barber: null };
    const b = barberById(t.barberId);
    return b ? { name: b.name, hue: b.hue, img: b.photo, path: `/barber/${b.id}`, barber: b } : { name: 'Barber', hue: 200, barber: null };
  }

  VIEWS.chat = function () {
    const dms = S.threads.filter((t) => t.type === 'dm').sort((a, c) => lastT(c) - lastT(a));
    const joined = S.threads.filter((t) => t.type === 'group' && t.joined);
    const discover = S.threads.filter((t) => t.type === 'group' && !t.joined);
    return `
      ${pageHead('Chat', { noBack: true, right: CHAT_TAB === 'groups' ? `<button class="iconbtn" data-act="newGroup" aria-label="New community">${icon('plus', 18)}</button>` : '' })}
      <div class="seg">
        <button class="${CHAT_TAB === 'dms' ? 'on' : ''}" data-act="chatTab" data-v="dms">Messages</button>
        <button class="${CHAT_TAB === 'groups' ? 'on' : ''}" data-act="chatTab" data-v="groups">Communities</button>
      </div>
      <div class="mt12">
        ${CHAT_TAB === 'dms' ? (dms.length ? dms.map((t) => {
          const peer = dmPeer(t);
          const last = t.messages[t.messages.length - 1];
          const unread = threadUnread(t);
          return `<button class="thread-item" data-act="go" data-to="/thread/${t.id}">${avatar(peer.name, peer.hue, 50, peer.img)}
            <span class="grow"><span class="row between"><b>${esc(peer.name)}</b><span class="xs muted">${last ? ago(last.t) : ''}</span></span>
            <span class="row between gap8"><span class="small muted ellip">${last ? (last.from === 'me' ? 'You: ' : '') + esc(last.text) : 'Say hi 👋'}</span>${unread ? `<span class="unread">${unread}</span>` : ''}</span></span></button>`;
        }).join('') : '<div class="empty">No messages yet — DM any barber from their profile or a short</div>') : `
          ${joined.map(communityRow).join('')}
          <div class="label">Discover communities</div>
          ${discover.map((t) => `
            <div class="listitem">
              <span class="thumb" style="background:linear-gradient(135deg,hsl(${t.hue},80%,60%),hsl(${(t.hue + 60) % 360},80%,45%))">${icon('users', 22)}</span>
              <span class="grow"><b class="small">${esc(t.title)}</b><div class="xs muted">${compact(t.members)} members · ${esc(t.desc || '')}</div></span>
              <button class="btn xs primary" data-act="join" data-id="${t.id}">Join</button>
            </div>`).join('') || '<div class="empty">You joined them all 🙌</div>'}`}
      </div>`;
  };

  function lastT(t) {
    const last = t.messages[t.messages.length - 1];
    return last ? last.t : 0;
  }

  const typing = {};

  VIEWS.thread = function (id) {
    const t = S.threads.find((x) => x.id === id);
    if (!t) return `${pageHead('Chat')}<div class="empty">Conversation not found</div>`;
    S.readMarks[t.id] = lastT(t);
    if (t.unread) t.unread = 0;
    save();
    const isDm = t.type === 'dm';
    const peer = isDm ? dmPeer(t) : null;
    const title = isDm ? peer.name : t.title;
    const headAvatar = isDm
      ? avatar(peer.name, peer.hue, 40, peer.img)
      : `<span class="thumb" style="width:40px;height:40px;background:linear-gradient(135deg,hsl(${t.hue},80%,60%),hsl(${(t.hue + 60) % 360},80%,45%))">${icon('users', 18)}</span>`;
    const free = isDm && peer.barber ? nextFree(peer.barber) : null;
    const sub = isDm ? (t.barberSide ? 'Client' : free ? `Next free ${dayLabel(free.offset)} ${fmtTime(free.t)}` : (peer.barber || {}).title || '') : `${compact(t.members)} members`;
    const quick = isDm
      ? (t.barberSide ? ['Booked you in ✅', 'Send me a reference pic 📸', 'See you soon!'] : ['Any slots today?', 'Here’s the cut I want 📸', 'Which place are you at Saturday?', 'Running 10 min late 🙏'])
      : ['🔥🔥🔥', 'Who’s free tonight?', 'Drop your fresh cuts 👇'];
    const canPost = t.type !== 'group' || t.joined;
    return `
      <div class="pagehead" style="padding-left:14px;padding-right:14px;margin:0 -18px;padding-top:14px;border-bottom:1px solid var(--line)">
        <button class="iconbtn" data-act="back" aria-label="Back">${icon('back')}</button>
        <button class="row gap10 grow" style="text-align:left" ${isDm && peer.path ? `data-act="go" data-to="${peer.path}"` : ''}>${headAvatar}
          <span class="grow"><b class="ellip" style="display:block">${esc(title)}</b><span class="xs muted">${esc(sub)}</span></span></button>
        ${isDm ? (peer.barber && !t.barberSide ? `<button class="btn xs primary" data-act="book" data-id="${peer.barber.id}">Book</button>` : '')
          : (t.joined ? `<button class="btn xs" data-act="leave" data-id="${t.id}">Leave</button>` : `<button class="btn xs primary" data-act="join" data-id="${t.id}">Join</button>`)}
      </div>
      ${!isDm && t.desc ? `<div class="xs muted center mt12">${esc(t.desc)}</div>` : ''}
      <div class="msgs" id="msgs">
        ${t.messages.map((m) => messageHTML(m, isDm)).join('')}
        ${typing[t.id] ? `<div class="typing">${esc(typing[t.id])} is typing…</div>` : ''}
      </div>
      ${canPost ? `<div class="quickreplies">${quick.map((q) => `<button class="chip" data-act="quick" data-text="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
      ${canPost
        ? `<div class="composer"><input id="msg" placeholder="Message…" autocomplete="off" aria-label="Message" maxlength="1000"><button class="send" data-act="send" data-id="${t.id}" aria-label="Send">${icon('send', 18)}</button></div>`
        : `<div class="composer"><button class="btn primary block" data-act="join" data-id="${t.id}">Join to chat</button></div>`}`;
  };

  function messageHTML(m, isDm) {
    if (m.from === 'me') return `<div class="msg me">${esc(m.text)}</div>`;
    if (isDm) return `<div class="msg">${esc(m.text)}</div>`;
    const b = barberById(m.from);
    const name = b ? b.name : m.name || m.from;
    const av = b ? barberAvatar(b, 26) : avatar(name, hash(name) % 360, 26);
    return `<div class="msg-row">${av}<div class="msg"><div class="who">${esc(name)}${b ? '<span class="badge acc">Barber</span>' : ''}</div>${esc(m.text)}</div></div>`;
  }

  const DM_REPLIES = [
    'Yo! Got you 🙌',
    'Send me a pic of what you want and I’ll make it happen ✂️',
    'Check my schedule tab — I rotate shops, pick the one closest to you 📍',
    'Bet, see you then 🔥',
    'Appreciate the love fam 🙏',
    'I can squeeze you in — grab the slot in the app so it’s locked.',
  ];
  const GROUP_NAMES = ['Rizky A.', 'Nadia P.', 'Kevin T.', 'Sarah L.', 'Budi S.'];
  const GROUP_REPLIES = ['Facts 💯', 'Need this!', 'Clean 🔥', 'Who’s cutting at Kemang today?', 'Booked Marcus off this thread lol'];

  async function sendMessage(threadId, text) {
    const t = S.threads.find((x) => x.id === threadId);
    const clean = (text || '').trim();
    if (!t || !clean) return;
    if (API.on) {
      t.messages.push({ from: 'me', text: clean, t: Date.now() });
      refresh();
      try {
        await API.req('POST', `/api/threads/${threadId}/messages`, { text: clean });
      } catch (err) {
        toast(err.message);
      }
      await pull().catch(() => {});
      if (currentPath === `/thread/${threadId}`) refresh();
      return;
    }
    t.messages.push({ from: 'me', text: clean, t: Date.now() });
    save();
    refresh();
    const isDm = t.type === 'dm';
    const responder = isDm ? barberById(t.barberId).name : GROUP_NAMES[hash(clean) % GROUP_NAMES.length];
    setTimeout(() => {
      typing[t.id] = firstName(responder);
      if (currentPath === `/thread/${t.id}`) refresh();
    }, 600);
    setTimeout(() => {
      delete typing[t.id];
      const pool = isDm ? DM_REPLIES : GROUP_REPLIES;
      t.messages.push({ from: isDm ? t.barberId : responder, name: responder, text: pool[hash(clean + t.messages.length) % pool.length], t: Date.now() });
      if (currentPath === `/thread/${t.id}`) {
        save();
        refresh();
      } else {
        t.unread = (t.unread || 0) + 1;
        save();
        renderTabbar(parseRoute().page);
      }
    }, 1900);
  }

  async function openDm(barberId) {
    closeSheet();
    if (API.on) {
      try {
        const result = await API.req('POST', '/api/dm', { barberId });
        await pull();
        go(`/thread/${result.threadId}`);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    let t = S.threads.find((x) => x.type === 'dm' && x.barberId === barberId);
    if (!t) {
      t = { id: uid('t'), type: 'dm', barberId, unread: 0, messages: [] };
      S.threads.push(t);
      save();
    }
    go(`/thread/${t.id}`);
  }

  // ---------- Leaderboards ----------
  const RK = { type: 'barbers', period: 'week', scope: 'local' };

  VIEWS.ranks = function () {
    const rows = leaderboard(RK.type, RK.period, RK.scope);
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const podiumOrder = [top[1], top[0], top[2]].filter(Boolean);
    const target = (r) => (r.kind === 'barber' ? `/barber/${r.id}` : r.kind === 'place' ? `/place/${r.id}` : r.kind === 'creator' ? `/user/${r.id}` : '/rewards');
    const movement = (r, i) => {
      const prev = (hash(r.name + RK.period) % 5) - 2;
      if (prev === 0) return '<span class="move muted">—</span>';
      return prev > 0 ? `<span class="move ok">▲${prev}</span>` : `<span class="move hot">▼${-prev}</span>`;
    };
    const prize = {
      barbers: 'Weekly #1 gets 0% platform fee next week + a featured spot in Cuts.',
      places: 'Top place gets the homepage banner and a "Shop of the Week" badge.',
      clients: 'Top clients win free cuts, merch drops and early access.',
      creators: 'Top creators get a featured spot in Shorts and priority sponsored deals.',
    }[RK.type];
    return `
      ${pageHead('Leaderboard', { noBack: S.role === 'barber' || S.role === 'owner' })}
      <div class="seg">
        ${[['barbers', 'Barbers'], ['places', 'Places'], ['creators', 'Creators'], ['clients', 'Clients']].map(([v, l]) => `<button class="${RK.type === v ? 'on' : ''}" data-act="rk" data-k="type" data-v="${v}">${l}</button>`).join('')}
      </div>
      <div class="row between mt12">
        <div class="chips" style="margin:0;padding:0">${[['week', 'This week'], ['month', 'Month'], ['all', 'All-time']].map(([v, l]) => `<button class="chip ${RK.period === v ? 'on' : ''}" data-act="rk" data-k="period" data-v="${v}">${l}</button>`).join('')}</div>
        ${RK.type === 'barbers' || RK.type === 'places' ? `<button class="chip" data-act="rk" data-k="scope" data-v="${RK.scope === 'local' ? 'global' : 'local'}">${RK.scope === 'local' ? '📍 Jakarta' : '🌍 Global'}</button>` : ''}
      </div>
      <div class="row between mt12 xs"><span class="muted">${resetCountdown(RK.period)}</span><span class="gold">${icon('trophy', 12)} Prizes</span></div>
      <div class="podium">${podiumOrder.map((r) => {
        const pos = rows.indexOf(r) + 1;
        const visual = r.kind === 'place' ? `<span class="thumb" style="width:56px;height:56px;margin:0 auto;${placeCover(placeById(r.id))}"></span>` : avatar(r.name, r.hue, pos === 1 ? 64 : 52, r.img);
        return `<button class="pod p${pos}" data-act="go" data-to="${target(r)}">${pos === 1 ? '<span class="crown">👑</span>' : ''}
          <div style="display:flex;justify-content:center">${visual}</div>
          <div class="nm">${esc(r.name)}</div><div class="sc">${fmtNum(r.score)}</div><div class="rank">#${pos}</div></button>`;
      }).join('')}</div>
      <div class="card xs muted mt12" style="line-height:1.5">${prize} Scores combine cuts, ratings, reviews and tips${RK.type === 'clients' ? ' — clients climb with points' : ''}.</div>
      <div class="mt12">${rest.map((r, i) => `
        <button class="lbrow ${r.me ? 'me' : ''}" data-act="go" data-to="${target(r)}">
          <span class="pos">${i + 4}</span>
          ${r.kind === 'place' ? `<span class="thumb" style="width:38px;height:38px;${placeCover(placeById(r.id))}"></span>` : avatar(r.name, r.hue, 38, r.img)}
          <span class="grow"><b class="small ellip" style="display:block">${esc(r.name)}</b><span class="xs muted ellip">${esc(r.sub)}</span></span>
          <b class="small acc">${fmtNum(r.score)}</b>${movement(r, i)}
        </button>`).join('')}</div>`;
  };

  // ---------- Shop ----------
  let SHOP_CAT = 'All';

  function productCard(p) {
    const seller = p.sellerType === 'barber' ? barberById(p.sellerId).name : placeById(p.sellerId).name;
    return `
      <button class="prod" data-act="product" data-id="${p.id}">
        <div class="pimg" style="background:radial-gradient(circle at 30% 20%,hsla(${p.hue},90%,60%,.35),transparent 60%),linear-gradient(135deg,hsl(${p.hue},35%,18%),hsl(${(p.hue + 40) % 360},35%,10%))">
          ${p.sold > 2500 ? '<span class="badge hot">🔥 Hot</span>' : ''}${p.emoji}
        </div>
        <div class="pbody">
          <div class="pname">${esc(p.name)}</div>
          <div class="xs muted ellip mt4">by ${esc(seller)}</div>
          <div class="row between mt8"><b>${money(p.price)}</b><span class="xs muted">★ ${p.rating}</span></div>
        </div>
      </button>`;
  }

  VIEWS.shop = function () {
    const cats = ['All', 'Styling', 'Beard', 'Care', 'Tools', 'Merch'];
    const list = S.products.filter((p) => SHOP_CAT === 'All' || p.cat === SHOP_CAT);
    const count = S.cart.reduce((n, i) => n + i.qty, 0);
    return `
      ${pageHead('Shop', { right: `<button class="iconbtn" data-act="cart">${icon('bag', 18)}${count ? `<span class="dot">${count}</span>` : ''}</button>` })}
      <div class="card row gap12" style="background:linear-gradient(135deg,rgba(255,77,109,.18),rgba(124,92,255,.15))">
        <span style="font-size:30px">💈</span>
        <div class="grow small"><b>Products from your barbers</b><div class="muted xs mt4">Buy what they use on you. Pick up at the shop or get it delivered. Earn points on every order.</div></div>
      </div>
      <div class="chips mt12">${cats.map((c) => `<button class="chip ${SHOP_CAT === c ? 'on' : ''}" data-act="shopCat" data-v="${c}">${c}</button>`).join('')}</div>
      <div class="grid2 mt12">${list.map(productCard).join('')}</div>`;
  };

  function openProduct(id) {
    const p = productById(id);
    const sellerName = p.sellerType === 'barber' ? barberById(p.sellerId).name : placeById(p.sellerId).name;
    const sellerPath = p.sellerType === 'barber' ? `/barber/${p.sellerId}` : `/place/${p.sellerId}`;
    const pickup = placeById(p.placeId);
    openSheet(`
      <div class="sheet-head"><h2 class="grow">${esc(p.name)}</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
      <div class="pimg mt12" style="height:200px;border-radius:22px;display:grid;place-items:center;font-size:90px;background:radial-gradient(circle at 30% 20%,hsla(${p.hue},90%,60%,.35),transparent 60%),linear-gradient(135deg,hsl(${p.hue},35%,18%),hsl(${(p.hue + 40) % 360},35%,10%))">${p.emoji}</div>
      <div class="row between mt12"><b style="font-size:24px">${money(p.price)}</b><span class="small">★ ${p.rating} · ${compact(p.sold)} sold</span></div>
      <p class="small mt8" style="line-height:1.5">${esc(p.desc)}</p>
      <button class="listitem mt12" data-act="go" data-to="${sellerPath}">
        <span class="grow small">Sold by <b>${esc(sellerName)}</b><div class="xs muted">Pickup at ${esc(pickup.name)}, ${esc(pickup.city)}</div></span>${icon('chev', 16)}
      </button>
      <div class="row gap8 mt16">
        <button class="btn grow" data-act="addCart" data-id="${p.id}">${icon('plus', 16)} Add to bag</button>
        <button class="btn primary grow" data-act="buyNow" data-id="${p.id}">Buy now</button>
      </div>`);
  }

  let CART = { delivery: 'pickup', method: null };

  function cartHTML() {
    const items = S.cart.map((i) => ({ ...i, p: productById(i.id) }));
    if (!items.length) {
      return `<div class="sheet-head"><h2 class="grow">Your bag</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
        <div class="empty">Bag is empty</div><button class="btn primary block" data-act="goShop">Browse products</button>`;
    }
    const subtotal = round2(items.reduce((s, i) => s + i.p.price * i.qty, 0));
    const memberDisc = S.user.plan !== 'free' ? round2(subtotal * 0.05) : 0;
    const delivery = CART.delivery === 'delivery' ? DELIVERY_FEE : 0;
    const total = round2(subtotal - memberDisc + delivery);
    const method = CART.method || S.user.method;
    const pickups = [...new Set(items.map((i) => i.p.placeId))].map(placeById);
    return `
      <div class="sheet-head"><h2 class="grow">Your bag</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
      <div class="mt12">${items.map((i) => `
        <div class="listitem"><span class="thumb" style="background:hsl(${i.p.hue},35%,18%);font-size:26px">${i.p.emoji}</span>
          <span class="grow"><b class="small ellip" style="display:block">${esc(i.p.name)}</b><span class="xs muted">${money(i.p.price)}</span></span>
          <span class="qty"><button data-act="qty" data-id="${i.id}" data-d="-1">−</button><b class="small">${i.qty}</b><button data-act="qty" data-id="${i.id}" data-d="1">+</button></span>
        </div>`).join('')}</div>
      <div class="label">Get it</div>
      <div class="seg">
        <button class="${CART.delivery === 'pickup' ? 'on' : ''}" data-act="cartDelivery" data-v="pickup">Pick up at next cut</button>
        <button class="${CART.delivery === 'delivery' ? 'on' : ''}" data-act="cartDelivery" data-v="delivery">Delivery +${money(DELIVERY_FEE)}</button>
      </div>
      ${CART.delivery === 'pickup' ? `<div class="xs muted mt8">Ready at: ${pickups.map((p) => esc(p.name)).join(', ')}</div>` : ''}
      <div class="label">Pay with</div>
      ${paymentMethodsHTML(method, 'cartMethod')}
      <div class="card breakdown mt12">
        <div class="ln"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        ${memberDisc ? `<div class="ln acc"><span>Member −5%</span><span>−${money(memberDisc)}</span></div>` : ''}
        ${delivery ? `<div class="ln"><span>Delivery</span><span>${money(delivery)}</span></div>` : ''}
        <div class="ln total"><span>Total</span><span>${money(total)}</span></div>
      </div>
      <p class="xs muted mt8">Earn <b class="acc">+${fmtNum(pointsEarned(total, S.user.plan, false))} pts</b>. Sellers get paid directly; the place hosting the pickup gets a small handling share.</p>
      <button class="btn primary block mt12" data-act="checkout" data-total="${total}">Pay ${money(total)}</button>`;
  }

  async function checkout(total) {
    const method = CART.method || S.user.method;
    const ref = activeRef();
    if (API.on) {
      try {
        const result = await API.req('POST', '/api/orders', {
          items: S.cart.map((i) => ({ id: i.id, qty: i.qty })), delivery: CART.delivery, method, refShortId: ref,
        });
        S.cart = [];
        save();
        await pull();
        orderDone(result.earned);
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (!charge(total, method, `Shop order · ${S.cart.length} item${S.cart.length > 1 ? 's' : ''}`)) return;
    const earned = pointsEarned(total, S.user.plan, false);
    addPoints(earned);
    S.orders.unshift({ id: uid('o'), items: clone(S.cart), total, delivery: CART.delivery, date: new Date().toISOString(), refShortId: ref });
    const short = ref ? S.shorts.find((sh) => sh.id === ref) : null;
    S.cart.forEach((i) => {
      const product = productById(i.id);
      product.sold += i.qty;
      if (short && !isMyShort(short) && short.authorType === 'user' &&
          approvedTagFor(short, product.sellerType === 'barber' ? product.sellerId : null, product.sellerType === 'place' ? product.sellerId : null)) {
        short.conversions = (short.conversions || 0) + 1;
      }
    });
    S.cart = [];
    save();
    orderDone(earned);
  }

  function orderDone(earned) {
    setSheet(`<div class="success"><div class="big">${icon('check', 44, 'stroke-width="3"')}</div>
      <h2 style="font-size:24px;font-weight:900">Order placed</h2>
      <p class="muted mt8">${CART.delivery === 'pickup' ? 'We’ll have it ready at your barber’s chair.' : 'Shipping in 1–2 days.'}</p>
      <div class="pill pts mt16" style="display:inline-flex">${icon('zap', 14)} +${fmtNum(earned)} points</div>
      <button class="btn block mt20" data-act="closeSheet">Done</button></div>`);
    confetti();
    refresh();
  }

  // ---------- Me ----------
  let installPrompt = null;

  VIEWS.me = function () {
    const u = S.user;
    const { current, next } = rankFor(u.lifetime);
    const plan = planOf(u.plan);
    const done = myBookings().filter((b) => b.status === 'completed');
    const myShorts = shortsByUser('me');
    const meBarber = S.meBarberId ? barberById(S.meBarberId) : null;
    const item = (ic, label, to, sub = '', act = 'go') => `
      <button class="listitem" data-act="${act}" data-to="${to}">
        <span class="thumb" style="width:40px;height:40px;background:var(--card2);color:var(--text)">${icon(ic, 18)}</span>
        <span class="grow"><b class="small">${label}</b>${sub ? `<div class="xs muted">${sub}</div>` : ''}</span>${icon('chev', 16)}
      </button>`;
    const roleButton = (value, label, allowed) =>
      `<button class="${S.role === value ? 'on' : ''}" data-act="role" data-v="${value}" ${allowed ? '' : 'disabled'}>${label}</button>`;
    return `
      ${pageHead('Profile', { noBack: S.role !== 'customer' })}
      <button class="card tap row gap12" data-act="go" data-to="/user/me">
        <span class="ring">${avatar(u.name || 'You', u.hue, 64)}</span>
        <span class="grow">
          <b style="font-size:19px">${esc(u.name)}</b>
          <div class="small muted">@${esc(u.handle)} · ${esc(u.location.label)}</div>
          <div class="row gap6 mt8"><span class="badge" style="background:${current.color}22;color:${current.color}">${current.name}</span>${plan.id !== 'free' ? `<span class="badge premium">${icon('crown', 10)} ${plan.name}</span>` : ''}</div>
        </span>${icon('chev', 16)}
      </button>
      <div class="statrow">
        <div class="stat"><b>${fmtNum(u.points)}</b><span>points</span></div>
        <div class="stat"><b>${compact(u.followers || 0)}</b><span>followers</span></div>
        <div class="stat"><b>${S.following.length}</b><span>following</span></div>
        <div class="stat"><b>${money(u.wallet).replace('.00', '')}</b><span>wallet</span></div>
      </div>
      ${next ? `<div class="mt12"><div class="row between xs muted"><span>${current.name}</span><span>${fmtNum(next.min - u.lifetime)} pts to ${next.name}</span></div><div class="progress mt4"><span style="width:${Math.min(100, ((u.lifetime - current.min) / (next.min - current.min)) * 100)}%"></span></div></div>` : ''}

      <div class="label">Creator</div>
      ${item('play', 'My shorts', '/user/me', `${myShorts.length} posted · ${compact(myShorts.reduce((s, sh) => s + sh.views, 0))} views`)}
      ${item('dollar', 'Creator earnings', '/creator', `${money(creatorSummary().available)} available · ${money(creatorSummary().pending)} pending`)}

      <div class="label">Account</div>
      ${item('wallet', 'Wallet & cards', '/wallet', `${money(u.wallet)} · ${u.cards.length} card${u.cards.length === 1 ? '' : 's'}`)}
      ${item('crown', 'Membership', '/membership', plan.id === 'free' ? 'Save on every cut' : `${plan.name} · ${money(plan.price)}/mo`)}
      ${item('gift', 'Rewards & challenges', '/rewards', 'Chase points, climb ranks')}
      ${item('history', 'Cut history', '/history', `${done.length} cuts with notes`)}
      ${item('calendar', 'Bookings', '/bookings')}
      ${item('bag', 'Shop', '/shop', S.orders.length ? `${S.orders.length} order${S.orders.length > 1 ? 's' : ''}` : 'Products from your barbers')}
      ${item('trophy', 'Leaderboards', '/ranks')}

      <div class="label">Switch mode</div>
      <div class="seg">
        ${roleButton('customer', 'Customer', true)}
        ${roleButton('barber', 'Barber', !!S.meBarberId)}
        ${roleButton('owner', 'Shop owner', !!S.mePlaceId)}
      </div>
      <p class="xs muted mt8">${meBarber ? `Barber mode uses the profile <b>${esc(meBarber.name)}</b>. ` : ''}${API.on
        ? (S.meBarberId || S.mePlaceId ? '' : 'Barber and shop modes are for accounts created as a barber or shop owner.')
        : '<a class="acc" data-act="go" data-to="/join">Create your own barber profile →</a>'}</p>

      <div class="label">App</div>
      ${installPrompt ? item('download', 'Install Fade', '', 'Add to your home screen', 'install') : ''}
      ${API.on
        ? `<div class="card small row gap10">${icon('server', 18)}<span class="grow">Connected to <b>${esc(API.base)}</b><div class="xs muted">${esc(u.email || u.name)}</div></span></div>
           <button class="btn block mt8" data-act="logout">${icon('logout', 16)} Log out</button>`
        : `${item('server', 'Connect to a Fade server', '', 'Real accounts, shared bookings, shorts & payouts', 'connectServer')}
           <button class="btn ghost block mt12 hot" data-act="reset">Reset demo data</button>`}
      <p class="xs muted center mt16">Fade ${VERSION} · ${API.on ? 'online' : 'offline demo — data stays on this device'}</p>`;
  };

  // ---------- Wallet ----------
  VIEWS.wallet = function () {
    const u = S.user;
    return `
      ${pageHead('Wallet')}
      <div class="ccard">
        <div class="row between"><span class="small muted">Fade balance</span><span class="badge acc">Instant</span></div>
        <div class="bal">${money(u.wallet)}</div>
        <div class="row gap8 mt16">
          <button class="btn sm primary" data-act="topup">${icon('plus', 16)} Top up</button>
          <button class="btn sm" data-act="go" data-to="/membership">${icon('crown', 16)} ${planOf(u.plan).name}</button>
        </div>
      </div>
      <div class="label">Cards</div>
      ${u.cards.map((c) => `
        <div class="paym ${u.method === c.id ? 'on' : ''}">
          <span class="brand ${brandClass(c.brand)}">${c.brand.slice(0, 4).toUpperCase()}</span>
          <span class="grow"><b class="small">${esc(c.brand)} •••• ${esc(c.last4)}</b><div class="xs muted">Expires ${esc(c.exp)}${u.method === c.id ? ' · default' : ''}</div></span>
          ${u.method === c.id ? '' : `<button class="btn xs" data-act="defaultMethod" data-id="${c.id}">Default</button>`}
          <button class="btn xs" data-act="removeCard" data-id="${c.id}">${icon('trash', 14)}</button>
        </div>`).join('')}
      <div class="paym ${u.method === 'wallet' ? 'on' : ''}"><span class="brand wallet">W</span><span class="grow"><b class="small">Wallet balance</b><div class="xs muted">${u.method === 'wallet' ? 'Default' : 'Use as default'}</div></span>${u.method === 'wallet' ? '' : `<button class="btn xs" data-act="defaultMethod" data-id="wallet">Default</button>`}</div>
      <button class="btn block mt12" data-act="addCard">${icon('card', 18)} Add credit / debit card</button>
      <div class="label">Activity</div>
      ${S.txns.slice(0, 25).map((t) => `
        <div class="row gap12" style="padding:10px 0;border-bottom:1px solid var(--line)">
          <span class="thumb" style="width:36px;height:36px;background:var(--card2);color:${t.amount > 0 ? 'var(--ok)' : 'var(--text)'}">${icon(t.amount > 0 ? 'down' : 'up', 16)}</span>
          <span class="grow"><b class="small ellip" style="display:block">${esc(t.label)}</b><span class="xs muted">${new Date(t.date).toLocaleDateString()} · ${esc(t.method)}</span></span>
          <b class="small ${t.amount > 0 ? 'ok' : ''}">${t.amount > 0 ? '+' : ''}${money(t.amount)}</b>
        </div>`).join('') || '<div class="empty">No activity</div>'}`;
  };

  function luhnValid(num) {
    let sum = 0;
    let dbl = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = Number(num[i]);
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return num.length >= 13 && sum % 10 === 0;
  }

  function cardBrand(num) {
    if (/^4/.test(num)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
    if (/^3[47]/.test(num)) return 'Amex';
    if (/^6/.test(num)) return 'Discover';
    return 'Card';
  }

  let returnSheet = null;

  function openAddCard() {
    const sheet = $('#sheet-root .sheet');
    returnSheet = sheet ? { bk: BK ? clone(BK) : null, rt: RT ? clone(RT) : null, cart: !!$('#sheet-root [data-act="checkout"]') } : null;
    openSheet(`
      <div class="sheet-head"><h2 class="grow">Add card</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
      <div class="field"><label>Card number</label><input id="cc-num" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23"></div>
      <div class="frow">
        <div class="field"><label>Expiry (MM/YY)</label><input id="cc-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="08/29" maxlength="5"></div>
        <div class="field"><label>CVC</label><input id="cc-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></div>
      </div>
      <div class="field"><label>Name on card</label><input id="cc-name" autocomplete="cc-name" placeholder="${esc(S.user.name)}"></div>
      <div class="field"><span class="err" id="cc-err"></span></div>
      <p class="xs muted">Only the brand, last 4 digits and expiry are kept — the full number and CVC never leave this screen. Production would hand the card straight to a payment processor (e.g. Stripe).</p>
      <button class="btn primary block mt12" data-act="saveCard">Save card</button>`);
  }

  async function saveCard() {
    const num = ($('#cc-num').value || '').replace(/\D/g, '');
    const exp = ($('#cc-exp').value || '').trim();
    const cvc = ($('#cc-cvc').value || '').trim();
    const err = $('#cc-err');
    if (!luhnValid(num)) {
      err.textContent = 'That card number doesn’t look right (try 4242 4242 4242 4242).';
      return;
    }
    const m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) {
      err.textContent = 'Expiry must be MM/YY.';
      return;
    }
    const expDate = new Date(2000 + Number(m[2]), Number(m[1]), 1);
    if (expDate <= new Date()) {
      err.textContent = 'This card has expired.';
      return;
    }
    if (!/^\d{3,4}$/.test(cvc)) {
      err.textContent = 'CVC must be 3–4 digits.';
      return;
    }
    let card;
    if (API.on) {
      try {
        const result = await API.req('POST', '/api/cards', { brand: cardBrand(num), last4: num.slice(-4), exp });
        card = result.card;
        await pull();
      } catch (failure) {
        err.textContent = failure.message;
        return;
      }
    } else {
      card = { id: uid('c'), brand: cardBrand(num), last4: num.slice(-4), exp };
      S.user.cards.push(card);
      save();
    }
    toast(`${card.brand} •••• ${card.last4} added`);
    const back = returnSheet;
    returnSheet = null;
    closeSheet();
    if (back && back.bk) {
      BK = back.bk;
      BK.method = card.id;
      openSheet(bookingHTML());
    } else if (back && back.rt) {
      RT = back.rt;
      RT.method = card.id;
      openSheet(rateHTML());
    } else if (back && back.cart) {
      CART.method = card.id;
      openSheet(cartHTML());
    }
    refresh();
  }

  function openTopup() {
    const cards = S.user.cards;
    if (!cards.length) {
      openAddCard();
      return;
    }
    openSheet(`
      <div class="sheet-head"><h2 class="grow">Top up wallet</h2><button class="iconbtn" data-act="closeSheet">${icon('x')}</button></div>
      <p class="small muted mt8">From ${esc(methodLabel(cards[0].id))}. Wallet payments are instant and earn the same points.</p>
      <div class="grid2 mt16">${[20, 50, 100, 200].map((a) => `<button class="btn" data-act="doTopup" data-v="${a}" data-card="${cards[0].id}">+${money(a)}</button>`).join('')}</div>`);
  }

  // ---------- Membership ----------
  VIEWS.membership = function () {
    const cur = S.user.plan;
    return `
      ${pageHead('Membership')}
      <p class="small muted">Members skip booking fees, save on every service and stack points faster. Cancel anytime.</p>
      <div class="mt16">${PLANS.map((p) => `
        <div class="plan ${p.id === cur ? 'cur' : ''} ${p.id === 'club' ? 'hl' : ''}">
          ${p.id === 'club' ? '<span class="badge premium" style="position:absolute;top:16px;right:16px">Most popular</span>' : ''}
          <b style="font-size:18px">${p.name}</b>
          <div class="price mt4">${p.price ? money(p.price) : '$0'}<span class="small muted" style="font-weight:600"> /month</span></div>
          <ul>${p.perks.map((perk) => `<li><span class="acc">${icon('check', 16)}</span>${esc(perk)}</li>`).join('')}</ul>
          ${p.id === cur ? `<button class="btn block mt12" disabled>Current plan</button>` : `<button class="btn ${p.id === 'free' ? '' : 'primary'} block mt12" data-act="subscribe" data-id="${p.id}">${p.id === 'free' ? 'Switch to Free' : `Join ${p.name}`}</button>`}
        </div>`).join('')}</div>
      <p class="xs muted mt12 center">Billed monthly to your default payment method.</p>`;
  };

  // ---------- Rewards ----------
  function challengeList() {
    const done = myBookings().filter((b) => b.status !== 'cancelled');
    const month = dkey(new Date()).slice(0, 7);
    const list = [
      { id: 'c_month3', title: 'Hat-trick', desc: 'Book 3 cuts this month', goal: 3, pts: 300, v: done.filter((b) => b.date.slice(0, 7) === month).length },
      { id: 'c_new', title: 'Explorer', desc: 'Book 4 different barbers', goal: 4, pts: 250, v: new Set(done.map((b) => b.barberId)).size },
      { id: 'c_review', title: 'Critic', desc: 'Leave 5 reviews', goal: 5, pts: 200, v: myBookings().filter((b) => b.rated).length },
      { id: 'c_tip', title: 'Big tipper', desc: 'Tip on 3 cuts', goal: 3, pts: 150, v: myBookings().filter((b) => b.tip > 0).length },
      { id: 'c_shop', title: 'Product head', desc: 'Buy from a barber shop', goal: 1, pts: 100, v: S.orders.length },
      { id: 'c_comm', title: 'Community', desc: 'Join 4 communities', goal: 4, pts: 100, v: S.threads.filter((t) => t.type === 'group' && t.joined).length },
      { id: 'c_ref', title: 'The Plug', desc: 'Invite a friend', goal: 1, pts: 500, v: S.referrals },
    ];
    if (API.on && S.progress) {
      list.forEach((c) => {
        if (S.progress[c.id] !== undefined) c.v = S.progress[c.id];
      });
    }
    return list;
  }

  const REDEEM = [
    { id: 'r5', title: '$5 cut credit', cost: 500, credit: 5, icon: '💵' },
    { id: 'r12', title: '$12 cut credit', cost: 1000, credit: 12, icon: '💸' },
    { id: 'rprio', title: 'Priority slot pass', cost: 800, icon: '⚡' },
    { id: 'rdurag', title: 'Limited Fade durag', cost: 2500, icon: '🧣' },
  ];

  VIEWS.rewards = function () {
    const u = S.user;
    const { current, next } = rankFor(u.lifetime);
    const pct = next ? Math.min(100, ((u.lifetime - current.min) / (next.min - current.min)) * 100) : 100;
    return `
      ${pageHead('Rewards')}
      <div class="rankcard">
        <div class="row between"><span class="badge" style="background:${current.color}33;color:${current.color}">${current.name}</span><span class="xs muted">${planOf(u.plan).mult}× points</span></div>
        <div class="bigpts mt8">${fmtNum(u.points)}<span class="small muted" style="font-weight:600"> pts</span></div>
        <div class="xs muted">${fmtNum(u.lifetime)} lifetime · 100 pts = $1</div>
        <div class="progress mt12"><span style="width:${pct}%"></span></div>
        <div class="xs muted mt4">${next ? `${fmtNum(next.min - u.lifetime)} pts to ${next.name}` : 'Max rank — legend status 👑'}</div>
      </div>
      <div class="card mt12 row gap12">
        <span style="font-size:26px">🎟️</span>
        <div class="grow"><b class="small">Invite friends · +500 pts each</b><div class="xs muted">Your code <b class="acc">${esc(u.refCode)}</b> — they get $5 off their first cut</div></div>
        <button class="btn xs primary" data-act="invite">Share</button>
      </div>
      <h2 class="sec">Challenges</h2>
      ${challengeList().map((c) => {
        const claimed = S.claimed[c.id];
        const ready = c.v >= c.goal && !claimed;
        return `
          <div class="listitem">
            <span class="thumb" style="width:44px;height:44px;background:${claimed ? 'var(--card2)' : 'rgba(200,255,61,.12)'};color:var(--acc);font-size:12px">+${c.pts}</span>
            <span class="grow"><b class="small">${c.title}</b><div class="xs muted">${c.desc}</div>
              <div class="progress mt8" style="height:6px"><span style="width:${Math.min(100, (c.v / c.goal) * 100)}%"></span></div></span>
            ${claimed ? '<span class="badge standard">Claimed</span>' : ready ? `<button class="btn xs primary" data-act="claim" data-id="${c.id}" data-pts="${c.pts}">Claim</button>` : `<span class="xs muted">${Math.min(c.v, c.goal)}/${c.goal}</span>`}
          </div>`;
      }).join('')}
      <h2 class="sec">Redeem</h2>
      <div class="grid2">${REDEEM.map((r) => `
        <div class="card center">
          <div style="font-size:30px">${r.icon}</div>
          <b class="small mt8" style="display:block">${r.title}</b>
          <div class="xs acc mt4">${fmtNum(r.cost)} pts</div>
          <button class="btn xs block mt8" data-act="redeem" data-id="${r.id}" ${u.points < r.cost ? 'disabled' : ''}>Redeem</button>
        </div>`).join('')}</div>`;
  };

  // ---------- Barber studio (pro dashboard) ----------
  function weekKey() {
    const d = new Date(TODAY);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return dkey(d);
  }

  function tagRequests(type, id) {
    const out = [];
    S.shorts.forEach((sh) => {
      (sh.tags || []).forEach((t, index) => {
        if (t.type === type && t.id === id && t.status === 'pending') out.push({ sh, t, index });
      });
    });
    return out;
  }

  // Creator tags waiting for approval + what creators bring in.
  function promoHTML(type, id) {
    const requests = tagRequests(type, id);
    const creatorShorts = shortsAbout(type, id).filter((sh) => sh.authorType === 'user');
    const owed = (API.on ? S.commissionsOwed : []).filter((c) => c.payerType === type && c.payerId === id && c.status !== 'void');
    const owedTotal = round2(owed.reduce((sum, c) => sum + c.amount, 0));
    const conversions = creatorShorts.reduce((sum, sh) => sum + (sh.conversions || 0), 0);
    return `
      <h2 class="sec">Creator tags ${requests.length ? `<span class="badge hot">${requests.length} new</span>` : ''}</h2>
      ${requests.map(({ sh, t, index }) => {
        const a = authorInfo(sh);
        return `
          <div class="listitem" style="align-items:flex-start">
            <div style="width:54px;flex-shrink:0">${shortTile(sh, { type, id })}</div>
            <span class="grow"><b class="small">@${esc(a.handle)}</b> <span class="small">tagged you as <b>${t.kind}</b></span>
              <div class="xs muted ellip">${esc(sh.caption)}</div>
              <div class="xs muted">If approved you pay ${Math.round(COMMISSION_RATES[t.kind] * 100)}% on bookings that come from this short.</div>
              <div class="row gap6 mt8">
                <button class="btn xs primary" data-act="tagReview" data-sid="${sh.id}" data-i="${index}" data-v="1">Approve</button>
                <button class="btn xs" data-act="tagReview" data-sid="${sh.id}" data-i="${index}" data-v="0">Decline</button>
              </div>
            </span>
          </div>`;
      }).join('') || '<div class="empty">No pending tag requests</div>'}
      <div class="kpis mt12">
        <div class="kpi"><span>Creator shorts about you</span><b>${creatorShorts.length}</b></div>
        <div class="kpi"><span>Bookings from shorts</span><b>${conversions}</b></div>
        ${API.on ? `<div class="kpi"><span>Creator commission owed</span><b>${money(owedTotal)}</b></div>` : ''}
      </div>`;
  }

  function proAppointments(b) {
    if (API.on) {
      return S.bookings
        .filter((bk) => bk.barberId === b.id && bk.status === 'upcoming')
        .sort((a, c) => bookingStart(a) - bookingStart(c))
        .slice(0, 12)
        .map((bk) => ({ key: bk.date, t: bk.time, place: placeById(bk.placeId), client: bk.customerName || 'Client', svc: { name: bk.serviceName, price: bk.quote.price }, you: false, notes: bk.notes, id: bk.id }));
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const key = dkey(addDays(TODAY, i));
      slotsFor(b, key, 30).forEach((g) => {
        g.slots.forEach((s) => {
          if (!s.taken) return;
          if (i === 0 && s.t <= nowHours()) return;
          if (hash(b.id + key + s.t) % 3 !== 0) return;
          const svc = b.services[hash(key + s.t) % b.services.length];
          out.push({ key, t: s.t, place: g.place, client: SEED.names[hash(key + s.t + b.id) % SEED.names.length], svc, you: false });
        });
      });
    }
    S.bookings.filter((bk) => bk.barberId === b.id && bk.status === 'upcoming').forEach((bk) => {
      out.push({ key: bk.date, t: bk.time, place: placeById(bk.placeId), client: `${S.user.name}`, svc: { name: bk.serviceName, price: bk.quote.price }, you: true, notes: bk.notes });
    });
    return out.sort((a, c) => a.key.localeCompare(c.key) || a.t - c.t).slice(0, 8);
  }

  function rentSummary(b) {
    const byPlace = {};
    b.schedule.forEach((s) => {
      const p = placeById(s.placeId);
      if (!byPlace[p.id]) byPlace[p.id] = { p, shifts: 0, rent: 0, kit: 0 };
      byPlace[p.id].shifts += 1;
      byPlace[p.id].rent += p.rent;
      byPlace[p.id].kit += p.kitFee;
    });
    return Object.values(byPlace);
  }

  VIEWS.pro = function () {
    const b = barberById(S.meBarberId);
    if (!b) return `${pageHead('Barber studio', { noBack: true })}<div class="empty">No barber profile yet</div><button class="btn primary block" data-act="go" data-to="/join">Create barber profile</button>`;
    const avgPrice = b.services.reduce((s, x) => s + x.price, 0) / b.services.length;
    const earnings = round2(b.stats.week.cuts * avgPrice + b.stats.week.tips);
    const rents = rentSummary(b);
    const rentTotal = rents.reduce((s, r) => s + r.rent + r.kit, 0);
    const paid = API.on ? Object.fromEntries((S.rentPaidThisWeek || []).map((id) => [id, true])) : S.rentPaid[weekKey()] || {};
    const due = rents.filter((r) => !paid[r.p.id]).reduce((s, r) => s + r.rent + r.kit, 0);
    const rank = leaderboard('barbers', 'week', 'local').findIndex((r) => r.id === b.id) + 1;
    const appts = proAppointments(b);
    const prods = S.products.filter((p) => p.sellerType === 'barber' && p.sellerId === b.id);
    const sortedShifts = [...b.schedule].map((s, idx) => ({ ...s, idx })).sort((a, c) => DOW_ORDER.indexOf(a.dow) - DOW_ORDER.indexOf(c.dow) || a.from - c.from);
    return `
      <div class="topbar">
        <div class="row gap10">${barberAvatar(b, 40)}<div><b>${esc(b.name)}</b><div class="xs muted">Barber studio</div></div></div>
        <button class="btn xs" data-act="go" data-to="/barber/${b.id}">View public profile</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Earned this week</span><b class="acc">${money(earnings)}</b><span>${b.stats.week.cuts} cuts · ${money(b.stats.week.tips)} tips</span></div>
        <div class="kpi"><span>Chair rent + kits</span><b>${money(rentTotal)}</b><span>${due > 0 ? `<span class="hot">${money(due)} due</span>` : '<span class="ok">All paid</span>'}</span></div>
        <div class="kpi"><span>Net this week</span><b>${money(earnings - rentTotal)}</b><span>after rent</span></div>
        <div class="kpi"><span>Jakarta rank</span><b class="gold">#${rank}</b><span>${fmtNum(barberScore(b, 'week'))} pts</span></div>
      </div>

      <h2 class="sec">Next clients</h2>
      ${appts.length ? appts.map((a) => `
        <div class="listitem">
          <div class="center" style="width:52px"><div class="xs muted">${dayLabel(offsetOf(a.key)).slice(0, 3)}</div><b class="small">${fmtTime(a.t).replace(':00', '')}</b></div>
          <span class="grow"><b class="small">${esc(a.client)}${a.you || a.id ? ' <span class="badge acc">app booking</span>' : ''}</b><div class="xs muted">${esc(a.svc.name)} · ${esc(a.place.short)}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></span>
          <span class="col" style="align-items:flex-end;gap:4px"><b class="small">${money(a.svc.price)}</b>${a.id ? `<button class="btn xs primary" data-act="proComplete" data-id="${a.id}">Done</button>` : ''}</span>
        </div>`).join('') : '<div class="empty">No clients booked yet</div>'}

      ${promoHTML('barber', b.id)}

      <h2 class="sec">Chair rent this week</h2>
      ${rents.length ? rents.map((r) => `
        <div class="listitem">
          <span class="thumb" style="width:44px;height:44px;${placeCover(r.p)}"></span>
          <span class="grow"><b class="small">${esc(r.p.name)}</b> ${tierBadge(r.p)}<div class="xs muted">${r.shifts} shift${r.shifts > 1 ? 's' : ''} × ${money(r.p.rent)} rent + ${money(r.p.kitFee)} product kit</div></span>
          ${paid[r.p.id] ? '<span class="badge acc">Paid</span>' : `<button class="btn xs primary" data-act="payRent" data-id="${r.p.id}" data-amt="${r.rent + r.kit}">Pay ${money(r.rent + r.kit)}</button>`}
        </div>`).join('') : '<div class="empty">Add a shift to rent a chair</div>'}

      <h2 class="sec">My shifts <span class="xs muted">part-time anywhere</span></h2>
      ${sortedShifts.map((s) => {
        const p = placeById(s.placeId);
        return `<div class="shift"><div class="when"><b style="font-size:15px">${DOW[s.dow]}</b></div>
          <div class="grow"><b class="small">${esc(p.name)}</b><div class="xs muted">${fmtHours(s.from, s.to)} · ${money(p.rent)}/day</div></div>
          <button class="btn xs" data-act="proDelShift" data-idx="${s.idx}">${icon('trash', 14)}</button></div>`;
      }).join('') || '<div class="empty">No shifts yet</div>'}
      <div class="card mt12">
        <b class="small">Add a shift</b>
        <div class="frow">
          <div class="field"><label>Day</label><select id="sh-dow">${DOW_ORDER.map((d) => `<option value="${d}">${DOW[d]}</option>`).join('')}</select></div>
          <div class="field"><label>Place</label><select id="sh-place">${S.places.map((p) => `<option value="${p.id}" ${b.city !== p.city ? '' : ''}>${esc(p.name)} · ${money(p.rent)}</option>`).join('')}</select></div>
        </div>
        <div class="frow">
          <div class="field"><label>From</label><select id="sh-from">${hourOptions(10)}</select></div>
          <div class="field"><label>To</label><select id="sh-to">${hourOptions(18)}</select></div>
        </div>
        <button class="btn primary block mt12" data-act="proAddShift">${icon('plus', 16)} Rent chair & add shift</button>
      </div>

      <h2 class="sec">Services & prices</h2>
      ${b.services.map((s) => `
        <div class="svc"><div><b class="small">${esc(s.name)}</b><div class="xs muted">${s.mins} min</div></div>
        <div class="row gap6"><span class="muted">$</span><input class="inline-input" type="number" min="1" step="1" value="${s.price}" data-change="svcPrice" data-id="${s.id}"></div></div>`).join('')}
      <div class="row gap8 mt8">
        <input class="input grow" id="svc-name" placeholder="New service name">
        <input class="inline-input" id="svc-price" type="number" placeholder="$" style="height:48px">
        <button class="btn" data-act="proAddService">${icon('plus', 16)}</button>
      </div>

      <h2 class="sec">Portfolio</h2>
      <div class="grid3">
        <label class="tile add">${icon('upload', 22)}<span class="xs">Upload</span><input type="file" id="pf-file" accept="image/*" hidden></label>
        ${b.portfolio.map((p) => `<div style="position:relative">${tile(p)}<button class="iconbtn" style="position:absolute;top:4px;left:4px;width:28px;height:28px;border-radius:9px" data-act="proDelPf" data-id="${p.id}">${icon('x', 14)}</button></div>`).join('')}
      </div>

      <h2 class="sec">My shop</h2>
      ${prods.map((p) => `<div class="listitem"><span class="thumb" style="background:hsl(${p.hue},35%,18%);font-size:24px">${p.emoji}</span><span class="grow"><b class="small">${esc(p.name)}</b><div class="xs muted">${money(p.price)} · ${compact(p.sold)} sold</div></span></div>`).join('') || '<div class="empty">No products yet</div>'}
      <div class="card mt12">
        <b class="small">List a product</b>
        <div class="field"><label>Name</label><input id="np-name" placeholder="e.g. Signature Matte Paste"></div>
        <div class="frow">
          <div class="field"><label>Price ($)</label><input id="np-price" type="number" min="1" placeholder="15"></div>
          <div class="field"><label>Category</label><select id="np-cat">${['Styling', 'Beard', 'Care', 'Tools', 'Merch'].map((c) => `<option>${c}</option>`).join('')}</select></div>
        </div>
        <button class="btn block mt12" data-act="proAddProduct">${icon('plus', 16)} List in shop</button>
      </div>
      <div style="height:16px"></div>`;
  };

  function hourOptions(selected) {
    let out = '';
    for (let h = 6; h <= 23; h += 0.5) {
      out += `<option value="${h}" ${h === selected ? 'selected' : ''}>${fmtTime(h)}</option>`;
    }
    return out;
  }

  // ---------- Join as barber ----------
  VIEWS.join = function () {
    return `
      ${pageHead('Join as a barber')}
      <p class="small muted" style="line-height:1.5">Barbers anywhere in the world can join. Build your profile, rent chairs at any partner shop by the day, and get booked, paid and tipped directly.</p>
      <div class="field"><label>Full name</label><input id="jn-name" placeholder="Your name"></div>
      <div class="field"><label>Handle</label><input id="jn-handle" placeholder="fadesbyyou"></div>
      <div class="frow">
        <div class="field"><label>City</label><input id="jn-city" placeholder="Jakarta" value="Jakarta"></div>
        <div class="field"><label>Years cutting</label><input id="jn-years" type="number" min="0" value="3"></div>
      </div>
      <div class="field"><label>Specialties (comma separated)</label><input id="jn-tags" placeholder="Skin fade, Beard, Designs"></div>
      <div class="frow">
        <div class="field"><label>Main service</label><input id="jn-svc" placeholder="Signature Cut" value="Signature Cut"></div>
        <div class="field"><label>Price ($)</label><input id="jn-price" type="number" min="1" value="15"></div>
      </div>
      <div class="field"><label>Bio</label><textarea id="jn-bio" placeholder="Tell clients what you do best"></textarea></div>
      <div class="field"><span class="err" id="jn-err"></span></div>
      <button class="btn primary block mt12" data-act="joinSubmit">${icon('scissors', 18)} Create barber profile</button>`;
  };

  // ---------- Shop owner dashboard ----------
  VIEWS.owner = function () {
    const p = placeById(S.mePlaceId);
    const shifts = S.barbers.flatMap((b) => b.schedule.filter((s) => s.placeId === p.id).map((s) => ({ ...s, b })));
    const rentWeek = shifts.length * (p.rent + p.kitFee);
    const avgTicket = 22;
    const facilityWeek = round2(p.stats.week.visits * avgTicket * p.fee / 100);
    const prods = S.products.filter((x) => x.placeId === p.id);
    const productRevenue = round2(prods.filter((x) => x.sellerType === 'place').reduce((s, x) => s + x.price * Math.round(x.sold / 52), 0));
    const occupancy = Math.round((shifts.length / (p.chairs * 7)) * 100);
    const rank = leaderboard('places', 'week', 'local').findIndex((r) => r.id === p.id) + 1;
    const notHere = S.barbers.filter((b) => !b.schedule.some((s) => s.placeId === p.id) && b.city === p.city);
    return `
      <div class="topbar">
        <div class="row gap10 grow"><span class="thumb" style="width:40px;height:40px;${placeCover(p)}"></span>
          <select class="input" style="height:40px;max-width:220px" data-change="ownerPlace" aria-label="Shop">${(API.on ? S.places.filter((x) => x.id === S.mePlaceId) : S.places).map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <button class="btn xs" data-act="go" data-to="/place/${p.id}">Public page</button>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Chair rent + kits / wk</span><b class="acc">${money(rentWeek)}</b><span>${shifts.length} barber shifts</span></div>
        <div class="kpi"><span>Facility fees / wk</span><b>${money(facilityWeek)}</b><span>${p.stats.week.visits} visits × ${p.fee}%</span></div>
        <div class="kpi"><span>Product sales / wk</span><b>${money(productRevenue)}</b><span>${prods.length} products</span></div>
        <div class="kpi"><span>Rank · occupancy</span><b class="gold">#${rank} · ${occupancy}%</b><span>${p.chairs} chairs</span></div>
      </div>

      <h2 class="sec">Tier & customer facility fee</h2>
      <div class="seg">${Object.entries(TIERS).map(([k, t]) => `<button class="${p.tier === k ? 'on' : ''}" data-act="ownerTier" data-v="${k}">${t.label} ${t.fee}%</button>`).join('')}</div>
      <div class="card mt12">
        <div class="row between small"><span>Facility fee charged to customers</span><b class="acc" id="fee-label">${p.fee}%</b></div>
        <input type="range" min="0" max="15" step="1" value="${p.fee}" id="own-fee" class="mt8">
        <div class="xs muted">Shown transparently at checkout. Higher fees should match premium facilities.</div>
      </div>

      <h2 class="sec">Chair pricing for barbers</h2>
      <div class="card">
        <div class="row between small"><span>Chair rent per day</span><span class="row gap6">$<input class="inline-input" type="number" min="0" value="${p.rent}" data-change="ownerRent"></span></div>
        <div class="divider"></div>
        <div class="row between small"><span>House product kit per shift</span><span class="row gap6">$<input class="inline-input" type="number" min="0" value="${p.kitFee}" data-change="ownerKit"></span></div>
        <div class="divider"></div>
        <div class="row between small"><span>Chairs</span><span class="row gap6"><input class="inline-input" type="number" min="1" value="${p.chairs}" data-change="ownerChairs"></span></div>
      </div>

      <h2 class="sec">Weekly roster</h2>
      <div class="card">${DOW_ORDER.map((dow) => {
        const here = shifts.filter((s) => s.dow === dow);
        const pct = Math.min(100, (here.length / p.chairs) * 100);
        return `<div class="roster"><b class="small">${DOW[dow]}</b><div>
          <div class="row gap4 wrap">${here.map((s) => `<span class="tag">${esc(firstName(s.b.name))} ${fmtHours(s.from, s.to)}</span>`).join('') || '<span class="xs muted">Empty — invite barbers</span>'}</div>
          <div class="bar mt4"><span style="width:${pct}%"></span></div></div></div>`;
      }).join('')}</div>

      ${promoHTML('place', p.id)}

      <h2 class="sec">Invite barbers to rent</h2>
      ${notHere.map((b) => `<div class="listitem">${barberAvatar(b, 40)}<span class="grow"><b class="small">${esc(b.name)}</b><div class="xs muted">${esc(b.title)} · ${stars(b.rating)}</div></span><button class="btn xs primary" data-act="invite-barber" data-id="${b.id}">Invite</button></div>`).join('') || '<div class="empty">Every local barber already works here 🔥</div>'}

      <h2 class="sec">Products sold here</h2>
      ${prods.map((x) => `<div class="listitem"><span class="thumb" style="background:hsl(${x.hue},35%,18%);font-size:24px">${x.emoji}</span><span class="grow"><b class="small">${esc(x.name)}</b><div class="xs muted">${money(x.price)} · ${compact(x.sold)} sold · ${x.sellerType === 'barber' ? 'by ' + esc(barberById(x.sellerId).name) : 'house product'}</div></span></div>`).join('') || '<div class="empty">No products yet</div>'}
      <div style="height:16px"></div>`;
  };

  // =====================================================================
  // ACTIONS
  // =====================================================================
  function saveBarberRemote(patch, success) {
    return remoteDo(() => API.req('PUT', '/api/studio/barber', patch), success);
  }

  function savePlaceRemote(patch, success) {
    return remoteDo(() => API.req('PUT', '/api/owner/place', patch), success);
  }

  function shortById(sid) {
    return S.shorts.find((x) => x.id === sid);
  }

  const ACTIONS = {
    go: (el) => {
      closeSheet();
      if (el.dataset.to === '/feed') {
        FEED.ctx = null;
        FEED.start = null;
      }
      go(el.dataset.to);
    },
    back: () => {
      if (history.length > 1) {
        history.back();
      } else {
        go(defaultPath());
      }
    },
    closeSheet: () => closeSheet(),

    // ----- onboarding, accounts, server -----
    onboard: (el) => {
      S.onboarded = true;
      S.role = el.dataset.role;
      save();
      if (S.role === 'barber') {
        go('/join');
        toast('Create your barber profile — or skip to the demo studio from Profile');
      } else {
        go(defaultPath());
        toast(`Welcome to Fade, ${firstName(S.user.name)} 👋`);
      }
    },
    authMode: (el) => {
      AUTH.mode = el.dataset.v;
      render();
    },
    authRole: (el) => {
      AUTH.role = el.dataset.v;
      render();
    },
    authSubmit: async () => {
      const err = $('#au-err');
      const value = (id) => ($(`#${id}`) ? $(`#${id}`).value.trim() : '');
      const password = $('#au-pass') ? $('#au-pass').value : '';
      try {
        let result;
        if (AUTH.mode === 'signup') {
          const body = { name: value('au-name'), email: value('au-email'), password, role: AUTH.role };
          if (AUTH.role === 'barber') body.barber = { price: Number(value('au-price')) || 15, city: value('au-city'), tags: value('au-tags') };
          if (AUTH.role === 'owner') body.place = { name: value('au-shop'), city: value('au-city'), tier: value('au-tier') || 'standard' };
          result = await API.req('POST', '/api/auth/register', body);
        } else {
          result = await API.req('POST', '/api/auth/login', { email: value('au-email'), password });
        }
        API.setToken(result.token);
        S = initRemoteState();
        await pull();
        const role = S.user.role;
        S.role = role === 'barber' && S.meBarberId ? 'barber' : role === 'owner' && S.mePlaceId ? 'owner' : 'customer';
        save();
        const welcomeBack = AUTH.mode === 'login';
        AUTH.values = {};
        go(defaultPath());
        toast(`Welcome${welcomeBack ? ' back' : ''}, ${firstName(S.user.name)} 👋`);
      } catch (failure) {
        if (err) err.textContent = failure.message;
      }
    },
    logout: async () => {
      await API.req('POST', '/api/auth/logout').catch(() => {});
      logoutLocal();
    },
    connectServer: async () => {
      const suggestion = localStorage.getItem('fade.api') || 'https://';
      const url = window.prompt('Fade server address (must be https:// when the app is opened from an https page)', suggestion);
      if (!url) return;
      localStorage.setItem('fade.api', url.trim());
      localStorage.removeItem('fade.forceLocal');
      const reachable = await API.detect();
      if (!reachable) {
        localStorage.removeItem('fade.api');
        API.on = false;
        toast('Couldn’t reach a Fade server at that address');
        return;
      }
      location.reload();
    },
    disconnectServer: () => {
      localStorage.removeItem('fade.api');
      localStorage.setItem('fade.forceLocal', '1');
      API.setToken(null);
      location.reload();
    },
    install: async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      refresh();
    },
    role: (el) => {
      const value = el.dataset.v;
      if ((value === 'barber' && !S.meBarberId) || (value === 'owner' && !S.mePlaceId)) {
        toast('This account has no profile for that mode');
        return;
      }
      S.role = value;
      save();
      go(defaultPath());
    },
    reset: async () => {
      if (!window.confirm('Reset all demo data on this device (including shorts you posted)?')) return;
      localStorage.removeItem(LOCAL_KEY);
      await Media.clear().catch(() => {});
      S = initState();
      save();
      location.hash = '#/welcome';
      render();
    },

    // ----- profiles -----
    share: (el) => shareLink(el.dataset.path, el.dataset.title),
    follow: async (el) => {
      const type = el.dataset.type || 'barber';
      const id = el.dataset.id;
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/follow', { type, id }), (r) => (r.following ? 'Following ✓' : 'Unfollowed'));
        return;
      }
      const key = followKey(type, id);
      const index = S.following.indexOf(key);
      if (index >= 0) {
        S.following.splice(index, 1);
      } else {
        S.following.push(key);
        toast(type === 'barber' ? `Following ${firstName(barberById(id).name)} — you'll get open-slot alerts` : 'Following ✓');
      }
      save();
      refresh();
    },
    dm: (el) => openDm(el.dataset.id),
    btab: (el) => {
      BTAB = el.dataset.v;
      refresh();
    },

    // ----- booking -----
    book: (el) => openBooking(el.dataset.id, { date: el.dataset.date, serviceId: el.dataset.svc }),
    bookStyle: (el) => openBooking(el.dataset.id, { styleRef: el.dataset.pf }),
    bkService: (el) => {
      BK.serviceId = el.dataset.id;
      BK.time = null;
      BK.placeId = null;
      setSheet(bookingHTML());
      ensureLiveSlots();
    },
    bkDate: (el) => {
      BK.date = el.dataset.k;
      BK.time = null;
      BK.placeId = null;
      setSheet(bookingHTML());
      ensureLiveSlots();
    },
    bkTime: (el) => {
      BK.time = Number(el.dataset.t);
      BK.placeId = el.dataset.p;
      setSheet(bookingHTML());
    },
    bkNext: () => {
      BK.step = 2;
      setSheet(bookingHTML());
      $('#sheet-root .sheet').scrollTop = 0;
    },
    bkBack: () => {
      BK.step = 1;
      setSheet(bookingHTML());
      ensureLiveSlots();
    },
    bkPay: (el) => {
      BK.payMode = el.dataset.mode;
      setSheet(bookingHTML());
    },
    bkPoints: (el) => {
      BK.usePoints = el.checked;
      setSheet(bookingHTML());
    },
    bkMethod: (el) => {
      BK.method = el.dataset.id;
      setSheet(bookingHTML());
    },
    bkConfirm: () => confirmBooking(),
    ics: (el) => downloadIcs(S.bookings.find((b) => b.id === el.dataset.id)),
    reschedule: (el) => {
      const bk = S.bookings.find((b) => b.id === el.dataset.id);
      openBooking(bk.barberId, { serviceId: bk.serviceId, date: bk.date, rescheduleId: bk.id });
    },
    cancel: (el) => cancelBooking(el.dataset.id),
    complete: (el) => completeBooking(el.dataset.id),
    proComplete: (el) => remoteDo(() => API.req('POST', `/api/bookings/${el.dataset.id}/complete`), 'Marked as done ✂️'),
    bookTab: (el) => {
      BOOK_TAB = el.dataset.v;
      refresh();
    },

    // ----- rating -----
    rate: (el) => openRate(el.dataset.id),
    rtStar: (el) => {
      RT[el.dataset.who === 'b' ? 'rB' : 'rP'] = Number(el.dataset.v);
      setSheet(rateHTML());
    },
    rtTip: (el) => {
      RT.tipPct = Number(el.dataset.v);
      RT.custom = null;
      setSheet(rateHTML());
    },
    rtMethod: (el) => {
      RT.method = el.dataset.id;
      setSheet(rateHTML());
    },
    rtSubmit: () => submitRating(),

    // ----- explore -----
    exTab: (el) => {
      EX.tab = el.dataset.v;
      EX.filter = 'near';
      refresh();
    },
    exFilter: (el) => {
      EX.filter = el.dataset.v;
      refresh();
    },
    exSel: (el) => {
      EX.sel = EX.sel === el.dataset.id ? null : el.dataset.id;
      refresh();
    },
    locate: () => {
      if (!navigator.geolocation) {
        toast('Location not available on this device');
        return;
      }
      toast('Finding you…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          S.user.location = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Current location' };
          save();
          refresh();
          toast('Distances updated to your location');
        },
        () => toast('Location permission denied — using Senopati, Jakarta'),
        { timeout: 8000 }
      );
    },

    // ----- shorts -----
    create: () => {
      closeSheet();
      if (API.on && !API.token) {
        go('/welcome');
        return;
      }
      openUpload();
    },
    feedTab: (el) => {
      FEED.tab = el.dataset.v;
      FEED.start = null;
      FEED.ctx = null;
      refresh();
      const feed = $('#feed');
      if (feed) feed.scrollTop = 0;
    },
    hashtag: (el) => {
      closeSheet();
      FEED.tag = el.dataset.tag.toLowerCase();
      FEED.ctx = null;
      FEED.start = null;
      go('/feed');
    },
    clearTag: () => {
      FEED.tag = null;
      refresh();
    },
    like: async (el) => {
      const sh = shortById(el.dataset.sid);
      if (!sh) return;
      const paint = () => {
        el.classList.toggle('liked', !!sh.likedByMe);
        el.querySelector('.cnt').textContent = compact(sh.likes);
      };
      if (API.on) {
        try {
          const result = await API.req('POST', `/api/shorts/${sh.id}/like`);
          sh.likes = result.short.likes;
          sh.likedByMe = result.short.likedByMe;
          paint();
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      sh.likedByMe = !sh.likedByMe;
      sh.likes += sh.likedByMe ? 1 : -1;
      save();
      paint();
    },
    save: (el) => {
      const sid = el.dataset.sid;
      const index = S.saved.indexOf(sid);
      if (index >= 0) {
        S.saved.splice(index, 1);
      } else {
        S.saved.push(sid);
        toast('Saved to your inspo board');
      }
      el.classList.toggle('liked', index < 0);
      save();
    },
    mute: () => {
      FEED.muted = !FEED.muted;
      document.querySelectorAll('#feed video').forEach((video) => {
        video.muted = FEED.muted;
      });
      document.querySelectorAll('.mutebtn').forEach((button) => {
        button.innerHTML = icon(FEED.muted ? 'mute' : 'volume', 18);
      });
    },
    openShort: (el) => {
      closeSheet();
      openShortCtx(el.dataset.sid, { type: el.dataset.ctype, id: el.dataset.cid });
    },
    bookFromShort: (el) => {
      const sh = shortById(el.dataset.sid);
      const target = shortTargets(sh);
      if (!target.barber) return;
      setRef(sh.id);
      const styleRef = sh.authorType === 'barber' && sh.portfolioId ? sh.portfolioId : null;
      openBooking(target.barber.id, { refShortId: sh.id, styleRef });
    },
    placeFromShort: (el) => {
      const sh = shortById(el.dataset.sid);
      const target = shortTargets(sh);
      if (!target.place) return;
      setRef(sh.id);
      go(`/place/${target.place.id}`);
    },
    shopFromShort: (el) => {
      const sh = shortById(el.dataset.sid);
      const target = shortTargets(sh);
      if (!target.products.length) return;
      setRef(sh.id);
      openProduct(target.products[0].id);
    },
    shareShort: async (el) => {
      const sh = shortById(el.dataset.sid);
      await shareLink(`/feed/${sh.id}`, `${sh.caption.slice(0, 80)} — on Fade`);
      if (API.on) {
        API.req('POST', `/api/shorts/${sh.id}/share`).then((r) => {
          sh.shares = r.short.shares;
        }).catch(() => {});
      } else {
        sh.shares += 1;
        save();
      }
    },
    deleteShort: async (el) => {
      const sh = shortById(el.dataset.sid);
      if (!sh || !window.confirm('Delete this short for everyone?')) return;
      if (API.on) {
        await remoteDo(() => API.req('DELETE', `/api/shorts/${sh.id}`), 'Short deleted');
        return;
      }
      S.shorts = S.shorts.filter((x) => x.id !== sh.id);
      if (sh.media && sh.media.key) Media.del(sh.media.key).catch(() => {});
      save();
      toast('Short deleted');
      refresh();
    },
    upReset: () => {
      if (UP.url) URL.revokeObjectURL(UP.url);
      Object.assign(UP, { file: null, url: null, kind: null, type: '', duration: null, poster: null });
      setSheet(uploadHTML());
    },
    upCat: (el) => {
      UP.category = el.dataset.v;
      setSheet(uploadHTML());
    },
    upAs: (el) => {
      UP.as = el.dataset.v;
      setSheet(uploadHTML());
    },
    upTagKind: (el) => {
      UP.tags[Number(el.dataset.i)].kind = el.dataset.v;
      setSheet(uploadHTML());
    },
    upRemoveTag: (el) => {
      UP.tags.splice(Number(el.dataset.i), 1);
      setSheet(uploadHTML());
    },
    upAgree: (el) => {
      UP.agreement = el.checked;
    },
    upPost: () => postShort(),
    tagReview: async (el) => {
      const sh = shortById(el.dataset.sid);
      const index = Number(el.dataset.i);
      const approve = el.dataset.v === '1';
      if (API.on) {
        await remoteDo(() => API.req('POST', `/api/shorts/${sh.id}/tags/${index}`, { approve }), approve ? 'Tag approved ✅' : 'Tag declined');
        return;
      }
      sh.tags[index].status = approve ? 'approved' : 'declined';
      save();
      toast(approve ? 'Tag approved ✅ — the creator now earns on bookings from it' : 'Tag declined');
      refresh();
    },
    withdraw: async () => {
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/creator/withdraw'), (r) => `${money(r.amount)} moved to your wallet`);
        return;
      }
      const ready = S.commissions.filter((c) => c.status === 'earned');
      const amount = round2(ready.reduce((sum, c) => sum + c.amount, 0));
      if (amount < MIN_WITHDRAW) {
        toast(`You need at least ${money(MIN_WITHDRAW)} earned`);
        return;
      }
      ready.forEach((c) => {
        c.status = 'paid';
      });
      S.user.wallet = round2(S.user.wallet + amount);
      S.txns.unshift({ id: uid('tx'), label: 'Creator commission payout', amount, method: 'Wallet', date: new Date().toISOString() });
      save();
      confetti();
      toast(`${money(amount)} moved to your wallet`);
      refresh();
    },
    simulateViewer: () => {
      const eligible = shortsByUser('me').filter((sh) => (sh.tags || []).some((t) => t.status === 'approved'));
      if (!eligible.length) {
        toast('Post a short and tag a barber or shop first');
        return;
      }
      const sh = eligible[hash(String(Date.now())) % eligible.length];
      const tag = sh.tags.find((t) => t.status === 'approved');
      const target = tagTarget(tag);
      const base = tag.type === 'barber' ? target.services[0].price : 22;
      const viewer = SEED.names[hash(sh.id + Date.now()) % SEED.names.length];
      S.commissions.unshift({
        id: uid('cm'), shortId: sh.id, sourceType: 'booking', sourceId: uid('bk'), payerType: tag.type, payerId: tag.id,
        kind: tag.kind, rate: COMMISSION_RATES[tag.kind], base, amount: round2(base * COMMISSION_RATES[tag.kind]),
        status: 'earned', createdAt: Date.now(), viewer: `${viewer} booked & finished their cut`,
      });
      sh.conversions = (sh.conversions || 0) + 1;
      save();
      toast(`${viewer} booked from your short · +${money(round2(base * COMMISSION_RATES[tag.kind]))}`);
      refresh();
    },

    // ----- chat -----
    chatTab: (el) => {
      CHAT_TAB = el.dataset.v;
      refresh();
    },
    send: (el) => {
      const input = $('#msg');
      if (!input) return;
      const text = input.value;
      input.value = '';
      sendMessage(el.dataset.id, text);
    },
    quick: (el) => sendMessage(parseRoute().arg, el.dataset.text),
    join: async (el) => {
      const t = S.threads.find((x) => x.id === el.dataset.id);
      if (API.on) {
        await remoteDo(() => API.req('POST', `/api/threads/${t.id}/join`), `Joined ${t.title}`);
        return;
      }
      t.joined = true;
      t.members += 1;
      save();
      toast(`Joined ${t.title}`);
      refresh();
    },
    leave: async (el) => {
      const t = S.threads.find((x) => x.id === el.dataset.id);
      if (API.on) {
        await remoteDo(() => API.req('POST', `/api/threads/${t.id}/leave`));
        return;
      }
      t.joined = false;
      t.members -= 1;
      save();
      refresh();
    },
    newGroup: () => {
      openSheet(`
        <div class="sheet-head"><h2 class="grow">New community</h2><button class="iconbtn" data-act="closeSheet" aria-label="Close">${icon('x')}</button></div>
        <div class="field"><label for="ng-name">Name</label><input id="ng-name" maxlength="60" placeholder="e.g. South Jakarta Curly Crew"></div>
        <div class="field"><label for="ng-desc">What's it about?</label><input id="ng-desc" maxlength="200" placeholder="Routines, meetups, barber recs"></div>
        <button class="btn primary block mt16" data-act="createGroup">Create</button>`);
    },
    createGroup: async () => {
      const name = $('#ng-name').value.trim();
      const desc = $('#ng-desc').value.trim();
      if (!name) {
        toast('Give it a name');
        return;
      }
      if (API.on) {
        try {
          const result = await API.req('POST', '/api/threads', { title: name, desc });
          await pull();
          closeSheet();
          go(`/thread/${result.threadId}`);
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      const t = { id: uid('g'), type: 'group', title: name, desc, hue: hash(name) % 360, members: 1, joined: true, messages: [{ from: 'me', text: `Welcome to ${name} 👋`, t: Date.now() }] };
      S.threads.push(t);
      save();
      closeSheet();
      go(`/thread/${t.id}`);
    },

    // ----- ranks & shop -----
    rk: (el) => {
      RK[el.dataset.k] = el.dataset.v;
      refresh();
    },
    shopCat: (el) => {
      SHOP_CAT = el.dataset.v;
      refresh();
    },
    product: (el) => openProduct(el.dataset.id),
    addCart: (el) => {
      const item = S.cart.find((i) => i.id === el.dataset.id);
      if (item) {
        item.qty += 1;
      } else {
        S.cart.push({ id: el.dataset.id, qty: 1 });
      }
      save();
      closeSheet();
      toast('Added to bag');
      refresh();
    },
    buyNow: (el) => {
      if (!S.cart.find((i) => i.id === el.dataset.id)) S.cart.push({ id: el.dataset.id, qty: 1 });
      save();
      openSheet(cartHTML());
    },
    cart: () => openSheet(cartHTML()),
    goShop: () => {
      closeSheet();
      go('/shop');
    },
    qty: (el) => {
      const item = S.cart.find((i) => i.id === el.dataset.id);
      item.qty += Number(el.dataset.d);
      if (item.qty <= 0) S.cart = S.cart.filter((i) => i !== item);
      save();
      setSheet(cartHTML());
      refresh();
    },
    cartDelivery: (el) => {
      CART.delivery = el.dataset.v;
      setSheet(cartHTML());
    },
    cartMethod: (el) => {
      CART.method = el.dataset.id;
      setSheet(cartHTML());
    },
    checkout: (el) => checkout(Number(el.dataset.total)),

    // ----- wallet & membership -----
    addCard: () => openAddCard(),
    saveCard: () => saveCard(),
    topup: () => openTopup(),
    doTopup: async (el) => {
      const amount = Number(el.dataset.v);
      if (API.on) {
        closeSheet();
        await remoteDo(() => API.req('POST', '/api/wallet/topup', { amount, cardId: el.dataset.card }), `+${money(amount)} added`);
        return;
      }
      S.user.wallet = round2(S.user.wallet + amount);
      S.txns.unshift({ id: uid('tx'), label: `Top up from ${methodLabel(el.dataset.card)}`, amount, method: methodLabel(el.dataset.card), date: new Date().toISOString() });
      save();
      closeSheet();
      toast(`+${money(amount)} added`);
      refresh();
    },
    defaultMethod: async (el) => {
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/me/method', { method: el.dataset.id }));
        return;
      }
      S.user.method = el.dataset.id;
      save();
      refresh();
    },
    removeCard: async (el) => {
      if (!window.confirm('Remove this card?')) return;
      if (API.on) {
        await remoteDo(() => API.req('DELETE', `/api/cards/${el.dataset.id}`), 'Card removed');
        return;
      }
      S.user.cards = S.user.cards.filter((c) => c.id !== el.dataset.id);
      if (S.user.method === el.dataset.id) S.user.method = 'wallet';
      save();
      refresh();
    },
    subscribe: async (el) => {
      const plan = planOf(el.dataset.id);
      if (API.on) {
        const ok = await remoteDo(() => API.req('POST', '/api/plan', { plan: plan.id }), plan.price ? `Welcome to ${plan.name} 👑` : 'Switched to Free');
        if (ok && plan.price) confetti();
        return;
      }
      if (plan.price > 0) {
        const method = S.user.cards[0] ? S.user.cards[0].id : 'wallet';
        if (!charge(plan.price, method, `${plan.name} · monthly`)) return;
        confetti();
      }
      S.user.plan = plan.id;
      save();
      toast(plan.price ? `Welcome to ${plan.name} 👑` : 'Switched to Free');
      refresh();
    },

    // ----- rewards -----
    claim: async (el) => {
      if (API.on) {
        const ok = await remoteDo(() => API.req('POST', '/api/rewards/claim', { id: el.dataset.id }), `+${el.dataset.pts} pts claimed`);
        if (ok) confetti();
        return;
      }
      S.claimed[el.dataset.id] = true;
      addPoints(Number(el.dataset.pts));
      save();
      confetti();
      toast(`+${el.dataset.pts} pts claimed`);
      refresh();
    },
    redeem: async (el) => {
      const reward = REDEEM.find((x) => x.id === el.dataset.id);
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/rewards/redeem', { id: reward.id }), `${reward.title} redeemed`);
        return;
      }
      if (S.user.points < reward.cost) return;
      S.user.points -= reward.cost;
      if (reward.credit) {
        S.user.wallet = round2(S.user.wallet + reward.credit);
        S.txns.unshift({ id: uid('tx'), label: `Redeemed ${fmtNum(reward.cost)} pts`, amount: reward.credit, method: 'Points', date: new Date().toISOString() });
      }
      save();
      toast(`${reward.title} redeemed`);
      refresh();
    },
    invite: async () => {
      await shareLink('/welcome', `Get $5 off your first cut on Fade with code ${S.user.refCode}`);
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/rewards/referral'));
        return;
      }
      S.referrals += 1;
      save();
      refresh();
    },

    // ----- barber studio -----
    payRent: async (el) => {
      const place = placeById(el.dataset.id);
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/studio/rent', { placeId: place.id }), `Rent paid to ${place.name}`);
        return;
      }
      if (!charge(Number(el.dataset.amt), S.user.method, `Chair rent · ${place.name}`)) return;
      const week = weekKey();
      S.rentPaid[week] = S.rentPaid[week] || {};
      S.rentPaid[week][place.id] = true;
      save();
      toast(`Rent paid to ${place.name}`);
      refresh();
    },
    proAddShift: async () => {
      const b = barberById(S.meBarberId);
      const dow = Number($('#sh-dow').value);
      const placeId = $('#sh-place').value;
      const from = Number($('#sh-from').value);
      const to = Number($('#sh-to').value);
      if (to - from < 1) {
        toast('Shift must be at least 1 hour');
        return;
      }
      if (b.schedule.some((s) => s.dow === dow && overlaps(s.from, (s.to - s.from) * 60, from, (to - from) * 60))) {
        toast(`You already have a shift overlapping ${DOW[dow]} ${fmtHours(from, to)}`);
        return;
      }
      const place = placeById(placeId);
      const used = S.barbers.filter((x) => x.schedule.some((s) => s.placeId === placeId && s.dow === dow)).length;
      if (used >= place.chairs) {
        toast(`${place.name} is full on ${DOW[dow]}`);
        return;
      }
      const shift = { dow, placeId, from, to };
      if (API.on) {
        await saveBarberRemote({ schedule: [...b.schedule, shift] }, `Chair booked at ${place.short} on ${DOW[dow]}`);
        return;
      }
      b.schedule.push(shift);
      save();
      toast(`Chair booked at ${place.short} on ${DOW[dow]} · ${money(place.rent)}`);
      refresh();
    },
    proDelShift: async (el) => {
      const b = barberById(S.meBarberId);
      if (b.schedule.length <= 1) {
        toast('Keep at least one shift so clients can book you');
        return;
      }
      const index = Number(el.dataset.idx);
      if (API.on) {
        await saveBarberRemote({ schedule: b.schedule.filter((s, i) => i !== index) }, 'Shift removed');
        return;
      }
      b.schedule.splice(index, 1);
      save();
      refresh();
    },
    proAddService: async () => {
      const b = barberById(S.meBarberId);
      const name = $('#svc-name').value.trim();
      const price = Number($('#svc-price').value);
      if (!name || !(price > 0)) {
        toast('Add a name and price');
        return;
      }
      const service = { id: uid('s'), name, mins: 45, price };
      if (API.on) {
        await saveBarberRemote({ services: [...b.services, service] }, 'Service added');
        return;
      }
      b.services.push(service);
      save();
      refresh();
    },
    proDelPf: async (el) => {
      const b = barberById(S.meBarberId);
      const remaining = b.portfolio.filter((item) => item.id !== el.dataset.id);
      if (API.on) {
        await saveBarberRemote({ portfolio: remaining.map((item) => ({ id: item.id })) });
        return;
      }
      b.portfolio = remaining;
      save();
      refresh();
    },
    proAddProduct: async () => {
      const b = barberById(S.meBarberId);
      const name = $('#np-name').value.trim();
      const price = Number($('#np-price').value);
      if (!name || !(price > 0)) {
        toast('Add a name and price');
        return;
      }
      const cat = $('#np-cat').value;
      if (API.on) {
        await remoteDo(() => API.req('POST', '/api/products', { name, price, cat }), 'Listed in the shop');
        return;
      }
      const emoji = { Styling: '🫙', Beard: '🧴', Care: '🫧', Tools: '🪮', Merch: '🧢' }[cat];
      const placeId = (b.schedule[0] || {}).placeId || 'p1';
      S.products.unshift({ id: uid('pr'), name, price, emoji, cat, sellerType: 'barber', sellerId: b.id, placeId, rating: 5, sold: 0, hue: b.hue, desc: `New from ${b.name}.` });
      save();
      toast('Listed in the shop');
      refresh();
    },
    joinSubmit: () => {
      const name = $('#jn-name').value.trim();
      const handle = $('#jn-handle').value.trim().replace(/^@/, '').replace(/\s+/g, '');
      const price = Number($('#jn-price').value);
      if (!name || !handle || !(price > 0)) {
        $('#jn-err').textContent = 'Name, handle and a price are required.';
        return;
      }
      const city = $('#jn-city').value.trim() || 'Jakarta';
      const localPlace = S.places.find((pl) => pl.city.toLowerCase() === city.toLowerCase()) || S.places[1];
      const tags = $('#jn-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
      const hue = hash(handle) % 360;
      const b = {
        id: uid('b'), name, handle, title: tags.slice(0, 2).join(' & ') || 'Barber', city: localPlace.city,
        hue, verified: false, years: Number($('#jn-years').value) || 0, followers: 0, langs: ['EN'], rating: 5, reviews: 0,
        bio: $('#jn-bio').value.trim() || 'New on Fade — book me!', tags: tags.length ? tags : ['Haircut'],
        schedule: [{ dow: 6, placeId: localPlace.id, from: 10, to: 18 }],
        services: [{ id: 's1', name: $('#jn-svc').value.trim() || 'Signature Cut', mins: 45, price }],
        portfolio: [{ id: 'f1', title: 'First cut on Fade', style: 'fade', hue, likes: 0 }],
        stats: { week: { cuts: 0, tips: 0, rating: 5, reviews: 0 }, month: { cuts: 0, tips: 0, rating: 5, reviews: 0 }, all: { cuts: 0, tips: 0, rating: 5, reviews: 0 } },
      };
      S.barbers.push(b);
      S.meBarberId = b.id;
      S.role = 'barber';
      save();
      confetti();
      toast('You’re live! Add shifts & portfolio to get booked');
      go('/pro');
    },

    // ----- shop owner -----
    ownerTier: async (el) => {
      if (API.on) {
        await savePlaceRemote({ tier: el.dataset.v }, 'Tier updated');
        return;
      }
      const p = placeById(S.mePlaceId);
      p.tier = el.dataset.v;
      p.fee = TIERS[p.tier].fee;
      save();
      refresh();
    },
    'invite-barber': async (el) => {
      const b = barberById(el.dataset.id);
      const p = placeById(S.mePlaceId);
      const text = `Hey ${firstName(b.name)}! ${p.name} has open chairs at ${money(p.rent)}/day. Want a shift? 💈`;
      if (API.on) {
        try {
          const result = await API.req('POST', '/api/dm', { barberId: b.id });
          await API.req('POST', `/api/threads/${result.threadId}/messages`, { text });
          await pull();
          toast(`Invite sent to ${firstName(b.name)}`);
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      let t = S.threads.find((x) => x.type === 'dm' && x.barberId === b.id);
      if (!t) {
        t = { id: uid('t'), type: 'dm', barberId: b.id, unread: 0, messages: [] };
        S.threads.push(t);
      }
      t.messages.push({ from: 'me', text, t: Date.now() });
      save();
      toast(`Invite sent to ${firstName(b.name)}`);
    },
  };

  const CHANGES = {
    svcPrice: async (el) => {
      const b = barberById(S.meBarberId);
      const value = Number(el.value);
      if (!(value > 0)) return;
      if (API.on) {
        await saveBarberRemote({ services: b.services.map((s) => (s.id === el.dataset.id ? { ...s, price: value } : s)) }, `Price updated to ${money(value)}`);
        return;
      }
      const service = b.services.find((x) => x.id === el.dataset.id);
      service.price = value;
      save();
      toast(`${service.name} now ${money(value)}`);
    },
    ownerPlace: (el) => {
      S.mePlaceId = el.value;
      save();
      refresh();
    },
    ownerRent: (el) => (API.on ? savePlaceRemote({ rent: Math.max(0, Number(el.value) || 0) }, 'Rent updated') : updatePlaceLocal('rent', Math.max(0, Number(el.value) || 0))),
    ownerKit: (el) => (API.on ? savePlaceRemote({ kitFee: Math.max(0, Number(el.value) || 0) }, 'Kit fee updated') : updatePlaceLocal('kitFee', Math.max(0, Number(el.value) || 0))),
    ownerChairs: (el) => (API.on ? savePlaceRemote({ chairs: Math.max(1, Number(el.value) || 1) }, 'Chairs updated') : updatePlaceLocal('chairs', Math.max(1, Number(el.value) || 1))),
    upTagBarber: (el) => addUploadTag('barber', el.value),
    upTagPlace: (el) => addUploadTag('place', el.value),
  };

  function updatePlaceLocal(field, value) {
    placeById(S.mePlaceId)[field] = value;
    save();
    refresh();
  }

  function addUploadTag(type, id) {
    if (!UP || !id || UP.tags.length >= 4) return;
    UP.tags.push({ type, id, kind: 'featured' });
    setSheet(uploadHTML());
  }

  // ---------- Event wiring ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
    Promise.resolve()
      .then(() => fn(el, e))
      .catch((err) => {
        console.error(err);
        toast(err && err.message ? err.message : 'Something went wrong');
      });
  });

  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'q') renderSearch(e.target.value);
    if (id === 'rt-text' && RT) RT.text = e.target.value;
    if (id === 'rt-custom' && RT) {
      RT.custom = e.target.value === '' ? null : Number(e.target.value);
      const button = $('#rt-submit');
      if (button) button.textContent = rateButtonLabel();
    }
    if (id === 'up-caption' && UP) UP.caption = e.target.value;
    if (id && id.startsWith('au-')) AUTH.values[id] = e.target.value;
    if (id === 'own-fee') $('#fee-label').textContent = `${e.target.value}%`;
    if (id === 'cc-num') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 19);
      e.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
    }
    if (id === 'cc-exp') {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id && el.id.startsWith('au-')) AUTH.values[el.id] = el.value;
    if (el.id === 'own-fee') {
      const fee = Number(el.value);
      if (API.on) {
        savePlaceRemote({ fee }, `Facility fee ${fee}%`);
      } else {
        updatePlaceLocal('fee', fee);
      }
      return;
    }
    if ((el.id === 'up-file' || el.id === 'up-record') && el.files && el.files[0]) {
      handleShortFile(el.files[0]);
      el.value = '';
      return;
    }
    if (el.id === 'pf-file' && el.files && el.files[0]) {
      addPortfolioPhoto(el.files[0]);
      el.value = '';
      return;
    }
    const fn = el.dataset && CHANGES[el.dataset.change];
    if (fn) {
      Promise.resolve(fn(el)).catch((err) => toast(err.message));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'msg') {
      e.preventDefault();
      const text = e.target.value;
      e.target.value = '';
      sendMessage(parseRoute().arg, text);
    }
    if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('au-')) {
      e.preventDefault();
      ACTIONS.authSubmit();
    }
    if (e.key === 'Escape') closeSheet();
  });

  function addPortfolioPhoto(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 720 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        if (API.on) {
          canvas.toBlob((blob) => {
            remoteDo(() => API.upload('/api/studio/portfolio', blob, 'image/jpeg', { 'X-Title': encodeURIComponent('New cut') }), 'Added to your portfolio');
          }, 'image/jpeg', 0.82);
          return;
        }
        const b = barberById(S.meBarberId);
        b.portfolio.unshift({ id: uid('f'), title: 'New cut', style: 'fade', hue: b.hue, likes: 0, img: canvas.toDataURL('image/jpeg', 0.8) });
        save();
        toast('Added to your portfolio');
        refresh();
      };
      img.onerror = () => toast('That photo format isn’t supported — try JPG or PNG');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  window.addEventListener('hashchange', () => {
    closeSheet();
    render();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
  });

  window.addEventListener('offline', () => toast('You’re offline — showing saved data'));

  // Server mode: keep chats, bookings and earnings fresh.
  let polling = false;
  setInterval(async () => {
    if (!API.on || !API.token || !S || !S.onboarded || document.hidden || polling) return;
    if ($('#sheet-root').classList.contains('open')) return;
    polling = true;
    try {
      await pull();
      const page = parseRoute().page;
      if (['chat', 'thread', 'bookings', 'creator'].includes(page)) {
        refresh();
      } else {
        renderTabbar(page);
      }
    } catch (err) {
      if (err.status === 401) logoutLocal();
    } finally {
      polling = false;
    }
  }, 6000);

  async function boot() {
    $('#view').innerHTML = '<div class="splash"><div class="logo">fade<i>.</i></div></div>';
    const params = new URLSearchParams(location.search);
    const forceLocal = params.has('offline') || localStorage.getItem('fade.forceLocal') === '1';
    if (!forceLocal) await API.detect();
    storeKey = API.on ? REMOTE_KEY : LOCAL_KEY;
    S = loadState(storeKey);
    if (!API.on) {
      // Deep link: ?start=customer|barber|owner skips the welcome screen (demos / QR codes).
      const startRole = params.get('start');
      if (startRole && TABS[startRole] && !S.onboarded) {
        S.onboarded = true;
        S.role = startRole;
      }
    } else if (API.token) {
      try {
        await pull();
      } catch (err) {
        if (err.status === 401) {
          API.setToken(null);
          S = initRemoteState();
        } else {
          toast(err.message);
        }
      }
    } else {
      S = initRemoteState();
    }
    save();
    render();
    const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if ('serviceWorker' in navigator && secure) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // Debug / test hook (used by the automated browser tests)
  window.__fade = {
    get state() {
      return S;
    },
    ACTIONS, CHANGES, render, quote, slotsFor, go, API, Media, pull, hash, trendScore, feedList,
    handleShortFile, postShort, openUpload, placeTimeToDate,
    get UP() {
      return UP;
    },
    ready: null,
  };
  window.__fade.ready = boot();
})();
