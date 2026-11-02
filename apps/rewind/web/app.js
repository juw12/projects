// Rewind UI. Uses store.js (local or Supabase data) and settings.js (preferences).

const APP_VERSION = "1.1.0";
const VIEWS = ["browse", "shelf", "feed", "settings"];

let store = null; // created in start() by prepareStore()
const appElement = document.getElementById("app");
const modalBackground = document.getElementById("modalBg");
const modalElement = document.getElementById("modal");

let settings = loadSettings();
let shows = [];
let currentView = settings.startView;
let openShowId = null;
let filters = { query: "", decade: "", genre: "", status: "", sort: settings.defaultSort };

applySettings(settings);

// Line icons (Lucide-style), inlined so the app has no icon dependency.
const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  bookmarkFilled: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function startYear(show) {
  const match = String(show.years).match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function decadeOf(show) {
  const year = startYear(show);
  return year ? `${Math.floor(year / 10) * 10}s` : "Unknown";
}

function hueFor(title) {
  let hash = 0;
  for (const ch of title) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  }
  return hash;
}

function initialOf(name) {
  return escapeHtml((name || "?").trim().charAt(0) || "?");
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function posterHtml(show) {
  return `
    <div class="poster" style="--hue:${hueFor(show.title)}">
      <span class="poster-network">${escapeHtml(show.network)}</span>
      <div class="poster-copy">
        <span class="poster-title">${escapeHtml(show.title)}</span>
        <span class="poster-years">${escapeHtml(show.years)}</span>
      </div>
    </div>`;
}

function statusBadge(status) {
  const key = STATUS_LABELS[status] ? status : "unknown";
  return `<span class="status status-${key}"><span class="status-dot"></span>${STATUS_LABELS[key]}</span>`;
}

function emptyState(icon, title, body, actionHtml = "") {
  return `
    <div class="empty">
      ${ICONS[icon]}
      <h3>${title}</h3>
      <p>${body}</p>
      ${actionHtml}
    </div>`;
}

function toast(message, isError = false) {
  document.querySelectorAll(".toast").forEach((element) => element.remove());
  const element = document.createElement("div");
  element.className = `toast ${isError ? "error" : ""}`;
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 3200);
}

// Runs an async action and reports failures instead of failing silently.
async function attempt(action) {
  try {
    return await action();
  } catch (error) {
    console.error(error);
    toast(error.message || String(error), true);
    return undefined;
  }
}

function isSignedIn() {
  return Boolean(store.user);
}

// In online mode, writing requires an account. Returns true when OK to proceed.
function ensureSignedIn() {
  if (isSignedIn()) {
    return true;
  }
  openSignIn();
  return false;
}

