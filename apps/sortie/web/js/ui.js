"use strict";
/* ==========================================================================
   Sortie · ui — cards, folder tiles, filters, ordering, menus, context
   menus, modal dialogs, command palette, settings and drag & drop.
   ========================================================================== */

const filesEl = $("#files");
const folderListEl = $("#folderList");
bagEntry.el = $("#bagRow");

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(message, { action = null, ms = 3800 } = {}) {
  const el = $("#toast");
  el.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  if (action) {
    const button = document.createElement("button");
    button.className = "btn small";
    button.textContent = action.label;
    button.onclick = () => {
      el.classList.remove("show");
      action.fn();
    };
    el.append(button);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function setStatus(text) {
  $("#statusSource").textContent = text;
}

/* ---------------- cards ---------------- */
function makeCard(file) {
  const type = typeOf(file.name);
  const el = document.createElement("div");
  el.className = "card";
  el.style.setProperty("--c", type.color);
  el.innerHTML = `
    <span class="tick">${icon("check")}</span>
    <div class="thumb"><span class="ico"></span><span class="ext"></span></div>
    <div class="info"><div class="name"></div><div class="meta"><span class="kind"></span><span class="size"></span><span class="date"></span></div></div>
    <button class="more" type="button" title="More actions">${icon("more-vert")}</button>`;
  $(".ico", el).innerHTML = icon(type.icon);
  $(".ext", el).textContent = extOf(file.name).slice(0, 5) || "?";
  $(".size", el).textContent = fmtSize(file.size);
  $(".kind", el).textContent = kindLabel(file.name);
  $(".date", el).textContent = fmtDate(file.modified);
  if (file.thumb) {
    const img = new Image();
    img.src = file.thumb;
    img.alt = "";
    img.draggable = false;
    $(".thumb", el).prepend(img);
  }
  file.el = el;
  refreshCardText(file);
  attachPointer(el, file);
  $(".more", el).addEventListener("click", e => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openCardMenu(file, rect.left, rect.bottom + 4);
  });
  el.addEventListener("dblclick", e => {
    if (!e.target.closest(".more")) openPreview(file);
  });
  el.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (lastPointerType !== "mouse" || state.busy) return;   // touch uses long-press
    openCardMenu(file, e.clientX, e.clientY);
  });
  return el;
}

function refreshCardText(file) {
  $(".name", file.el).textContent = file.name;
  $(".kind", file.el).textContent = kindLabel(file.name);
  const type = typeOf(file.name);
  $(".ext", file.el).textContent = extOf(file.name).slice(0, 5) || "?";
  $(".ico", file.el).innerHTML = icon(type.icon);
  file.el.style.setProperty("--c", type.color);
  file.el.title = `${file.name}\n${fmtSize(file.size)} · ${fmtDate(file.modified)}\n→ ${bucketOf(file).name}`;
}

/* ---------------- folders (sidebar rows: drop + animation targets) ---------------- */
function setCount(entry) {
  const countEl = $(".count", entry.el);
  if (countEl) {
    countEl.textContent = entry.count || "";
    countEl.classList.toggle("zero", entry.count === 0);
  }
  if (entry === bagEntry) {
    const fillHeight = Math.min(30, entry.count * 2);
    const bagFill = $("#bagFill");
    bagFill.setAttribute("height", fillHeight);
    bagFill.setAttribute("y", 102 - fillHeight);
  }
}

function bumpFolder(entry, delta) {
  entry.count = Math.max(0, entry.count + delta);
  setCount(entry);
  entry.el.classList.remove("gulp");
  void entry.el.offsetWidth;
  entry.el.classList.add("gulp");
  scheduleLayout();
}

function openFolderAnim(entry) {
  entry.open++;
  entry.el.classList.add("open");
}

function closeFolderAnim(entry) {
  entry.open = Math.max(0, entry.open - 1);
  if (!entry.open) entry.el.classList.remove("open");
}

function folderTile(bucket) {
  const existing = state.folders.get(bucket.name);
  if (existing) return existing;
  const el = document.createElement("div");
  el.className = "nav-item folder";
  el.tabIndex = 0;
  el.dataset.folder = bucket.name;
  el.style.setProperty("--c", bucket.color);
  el.innerHTML = `<span class="ficon"><span class="fi-closed">${icon("folder-solid")}</span><span class="fi-open">${icon("folder-open-solid")}</span></span><span class="nl"></span><span class="count zero"></span>`;
  $(".nl", el).textContent = bucket.name;
  el.title = `${bucket.name} — drop files here · right-click for options`;
  const next = [...folderListEl.children].find(row => row.dataset.folder.localeCompare(bucket.name) > 0);
  folderListEl.insertBefore(el, next || null);
  el.animate(
    [{ opacity: 0, transform: "translateX(-6px)" }, { opacity: 1, transform: "none" }],
    { duration: D(240), easing: "ease-out" }
  );
  const entry = { key: bucket.name, bucket: { ...bucket }, count: 0, open: 0, dir: null, el, pinned: false };
  state.folders.set(bucket.name, entry);
  attachFolderHandlers(entry);
  return entry;
}

function attachFolderHandlers(entry) {
  entry.el.addEventListener("click", e => {
    if (e.target.closest("button") || state.busy) return;
    showFolder(entry);
  });
  entry.el.addEventListener("keydown", e => {
    if (e.key === "Enter") showFolder(entry);
  });
  entry.el.addEventListener("contextmenu", e => {
    e.preventDefault();
    openFolderMenu(entry, e.clientX, e.clientY);
  });
}

function findFolderEntry(name) {
  const lower = name.toLowerCase();
  return [...state.folders.values()].find(entry => entry.key.toLowerCase() === lower) || null;
}

/** Get (or create and pin) a user-named folder tile. */
function customFolderEntry(name, iconName = "folder") {
  const clean = sanitizeFolderName(name) || "New folder";
  const existing = findFolderEntry(clean);
  if (existing) return existing;
  const typeBucket = typeByName(clean);
  const entry = folderTile(typeBucket || customBucket(clean, iconName));
  entry.pinned = true;
  entry.el.scrollIntoView({ block: "nearest", inline: "nearest" });
  sparkle(centerOf(iconRect(entry)));
  return entry;
}

function syncFolders() {
  const needed = new Map();
  for (const file of state.files) {
    const bucket = bucketOf(file);
    needed.set(bucket.name, bucket);
  }
  for (const [name, entry] of state.folders) {
    if (entry.count === 0 && !entry.pinned && !needed.has(name)) {
      entry.el.remove();
      state.folders.delete(name);
    }
  }
  [...needed.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(folderTile);
}

/* ---------------- grid rendering, ordering, filtering ---------------- */
/** FLIP: animate cards from old to new grid positions around a DOM mutation. */
function flip(mutate) {
  const before = new Map([...filesEl.children].map(el => [el, el.getBoundingClientRect()]));
  mutate();
  for (const el of filesEl.children) {
    const old = before.get(el);
    if (!old || el.hidden) continue;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (dx || dy) {
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: D(380), easing: "cubic-bezier(.2,.8,.2,1)" }
      );
    }
  }
}

const ORDERS = {
  name: { label: "Name", cmp: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) },
  size: { label: "Size (biggest first)", cmp: (a, b) => b.size - a.size },
  date: { label: "Date (newest first)", cmp: (a, b) => b.modified - a.modified },
  type: { label: "Type", cmp: (a, b) => typeOf(a.name).name.localeCompare(typeOf(b.name).name) || a.name.localeCompare(b.name) },
};

