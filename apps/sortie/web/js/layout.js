"use strict";
/* ==========================================================================
   Sortie · layout — the app shell: sidebar navigation, folder pages,
   the Details inspector, the right-hand panel and the status bar.
   ========================================================================== */

const appEl = $(".app");
const panelState = { open: false, tab: "details" };
const TAG_VIEWS = {
  images: { title: "Images", type: "Images" },
  docs: { title: "Documents", type: "Documents" },
  media: { title: "Media", type: "Videos" },
  cad: { title: "3D & CAD", type: "3D & CAD" },
};
const navHistory = { stack: [], index: -1, silent: false };
const SMART_VIEWS = {
  all: { title: "Inbox", icon: "inbox" },
  dupes: { title: "Duplicates", icon: "copy" },
  big: { title: "Large files", icon: "database" },
  old: { title: "Older than a year", icon: "clock" },
};

function make(tag, className = "", html = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/* ---------------- views: Inbox vs. folder page ---------------- */
function currentFolderEntry() {
  if (state.view.kind !== "folder") return null;
  return state.view.key === BAG_KEY ? bagEntry : state.folders.get(state.view.key) || null;
}

function ensureInbox() {
  if (state.view.kind !== "inbox") showInbox();
}

function showInbox(chip = null) {
  state.view = { kind: "inbox", key: null };
  $("#inboxView").hidden = false;
  $("#folderView").hidden = true;
  $("#inboxTools").hidden = false;
  if (chip) state.filter.chip = chip;
  applyFilter();
  closeSidebar();
}

function showFolder(entry) {
  if (!entry) return;
  state.view = { kind: "folder", key: entry.key };
  $("#inboxView").hidden = true;
  $("#folderView").hidden = false;
  $("#inboxTools").hidden = true;
  $("#content").scrollTop = 0;
  clearSelection();
  closeSidebar();
}

function renderFolderView(entry) {
  const box = $("#folderView");
  const isBag = entry === bagEntry;
  const files = state.all
    .filter(f => f.where === entry.key)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  box.replaceChildren();

  const actions = make("div", "fv-actions");
  const backAll = make("button", "btn", `${icon("restore")}${isBag ? "Restore all" : "Move all back to Inbox"}`);
  backAll.disabled = !files.length || state.busy;
  backAll.onclick = () => putBack(entry, files);
  actions.append(backAll);
  if (!isBag) {
    const matching = state.files.filter(f => bucketOf(f).name === entry.key);
    const pull = make("button", "btn", `${icon("wand")}Sort matching files here${matching.length ? ` (${matching.length})` : ""}`);
    pull.disabled = !matching.length || state.busy;
    pull.onclick = () => sortFiles(matching, entry);
    actions.append(pull);
  } else {
    const empty = make("button", "btn danger", `${icon("trash")}Empty bag`);
    empty.disabled = state.busy;
    empty.onclick = emptyBag;
    actions.append(empty);
  }
  if (state.root) {
    const note = make("span", "note");
    note.textContent = `On disk: ${state.root.name}/${entry.bucket.name}`;
    actions.append(note);
  }
  box.append(actions);

  if (!files.length) {
    const older = isBag ? entry.count : 0;
    const emptyState = make("div", "empty-state show", `
      <div>
        <div class="empty-icon">${icon(isBag ? "trash" : "folder")}</div>
        <h2>${isBag ? "The Vacuum bag is empty" : "Nothing here yet"}</h2>
        <p></p>
      </div>`);
    $("p", emptyState).textContent = isBag
      ? (older ? `${plural(older, "item")} from earlier sessions are stored in “${BAG_DIR_NAME}” on disk.` : "Vacuumed files appear here and can be restored until the bag is emptied.")
      : "Files sorted into this folder during this session appear here.";
    box.append(emptyState);
    return;
  }

  const table = make("div", "table");
  table.append(make("div", "list-head", "<span></span><span>Name</span><span>Kind</span><span>Size</span><span>Date Modified</span><span></span>"));
  const rows = make("div", "rows");
  table.append(rows);
  for (const file of files) {
    const type = typeOf(file.name);
    const row = make("div", "fv-row", `
      <span class="fi">${icon(type.icon)}</span>
      <span class="nm"></span>
      <span class="c kind"></span>
      <span class="c">${fmtSize(file.size)}</span>
      <span class="c date">${fmtDate(file.modified)}</span>
      <button class="btn small" type="button">${isBag ? "Restore" : "Put back"}</button>`);
    $(".fi", row).style.setProperty("--c", type.color);
    $(".nm", row).textContent = file.name;
    $(".kind", row).textContent = kindLabel(file.name);
    $("button", row).disabled = state.busy;
    $("button", row).onclick = () => putBack(entry, [file]);
    rows.append(row);
  }
  box.append(table);
}

/* ---------------- shell rendering ---------------- */
let layoutPending = false;
function scheduleLayout() {
  if (layoutPending) return;
  layoutPending = true;
  queueMicrotask(() => {
    layoutPending = false;
    renderLayout();
  });
}

function renderLayout() {
  let entry = currentFolderEntry();
  if (state.view.kind === "folder" && !entry) {
    state.view = { kind: "inbox", key: null };
    $("#inboxView").hidden = false;
    $("#folderView").hidden = true;
    $("#inboxTools").hidden = false;
    entry = null;
  }
  const inInbox = state.view.kind === "inbox";
  const rootLabel = state.source === "live" ? (state.root?.name || "Folder") : state.source === "preview" ? "Preview" : "Demo files";
  $("#crumbRoot").textContent = rootLabel;
  $("#wsSub").textContent = { demo: "Demo workspace", preview: "Preview · read-only", live: `Live · ${rootLabel}` }[state.source];

  // page header
  const pageIcon = $("#pageIcon");
  let title;
  if (inInbox) {
    const chip = state.filter.chip;
    title = SMART_VIEWS[chip]?.title || TAG_VIEWS[chip]?.title || "Inbox";
    pageIcon.className = "page-icon";
    pageIcon.innerHTML = icon(SMART_VIEWS[chip]?.icon || "inbox");
  } else {
    title = entry === bagEntry ? "Vacuum bag" : entry.key;
    pageIcon.className = "page-icon folder-color";
    pageIcon.style.setProperty("--c", entry === bagEntry ? "var(--danger)" : entry.bucket.color);
    pageIcon.innerHTML = icon(entry === bagEntry ? "trash" : "folder-solid");
  }
  const scopeFiles = inInbox ? visibleFiles() : state.all.filter(f => f.where === entry.key);
  $("#pageTitle").textContent = title;
  $("#crumbHere").textContent = title;
  $("#pageSub").textContent = `${plural(scopeFiles.length, "file")} · ${fmtSize(sumSize(scopeFiles))}`;
  document.title = `${title} — Sortie`;
  $("#filterRow").hidden = !inInbox;

  // sidebar: counts + active item (Favorites, Folders, Tags)
  const ctx = { dupes: duplicateIds() };
  for (const id of [...Object.keys(SMART_VIEWS), ...Object.keys(TAG_VIEWS)]) {
    const countEl = $(`#cnt-${id}`);
    if (!countEl) continue;
    const chip = CHIPS.find(c => c.id === id);
    const count = state.files.filter(f => chip.test(f, ctx)).length;
    countEl.textContent = count || "";
  }
  const knownViews = [...Object.keys(SMART_VIEWS), ...Object.keys(TAG_VIEWS)];
  $$(".nav-item[data-smart]").forEach(item => {
    const id = item.dataset.smart;
    const chip = state.filter.chip;
    item.classList.toggle("active", inInbox && (id === chip || (id === "all" && !knownViews.includes(chip))));
  });
  $$(".nav-item[data-tag]").forEach(item => item.classList.toggle("active", inInbox && item.dataset.tag === state.filter.chip));
  $$(".folder[data-folder]").forEach(row => row.classList.toggle("active", !inInbox && row.dataset.folder === state.view.key));

  renderStorage();
  renderFolderStrip(inInbox);
  recordView();
  $("#btnBack").disabled = navHistory.index <= 0;
  $("#btnFwd").disabled = navHistory.index >= navHistory.stack.length - 1;
  $("#btnStorageSort").disabled = state.busy || !state.files.length;

  // Finder-style status bar
  const badge = $("#statusSource");
  badge.className = `src-badge ${state.source}`;
  badge.textContent = {
    demo: "Demo data — disk not modified",
    preview: "Preview — read-only",
    live: "Live folder — changes are written to disk",
  }[state.source];
  const selected = inInbox ? selectedFiles() : [];
  $("#statusCounts").textContent = selected.length
    ? `${selected.length} of ${plural(scopeFiles.length, "item")} selected, ${fmtSize(sumSize(selected))}`
    : `${plural(scopeFiles.length, "item")}, ${fmtSize(sumSize(scopeFiles))}`;

  $$("#listHead button").forEach(b => b.classList.toggle("sorted", b.dataset.order === settings.orderBy));
  if (!inInbox) renderFolderView(entry);
  if (panelState.open && panelState.tab === "details") renderInspector();
}

function renderFolderStrip(inInbox) {
  const strip = $("#folderStrip");
  const entries = [...state.folders.values()].sort((a, b) => a.key.localeCompare(b.key));
  const show = inInbox && entries.length > 0 && state.files.length > 0;
  $("#folderStripWrap").hidden = !show;
  $("#filesLabel").hidden = !show;
  if (!show) return;
  const signature = entries.map(e => `${e.key}:${e.count}:${e.bucket.color}`).join("|");
  if (strip.dataset.sig === signature) return;
  strip.dataset.sig = signature;
  strip.replaceChildren(...entries.map(entry => {
    const card = make("div", "fcard folder", `<span class="fc-ic">${icon("folder-solid")}</span><span class="fc-name"></span><span class="fc-n"></span>`);
    card.dataset.folder = entry.key;
    card.style.setProperty("--c", entry.bucket.color);
    $(".fc-name", card).textContent = entry.key;
    $(".fc-n", card).textContent = entry.count ? String(entry.count) : "";
    card.title = `Open ${entry.key} · drop files here`;
    card.onclick = () => showFolder(entry);
    card.oncontextmenu = e => {
      e.preventDefault();
      openFolderMenu(entry, e.clientX, e.clientY);
    };
    return card;
  }));
}

/* ---------------- back / forward (Finder) ---------------- */
function recordView() {
  if (navHistory.silent) return;
  const view = { kind: state.view.kind, key: state.view.key, chip: state.filter.chip };
  const current = navHistory.stack[navHistory.index];
  if (current && current.kind === view.kind && current.key === view.key && current.chip === view.chip) return;
  navHistory.stack = navHistory.stack.slice(0, navHistory.index + 1);
  navHistory.stack.push(view);
  navHistory.index = navHistory.stack.length - 1;
}

function goHistory(delta) {
  const target = navHistory.stack[navHistory.index + delta];
  if (!target || state.busy) return;
  navHistory.index += delta;
  navHistory.silent = true;
  if (target.kind === "folder") {
    const entry = target.key === BAG_KEY ? bagEntry : state.folders.get(target.key);
    if (entry) showFolder(entry);
    else showInbox();
  } else {
    showInbox(target.chip);
  }
  navHistory.silent = false;
}

function resetNavHistory() {
  navHistory.stack = [];
  navHistory.index = -1;
}

function renderStorage() {
  const groups = new Map();
  for (const file of state.files) {
    const type = typeOf(file.name);
    groups.set(type, (groups.get(type) || 0) + file.size);
  }
  const total = sumSize(state.files);
  $("#storageTotal").textContent = fmtSize(total);
  const bar = $("#storageBar");
  bar.replaceChildren(...[...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, size]) => {
      const seg = make("span");
      seg.style.width = `${total ? (size / total) * 100 : 0}%`;
      seg.style.background = type.color;
      seg.title = `${type.name}: ${fmtSize(size)}`;
      return seg;
    }));
}

