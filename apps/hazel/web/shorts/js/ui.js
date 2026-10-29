/* Hazel Shorts studio UI — editor, preview, voice capture and export. */
(function () {
  "use strict";

  // Storage names predate the Hazel rename; keeping them means existing projects and voice clips still load.
  var STORAGE_KEY = "shortcraft.project.v1";
  var SC = window.SC;
  var SAMPLES = window.SC_SAMPLES || [];
  var TEMPLATES = ["editorial", "teardown", "pop", "clean"];
  var LAYOUT_TEMPLATES = ["pop", "clean"];
  var SCENE_TEXT_KEYS = ["headline", "sub", "label", "icon", "stat", "statLabel", "narration", "caption", "chip"];

  var canvas = document.getElementById("preview");
  var ctx = canvas.getContext("2d");
  var assets = SC.makeAssets();

  var state = {
    project: null,
    prevProject: null,   // previous project, kept in memory so "Undo" can bring it back
    voiceBuffers: {},     // scene index -> AudioBuffer
    timeline: null,
    t: 0,
    playing: false,
    exporting: false,
    playback: null,       // {startAt, offset, music, voices}
    spokenScene: -1,
    token: 0              // bumps on every project switch; stale async loads check it
  };

  var actx = null;

  function audio() {
    if (!actx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      actx = new Ctor();
    }
    if (actx.state === "suspended") {
      actx.resume();
    }
    return actx;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function newId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function blankProject() {
    return {
      title: "My explainer",
      kicker: "How it works",
      template: "editorial",
      lang: "en",
      music: "calm",
      voice: "own",
      captions: true,
      scenes: [
        { headline: "A surprising question?", icon: "🤔", narration: "Start with a hook: a surprising question in one sentence." },
        { label: "Step 1", headline: "First idea", sub: "Short sub-title", icon: "💡", stat: "42", statLabel: "one concrete number", narration: "Explain the first idea in one or two short sentences." },
        { label: "Step 2", headline: "Second idea", icon: "⚙️", narration: "Then the second idea. Keep every scene under ten seconds." },
        { headline: "What should we explain next?", icon: "💬", narration: "End with a question so people comment. Follow for more!" }
      ]
    };
  }

  /**
   * Validate and repair a project from localStorage, an imported file or the URL.
   * Returns a safe copy (every scene an object with string fields and a stable id) or null.
   */
  function normalizeProject(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.scenes)) {
      return null;
    }
    var seen = {};
    var scenes = raw.scenes.filter(function (s) {
      return s && typeof s === "object" && !Array.isArray(s);
    }).map(function (s) {
      var scene = Object.assign({}, s);
      SCENE_TEXT_KEYS.forEach(function (k) {
        if (scene[k] == null) {
          delete scene[k];
        } else if (typeof scene[k] !== "string") {
          scene[k] = String(scene[k]);
        }
      });
      if (scene.image != null && typeof scene.image !== "string") {
        delete scene.image;
      }
      if (typeof scene.id !== "string" || !scene.id || seen[scene.id]) {
        scene.id = newId();
      }
      seen[scene.id] = true;
      return scene;
    });
    if (!scenes.length) {
      return null;
    }
    var project = Object.assign({}, raw, { scenes: scenes });
    ["title", "kicker"].forEach(function (k) {
      project[k] = project[k] == null ? "" : String(project[k]);
    });
    if (TEMPLATES.indexOf(project.template) < 0) {
      project.template = "editorial";
    }
    if (project.lang !== "en" && project.lang !== "id") {
      project.lang = "en";
    }
    if (project.music !== "none" && !(SC.MOODS && SC.MOODS[project.music])) {
      project.music = "calm";
    }
    if (["own", "browser", "none"].indexOf(project.voice) < 0) {
      project.voice = "own";
    }
    project.captions = project.captions !== false;
    return project;
  }

  // ------------------------------------------------------------------
  // Toast (status + optional Undo)
  // ------------------------------------------------------------------
  var toastTimer = null;

  function toast(message, actionLabel, action) {
    var box = $("toast");
    var btn = $("toast-action");
    $("toast-msg").textContent = message;
    btn.hidden = !action;
    btn.textContent = actionLabel || "";
    btn.onclick = action ? function () {
      box.hidden = true;
      action();
    } : null;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.hidden = true;
    }, action ? 8000 : 3500);
  }

  // ------------------------------------------------------------------
  // Persistence: project JSON in localStorage, voice clips in IndexedDB
  // ------------------------------------------------------------------
  var saveWarned = false;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch (err) {
      // quota exceeded (large images) — keep working in memory, but say so once
      if (!saveWarned) {
        saveWarned = true;
        toast("Autosave failed: browser storage is full (large images?). Use Save JSON to keep your work.");
      }
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeProject(JSON.parse(raw)) : null;
    } catch (err) {
      return null;
    }
  }

  var voiceDb = (function () {
    var DB_NAME = "shortcraft";
    var STORE = "voices";
    var opening = null;

    function open() {
      if (!window.indexedDB) {
        return Promise.reject(new Error("IndexedDB unavailable"));
      }
      if (!opening) {
        opening = new Promise(function (resolve, reject) {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () {
            req.result.createObjectStore(STORE);
          };
          req.onsuccess = function () {
            resolve(req.result);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      }
      return opening;
    }

    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, mode);
          var req = fn(tx.objectStore(STORE));
          tx.oncomplete = function () {
            resolve(req ? req.result : undefined);
          };
          tx.onerror = tx.onabort = function () {
            reject(tx.error);
          };
        });
      });
    }

    function quiet(promise) {
      return promise.catch(function () {
        return undefined;   // private mode / storage blocked: voices just stay in memory
      });
    }

    return {
      put: function (id, blob) {
        return quiet(run("readwrite", function (s) { return s.put(blob, id); }));
      },
      get: function (id) {
        return quiet(run("readonly", function (s) { return s.get(id); }));
      },
      del: function (id) {
        return quiet(run("readwrite", function (s) { return s.delete(id); }));
      },
      keys: function () {
        return quiet(run("readonly", function (s) { return s.getAllKeys(); }));
      }
    };
  })();

  /** 16-bit PCM WAV, so trimmed recordings survive a reload exactly as heard. */
  function encodeWav(buffer) {
    var channels = Math.min(2, buffer.numberOfChannels);
    var rate = buffer.sampleRate;
    var frames = buffer.length;
    var bytes = new ArrayBuffer(44 + frames * channels * 2);
    var view = new DataView(bytes);
    function text(offset, s) {
      for (var i = 0; i < s.length; i++) {
        view.setUint8(offset + i, s.charCodeAt(i));
      }
    }
    text(0, "RIFF");
    view.setUint32(4, 36 + frames * channels * 2, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, frames * channels * 2, true);
    var data = [];
    for (var ch = 0; ch < channels; ch++) {
      data.push(buffer.getChannelData(ch));
    }
    var offset = 44;
    for (var i = 0; i < frames; i++) {
      for (var c = 0; c < channels; c++) {
        var sample = Math.max(-1, Math.min(1, data[c][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  function indexOfScene(id) {
    for (var i = 0; i < state.project.scenes.length; i++) {
      if (state.project.scenes[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  /** Re-attach saved voice clips (by scene id) after a reload, undo or import. */
  function restoreVoices() {
    var token = state.token;
    state.project.scenes.forEach(function (scene) {
      voiceDb.get(scene.id).then(function (blob) {
        if (!blob || token !== state.token) {
          return null;
        }
        return blob.arrayBuffer().then(function (buf) {
          return audio().decodeAudioData(buf);
        }).then(function (decoded) {
          var index = indexOfScene(scene.id);
          if (token === state.token && index >= 0 && !state.voiceBuffers[index]) {
            state.voiceBuffers[index] = decoded;
            refresh();
          }
        });
      }).catch(function () {
        /* unreadable clip: ignore */
      });
    });
  }

  /** Drop stored clips that no scene (current or undo-able project) refers to. */
  function pruneVoices() {
    var keep = {};
    [state.project, state.prevProject].forEach(function (p) {
      (p ? p.scenes : []).forEach(function (s) {
        keep[s.id] = true;
      });
    });
    voiceDb.keys().then(function (keys) {
      (keys || []).forEach(function (k) {
        if (!keep[k]) {
          voiceDb.del(k);
        }
      });
    });
  }

  function setProject(project) {
    var safe = normalizeProject(project);
    if (!safe) {
      return false;
    }
    stop();
    state.token += 1;
    state.project = safe;
    state.voiceBuffers = {};
    assets.images = {};
    safe.scenes.forEach(function (scene) {
      if (scene.image) {
        loadImage(scene);
      }
    });
    state.t = 0;
    renderForm();
    refresh();
    restoreVoices();
    return true;
  }

  /** Swap in another project but keep the old one one click away. */
  function replaceProject(project, message) {
    var previous = state.project ? clone(state.project) : null;
    if (!setProject(project)) {
      return false;
    }
    state.prevProject = previous;
    if (previous) {
      toast(message, "Undo", function () {
        var undone = state.project;
        if (setProject(previous)) {
          state.prevProject = undone;
          toast("Restored your previous project.");
        }
      });
    } else {
      toast(message);
    }
    return true;
  }

  function loadImage(scene) {
    var token = state.token;
    var src = scene.image;
    var img = new Image();
    img.onload = function () {
      var index = indexOfScene(scene.id);
      if (token !== state.token || index < 0 || state.project.scenes[index].image !== src) {
        return;
      }
      assets.images[index] = img;
      drawNow();
    };
    img.src = src;
  }

  // ------------------------------------------------------------------
  // Form
  // ------------------------------------------------------------------
  var projectFields = {
    "f-title": "title",
    "f-kicker": "kicker",
    "f-template": "template",
    "f-lang": "lang",
    "f-music": "music",
    "f-voice": "voice"
  };

  function renderForm() {
    var p = state.project;
    Object.keys(projectFields).forEach(function (id) {
      $(id).value = p[projectFields[id]] || "";
    });
    $("f-captions").checked = p.captions !== false;
    renderScenes();
    updateVoiceHint();
  }

  function updateVoiceHint() {
    var hints = {
      own: "Record each scene with your mic, or upload audio files (e.g. made with pipeline/voiceover.py neural voices). Recorded audio sets each scene's length, is included in the export and is kept in this browser between visits.",
      browser: "Your browser reads the narration during preview. Browsers don't allow this voice to be captured, so it is NOT in the exported file — use it to check timing, then record or upload.",
      none: "No voice: captions + music only. Scene length is estimated from the narration text."
    };
    $("voice-hint").textContent = hints[state.project.voice] || "";
  }

  function roleName(index) {
    var n = state.project.scenes.length;
    if (index === 0) {
      return "Hook";
    }
    if (index === n - 1 && n > 2) {
      return "Outro / CTA";
    }
    return "Step";
  }

  // ------------------------------------------------------------------
  // Layout editor (Pop / Clean templates): structured scene data as plain text
  // ------------------------------------------------------------------
  var LAYOUT_SPECS = {
    hook: { name: "Hook — badge + punch headline", fields: [
      { k: "badge", label: "Badge sticker", type: "text", ph: "e.g. NEW" },
      { k: "value", label: "Counting number, shown as Rp (optional)", type: "number", ph: "e.g. 1500000" }
    ] },
    price: { name: "Price — rolling counter + rows", fields: [
      { k: "value", label: "Price to count up (Rp)", type: "number", ph: "e.g. 4200000" },
      { k: "big", label: "Big text instead of the price (optional)", type: "text", ph: "e.g. −30%" },
      { k: "stamp", label: "Stamp sticker", type: "text", ph: "e.g. CHEAPER" },
      { k: "rows", label: "Rows — one per line: Label | Value", type: "rows", ph: "128 GB | Rp 4,2 jt\n256 GB | Rp 4,9 jt" }
    ] },
    bars: { name: "Bars — animated comparison", fields: [
      { k: "bars", label: "Bars — one per line: Label | number | shown text (optional). End a line with * to highlight it", type: "bars", ph: "Phone A | 4500 | 4,500 mAh *\nPhone B | 3800" }
    ] },
    chat: { name: "Chat — bubbles pop in", fields: [
      { k: "messages", label: "Messages — one per line, starting with me: or them:", type: "chat", ph: "them: is it worth it?\nme: depends on one number" }
    ] },
    math: { name: "Math — typed equation + result", fields: [
      { k: "lines", label: "Equation lines — one per line", type: "list", ph: "4500 mAh × 3.85 V\n= 17,325 mWh" },
      { k: "result", label: "Result pill", type: "text", ph: "≈ 17 Wh" }
    ] },
    stamp: { name: "Stamp — big quote + rubber stamp", fields: [
      { k: "quote", label: "Quote (defaults to the headline)", type: "text" },
      { k: "stamp", label: "Stamp text", type: "text", ph: "e.g. MYTH" }
    ] },
    poll: { name: "Poll — A/B + comment call-to-action", fields: [
      { k: "options", label: "Options — A on line 1, B on line 2", type: "list", ph: "Option A\nOption B" },
      { k: "cta", label: "Call-to-action sticker", type: "text", ph: "Comment A or B" }
    ] }
  };

  function textLines(text) {
    return String(text || "").split("\n").map(function (s) {
      return s.trim();
    }).filter(Boolean);
  }

  /** "1.500.000", "1,500,000", "4.5" and "Rp 4.200.000" all parse as numbers. */
  function parseNumber(text) {
    var s = String(text == null ? "" : text).replace(/[^\d.,\-]/g, "");
    if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) {
      s = s.replace(/[.,]/g, "");
    } else {
      s = s.replace(",", ".");
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : undefined;
  }

  var FIELD_TYPES = {
    text: {
      parse: function (v) { return v.trim() ? v : undefined; },
      format: function (v) { return v == null ? "" : String(v); }
    },
    number: {
      parse: parseNumber,
      format: function (v) { return typeof v === "number" ? String(v) : (v || ""); }
    },
    list: {
      parse: function (v) { return textLines(v); },
      format: function (v) { return Array.isArray(v) ? v.join("\n") : ""; }
    },
    rows: {
      parse: function (v) {
        return textLines(v).map(function (line) {
          var parts = line.split("|");
          return { label: parts[0].trim(), value: parts.slice(1).join("|").trim() };
        });
      },
      format: function (v) {
        return Array.isArray(v) ? v.map(function (r) { return r.label + " | " + r.value; }).join("\n") : "";
      }
    },
    bars: {
      parse: function (v) {
        return textLines(v).map(function (line) {
          var hl = /\*\s*$/.test(line);
          var parts = line.replace(/\*\s*$/, "").split("|").map(function (s) { return s.trim(); });
          var bar = { label: parts[0], value: parseNumber(parts[1]) || 0 };
          if (parts[2]) {
            bar.display = parts[2];
          }
          if (hl) {
            bar.hl = true;
          }
          return bar;
        });
      },
      format: function (v) {
        return Array.isArray(v) ? v.map(function (b) {
          return [b.label, b.value].concat(b.display ? [b.display] : []).join(" | ") + (b.hl ? " *" : "");
        }).join("\n") : "";
      }
    },
    chat: {
      parse: function (v) {
        return textLines(v).map(function (line) {
          var m = /^(me|them|aku|saya|dia)\s*:\s*(.*)$/i.exec(line);
          if (!m) {
            return { from: "me", text: line };
          }
          return { from: /^(them|dia)$/i.test(m[1]) ? "them" : "me", text: m[2] };
        });
      },
      format: function (v) {
        return Array.isArray(v) ? v.map(function (m) {
          return (m.from === "them" ? "them" : "me") + ": " + m.text;
        }).join("\n") : "";
      }
    }
  };

  function renderLayoutBox(node, scene) {
    var select = node.querySelector('[data-k="layout"]');
    if (!select.options.length) {
      Object.keys(LAYOUT_SPECS).forEach(function (key) {
        var opt = document.createElement("option");
        opt.value = key;
        opt.textContent = LAYOUT_SPECS[key].name;
        select.appendChild(opt);
      });
    }
    select.value = LAYOUT_SPECS[scene.layout] ? scene.layout : "hook";
    renderLayoutFields(node, scene);
  }

  function renderLayoutFields(node, scene) {
    var host = node.querySelector(".layout-fields");
    var spec = LAYOUT_SPECS[scene.layout] || LAYOUT_SPECS.hook;
    host.innerHTML = "";
    spec.fields.forEach(function (field) {
      var label = document.createElement("label");
      label.textContent = field.label;
      var multi = field.type !== "text" && field.type !== "number";
      var input = document.createElement(multi ? "textarea" : "input");
      if (multi) {
        input.rows = 3;
      } else {
        input.type = "text";
        if (field.type === "number") {
          input.inputMode = "decimal";
        }
      }
      input.dataset.lk = field.k;
      input.dataset.lt = field.type;
      input.placeholder = field.ph || "";
      input.value = FIELD_TYPES[field.type].format(scene[field.k]);
      label.appendChild(input);
      host.appendChild(label);
    });
  }

  function updateLayoutVisibility() {
    var on = LAYOUT_TEMPLATES.indexOf(state.project.template) >= 0;
    document.querySelectorAll(".scene .layout-box").forEach(function (box) {
      box.hidden = !on;
    });
  }

  // ------------------------------------------------------------------
  // Scenes
  // ------------------------------------------------------------------
  function renderScenes() {
    var host = $("scenes");
    host.innerHTML = "";
    var tpl = $("scene-tpl");
    state.project.scenes.forEach(function (scene, i) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.index = String(i);
      node.querySelector(".scene-num").textContent = "#" + (i + 1);
      node.querySelector(".scene-role").textContent = roleName(i);
      node.querySelectorAll("[data-k]").forEach(function (input) {
        input.value = scene[input.dataset.k] || "";
      });
      node.querySelectorAll("[data-act]").forEach(function (btn) {
        var label = btn.getAttribute("aria-label");
        if (label) {
          btn.setAttribute("aria-label", label + " (scene " + (i + 1) + ")");
        }
      });
      renderLayoutBox(node, scene);
      host.appendChild(node);
    });
    updateLayoutVisibility();
    updateSceneMeta();
  }

  function updateSceneMeta() {
    if (!state.timeline) {
      return;
    }
    var activeIndex = SC.sceneAt(state.timeline, state.t).index;
    document.querySelectorAll(".scene").forEach(function (node) {
      var i = Number(node.dataset.index);
      var item = state.timeline.scenes[i];
      if (!item) {
        return;
      }
      var dur = node.querySelector(".scene-dur");
      var limit = i === 0 ? 6.5 : 10;
      dur.textContent = item.dur.toFixed(1) + " s" + (item.measured ? " 🎙" : "");
      dur.classList.toggle("warn", item.dur > limit);
      dur.title = item.dur > limit
        ? (i === 0 ? "Long hook — keep the first scene under ~6 s" : "Long scene — keep scenes under ~10 s")
        : "";
      var status = node.querySelector(".voice-status");
      status.textContent = state.voiceBuffers[i]
        ? "Voice: " + state.voiceBuffers[i].duration.toFixed(1) + " s"
        : (state.project.voice === "own" ? "No voice yet" : "");
      node.classList.toggle("active", activeIndex === i);
    });
  }

  function onSceneInput(event) {
    var target = event.target;
    var node = target.closest(".scene");
    if (!node) {
      return;
    }
    var i = Number(node.dataset.index);
    var scene = state.project.scenes[i];
    if (target.dataset.lk) {
      var value = FIELD_TYPES[target.dataset.lt].parse(target.value);
      if (value === undefined || (Array.isArray(value) && !value.length)) {
        delete scene[target.dataset.lk];
      } else {
        scene[target.dataset.lk] = value;
      }
      refresh();
      return;
    }
    if (!target.dataset.k) {
      return;
    }
    scene[target.dataset.k] = target.value;
    if (target.dataset.k === "layout") {
      renderLayoutFields(node, scene);
    }
    refresh();
  }

  /** Move per-index state (voice buffers, decoded images) when scenes are inserted or removed. */
  function remapIndexed(map) {
    var buffers = {};
    var images = {};
    Object.keys(state.voiceBuffers).forEach(function (k) {
      var n = map(Number(k));
      if (n >= 0) {
        buffers[n] = state.voiceBuffers[k];
      }
    });
    Object.keys(assets.images).forEach(function (k) {
      var n = map(Number(k));
      if (n >= 0) {
        images[n] = assets.images[k];
      }
    });
    state.voiceBuffers = buffers;
    assets.images = images;
  }

  function deleteScene(i) {
    var scenes = state.project.scenes;
    var removed = scenes[i];
    var buffer = state.voiceBuffers[i];
    var image = assets.images[i];
    scenes.splice(i, 1);
    remapIndexed(function (n) {
      return n === i ? -1 : (n > i ? n - 1 : n);
    });
    renderScenes();
    refresh();
    var token = state.token;
    toast("Scene " + (i + 1) + " deleted.", "Undo", function () {
      if (token !== state.token) {
        return;
      }
      var at = Math.min(i, state.project.scenes.length);
      state.project.scenes.splice(at, 0, removed);
      remapIndexed(function (n) {
        return n >= at ? n + 1 : n;
      });
      if (buffer) {
        state.voiceBuffers[at] = buffer;
      }
      if (image) {
        assets.images[at] = image;
      }
      renderScenes();
      refresh();
    });
  }

  function duplicateScene(i) {
    var scenes = state.project.scenes;
    var copy = clone(scenes[i]);
    copy.id = newId();
    scenes.splice(i + 1, 0, copy);
    remapIndexed(function (n) {
      return n > i ? n + 1 : n;
    });
    if (state.voiceBuffers[i]) {
      state.voiceBuffers[i + 1] = state.voiceBuffers[i];
      voiceDb.get(scenes[i].id).then(function (blob) {
        if (blob) {
          voiceDb.put(copy.id, blob);
        }
      });
    }
    if (assets.images[i]) {
      assets.images[i + 1] = assets.images[i];
    }
    renderScenes();
    refresh();
    var title = document.querySelectorAll(".scene")[i + 1];
    if (title) {
      title.querySelector('[data-k="headline"]').focus();
    }
  }

  function onSceneClick(event) {
    var btn = event.target.closest("[data-act]");
    var node = event.target.closest(".scene");
    if (!btn || !node || btn.tagName === "INPUT") {
      return;
    }
    var i = Number(node.dataset.index);
    var scenes = state.project.scenes;
    var act = btn.dataset.act;
    if (act === "preview") {
      seek(state.timeline.scenes[i].start + 0.01);
    } else if (act === "up" && i > 0) {
      swap(i, i - 1);
    } else if (act === "down" && i < scenes.length - 1) {
      swap(i, i + 1);
    } else if (act === "duplicate") {
      duplicateScene(i);
    } else if (act === "delete") {
      if (scenes.length > 2) {
        deleteScene(i);
      } else {
        toast("A short needs at least 2 scenes (hook + outro).");
      }
    } else if (act === "record") {
      toggleRecord(i, btn);
    } else if (act === "pick-audio") {
      node.querySelector('input[data-act="audio"]').click();
    } else if (act === "clear-voice") {
      delete state.voiceBuffers[i];
      voiceDb.del(scenes[i].id);
      refresh();
    } else if (act === "clear-image") {
      delete scenes[i].image;
      delete assets.images[i];
      refresh();
    }
  }

  function swap(a, b) {
    var scenes = state.project.scenes;
    var tmp = scenes[a];
    scenes[a] = scenes[b];
    scenes[b] = tmp;
    remapIndexed(function (n) {
      return n === a ? b : (n === b ? a : n);
    });
    renderScenes();
    refresh();
    var moved = document.querySelectorAll(".scene")[b];
    var sameBtn = moved && moved.querySelector(b < a ? '[data-act="up"]' : '[data-act="down"]');
    if (sameBtn) {
      sameBtn.focus();
    }
  }

  function onSceneFile(event) {
    var input = event.target;
    var node = input.closest(".scene");
    if (!node || !input.files || !input.files[0]) {
      return;
    }
    var i = Number(node.dataset.index);
    var scene = state.project.scenes[i];
    var file = input.files[0];
    if (input.dataset.act === "image") {
      downscaleImage(file, function (dataUrl) {
        scene.image = dataUrl;
        loadImage(scene);
        refresh();
      });
    } else if (input.dataset.act === "audio") {
      file.arrayBuffer().then(function (buf) {
        return audio().decodeAudioData(buf);
      }).then(function (decoded) {
        var index = indexOfScene(scene.id);
        if (index < 0) {
          return;
        }
        state.voiceBuffers[index] = decoded;
        voiceDb.put(scene.id, file);
        refresh();
      }).catch(function () {
        toast("Could not decode that audio file. Try WAV, MP3 or M4A.");
      });
    }
    input.value = "";
  }

  function downscaleImage(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () {
        toast("Could not read that image.");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ------------------------------------------------------------------
  // Voice recording
  // ------------------------------------------------------------------
  var recorder = null;

  function toggleRecord(index, btn) {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Recording needs a browser with microphone access (HTTPS or localhost).");
      return;
    }
    var sceneId = state.project.scenes[index].id;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(function (stream) {
        var chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) {
          if (e.data.size) {
            chunks.push(e.data);
          }
        };
        recorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          btn.textContent = "● Record voice";
          btn.classList.remove("recording");
          btn.setAttribute("aria-pressed", "false");
          new Blob(chunks).arrayBuffer().then(function (buf) {
            return audio().decodeAudioData(buf);
          }).then(function (decoded) {
            var trimmed = trimSilence(decoded);
            var at = indexOfScene(sceneId);   // the scene may have moved while recording
            if (at < 0) {
              return;
            }
            state.voiceBuffers[at] = trimmed;
            voiceDb.put(sceneId, encodeWav(trimmed));
            refresh();
          }).catch(function () {
            toast("That recording could not be decoded — please try again.");
          });
        };
        recorder.start();
        btn.textContent = "■ Stop";
        btn.classList.add("recording");
        btn.setAttribute("aria-pressed", "true");
      })
      .catch(function () {
        toast("Microphone permission was denied.");
      });
  }

  /** Trim leading/trailing silence so scenes stay tight. */
  function trimSilence(buffer) {
    var data = buffer.getChannelData(0);
    var threshold = 0.02;
    var start = 0;
    var end = data.length - 1;
    while (start < end && Math.abs(data[start]) < threshold) {
      start++;
    }
    while (end > start && Math.abs(data[end]) < threshold) {
      end--;
    }
    var pad = Math.floor(0.08 * buffer.sampleRate);
    start = Math.max(0, start - pad);
    end = Math.min(data.length - 1, end + pad);
    var length = Math.max(1, end - start);
    var out = audio().createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
      out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(start, start + length));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Timeline + drawing
  // ------------------------------------------------------------------
  function voiceDurations() {
    if (state.project.voice !== "own") {
      return {};
    }
    var out = {};
    Object.keys(state.voiceBuffers).forEach(function (k) {
      out[k] = state.voiceBuffers[k].duration;
    });
    return out;
  }

  function refresh() {
    state.timeline = SC.buildTimeline(state.project, voiceDurations());
    state.t = Math.min(state.t, state.timeline.total - 0.01);
    updateSceneMeta();
    updateKit();
    drawNow();
    save();
  }

  function drawNow() {
    if (!state.timeline) {
      return;
    }
    SC.renderFrame(ctx, state.project, state.timeline, state.t, assets);
    var total = state.timeline.total;
    $("time").textContent = state.t.toFixed(1) + " / " + total.toFixed(1) + " s";
    $("scrub").value = String(Math.round((state.t / total) * 1000));
    $("scrub").setAttribute("aria-valuetext", state.t.toFixed(1) + " of " + total.toFixed(1) + " seconds");
  }

  function updateKit() {
    $("post-kit").value = SC.postKit(state.project);
    var list = $("checklist");
    list.innerHTML = "";
    var items = SC.checklist(state.project, state.timeline);
    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = item.ok ? "ok" : "todo";
      li.textContent = (item.ok ? "✓ " : "○ ") + item.text;
      list.appendChild(li);
    });
    var done = items.filter(function (item) { return item.ok; }).length;
    $("checklist-score").textContent = done + " / " + items.length;
    $("checklist-score").className = "score" + (done === items.length ? " full" : "");
  }

  function copyText(text, button) {
    var done = function () {
      if (button) {
        var label = button.textContent;
        button.textContent = "Copied ✓";
        setTimeout(function () {
          button.textContent = label;
        }, 1500);
      }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () {
        toast("Copy failed — select the text and copy it manually.");
      });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(area);
    if (ok) {
      done();
    } else {
      toast("Copy failed — select the text and copy it manually.");
    }
  }

  // ------------------------------------------------------------------
  // Playback
  // ------------------------------------------------------------------
  function setPlayButton(playing) {
    var btn = $("btn-play");
    btn.textContent = playing ? "❚❚ Pause" : "▶ Play";
    btn.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  function start(offset, destinations) {
    var a = audio();
    var startAt = a.currentTime + 0.12;
    var mix = a.createGain();
    mix.gain.value = 1;
    (destinations || [a.destination]).forEach(function (d) {
      mix.connect(d);
    });
    var music = null;
    if (state.project.music !== "none") {
      music = SC.scheduleMusic(a, mix, state.project.music, startAt - offset, state.timeline.total,
        state.project.voice === "own" && Object.keys(state.voiceBuffers).length ? 0.55 : 0.8);
    }
    var voices = state.project.voice === "own"
      ? SC.scheduleVoices(a, mix, state.timeline, state.voiceBuffers, startAt, offset)
      : [];
    state.playback = { startAt: startAt, offset: offset, music: music, voices: voices, mix: mix };
    state.playing = true;
    state.spokenScene = -1;
    setPlayButton(true);
    requestAnimationFrame(tick);
  }

  function stop() {
    if (state.playback) {
      var pb = state.playback;
      if (pb.music) {
        pb.music.nodes.forEach(function (n) {
          try { n.stop(); } catch (err) { /* already stopped */ }
        });
      }
      pb.voices.forEach(function (n) {
        try { n.stop(); } catch (err) { /* already stopped */ }
      });
      pb.mix.disconnect();
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    state.playback = null;
    state.playing = false;
    setPlayButton(false);
  }

  function tick() {
    if (!state.playing || !state.playback) {
      return;
    }
    var a = audio();
    var t = state.playback.offset + (a.currentTime - state.playback.startAt);
    state.t = Math.max(0, t);
    if (state.t >= state.timeline.total) {
      state.t = state.timeline.total - 0.001;
      drawNow();
      stop();
      if (state.onEnded) {
        var cb = state.onEnded;
        state.onEnded = null;
        cb();
      }
      return;
    }
    maybeSpeak();
    drawNow();
    if (state.exporting) {
      updateExportProgress();
    } else {
      updateSceneMeta();
    }
    requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (state.exporting) {
      return;
    }
    if (state.playing) {
      stop();
    } else {
      if (state.t >= state.timeline.total - 0.05) {
        state.t = 0;
      }
      start(state.t);
    }
  }

  function maybeSpeak() {
    if (state.project.voice !== "browser" || state.exporting || !window.speechSynthesis) {
      return;
    }
    var item = SC.sceneAt(state.timeline, state.t);
    if (item.index === state.spokenScene || state.t < item.voStart) {
      return;
    }
    state.spokenScene = item.index;
    var utter = new SpeechSynthesisUtterance(item.scene.narration || "");
    var langCode = state.project.lang === "id" ? "id" : "en";
    var voice = window.speechSynthesis.getVoices().filter(function (v) {
      return v.lang && v.lang.toLowerCase().indexOf(langCode) === 0;
    })[0];
    if (voice) {
      utter.voice = voice;
    }
    utter.lang = langCode === "id" ? "id-ID" : "en-US";
    utter.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function seek(t) {
    var wasPlaying = state.playing;
    stop();
    state.t = Math.max(0, Math.min(t, state.timeline.total - 0.01));
    drawNow();
    updateSceneMeta();
    if (wasPlaying) {
      start(state.t);
    }
  }

  function seekScene(step) {
    var current = SC.sceneAt(state.timeline, state.t);
    var target = current.index + step;
    // "previous" from the middle of a scene goes back to its start first
    if (step < 0 && state.t - current.start > 0.6) {
      target = current.index;
    }
    target = Math.max(0, Math.min(state.timeline.scenes.length - 1, target));
    seek(state.timeline.scenes[target].start + 0.01);
  }

  /** Space play/pause · ←/→ ±1 s (Shift ±5 s) · Home restart · , / . previous/next scene. */
  function onKeyDown(event) {
    if (state.exporting || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) {
      return;
    }
    var target = event.target;
    var tag = target && target.tagName;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(tag))) {
      return;
    }
    var key = event.key;
    var handled = true;
    if (key === " " || key === "k" || key === "K") {
      togglePlay();
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      var delta = (event.shiftKey ? 5 : 1) * (key === "ArrowLeft" ? -1 : 1);
      seek(state.t + delta);
    } else if (key === "Home") {
      seek(0);
    } else if (key === ",") {
      seekScene(-1);
    } else if (key === ".") {
      seekScene(1);
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  var exportSession = null;

  function setExportLock(on) {
    state.exporting = on;
    document.body.classList.toggle("exporting", on);
    var editor = document.querySelector(".editor");
    if (editor) {
      editor.inert = on;
      editor.setAttribute("aria-busy", on ? "true" : "false");
    }
    ["sample-select", "btn-new", "btn-import", "btn-export", "scrub", "btn-restart"].forEach(function (id) {
      $(id).disabled = on;
    });
    $("btn-cancel-export").hidden = !on;
    $("export-progress").hidden = !on;
    $("btn-export").textContent = on ? "● Recording…" : "⬇ Export video";
  }

  function updateExportProgress() {
    var total = state.timeline.total;
    var t = Math.min(state.t, total);
    $("export-progress").value = Math.round((t / total) * 1000);
    var shown = Math.floor(t * 2) / 2;
    if (exportSession && shown !== exportSession.shown) {
      exportSession.shown = shown;
      $("export-status").textContent = "Recording… " + Math.floor(t) + " / " + Math.ceil(total) + " s — keep this tab visible.";
    }
  }

  function exportVideo() {
    if (state.exporting) {
      return;
    }
    var mime = SC.pickMime();
    if (mime === null || !canvas.captureStream || typeof MediaRecorder === "undefined") {
      $("export-status").textContent = "This browser can't record video. Try recent Chrome, Edge or Safari.";
      return;
    }
    stop();
    var a = audio();
    var dest = a.createMediaStreamDestination();
    var stream = new MediaStream(canvas.captureStream(SC.FPS).getVideoTracks().concat(dest.stream.getAudioTracks()));
    var options = { videoBitsPerSecond: 8000000, audioBitsPerSecond: 192000 };
    if (mime) {
      options.mimeType = mime;
    }
    var rec;
    try {
      rec = new MediaRecorder(stream, options);
    } catch (err) {
      $("export-status").textContent = "Could not start the recorder: " + err.message;
      return;
    }
    var session = { rec: rec, cancelled: false, hidden: false, shown: -1 };
    exportSession = session;
    var chunks = [];
    rec.ondataavailable = function (e) {
      if (e.data.size) {
        chunks.push(e.data);
      }
    };
    rec.onerror = function (e) {
      session.error = (e.error && e.error.message) || "recorder error";
    };
    rec.onstop = function () {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      exportSession = null;
      setExportLock(false);
      updateSceneMeta();
      if (session.cancelled) {
        $("export-status").textContent = "Export cancelled.";
        return;
      }
      if (session.error || !chunks.length) {
        $("export-status").textContent = "Export failed (" + (session.error || "no video data") + "). Try again with the tab visible.";
        return;
      }
      var type = rec.mimeType || mime || "video/webm";
      var ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
      var blob = new Blob(chunks, { type: type });
      var link = $("download-link");
      if (link.href) {
        URL.revokeObjectURL(link.href);
      }
      link.href = URL.createObjectURL(blob);
      link.download = slug(state.project.title) + "." + ext;
      link.textContent = "⬇ Download " + ext.toUpperCase() + " (" + (blob.size / 1048576).toFixed(1) + " MB)";
      link.hidden = false;
      state.lastExport = { blob: blob, filename: link.download };
      document.dispatchEvent(new CustomEvent("shortcraft:exported"));
      $("export-status").textContent = "Done. " + (ext === "webm"
        ? "WebM uploads fine to YouTube; for TikTok/Instagram convert to MP4 if needed."
        : "MP4 ready for TikTok, Reels and Shorts.") +
        (session.hidden ? " ⚠ The tab was hidden during export, so some frames may be missing — re-export with the tab visible for a clean file." : "");
      link.focus();
    };
    setExportLock(true);
    $("download-link").hidden = true;
    state.t = 0;
    drawNow();
    updateExportProgress();
    rec.start(1000);
    state.onEnded = function () {
      setTimeout(function () {
        if (rec.state !== "inactive") {
          rec.stop();
        }
      }, 300);
    };
    start(0, [dest, a.destination]);
  }

  function cancelExport() {
    if (!exportSession) {
      return;
    }
    exportSession.cancelled = true;
    state.onEnded = null;
    stop();
    if (exportSession.rec.state !== "inactive") {
      exportSession.rec.stop();
    }
  }

  function slug(text) {
    return String(text || "hazel-shorts").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hazel-shorts";
  }

  // ------------------------------------------------------------------
  // Wire up
  // ------------------------------------------------------------------
  /** A one-scene draft from a Channel Kit hook idea (?hook=…&lang=…). */
  function projectFromHook(hook, lang) {
    var project = blankProject();
    project.lang = lang === "id" ? "id" : "en";
    project.title = hook.slice(0, 80);
    project.voice = "browser";
    project.scenes[0].headline = hook;
    project.scenes[0].narration = hook;
    if (project.lang === "id") {
      project.kicker = "Kok bisa?";
      project.scenes[1].narration = "Jelaskan ide pertama dalam satu atau dua kalimat pendek.";
      project.scenes[2].narration = "Lalu ide kedua. Setiap scene di bawah sepuluh detik.";
      project.scenes[3].headline = "Mau dibahas apa berikutnya?";
      project.scenes[3].narration = "Tulis di komentar mau dibahas apa berikutnya. Ikuti untuk part 2!";
    }
    return project;
  }

  function init() {
    var select = $("sample-select");
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Load a sample…";
    select.appendChild(placeholder);
    SAMPLES.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      var sample = SAMPLES.filter(function (s) { return s.id === select.value; })[0];
      if (sample) {
        var project = clone(sample);
        project.voice = "browser";
        replaceProject(project, "Loaded sample: " + sample.name + ".");
      }
      select.value = "";
    });

    Object.keys(projectFields).forEach(function (id) {
      $(id).addEventListener("input", function () {
        state.project[projectFields[id]] = $(id).value;
        if (id === "f-voice") {
          updateVoiceHint();
        }
        if (id === "f-template") {
          updateLayoutVisibility();
        }
        refresh();
      });
    });
    $("f-captions").addEventListener("change", function () {
      state.project.captions = $("f-captions").checked;
      refresh();
    });

    var scenesHost = $("scenes");
    scenesHost.addEventListener("input", onSceneInput);
    scenesHost.addEventListener("click", onSceneClick);
    scenesHost.addEventListener("change", function (e) {
      if (e.target.type === "file") {
        onSceneFile(e);
      }
    });

    $("btn-add-scene").addEventListener("click", function () {
      var scenes = state.project.scenes;
      var at = Math.max(1, scenes.length - 1);
      scenes.splice(at, 0, {
        id: newId(), label: "Step", headline: "New step", icon: "✨", narration: "One short, concrete sentence."
      });
      remapIndexed(function (n) {
        return n >= at ? n + 1 : n;
      });
      renderScenes();
      refresh();
      var added = document.querySelectorAll(".scene")[at];
      if (added) {
        added.scrollIntoView({ block: "center", behavior: "smooth" });
        added.querySelector('[data-k="headline"]').focus({ preventScroll: true });
      }
    });

    $("btn-play").addEventListener("click", togglePlay);
    canvas.addEventListener("click", togglePlay);
    $("btn-restart").addEventListener("click", function () {
      seek(0);
    });
    $("scrub").addEventListener("input", function () {
      if (!state.exporting) {
        seek((Number($("scrub").value) / 1000) * state.timeline.total);
      }
    });
    $("btn-export").addEventListener("click", exportVideo);
    $("btn-cancel-export").addEventListener("click", cancelExport);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && exportSession) {
        exportSession.hidden = true;
      }
    });
    window.addEventListener("beforeunload", function (event) {
      if (state.exporting) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    $("btn-new").addEventListener("click", function () {
      replaceProject(blankProject(), "Started a new project.");
    });
    $("btn-save").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state.project, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = slug(state.project.title) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast("Saved " + a.download + " (voice clips stay in this browser).");
    });
    $("btn-import").addEventListener("click", function () {
      $("file-import").click();
    });
    $("file-import").addEventListener("change", function () {
      var file = $("file-import").files[0];
      if (!file) {
        return;
      }
      file.text().then(function (text) {
        if (!replaceProject(JSON.parse(text), "Imported " + file.name + ".")) {
          throw new Error("no scenes");
        }
      }).catch(function () {
        toast("That file is not a Hazel Shorts project.");
      });
      $("file-import").value = "";
    });
    $("btn-copy-kit").addEventListener("click", function () {
      copyText($("post-kit").value, $("btn-copy-kit"));
    });

    if (/view=mobile/.test(window.location.search)) {
      document.body.classList.add("mobile");
    }
    var params = new URLSearchParams(window.location.search);
    var sampleId = params.get("sample");
    var hook = (params.get("hook") || "").trim();
    var initial = null;
    var message = "";
    if (sampleId) {
      var match = SAMPLES.filter(function (s) { return s.id === sampleId; })[0];
      if (match) {
        initial = clone(match);
        initial.voice = "browser";
        message = "Opened sample: " + match.name + ".";
      }
    } else if (hook) {
      initial = projectFromHook(hook.slice(0, 200), params.get("lang"));
      message = "Started a draft from your Channel Kit idea.";
    }
    var saved = load();
    var startT = parseFloat(params.get("t") || "0") || 0;
    if (initial) {
      // Opening a sample/idea link must never silently wipe the autosaved project.
      state.project = saved;
      if (!replaceProject(initial, message)) {
        setProject(saved || blankProject());
      }
      // …and a reload should keep editing, not reset to the sample again.
      params.delete("sample");
      params.delete("hook");
      params.delete("lang");
      if (window.history && window.history.replaceState) {
        var rest = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
      }
    } else {
      setProject(saved || (SAMPLES[0] ? Object.assign(clone(SAMPLES[0]), { voice: "browser" }) : blankProject()));
    }
    pruneVoices();
    if (startT) {
      seek(startT);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }
  }

  window.ShortcraftStudio = {
    state: state,
    seek: seek,
    exportVideo: exportVideo,
    cancelExport: cancelExport,
    setProject: setProject,
    normalizeProject: normalizeProject,
    layouts: LAYOUT_SPECS,
    getAssets: function () { return assets; }
  };
  document.addEventListener("DOMContentLoaded", init);
})();