function applyOrder(animate = false) {
  const order = ORDERS[settings.orderBy] || ORDERS.name;
  state.files.sort(order.cmp);
  const reorder = () => state.files.forEach(f => filesEl.append(f.el));
  if (animate) flip(reorder);
  else reorder();
}

function renderFiles() {
  state.files.sort((ORDERS[settings.orderBy] || ORDERS.name).cmp);
  filesEl.replaceChildren(...state.files.map(makeCard));
  applyFilter();
  [...filesEl.children].forEach((el, i) => {
    el.animate(
      [{ opacity: 0, transform: "translateY(24px) scale(.8)" }, { opacity: 1, transform: "none" }],
      { duration: D(420), delay: D(Math.min(i * 22, 700)), easing: "cubic-bezier(.2,.9,.3,1.3)", fill: "backwards" }
    );
  });
  syncFolders();
  updateUI();
}

const CHIPS = [
  { id: "all", label: "All", test: () => true },
  { id: "images", label: "Images", test: f => typeOf(f.name).name === "Images" },
  { id: "docs", label: "Documents", test: f => typeOf(f.name).name === "Documents" },
  { id: "media", label: "Media", test: f => ["Videos", "Audio"].includes(typeOf(f.name).name) },
  { id: "cad", label: "3D / CAD", test: f => typeOf(f.name).name === "3D & CAD" },
  { id: "big", label: "Large", test: f => f.size > 50 * MB },
  { id: "old", label: "Older than 1 yr", test: f => Date.now() - f.modified > 365 * DAY_MS },
  { id: "dupes", label: "Duplicates", test: (f, ctx) => ctx.dupes.has(f.id) },
  { id: "selected", label: "Selected", test: f => f.el?.classList.contains("sel") },
];

const isFiltering = () => state.filter.chip !== "all" || state.filter.text.trim() !== "";
const visibleFiles = () => state.files.filter(f => !f.el.hidden);

const TYPE_CHIP_IDS = ["images", "docs", "media", "cad"];
const TOGGLE_CHIPS = [
  { id: "big", label: "Large files" },
  { id: "old", label: "Older than a year" },
  { id: "dupes", label: "Duplicates" },
];

function chipButton(label, { active = false, dropdown = false, count = null } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `chip${active ? " on" : ""}${dropdown ? " dd" : ""}`;
  button.innerHTML = `${active ? icon("check") : ""}<span class="cl"></span>${count !== null ? `<span class="n">${count}</span>` : ""}${dropdown ? icon("chevron-down") : ""}`;
  $(".cl", button).textContent = label;
  return button;
}

function typeMenuItems() {
  const ctx = { dupes: duplicateIds() };
  return [
    { header: "Type" },
    { label: "Any type", checked: !TYPE_CHIP_IDS.includes(state.filter.chip), action: () => setChip("all") },
    ...TYPE_CHIP_IDS.map(id => {
      const chip = CHIPS.find(c => c.id === id);
      return {
        label: chip.label,
        kbd: String(state.files.filter(f => chip.test(f, ctx)).length),
        checked: state.filter.chip === id,
        action: () => setChip(id),
      };
    }),
  ];
}

function filterMenuItems() {
  return [
    ...typeMenuItems(),
    { sep: true },
    { header: "Show only" },
    ...TOGGLE_CHIPS.map(t => ({ label: t.label, checked: state.filter.chip === t.id, action: () => setChip(state.filter.chip === t.id ? "all" : t.id) })),
    { sep: true },
    { icon: "x-circle", label: "Clear filters", disabled: !isFiltering(), action: clearFilter },
  ];
}

function renderChips() {
  const box = $("#chips");
  const ctx = { dupes: duplicateIds() };
  const current = state.filter.chip;
  box.replaceChildren();
  const typeActive = TYPE_CHIP_IDS.includes(current);
  const typeChip = chipButton(typeActive ? CHIPS.find(c => c.id === current).label : "Type", { active: typeActive, dropdown: true });
  typeChip.onclick = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    openMenu(typeMenuItems(), rect.left, rect.bottom + 4);
  };
  box.append(typeChip);
  for (const toggle of TOGGLE_CHIPS) {
    const chip = CHIPS.find(c => c.id === toggle.id);
    const count = state.files.filter(f => chip.test(f, ctx)).length;
    if (!count && current !== toggle.id) continue;
    const button = chipButton(toggle.label, { active: current === toggle.id, count });
    button.onclick = () => setChip(current === toggle.id ? "all" : toggle.id);
    box.append(button);
  }
  if (isFiltering()) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "chip-clear";
    clear.textContent = "Clear filters";
    clear.onclick = clearFilter;
    box.append(clear);
  }
}

function applyFilter() {
  const chip = CHIPS.find(c => c.id === state.filter.chip) || CHIPS[0];
  const query = state.filter.text.trim().toLowerCase();
  const ctx = { dupes: duplicateIds() };
  for (const file of state.files) {
    file.el.hidden = !(chip.test(file, ctx) && (!query || file.name.toLowerCase().includes(query)));
  }
  updateUI();
}

function setChip(id) {
  state.filter.chip = id;
  flip(applyFilter);
}

function setFilterText(text) {
  state.filter.text = text;
  $("#search").value = text;
  applyFilter();
}

function clearFilter() {
  state.filter = { text: "", chip: "all" };
  $("#search").value = "";
  applyFilter();
}

/* ---------------- selection ---------------- */
const selectedFiles = () => state.files.filter(f => f.el.classList.contains("sel"));
const actionTargets = () => (selectedFiles().length ? selectedFiles() : visibleFiles());

function clearSelection() {
  state.files.forEach(f => f.el.classList.remove("sel"));
  updateUI();
}

function toggleSelect(file, e = null) {
  if (e?.shiftKey && state.anchor && state.files.includes(state.anchor)) {
    const visible = visibleFiles();
    const a = visible.indexOf(state.anchor);
    const b = visible.indexOf(file);
    if (a >= 0 && b >= 0) {
      visible.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(f => f.el.classList.add("sel"));
      updateUI();
      return;
    }
  }
  file.el.classList.toggle("sel");
  state.anchor = file;
  file.el.animate(
    [{ transform: "scale(.92)" }, { transform: "scale(1.04)" }, { transform: "none" }],
    { duration: D(240) }
  );
  updateUI();
}

function selectFiles(list, { scroll = true } = {}) {
  const wanted = new Set(list);
  if (list.some(f => f.el.hidden)) clearFilter();
  state.files.forEach(f => f.el.classList.toggle("sel", wanted.has(f)));
  if (scroll && list[0]) list[0].el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  list.forEach((f, i) => {
    f.el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "none" }],
      { duration: D(300), delay: D(Math.min(i * 30, 600)) }
    );
  });
  updateUI();
}

function selectAllVisible() {
  visibleFiles().forEach(f => f.el.classList.add("sel"));
  updateUI();
}

function invertSelection() {
  visibleFiles().forEach(f => f.el.classList.toggle("sel"));
  updateUI();
}