/* ---------------- inspector (Details tab) ---------------- */
let inspectorKey = "";

function renderInspector(force = false) {
  const box = $("#details");
  const selected = selectedFiles();
  const key = [
    state.view.kind, state.view.key, state.files.length, state.all.length, state.history.length, state.busy,
    selected.map(f => `${f.id}:${f.name}`).join(","), settings.mode, bagEntry.count,
  ].join("|");
  if (!force && key === inspectorKey) return;
  inspectorKey = key;
  box.replaceChildren();
  if (state.view.kind === "folder") renderFolderInspector(box, currentFolderEntry());
  else if (selected.length === 1) renderFileInspector(box, selected[0]);
  else if (selected.length > 1) renderMultiInspector(box, selected);
  else renderOverview(box);
}

function quickActions(box, actions) {
  const row = make("div", "insp-actions");
  for (const action of actions) {
    const button = make("button", `qa${action.danger ? " danger" : ""}`, `${icon(action.icon)}${escapeHtml(action.label)}`);
    button.type = "button";
    button.disabled = state.busy;
    button.onclick = e => action.run(e);
    row.append(button);
  }
  box.append(row);
}

function section(box, heading) {
  const sec = make("div", "insp-sec", `<div class="insp-h">${escapeHtml(heading)}</div>`);
  box.append(sec);
  return sec;
}