function isTyping(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function updateThemeToggle() {
  const button = document.getElementById("themeToggle");
  const isDark = resolveTheme(settings.theme) === "dark";
  button.innerHTML = isDark ? ICONS.sun : ICONS.moon;
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function updateSetting(name, value) {
  settings = { ...settings, [name]: value };
  saveSettings(settings);
  applySettings(settings);
  updateThemeToggle();
  if (name === "defaultSort") {
    filters.sort = value;
  }
  if (currentView === "settings") {
    const scrollPosition = window.scrollY;
    render().then(() => window.scrollTo(0, scrollPosition));
  }
}

function resetSettings() {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings(settings);
  applySettings(settings);
  updateThemeToggle();
  filters.sort = settings.defaultSort;
  render();
  toast("Settings restored to defaults");
}

// ---------------------------------------------------------------------------
// Routing: #/browse, #/shelf, #/feed, #/settings, #/show/<id>
// ---------------------------------------------------------------------------

function parseRoute() {
  const path = location.hash.replace(/^#\/?/, "");
  const [name, id] = path.split("/");
  if (name === "show" && id) {
    return { name: "show", id: decodeURIComponent(id) };
  }
  if (VIEWS.includes(name)) {
    return { name };
  }
  return { name: null };
}

// Navigates within the app. `state` is stored on the history entry; series panels opened
// from inside the app are marked so closing them can simply go back.
function go(path, { replace = false, state = null } = {}) {
  const url = `#/${path}`;
  if (replace) {
    history.replaceState(state, "", url);
  } else {
    history.pushState(state, "", url);
  }
  return applyRoute();
}

function setActiveView(view) {
  currentView = view;
  document.querySelectorAll("nav button[data-view]").forEach((item) => {
    const isActive = item.dataset.view === view;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-current", isActive ? "page" : "false");
  });
  document.getElementById("settingsBtn").classList.toggle("active", view === "settings");
}

let baseViewRendered = false;

async function applyRoute() {
  const route = parseRoute();

  if (route.name === "show") {
    if (!baseViewRendered) {
      setActiveView(currentView);
      await render();
    }
    await renderShowDrawer(route.id);
    return;
  }

  if (modalBackground.classList.contains("open")) {
    hideModal({ refresh: false });
  }
  const view = route.name || settings.startView;
  const changedView = view !== currentView;
  setActiveView(view);
  if (changedView) {
    window.scrollTo({ top: 0 });
  }
  await refreshShows();
}

function openShow(id) {
  return go(`show/${encodeURIComponent(id)}`, { state: { openedInApp: true } });
}

function setView(view) {
  return go(view);
}

// ---------------------------------------------------------------------------
// Header: mode banner and account area
// ---------------------------------------------------------------------------

function renderAccountArea() {
  const area = document.getElementById("accountArea");
  const banner = document.getElementById("modeBanner");

  if (store.mode === "local") {
    area.innerHTML = "";
    banner.textContent = store.fellBackToLocal
      ? "Couldn't reach the online archive — working in local mode on this device for now."
      : "Local mode — your archive is stored on this device only.";
    banner.hidden = false;
    return;
  }

  banner.hidden = true;
  if (store.user) {
    area.innerHTML = `
      <button class="avatar" id="accountBtn" title="${escapeHtml(store.user.name)} · Account settings">
        ${initialOf(store.user.name)}
      </button>`;
    document.getElementById("accountBtn").onclick = () => setView("settings");
  } else {
    area.innerHTML = `<button class="btn btn-ghost" id="signInBtn">Sign in</button>`;
    document.getElementById("signInBtn").onclick = openSignIn;
  }
}

// ---------------------------------------------------------------------------
// Browse, shelf and feed
// ---------------------------------------------------------------------------

function showCard(show) {
  return `
    <article class="card" data-id="${show.id}" tabindex="0" aria-label="${escapeHtml(show.title)}">
      ${posterHtml(show)}
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(show.title)}</h3>
        <p class="card-meta">${escapeHtml([show.years, show.genre].filter(Boolean).join(" · "))}</p>
        <div class="card-foot">
          ${statusBadge(show.status)}
          <span class="counts">
            <span title="Memories">${ICONS.message}${show.memoryCount}</span>
            <span title="People who remember it">${ICONS.users}${show.rememberCount}</span>
          </span>
        </div>
      </div>
    </article>`;
}

function filteredShows() {
  const query = filters.query.toLowerCase();
  const list = shows.filter((show) => {
    const haystack = `${show.title} ${show.network} ${show.genre} ${show.synopsis}`.toLowerCase();
    if (query && !haystack.includes(query)) {
      return false;
    }
    if (filters.decade && decadeOf(show) !== filters.decade) {
      return false;
    }
    if (filters.genre && show.genre !== filters.genre) {
      return false;
    }
    if (filters.status && show.status !== filters.status) {
      return false;
    }
    if (settings.hideStreaming && show.status === "streaming" && filters.status !== "streaming") {
      return false;
    }
    return true;
  });

  const sorters = {
    title: (a, b) => a.title.localeCompare(b.title),
    oldest: (a, b) => (startYear(a) || 9999) - (startYear(b) || 9999),
    newest: (a, b) => (startYear(b) || 0) - (startYear(a) || 0),
    loved: (a, b) => (b.rememberCount + b.memoryCount) - (a.rememberCount + a.memoryCount),
  };
  return list.sort(sorters[filters.sort] || sorters.title);
}

function optionList(values, selected, placeholder) {
  const options = values
    .map((value) => `<option ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`)
    .join("");
  return `<option value="">${placeholder}</option>${options}`;
}

const SORT_OPTIONS = [
  ["title", "A–Z"],
  ["oldest", "Oldest first"],
  ["newest", "Newest first"],
  ["loved", "Most remembered"],
];

function renderBrowse() {
  const decades = [...new Set(shows.map(decadeOf))].sort();
  const genres = [...new Set(shows.map((show) => show.genre).filter(Boolean))].sort();
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([key, label]) =>
      `<option value="${key}" ${filters.status === key ? "selected" : ""}>${label}</option>`)
    .join("");
  const sortOptions = SORT_OPTIONS
    .map(([key, label]) =>
      `<option value="${key}" ${filters.sort === key ? "selected" : ""}>Sort: ${label}</option>`)
    .join("");

  const totalMemories = shows.reduce((sum, show) => sum + show.memoryCount, 0);
  const totalRemembers = shows.reduce((sum, show) => sum + show.rememberCount, 0);
  const list = filteredShows();
  const hasFilters = filters.query || filters.decade || filters.genre || filters.status;
  const hiddenNote = settings.hideStreaming
    ? ` · <a href="#/settings">series already streaming are hidden</a>`
    : "";

  const grid = list.length
    ? `<div class="grid">${list.map(showCard).join("")}</div>`
    : emptyState(
      "search",
      "Nothing matches that search",
      "Try a different title or clear the filters. If a series is missing from the archive, add it.",
      `<button class="btn" id="emptyAddBtn">${ICONS.plus}Add a series</button>`
    );

  return `
    <section class="hero">
      <div>
        <p class="eyebrow">The Rewind Archive</p>
        <h1>Television that <em>streaming forgot.</em></h1>
        <p class="lede">A community record of series you can no longer find — and the memories that keep them alive.</p>
      </div>
      <div class="stats">
        <div class="stat-block"><strong>${shows.length}</strong><span>Series</span></div>
        <div class="stat-block"><strong>${totalMemories}</strong><span>Memories</span></div>
        <div class="stat-block"><strong>${totalRemembers}</strong><span>Viewers</span></div>
      </div>
    </section>

    <div class="toolbar">
      <div class="search">
        ${ICONS.search}
        <input id="search" type="search" placeholder="Search by title, network or genre  ( / )" value="${escapeHtml(filters.query)}" aria-label="Search">
      </div>
      <select id="decade" aria-label="Decade">${optionList(decades, filters.decade, "All decades")}</select>
      <select id="genre" aria-label="Genre">${optionList(genres, filters.genre, "All genres")}</select>
      <select id="status" aria-label="Availability"><option value="">Any availability</option>${statusOptions}</select>
      <select id="sort" aria-label="Sort">${sortOptions}</select>
    </div>
    <p class="result-count">${hasFilters ? plural(list.length, "result") : `${list.length} series in the archive`}${hiddenNote}</p>
    ${grid}

    <footer class="footnote">
      <span>Availability is reported by the community and varies by region and over time.</span>
      <span>Rewind ${APP_VERSION}</span>
    </footer>`;
}

function pageHead(title, subtitle, extra = "") {
  return `
    <section class="page-head">
      <div>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      ${extra}
    </section>`;
}

function renderShelf() {
  const head = pageHead("My Shelf", "The series you've saved to revisit.");

  if (store.mode === "cloud" && !isSignedIn()) {
    return head + emptyState(
      "bookmark",
      "Sign in to keep a shelf",
      "Save series you love and find them here on any device.",
      `<button class="btn btn-primary" id="emptySignInBtn">Sign in</button>`
    );
  }
  const list = shows.filter((show) => show.onShelf);
  if (!list.length) {
    return head + emptyState(
      "bookmark",
      "Your shelf is empty",
      "Open any series and choose Save to keep it here.",
      `<button class="btn" id="emptyBrowseBtn">Browse the archive</button>`
    );
  }
  return `${head}<div class="grid" style="margin-top:32px">${list.map(showCard).join("")}</div>`;
}

function feedHtml(memories) {
  const live = store.mode === "cloud" ? `<span class="live">Live</span>` : "";
  const head = pageHead("Memory Lane", "Recent recollections from the community.", live);

  if (!memories.length) {
    return head + emptyState(
      "message",
      "No memories yet",
      "Open a series and share where you watched it, who you watched it with, or the episode you never forgot.",
      `<button class="btn" id="emptyBrowseBtn">Browse the archive</button>`
    );
  }

  const items = memories.map((memory) => {
    const show = shows.find((item) => item.id === memory.showId) || { title: memory.showTitle, network: "", years: "" };
    return `
      <article class="memory feed-item clickable" data-id="${memory.showId}" tabindex="0">
        ${posterHtml(show)}
        <div>
          <div class="feed-head">
            <span class="feed-show">${escapeHtml(memory.showTitle)}</span>
            <span class="timestamp">${formatDate(memory.createdAt)}</span>
          </div>
          <p class="memory-text">${escapeHtml(memory.text)}</p>
          <div class="byline">— ${escapeHtml(memory.author)}</div>
        </div>
      </article>`;
  }).join("");

  return `${head}<div class="feed">${items}</div>`;
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

function segmented(name, options, value) {
  const buttons = options
    .map(([optionValue, label, icon]) => {
      const active = optionValue === value;
      return `<button type="button" data-value="${optionValue}" class="${active ? "active" : ""}" aria-pressed="${active}">${icon ? ICONS[icon] : ""}${label}</button>`;
    })
    .join("");
  return `<div class="segmented" data-setting="${name}" role="group">${buttons}</div>`;
}

function switchControl(name, checked, label) {
  return `
    <label class="switch">
      <input type="checkbox" data-setting="${name}" ${checked ? "checked" : ""} aria-label="${label}">
      <span></span>
    </label>`;
}

function settingRow(title, description, control) {
  return `
    <div class="setting-row">
      <div class="setting-text">
        <div class="setting-title">${title}</div>
        ${description ? `<div class="setting-desc">${description}</div>` : ""}
      </div>
      <div class="setting-control">${control}</div>
    </div>`;
}

function settingsGroup(title, description, rows) {
  return `
    <section class="settings-group">
      <h2>${title}</h2>
      <p>${description}</p>
      <div class="settings-card">${rows.join("")}</div>
    </section>`;
}

function renderSettings() {
  const resolvedTheme = resolveTheme(settings.theme);
  const user = store.user;

  const swatches = Object.entries(ACCENTS)
    .map(([key, accent]) => `
      <button type="button" class="swatch ${settings.accent === key ? "active" : ""}" data-accent="${key}"
        style="--swatch:${accent[resolvedTheme]}" aria-label="${accent.label}" aria-pressed="${settings.accent === key}" title="${accent.label}"></button>`)
    .join("");

  const appearance = settingsGroup("Appearance", "How Rewind looks on this device.", [
    settingRow(
      "Theme",
      settings.theme === "system" ? `Following your device (currently ${resolvedTheme}).` : "Choose light, dark or match your device.",
      segmented("theme", [["system", "System", "monitor"], ["light", "Light", "sun"], ["dark", "Dark", "moon"]], settings.theme)
    ),
    settingRow("Accent colour", "Used for highlights, links and active states.", `<div class="swatches">${swatches}</div>`),
    settingRow("Text size", "Make all text and controls a little larger.", segmented("textSize", [["default", "Default"], ["large", "Large"]], settings.textSize)),
    settingRow("Card density", "Show more series per row with compact cards.", segmented("density", [["comfortable", "Comfortable"], ["compact", "Compact"]], settings.density)),
    settingRow("Reduce motion", "Turn off animations and transitions.", switchControl("reduceMotion", settings.reduceMotion, "Reduce motion")),
  ]);

  let profileRows;
  if (store.mode === "cloud" && !user) {
    profileRows = [
      settingRow("Account", "Sign in to share memories, vote and keep a shelf across devices.", `<button class="btn btn-primary" id="settingsSignIn">Sign in</button>`),
    ];
  } else {
    profileRows = [
      settingRow(
        "Display name",
        "Shown on the memories you share.",
        `<form id="profileForm">
           <input type="text" name="displayName" maxlength="60" placeholder="Your name" value="${escapeHtml(user?.name || "")}" required aria-label="Display name">
           <button class="btn">Save</button>
         </form>`
      ),
    ];
    if (store.mode === "cloud") {
      profileRows.push(settingRow("Email", "", `<span class="setting-value">${escapeHtml(user.email)}</span>`));
      profileRows.push(settingRow("Sign out", "Sign out of Rewind on this device.", `<button class="btn" id="settingsSignOut">Sign out</button>`));
    }
  }
  const profile = settingsGroup("Profile", store.mode === "cloud" ? "Your Rewind account." : "Your name on this device.", profileRows);

  const startOptions = [["browse", "Browse"], ["shelf", "My Shelf"], ["feed", "Memory Lane"]]
    .map(([key, label]) => `<option value="${key}" ${settings.startView === key ? "selected" : ""}>${label}</option>`)
    .join("");
  const sortOptions = SORT_OPTIONS
    .map(([key, label]) => `<option value="${key}" ${settings.defaultSort === key ? "selected" : ""}>${label}</option>`)
    .join("");

  const browsing = settingsGroup("Browsing", "Defaults for finding series.", [
    settingRow("Start page", "What Rewind opens to.", `<select data-setting="startView" aria-label="Start page">${startOptions}</select>`),
    settingRow("Default sort", "How the archive is ordered.", `<select data-setting="defaultSort" aria-label="Default sort">${sortOptions}</select>`),
    settingRow("Hide series already streaming", "Focus on what's genuinely hard to find.", switchControl("hideStreaming", settings.hideStreaming, "Hide series already streaming")),
  ]);

  const dataRows = store.mode === "local"
    ? [
      settingRow("Export archive", "Download a backup file of all series, memories and quotes.", `<button class="btn" id="exportBtn">${ICONS.download}Export</button>`),
      settingRow("Import archive", "Restore from a Rewind backup file. Replaces current data.", `<label class="btn">${ICONS.upload}Import<input type="file" id="importFile" accept=".json" hidden></label>`),
      settingRow("Reset archive", "Delete everything on this device and restore the starter catalogue.", `<button class="btn btn-outline-danger" id="resetDataBtn">Reset</button>`),
    ]
    : [
      settingRow("Shared archive", "Your memories, quotes and votes are stored in the online Rewind archive. Delete individual memories from each series page.", ""),
    ];
  const data = settingsGroup("Data", store.mode === "local" ? "Everything is stored in this browser." : "Where your contributions live.", dataRows);

  const about = settingsGroup("About", "Rewind — an archive of television that streaming forgot.", [
    settingRow("Version", "", `<span class="setting-value">${APP_VERSION}</span>`),
    settingRow("Storage", "", `<span class="setting-value">${store.mode === "local" ? "This device" : "Online (Supabase)"}</span>`),
    settingRow("Availability data", "Reported by the community. It varies by country and changes over time, so treat it as a guide.", ""),
    settingRow("Keyboard shortcuts", "<kbd>/</kbd> search · <kbd>Esc</kbd> close panel", ""),
    settingRow("Reset settings", "Restore appearance and browsing preferences to their defaults.", `<button class="btn" id="resetSettingsBtn">Reset settings</button>`),
  ]);

  return `
    ${pageHead("Settings", "Personalise Rewind and manage your data.")}
    <div class="settings">
      ${appearance}
      ${profile}
      ${browsing}
      ${data}
      ${about}
      <p class="settings-footer">Preferences are saved on this device.</p>
    </div>`;
}

function bindSettingsEvents() {
  appElement.querySelectorAll(".segmented[data-setting]").forEach((group) => {
    group.querySelectorAll("button").forEach((button) => {
      button.onclick = () => updateSetting(group.dataset.setting, button.dataset.value);
    });
  });
  appElement.querySelectorAll("select[data-setting]").forEach((select) => {
    select.onchange = () => updateSetting(select.dataset.setting, select.value);
  });
  appElement.querySelectorAll('input[type="checkbox"][data-setting]').forEach((input) => {
    input.onchange = () => updateSetting(input.dataset.setting, input.checked);
  });
  appElement.querySelectorAll(".swatch[data-accent]").forEach((button) => {
    button.onclick = () => updateSetting("accent", button.dataset.accent);
  });

  const profileForm = document.getElementById("profileForm");
  if (profileForm) {
    profileForm.onsubmit = (event) => {
      event.preventDefault();
      const name = event.target.displayName.value.trim();
      if (!name) {
        return;
      }
      attempt(async () => {
        await store.setDisplayName(name);
        toast("Display name saved");
        renderAccountArea();
      });
    };
  }

  const bindings = {
    settingsSignIn: openSignIn,
    settingsSignOut: () =>
      attempt(async () => {
        await store.signOut();
        toast("Signed out");
        render();
      }),
    exportBtn: exportBackup,
    resetSettingsBtn: () => {
      if (confirm("Restore all settings to their defaults?")) {
        resetSettings();
      }
    },
    resetDataBtn: () => {
      if (confirm("Delete all series, memories and quotes on this device and restore the starter catalogue?")) {
        attempt(async () => {
          await store.reset();
          await refreshShows();
          toast("Archive reset");
        });
      }
    },
  };
  for (const [id, handler] of Object.entries(bindings)) {
    const element = document.getElementById(id);
    if (element) {
      element.onclick = handler;
    }
  }

  const importInput = document.getElementById("importFile");
  if (importInput) {
    importInput.onchange = importBackup;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function render() {
  renderAccountArea();
  baseViewRendered = true;
  if (currentView === "feed") {
    const memories = await attempt(() => store.listFeed());
    if (currentView !== "feed") {
      return;
    }
    appElement.innerHTML = feedHtml(memories || []);
  } else if (currentView === "shelf") {
    appElement.innerHTML = renderShelf();
  } else if (currentView === "settings") {
    appElement.innerHTML = renderSettings();
    bindSettingsEvents();
    return;
  } else {
    appElement.innerHTML = renderBrowse();
  }
  bindViewEvents();
}

async function refreshShows() {
  const loaded = await attempt(() => store.listShows());
  if (loaded) {
    shows = loaded;
  }
  await render();
}

function bindViewEvents() {
  appElement.querySelectorAll(".card, .memory.clickable").forEach((element) => {
    element.addEventListener("click", () => openShow(element.dataset.id));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        openShow(element.dataset.id);
      }
    });
  });

  const emptyActions = {
    emptyAddBtn: openAddShow,
    emptySignInBtn: openSignIn,
    emptyBrowseBtn: () => setView("browse"),
  };
  for (const [id, handler] of Object.entries(emptyActions)) {
    const element = document.getElementById(id);
    if (element) {
      element.onclick = handler;
    }
  }

  const search = document.getElementById("search");
  if (!search) {
    return;
  }
  search.addEventListener("input", (event) => {
    filters.query = event.target.value;
    render().then(() => {
      const input = document.getElementById("search");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
  for (const key of ["decade", "genre", "status", "sort"]) {
    document.getElementById(key).addEventListener("change", (event) => {
      filters[key] = event.target.value;
      render();
    });
  }
}

// ---------------------------------------------------------------------------
// Drawer & dialogs
// ---------------------------------------------------------------------------

function openModal(html, variant = "drawer") {
  const alreadyOpen = modalBackground.classList.contains("open");
  const sameVariant = modalBackground.classList.contains("is-dialog") === (variant === "dialog");
  const previousScroll = modalElement.scrollTop;

  modalElement.innerHTML = html;
  modalBackground.classList.toggle("is-dialog", variant === "dialog");
  modalBackground.classList.add("open");
  document.body.style.overflow = "hidden";

  // Re-rendering the same drawer (after a vote, post, etc.) keeps position and skips the animation.
  if (alreadyOpen && sameVariant) {
    modalElement.classList.remove("animate");
    modalElement.scrollTop = previousScroll;
  } else {
    modalElement.classList.remove("animate");
    void modalElement.offsetWidth;
    modalElement.classList.add("animate");
    modalElement.scrollTop = 0;
  }
}

function hideModal({ refresh = true } = {}) {
  modalBackground.classList.remove("open");
  document.body.style.overflow = "";
  openShowId = null;
  if (refresh) {
    refreshShows();
  }
}

// Closes whatever is open. Series panels are routes, so closing one navigates back.
function closeModal() {
  const route = parseRoute();
  const isDialog = modalBackground.classList.contains("is-dialog");

  if (isDialog && route.name === "show") {
    renderShowDrawer(route.id);
    return;
  }
  if (route.name === "show") {
    if (history.state?.openedInApp) {
      history.back();
    } else {
      // Arrived via a shared link: there is no in-app page to go back to.
      go(currentView, { replace: true });
    }
    return;
  }
  hideModal();
}

async function shareShow(show) {
  const url = `${location.href.split("#")[0]}#/show/${encodeURIComponent(show.id)}`;
  const shareData = {
    title: `${show.title} — Rewind`,
    text: `Remember ${show.title}? Share your memories on Rewind.`,
    url,
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (error) {
      // User dismissed the share sheet; nothing to do.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied to clipboard");
  } catch (error) {
    toast("Couldn't copy the link", true);
  }
}

async function renderShowDrawer(id) {
  openShowId = id;
  const show = await attempt(() => store.getShow(id));
  if (!show) {
    if (parseRoute().name === "show") {
      go(currentView, { replace: true });
    }
    return;
  }
  if (openShowId !== id) {
    return;
  }
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([key, label]) => `<option value="${key}" ${show.status === key ? "selected" : ""}>${label}</option>`)
    .join("");
  const defaultName = store.user?.name || "";
  const metaLine = [show.years, show.network, show.genre].filter(Boolean).map(escapeHtml).join(" · ");

  const signInNotice = store.mode === "cloud" && !isSignedIn()
    ? `<div class="section"><div class="notice"><a href="#" id="hintSignIn">Sign in</a> to share a memory, add a quote or update availability.</div></div>`
    : "";

  const aboutSection = show.synopsis || show.why || show.theme
    ? `<section class="section">
         <h4 class="section-label">About</h4>
         ${show.synopsis ? `<p>${escapeHtml(show.synopsis)}</p>` : ""}
         ${show.why ? `<div class="callout"><strong>Why it's hard to find</strong>${escapeHtml(show.why)}</div>` : ""}
         ${show.theme ? `<p style="margin-top:14px"><span class="muted">Theme song</span><br>${escapeHtml(show.theme)}</p>` : ""}
       </section>`
    : "";

  const quotesHtml = show.quotes.length
    ? show.quotes.map((quote) => `<blockquote class="quote">“${escapeHtml(quote.text)}”</blockquote>`).join("")
    : `<p class="muted">No quotes yet. Add a line you still remember.</p>`;

  const memoriesHtml = show.memories.length
    ? show.memories.map((memory) => `
        <article class="memory">
          <div class="memory-head">
            <span class="avatar sm">${initialOf(memory.author)}</span>
            <span class="who">${escapeHtml(memory.author)}</span>
            <span class="timestamp">${formatDate(memory.createdAt)}</span>
            ${memory.canDelete ? `<button class="text-btn" data-delete-memory="${memory.id}">Delete</button>` : ""}
          </div>
          <p class="memory-text">${escapeHtml(memory.text)}</p>
        </article>`).join("")
    : `<p class="muted" style="margin-top:16px">Be the first to share a memory of this series.</p>`;

  openModal(`
    <div class="drawer-bar">
      <span>Series</span>
      <button class="icon-btn" id="closeBtn" aria-label="Close">${ICONS.x}</button>
    </div>

    <div class="detail-hero">
      ${posterHtml(show)}
      <div>
        <h2 class="detail-title">${escapeHtml(show.title)}</h2>
        <p class="detail-meta">${metaLine}</p>
        ${statusBadge(show.status)}
        <div class="detail-actions">
          <button id="rememberBtn" class="btn ${show.remembered ? "is-active" : ""}">
            ${show.remembered ? ICONS.check : ICONS.history}
            ${show.remembered ? "Remembered" : "I remember this"}
            <span class="count">${show.rememberCount}</span>
          </button>
          <button id="shelfBtn" class="btn ${show.onShelf ? "is-active" : ""}">
            ${show.onShelf ? ICONS.bookmarkFilled : ICONS.bookmark}
            ${show.onShelf ? "Saved" : "Save"}
          </button>
          <button id="shareBtn" class="btn btn-ghost" aria-label="Share">${ICONS.share}Share</button>
        </div>
      </div>
    </div>

    <div class="detail-body">
      ${signInNotice}
      ${aboutSection}

      <section class="section">
        <h4 class="section-label">Availability</h4>
        <div class="availability-row">
          <p>Seen it somewhere recently? Help keep this accurate.</p>
          <select id="statusEdit" aria-label="Update availability">${statusOptions}</select>
        </div>
      </section>

      <section class="section">
        <h4 class="section-label">Quotes <span>${show.quotes.length}</span></h4>
        ${quotesHtml}
        <form id="quoteForm" class="inline-form">
          <input name="quote" maxlength="300" placeholder="Add a memorable line" required>
          <button class="btn">Add</button>
        </form>
      </section>

      <section class="section">
        <h4 class="section-label">Memories <span>${show.memories.length}</span></h4>
        <form id="memoryForm" class="compose stack">
          <textarea name="text" rows="3" maxlength="2000" placeholder="Where were you when you watched it? Who with? Which episode stayed with you?" required></textarea>
          <div class="compose-foot">
            <input name="author" maxlength="60" placeholder="Your name" value="${escapeHtml(defaultName)}" required aria-label="Your name">
            <button class="btn btn-primary">Share memory</button>
          </div>
        </form>
        ${memoriesHtml}
      </section>
    </div>

    ${show.canDelete ? `<div class="drawer-foot"><button class="btn btn-danger" id="deleteShowBtn">Remove this series from the archive</button></div>` : ""}
  `);

  const rerender = () => renderShowDrawer(id);

  document.getElementById("closeBtn").onclick = closeModal;
  document.getElementById("shareBtn").onclick = () => shareShow(show);

  const hint = document.getElementById("hintSignIn");
  if (hint) {
    hint.onclick = (event) => {
      event.preventDefault();
      openSignIn();
    };
  }

  document.getElementById("rememberBtn").onclick = () => {
    if (ensureSignedIn()) {
      attempt(() => store.toggleRemember(id)).then(rerender);
    }
  };

  document.getElementById("shelfBtn").onclick = () => {
    if (ensureSignedIn()) {
      attempt(async () => {
        await store.toggleShelf(id);
        toast(show.onShelf ? "Removed from your shelf" : "Saved to your shelf");
      }).then(rerender);
    }
  };

  document.getElementById("statusEdit").onchange = (event) => {
    if (!ensureSignedIn()) {
      event.target.value = show.status;
      return;
    }
    attempt(async () => {
      await store.updateStatus(id, event.target.value);
      toast("Availability updated");
    }).then(rerender);
  };

  document.getElementById("quoteForm").onsubmit = (event) => {
    event.preventDefault();
    const text = event.target.quote.value.trim();
    if (text && ensureSignedIn()) {
      attempt(() => store.addQuote(id, text)).then(rerender);
    }
  };

  document.getElementById("memoryForm").onsubmit = (event) => {
    event.preventDefault();
    const author = event.target.author.value.trim();
    const text = event.target.text.value.trim();
    if (!author || !text || !ensureSignedIn()) {
      return;
    }
    attempt(async () => {
      await store.addMemory(id, author, text);
      toast("Memory shared");
    }).then(rerender);
  };

  modalElement.querySelectorAll("[data-delete-memory]").forEach((button) => {
    button.onclick = () => {
      if (confirm("Delete this memory?")) {
        attempt(() => store.deleteMemory(id, button.dataset.deleteMemory)).then(rerender);
      }
    };
  });

  const deleteButton = document.getElementById("deleteShowBtn");
  if (deleteButton) {
    deleteButton.onclick = () => {
      if (confirm(`Remove "${show.title}" and all of its memories?`)) {
        attempt(async () => {
          await store.deleteShow(id);
          toast("Series removed");
        }).then(closeModal);
      }
    };
  }
}

function openAddShow() {
  if (!ensureSignedIn()) {
    return;
  }
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([key, label]) => `<option value="${key}" ${key === "unknown" ? "selected" : ""}>${label}</option>`)
    .join("");

  openModal(`
    <div class="drawer-bar">
      <span>New entry</span>
      <button class="icon-btn" id="closeBtn" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="dialog-body">
      <h2>Add a series</h2>
      <p>Contribute a show that's hard to find on today's platforms.</p>
      <form id="addForm" class="stack">
        <label class="field"><span>Title</span><input name="title" maxlength="120" required></label>
        <div class="form-grid">
          <label class="field"><span>Years aired</span><input name="years" maxlength="40" placeholder="1994–1997"></label>
          <label class="field"><span>Network</span><input name="network" maxlength="80" placeholder="NBC"></label>
          <label class="field"><span>Genre</span><input name="genre" maxlength="40" placeholder="Drama"></label>
        </div>
        <label class="field"><span>Current availability</span><select name="status">${statusOptions}</select></label>
        <label class="field"><span>Synopsis</span><textarea name="synopsis" rows="3" maxlength="1000"></textarea></label>
        <label class="field">
          <span>Why it's hard to find</span>
          <textarea name="why" rows="2" maxlength="1000"></textarea>
          <span class="field-hint">For example: music rights, never released on disc, edited versions only.</span>
        </label>
        <label class="field"><span>Theme song</span><input name="theme" maxlength="300"></label>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary">Add to archive</button>
        </div>
      </form>
    </div>`, "dialog");

  document.getElementById("closeBtn").onclick = closeModal;
  document.getElementById("cancelBtn").onclick = closeModal;
  document.getElementById("addForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.target).entries());
    const fields = {
      title: form.title.trim(),
      years: form.years.trim(),
      network: form.network.trim(),
      genre: form.genre.trim() || "Misc",
      status: form.status,
      synopsis: form.synopsis.trim(),
      why: form.why.trim(),
      theme: form.theme.trim(),
    };
    try {
      const newId = await store.addShow(fields);
      const loaded = await store.listShows();
      shows = loaded;
      modalBackground.classList.remove("open");
      await openShow(newId);
      toast("Series added");
    } catch (error) {
      if (error.existingId) {
        toast("That series is already in the archive");
        modalBackground.classList.remove("open");
        openShow(error.existingId);
      } else {
        toast(error.message, true);
      }
    }
  };
}

function openSignIn() {
  if (store.mode !== "cloud") {
    return;
  }
  openModal(`
    <div class="drawer-bar">
      <span>Account</span>
      <button class="icon-btn" id="closeBtn" aria-label="Close">${ICONS.x}</button>
    </div>
    <div class="dialog-body">
      <h2>Sign in to Rewind</h2>
      <p>We'll email you a secure sign-in link. No password required.</p>
      <form id="signInForm" class="stack">
        <label class="field"><span>Email address</span><input type="email" name="email" required autocomplete="email"></label>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
          <button class="btn btn-primary">Send sign-in link</button>
        </div>
      </form>
    </div>`, "dialog");

  document.getElementById("closeBtn").onclick = closeModal;
  document.getElementById("cancelBtn").onclick = closeModal;
  document.getElementById("signInForm").onsubmit = (event) => {
    event.preventDefault();
    const email = event.target.email.value.trim();
    attempt(async () => {
      await store.signIn(email);
      modalElement.querySelector(".dialog-body").innerHTML = `
        <div class="empty" style="padding:24px 0 8px">
          ${ICONS.mail}
          <h3>Check your inbox</h3>
          <p>We sent a sign-in link to <strong>${escapeHtml(email)}</strong>. Open it on this device to continue.</p>
          <button class="btn" id="doneBtn">Done</button>
        </div>`;
      document.getElementById("doneBtn").onclick = closeModal;
    });
  };
}

// ---------------------------------------------------------------------------
// Local backup
// ---------------------------------------------------------------------------

function exportBackup() {
  const blob = new Blob([store.exportJson()], { type: "application/json" });
  const link = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `rewind-backup-${dateStamp}.json`;
  link.click();
  toast("Backup downloaded");
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  if (!confirm("Importing replaces the archive on this device. Continue?")) {
    event.target.value = "";
    return;
  }
  file.text().then((content) =>
    attempt(async () => {
      store.importJson(content);
      await refreshShows();
      toast("Backup restored");
    })
  );
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.querySelectorAll("nav button[data-view]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.getElementById("brandLink").onclick = (event) => {
  event.preventDefault();
  setView("browse");
};

document.getElementById("settingsBtn").onclick = () => setView("settings");

document.getElementById("themeToggle").onclick = () => {
  const next = resolveTheme(settings.theme) === "dark" ? "light" : "dark";
  updateSetting("theme", next);
};

document.getElementById("randomBtn").onclick = () => {
  const pool = filteredShows().length ? filteredShows() : shows;
  if (pool.length) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    openShow(pick.id);
  }
};

document.getElementById("addShowBtn").onclick = openAddShow;

modalBackground.addEventListener("click", (event) => {
  if (event.target === modalBackground) {
    closeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalBackground.classList.contains("open")) {
    closeModal();
    return;
  }
  if (event.key === "/" && !isTyping(event.target) && !modalBackground.classList.contains("open")) {
    event.preventDefault();
    const focusSearch = () => document.getElementById("search")?.focus();
    if (currentView === "browse") {
      focusSearch();
    } else {
      setView("browse").then(focusSearch);
    }
  }
});

window.addEventListener("popstate", applyRoute);

window.addEventListener("offline", () => toast("You're offline — showing saved data", true));
window.addEventListener("online", () => {
  toast("Back online");
  refreshShows();
});

watchSystemTheme(() => {
  if (settings.theme === "system") {
    applySettings(settings);
    updateThemeToggle();
    if (currentView === "settings") {
      render();
    }
  }
});

async function start() {
  updateThemeToggle();
  store = await prepareStore(window.REWIND_CONFIG);

  await attempt(() => store.init(() => {
    refreshShows();
    if (openShowId) {
      renderShowDrawer(openShowId);
    }
  }));

  store.subscribe(() => {
    refreshShows();
    if (openShowId) {
      renderShowDrawer(openShowId);
    }
  });

  const loaded = await attempt(() => store.listShows());
  shows = loaded || [];

  if (!parseRoute().name) {
    history.replaceState(null, "", `#/${settings.startView}`);
  }
  await applyRoute();
}

// Resolves once the app has loaded its data and rendered the first page.
window.rewindReady = start();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker failed", error));
}