/* ---------------- toolbar state ---------------- */
function updateUI() {
  const selected = selectedFiles();
  const visibleCount = visibleFiles().length;
  const inInbox = state.view.kind === "inbox";
  $("#sortLbl").textContent = selected.length ? `Sort ${selected.length}` : isFiltering() ? `Sort ${visibleCount}` : "Sort all";
  $("#vacLbl").textContent = selected.length ? `Vacuum ${selected.length}` : "Vacuum";
  $("#btnSort").disabled = state.busy || !(selected.length || visibleCount);
  $("#btnVac").disabled = state.busy || !selected.length;
  $("#btnUndo").disabled = state.busy || !state.history.length;
  $("#empty").classList.toggle("show", inInbox && !state.files.length);
  $("#noMatch").classList.toggle("show", inInbox && state.files.length > 0 && visibleCount === 0);
  const showSelection = inInbox && selected.length > 0;
  $("#selBar").hidden = !showSelection;
  $("#chips").hidden = showSelection;
  if (showSelection) $("#selCount").textContent = `${selected.length} selected`;
  document.body.classList.toggle("busy", state.busy);
  renderChips();
  scheduleLayout();
}

function setBusy(busy) {
  state.busy = busy;
  updateUI();
}

function setMode(mode, { quiet = false } = {}) {
  if (!MODES[mode]) return;
  settings.mode = mode;
  saveSettings();
  $("#mode").value = mode;
  state.files.forEach(refreshCardText);
  syncFolders();
  if (!quiet) toast(`Sort mode: ${MODES[mode].label}`);
}

function setView(view) {
  settings.view = view;
  saveSettings();
  flip(() => $("#filesWrap").classList.toggle("list", view === "list"));
  $("#btnGrid").classList.toggle("on", view !== "list");
  $("#btnList").classList.toggle("on", view === "list");
}

function setCardSize(size) {
  settings.cardSize = size;
  saveSettings();
  flip(() => {
    filesEl.dataset.size = size;
  });
}

function setOrder(orderBy) {
  settings.orderBy = orderBy;
  saveSettings();
  applyOrder(true);
}

function setSpeed(speed) {
  settings.speed = speed;
  saveSettings();
}

function applyTheme(theme) {
  settings.theme = THEMES[theme] ? theme : "dark";
  saveSettings();
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  const resolved = settings.theme === "system" ? (prefersLight ? "light" : "dark") : settings.theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f8fafd" : "#1b1c1e");
}

function applyAccent(color) {
  settings.accent = color;
  saveSettings();
  document.documentElement.style.setProperty("--accent", color);
}

/* ---------------- menus ---------------- */
const menuStack = [];

function closeMenus(level = 0) {
  while (menuStack.length > level) menuStack.pop().remove();
  if (!level) $$(".mb.active").forEach(b => b.classList.remove("active"));
}

/**
 * Item spec: { label, icon, kbd, action, disabled, checked, danger, color, submenu }
 *            { sep: true } | { header: "text" }
 */
function openMenu(items, x, y, level = 0, fromRect = null) {
  closeMenus(level);
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  for (const item of items) {
    if (!item) continue;
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      menu.append(sep);
      continue;
    }
    if (item.header) {
      const header = document.createElement("div");
      header.className = "menu-header";
      header.textContent = item.header;
      menu.append(header);
      continue;
    }
    const row = document.createElement("button");
    row.type = "button";
    row.className = `menu-item${item.danger ? " danger" : ""}`;
    row.disabled = !!item.disabled;
    row.innerHTML = `<span class="mi-icon"></span><span class="mi-label"></span><span class="mi-kbd"></span>`;
    const iconEl = $(".mi-icon", row);
    if (item.swatch) {
      iconEl.innerHTML = `<span class="mi-swatch" style="background:${item.swatch}"></span>`;
    } else if (item.checked !== undefined) {
      iconEl.innerHTML = item.checked ? icon("check") : "";
      iconEl.classList.toggle("checked", !!item.checked);
    } else if (item.icon) {
      iconEl.innerHTML = icon(item.icon);
    }
    $(".mi-label", row).textContent = item.label;
    if (item.submenu) $(".mi-kbd", row).innerHTML = icon("chevron-right");
    else $(".mi-kbd", row).textContent = item.kbd || "";
    if (item.submenu) {
      row.dataset.sub = "1";
      const openSub = () => {
        const rect = row.getBoundingClientRect();
        const sub = typeof item.submenu === "function" ? item.submenu() : item.submenu;
        openMenu(sub, rect.right - 4, rect.top - 6, level + 1, rect);
      };
      row.addEventListener("pointerenter", e => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(row.hoverTimer);
        row.hoverTimer = setTimeout(openSub, 110);
      });
      row.addEventListener("pointerleave", () => clearTimeout(row.hoverTimer));
      row.addEventListener("click", openSub);
    } else {
      row.addEventListener("pointerenter", e => {
        if (e.pointerType === "mouse") closeMenus(level + 1);
      });
      row.addEventListener("click", () => {
        closeMenus();
        Snd.tick();
        item.action?.();
      });
    }
    menu.append(row);
  }
  $("#menus").append(menu);
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = x;
  let top = y;
  if (left + width > innerWidth - 8) left = fromRect ? fromRect.left - width + 4 : innerWidth - width - 8;
  if (top + height > innerHeight - 8) top = Math.max(8, innerHeight - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.animate(
    [{ opacity: 0, transform: "scale(.96) translateY(-4px)" }, { opacity: 1, transform: "none" }],
    { duration: 140, easing: "ease-out" }
  );
  menuStack.push(menu);
  if (level === 0) Snd.tick();
  return menu;
}

function handleMenuKey(e) {
  const menu = menuStack[menuStack.length - 1];
  if (!menu) return false;
  const items = $$(".menu-item:not(:disabled)", menu);
  const index = items.indexOf(document.activeElement);
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      (items[index + 1] || items[0])?.focus();
      return true;
    case "ArrowUp":
      e.preventDefault();
      (items[index - 1] || items[items.length - 1])?.focus();
      return true;
    case "ArrowRight":
      if (document.activeElement?.dataset.sub) {
        e.preventDefault();
        document.activeElement.click();
        $(".menu-item:not(:disabled)", menuStack[menuStack.length - 1])?.focus();
      }
      return true;
    case "ArrowLeft":
      if (menuStack.length > 1) {
        e.preventDefault();
        closeMenus(menuStack.length - 1);
        $(".menu-item", menuStack[menuStack.length - 1])?.focus();
      }
      return true;
    case "Escape":
      e.preventDefault();
      closeMenus();
      return true;
    case "Enter":
    case " ":
      if (document.activeElement?.classList.contains("menu-item")) {
        e.preventDefault();
        document.activeElement.click();
      }
      return true;
    default:
      return false;
  }
}

/* ----- menu contents ----- */
function moveToItems(files) {
  return [
    { header: `Move ${plural(files.length, "file")} to` },
    ...[...state.folders.values()].map(entry => ({
      icon: entry.bucket.icon,
      label: entry.key,
      action: () => sortFiles(files, entry),
    })),
    { sep: true },
    {
      icon: "plus",
      label: "New folder…",
      action: async () => {
        const entry = await newFolderPrompt();
        if (entry) sortFiles(files, entry);
      },
    },
  ];
}

