"use strict";
/* ==========================================================================
   Sortie · ops — the actual work: sort, vacuum, rename, undo / put back,
   empty the bag, and loading demo / preview / live folders.
   ========================================================================== */

function removeCards(list) {
  const gone = new Set(list);
  flip(() => list.forEach(f => f.el.remove()));
  state.files = state.files.filter(f => !gone.has(f));
  updateUI();
}

/** Make sure the cards we're about to animate are actually visible. */
function revealFiles(list) {
  if (list.some(f => f.el.hidden)) clearFilter();
}

function rememberMoves(items) {
  if (items.length) state.history.push({ kind: "move", items });
}

/* ---------------- sort / move into folders ---------------- */
async function sortFiles(list, forcedEntry = null, fromRects = new Map()) {
  ensureInbox();
  list = list.filter(f => state.files.includes(f));
  if (!list.length || state.busy) return;
  setBusy(true);
  revealFiles(list);
  clearSelection();
  const plan = list.map(f => ({ f, entry: forcedEntry || folderTile(bucketOf(f)) }));
  if (forcedEntry) forcedEntry.el.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (state.root) {
    try {
      for (const entry of new Set(plan.map(p => p.entry))) {
        entry.dir = await state.root.getDirectoryHandle(entry.bucket.name, { create: true });
      }
    } catch (err) {
      toast(`Couldn't create folder: ${err.message}`);
      setBusy(false);
      return;
    }
  }
  const step = Math.min(90, 2400 / plan.length);
  const moved = [];
  let failed = 0;
  await Promise.all(plan.map(async (p, i) => {
    await sleep(D(i * step));
    const prevDir = p.f.dir;
    try {
      await moveFile(p.f, p.entry.dir);
    } catch (err) {
      console.error(err);
      failed++;
      p.f.el.animate(
        [{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }],
        { duration: 200, iterations: 2 }
      );
      return;
    }
    p.f.where = p.entry.key;
    moved.push({ f: p.f, entry: p.entry, prevDir });
    await flyInto(p.f, p.entry, fromRects.get(p.f));
  }));
  removeCards(moved.map(item => item.f));
  rememberMoves(moved);
  setBusy(false);
  if (failed) {
    toast(`${plural(failed, "file")} couldn't be moved (open in another app?)`);
  } else if (moved.length) {
    const where = forcedEntry ? `into “${forcedEntry.key}”` : `into ${plural(new Set(moved.map(m => m.entry)).size, "folder")}`;
    toast(`Sorted ${plural(moved.length, "file")} ${where}${state.source === "preview" ? " (preview only)" : ""}`, { action: { label: "Undo", fn: undo } });
  }
  if (!state.files.length && state.all.length) celebrate();
}

/* ---------------- vacuum ---------------- */
async function vacuumFiles(list, { skipConfirm = false } = {}) {
  ensureInbox();
  list = list.filter(f => state.files.includes(f));
  if (!list.length || state.busy) return;
  if (settings.confirmVacuum && !skipConfirm) {
    const ok = await askConfirm("Vacuum files?", `Vacuum ${plural(list.length, "file")} (${fmtSize(sumSize(list))})? They go to the Vacuum bag and can be restored until you empty it.`, { ok: "Vacuum", danger: true });
    if (!ok) return;
  }
  setBusy(true);
  revealFiles(list);
  clearSelection();
  $("#panel").classList.add("peek");
  const s = vacScale();
  list.sort((a, b) => {
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    return Math.abs(ra.top - rb.top) > 10 ? ra.top - rb.top : rb.left - ra.left;
  });
  list[0].el.scrollIntoView({ block: "nearest", behavior: "instant" });
  const firstRect = list[0].el.getBoundingClientRect();
  placeVac(innerWidth + 30, firstRect.top + firstRect.height / 2 - NOZZLE.y * s);
  vac.classList.add("show", "on");
  Snd.vacStart();
  let bagDir = null;
  try {
    bagDir = await getBagDir();
  } catch (err) {
    toast(`Couldn't create "${BAG_DIR_NAME}": ${err.message}`);
  }
  const moved = [];
  for (const file of list) {
    const prevDir = file.dir;
    try {
      if (state.root) {
        if (!bagDir) throw new Error("no bag folder");
        await moveFile(file, bagDir);
      }
    } catch (err) {
      toast(`Couldn't vacuum ${file.name}: ${err.message}`);
      continue;
    }
    file.el.scrollIntoView({ block: "nearest", behavior: "instant" });
    const rect = file.el.getBoundingClientRect();
    await driveVac(rect.right + 4 - NOZZLE.x * s, rect.top + rect.height / 2 - NOZZLE.y * s);
    await suck(file, rect);
    file.where = BAG_KEY;
    moved.push({ f: file, entry: bagEntry, prevDir });
  }
  await sleep(D(150));
  vac.classList.remove("on");
  Snd.vacStop();
  await driveVac(innerWidth + 40, vacPos.y, 650);
  vac.classList.remove("show");
  $("#panel").classList.remove("peek");
  removeCards(moved.map(item => item.f));
  rememberMoves(moved);
  setBusy(false);
  if (moved.length) {
    toast(`Moved ${plural(moved.length, "file")} to the Vacuum bag`, { action: { label: "Undo", fn: undo } });
  }
  if (!state.files.length && state.all.length) celebrate();
}

