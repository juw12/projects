// Glow Offline: AI that runs on this device, so GlowChat keeps answering with no internet.
// The model is downloaded once (from Hugging Face, or ModelScope where that is blocked), kept in this
// browser's storage, and run with WebGPU by WebLLM in a worker (glow-offline-worker.js). Nothing you type
// leaves the device. Small on-device models are less capable than cloud AI: good for writing, rewriting,
// translating and quick questions; they don't browse and can be wrong.
//
// window.GlowOfflineAI = { models, support(), downloaded(), isDownloaded(key), download(key, onProgress),
//   verify(), remove(key), prepare(key), chat({ key, messages, onText, signal }), sizeLabel(bytes), modelByKey(key) }
(function () {
  "use strict";

  const SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;
  const SHARED = new URL("./", SCRIPT_URL).href;
  const STORE_KEY = "glow.offline.v1";

  // bytes: weights + tokenizer + compiled GPU library, rounded up (shown before downloading).
  const MODELS = [
    {
      key: "mini",
      name: "Glow Offline Mini",
      family: "Qwen2.5-0.5B-Instruct",
      bytes: 300e6,
      about: "Small and quick. Best for phones: short answers, rewriting and translating.",
    },
    {
      key: "standard",
      name: "Glow Offline",
      family: "Qwen2.5-1.5B-Instruct",
      bytes: 890e6,
      about: "Better answers. Best for laptops and newer phones.",
    },
    {
      key: "plus",
      name: "Glow Offline Plus",
      family: "Qwen2.5-3B-Instruct",
      bytes: 1760e6,
      about: "The best offline answers. For PCs with a graphics card.",
    },
  ];

  // Where the model files come from. Both serve the same MLC builds with CORS. Tests can add sources.
  const SOURCES = Object.assign({
    hf: (id) => `https://huggingface.co/mlc-ai/${id}/resolve/main/`,
    ms: (id) => `https://www.modelscope.cn/models/mlc-ai/${id}/resolve/master/`,
  }, window.GLOW_OFFLINE_SOURCES || {});

  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const isPhone = isApple || /Android/.test(navigator.userAgent);

  let host = null;
  let hostReady = null;
  let nextId = 1;
  const pending = new Map();
  let loadedSpec = "";
  let queue = Promise.resolve();
  let supportCache = null;
  // How browsers report a model file that couldn't be fetched or stored (blocked host, missing file, offline).
  const NETWORK_ERROR = /Failed to fetch|NetworkError|network error|Load failed|Cache\.add|on 'Cache'|Request failed|ERR_/i;

  // ---------------------------------------------------------------- storage of what is downloaded
  function readStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && saved.models) return saved;
    } catch (error) {
      // Unreadable: start empty.
    }
    return { models: {} };
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (error) {
      // Storage full or blocked: the model still works for this visit.
    }
    window.dispatchEvent(new CustomEvent("glow-offline-change"));
  }

  function modelByKey(key) {
    return MODELS.find((model) => model.key === key) || null;
  }

  function downloaded() {
    const store = readStore();
    return MODELS.filter((model) => store.models[model.key]).map((model) => ({ ...model, ...store.models[model.key] }));
  }

  function isDownloaded(key) {
    return Boolean(readStore().models[key]);
  }

  function sizeLabel(bytes) {
    return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
  }

  // ---------------------------------------------------------------- the engine host (worker or page)
  function onHostMessage(message) {
    const job = pending.get(message.id);
    if (!job) return;
    if (message.type === "progress") {
      if (job.onProgress) job.onProgress(message);
    } else if (message.type === "delta") {
      if (job.onDelta) job.onDelta(message.text);
    } else {
      pending.delete(message.id);
      if (message.type === "result") {
        job.resolve(message.result);
      } else {
        const error = new Error(message.message);
        error.name = message.name || "Error";
        job.reject(error);
      }
    }
  }

  function call(op, fields = {}, callbacks = {}) {
    return hostReady.then(() => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, ...callbacks });
      host.post({ id, op, ...fields });
    }));
  }

  // A worker that dies (for example when the phone runs out of memory) fails its open requests,
  // and the next request starts a fresh one.
  function hostCrashed(reason) {
    const error = new Error(reason || "Glow Offline stopped. The device may have run out of memory; try again or use Glow Offline Mini.");
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    host = null;
    hostReady = null;
    loadedSpec = "";
  }

  function startWorkerHost() {
    return new Promise((resolve, reject) => {
      let worker;
      let started = false;
      try {
        worker = new Worker(`${SHARED}glow-offline-worker.js`, { type: "module" });
      } catch (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(() => reject(new Error("The Glow Offline worker didn't start.")), 20000);
      worker.addEventListener("error", (event) => {
        clearTimeout(timer);
        if (started) hostCrashed();
        else reject(new Error(event.message || "The Glow Offline worker failed to load."));
      });
      worker.addEventListener("message", (event) => onHostMessage(event.data));
      host = { post: (message) => worker.postMessage(message), worker };
      // Ask the worker whether it can see the GPU; some browsers only offer WebGPU on the page.
      const id = nextId++;
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          if (result && result.webgpu) {
            started = true;
            resolve(result);
          } else {
            worker.terminate();
            reject(new Error("No WebGPU in workers"));
          }
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      worker.postMessage({ id, op: "probe" });
    });
  }

  async function startPageHost() {
    const module = await import(`${SHARED}glow-offline-engine.js`);
    const pageHost = module.createHost((message) => setTimeout(() => onHostMessage(message), 0));
    host = { post: (message) => pageHost.handle(message) };
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      host.post({ id, op: "probe" });
    });
  }

  function ensureHost() {
    if (!hostReady) {
      hostReady = startWorkerHost()
        .catch(() => startPageHost())
        .catch((error) => {
          hostReady = null;
          throw error;
        });
    }
    return hostReady;
  }

  // ---------------------------------------------------------------- what this device can do
  async function support() {
    if (supportCache) return supportCache;
    const result = { ok: false, phone: isPhone, apple: isApple, f16: false, reason: "", recommended: "mini" };
    if (!window.isSecureContext || !navigator.gpu) {
      result.reason = isApple
        ? "This iPhone or iPad can't run AI on the device yet: it needs iOS 26 or newer (Safari with WebGPU)."
        : "This browser can't run AI on the device (no WebGPU). Use a recent Chrome or Edge on a PC, Mac or Android phone, or Safari on iOS 26 / macOS 26.";
      return result;
    }
    let adapter = null;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (error) {
      adapter = null;
    }
    if (!adapter) {
      result.reason = "Your device's graphics chip isn't available to the browser, so on-device AI can't run here.";
      return result;
    }
    result.ok = true;
    result.f16 = adapter.features.has("shader-f16");
    const memory = navigator.deviceMemory || 0; // GB, Chrome only
    result.recommended = isPhone || (memory && memory < 8) ? "mini" : "standard";
    supportCache = result;
    return result;
  }

  function specFor(key, source, f16) {
    const model = modelByKey(key);
    if (!model) throw new Error(`Unknown Glow Offline model: ${key}`);
    const modelId = `${model.family}-${f16 ? "q4f16_1" : "q4f32_1"}-MLC`;
    const base = (SOURCES[source] || SOURCES.hf)(modelId);
    // Phones get a smaller working memory (context) so the browser doesn't run out of memory.
    return { modelId, modelUrl: base, contextWindow: isPhone ? 2048 : 4096 };
  }

  function sourceOrder() {
    if (Array.isArray(window.GLOW_OFFLINE_SOURCE_ORDER)) return window.GLOW_OFFLINE_SOURCE_ORDER.slice();
    const region = window.GlowLocale && window.GlowLocale.get ? window.GlowLocale.get().region : "";
    return region === "CN" ? ["ms", "hf"] : ["hf", "ms"];
  }

  // A big file (tokenizer.json) is fetched until its first bytes arrive: that proves the host and its
  // download servers are reachable from this network, without downloading anything large.
  async function reachable(source, modelId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${SOURCES[source](modelId)}tokenizer.json`, { signal: controller.signal, cache: "no-store" });
      if (response.body && response.body.cancel) response.body.cancel().catch(() => {});
      return response.ok;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function friendly(error) {
    const text = String((error && error.message) || error || "");
    if (/out of memory|OOM|device (was )?lost|DXGI_ERROR|allocation|GPUOutOfMemory/i.test(text)) {
      return new Error("This device ran out of graphics memory for that model. Close other apps or tabs, or use Glow Offline Mini.");
    }
    if (/quota|QuotaExceeded|storage/i.test(text)) {
      return new Error("There isn't enough free storage for that model. Free up some space, or pick a smaller model.");
    }
    if (NETWORK_ERROR.test(text)) {
      return new Error("The model couldn't be downloaded on this network (huggingface.co and modelscope.cn are blocked or offline). Try another network such as home Wi-Fi or mobile data. Once it's downloaded, Glow Offline works with no internet.");
    }
    return error instanceof Error ? error : new Error(text);
  }

  // ---------------------------------------------------------------- download, start, delete
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function startModel(key, source, f16, onProgress) {
    await ensureHost();
    const spec = specFor(key, source, f16);
    const specKey = JSON.stringify(spec);
    if (loadedSpec === specKey) return spec;
    loadedSpec = "";
    await call("load", { spec }, { onProgress });
    loadedSpec = specKey;
    return spec;
  }

  function download(key, onProgress = () => {}) {
    return serial(async () => {
      const device = await support();
      if (!device.ok) throw new Error(device.reason);
      const tried = [];
      let lastError = null;
      for (const source of sourceOrder()) {
        const spec = specFor(key, source, device.f16);
        tried.push(source);
        if (!(await reachable(source, spec.modelId))) {
          lastError = new Error("Failed to fetch");
          continue;
        }
        try {
          await startModel(key, source, device.f16, (report) => onProgress({ ...report, source }));
          const store = readStore();
          store.models[key] = { source, f16: device.f16, modelId: spec.modelId, at: Date.now() };
          writeStore(store);
          return { key, source, modelId: spec.modelId };
        } catch (error) {
          lastError = error;
          if (!NETWORK_ERROR.test(String(error && error.message))) break;
        }
      }
      throw friendly(lastError || new Error(`Couldn't reach ${tried.join(", ")}`));
    });
  }

  // Drops models whose files the browser has since cleared (for example to free space).
  function verify() {
    return serial(async () => {
      const store = readStore();
      const keys = Object.keys(store.models);
      if (!keys.length) return downloaded();
      await ensureHost();
      let changed = false;
      for (const key of keys) {
        const entry = store.models[key];
        try {
          const result = await call("status", { spec: specFor(key, entry.source, entry.f16) });
          if (!result.cached) {
            delete store.models[key];
            changed = true;
          }
        } catch (error) {
          // Can't check right now: keep it.
        }
      }
      if (changed) writeStore(store);
      return downloaded();
    });
  }

  function remove(key) {
    return serial(async () => {
      const store = readStore();
      const entry = store.models[key];
      if (!entry) return;
      try {
        await ensureHost();
        await call("delete", { spec: specFor(key, entry.source, entry.f16) });
      } finally {
        if (loadedSpec.includes(JSON.stringify(entry.modelId))) loadedSpec = "";
        delete store.models[key];
        writeStore(store);
      }
    });
  }

  // ---------------------------------------------------------------- answering
  // Starts a downloaded model in the background (for example while someone types), so the first answer
  // doesn't wait for the model to load onto the graphics chip. Resolves to false if it can't start.
  function prepare(key) {
    const entry = readStore().models[key];
    if (!entry) return Promise.resolve(false);
    return serial(async () => {
      await startModel(key, entry.source, entry.f16, () => {});
      return true;
    }).catch(() => false);
  }

  function chat({ key, messages, onText = () => {}, onStatus = () => {}, signal, maxTokens }) {
    return serial(async () => {
      const entry = readStore().models[key];
      if (!entry) throw new Error("Download this offline model first: GlowChat → Settings → Offline AI on this device.");
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      onStatus("Starting the AI on this device…");
      try {
        await startModel(key, entry.source, entry.f16, () => onStatus("Starting the AI on this device…"));
      } catch (error) {
        throw friendly(error);
      }
      onStatus("");
      let full = "";
      const stop = () => call("abort").catch(() => {});
      if (signal) signal.addEventListener("abort", stop, { once: true });
      try {
        const result = await call("chat", {
          request: {
            messages,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.08,
            max_tokens: maxTokens || (isPhone ? 600 : 1200),
          },
        }, {
          onDelta: (text) => {
            full += text;
            onText(full);
          },
        });
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        return { text: full, usage: result && result.usage };
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        throw friendly(error);
      } finally {
        if (signal) signal.removeEventListener("abort", stop);
      }
    });
  }

  window.GlowOfflineAI = {
    models: MODELS.map((model) => ({ ...model })),
    support,
    downloaded,
    isDownloaded,
    download,
    verify,
    remove,
    prepare,
    chat,
    sizeLabel,
    modelByKey,
    get isPhone() {
      return isPhone;
    },
  };
})();
