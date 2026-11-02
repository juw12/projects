"use strict";
/* ==========================================================================
   Sortie · main — wires the shell (sidebar, top bar, panel), keyboard
   shortcuts and file drops, then starts with demo files.
   ========================================================================== */

/* ---------------- sidebar ---------------- */
$("#wsBtn").onclick = openAppMenu;
$("#btnNew").onclick = openNewMenu;
$("#btnNewFolder").onclick = e => {
  e.stopPropagation();
  newFolderPrompt();
};
$$(".nav-item[data-smart]").forEach(item => {
  item.onclick = () => showInbox(item.dataset.smart);
});
attachFolderHandlers(bagEntry);
$("#btnSettings").onclick = () => openSettings();
$("#scrim").onclick = closeSidebar;
$("#btnStorageSort").onclick = () => {
  ensureInbox();
  sortFiles([...state.files]);
};
$("#tagList").replaceChildren(...Object.entries(TAG_VIEWS).map(([id, view]) => {
  const item = make("button", "nav-item", `<span class="tag-dot"></span><span class="nl"></span><span class="nc" id="cnt-${id}"></span>`);
  item.dataset.tag = id;
  $(".tag-dot", item).style.background = typeByName(view.type).color;
  $(".nl", item).textContent = view.title;
  item.onclick = () => showInbox(id);
  return item;
}));

/* ---------------- top bar ---------------- */
$("#btnHamburger").onclick = () => (appEl.classList.contains("sb-open") ? closeSidebar() : openSidebar());
$("#btnPalette").onclick = () => openPalette();
$("#btnUndo").onclick = undo;
$("#btnSort").onclick = () => sortFiles(actionTargets());
$("#btnVac").onclick = () => vacuumFiles(selectedFiles());
$("#btnDetails").onclick = () => togglePanel("details");
$("#btnFilterMenu").onclick = e => {
  ensureInbox();
  const rect = e.currentTarget.getBoundingClientRect();
  openMenu(filterMenuItems(), rect.right - 260, rect.bottom + 6);
};
$("#btnChat").onclick = () => toggleChat();
$("#search").addEventListener("input", e => {
  ensureInbox();
  state.filter.text = e.target.value;
  applyFilter();
});
$("#search").addEventListener("keydown", e => {
  if (e.key === "Escape") {
    setFilterText("");
    e.target.blur();
  }
});
$("#filePick").onchange = e => {
  loadPreview(e.target.files);
  e.target.value = "";
};

/* ---------------- content ---------------- */
$("#mode").onchange = e => setMode(e.target.value);
$("#btnGrid").onclick = () => setView("grid");
$("#btnList").onclick = () => setView("list");
$("#clearFilter").onclick = clearFilter;
$("#btnBack").onclick = () => goHistory(-1);
$("#btnFwd").onclick = () => goHistory(1);
$("#titleBtn").onclick = e => {
  const rect = e.currentTarget.getBoundingClientRect();
  const entry = currentFolderEntry();
  if (entry) {
    openFolderMenu(entry, rect.left, rect.bottom + 4);
    return;
  }
  openMenu([
    { icon: "folder-plus", label: "New folder", kbd: "N", action: newFolderPrompt },
    { icon: "wand", label: "Sort files", kbd: "S", disabled: !state.files.length, action: () => sortFiles(actionTargets()) },
    { icon: "check-square", label: "Select all", kbd: "Ctrl+A", disabled: !state.files.length, action: selectAllVisible },
    { sep: true },
    { icon: "folder-open", label: "Open a folder from disk…", kbd: "Ctrl+O", action: openFolderPicker },
    { icon: "file-plus", label: "Add files to preview…", action: () => $("#filePick").click() },
    { icon: "layers", label: "Load demo files", action: loadDemo },
  ], rect.left, rect.bottom + 4);
};
$("#btnSelClear").onclick = clearSelection;
$("#btnSelSort").onclick = () => sortFiles(selectedFiles());
$("#btnSelRename").onclick = () => openRenameDialog(selectedFiles());
$("#btnSelMove").onclick = e => {
  const rect = e.currentTarget.getBoundingClientRect();
  openMenu(moveToItems(selectedFiles()), rect.left, rect.bottom + 4);
};
$("#btnSelMore").onclick = e => {
  const selected = selectedFiles();
  if (!selected.length) return;
  const rect = e.currentTarget.getBoundingClientRect();
  openCardMenu(selected[0], rect.left, rect.bottom + 4);
};
$$("#listHead button").forEach(button => {
  button.onclick = () => setOrder(button.dataset.order);
});
$("#content").addEventListener("pointerdown", e => {
  // click on empty space clears the selection, like a desktop file manager
  if (e.button === 0 && !e.target.closest(".card, button, input, select, .fv-row, .chips, .selbar") && selectedFiles().length) clearSelection();
});

