/* Shortcraft studio UI — editor, preview, voice capture and export. */
(function () {
  "use strict";

  var STORAGE_KEY = "shortcraft.project.v1";
  var SC = window.SC;
  var SAMPLES = window.SC_SAMPLES || [];

  var canvas = document.getElementById("preview");
  var ctx = canvas.getContext("2d");
  var assets = SC.makeAssets();

  var state = {
    project: null,
    voiceBuffers: {},     // scene index -> AudioBuffer
    timeline: null,
    t: 0,
    playing: false,
    exporting: false,
    playback: null,       // {startAt, offset, music, voices}
    spokenScene: -1
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

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch (err) {
      // quota exceeded (large images) — keep working in memory
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  function setProject(project) {
    state.project = project;
    state.project.voice = state.project.voice || "own";
    state.voiceBuffers = {};
    assets.images = {};
    project.scenes.forEach(function (scene, i) {
      if (scene.image) {
        loadImage(i, scene.image);
      }
    });
    stop();
    state.t = 0;
    renderForm();
    refresh();
  }

  function loadImage(index, dataUrl) {
    var img = new Image();
    img.onload = function () {
      assets.images[index] = img;
      drawNow();
    };
    img.src = dataUrl;
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
      own: "Record each scene with your mic, or upload audio files (e.g. made with pipeline/voiceover.py neural voices). Recorded audio sets each scene's length and is included in the export.",
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
      host.appendChild(node);
    });
    updateSceneMeta();
  }

  function updateSceneMeta() {
    if (!state.timeline) {
      return;
    }
    document.querySelectorAll(".scene").forEach(function (node) {
      var i = Number(node.dataset.index);
      var item = state.timeline.scenes[i];
      if (!item) {
        return;
      }
      node.querySelector(".scene-dur").textContent = item.dur.toFixed(1) + " s" + (item.measured ? " 🎙" : "");
      var status = node.querySelector(".voice-status");
      status.textContent = state.voiceBuffers[i]
        ? "Voice: " + state.voiceBuffers[i].duration.toFixed(1) + " s"
        : (state.project.voice === "own" ? "No voice yet" : "");
      node.classList.toggle("active", state.timeline && SC.sceneAt(state.timeline, state.t).index === i);
    });
  }

  function onSceneInput(event) {
    var target = event.target;
    var node = target.closest(".scene");
    if (!node || !target.dataset.k) {
      return;
    }
    var i = Number(node.dataset.index);
    state.project.scenes[i][target.dataset.k] = target.value;
    refresh();
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
    } else if (act === "delete" && scenes.length > 2) {
      if (window.confirm("Delete scene " + (i + 1) + "?")) {
        scenes.splice(i, 1);
        shiftIndexed(i, -1);
        renderScenes();
        refresh();
      }
    } else if (act === "record") {
      toggleRecord(i, btn);
    } else if (act === "clear-voice") {
      delete state.voiceBuffers[i];
      refresh();
    } else if (act === "clear-image") {
      delete scenes[i].image;
      delete assets.images[i];
      refresh();
    }
  }

  function shiftIndexed(removed, dir) {
    var buffers = {};
    var images = {};
    Object.keys(state.voiceBuffers).forEach(function (k) {
      var n = Number(k);
      if (n === removed) {
        return;
      }
      buffers[n > removed ? n + dir : n] = state.voiceBuffers[k];
    });
    Object.keys(assets.images).forEach(function (k) {
      var n = Number(k);
      if (n === removed) {
        return;
      }
      images[n > removed ? n + dir : n] = assets.images[k];
    });
    state.voiceBuffers = buffers;
    assets.images = images;
  }

  function swap(a, b) {
    var scenes = state.project.scenes;
    var tmp = scenes[a];
    scenes[a] = scenes[b];
    scenes[b] = tmp;
    var va = state.voiceBuffers[a];
    var vb = state.voiceBuffers[b];
    if (vb) {
      state.voiceBuffers[a] = vb;
    } else {
      delete state.voiceBuffers[a];
    }
    if (va) {
      state.voiceBuffers[b] = va;
    } else {
      delete state.voiceBuffers[b];
    }
    var ia = assets.images[a];
    var ib = assets.images[b];
    if (ib) {
      assets.images[a] = ib;
    } else {
      delete assets.images[a];
    }
    if (ia) {
      assets.images[b] = ia;
    } else {
      delete assets.images[b];
    }
    renderScenes();
    refresh();
  }

  function onSceneFile(event) {
    var input = event.target;
    var node = input.closest(".scene");
    if (!node || !input.files || !input.files[0]) {
      return;
    }
    var i = Number(node.dataset.index);
    var file = input.files[0];
    if (input.dataset.act === "image") {
      downscaleImage(file, function (dataUrl) {
        state.project.scenes[i].image = dataUrl;
        loadImage(i, dataUrl);
        refresh();
      });
    } else if (input.dataset.act === "audio") {
      file.arrayBuffer().then(function (buf) {
        return audio().decodeAudioData(buf);
      }).then(function (decoded) {
        state.voiceBuffers[i] = decoded;
        refresh();
      }).catch(function () {
        window.alert("Could not decode that audio file. Try WAV, MP3 or M4A.");
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
      window.alert("Recording needs a browser with microphone access (HTTPS or localhost).");
      return;
    }
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
          new Blob(chunks).arrayBuffer().then(function (buf) {
            return audio().decodeAudioData(buf);
          }).then(function (decoded) {
            state.voiceBuffers[index] = trimSilence(decoded);
            refresh();
          });
        };
        recorder.start();
        btn.textContent = "■ Stop";
        btn.classList.add("recording");
      })
      .catch(function () {
        window.alert("Microphone permission was denied.");
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
  }

  function updateKit() {
    $("post-kit").value = SC.postKit(state.project);
    var list = $("checklist");
    list.innerHTML = "";
    SC.checklist(state.project, state.timeline).forEach(function (item) {
      var li = document.createElement("li");
      li.className = item.ok ? "ok" : "todo";
      li.textContent = (item.ok ? "✓ " : "○ ") + item.text;
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------------
  // Playback
  // ------------------------------------------------------------------
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
    $("btn-play").textContent = "❚❚ Pause";
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
    $("btn-play").textContent = "▶ Play";
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
    if (!state.exporting) {
      updateSceneMeta();
    }
    requestAnimationFrame(tick);
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

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  function exportVideo() {
    if (state.exporting) {
      return;
    }
    var mime = SC.pickMime();
    if (mime === null || !canvas.captureStream) {
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
    var rec = new MediaRecorder(stream, options);
    var chunks = [];
    rec.ondataavailable = function (e) {
      if (e.data.size) {
        chunks.push(e.data);
      }
    };
    rec.onstop = function () {
      state.exporting = false;
      document.body.classList.remove("exporting");
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
        : "MP4 ready for TikTok, Reels and Shorts.");
      updateSceneMeta();
    };
    state.exporting = true;
    document.body.classList.add("exporting");
    $("download-link").hidden = true;
    $("export-status").textContent = "Recording… " + state.timeline.total.toFixed(0) + " s";
    state.t = 0;
    drawNow();
    rec.start(1000);
    state.onEnded = function () {
      setTimeout(function () { rec.stop(); }, 300);
    };
    start(0, [dest, a.destination]);
  }

  function slug(text) {
    return String(text || "shortcraft").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shortcraft";
  }

  // ------------------------------------------------------------------
  // Wire up
  // ------------------------------------------------------------------
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
        setProject(project);
      }
      select.value = "";
    });

    Object.keys(projectFields).forEach(function (id) {
      $(id).addEventListener("input", function () {
        state.project[projectFields[id]] = $(id).value;
        if (id === "f-voice") {
          updateVoiceHint();
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
      scenes.splice(Math.max(1, scenes.length - 1), 0, {
        label: "Step", headline: "New step", icon: "✨", narration: "One short, concrete sentence."
      });
      renderScenes();
      refresh();
    });

    $("btn-play").addEventListener("click", function () {
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
    });
    $("btn-restart").addEventListener("click", function () {
      seek(0);
    });
    $("scrub").addEventListener("input", function () {
      if (!state.exporting) {
        seek((Number($("scrub").value) / 1000) * state.timeline.total);
      }
    });
    $("btn-export").addEventListener("click", exportVideo);

    $("btn-new").addEventListener("click", function () {
      if (window.confirm("Start a new project? Unsaved voice recordings will be lost.")) {
        setProject(blankProject());
      }
    });
    $("btn-save").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state.project, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = slug(state.project.title) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
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
        var project = JSON.parse(text);
        if (!project.scenes || !project.scenes.length) {
          throw new Error("no scenes");
        }
        setProject(project);
      }).catch(function () {
        window.alert("That file is not a Shortcraft project.");
      });
      $("file-import").value = "";
    });
    $("btn-copy-kit").addEventListener("click", function () {
      var area = $("post-kit");
      area.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(area.value);
      } else {
        document.execCommand("copy");
      }
    });

    if (/view=mobile/.test(window.location.search)) {
      document.body.classList.add("mobile");
    }
    var params = new URLSearchParams(window.location.search);
    var sampleId = params.get("sample");
    var initial = null;
    if (sampleId) {
      var match = SAMPLES.filter(function (s) { return s.id === sampleId; })[0];
      initial = match ? clone(match) : null;
      if (initial) {
        initial.voice = "browser";
      }
    }
    var startT = parseFloat(params.get("t") || "0") || 0;
    setProject(initial || load() || (SAMPLES[0] ? Object.assign(clone(SAMPLES[0]), { voice: "browser" }) : blankProject()));
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
    setProject: setProject,
    getAssets: function () { return assets; }
  };
  document.addEventListener("DOMContentLoaded", init);
})();