/* ---------------- restore: undo & put back ---------------- */
async function restoreItems(items) {
  items = items.filter(item => item.f.where && item.f.where !== "gone" && !state.files.includes(item.f));
  if (!items.length || state.busy) return;
  ensureInbox();
  setBusy(true);
  if (isFiltering()) clearFilter();
  const restored = [];
  for (const item of items) {
    try {
      await moveFile(item.f, item.prevDir || item.f.origDir);
      restored.push(item);
    } catch (err) {
      toast(`Couldn't restore ${item.f.name}: ${err.message}`);
    }
  }
  const restoredFiles = new Set(restored.map(item => item.f));
  state.history = state.history
    .map(batch => (batch.kind === "move" ? { ...batch, items: batch.items.filter(item => !restoredFiles.has(item.f)) } : batch))
    .filter(batch => batch.kind !== "move" || batch.items.length);
  flip(() => {
    for (const item of restored) {
      item.f.where = null;
      item.f.el.style.visibility = "hidden";
      item.f.el.hidden = false;
      item.f.el.classList.remove("sel", "ghosted", "ai-match");
      refreshCardText(item.f);
      filesEl.append(item.f.el);
      state.files.push(item.f);
    }
  });
  await Promise.all(restored.map(async (item, i) => {
    await sleep(D(i * Math.min(80, 1500 / restored.length)));
    item.f.el.scrollIntoView({ block: "nearest" });
    await flyOut(item.f, item.entry);
  }));
  applyOrder(true);
  setBusy(false);
}

function putBack(entry, files) {
  return restoreItems(files.map(f => ({ f, entry, prevDir: f.origDir })));
}

async function undo() {
  if (state.busy || !state.history.length) return;
  const batch = state.history.pop();
  if (batch.kind === "rename") {
    setBusy(true);
    for (const item of [...batch.items].reverse()) {
      if (!state.files.includes(item.f)) continue;
      try {
        await renameOnDisk(item.f, item.from);
        flipRename(item.f);
        await sleep(D(50));
      } catch (err) {
        toast(`Couldn't rename back ${item.f.name}: ${err.message}`);
      }
    }
    applyOrder(true);
    setBusy(false);
    toast(`Restored ${plural(batch.items.length, "name")}`);
    return;
  }
  await restoreItems(batch.items);
}

/* ---------------- empty the bag ---------------- */
async function emptyBag() {
  if (state.busy) return;
  const sessionItems = state.all.filter(f => f.where === BAG_KEY);
  if (state.root) {
    const names = [];
    try {
      const dir = await getBagDir();
      for await (const name of dir.keys()) names.push(name);
    } catch (err) {
      toast(`Couldn't read the bag: ${err.message}`);
      return;
    }
    if (!names.length) {
      toast("The bag is already empty.");
      return;
    }
    const ok = await askConfirm("Empty the Vacuum bag?", `Permanently delete ${plural(names.length, "item")} inside “${BAG_DIR_NAME}”? This can't be undone.`, { ok: "Delete forever", danger: true });
    if (!ok) return;
    const dir = await getBagDir();
    for (const name of names) {
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch (err) {
        toast(`Couldn't delete ${name}: ${err.message}`);
      }
    }
  } else if (!bagEntry.count) {
    toast("The bag is already empty.");
    return;
  } else {
    const ok = await askConfirm("Empty the Vacuum bag?", `Permanently remove ${plural(bagEntry.count, "file")} for good? (Demo / preview — nothing on disk changes.)`, { ok: "Empty it", danger: true });
    if (!ok) return;
  }
  poof(centerOf(iconRect(bagEntry)));
  Snd.sweep(2000, 200, 0.5, 0.2);
  bagEntry.el.animate(
    [{ transform: "rotate(0)" }, { transform: "rotate(-10deg)" }, { transform: "rotate(10deg)" }, { transform: "none" }],
    { duration: D(400) }
  );
  sessionItems.forEach(f => {
    f.where = "gone";
  });
  state.all = state.all.filter(f => f.where !== "gone");
  bagEntry.count = 0;
  setCount(bagEntry);
  state.history = state.history
    .map(batch => (batch.kind === "move" ? { ...batch, items: batch.items.filter(item => item.entry !== bagEntry) } : batch))
    .filter(batch => batch.kind !== "move" || batch.items.length);
  updateUI();
}