/* ---------------- right panel ---------------- */
$$(".ptab").forEach(tab => {
  tab.onclick = () => openPanel(tab.dataset.tab);
});
$("#panelClose").onclick = closePanel;
$("#chatForm").addEventListener("submit", e => {
  e.preventDefault();
  sendChat($("#chatInput").value);
});
$("#chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat(e.target.value);
  }
});
$("#chatInput").addEventListener("input", e => {
  e.target.style.height = "auto";
  e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
});
$("#chatMenu").onclick = e => {
  const rect = e.currentTarget.getBoundingClientRect();
  openMenu([
    { header: "Assistant engine" },
    ...Object.entries(PROVIDERS).map(([id, provider]) => ({
      label: provider.label,
      checked: settings.ai.provider === id,
      action: () => {
        settings.ai.provider = id;
        saveSettings();
        updateProviderLabel();
        const cfg = aiConfig();
        if (cfg.needsKey && !cfg.apiKey) openSettings("ai");
        else toast(`Assistant now uses: ${provider.label}`);
      },
    })),
    { sep: true },
    { icon: "plug", label: "Assistant settings…", action: () => openSettings("ai") },
    {
      icon: "x-circle", label: "Clear conversation", action: () => {
        $("#chatLog").replaceChildren();
        chatState.history = [];
        chatState.lastFilter = null;
        chatState.greeted = false;
        greet();
      },
    },
  ], rect.right - 240, rect.bottom + 4);
};

/* ---------------- global pointer & keys ---------------- */
document.addEventListener("pointerdown", e => {
  if (menuStack.length && !e.target.closest(".menu, #wsBtn, #btnNew, #chatMenu, #titleBtn, #btnFilterMenu, #btnSelMove, #btnSelMore, .chip, .more")) closeMenus();
}, true);
let lastWidth = innerWidth;
window.addEventListener("resize", () => {
  // phones fire resize when the address bar slides; only close menus on real width changes
  if (innerWidth !== lastWidth) closeMenus();
  lastWidth = innerWidth;
});

document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (menuStack.length && handleMenuKey(e)) return;

  if (e.key === "Escape") {
    if (modalStack.length) modalStack[modalStack.length - 1](null);
    else if (appEl.classList.contains("sb-open")) closeSidebar();
    else if (panelState.open && e.target.closest?.("#panel")) closePanel();
    else {
      clearSelection();
      highlightFiles([], false);
    }
    return;
  }
  if (mod && key === "k") {
    e.preventDefault();
    if (!modalStack.length) openPalette();
    return;
  }
  if (mod && key === "j") {
    e.preventDefault();
    toggleChat();
    return;
  }
  if (modalStack.length) return;
  if (e.target.matches?.("input, textarea, select, [contenteditable]")) return;
  if ((e.altKey && e.key === "ArrowLeft") || (mod && e.key === "[")) {
    e.preventDefault();
    goHistory(-1);
    return;
  }
  if ((e.altKey && e.key === "ArrowRight") || (mod && e.key === "]")) {
    e.preventDefault();
    goHistory(1);
    return;
  }

  if (mod) {
    if (key === "z") {
      e.preventDefault();
      undo();
    } else if (key === "a") {
      e.preventDefault();
      ensureInbox();
      selectAllVisible();
    } else if (key === "i") {
      e.preventDefault();
      invertSelection();
    } else if (key === "o") {
      e.preventDefault();
      openFolderPicker();
    } else if (e.key === ",") {
      e.preventDefault();
      openSettings();
    }
    return;
  }
  if (state.busy) return;
  switch (e.key) {
    case "Delete":
    case "Backspace":
      e.preventDefault();
      vacuumFiles(selectedFiles());
      break;
    case "F2":
      e.preventDefault();
      openRenameDialog(selectedFiles());
      break;
    case " ": {
      const first = selectedFiles()[0];
      if (first) {
        e.preventDefault();
        openPreview(first);
      }
      break;
    }
    case "/":
      e.preventDefault();
      $("#search").focus();
      break;
    case "?":
      openShortcuts();
      break;
    case "s":
    case "S":
      sortFiles(actionTargets());
      break;
    case "n":
    case "N":
      newFolderPrompt();
      break;
    case "i":
    case "I":
      togglePanel("details");
      break;
    default:
      break;
  }
});

/* ---------------- drop files or a whole folder from Explorer / Finder ---------------- */
const dropZone = $("#content");
dropZone.addEventListener("dragover", e => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    document.body.classList.add("filedrag");
  }
});
dropZone.addEventListener("dragleave", () => document.body.classList.remove("filedrag"));
dropZone.addEventListener("drop", async e => {
  e.preventDefault();
  document.body.classList.remove("filedrag");
  const items = [...e.dataTransfer.items].filter(item => item.kind === "file");
  const handlePromises = items.map(item => (item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null));
  const plainFiles = [...e.dataTransfer.files];
  for (const promise of handlePromises) {
    const handle = promise && await promise.catch(() => null);
    if (handle && handle.kind === "directory") {
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission === "granted") loadLive(handle);
      else toast("Permission denied — can't sort that folder.");
      return;
    }
  }
  loadPreview(plainFiles);
});

/* ---------------- start ---------------- */
$("#mode").value = settings.mode;
filesEl.dataset.size = settings.cardSize;
$("#filesWrap").classList.toggle("list", settings.view === "list");
$("#btnGrid").classList.toggle("on", settings.view !== "list");
$("#btnList").classList.toggle("on", settings.view === "list");
hydrateIcons();
if (settings.uiVersion !== 3) {
  settings.uiVersion = 3;
  settings.theme = "system";
}
applyTheme(settings.theme);
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", () => {
  if (settings.theme === "system") applyTheme("system");
});
if (!ACCENTS.some(a => a.color === settings.accent)) {
  settings.accent = ACCENTS[0].color;   // migrate colours saved by earlier versions
  saveSettings();
}
document.documentElement.style.setProperty("--accent", settings.accent);
updateProviderLabel();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadDemo();
if (window.matchMedia("(min-width: 1280px)").matches) openPanel("details");