function selectByItems() {
  const typesPresent = [...new Set(state.files.map(f => typeOf(f.name).name))].sort();
  const dupes = duplicateIds();
  return [
    { header: "Select by" },
    ...typesPresent.map(name => {
      const type = typeByName(name) || OTHER;
      return { icon: type.icon, label: name, action: () => selectFiles(state.files.filter(f => typeOf(f.name).name === name)) };
    }),
    { sep: true },
    { icon: "database", label: "Big files (> 50 MB)", action: () => selectFiles(state.files.filter(f => f.size > 50 * MB)) },
    { icon: "clock", label: "Older than a year", action: () => selectFiles(state.files.filter(f => Date.now() - f.modified > 365 * DAY_MS)) },
    { icon: "copy", label: `Duplicates (${dupes.size})`, disabled: !dupes.size, action: () => selectFiles(state.files.filter(f => dupes.has(f.id))) },
  ];
}

const ACCENTS = [
  { name: "Finder blue", color: "#007aff" },
  { name: "Drive blue", color: "#0b57d0" },
  { name: "Indigo", color: "#6366f1" },
  { name: "Teal", color: "#0e9f9a" },
  { name: "Green", color: "#2f9e5b" },
  { name: "Orange", color: "#e2742b" },
  { name: "Graphite", color: "#6b7385" },
];
const THEMES = { dark: "Dark", light: "Light", system: "Match system" };

const MENUBAR = {
  file: () => [
    { icon: "layers", label: "Load demo files", action: loadDemo },
    { icon: "folder-open", label: "Open folder…", kbd: "Ctrl+O", action: openFolderPicker },
    { icon: "file-plus", label: "Add files to preview…", action: () => $("#filePick").click() },
    { sep: true },
    { icon: "folder", label: "New folder…", kbd: "N", action: newFolderPrompt },
    { icon: "inbox", label: "Open vacuum bag", action: () => openDrawer(bagEntry) },
    { icon: "trash", label: "Empty vacuum bag…", danger: true, action: emptyBag },
    { sep: true },
    { icon: "sliders", label: "Settings…", kbd: "Ctrl+,", action: () => openSettings() },
  ],
  edit: () => {
    const selected = selectedFiles();
    return [
      { icon: "undo", label: "Undo", kbd: "Ctrl+Z", disabled: !state.history.length, action: undo },
      { sep: true },
      { icon: "check-square", label: "Select all", kbd: "Ctrl+A", action: selectAllVisible },
      { icon: "square", label: "Select none", kbd: "Esc", action: clearSelection },
      { icon: "swap", label: "Invert selection", kbd: "Ctrl+I", action: invertSelection },
      { icon: "target", label: "Select", submenu: selectByItems },
      { sep: true },
      { icon: "edit", label: selected.length > 1 ? `Batch rename ${selected.length}…` : "Rename…", kbd: "F2", disabled: !selected.length, action: () => openRenameDialog(selected) },
      { icon: "folder", label: "Move selected to", disabled: !selected.length, submenu: () => moveToItems(selected) },
      { icon: "vacuum", label: "Vacuum selected", kbd: "Del", danger: true, disabled: !selected.length, action: () => vacuumFiles(selected) },
    ];
  },
  view: () => [
    { label: "Grid", checked: settings.view === "grid", action: () => setView("grid") },
    { label: "List", checked: settings.view === "list", action: () => setView("list") },
    {
      icon: "maximize", label: "Card size", submenu: () => [
        { label: "Small", checked: settings.cardSize === "s", action: () => setCardSize("s") },
        { label: "Medium", checked: settings.cardSize === "m", action: () => setCardSize("m") },
        { label: "Large", checked: settings.cardSize === "l", action: () => setCardSize("l") },
      ],
    },
    {
      icon: "arrow-up-down", label: "Order by", submenu: () => Object.entries(ORDERS).map(([id, order]) => ({
        label: order.label, checked: settings.orderBy === id, action: () => setOrder(id),
      })),
    },
    {
      icon: "filter", label: "Show only", submenu: () => CHIPS.map(chip => ({
        label: chip.label, checked: state.filter.chip === chip.id, action: () => setChip(chip.id),
      })),
    },
    { sep: true },
    {
      icon: "zap", label: "Animation speed", submenu: () => [
        ["Relaxed", 0.6], ["Normal", 1], ["Fast", 1.6], ["Very fast", 2.5],
      ].map(([label, speed]) => ({ label, checked: settings.speed === speed, action: () => setSpeed(speed) })),
    },
    { label: "Sound effects", checked: settings.sound, action: () => { settings.sound = !settings.sound; saveSettings(); } },
    {
      icon: "moon", label: "Theme", submenu: () => Object.entries(THEMES).map(([id, label]) => ({
        label, checked: settings.theme === id, action: () => applyTheme(id),
      })),
    },
    {
      icon: "palette", label: "Accent colour", submenu: () => ACCENTS.map(accent => ({
        swatch: accent.color, label: accent.name, action: () => applyAccent(accent.color),
      })),
    },
  ],
  sort: () => {
    const selected = selectedFiles();
    return [
      { icon: "wand", label: selected.length ? `Sort ${selected.length} selected` : "Sort now", kbd: "S", disabled: !state.files.length, action: () => sortFiles(actionTargets()) },
      { sep: true },
      { header: "Sort mode" },
      ...Object.entries(MODES).map(([id, mode]) => ({ label: mode.label, checked: settings.mode === id, action: () => setMode(id) })),
      { sep: true },
      { icon: "tag", label: "Edit smart rules…", action: () => openSettings("rules") },
      { icon: "folder", label: "Sort selected into", disabled: !selected.length, submenu: () => moveToItems(selected) },
    ];
  },
  help: () => [
    { icon: "assistant", label: "Ask the assistant", kbd: "Ctrl+J", action: () => toggleChat(true) },
    { icon: "command", label: "Command palette", kbd: "Ctrl+K", action: () => openPalette() },
    { icon: "keyboard", label: "Keyboard shortcuts", kbd: "?", action: openShortcuts },
    { sep: true },
    { icon: "info", label: "About Sortie", action: openAbout },
  ],
};

function openAppMenu() {
  const rect = $("#wsBtn").getBoundingClientRect();
  openMenu([
    { icon: "file", label: "File", submenu: MENUBAR.file },
    { icon: "edit", label: "Edit", submenu: MENUBAR.edit },
    { icon: "eye", label: "View", submenu: MENUBAR.view },
    { icon: "wand", label: "Sort", submenu: MENUBAR.sort },
    { icon: "info", label: "Help", submenu: MENUBAR.help },
  ], rect.left, rect.bottom + 4);
}

function openNewMenu() {
  const rect = $("#btnNew").getBoundingClientRect();
  openMenu([
    { icon: "folder-plus", label: "New folder", kbd: "N", action: newFolderPrompt },
    { sep: true },
    { icon: "folder-open", label: "Open a folder from disk…", kbd: "Ctrl+O", action: openFolderPicker },
    { icon: "file-plus", label: "Add files to preview…", action: () => $("#filePick").click() },
    { icon: "layers", label: "Load demo files", action: loadDemo },
  ], rect.left, rect.bottom + 4);
}

