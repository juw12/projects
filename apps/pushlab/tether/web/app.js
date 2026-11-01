/* Tether web client — no build step, no dependencies. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round4 = (value) => Math.round(value * 10000) / 10000;
  const clamp01 = (value) => Math.min(1, Math.max(0, value));

  const FLOW_KEY = "tether.flow";
  const TOKEN_KEY = "tether.token";

  const state = {
    token: "",
    serial: localStorage.getItem("tether.serial") || "",
    devices: [],
    frameId: 0,
    frameSize: [0, 0],
    streamGen: 0,
    recording: false,
    flow: loadFlow(),
    elements: [],
    uiSize: null,
    highlight: null,
    frameTimes: [],
    objectUrl: null,
  };

  const el = {
    deviceSelect: $("#deviceSelect"),
    statusDot: $("#statusDot"),
    statusText: $("#statusText"),
    fps: $("#fps"),
    banner: $("#banner"),
    phone: $("#phone"),
    screen: $("#screen"),
    hdScreen: $("#hdScreen"),
    hdBtn: $("#hdBtn"),
    overlay: $("#overlay"),
    placeholder: $("#placeholder"),
    recBadge: $("#recBadge"),
    stepList: $("#stepList"),
    stepsEmpty: $("#stepsEmpty"),
    report: $("#report"),
    toast: $("#toast"),
  };

  // ------------------------------------------------------------------ token
  function readToken() {
    const match = location.hash.match(/token=([^&]+)/);
    if (match) {
      localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
      history.replaceState(null, "", location.pathname);
    }
    state.token = localStorage.getItem(TOKEN_KEY) || "";
  }

  function askToken() {
    const dialog = $("#tokenDialog");
    if (dialog.open) {
      return;
    }
    $("#tokenInput").value = "";
    dialog.showModal();
  }

  $("#tokenForm").addEventListener("submit", () => {
    const value = $("#tokenInput").value.trim();
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
      state.token = value;
      boot();
    }
  });

  // -------------------------------------------------------------------- api
  async function api(path, options = {}) {
    const init = { method: options.method || "GET", headers: { "X-Tether-Token": state.token } };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    if (options.raw) {
      init.headers["Content-Type"] = "application/vnd.android.package-archive";
      init.body = options.raw;
    }
    const response = await fetch(path, init);
    if (response.status === 401) {
      askToken();
      throw new Error("Access token required");
    }
    const data = await response.json().catch(() => ({ ok: false, error: response.statusText }));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || response.statusText);
    }
    return data;
  }

  const q = (params) => new URLSearchParams(params).toString();

  function toast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.className = "toast" + (isError ? " err" : "");
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.toast.hidden = true;
    }, isError ? 5000 : 2200);
  }

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.statusDot.className = "dot" + (kind ? " " + kind : "");
  }

  function showBanner(html) {
    el.banner.innerHTML = html;
    el.banner.hidden = !html;
  }

  // ---------------------------------------------------------------- devices
  async function refreshDevices() {
    let data;
    try {
      data = await api("/api/devices");
    } catch (error) {
      setStatus(error.message, "err");
      return;
    }
    state.devices = data.devices;
    const select = el.deviceSelect;
    select.innerHTML = "";
    if (!state.devices.length) {
      select.append(new Option("No devices", ""));
    }
    for (const device of state.devices) {
      const ready = device.state === "device";
      const label = `${device.label}${device.emulator ? " (emulator)" : ""} — ${ready ? device.serial : device.state}`;
      const option = new Option(label, device.serial);
      option.disabled = !ready;
      select.append(option);
    }
    const ready = state.devices.filter((d) => d.state === "device");
    const unauthorized = state.devices.find((d) => d.state === "unauthorized");
    if (unauthorized) {
      showBanner(`<b>${escapeHtml(unauthorized.label)}</b> is waiting for you to accept the <b>Allow USB debugging</b> prompt on the phone.`);
    } else if (!ready.length) {
      showBanner("No device connected. Enable <b>Developer options → USB debugging</b> and plug in a phone, start an emulator, or use <b>📶 Wi-Fi</b> (Android 11+, no cable).");
    } else {
      showBanner("");
    }
    if (!ready.some((d) => d.serial === state.serial)) {
      state.serial = ready.length ? ready[0].serial : "";
    }
    select.value = state.serial;
    selectDevice(state.serial, false);
  }

  function selectDevice(serial, force = true) {
    if (!force && serial === state.activeSerial) {
      return;
    }
    if (hd.active && hd.serial !== serial) {
      stopHd(false);
    }
    state.serial = serial;
    state.activeSerial = serial;
    localStorage.setItem("tether.serial", serial);
    state.frameId = 0;
    state.elements = [];
    drawOverlay();
    el.placeholder.hidden = Boolean(serial);
    el.screen.hidden = true;
    state.streamGen += 1;
    if (serial) {
      streamLoop(state.streamGen);
    } else {
      setStatus("Idle");
    }
  }

  // ----------------------------------------------------------------- stream
  async function streamLoop(generation) {
    setStatus("Connecting…");
    while (generation === state.streamGen && state.serial) {
      if (document.hidden) {
        await sleep(500);
        continue;
      }
      try {
        const response = await fetch(`/api/frame?${q({ serial: state.serial, after: state.frameId })}`, {
          headers: { "X-Tether-Token": state.token },
        });
        if (generation !== state.streamGen) {
          break;
        }
        if (response.status === 200) {
          const blob = await response.blob();
          state.frameId = Number(response.headers.get("X-Frame-Id")) || state.frameId + 1;
          showFrame(blob, Number(response.headers.get("X-Frame-Width")), Number(response.headers.get("X-Frame-Height")));
          const err = response.headers.get("X-Frame-Error");
          setStatus(err ? `Stale: ${err}` : "Live", err ? "err" : "ok");
        } else if (response.status === 204) {
          const id = response.headers.get("X-Frame-Id");
          if (id !== null) {
            state.frameId = Number(id);
          }
        } else if (response.status === 401) {
          askToken();
          return;
        } else {
          const data = await response.json().catch(() => ({}));
          setStatus(data.error || `Error ${response.status}`, "err");
          await sleep(1500);
        }
      } catch (error) {
        setStatus("Server unreachable", "err");
        await sleep(2000);
      }
    }
  }

  function showFrame(blob, width, height) {
    const url = URL.createObjectURL(blob);
    const previous = state.objectUrl;
    state.objectUrl = url;
    el.screen.onload = () => {
      el.screen.hidden = false;
      if (previous) {
        URL.revokeObjectURL(previous);
      }
    };
    el.screen.src = url;
    if (width && height && (width !== state.frameSize[0] || height !== state.frameSize[1])) {
      state.frameSize = [width, height];
      el.phone.style.aspectRatio = `${width} / ${height}`;
      el.phone.classList.toggle("landscape", width > height);
      requestAnimationFrame(drawOverlay);
    }
    const now = performance.now();
    state.frameTimes.push(now);
    state.frameTimes = state.frameTimes.filter((t) => now - t < 3000);
    el.fps.textContent = `${(state.frameTimes.length / 3).toFixed(1)} fps`;
  }

  /** Rectangle of the actual picture inside the <img> (object-fit: contain). */
  function contentRect() {
    if (hd.active) {
      return el.hdScreen.getBoundingClientRect();  // the canvas is exactly the video
    }
    const rect = el.screen.getBoundingClientRect();
    const [w, h] = state.frameSize;
    if (!w || !h) {
      return rect;
    }
    const scale = Math.min(rect.width / w, rect.height / h);
    const width = w * scale;
    const height = h * scale;
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    };
  }

  function normalise(event) {
    const rect = contentRect();
    return {
      x: round4(clamp01((event.clientX - rect.left) / rect.width)),
      y: round4(clamp01((event.clientY - rect.top) / rect.height)),
    };
  }

  function ripple(event) {
    const box = el.phone.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.className = "ripple";
    dot.style.left = `${event.clientX - box.left - 10}px`;
    dot.style.top = `${event.clientY - box.top - 10}px`;
    el.phone.append(dot);
    setTimeout(() => dot.remove(), 500);
  }


  // --------------------------------------------------------------------- HD
  // scrcpy H.264 stream → WebCodecs. Wire format per message (see server/scrcpy.py):
  // u8 kind (1 session, 2 config, 3 key, 4 delta), u64 pts µs, u32 size, payload.
  const hd = { active: false, serial: "", gen: 0, decoder: null, codec: "", config: null, needKey: true,
               stats: { received: 0, decoded: 0, errors: 0, width: 0, height: 0, codec: "" } };
  window.__tetherHd = hd.stats;  // read by the automated browser test

  function avcCodecString(config) {
    for (let i = 0; i + 4 < config.length; i++) {
      if (config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1 && (config[i + 3] & 0x1f) === 7) {
        const hex = (v) => v.toString(16).padStart(2, "0");
        return `avc1.${hex(config[i + 4])}${hex(config[i + 5])}${hex(config[i + 6])}`;
      }
    }
    return "avc1.42001f";
  }

  function hdDecoder(codec) {
    if (hd.decoder && hd.codec === codec && hd.decoder.state === "configured") {
      return hd.decoder;
    }
    if (hd.decoder && hd.decoder.state !== "closed") {
      hd.decoder.close();
    }
    const ctx = el.hdScreen.getContext("2d");
    hd.decoder = new VideoDecoder({
      output: (frame) => {
        if (el.hdScreen.width !== frame.displayWidth || el.hdScreen.height !== frame.displayHeight) {
          el.hdScreen.width = frame.displayWidth;
          el.hdScreen.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
        hd.stats.decoded += 1;
        el.hdScreen.hidden = false;
        el.screen.hidden = true;
        const now = performance.now();
        state.frameTimes.push(now);
        state.frameTimes = state.frameTimes.filter((t) => now - t < 3000);
        el.fps.textContent = `HD · ${(state.frameTimes.length / 3).toFixed(0)} fps`;
      },
      error: (error) => {
        hd.stats.errors += 1;
        hd.needKey = true;
        console.warn("HD decoder error", error);
      },
    });
    hd.decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: "no-preference" });
    hd.codec = codec;
    hd.stats.codec = codec;
    hd.needKey = true;
    return hd.decoder;
  }

  function hdMessage(kind, pts, payload) {
    hd.stats.received += 1;
    if (kind === 1) {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const width = view.getUint32(0);
      const height = view.getUint32(4);
      hd.stats.width = width;
      hd.stats.height = height;
      state.frameSize = [width, height];
      el.phone.style.aspectRatio = `${width} / ${height}`;
      el.phone.classList.toggle("landscape", width > height);
      requestAnimationFrame(drawOverlay);
      return;
    }
    if (kind === 2) {
      hd.config = payload.slice();
      hdDecoder(avcCodecString(hd.config));
      return;
    }
    if (!hd.decoder || hd.decoder.state !== "configured") {
      return;
    }
    if (kind === 3) {
      let data = payload;
      if (hd.config) {  // like scrcpy's client: SPS/PPS travel with the key frame
        data = new Uint8Array(hd.config.length + payload.length);
        data.set(hd.config, 0);
        data.set(payload, hd.config.length);
      }
      hd.needKey = false;
      hd.decoder.decode(new EncodedVideoChunk({ type: "key", timestamp: pts, data }));
    } else if (kind === 4 && !hd.needKey) {
      if (hd.decoder.decodeQueueSize > 30) {
        hd.needKey = true;  // falling behind: skip to the next key frame
        return;
      }
      hd.decoder.decode(new EncodedVideoChunk({ type: "delta", timestamp: pts, data: payload }));
    }
  }

  async function hdLoop(generation) {
    const response = await fetch(`/api/hd/stream?${q({ serial: hd.serial })}`, {
      headers: { "X-Tether-Token": state.token },
    });
    if (!response.ok || !response.body) {
      throw new Error(`stream failed (${response.status})`);
    }
    const reader = response.body.getReader();
    let buffer = new Uint8Array(0);
    while (generation === hd.gen) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer, 0);
      merged.set(value, buffer.length);
      buffer = merged;
      let offset = 0;
      while (buffer.length - offset >= 13) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 13);
        const kind = view.getUint8(0);
        const pts = Number(view.getBigUint64(1));
        const size = view.getUint32(9);
        if (buffer.length - offset - 13 < size) {
          break;
        }
        hdMessage(kind, pts, buffer.subarray(offset + 13, offset + 13 + size));
        offset += 13 + size;
      }
      buffer = buffer.slice(offset);
    }
    reader.cancel().catch(() => {});
  }

  async function startHd() {
    if (!state.serial) {
      toast("Pick a device first", true);
      return;
    }
    if (typeof VideoDecoder === "undefined") {
      toast("HD needs WebCodecs (Chrome, Edge or Firefox 130+). Staying on screenshots.", true);
      return;
    }
    el.hdBtn.disabled = true;
    setStatus("Starting HD…");
    try {
      const status = await api(`/api/hd/status?${q({ serial: state.serial })}`);
      if (!status.hd.installed) {
        toast("Downloading scrcpy-server (734 KB, one time)…");
        await api("/api/setup/scrcpy", { method: "POST", body: {} });
      }
      await api("/api/hd/start", { method: "POST", body: { serial: state.serial, max_size: 1280, max_fps: 30 } });
      hd.active = true;
      hd.serial = state.serial;
      hd.gen += 1;
      hd.config = null;
      state.streamGen += 1;  // stop the screenshot loop
      state.frameTimes = [];
      el.hdBtn.classList.add("active");
      el.hdBtn.textContent = "HD ✓";
      setStatus("Live · HD", "ok");
      const generation = hd.gen;
      hdLoop(generation)
        .catch((error) => console.warn("HD stream", error))
        .finally(() => {
          if (generation === hd.gen && hd.active) {
            toast("HD stream ended — back to screenshots", true);
            stopHd(true);
          }
        });
    } catch (error) {
      toast(`HD unavailable: ${error.message}`, true);
      setStatus("Live", "ok");
    } finally {
      el.hdBtn.disabled = false;
    }
  }

  function stopHd(notifyServer = true) {
    const serial = hd.serial;
    if (typeof rec !== "undefined" && rec.mode === "browser" && rec.recorder) {
      rec.recorder.stop();
    }
    hd.active = false;
    hd.gen += 1;
    if (hd.decoder && hd.decoder.state !== "closed") {
      hd.decoder.close();
    }
    hd.decoder = null;
    el.hdScreen.hidden = true;
    el.hdBtn.classList.remove("active");
    el.hdBtn.textContent = "HD";
    if (notifyServer && serial) {
      api("/api/hd/stop", { method: "POST", body: { serial } }).catch(() => {});
    }
    if (state.serial) {
      state.streamGen += 1;
      streamLoop(state.streamGen);
    }
  }

  el.hdBtn.addEventListener("click", () => (hd.active ? stopHd(true) : startHd()));

  // ------------------------------------------------------------------ input
  async function send(step) {
    if (!state.serial) {
      toast("Pick a device first", true);
      return;
    }
    if (state.recording) {
      addStep({ ...step });
    }
    try {
      await api("/api/input", { method: "POST", body: { serial: state.serial, ...step } });
    } catch (error) {
      toast(error.message, true);
    }
  }

  let gesture = null;
  el.phone.addEventListener("pointerdown", (event) => {
    if (!state.serial || event.button !== 0) {
      return;
    }
    el.phone.focus();
    el.phone.setPointerCapture(event.pointerId);
    gesture = { start: normalise(event), x: event.clientX, y: event.clientY, t: performance.now() };
  });

  el.phone.addEventListener("pointerup", (event) => {
    if (!gesture) {
      return;
    }
    const moved = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
    const held = performance.now() - gesture.t;
    const end = normalise(event);
    const start = gesture.start;
    gesture = null;
    ripple(event);
    if (moved < 8) {
      if (held >= 500) {
        send({ action: "long_press", x: start.x, y: start.y, duration_ms: Math.min(Math.round(held), 3000) });
      } else {
        send({ action: "tap", x: start.x, y: start.y });
      }
    } else {
      send({
        action: "swipe",
        x: start.x,
        y: start.y,
        x2: end.x,
        y2: end.y,
        duration_ms: Math.min(Math.max(Math.round(held), 80), 3000),
      });
    }
  });

  el.phone.addEventListener("pointercancel", () => {
    gesture = null;
  });

  let wheelTotal = 0;
  el.phone.addEventListener("wheel", (event) => {
    event.preventDefault();
    wheelTotal += event.deltaY;
    clearTimeout(el.phone.wheelTimer);
    el.phone.wheelTimer = setTimeout(() => {
      const distance = Math.min(0.6, Math.max(0.15, Math.abs(wheelTotal) / 1500));
      const down = wheelTotal > 0;
      wheelTotal = 0;
      const from = down ? 0.5 + distance / 2 : 0.5 - distance / 2;
      const to = down ? 0.5 - distance / 2 : 0.5 + distance / 2;
      send({ action: "swipe", x: 0.5, y: round4(from), x2: 0.5, y2: round4(to), duration_ms: 250 });
    }, 180);
  }, { passive: false });

  const KEY_MAP = {
    Enter: "enter",
    Backspace: "delete",
    Delete: "forward_delete",
    Escape: "back",
    Tab: "tab",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Home: "home",
  };
  let typed = "";
  el.phone.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      typed += event.key;
      clearTimeout(el.phone.typeTimer);
      el.phone.typeTimer = setTimeout(flushTyped, 300);
    } else if (KEY_MAP[event.key]) {
      event.preventDefault();
      flushTyped();
      send({ action: "key", key: KEY_MAP[event.key] });
    }
  });

  function flushTyped() {
    clearTimeout(el.phone.typeTimer);
    if (typed) {
      const text = typed;
      typed = "";
      send({ action: "text", text });
    }
  }

  $$("[data-key]").forEach((button) => {
    button.addEventListener("click", () => send({ action: "key", key: button.dataset.key }));
  });

  $("#typeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#typeInput");
    if (input.value) {
      send({ action: "text", text: input.value });
      input.value = "";
    }
  });

  $("#shotBtn").addEventListener("click", async () => {
    if (!state.serial) {
      return;
    }
    try {
      const response = await fetch(`/api/screenshot?${q({ serial: state.serial })}`, {
        headers: { "X-Tether-Token": state.token },
      });
      if (!response.ok) {
        throw new Error((await response.json()).error);
      }
      const name = (response.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/);
      download(await response.blob(), name ? name[1] : "tether.png");
    } catch (error) {
      toast(error.message, true);
    }
  });

  function download(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }

  // ---------------------------------------------------------- screen video
  // HD on: record the decoded canvas in the browser (WebM, what you see).
  // HD off: the phone records itself with adb screenrecord (MP4, max 180 s).
  const rec = { mode: "", recorder: null, chunks: [], serial: "", started: 0, timer: 0 };
  window.__tetherRec = rec;  // read by the automated browser test
  const videoBtn = $("#videoBtn");

  function recTick() {
    const seconds = Math.floor((Date.now() - rec.started) / 1000);
    videoBtn.textContent = `⏹ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    if (rec.mode === "adb" && seconds >= 180) {
      stopVideo();
    }
  }

  function recStarted(mode) {
    rec.mode = mode;
    rec.started = Date.now();
    videoBtn.classList.add("active");
    rec.timer = setInterval(recTick, 500);
    recTick();
  }

  function recReset() {
    clearInterval(rec.timer);
    rec.mode = "";
    rec.recorder = null;
    videoBtn.classList.remove("active");
    videoBtn.textContent = "⏺";
    videoBtn.disabled = false;
  }

  async function startVideo() {
    if (!state.serial) {
      toast("Pick a device first", true);
      return;
    }
    rec.serial = state.serial;
    if (hd.active && el.hdScreen.captureStream && window.MediaRecorder) {
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
        .find((t) => MediaRecorder.isTypeSupported(t));
      rec.chunks = [];
      rec.recorder = new MediaRecorder(el.hdScreen.captureStream(30), type ? { mimeType: type } : {});
      rec.recorder.ondataavailable = (event) => event.data.size && rec.chunks.push(event.data);
      rec.recorder.onstop = () => {
        const blob = new Blob(rec.chunks, { type: "video/webm" });
        rec.lastSize = blob.size;
        download(blob, `tether-${rec.serial}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`);
        toast(`Saved ${(blob.size / 1048576).toFixed(1)} MB WebM`);
        recReset();
      };
      rec.recorder.start(1000);
      recStarted("browser");
      return;
    }
    videoBtn.disabled = true;
    try {
      await api("/api/record/start", { method: "POST", body: { serial: rec.serial, time_limit: 180 } });
      recStarted("adb");
      toast("Recording on the phone (max 3 min) — click ⏹ to stop");
    } catch (error) {
      toast(error.message, true);
      recReset();
    } finally {
      videoBtn.disabled = false;
    }
  }

  async function stopVideo() {
    if (rec.mode === "browser") {
      rec.recorder.stop();
      return;
    }
    if (rec.mode !== "adb") {
      return;
    }
    clearInterval(rec.timer);
    videoBtn.disabled = true;
    videoBtn.textContent = "…";
    try {
      const result = await api("/api/record/stop", { method: "POST", body: { serial: rec.serial } });
      const response = await fetch(result.url, { headers: { "X-Tether-Token": state.token } });
      if (!response.ok) {
        throw new Error("could not download the recording");
      }
      const blob = await response.blob();
      rec.lastSize = blob.size;
      download(blob, result.name);
      toast(`Saved ${result.name} (${(result.size / 1048576).toFixed(1)} MB, ${result.duration} s)`);
    } catch (error) {
      toast(error.message, true);
    } finally {
      recReset();
    }
  }

  videoBtn.addEventListener("click", () => (rec.mode ? stopVideo() : startVideo()));

  // ------------------------------------------------------------------- tabs
  $$(".tabs button").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tabs button").forEach((t) => t.classList.toggle("active", t === tab));
      $$(".tab-body").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      });
      if (tab.dataset.tab === "apps" && !$("#appList").children.length) {
        loadApps();
      }
      if (tab.dataset.tab === "push") {
        loadNotifications();
      }
    });
  });

  // ------------------------------------------------------------------- flow
  function loadFlow() {
    try {
      const saved = JSON.parse(localStorage.getItem(FLOW_KEY));
      if (saved && Array.isArray(saved.steps)) {
        return saved;
      }
    } catch (error) {
      /* ignore corrupt storage */
    }
    return { name: "New flow", steps: [] };
  }

  function saveFlow() {
    state.flow.name = $("#flowName").value || "flow";
    localStorage.setItem(FLOW_KEY, JSON.stringify(state.flow));
  }

  function addStep(step) {
    state.flow.steps.push(step);
    saveFlow();
    renderSteps();
  }

  function describe(step) {
    switch (step.action) {
      case "tap":
        return `at ${(step.x * 100).toFixed(1)}%, ${(step.y * 100).toFixed(1)}%`;
      case "long_press":
        return "x" in step
          ? `at ${(step.x * 100).toFixed(1)}%, ${(step.y * 100).toFixed(1)}%`
          : ["text", "resource_id", "desc"].filter((k) => step[k]).map((k) => `${k}=${JSON.stringify(step[k])}`).join(" ");
      case "open_url":
        return step.url;
      case "swipe":
        return `${(step.x * 100).toFixed(0)},${(step.y * 100).toFixed(0)} → ${(step.x2 * 100).toFixed(0)},${(step.y2 * 100).toFixed(0)} (${step.duration_ms || 300} ms)`;
      case "text":
        return JSON.stringify(step.text);
      case "key":
        return step.times > 1 ? `${step.key} ×${step.times}` : step.key;
      case "wait":
        return `${step.ms} ms`;
      case "launch":
      case "stop":
      case "clear_data":
        return step.package;
      case "screenshot":
        return step.name || "";
      case "push":
        return `“${step.title}” → ${step.target ? JSON.stringify(step.target) : "everyone"}`;
      case "close_notifications":
        return "";
      case "beacon_subscribe":
        return (step.tags || ["qa:device"]).join(", ");
      default:
        return ["text", "resource_id", "desc"]
          .filter((k) => step[k])
          .map((k) => `${k}=${JSON.stringify(step[k])}`)
          .join(" ");
    }
  }

  function renderSteps(results) {
    const list = el.stepList;
    list.innerHTML = "";
    state.flow.steps.forEach((step, index) => {
      const item = document.createElement("li");
      const result = results && results[index];
      if (result) {
        item.className = result.optional_failed ? "warn" : result.ok ? "pass" : result.ok === false ? "fail" : "";
        item.title = result.error || (result.skipped ? "skipped" : `${result.ms} ms`);
      }
      const act = document.createElement("span");
      act.className = "act";
      act.textContent = step.action;
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = describe(step) + (step.optional ? "  (optional)" : "");
      const remove = document.createElement("button");
      remove.textContent = "✕";
      remove.title = "Remove step";
      remove.addEventListener("click", () => {
        state.flow.steps.splice(index, 1);
        saveFlow();
        renderSteps();
      });
      item.append(act, detail, remove);
      list.append(item);
    });
    el.stepsEmpty.hidden = state.flow.steps.length > 0;
  }

  $("#flowName").value = state.flow.name || "New flow";
  $("#flowName").addEventListener("change", saveFlow);

  $("#recordBtn").addEventListener("click", () => {
    state.recording = !state.recording;
    $("#recordBtn").classList.toggle("on", state.recording);
    $("#recordBtn").textContent = state.recording ? "■ Stop" : "● Record";
    el.recBadge.hidden = !state.recording;
  });

  $("#addWait").addEventListener("click", () => addStep({ action: "wait", ms: 1000 }));
  $("#addShot").addEventListener("click", () => {
    addStep({ action: "screenshot", name: `shot-${state.flow.steps.length + 1}` });
  });
  $("#clearFlow").addEventListener("click", () => {
    if (state.flow.steps.length && confirm("Remove all steps?")) {
      state.flow.steps = [];
      saveFlow();
      renderSteps();
      el.report.hidden = true;
    }
  });

  $("#exportFlow").addEventListener("click", () => {
    saveFlow();
    const slug = (state.flow.name || "flow").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    download(new Blob([JSON.stringify(state.flow, null, 2)], { type: "application/json" }), `${slug}.tether.json`);
  });

  $("#exportMaestro").addEventListener("click", async () => {
    saveFlow();
    try {
      const result = await api("/api/flow/maestro/export", { method: "POST", body: { flow: state.flow } });
      const slug = (state.flow.name || "flow").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      download(new Blob([result.yaml], { type: "text/yaml" }), `${slug}.maestro.yaml`);
      if (result.warnings.length) {
        toast(`Exported with ${result.warnings.length} note(s): ${result.warnings.join(" · ")}`, true);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#importFlow").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      let flow;
      let warnings = [];
      if (/\.ya?ml$/i.test(file.name)) {
        const result = await api("/api/flow/maestro/import", { method: "POST", body: { yaml: text } });
        flow = result.flow;
        warnings = result.warnings;
      } else {
        flow = JSON.parse(text);
      }
      if (!Array.isArray(flow.steps)) {
        throw new Error("not a Tether flow (missing steps)");
      }
      state.flow = flow;
      $("#flowName").value = flow.name || file.name;
      saveFlow();
      renderSteps();
      toast(warnings.length
        ? `Loaded ${flow.steps.length} steps · ${warnings.length} warning(s): ${warnings.join(" · ")}`
        : `Loaded ${flow.steps.length} steps`, warnings.length > 0);
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#editJson").addEventListener("click", () => {
    saveFlow();
    $("#jsonText").value = JSON.stringify(state.flow, null, 2);
    $("#jsonEditor").hidden = false;
  });
  $("#cancelJson").addEventListener("click", () => {
    $("#jsonEditor").hidden = true;
  });
  $("#applyJson").addEventListener("click", () => {
    try {
      const flow = JSON.parse($("#jsonText").value);
      if (!Array.isArray(flow.steps)) {
        throw new Error("a flow needs a steps array");
      }
      state.flow = flow;
      $("#flowName").value = flow.name || "flow";
      saveFlow();
      renderSteps();
      $("#jsonEditor").hidden = true;
    } catch (error) {
      toast(`Invalid JSON: ${error.message}`, true);
    }
  });

  $("#runBtn").addEventListener("click", async () => {
    if (!state.serial || !state.flow.steps.length) {
      toast(state.serial ? "Record some steps first" : "Pick a device first", true);
      return;
    }
    if (state.recording) {
      $("#recordBtn").click();
    }
    saveFlow();
    const button = $("#runBtn");
    button.disabled = true;
    button.textContent = "Running…";
    $$("li", el.stepList).forEach((li) => li.classList.add("running"));
    try {
      const { report } = await api("/api/flow/run", {
        method: "POST",
        body: { serial: state.serial, flow: state.flow },
      });
      renderSteps(report.steps);
      renderReport(report);
    } catch (error) {
      renderSteps();
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "▶ Run";
    }
  });

  function renderReport(report) {
    const failed = report.steps.find((s) => s.ok === false);
    const shots = report.screenshots
      .map((s) => `<img alt="${escapeHtml(s.name)}" title="${escapeHtml(s.name)}" src="data:image/png;base64,${s.png_base64}">`)
      .join("");
    el.report.innerHTML = `
      <h3 class="${report.passed ? "pass" : "fail"}">${report.passed ? "✔ Passed" : "✘ Failed"} · ${(report.ms / 1000).toFixed(1)} s</h3>
      ${failed ? `<p class="fail">Step ${failed.index + 1} (${escapeHtml(failed.action)}): ${escapeHtml(failed.error)}</p>` : ""}
      ${shots ? `<div class="shots">${shots}</div>` : ""}`;
    el.report.hidden = false;
  }

  // ---------------------------------------------------------------- inspect
  $("#dumpUi").addEventListener("click", dumpUi);
  $("#uiFilter").addEventListener("input", renderElements);
  $("#showBoxes").addEventListener("change", drawOverlay);

  async function dumpUi() {
    if (!state.serial) {
      return;
    }
    const button = $("#dumpUi");
    button.disabled = true;
    button.textContent = "Reading…";
    try {
      const data = await api(`/api/ui?${q({ serial: state.serial })}`);
      state.elements = data.elements;
      state.uiSize = data.size;
      renderElements();
      drawOverlay();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Read screen elements";
    }
  }

  function selectorFor(element) {
    if (element.resource_id && !element.text) {
      return { resource_id: element.resource_id };
    }
    if (element.text) {
      return { text: element.text };
    }
    if (element.desc) {
      return { desc: element.desc };
    }
    return null;
  }

  function interestingElements() {
    const filter = $("#uiFilter").value.trim().toLowerCase();
    return state.elements.filter((e) => {
      if (!(e.text || e.desc || e.clickable || e.resource_id)) {
        return false;
      }
      if (!filter) {
        return true;
      }
      return [e.text, e.desc, e.resource_id, e.class].some((v) => v.toLowerCase().includes(filter));
    });
  }

  function renderElements() {
    const list = $("#uiList");
    list.innerHTML = "";
    const elements = interestingElements();
    $("#uiMeta").textContent = state.elements.length
      ? `${elements.length} of ${state.elements.length} elements · hover to highlight`
      : "";
    for (const element of elements) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = element.text || element.desc || element.resource_id.split("/").pop() || element.class.split(".").pop();
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = [element.class.split(".").pop(), element.resource_id.split("/").pop(), element.clickable ? "clickable" : ""]
        .filter(Boolean)
        .join(" · ");
      const tap = document.createElement("button");
      tap.textContent = "Tap";
      tap.addEventListener("click", () => tapElement(element));
      item.append(label, detail, tap);
      const selector = selectorFor(element);
      if (selector) {
        const addTap = document.createElement("button");
        addTap.textContent = "+step";
        addTap.title = "Add a tap_element step (robust to layout changes)";
        addTap.addEventListener("click", () => {
          addStep({ action: "tap_element", ...selector });
          toast("Added tap_element step");
        });
        const addAssert = document.createElement("button");
        addAssert.textContent = "+assert";
        addAssert.title = "Add an assert_text step (fails the flow if missing)";
        addAssert.addEventListener("click", () => {
          addStep({ action: "assert_text", ...selector, timeout_ms: 8000 });
          toast("Added assertion");
        });
        item.append(addTap, addAssert);
      }
      item.addEventListener("mouseenter", () => {
        state.highlight = element;
        item.classList.add("hl");
        drawOverlay();
      });
      item.addEventListener("mouseleave", () => {
        state.highlight = null;
        item.classList.remove("hl");
        drawOverlay();
      });
      list.append(item);
    }
  }

  async function tapElement(element) {
    const selector = selectorFor(element);
    if (state.recording && selector) {
      addStep({ action: "tap_element", ...selector });
    }
    try {
      if (selector) {
        await api("/api/tap_element", { method: "POST", body: { serial: state.serial, ...selector } });
      } else {
        const [w, h] = state.uiSize;
        await api("/api/input", {
          method: "POST",
          body: { serial: state.serial, action: "tap", x: element.center[0] / (w - 1), y: element.center[1] / (h - 1) },
        });
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  function drawOverlay() {
    const canvas = el.overlay;
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.uiSize || !state.elements.length) {
      return;
    }
    const content = contentRect();
    const offsetX = (content.left - box.left) * ratio;
    const offsetY = (content.top - box.top) * ratio;
    const scale = (content.width * ratio) / state.uiSize[0];
    const rect = (e) => [
      offsetX + e.bounds[0] * scale,
      offsetY + e.bounds[1] * scale,
      (e.bounds[2] - e.bounds[0]) * scale,
      (e.bounds[3] - e.bounds[1]) * scale,
    ];
    if ($("#showBoxes").checked) {
      ctx.lineWidth = 1 * ratio;
      ctx.strokeStyle = "rgba(61, 220, 151, 0.45)";
      for (const element of interestingElements()) {
        ctx.strokeRect(...rect(element));
      }
    }
    if (state.highlight) {
      ctx.lineWidth = 3 * ratio;
      ctx.strokeStyle = "#2a9df4";
      ctx.fillStyle = "rgba(42, 157, 244, 0.18)";
      ctx.fillRect(...rect(state.highlight));
      ctx.strokeRect(...rect(state.highlight));
    }
  }
  window.addEventListener("resize", drawOverlay);

  // ------------------------------------------------------------------- apps
  $("#loadApps").addEventListener("click", loadApps);
  $("#appFilter").addEventListener("input", renderApps);
  let packages = [];
  let foreground = "";

  async function loadApps() {
    if (!state.serial) {
      return;
    }
    try {
      const data = await api(`/api/packages?${q({ serial: state.serial })}`);
      packages = data.packages;
      foreground = data.foreground || "";
      $("#foreground").textContent = foreground ? `Foreground: ${foreground}` : "";
      renderApps();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderApps() {
    const filter = $("#appFilter").value.trim().toLowerCase();
    const list = $("#appList");
    list.innerHTML = "";
    for (const name of packages.filter((p) => p.toLowerCase().includes(filter))) {
      const item = document.createElement("li");
      if (foreground.startsWith(name + "/")) {
        item.classList.add("fg");
      }
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = name;
      item.append(label);
      for (const [text, endpoint, action] of [["Launch", "/api/launch", "launch"], ["Stop", "/api/stop", "stop"], ["Clear", "/api/clear", "clear_data"]]) {
        const button = document.createElement("button");
        button.textContent = text;
        button.addEventListener("click", async () => {
          if (action === "clear_data" && !confirm(`Wipe all data for ${name}?`)) {
            return;
          }
          if (state.recording) {
            addStep({ action, package: name });
          }
          try {
            await api(endpoint, { method: "POST", body: { serial: state.serial, package: name } });
            toast(`${text}: ${name}`);
            setTimeout(loadApps, 800);
          } catch (error) {
            toast(error.message, true);
          }
        });
        item.append(button);
      }
      list.append(item);
    }
  }

  async function installApk(file) {
    if (!state.serial) {
      toast("Pick a device first", true);
      return;
    }
    toast(`Installing ${file.name}…`);
    try {
      const data = await api(`/api/install?${q({ serial: state.serial })}`, { method: "POST", raw: file });
      toast(data.output.split("\n").pop() || "Installed");
      loadApps();
    } catch (error) {
      toast(`Install failed: ${error.message}`, true);
    }
  }

  $("#apkInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) {
      installApk(file);
    }
  });

  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) {
      dragDepth += 1;
      $("#dropZone").hidden = false;
    }
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      $("#dropZone").hidden = true;
    }
  });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    $("#dropZone").hidden = true;
    const file = Array.from(event.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith(".apk"));
    if (file) {
      installApk(file);
    } else {
      toast("Drop an .apk file to install it", true);
    }
  });

  // ------------------------------------------------------------------- logs
  $("#loadLogs").addEventListener("click", loadLogs);
  $("#logGrep").addEventListener("input", renderLog);
  let logText = "";
  let logTimer = null;

  async function loadLogs() {
    if (!state.serial) {
      return;
    }
    const params = { serial: state.serial, lines: $("#logLines").value };
    const pkg = $("#logPackage").value.trim();
    if (pkg) {
      params.package = pkg;
    }
    try {
      const data = await api(`/api/logcat?${q(params)}`);
      logText = data.log;
      renderLog();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderLog() {
    const out = $("#logOut");
    const needle = $("#logGrep").value.trim().toLowerCase();
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 20;
    out.innerHTML = logText
      .split("\n")
      .map((line) => {
        const safe = escapeHtml(line);
        return needle && line.toLowerCase().includes(needle) ? `<mark>${safe}</mark>` : safe;
      })
      .join("\n");
    if (stick) {
      out.scrollTop = out.scrollHeight;
    }
  }

  $("#logAuto").addEventListener("change", (event) => {
    clearInterval(logTimer);
    if (event.target.checked) {
      loadLogs();
      logTimer = setInterval(loadLogs, 3000);
    }
  });


  // ------------------------------------------------------------- push (Beacon)
  const pushForm = $("#pushForm");

  function pushFields(fillRun) {
    const tags = pushForm.target.value.split(",").map((s) => s.trim()).filter(Boolean);
    const runId = Math.random().toString(16).slice(2, 8);
    const fill = (value) => (fillRun ? value.replaceAll("{run}", runId) : value);
    const fields = { title: fill(pushForm.title.value), body: fill(pushForm.body.value) };
    if (pushForm.url.value.trim()) {
      fields.url = pushForm.url.value.trim();
    }
    if (tags.length) {
      fields.target = { tags };
    }
    return fields;
  }

  pushForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = pushFields(true);
    $("#pushResult").textContent = "Sending through Beacon…";
    try {
      const { message } = await api("/api/push", { method: "POST", body: fields });
      $("#pushResult").textContent =
        `Beacon #${message.id}: delivered ${message.delivered}/${message.targeted}` +
        (message.failed ? `, failed ${message.failed}` : "") + ` — watching the device for “${fields.title}”…`;
      watchFor(fields.title);
    } catch (error) {
      $("#pushResult").textContent = error.message;
      toast(error.message, true);
    }
  });

  async function watchFor(title) {
    for (let i = 0; i < 20; i += 1) {
      const items = await loadNotifications();
      if (items && items.some((n) => n.title.includes(title))) {
        $("#pushResult").textContent += " ✔ arrived on the device";
        return;
      }
      await sleep(1000);
    }
    $("#pushResult").textContent += " ✘ not seen on the device within 20 s";
  }

  $("#pushStep").addEventListener("click", () => {
    addStep({ action: "push", ...pushFields(false) });
    toast("Added push step");
  });

  $("#pushQaFlow").addEventListener("click", () => {
    const fields = pushFields(false);
    addStep({ action: "push", ...fields });
    addStep({ action: "wait_notification", title: fields.title, timeout_ms: 20000 });
    addStep({ action: "tap_notification", title: fields.title });
    addStep({ action: "screenshot", name: "after-tap" });
    toast("Added push → wait → tap → screenshot");
  });

  async function loadNotifications() {
    if (!state.serial) {
      return null;
    }
    try {
      const { notifications } = await api(`/api/notifications?${q({ serial: state.serial })}`);
      renderNotifications(notifications);
      return notifications;
    } catch (error) {
      toast(error.message, true);
      return null;
    }
  }

  function renderNotifications(items) {
    const list = $("#notifList");
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = '<li class="muted">No notifications on the device.</li>';
      return;
    }
    for (const item of items) {
      const row = document.createElement("li");
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.title || "(no title)";
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = `${item.text} · ${item.package}`;
      const tap = document.createElement("button");
      tap.textContent = "Tap";
      tap.addEventListener("click", async () => {
        if (state.recording) {
          addStep({ action: "tap_notification", title: item.title });
        }
        try {
          await api("/api/notifications/tap", { method: "POST", body: { serial: state.serial, title: item.title } });
        } catch (error) {
          toast(error.message, true);
        }
      });
      const wait = document.createElement("button");
      wait.textContent = "+wait";
      wait.title = "Add a wait_notification step";
      wait.addEventListener("click", () => addStep({ action: "wait_notification", title: item.title, package: item.package }));
      row.append(label, detail, tap, wait);
      list.append(row);
    }
  }

  $("#loadNotifs").addEventListener("click", loadNotifications);
  $("#closeShade").addEventListener("click", () =>
    api("/api/notifications/close", { method: "POST", body: { serial: state.serial } }).catch((e) => toast(e.message, true))
  );


  // ---------------------------------------------------------- setup + Wi-Fi
  async function installAdb() {
    const button = $("#installAdb");
    button.disabled = true;
    button.textContent = "Downloading…";
    try {
      const data = await api("/api/setup/adb", { method: "POST", body: {} });
      toast(`adb ready (${data.version || "installed"})`);
      showBanner("");
      boot();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry install";
      toast(`Install failed: ${error.message}`, true);
    }
  }

  $("#wifiBtn").addEventListener("click", () => {
    $("#wifiForm").reset();
    $("#wifiDialog").showModal();
  });

  $("#wifiDialog").addEventListener("close", async () => {
    if ($("#wifiDialog").returnValue !== "go") {
      return;
    }
    const form = $("#wifiForm");
    try {
      if (form.pairAddr.value.trim()) {
        await api("/api/pair", { method: "POST", body: { host_port: form.pairAddr.value.trim(), code: form.code.value.trim() } });
        toast("Paired");
      }
      if (form.connectAddr.value.trim()) {
        const data = await api("/api/connect", { method: "POST", body: { host_port: form.connectAddr.value.trim() } });
        toast(data.output);
      }
      refreshDevices();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("#subscribeDevice").addEventListener("click", async () => {
    if (!state.serial) {
      toast("Pick a device first", true);
      return;
    }
    const button = $("#subscribeDevice");
    const tags = pushForm.target.value.split(",").map((s) => s.trim()).filter(Boolean);
    button.disabled = true;
    $("#subscribeState").textContent = "Opening Beacon on the phone…";
    try {
      const { result } = await api("/api/beacon/subscribe-device", {
        method: "POST",
        body: { serial: state.serial, tags: tags.length ? tags : ["qa:device"] },
      });
      $("#subscribeState").textContent = `✔ ${result.app}: subscribed with ${result.tags.join(", ")}` +
        (result.subscribers.webpush !== undefined ? ` (${result.subscribers.webpush} web subscriber(s))` : "");
      if (state.recording) {
        addStep({ action: "beacon_subscribe", tags: result.tags });
      }
    } catch (error) {
      $("#subscribeState").textContent = `✘ ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  // ------------------------------------------------------------------- misc
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  el.deviceSelect.addEventListener("change", () => selectDevice(el.deviceSelect.value));
  $("#refreshDevices").addEventListener("click", refreshDevices);

  async function boot() {
    try {
      const health = await api("/api/health");
      if (!health.adb) {
        showBanner(
          "Tether needs <b>adb</b> (Google's Android Platform-Tools) to talk to phones. " +
          '<button id="installAdb" class="primary">Install it for me (~7 MB)</button> ' +
          '<span class="small">Downloads from dl.google.com into Tether\'s own <code>tools</code> folder; ' +
          'by installing you accept the <a href="https://developer.android.com/studio/releases/platform-tools" target="_blank" rel="noopener">Platform-Tools terms</a>.</span>'
        );
        $("#installAdb").addEventListener("click", installAdb);
        setStatus("adb missing", "err");
        return;
      }
      $("#beaconState").innerHTML = health.beacon
        ? `Linked to Beacon at <b>${escapeHtml(health.beacon)}</b>. Subscribe the phone to your app first (e.g. tag <code>qa:device</code>).`
        : "Beacon is not linked. Start Tether with <code>--beacon-url</code> and <code>--beacon-key sk_…</code> to send test pushes.";
      await refreshDevices();
      clearInterval(boot.timer);
      boot.timer = setInterval(refreshDevices, 5000);
    } catch (error) {
      setStatus(error.message, "err");
    }
  }

  readToken();
  renderSteps();
  if (!state.token) {
    askToken();
  } else {
    boot();
  }
})();
