/* Beacon console — vanilla JS, no build step. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const TOKEN_KEY = "beacon.admin";

  const hashToken = location.hash.match(/token=([^&]+)/);
  if (hashToken) {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(hashToken[1]));
    history.replaceState(null, "", location.pathname);
  }

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    apps: [],
    app: null,
    publicUrl: location.origin,
    tab: "compose",
    timer: null,
  };

  // ------------------------------------------------------------------ utils
  function toast(message, isError = false) {
    const box = $("#toast");
    box.textContent = message;
    box.className = "toast" + (isError ? " err" : "");
    box.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      box.hidden = true;
    }, isError ? 6000 : 2500);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function when(seconds) {
    if (!seconds) {
      return "—";
    }
    const date = new Date(seconds * 1000);
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function list(value) {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }

  async function api(path, { method = "GET", body } = {}) {
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({ ok: false, error: response.statusText }));
    if (response.status === 401) {
      showLogin();
      throw new Error("Please sign in again");
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || response.statusText);
    }
    return data;
  }

  // ------------------------------------------------------------------ login
  function showLogin() {
    $("#shell").hidden = true;
    $("#login").hidden = false;
    $("#tokenInput").focus();
  }

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.token = $("#tokenInput").value.trim();
    try {
      await loadApps();
      localStorage.setItem(TOKEN_KEY, state.token);
      $("#login").hidden = true;
      $("#shell").hidden = false;
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#logoutBtn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    state.token = "";
    showLogin();
  });

  // ------------------------------------------------------------------- apps
  async function loadApps(selectId) {
    const data = await api("/v1/apps");
    state.apps = data.apps;
    state.publicUrl = data.public_url || location.origin;
    state.channels = data.channels || {};
    renderAppList();
    const wanted = selectId || (state.app && state.app.id) || Number(localStorage.getItem("beacon.app"));
    const app = state.apps.find((a) => a.id === wanted) || state.apps[0];
    $("#empty").hidden = Boolean(app);
    $("#appView").hidden = !app;
    if (app) {
      selectApp(app.id);
    }
  }

  function renderAppList() {
    const nav = $("#appList");
    nav.innerHTML = "";
    for (const app of state.apps) {
      const button = document.createElement("button");
      const total = Object.values(app.subscribers || {}).reduce((a, b) => a + b, 0);
      button.innerHTML = `<span>${escapeHtml(app.name)}</span><span class="count">${total}</span>`;
      button.classList.toggle("active", state.app && state.app.id === app.id);
      button.addEventListener("click", () => selectApp(app.id));
      nav.append(button);
    }
  }

  async function selectApp(appId) {
    const data = await api(`/v1/apps/${appId}`);
    state.app = data.app;
    localStorage.setItem("beacon.app", String(appId));
    renderAppList();
    renderApp(data.stats);
    showTab(state.tab);
  }

  function renderApp(stats) {
    const app = state.app;
    $("#appName").textContent = app.name;
    $("#appKey").textContent = app.app_key;
    $("#tWeb").textContent = (stats.subscribers.webpush || 0).toLocaleString();
    $("#tFcm").textContent = (stats.subscribers.fcm || 0).toLocaleString();
    $("#tSent").textContent = stats.delivered.toLocaleString();
    $("#tClick").textContent = `${(stats.click_rate * 100).toFixed(1)}%`;
    $("#pvApp").textContent = app.name;
    $("#pvIcon").src = app.icon || "icon.svg";
    $("#keyPublic").textContent = app.app_key;
    $("#keySecret").textContent = app.secret_hint;
    const server = state.publicUrl;
    $("#snippetWeb").textContent =
      `<script src="${server}/beacon.js"></script>\n<script>\n` +
      `  Beacon.init({ server: "${server}", appKey: "${app.app_key}" });\n` +
      `  // from a button click:\n` +
      `  enableBtn.onclick = () => Beacon.subscribe({ userId: currentUser.id, tags: ["lang:id"] });\n` +
      `  Beacon.inApp(); // optional in-app banners\n</script>`;
    $("#snippetCurl").textContent =
      `curl -X POST ${server}/v1/send \\\n  -H "Authorization: Bearer sk_…" -H "Content-Type: application/json" \\\n` +
      `  -d '{"title":"Hello","body":"From Beacon","url":"/","target":{"tags":["lang:id"]}}'`;
    const form = $("#settingsForm");
    form.name.value = app.name;
    form.origins.value = app.origins;
    form.icon.value = app.icon;
    form.default_url.value = app.default_url;
    form.vapid_subject.value = app.vapid_subject;
    form.fcm.value = "";
    $("#fcmState").textContent = app.fcm_configured
      ? "✓ Firebase service account saved (paste a new one to replace, or type CLEAR to remove)."
      : "No Firebase service account — native Android devices cannot be reached yet.";
  }

  $("#newAppBtn").addEventListener("click", () => {
    $("#newAppForm").reset();
    $("#newAppDialog").showModal();
  });

  $("#newAppDialog").addEventListener("close", async () => {
    if ($("#newAppDialog").returnValue !== "create") {
      return;
    }
    const form = $("#newAppForm");
    try {
      const data = await api("/v1/apps", {
        method: "POST",
        body: { name: form.name.value, subject: form.subject.value, origins: form.origins.value },
      });
      await loadApps(data.app.id);
      showSecret(data.secret_key);
      showTab("setup");
    } catch (error) {
      toast(error.message, true);
    }
  });

  function showSecret(secret) {
    $("#secretValue").textContent = secret;
    $("#secretDialog").showModal();
  }

  $("#rotateBtn").addEventListener("click", async () => {
    if (!confirm("Rotate the secret? Backends using the old key stop working immediately.")) {
      return;
    }
    try {
      const data = await api(`/v1/apps/${state.app.id}/rotate-secret`, { method: "POST" });
      showSecret(data.secret_key);
      selectApp(state.app.id);
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ------------------------------------------------------------------- tabs
  function showTab(name) {
    state.tab = name;
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".panel").forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    clearInterval(state.timer);
    if (name === "history") {
      loadHistory();
      state.timer = setInterval(loadHistory, 4000);
    }
    if (name === "subscribers") {
      updateContactHints();
      loadSubscribers();
    }
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------------------------------------------------------------- compose
  const compose = $("#composeForm");

  function updatePreview() {
    $("#pvTitle").textContent = compose.title.value || "Your weekly report is ready";
    $("#pvBody").textContent = compose.body.value || "Tap to see how you did this week.";
    const image = compose.image.value.trim();
    $("#pvImage").hidden = !image.startsWith("https://");
    if (image.startsWith("https://")) {
      $("#pvImage").src = image;
    }
  }
  compose.addEventListener("input", updatePreview);

  $$("input[name=audience]", compose).forEach((radio) => {
    radio.addEventListener("change", () => {
      compose.audienceValue.disabled = compose.audience.value === "all";
      compose.audienceValue.placeholder = compose.audience.value === "users" ? "u42, u77" : "lang:id, plan:pro";
    });
  });

  function buildMessage() {
    const message = {
      app_id: state.app.id,
      title: compose.title.value,
      body: compose.body.value,
      url: compose.url.value,
      image: compose.image.value,
      urgency: compose.urgency.value,
      ttl: Number(compose.ttl.value),
      channels: ["webpush", "fcm", "ntfy", "apprise", "inapp"].filter((c) => compose[`ch_${c}`].checked),
    };
    const audience = compose.audience.value;
    const values = list(compose.audienceValue.value);
    if (audience === "all") {
      message.target = { all: true };
    } else if (audience === "tags") {
      message.target = { tags: values, match: compose.matchAll.checked ? "all" : "any" };
    } else {
      message.target = { user_ids: values };
    }
    const exclude = list(compose.exclude.value);
    if (exclude.length) {
      message.target.exclude_tags = exclude;
    }
    if (compose.sendAt.value) {
      message.send_at = new Date(compose.sendAt.value).toISOString();
    }
    return message;
  }

  compose.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#sendBtn");
    button.disabled = true;
    try {
      const message = buildMessage();
      if (!message.channels.length) {
        throw new Error("Pick at least one channel");
      }
      const data = await api("/v1/send", { method: "POST", body: message });
      const scheduled = data.message.send_at > Date.now() / 1000 + 5;
      $("#sendNote").textContent = scheduled
        ? `Scheduled for ${when(data.message.send_at)}`
        : `Sending message #${data.message.id}…`;
      toast(scheduled ? "Scheduled" : "Queued for delivery");
      setTimeout(() => showTab("history"), 600);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("#testSubscribe").addEventListener("click", async () => {
    try {
      Beacon.init({ server: location.origin, appKey: state.app.app_key, serviceWorker: "/console-sw.js", scope: "/" });
      await Beacon.subscribe({ tags: ["beacon:console"] });
      compose.audience.value = "tags";
      compose.audienceValue.disabled = false;
      compose.audienceValue.value = "beacon:console";
      toast("This browser is subscribed — send to tag beacon:console to test");
      selectApp(state.app.id);
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ---------------------------------------------------------------- history
  async function loadHistory() {
    if (!state.app) {
      return;
    }
    try {
      const [data, details] = await Promise.all([
        api(`/v1/messages?app_id=${state.app.id}&limit=100`),
        api(`/v1/apps/${state.app.id}`),
      ]);
      renderApp(details.stats);
      const body = $("#historyBody");
      body.innerHTML = data.messages
        .map((m) => `
          <tr>
            <td>${m.id}</td>
            <td class="wrap">${escapeHtml(m.title)}<br><span class="muted small">${escapeHtml(describeTarget(m.target))} · ${m.channels.join(", ")}</span></td>
            <td><span class="badge ${m.status}" title="${escapeHtml(m.error)}">${m.status}${m.error ? " ⚠" : ""}</span></td>
            <td>${when(m.status === "queued" ? m.send_at : m.finished || m.send_at)}</td>
            <td>${m.targeted}</td><td>${m.delivered}</td><td>${m.failed}</td><td>${m.pruned}</td>
            <td>${m.shown}</td><td>${m.clicked}</td>
            <td>${m.status === "queued" ? `<button class="small" data-cancel="${m.id}">Cancel</button>` : ""}</td>
          </tr>`)
        .join("") || `<tr><td colspan="11" class="muted">Nothing sent yet.</td></tr>`;
      $$("[data-cancel]", body).forEach((b) => b.addEventListener("click", async () => {
        try {
          await api(`/v1/messages/${b.dataset.cancel}/cancel`, { method: "POST" });
          loadHistory();
        } catch (error) {
          toast(error.message, true);
        }
      }));
    } catch (error) {
      toast(error.message, true);
    }
  }

  function describeTarget(target) {
    if (!target || target.all) {
      return "everyone";
    }
    const parts = [];
    if (target.tags) {
      parts.push(`tags ${target.match === "all" ? "all of" : "any of"} ${target.tags.join(", ")}`);
    }
    if (target.user_ids) {
      parts.push(`${target.user_ids.length} user(s)`);
    }
    if (target.exclude_tags) {
      parts.push(`excluding ${target.exclude_tags.join(", ")}`);
    }
    return parts.join("; ");
  }

  // ------------------------------------------------------------ subscribers
  async function loadSubscribers() {
    try {
      const data = await api(`/v1/apps/${state.app.id}/subscribers?limit=300`);
      $("#subsBody").innerHTML = data.subscribers
        .map((s) => `
          <tr>
            <td>${s.id}</td><td>${s.channel}</td><td>${escapeHtml(s.user_id || "—")}</td>
            <td class="wrap">${s.tags.map(escapeHtml).join(", ") || "—"}</td>
            <td>${escapeHtml(s.platform || "—")}</td><td>${when(s.created)}</td>
            <td class="muted small">${escapeHtml(s.address_preview)}${["ntfy", "apprise"].includes(s.channel) ? "" : "…"}</td>
            <td><button class="small ghost" data-remove="${s.id}" title="Remove subscriber">✕</button></td>
          </tr>`)
        .join("") || `<tr><td colspan="8" class="muted">No subscribers yet — add the snippet from Setup to your app, or add an ntfy/Apprise contact above.</td></tr>`;
      $$("[data-remove]", $("#subsBody")).forEach((button) => button.addEventListener("click", async () => {
        if (!confirm(`Remove subscriber #${button.dataset.remove}?`)) {
          return;
        }
        try {
          await api(`/v1/subscribers/${button.dataset.remove}/delete`, { method: "POST" });
          loadSubscribers();
        } catch (error) {
          toast(error.message, true);
        }
      }));
    } catch (error) {
      toast(error.message, true);
    }
  }

  const contactForm = $("#contactForm");

  function updateContactHints() {
    const isNtfy = contactForm.channel.value === "ntfy";
    const apprise = (state.channels && state.channels.apprise) || {};
    contactForm.address.placeholder = isNtfy ? "https://ntfy.sh/my-team-alerts" : "tgram://bottoken/chatid  ·  slack://…  ·  mailto://…";
    contactForm.secret.hidden = !isNtfy;
    $("#contactNote").textContent = isNtfy
      ? "Subscribe to the same topic in the ntfy app."
      : apprise.available ? `Apprise ${apprise.version || ""} ready on the server.` : "Server needs: pip install apprise";
  }

  contactForm.channel.addEventListener("change", updateContactHints);
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const tags = contactForm.tags.value.split(",").map((t) => t.trim()).filter(Boolean);
      const result = await api("/v1/contacts", {
        method: "POST",
        body: {
          app_id: state.app.id,
          channel: contactForm.channel.value,
          address: contactForm.address.value,
          secret: contactForm.secret.value,
          tags,
        },
      });
      toast(`Added ${result.channel} contact #${result.id}`);
      contactForm.address.value = "";
      contactForm.secret.value = "";
      loadSubscribers();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ---------------------------------------------------------------- go live
  let livePoll = null;

  function renderTunnel(tunnel) {
    const labels = {
      stopped: "Not live — Beacon is only reachable on this computer.",
      installing: "Downloading cloudflared (one time, ~50 MB)…",
      starting: "Opening the tunnel…",
      live: "Live ✅",
      error: "Could not go live",
    };
    const stateEl = $("#liveState");
    stateEl.textContent = labels[tunnel.state] + (tunnel.error ? ` — ${tunnel.error}` : "");
    stateEl.className = `live-state ${tunnel.state}`;
    const live = tunnel.state === "live" && tunnel.url;
    $("#liveLinks").hidden = !live;
    if (live) {
      $("#liveUrl").textContent = tunnel.url;
      $("#liveUrl").href = tunnel.url;
      const tryUrl = `${tunnel.url}/try/?app=${encodeURIComponent((state.app && state.app.app_key) || "")}`;
      $("#liveTry").textContent = tryUrl;
      $("#liveTry").href = tryUrl;
    }
    const busy = tunnel.state === "installing" || tunnel.state === "starting";
    $("#liveStart").hidden = Boolean(live) || busy;
    $("#liveStart").textContent = tunnel.state === "error" ? "Try again" : "Go live";
    $("#liveStop").hidden = !(live || busy);
    $("#liveLog").hidden = !(tunnel.state === "error" && tunnel.log.length);
    $("#liveLog").textContent = tunnel.log.join("\n");
    $("#goLiveBtn").textContent = live ? "🌍 Live" : "🌍 Go live";
    $("#goLiveBtn").classList.toggle("is-live", Boolean(live));
    if (live && state.publicUrl !== tunnel.url) {
      state.publicUrl = tunnel.url;
      if (state.app) {
        selectApp(state.app.id);  // setup snippets now show the public URL
      }
    }
    return busy;
  }

  async function refreshTunnel() {
    try {
      const data = await api("/v1/tunnel");
      const busy = renderTunnel(data.tunnel);
      if (!busy && livePoll) {
        clearInterval(livePoll);
        livePoll = null;
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  $("#goLiveBtn").addEventListener("click", () => {
    $("#liveDialog").showModal();
    refreshTunnel();
  });

  $("#liveStart").addEventListener("click", async () => {
    try {
      const data = await api("/v1/tunnel/start", { method: "POST", body: {} });
      renderTunnel(data.tunnel);
      clearInterval(livePoll);
      livePoll = setInterval(refreshTunnel, 1500);
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#liveStop").addEventListener("click", async () => {
    try {
      const data = await api("/v1/tunnel/stop", { method: "POST" });
      state.publicUrl = data.public_url;
      renderTunnel(data.tunnel);
      if (state.app) {
        selectApp(state.app.id);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });

  $$("#liveDialog [data-copy]").forEach((button) => button.addEventListener("click", async () => {
    await navigator.clipboard.writeText($(`#${button.dataset.copy}`).textContent);
    toast("Copied");
  }));

  // --------------------------------------------------------------- settings
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = {
      name: form.name.value,
      origins: form.origins.value,
      icon: form.icon.value,
      default_url: form.default_url.value,
      vapid_subject: form.vapid_subject.value,
    };
    const fcm = form.fcm.value.trim();
    if (fcm === "CLEAR") {
      body.fcm_service_account = "";
    } else if (fcm) {
      body.fcm_service_account = fcm;
    }
    try {
      await api(`/v1/apps/${state.app.id}`, { method: "POST", body });
      toast("Saved");
      loadApps(state.app.id);
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#deleteApp").addEventListener("click", async () => {
    const name = prompt(`Type the app name (${state.app.name}) to delete it and all its subscribers:`);
    if (name !== state.app.name) {
      return;
    }
    try {
      await api(`/v1/apps/${state.app.id}/delete`, { method: "POST" });
      state.app = null;
      loadApps();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ------------------------------------------------------------------- boot
  if (!state.token) {
    showLogin();
  } else {
    $("#shell").hidden = false;
    loadApps().catch((error) => toast(error.message, true));
  }
})();