function openCardMenu(file, x, y) {
  const selected = selectedFiles();
  const group = file.el.classList.contains("sel") && selected.length > 1 ? selected : [file];
  const single = group.length === 1;
  const type = typeOf(file.name);
  const isSelected = file.el.classList.contains("sel");
  openMenu([
    { header: single ? file.name : `${group.length} files selected` },
    single && { icon: "eye", label: "Preview & info", kbd: "Space", action: () => openPreview(file) },
    single && { icon: isSelected ? "square" : "check-square", label: isSelected ? "Deselect" : "Select", action: () => toggleSelect(file) },
    { icon: type.icon, label: `Select all ${type.name}`, action: () => selectFiles(state.files.filter(f => typeOf(f.name).name === type.name)) },
    { sep: true },
    { icon: "wand", label: single ? `Sort into “${bucketOf(file).name}”` : `Sort ${group.length} files`, action: () => sortFiles(group) },
    { icon: "folder", label: "Move to", submenu: () => moveToItems(group) },
    { icon: "edit", label: single ? "Rename…" : "Batch rename…", kbd: "F2", action: () => openRenameDialog(group) },
    { icon: "assistant", label: "Ask the assistant about this", action: () => askAssistantAbout(group) },
    { sep: true },
    { icon: "vacuum", label: single ? "Vacuum" : `Vacuum ${group.length} files`, kbd: "Del", danger: true, action: () => vacuumFiles(group) },
  ], x, y);
}

function openFolderMenu(entry, x, y) {
  const inside = state.all.filter(f => f.where === entry.key);
  if (entry === bagEntry) {
    openMenu([
      { header: "Vacuum bag" },
      { icon: "eye", label: "Look inside", action: () => openDrawer(bagEntry) },
      { icon: "restore", label: `Restore all (${inside.length})`, disabled: !inside.length, action: () => putBack(bagEntry, inside) },
      { sep: true },
      { icon: "trash", label: "Empty bag…", danger: true, action: emptyBag },
    ], x, y);
    return;
  }
  const matching = state.files.filter(f => bucketOf(f).name === entry.key);
  openMenu([
    { header: entry.key },
    { icon: "eye", label: "Show contents", action: () => openDrawer(entry) },
    { icon: "wand", label: `Sort matching files here (${matching.length})`, disabled: !matching.length, action: () => sortFiles(matching, entry) },
    { icon: "restore", label: `Put everything back (${inside.length})`, disabled: !inside.length, action: () => putBack(entry, inside) },
    { sep: true },
    {
      icon: "palette", label: "Colour", submenu: () => ["#ff7a90", "#5ab0ff", "#ffb84d", "#4dd9a6", "#c89bff", "#7be0ff", "#ff9a5c", "#a0a8c0"].map(color => ({
        swatch: color, label: color, action: () => {
          entry.bucket.color = color;
          entry.el.style.setProperty("--c", color);
        },
      })),
    },
    { icon: "pin", label: entry.pinned ? "Unpin tile" : "Pin tile", action: () => { entry.pinned = !entry.pinned; syncFolders(); } },
    {
      icon: "x", label: "Remove empty tile", disabled: entry.count > 0, action: () => {
        entry.el.remove();
        state.folders.delete(entry.key);
      },
    },
  ], x, y);
}

/* ---------------- modal dialogs ---------------- */
const modalStack = [];

function openModal({ title = "", body = null, buttons = [], className = "", onMount = null } = {}) {
  return new Promise(resolve => {
    closeMenus();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = `modal ${className}`;
    modal.setAttribute("role", "dialog");
    modal.innerHTML = `<div class="modal-head"><h2></h2><button class="btn icon-only ghost close" type="button" title="Close (Esc)">${icon("x")}</button></div><div class="modal-body"></div><div class="modal-foot"></div>`;
    if (title) $("h2", modal).textContent = title;
    else $(".modal-head", modal).remove();
    const bodyEl = $(".modal-body", modal);
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body) bodyEl.append(body);

    let closed = false;
    const close = value => {
      if (closed) return;
      closed = true;
      const index = modalStack.indexOf(close);
      if (index >= 0) modalStack.splice(index, 1);
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).finished.then(() => backdrop.remove());
      resolve(value);
    };

    $(".close", modal)?.addEventListener("click", () => close(null));
    backdrop.addEventListener("pointerdown", e => {
      if (e.target === backdrop) close(null);
    });
    const foot = $(".modal-foot", modal);
    for (const spec of buttons.filter(Boolean)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = spec.label;
      button.className = `btn${spec.primary ? " primary" : ""}${spec.danger ? " danger" : ""}`;
      button.disabled = !!spec.disabled;
      button.addEventListener("click", () => close(spec.value === undefined ? spec.label : spec.value));
      foot.append(button);
    }
    backdrop.append(modal);
    $("#modalRoot").append(backdrop);
    modal.animate(
      [{ opacity: 0, transform: "translateY(14px) scale(.97)" }, { opacity: 1, transform: "none" }],
      { duration: 200, easing: "cubic-bezier(.2,.9,.3,1.2)" }
    );
    modalStack.push(close);
    onMount?.(modal, close);
    if (!modal.contains(document.activeElement)) {
      (modal.querySelector("input:not([type=checkbox]), textarea") || $(".modal-foot .primary", modal))?.focus();
    }
  });
}

async function askText(title, { label = "", value = "", placeholder = "", ok = "OK", selectBase = false } = {}) {
  const body = document.createElement("label");
  body.className = "field";
  body.innerHTML = `<span></span><input type="text" autocomplete="off" spellcheck="false">`;
  $("span", body).textContent = label;
  const input = $("input", body);
  input.value = value;
  input.placeholder = placeholder;
  const result = await openModal({
    title,
    body,
    buttons: [{ label: "Cancel", value: null }, { label: ok, primary: true, value: "ok" }],
    onMount: (modal, close) => {
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          close("ok");
        }
      });
      input.focus();
      const dot = value.lastIndexOf(".");
      input.setSelectionRange(0, selectBase && dot > 0 ? dot : value.length);
    },
  });
  return result === "ok" ? input.value.trim() : null;
}

async function askConfirm(title, message, { ok = "OK", danger = false } = {}) {
  const body = document.createElement("p");
  body.textContent = message;
  const result = await openModal({
    title,
    body,
    buttons: [{ label: "Cancel", value: null }, { label: ok, primary: !danger, danger, value: "ok" }],
  });
  return result === "ok";
}

async function newFolderPrompt() {
  const name = await askText("New folder", { label: "Folder name", placeholder: "e.g. Projects", ok: "Create" });
  if (!name) return null;
  const clean = sanitizeFolderName(name);
  if (!clean) {
    toast("That name has no usable characters.");
    return null;
  }
  const entry = customFolderEntry(clean);
  Snd.ding();
  return entry;
}

/* ----- folder contents: opens the folder page ----- */
function openDrawer(entry) {
  showFolder(entry);
}