/* ---------------- rename ---------------- */
/**
 * spec: { find, replace, prefix, suffix, dateStamp, lowercase, spaces, numbered }
 */
function renameName(file, spec = {}, index = 0) {
  let [base, ext] = splitName(file.name);
  if (spec.find) base = base.split(spec.find).join(spec.replace ?? "");
  if (spec.numbered) base = `${spec.numbered}_${String(index + 1).padStart(3, "0")}`;
  if (spec.dateStamp && !base.startsWith(isoDate(file.modified))) base = `${isoDate(file.modified)}_${base}`;
  if (spec.prefix) base = `${spec.prefix}${base}`;
  if (spec.suffix) base = `${base}${spec.suffix}`;
  if (spec.lowercase) {
    base = base.toLowerCase();
    ext = ext.toLowerCase();
  }
  if (spec.spaces) base = base.replace(/\s+/g, "_");
  return sanitizeFileName(base + ext) || file.name;
}

function dedupeName(name, taken) {
  const [base, ext] = splitName(name);
  let candidate = name;
  let n = 1;
  while (taken.has(candidate.toLowerCase())) candidate = `${base} (${n++})${ext}`;
  return candidate;
}

async function renameFiles(list, spec) {
  ensureInbox();
  list = list.filter(f => state.files.includes(f));
  if (!list.length || state.busy) return;
  setBusy(true);
  revealFiles(list);
  const taken = new Set(state.files.filter(f => !list.includes(f)).map(f => f.name.toLowerCase()));
  const items = [];
  for (const [i, file] of list.entries()) {
    let target = typeof spec === "function" ? spec(file, i) : renameName(file, spec, i);
    if (!target || target === file.name) {
      taken.add(file.name.toLowerCase());
      continue;
    }
    if (!file.handle) target = dedupeName(target, taken);
    const from = file.name;
    try {
      await renameOnDisk(file, target);
    } catch (err) {
      toast(`Couldn't rename ${from}: ${err.message}`);
      continue;
    }
    taken.add(file.name.toLowerCase());
    items.push({ f: file, from, to: file.name });
    flipRename(file);
    await sleep(D(60));
  }
  await sleep(D(300));
  applyOrder(true);
  setBusy(false);
  if (items.length) {
    state.history.push({ kind: "rename", items });
    updateUI();
    toast(`Renamed ${plural(items.length, "file")}`, { action: { label: "Undo", fn: undo } });
  } else {
    toast("Nothing to rename — the names would stay the same.");
  }
}

/* ---------------- smart rules ---------------- */
function addRule(pattern, folder) {
  const cleanFolder = sanitizeFolderName(folder);
  if (!pattern || !cleanFolder) return false;
  const exists = settings.rules.some(r => r.pattern.toLowerCase() === pattern.toLowerCase() && r.folder.toLowerCase() === cleanFolder.toLowerCase());
  if (!exists) settings.rules.push({ pattern, folder: cleanFolder });
  saveSettings();
  state.files.forEach(refreshCardText);
  syncFolders();
  return !exists;
}

/* ---------------- loading files ---------------- */
function resetSession(files, source, root, statusText) {
  state.all.forEach(f => f.thumb && URL.revokeObjectURL(f.thumb));
  for (const entry of state.folders.values()) entry.el.remove();
  state.folders.clear();
  state.history = [];
  state.all = files;
  state.files = [...files];
  state.source = source;
  state.root = root;
  state.anchor = null;
  state.filter = { text: "", chip: "all" };
  $("#search").value = "";
  bagEntry.dir = null;
  bagEntry.count = 0;
  setCount(bagEntry);
  setStatus(statusText);
  state.view = { kind: "inbox", key: null };
  resetNavHistory();
  $("#inboxView").hidden = false;
  $("#folderView").hidden = true;
  $("#inboxTools").hidden = false;
  renderFiles();
}

