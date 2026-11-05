/* --------------------------------------------------------------------- boot */
function boot() {
  bindEvents();
  theme.init();
  if (params.has("selftest")) {
    runSelfTests();
    return;
  }
  if (params.has("demo")) {
    store.key = "together.demo";
    store.persist = false;
    state = demoState();
  } else if (params.has("fresh")) {
    store.persist = false;
    state = blankState();
  } else {
    state = store.load();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  lastCommitted = JSON.stringify(state);
  const realDevice = store.persist && !params.has("fresh");
  sync = new SyncClient({
    configKey: store.key + ".sync",
    getState: () => state,
    applyRemote: plan => applyRemotePlan(plan),
    onStatus: () => {
      const pill = document.getElementById("saved-pill");
      if (pill) pill.innerHTML = savedPillHTML();
      const line = document.getElementById("sync-status");
      if (line) line.textContent = syncStatusText();
    },
  });
  if (!realDevice) sync.config = null;
  ui.tab = TABS.some(t => t.id === params.get("tab")) ? params.get("tab") : "home";
  render();
  if (realDevice) startConnectivity();
  if (params.has("probe")) {
    setTimeout(writeProbe, 300);
  }
}
/** Service worker, partner sync polling, pairing links and install prompt (real devices only). */
function startConnectivity() {
  if ("serviceWorker" in navigator && location.protocol !== "file:" && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    ui.installPrompt = event;
    if (ui.tab === "settings") safeRender();
  });
  document.addEventListener("focusout", () => setTimeout(() => {
    if (pendingRender) safeRender();
  }, 0));
  document.getElementById("dialog").addEventListener("close", () => {
    if (pendingRender) setTimeout(safeRender, 0);
  });
  const join = location.hash.match(/^#join=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(\.p)?$/);
  if (join) {
    history.replaceState(null, "", location.pathname + location.search);
    const [, room, secret, protectedFlag] = join;
    const alreadyHere = sync.active && sync.config.room === room;
    const connect = passphrase => {
      toast(protectedFlag ? "Unlocking your shared plan…" : "Connecting…");
      sync.join(room, secret, passphrase, Boolean(protectedFlag))
        .then(() => {
          ui.tab = "home";
          render();
          toast("Connected — you now share one plan");
        })
        .catch(error => toast(error.message));
    };
    if (!alreadyHere && protectedFlag) {
      openDialog("Join your partner's plan", `
        <p class="small">Your partner protected your shared plan with a passphrase. Anything already on this device will be merged into it.</p>
        <label class="field">Passphrase<input name="passphrase" type="password" autocomplete="current-password" required></label>`,
      values => connect(values.passphrase), "Join");
    } else if (!alreadyHere && confirm("Join your partner's shared plan on this device?\n\nAnything already on this device will be merged into it.")) {
      connect("");
    }
  }
  const pullIfVisible = () => {
    if (sync.active && document.visibilityState === "visible" && navigator.onLine) sync.pull().catch(() => {});
  };
  setInterval(pullIfVisible, 15000);
  document.addEventListener("visibilitychange", pullIfVisible);
  window.addEventListener("online", pullIfVisible);
  pullIfVisible();
  reminders.schedule();
}

/** Layout probe for the checker: page overflow plus any element poking past the viewport outside a scroll box. */
function writeProbe() {
  const insideScroller = el => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (["auto", "scroll", "hidden"].includes(getComputedStyle(node).overflowX)) return true;
    }
    return false;
  };
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.right > innerWidth + 1 && !insideScroller(el)) {
      clipped.push(`${el.tagName}.${String(el.className).trim()} right=${Math.round(rect.right)}`);
    }
  }
  const result = { errors: capturedErrors, scrollWidth: document.documentElement.scrollWidth, innerWidth, clipped: clipped.slice(0, 5) };
  const probe = document.createElement("pre");
  probe.id = "probe-report";
  probe.hidden = true;
  probe.textContent = JSON.stringify(result);
  document.body.appendChild(probe);
  if (window.parent !== window) window.parent.postMessage(result, "*");
}
boot();