/* ----- preview / info ----- */
async function openPreview(file) {
  const type = typeOf(file.name);
  const ext = extOf(file.name);
  const bucket = bucketOf(file);
  const body = document.createElement("div");
  body.className = "preview";
  body.innerHTML = `
    <div class="pv-thumb"></div>
    <dl class="pv-info">
      <dt>Name</dt><dd class="v-name"></dd>
      <dt>Type</dt><dd class="v-type"></dd>
      <dt>Size</dt><dd>${fmtSize(file.size)}</dd>
      <dt>Modified</dt><dd>${fmtDate(file.modified)}</dd>
      <dt>Sorts into</dt><dd class="v-bucket"></dd>
      <dt>Source</dt><dd>${{ demo: "Demo file", preview: "Preview (read-only)", live: "Real file on disk" }[state.source]}</dd>
    </dl>
    <p class="pv-about"></p>
    <pre class="pv-text" hidden></pre>`;
  const thumb = $(".pv-thumb", body);
  thumb.style.setProperty("--c", type.color);
  if (file.thumb) {
    const img = new Image();
    img.src = file.thumb;
    img.alt = "";
    thumb.append(img);
  } else {
    thumb.innerHTML = icon(type.icon);
  }
  $(".v-name", body).textContent = file.name;
  $(".v-type", body).textContent = `${type.name}${ext ? ` · .${ext}` : ""}`;
  $(".v-bucket", body).textContent = bucket.name;
  $(".pv-about", body).textContent = EXT_INFO[ext] || "";
  if (TEXT_EXTS.has(ext) && file.size < 300 * 1024) {
    readBlob(file).then(blob => blob?.text()).then(text => {
      if (!text) return;
      const pre = $(".pv-text", body);
      pre.textContent = text.slice(0, 3000) + (text.length > 3000 ? "\n…" : "");
      pre.hidden = false;
    }).catch(() => {});
  }
  const choice = await openModal({
    title: "File info",
    body,
    className: "wide",
    buttons: [
      { label: "Rename", value: "rename" },
      { label: "Move to…", value: "move" },
      { label: "Ask AI", value: "ai" },
      { label: "Vacuum", danger: true, value: "vac" },
      { label: "Close", primary: true, value: null },
    ],
  });
  if (!state.files.includes(file)) return;
  if (choice === "rename") openRenameDialog([file]);
  else if (choice === "move") openMenu(moveToItems([file]), innerWidth / 2 - 115, innerHeight / 4);
  else if (choice === "ai") askAssistantAbout([file]);
  else if (choice === "vac") vacuumFiles([file]);
}