function propsList(rows) {
  const dl = make("dl", "props");
  for (const [label, value] of rows) {
    const dt = make("dt");
    dt.textContent = label;
    const dd = make("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}

function suggestion(iconName, title, detail, run) {
  const button = make("button", "sugg", `<span class="si">${icon(iconName)}</span><span class="st"><span></span><small></small></span>${icon("chevron-right")}`);
  button.type = "button";
  $(".st > span", button).textContent = title;
  $(".st small", button).textContent = detail;
  button.onclick = run;
  return button;
}

function docTile(file) {
  const type = typeOf(file.name);
  const tile = make("div", "insp-doc", `${icon(type.icon)}<span class="ext"></span>`);
  tile.style.setProperty("--c", type.color);
  $(".ext", tile).textContent = extOf(file.name).slice(0, 5);
  return tile;
}

function renderFileInspector(box, file) {
  const ext = extOf(file.name);
  const preview = make("div", "insp-preview");
  if (file.thumb) {
    const img = new Image();
    img.src = file.thumb;
    img.alt = "";
    preview.append(img);
  } else {
    preview.append(docTile(file));
  }
  const name = make("div", "insp-name");
  name.textContent = file.name;
  const kind = make("div", "insp-kind");
  kind.textContent = `${kindLabel(file.name)} · ${fmtSize(file.size)}`;
  box.append(preview, name, kind);
  quickActions(box, [
    { icon: "eye", label: "Open", run: () => openPreview(file) },
    { icon: "edit", label: "Rename", run: () => openRenameDialog([file]) },
    { icon: "folder-move", label: "Move", run: e => { const r = e.currentTarget.getBoundingClientRect(); openMenu(moveToItems([file]), r.left, r.bottom + 4); } },
    { icon: "trash", label: "Vacuum", danger: true, run: () => vacuumFiles([file]) },
  ]);
  section(box, "Information").append(propsList([
    ["Kind", kindLabel(file.name)],
    ["Size", `${fmtSize(file.size)} (${file.size.toLocaleString()} bytes)`],
    ["Modified", new Date(file.modified).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
    ["Sorts into", bucketOf(file).name],
    ["Location", state.source === "live" ? `${state.root?.name || ""} / Inbox` : "Inbox"],
  ]));
  if (EXT_INFO[ext]) {
    const about = make("p", "insp-about");
    about.textContent = EXT_INFO[ext].replace(/\*\*/g, "");
    section(box, "About this format").append(about);
  }
  section(box, "Assistant").append(suggestion("assistant", "Ask about this file", "Rename, move or explain it", () => askAssistantAbout([file])));
}

function renderMultiInspector(box, files) {
  const preview = make("div", "insp-preview");
  const stack = make("div");
  stack.style.cssText = "position:relative;width:120px;height:100px";
  files.slice(0, 3).forEach((file, i) => {
    const tile = docTile(file);
    tile.style.cssText += `;position:absolute;left:${14 + i * 18}px;top:${i * 4}px;transform:rotate(${(i - 1) * 6}deg) scale(.85)`;
    stack.append(tile);
  });
  preview.append(stack);
  const name = make("div", "insp-name");
  name.textContent = `${files.length} items selected`;
  const kind = make("div", "insp-kind");
  kind.textContent = `${fmtSize(sumSize(files))} in total`;
  box.append(preview, name, kind);
  quickActions(box, [
    { icon: "wand", label: "Sort", run: () => sortFiles(files) },
    { icon: "folder-move", label: "Move", run: e => { const r = e.currentTarget.getBoundingClientRect(); openMenu(moveToItems(files), r.left, r.bottom + 4); } },
    { icon: "edit", label: "Rename", run: () => openRenameDialog(files) },
    { icon: "trash", label: "Vacuum", danger: true, run: () => vacuumFiles(files) },
  ]);
  const byType = new Map();
  for (const file of files) {
    const type = typeOf(file.name);
    const group = byType.get(type) || { count: 0, size: 0 };
    group.count++;
    group.size += file.size;
    byType.set(type, group);
  }
  const sec = section(box, "Kinds");
  for (const [type, group] of [...byType.entries()].sort((a, b) => b[1].size - a[1].size)) {
    const row = make("div", "type-row", `${icon(type.icon)}<span></span><span>${fmtSize(group.size)}</span>`);
    $("span", row).textContent = `${type.name} · ${group.count}`;
    sec.append(row);
  }
}

function renderOverview(box) {
  const dupes = duplicateIds();
  const big = state.files.filter(f => f.size > 50 * MB);
  const old = state.files.filter(f => Date.now() - f.modified > 365 * DAY_MS);
  const head = make("div", "insp-name");
  head.style.marginTop = "0";
  head.textContent = "Inbox overview";
  const sub = make("div", "insp-kind");
  sub.textContent = "Select a file to see its details.";
  box.append(head, sub);

  const stats = make("div", "stat-grid");
  stats.style.marginTop = "14px";
  for (const [value, label] of [
    [state.files.length, "Files"],
    [fmtSize(sumSize(state.files)), "Total size"],
    [dupes.size, "Duplicates"],
    [old.length, "Older than 1 yr"],
  ]) {
    stats.append(make("div", "stat", `<b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span>`));
  }
  box.append(stats);

  if (state.files.length) section(box, "Storage by type").append(renderStats());

  const sugg = section(box, "Suggestions");
  if (state.files.length) {
    sugg.append(suggestion("wand", `Sort ${plural(state.files.length, "file")}`, `Using ${MODES[settings.mode].label.toLowerCase()}`, () => sortFiles(actionTargets())));
  }
  if (dupes.size) {
    sugg.append(suggestion("copy", `Vacuum ${plural(dupes.size, "duplicate")}`, "Copies such as “name (1)” or “name copy”", () => {
      vacuumFiles(state.files.filter(f => dupes.has(f.id)));
    }));
  }
  if (big.length) sugg.append(suggestion("database", `Review ${plural(big.length, "large file")}`, `${fmtSize(sumSize(big))} over 50 MB each`, () => showInbox("big")));
  if (old.length) sugg.append(suggestion("clock", `Review ${plural(old.length, "old file")}`, "Not modified in over a year", () => showInbox("old")));
  sugg.append(suggestion("assistant", "Ask the assistant", "Describe what you want done", () => toggleChat(true)));
}

function renderFolderInspector(box, entry) {
  if (!entry) return;
  const isBag = entry === bagEntry;
  const files = state.all.filter(f => f.where === entry.key);
  const preview = make("div", "insp-preview", `<span class="ficon" style="width:64px;height:64px">${icon(isBag ? "trash" : "folder-solid")}</span>`);
  $(".ficon", preview).style.setProperty("--c", isBag ? "var(--danger)" : entry.bucket.color);
  $(".ficon .ic", preview).style.cssText = "width:64px;height:64px";
  const name = make("div", "insp-name");
  name.textContent = isBag ? "Vacuum bag" : entry.key;
  const kind = make("div", "insp-kind");
  kind.textContent = `${plural(files.length, "file")} · ${fmtSize(sumSize(files))}`;
  box.append(preview, name, kind);
  section(box, "Information").append(propsList([
    ["Type", isBag ? "Recoverable delete" : "Folder"],
    ["This session", plural(files.length, "file")],
    ["On disk", state.root ? `${state.root.name}/${entry.bucket.name}` : "Not written (demo / preview)"],
  ]));
}

/* ---------------- right panel & sidebar ---------------- */
function openPanel(tab = panelState.tab) {
  panelState.open = true;
  panelState.tab = tab;
  appEl.classList.add("panel-open");
  $$(".ptab").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("#details").hidden = tab !== "details";
  $("#chat").hidden = tab !== "assistant";
  $("#btnDetails").classList.toggle("on", tab === "details");
  $("#btnChat").classList.toggle("on", tab === "assistant");
  if (tab === "assistant") {
    if (!chatState.greeted) greet();
    setTimeout(() => $("#chatInput").focus({ preventScroll: true }), 250);
  } else {
    renderInspector(true);
  }
}

function closePanel() {
  panelState.open = false;
  appEl.classList.remove("panel-open");
  $("#btnDetails").classList.remove("on");
  $("#btnChat").classList.remove("on");
}

function togglePanel(tab) {
  if (panelState.open && panelState.tab === tab) closePanel();
  else openPanel(tab);
}

function openSidebar() {
  appEl.classList.add("sb-open");
}

function closeSidebar() {
  appEl.classList.remove("sb-open");
}