function makeThumb(file, index) {
  return IMAGE_MIME.test(file.type) && index < 400 && file.size < 25e6 ? URL.createObjectURL(file) : null;
}

function demoFiles() {
  const names = [
    "IMG_2041.jpg", "IMG_2041 (1).jpg", "vacation_beach.png", "IMG_2042.HEIC", "wallpaper.webp", "logo.svg",
    "screenshot 2025-03-01.png", "Screenshot 2025-06-12 at 10.42.png",
    "tax_return_2025.pdf", "resume_final_v3_REAL.docx", "budget.xlsx", "budget copy.xlsx", "slides.pptx",
    "invoice_0423.pdf", "receipt_amazon.pdf", "notes.md", "draft.txt", "meeting notes.txt",
    "screen_recording.mp4", "clip.mov", "song.mp3", "song (2).mp3", "podcast_ep12.mp3", "voice_memo.m4a",
    "project.zip", "backup.7z", "setup.exe", "installer.msi",
    "main.py", "index.html", "script.js", "data.csv",
    "bracket_v2.step", "gearbox.f3d", "enclosure.stl", "part.sldprt", "benchy.3mf", "bracket_v2.gcode",
    "random_thing.xyz", "untitled",
  ];
  const scales = { Videos: 4e8, Archives: 8e7, Apps: 6e7, Audio: 8e6, Images: 4e6, "3D & CAD": 2e7 };
  const now = Date.now();
  return names.map(name => ({
    id: ++state.uid,
    name,
    size: Math.round((scales[typeOf(name).name] || 4e5) * (0.05 + Math.random())),
    modified: now - Math.random() * 720 * DAY_MS,
    where: null,
  }));
}

function loadDemo() {
  if (state.busy) return;
  resetSession(demoFiles(), "demo", null, "Demo files — nothing on disk changes");
}

function loadPreview(fileList) {
  if (state.busy || !fileList.length) return;
  const files = [...fileList].map((file, i) => ({
    id: ++state.uid,
    name: file.name,
    size: file.size,
    modified: file.lastModified,
    blob: file,
    thumb: makeThumb(file, i),
    where: null,
  }));
  resetSession(files, "preview", null, `Preview of ${plural(files.length, "file")} — files on disk stay untouched`);
}

async function loadLive(root) {
  if (state.busy) return;
  const files = [];
  const subfolders = [];
  let bagCount = 0;
  setStatus(`Reading ${root.name}…`);
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory") {
      if (name === BAG_DIR_NAME) {
        for await (const _ of handle.keys()) bagCount++;
      } else if (!name.startsWith(".")) {
        subfolders.push({ name, handle });
      }
      continue;
    }
    if (name.startsWith(".") || name.startsWith("~$") || name.toLowerCase() === "desktop.ini") continue;
    try {
      const file = await handle.getFile();
      files.push({
        id: ++state.uid,
        name,
        size: file.size,
        modified: file.lastModified,
        handle,
        dir: root,
        origDir: root,
        thumb: makeThumb(file, files.length),
        where: null,
      });
    } catch (err) {
      console.warn("skipping", name, err);
    }
  }
  resetSession(files, "live", root, `${root.name} — live folder · changes are applied on disk`);
  for (const { name, handle } of subfolders.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40)) {
    const entry = folderTile(bucketForName(name));
    entry.pinned = true;
    entry.dir = handle;
  }
  bagEntry.count = bagCount;
  setCount(bagEntry);
  if (!files.length) toast("This folder has no loose files to sort.");
}

async function openFolderPicker() {
  if (!window.showDirectoryPicker) {
    toast("This browser can't open real folders. Use Chrome or Edge on a computer — or “Add files” to preview.", { ms: 5000 });
    return;
  }
  try {
    const root = await window.showDirectoryPicker({ id: "sortie", mode: "readwrite" });
    await loadLive(root);
  } catch (err) {
    if (err.name !== "AbortError") toast(`Couldn't open folder: ${err.message}`);
  }
}