/* ----- rename dialog ----- */
async function openRenameDialog(files) {
  if (!files.length) {
    toast("Select a file to rename first.");
    return;
  }
  if (files.length === 1) {
    const file = files[0];
    const name = await askText("Rename file", { label: "New name", value: file.name, ok: "Rename", selectBase: true });
    if (name && name !== file.name) renameFiles([file], () => sanitizeFileName(name));
    return;
  }
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="grid2">
      <label class="field"><span>Find</span><input type="text" data-k="find" placeholder="e.g. IMG"></label>
      <label class="field"><span>Replace with</span><input type="text" data-k="replace" placeholder="e.g. Photo"></label>
      <label class="field"><span>Add prefix</span><input type="text" data-k="prefix" placeholder="e.g. 2025_"></label>
      <label class="field"><span>Add suffix</span><input type="text" data-k="suffix" placeholder="e.g. _final"></label>
    </div>
    <label class="row"><span>Put the date in front (YYYY-MM-DD_)</span><input type="checkbox" data-k="dateStamp"></label>
    <label class="row"><span>lowercase</span><input type="checkbox" data-k="lowercase"></label>
    <label class="row"><span>Spaces → underscores</span><input type="checkbox" data-k="spaces"></label>
    <label class="field"><span>…or number them as (e.g. “Trip” → Trip_001)</span><input type="text" data-k="numbered"></label>
    <div class="rename-preview"></div>`;
  const spec = {};
  const update = () => {
    $$("[data-k]", body).forEach(input => {
      spec[input.dataset.k] = input.type === "checkbox" ? input.checked : input.value;
    });
    const lines = files.slice(0, 5).map((f, i) =>
      `<div><span class="old">${escapeHtml(f.name)}</span> → <b>${escapeHtml(renameName(f, spec, i))}</b></div>`
    );
    if (files.length > 5) lines.push(`<div class="muted">…and ${files.length - 5} more</div>`);
    $(".rename-preview", body).innerHTML = lines.join("");
  };
  body.addEventListener("input", update);
  body.addEventListener("change", update);
  update();
  const result = await openModal({
    title: `Batch rename ${files.length} files`,
    body,
    className: "wide",
    buttons: [{ label: "Cancel", value: null }, { label: `Rename ${files.length} files`, primary: true, value: "ok" }],
  });
  if (result === "ok") renameFiles(files, { ...spec });
}

/* ----- settings ----- */
async function openSettings(tab = "general") {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="tabs">
      <button type="button" data-tab="general">General</button>
      <button type="button" data-tab="rules">Smart rules</button>
      <button type="button" data-tab="ai">AI assistant</button>
    </div>
    <div class="tab" data-pane="general">
      <label class="row"><span>Theme</span><select id="setTheme" style="width:auto"></select></label>
      <label class="row"><span>Sound effects</span><input type="checkbox" id="setSound"></label>
      <label class="row"><span>Animation speed <small id="speedVal" class="muted"></small></span><input type="range" id="setSpeed" min="0.5" max="3" step="0.1"></label>
      <label class="row"><span>Ask before vacuuming</span><input type="checkbox" id="setConfirm"></label>
      <div class="row"><span>Accent colour</span><div class="swatches" id="setAccent"></div></div>
    </div>
    <div class="tab" data-pane="rules">
      <p class="note">In <b>Smart rules</b> mode, a file whose name matches a rule goes to that folder first; everything else sorts by type. Patterns ignore upper/lower case — use <code>|</code> for “or”, e.g. <code>invoice|receipt</code>.</p>
      <div id="rulesList"></div>
      <button type="button" class="btn" id="addRuleBtn">${icon("plus")}Add rule</button>
    </div>
    <div class="tab" data-pane="ai">
      <label class="field"><span>Brain</span><select id="aiProvider"></select></label>
      <div id="aiFields">
        <label class="field"><span>Base URL</span><input type="url" id="aiBase" placeholder="https://…/v1"></label>
        <label class="field"><span>Model</span>
          <div class="inline"><input type="text" id="aiModel" list="aiModels" placeholder="model name"><datalist id="aiModels"></datalist><button type="button" class="btn" id="aiLoadModels">Load models</button></div>
        </label>
        <label class="field"><span>API key</span>
          <div class="inline"><input type="password" id="aiKey" autocomplete="off" placeholder="paste your key"><button type="button" class="btn" id="aiShowKey">Show</button></div>
        </label>
        <label class="row"><span>Ask for strict JSON replies (turn off if your model errors)</span><input type="checkbox" id="aiJson"></label>
        <div class="inline"><button type="button" class="btn" id="aiTest">${icon("plug")}Test connection</button><span id="aiTestOut" class="muted"></span></div>
      </div>
      <p class="note">The <b>built-in helper</b> runs fully offline. With an online AI, your <b>file names, sizes and dates</b> (never file contents) are sent to that provider when you chat. API keys are stored only in this browser.</p>
    </div>`;

  const showTab = id => {
    $$(".tabs button", body).forEach(b => b.classList.toggle("on", b.dataset.tab === id));
    $$(".tab", body).forEach(p => p.classList.toggle("on", p.dataset.pane === id));
  };
  $$(".tabs button", body).forEach(b => {
    b.onclick = () => showTab(b.dataset.tab);
  });
  showTab(tab);

  // general
  const themeSelect = $("#setTheme", body);
  themeSelect.innerHTML = Object.entries(THEMES).map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
  themeSelect.value = settings.theme;
  themeSelect.onchange = () => applyTheme(themeSelect.value);
  const sound = $("#setSound", body);
  sound.checked = settings.sound;
  sound.onchange = () => {
    settings.sound = sound.checked;
    saveSettings();
  };
  const speed = $("#setSpeed", body);
  const speedVal = $("#speedVal", body);
  speed.value = settings.speed;
  speedVal.textContent = `${settings.speed}×`;
  speed.oninput = () => {
    setSpeed(parseFloat(speed.value));
    speedVal.textContent = `${speed.value}×`;
  };
  const confirmBox = $("#setConfirm", body);
  confirmBox.checked = settings.confirmVacuum;
  confirmBox.onchange = () => {
    settings.confirmVacuum = confirmBox.checked;
    saveSettings();
  };
  const swatches = $("#setAccent", body);
  const drawSwatches = () => {
    swatches.replaceChildren(...ACCENTS.map(({ color, name }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `swatch${settings.accent === color ? " on" : ""}`;
      b.style.background = color;
      b.title = name;
      b.onclick = () => {
        applyAccent(color);
        drawSwatches();
      };
      return b;
    }));
  };
  drawSwatches();

  // rules
  const rulesList = $("#rulesList", body);
  const rulesChanged = () => {
    saveSettings();
    state.files.forEach(refreshCardText);
    syncFolders();
  };
  const drawRules = () => {
    rulesList.replaceChildren(...settings.rules.map((rule, index) => {
      const row = document.createElement("div");
      row.className = "rule";
      row.innerHTML = `<input type="text" class="r-pattern" placeholder="Name contains, e.g. invoice|receipt"><span class="arrow">${icon("send")}</span><input type="text" class="r-folder" placeholder="Folder"><button type="button" class="btn icon-only ghost" title="Delete rule">${icon("x")}</button>`;
      $(".r-pattern", row).value = rule.pattern;
      $(".r-folder", row).value = rule.folder;
      row.addEventListener("input", () => {
        rule.pattern = $(".r-pattern", row).value;
        rule.folder = sanitizeFolderName($(".r-folder", row).value);
        rulesChanged();
      });
      $("button", row).onclick = () => {
        settings.rules.splice(index, 1);
        rulesChanged();
        drawRules();
      };
      return row;
    }));
  };
  drawRules();
  $("#addRuleBtn", body).onclick = () => {
    settings.rules.push({ pattern: "", folder: "", icon: "folder" });
    drawRules();
    $$(".r-pattern", rulesList).pop()?.focus();
  };

  // AI
  const providerSelect = $("#aiProvider", body);
  providerSelect.innerHTML = Object.entries(PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${escapeHtml(p.label)}</option>`)
    .join("");
  const base = $("#aiBase", body);
  const model = $("#aiModel", body);
  const key = $("#aiKey", body);
  const json = $("#aiJson", body);
  const out = $("#aiTestOut", body);
  const fillAI = () => {
    const cfg = aiConfig();
    providerSelect.value = cfg.id;
    $("#aiFields", body).hidden = cfg.id === "offline";
    base.value = cfg.baseUrl;
    model.value = cfg.model;
    key.value = cfg.apiKey;
    key.placeholder = cfg.needsKey ? "paste your key" : "not needed for local servers";
    json.checked = settings.ai.jsonMode;
    out.textContent = "";
  };
  const saveAI = () => {
    const id = settings.ai.provider;
    settings.ai.configs[id] = { baseUrl: base.value.trim(), model: model.value.trim(), apiKey: key.value.trim() };
    settings.ai.jsonMode = json.checked;
    saveSettings();
    updateProviderLabel();
  };
  providerSelect.onchange = () => {
    settings.ai.provider = providerSelect.value;
    saveSettings();
    fillAI();
    updateProviderLabel();
  };
  [base, model, key, json].forEach(input => input.addEventListener("change", saveAI));
  $("#aiShowKey", body).onclick = () => {
    key.type = key.type === "password" ? "text" : "password";
  };
  $("#aiLoadModels", body).onclick = async () => {
    saveAI();
    out.textContent = "Loading models…";
    try {
      const models = await loadModels();
      $("#aiModels", body).innerHTML = models.map(m => `<option value="${escapeHtml(m)}">`).join("");
      out.textContent = `Loaded ${models.length} models. Click the Model field to choose one.`;
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    }
  };
  $("#aiTest", body).onclick = async () => {
    saveAI();
    out.textContent = "Talking to the AI…";
    try {
      const reply = await callLLM(
        [{ role: "user", content: "Say hello in 5 words or fewer." }],
        'Reply only with JSON like {"reply":"…","actions":[]}.'
      );
      out.textContent = `Connected. Reply: ${parseAssistantJson(reply).reply.slice(0, 80)}`;
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    }
  };
  fillAI();

  await openModal({ title: "Settings", body, className: "wide", buttons: [{ label: "Done", primary: true }] });
  settings.rules = settings.rules.filter(rule => rule.pattern.trim() && rule.folder.trim());
  rulesChanged();
}

/* ----- command palette ----- */
function commandList() {
  const selected = selectedFiles();
  return [
    { icon: "wand", label: "Sort files now", kbd: "S", run: () => sortFiles(actionTargets()) },
    ...Object.entries(MODES).map(([id, mode]) => ({ icon: mode.icon, label: `Sort mode: ${mode.label}`, run: () => setMode(id) })),
    { icon: "vacuum", label: "Vacuum selected files", kbd: "Del", disabled: !selected.length, run: () => vacuumFiles(selectedFiles()) },
    { icon: "undo", label: "Undo", kbd: "Ctrl+Z", disabled: !state.history.length, run: undo },
    { icon: "check-square", label: "Select all", kbd: "Ctrl+A", run: selectAllVisible },
    { icon: "square", label: "Select none", run: clearSelection },
    { icon: "swap", label: "Invert selection", kbd: "Ctrl+I", run: invertSelection },
    { icon: "copy", label: "Select duplicates", run: () => { const d = duplicateIds(); selectFiles(state.files.filter(f => d.has(f.id))); } },
    { icon: "database", label: "Select big files (> 50 MB)", run: () => selectFiles(state.files.filter(f => f.size > 50 * MB)) },
    { icon: "edit", label: "Rename selected…", kbd: "F2", disabled: !selected.length, run: () => openRenameDialog(selectedFiles()) },
    { icon: "folder", label: "New folder…", kbd: "N", run: newFolderPrompt },
    { icon: "folder-open", label: "Open folder…", kbd: "Ctrl+O", run: openFolderPicker },
    { icon: "layers", label: "Load demo files", run: loadDemo },
    { icon: "file-plus", label: "Add files to preview…", run: () => $("#filePick").click() },
    { icon: "inbox", label: "Open vacuum bag", run: () => openDrawer(bagEntry) },
    { icon: "trash", label: "Empty vacuum bag…", run: emptyBag },
    { icon: "list", label: "Toggle grid / list view", run: () => setView(settings.view === "list" ? "grid" : "list") },
    { icon: "volume", label: `Turn sound ${settings.sound ? "off" : "on"}`, run: () => { settings.sound = !settings.sound; saveSettings(); } },
    { icon: "sliders", label: "Settings", kbd: "Ctrl+,", run: () => openSettings() },
    { icon: "tag", label: "Edit smart rules", run: () => openSettings("rules") },
    { icon: "plug", label: "AI assistant settings", run: () => openSettings("ai") },
    { icon: "assistant", label: "Open the assistant", kbd: "Ctrl+J", run: () => toggleChat(true) },
    { icon: "keyboard", label: "Keyboard shortcuts", kbd: "?", run: openShortcuts },
    { icon: "info", label: "About Sortie", run: openAbout },
  ].filter(cmd => !cmd.disabled);
}

function fuzzyScore(label, query) {
  if (!query) return 1;
  const text = label.toLowerCase();
  if (text.includes(query)) return 100 - text.indexOf(query);
  if (query.split(/\s+/).every(word => text.includes(word))) return 50;
  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i++;
  }
  return i === query.length ? 10 : 0;
}

function openPalette(initial = "") {
  const body = document.createElement("div");
  body.innerHTML = `<div class="pal-search">${icon("search")}<input type="search" class="pal-input" placeholder="Type a command, or ask the assistant" autocomplete="off"></div><ul class="pal-list"></ul>`;
  openModal({
    body,
    className: "palette",
    onMount: (modal, close) => {
      const input = $(".pal-input", modal);
      const list = $(".pal-list", modal);
      let items = [];
      let active = 0;
      const run = index => {
        const item = items[index];
        if (!item) return;
        close(null);
        setTimeout(() => item.run(), 60);
      };
      const render = () => {
        const query = input.value.trim().toLowerCase();
        items = commandList()
          .map(cmd => ({ cmd, score: fuzzyScore(cmd.label, query) }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map(x => x.cmd);
        const question = input.value.trim();
        if (question) {
          items.push({ icon: "assistant", label: `Ask the assistant: “${question}”`, run: () => { toggleChat(true); sendChat(question); } });
        }
        active = Math.max(0, Math.min(active, items.length - 1));
        list.replaceChildren(...items.map((item, index) => {
          const li = document.createElement("li");
          li.className = `pal-item${index === active ? " on" : ""}`;
          li.innerHTML = `<span class="pi">${icon(item.icon)}</span><span class="l"></span><kbd></kbd>`;
          $(".l", li).textContent = item.label;
          $("kbd", li).textContent = item.kbd || "";
          if (!item.kbd) $("kbd", li).remove();
          li.onclick = () => run(index);
          li.onpointermove = () => {
            if (active === index) return;
            active = index;
            $$(".pal-item", list).forEach((el, i) => el.classList.toggle("on", i === active));
          };
          return li;
        }));
        $(".pal-item.on", list)?.scrollIntoView({ block: "nearest" });
      };
      input.addEventListener("input", () => {
        active = 0;
        render();
      });
      input.addEventListener("keydown", e => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          active = (active + 1) % Math.max(1, items.length);
          render();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          active = (active - 1 + items.length) % Math.max(1, items.length);
          render();
        } else if (e.key === "Enter") {
          e.preventDefault();
          run(active);
        }
      });
      input.value = initial;
      render();
      input.focus();
    },
  });
}

function openShortcuts() {
  const rows = [
    ["Click / tap", "Select a file (Shift+click selects a range)"],
    ["Double-click / Space", "Preview & info"],
    ["Right-click / long-press", "File menu"],
    ["Drag a card", "Drop it on any folder (long-press first on touch)"],
    ["S", "Sort selected / shown files"],
    ["Delete / Backspace", "Vacuum selected"],
    ["F2", "Rename selected"],
    ["N", "New folder"],
    ["/", "Search"],
    ["Ctrl+A · Ctrl+I · Esc", "Select all · invert · clear"],
    ["Ctrl+Z", "Undo"],
    ["Ctrl+K", "Command palette"],
    ["Ctrl+J", "Assistant chat"],
    ["Ctrl+O · Ctrl+,", "Open folder · Settings"],
  ];
  openModal({
    title: "Keyboard shortcuts",
    body: `<table class="kbd-table">${rows.map(([k, v]) => `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>`,
    buttons: [{ label: "Got it", primary: true }],
  });
}

function openAbout() {
  openModal({
    title: "About Sortie",
    body: `<p>A playful file sorter: files <b>fly into folders</b>, a little <b>vacuum</b> slurps up what you delete, and an <b>assistant</b> does the boring bits for you.</p>
      <p class="note">Deleting never erases straight away — files go to <b>${BAG_DIR_NAME}</b> until you empty it. Real-folder mode needs Chrome or Edge on a computer.</p>`,
    buttons: [{ label: "Nice", primary: true }],
  });
}

/* ---------------- pointer: select, long-press menu, drag & drop ---------------- */
let drag = null;
let lastPointerType = "mouse";

function attachPointer(el, file) {
  el.addEventListener("pointerdown", e => {
    lastPointerType = e.pointerType;
    if (state.busy || e.button > 0 || e.target.closest(".more")) return;
    closeMenus();
    const isTouch = e.pointerType !== "mouse";
    drag = { f: file, el, x0: e.clientX, y0: e.clientY, armed: !isTouch, touch: isTouch, active: false, timer: null, hover: null };
    if (isTouch) {
      drag.timer = setTimeout(() => {
        if (drag && !drag.active) {
          drag.armed = true;
          el.classList.add("lift");
          navigator.vibrate?.(12);
        }
      }, 300);
    }
  });
}

function cancelDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  drag.el.classList.remove("lift");
  drag = null;
}

function beginDrag() {
  drag.active = true;
  clearTimeout(drag.timer);
  drag.group = drag.el.classList.contains("sel") ? selectedFiles() : [drag.f];
  const rect = drag.el.getBoundingClientRect();
  drag.ghost = cloneGhost(drag.el, rect);
  drag.ghost.classList.add("dragging");
  if (drag.group.length > 1) {
    const badge = document.createElement("div");
    badge.className = "stack";
    badge.textContent = drag.group.length;
    drag.ghost.append(badge);
  }
  drag.group.forEach(f => f.el.classList.add("ghosted"));
  Snd.pick();
}

function moveDrag(e) {
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  const tilt = Math.max(-8, Math.min(8, dx * 0.03));
  drag.ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(1.05)`;
  const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest(".folder") || null;
  if (hit !== drag.hover) {
    drag.hover?.classList.remove("hover", "open");
    hit?.classList.add("hover", "open");
    drag.hover = hit;
  }
}

async function endDrag() {
  const d = drag;
  drag = null;
  d.el.classList.remove("lift");
  d.group.forEach(f => f.el.classList.remove("ghosted"));
  const target = d.hover;
  if (target) target.classList.remove("hover", "open");
  if (!target) {
    await d.ghost.animate(
      [{ transform: d.ghost.style.transform }, { transform: "none" }],
      { duration: D(320), easing: "cubic-bezier(.2,.8,.2,1.3)" }
    ).finished;
    d.ghost.remove();
    return;
  }
  const dropRect = d.ghost.getBoundingClientRect();
  d.ghost.remove();
  const key = target.dataset.folder;
  if (key === BAG_KEY) {
    vacuumFiles(d.group);
    return;
  }
  if (key === "__new") {
    const entry = await newFolderPrompt();
    if (entry) sortFiles(d.group, entry);
    return;
  }
  const entry = state.folders.get(key);
  if (entry) sortFiles(d.group, entry, new Map([[d.f, dropRect]]));
}

window.addEventListener("pointermove", e => {
  if (!drag) return;
  const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
  if (!drag.active) {
    if (!drag.armed) {
      if (dist > 10) cancelDrag();
      return;
    }
    if (dist < 6) return;
    beginDrag();
  }
  moveDrag(e);
});

window.addEventListener("pointerup", e => {
  if (!drag) return;
  if (drag.active) {
    endDrag();
    return;
  }
  const { f, armed, touch, x0, y0 } = drag;
  cancelDrag();
  if (touch && armed) openCardMenu(f, x0, y0);   // long-press + release = menu
  else toggleSelect(f, e);
});

window.addEventListener("pointercancel", () => {
  if (drag?.active) endDrag();
  else cancelDrag();
});

document.addEventListener("touchmove", e => {
  if (drag && drag.armed) e.preventDefault();
}, { passive: false });
