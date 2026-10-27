/* Shortcraft engine — timeline, canvas templates, audio and export.
 * Zero dependencies. Everything runs in the browser (Canvas 2D, Web Audio,
 * MediaRecorder). Exposed as window.SC.
 */
(function () {
  "use strict";

  var W = 1080;
  var H = 1920;
  var FPS = 30;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x));
  }

  function ease(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hasDigit(text) {
    return /\d/.test(text);
  }

  function isLoud(text) {
    return text.split(/\s+/).some(function (word) {
      var clean = word.replace(/[^A-Za-z]/g, "");
      return clean.length > 1 && clean === clean.toUpperCase();
    });
  }

  function fitFont(ctx, text, family, weight, maxSize, maxWidth, minSize) {
    var size = maxSize;
    ctx.font = weight + " " + size + "px " + family;
    while (ctx.measureText(text).width > maxWidth && size > (minSize || 20)) {
      size -= 2;
      ctx.font = weight + " " + size + "px " + family;
    }
    return size;
  }

  function wrapLines(ctx, text, maxWidth) {
    var out = [];
    String(text || "").split("\n").forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      var line = "";
      words.forEach(function (word) {
        var test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      if (line) {
        out.push(line);
      }
    });
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(ctx, img, x, y, w, h, zoom, panX, panY) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) {
      return;
    }
    var scale = Math.max(w / iw, h / ih) * zoom;
    var dw = iw * scale;
    var dh = ih * scale;
    var dx = x + (w - dw) / 2 + panX * (dw - w) / 2;
    var dy = y + (h - dh) / 2 + panY * (dh - h) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // ------------------------------------------------------------------
  // Timeline
  // ------------------------------------------------------------------
  var WORDS_PER_SEC = { en: 2.6, id: 2.3 };

  function captionChunks(text, maxChars) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var chunks = [];
    var current = [];
    words.forEach(function (word) {
      var candidate = current.concat([word]).join(" ");
      if (current.length && (candidate.length > maxChars || current.length >= 3)) {
        chunks.push(current.join(" "));
        current = [word];
      } else {
        current.push(word);
      }
    });
    if (current.length) {
      chunks.push(current.join(" "));
    }
    var weights = chunks.map(function (c) { return c.length + 4; });
    var total = weights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var acc = 0;
    return chunks.map(function (c, i) {
      var start = acc / total;
      acc += weights[i];
      return { text: c, start: start };
    });
  }

  function sceneRole(project, index) {
    var scene = project.scenes[index];
    if (scene.role) {
      return scene.role;
    }
    if (index === 0) {
      return "hook";
    }
    if (index === project.scenes.length - 1 && project.scenes.length > 2) {
      return "outro";
    }
    return "step";
  }

  /** Build a timeline. voiceDurations[i] (seconds) overrides the estimate. */
  function buildTimeline(project, voiceDurations) {
    var lang = project.lang || "en";
    var rate = WORDS_PER_SEC[lang] || 2.5;
    var maxChars = project.template === "editorial" ? 24 : (project.template === "pop" || project.template === "clean" ? 18 : 20);
    var cursor = 0;
    var stepCount = 0;
    var scenes = project.scenes.map(function (scene, i) {
      var narration = scene.narration || "";
      var words = narration.split(/\s+/).filter(Boolean).length;
      var measured = voiceDurations && voiceDurations[i];
      var voDur = measured || Math.max(0.6, words / rate);
      var pad = typeof project.scenePad === "number" ? project.scenePad : 0.7;
      var dur = Math.max(scene.minDur || 3.2, voDur + pad);
      var role = sceneRole(project, i);
      var item = {
        index: i,
        scene: scene,
        role: role,
        start: cursor,
        dur: dur,
        voStart: cursor + 0.2,
        voDur: voDur,
        measured: !!measured,
        chunks: captionChunks(scene.caption || narration, maxChars),
        stepIndex: role === "step" ? stepCount : -1
      };
      if (role === "step") {
        stepCount += 1;
      }
      cursor += dur;
      return item;
    });
    return { scenes: scenes, total: cursor, steps: stepCount };
  }

  function sceneAt(timeline, t) {
    var list = timeline.scenes;
    for (var i = 0; i < list.length; i++) {
      if (t >= list[i].start && t < list[i].start + list[i].dur) {
        return list[i];
      }
    }
    return list[list.length - 1];
  }

  function currentChunk(item, t) {
    var progress = (t - item.voStart) / item.voDur;
    if (progress < 0) {
      return null;
    }
    var current = null;
    item.chunks.forEach(function (c) {
      if (progress >= c.start) {
        current = c.text;
      }
    });
    return current;
  }

  // ------------------------------------------------------------------
  // Template: editorial (light, step tracker)
  // ------------------------------------------------------------------
  var ED = {
    paper: "#F6F3EC",
    ink: "#18181C",
    muted: "#787670",
    line: "#D2CDC3",
    accent: "#E44A2A",
    marker: "#FFDD57",
    green: "#24965C",
    serif: "Georgia, 'Times New Roman', serif",
    sans: "'Helvetica Neue', Arial, sans-serif",
    black: "'Arial Black', 'Helvetica Neue', Arial, sans-serif"
  };

  function editorialStepLabels(project, timeline) {
    return timeline.scenes
      .filter(function (s) { return s.role === "step"; })
      .map(function (s, i) { return s.scene.label || String(i + 1); });
  }

  function drawEditorial(ctx, project, timeline, t, assets) {
    var item = sceneAt(timeline, t);
    var scene = item.scene;
    var local = t - item.start;
    var steps = editorialStepLabels(project, timeline);

    ctx.fillStyle = ED.paper;
    ctx.fillRect(0, 0, W, H);
    if (assets.paperNoise) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(assets.paperNoise, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // progress bar
    ctx.fillStyle = ED.line;
    ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = ED.accent;
    ctx.fillRect(0, 0, W * clamp(t / timeline.total, 0, 1), 12);

    // kicker + counter
    ctx.fillStyle = ED.accent;
    ctx.fillRect(70, 140, 22, 22);
    ctx.fillStyle = ED.muted;
    ctx.font = "bold 30px " + ED.sans;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText((project.kicker || "").toUpperCase(), 108, 151);
    if (item.role === "step") {
      ctx.fillStyle = ED.ink;
      ctx.font = "bold 34px " + ED.serif;
      ctx.textAlign = "right";
      ctx.fillText((item.stepIndex + 1) + "/" + steps.length, 1010, 151);
    }

    // headline
    var slide = ease(local / 0.5);
    var off = (1 - slide) * 30;
    ctx.globalAlpha = slide;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ED.ink;
    if (scene.sub) {
      var size = fitFont(ctx, scene.headline || "", ED.serif, "bold", 88, 940, 48);
      ctx.fillText(scene.headline || "", 70, 200 + size * 0.85 + off);
      ctx.fillStyle = ED.muted;
      ctx.font = "italic 40px " + ED.serif;
      ctx.fillText(scene.sub, 72, 345 + off);
    } else {
      ctx.font = "bold 64px " + ED.serif;
      var lines = wrapLines(ctx, scene.headline || project.title || "", 940).slice(0, 3);
      lines.forEach(function (line, i) {
        ctx.fillText(line, 70, 262 + i * 76 + off);
      });
    }
    ctx.globalAlpha = 1;

    // tracker
    if (steps.length) {
      var ty = 470;
      var x0 = 150;
      var x1 = 930;
      var gap = steps.length > 1 ? (x1 - x0) / (steps.length - 1) : 0;
      var xs = steps.map(function (_, i) { return steps.length > 1 ? x0 + i * gap : 540; });
      var reach = item.role === "outro" ? steps.length : item.stepIndex;
      ctx.strokeStyle = ED.line;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(xs[0], ty);
      ctx.lineTo(xs[xs.length - 1], ty);
      ctx.stroke();
      if (reach > 0 || item.role === "outro") {
        var grow = ease(local / 0.6);
        var to = Math.min(reach, steps.length - 1);
        var from = Math.max(0, to - 1);
        var xe = item.role === "outro" ? xs[xs.length - 1] : lerp(xs[from], xs[to], grow);
        ctx.strokeStyle = ED.ink;
        ctx.beginPath();
        ctx.moveTo(xs[0], ty);
        ctx.lineTo(xe, ty);
        ctx.stroke();
      }
      steps.forEach(function (label, i) {
        var x = xs[i];
        var r = 30;
        var color;
        if (i < reach) {
          ctx.fillStyle = ED.ink;
          ctx.beginPath();
          ctx.arc(x, ty, r, 0, Math.PI * 2);
          ctx.fill();
          drawCheck(ctx, x, ty, 30, ED.paper, 6);
          color = ED.ink;
        } else if (i === item.stepIndex) {
          var pulse = 0.5 + 0.5 * Math.sin(t * 5);
          ctx.fillStyle = "rgba(228,74,42,0.22)";
          ctx.beginPath();
          ctx.arc(x, ty, r + 8 + 6 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = ED.accent;
          ctx.beginPath();
          ctx.arc(x, ty, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "900 30px " + ED.black;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), x, ty + 1);
          color = ED.accent;
        } else {
          ctx.fillStyle = ED.paper;
          ctx.strokeStyle = ED.line;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.arc(x, ty, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = ED.muted;
          ctx.font = "900 28px " + ED.black;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), x, ty + 1);
          color = ED.muted;
        }
        ctx.fillStyle = color;
        fitFont(ctx, label.toUpperCase(), ED.black, "900", 26, Math.max(80, gap - 14), 16);
        ctx.textAlign = "center";
        ctx.fillText(label.toUpperCase(), x, ty + 58);
      });
    }

    // card
    var cx = 70;
    var cy = 600;
    var cw = 940;
    var ch = 670;
    ctx.save();
    ctx.shadowColor = "rgba(60,50,30,0.18)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#fff";
    roundRect(ctx, cx, cy, cw, ch, 26);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, 26);
    ctx.clip();
    var appear = ease(local / 0.45);
    ctx.globalAlpha = appear;
    drawCardContent(ctx, scene, assets.images[item.index], cx, cy, cw, ch, local, item.dur, {
      statFont: ED.serif, statColor: ED.ink, labelColor: ED.muted, dark: false
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    // credit + chip
    ctx.fillStyle = ED.muted;
    ctx.font = "italic 26px " + ED.serif;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(scene.credit || project.credit || "Illustration", cx + 6, cy + ch + 36);
    if (scene.chip) {
      ctx.font = "bold 26px " + ED.sans;
      var cwid = ctx.measureText(scene.chip).width;
      ctx.fillStyle = ED.ink;
      roundRect(ctx, cx + cw - cwid - 36, cy + ch + 14, cwid + 36, 44, 22);
      ctx.fill();
      ctx.fillStyle = ED.paper;
      ctx.textAlign = "center";
      ctx.fillText(scene.chip, cx + cw - cwid / 2 - 18, cy + ch + 37);
    }

    // caption
    var chunk = project.captions === false ? null : currentChunk(item, t);
    if (chunk) {
      var cs = fitFont(ctx, chunk, ED.black, "900", 60, 940, 30);
      var tw = ctx.measureText(chunk).width;
      var y = 1440;
      if (hasDigit(chunk) || isLoud(chunk)) {
        ctx.fillStyle = ED.marker;
        ctx.fillRect(540 - tw / 2 - 16, y - 6, tw + 32, cs + 18);
      }
      ctx.fillStyle = ED.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(chunk, 540, y);
    }
  }

  function drawCheck(ctx, x, y, s, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y);
    ctx.lineTo(x - s * 0.15, y + s * 0.35);
    ctx.lineTo(x + s * 0.55, y - s * 0.4);
    ctx.stroke();
  }

  /** Image (Ken Burns) > emoji icon > big stat. Shared by both templates. */
  function drawCardContent(ctx, scene, img, x, y, w, h, local, dur, style) {
    var p = clamp(local / Math.max(dur, 0.1), 0, 1);
    if (img) {
      drawCover(ctx, img, x, y, w, h, lerp(1.04, 1.16, p), lerp(-0.4, 0.4, p), 0);
      if (scene.stat) {
        ctx.fillStyle = style.dark ? "rgba(10,11,14,0.78)" : "rgba(255,255,255,0.86)";
        roundRect(ctx, x + 24, y + h - 150, Math.min(w - 48, 620), 126, 20);
        ctx.fill();
        ctx.fillStyle = style.statColor;
        fitFont(ctx, scene.stat, style.statFont, "bold", 76, 560, 30);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(scene.stat, x + 50, y + h - 100);
        if (scene.statLabel) {
          ctx.fillStyle = style.labelColor;
          ctx.font = "bold 26px Arial, sans-serif";
          ctx.fillText(scene.statLabel, x + 52, y + h - 52);
        }
      }
      return;
    }
    var cx = x + w / 2;
    var bob = Math.sin(local * 2.2) * 8;
    if (scene.icon) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = Math.round(h * 0.36) + "px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
      ctx.fillText(scene.icon, cx, y + h * (scene.stat ? 0.36 : 0.5) + bob);
    }
    if (scene.stat) {
      ctx.fillStyle = style.statColor;
      var sy = scene.icon ? y + h * 0.72 : y + h * 0.45;
      fitFont(ctx, scene.stat, style.statFont, "bold", scene.icon ? 120 : 190, w - 80, 40);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(scene.stat, cx, sy);
      if (scene.statLabel) {
        ctx.fillStyle = style.labelColor;
        fitFont(ctx, scene.statLabel, "Arial, sans-serif", "bold", 36, w - 80, 20);
        ctx.fillText(scene.statLabel, cx, sy + (scene.icon ? 86 : 130));
      }
    }
  }

  // ------------------------------------------------------------------
  // Template: teardown (dark, callout cards)
  // ------------------------------------------------------------------
  var TD = {
    amber: "#FFB224",
    white: "#FFFFFF",
    grey: "#9AA0AE",
    black: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
    sans: "'Helvetica Neue', Arial, sans-serif"
  };

  function drawTeardown(ctx, project, timeline, t, assets) {
    var item = sceneAt(timeline, t);
    var scene = item.scene;
    var local = t - item.start;
    var total = timeline.scenes.length;

    if (assets.darkBg) {
      ctx.drawImage(assets.darkBg, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#14161B";
      ctx.fillRect(0, 0, W, H);
    }

    // header
    var tag = (project.kicker || "TEARDOWN").toUpperCase();
    ctx.font = "900 34px " + TD.black;
    var tagW = ctx.measureText(tag).width;
    ctx.fillStyle = TD.amber;
    roundRect(ctx, 60, 132, tagW + 44, 54, 27);
    ctx.fill();
    ctx.fillStyle = "#141418";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, 82, 160);
    ctx.fillStyle = TD.white;
    var title = (project.title || "").toUpperCase();
    fitFont(ctx, title, TD.black, "900", 64, 940, 30);
    ctx.textBaseline = "top";
    ctx.fillText(title, 60, 206);
    ctx.fillStyle = TD.amber;
    ctx.fillRect(60, 290, 240, 5);

    // media frame
    var mx = 60;
    var my = 340;
    var mw = 960;
    var mh = 820;
    ctx.save();
    roundRect(ctx, mx, my, mw, mh, 30);
    ctx.fillStyle = "#0B0C10";
    ctx.fill();
    ctx.clip();
    var mediaScene = { icon: scene.icon, stat: scene.image ? "" : (scene.icon ? "" : scene.stat), statLabel: "" };
    drawCardContent(ctx, mediaScene, assets.images[item.index], mx, my, mw, mh, local, item.dur, {
      statFont: TD.black, statColor: TD.amber, labelColor: TD.grey, dark: true
    });
    var vignette = ctx.createLinearGradient(0, my + mh * 0.55, 0, my + mh);
    vignette.addColorStop(0, "rgba(10,11,14,0)");
    vignette.addColorStop(1, "rgba(10,11,14,0.75)");
    ctx.fillStyle = vignette;
    ctx.fillRect(mx, my, mw, mh);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,178,36,0.35)";
    ctx.lineWidth = 3;
    roundRect(ctx, mx, my, mw, mh, 30);
    ctx.stroke();

    // callout card
    var hasCard = item.role !== "hook" && (scene.headline || scene.stat);
    if (hasCard) {
      var a = ease(local / 0.35);
      var kx = 520;
      var ky = 960;
      var kw = 480;
      var kh = 360;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(10,11,14,0.92)";
      roundRect(ctx, kx, ky, kw, kh, 26);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,178,36,0.7)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = TD.amber;
      ctx.font = "bold 26px " + TD.sans;
      var num = String(item.index).padStart(2, "0") + "/" + String(total - 1).padStart(2, "0");
      ctx.fillText(item.role === "outro" ? "" : num, kx + 30, ky + 42);
      ctx.fillStyle = TD.white;
      fitFont(ctx, (scene.headline || "").toUpperCase(), TD.black, "900", 34, kw - 60, 18);
      ctx.fillText((scene.headline || "").toUpperCase(), kx + 30, ky + 92);
      if (scene.stat) {
        ctx.fillStyle = TD.amber;
        fitFont(ctx, scene.stat, TD.black, "900", 72, kw - 60, 28);
        ctx.fillText(scene.stat, kx + 30, ky + 175);
      }
      if (scene.statLabel || scene.sub) {
        ctx.fillStyle = "#D2D6E0";
        fitFont(ctx, scene.statLabel || scene.sub, TD.sans, "bold", 28, kw - 60, 16);
        ctx.fillText(scene.statLabel || scene.sub, kx + 30, ky + 250);
      }
      if (scene.chip) {
        ctx.fillStyle = TD.grey;
        fitFont(ctx, scene.chip, TD.sans, "normal", 22, kw - 60, 14);
        ctx.fillText(scene.chip, kx + 30, ky + 310);
      }
      ctx.globalAlpha = 1;
    }
    if (item.role === "hook" && scene.headline) {
      ctx.fillStyle = TD.white;
      fitFont(ctx, scene.headline.toUpperCase(), TD.black, "900", 80, 900, 36);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#000";
      ctx.strokeText(scene.headline.toUpperCase(), 540, 1250);
      ctx.fillText(scene.headline.toUpperCase(), 540, 1250);
    }

    // caption
    var chunk = project.captions === false ? null : currentChunk(item, t);
    if (chunk) {
      var text = chunk.toUpperCase();
      fitFont(ctx, text, TD.black, "900", 62, 940, 30);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#000";
      ctx.strokeText(text, 540, 1600);
      ctx.fillStyle = hasDigit(text) ? TD.amber : TD.white;
      ctx.fillText(text, 540, 1600);
    }

    // scene fade-in
    if (item.index > 0 && local < 0.15) {
      ctx.fillStyle = "rgba(0,0,0," + (1 - local / 0.15) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------------
  // Static assets (pre-rendered once)
  // ------------------------------------------------------------------
  function makeAssets() {
    var noise = document.createElement("canvas");
    noise.width = 270;
    noise.height = 480;
    var nctx = noise.getContext("2d");
    var data = nctx.createImageData(noise.width, noise.height);
    for (var i = 0; i < data.data.length; i += 4) {
      var v = 120 + Math.random() * 30;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 10;
    }
    nctx.putImageData(data, 0, 0);

    var dark = document.createElement("canvas");
    dark.width = W;
    dark.height = H;
    var dctx = dark.getContext("2d");
    var grad = dctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#101217");
    grad.addColorStop(1, "#1C1F26");
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, W, H);
    var spot = dctx.createRadialGradient(540, 760, 50, 540, 760, 760);
    spot.addColorStop(0, "rgba(255,255,255,0.06)");
    spot.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = spot;
    dctx.fillRect(0, 0, W, H);
    dctx.strokeStyle = "rgba(255,255,255,0.03)";
    dctx.lineWidth = 1;
    for (var x = 0; x < W; x += 60) {
      dctx.beginPath();
      dctx.moveTo(x + 0.5, 0);
      dctx.lineTo(x + 0.5, H);
      dctx.stroke();
    }
    for (var y = 0; y < H; y += 60) {
      dctx.beginPath();
      dctx.moveTo(0, y + 0.5);
      dctx.lineTo(W, y + 0.5);
      dctx.stroke();
    }
    return { paperNoise: noise, darkBg: dark, images: {} };
  }

  function renderFrame(ctx, project, timeline, t, assets) {
    ctx.save();
    var extra = window.SC_TEMPLATES && window.SC_TEMPLATES[project.template];
    if (extra) {
      extra(ctx, project, timeline, t, assets, window.SC);
    } else if (project.template === "teardown") {
      drawTeardown(ctx, project, timeline, t, assets);
    } else {
      drawEditorial(ctx, project, timeline, t, assets);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------
  // Audio: generated music + scheduled voice clips
  // ------------------------------------------------------------------
  var MOODS = {
    calm: { chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], len: 4.0, bpm: 100 },
    bright: { chords: [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]], len: 3.2, bpm: 112 },
    dark: { chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], len: 4.8, bpm: 96 }
  };

  function midiHz(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  function scheduleMusic(actx, dest, mood, startAt, duration, volume) {
    var cfg = MOODS[mood] || MOODS.calm;
    var master = actx.createGain();
    master.gain.value = volume;
    var lowpass = actx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1800;
    master.connect(lowpass);
    lowpass.connect(dest);
    var nodes = [];
    var beat = 60 / cfg.bpm;
    for (var k = 0, t0 = 0; t0 < duration; k++, t0 += cfg.len) {
      var chord = cfg.chords[k % cfg.chords.length];
      var segLen = Math.min(cfg.len, duration - t0);
      var at = startAt + t0;
      chord.forEach(function (note) {
        [1, 1.003].forEach(function (detune) {
          var osc = actx.createOscillator();
          var g = actx.createGain();
          osc.type = "sine";
          osc.frequency.value = midiHz(note - 12) * detune;
          g.gain.setValueAtTime(0, at);
          g.gain.linearRampToValueAtTime(0.05, at + Math.min(1, segLen / 2));
          g.gain.setValueAtTime(0.05, at + Math.max(0, segLen - 1));
          g.gain.linearRampToValueAtTime(0, at + segLen);
          osc.connect(g);
          g.connect(master);
          osc.start(at);
          osc.stop(at + segLen + 0.05);
          nodes.push(osc);
        });
      });
      var bass = actx.createOscillator();
      var bg = actx.createGain();
      bass.frequency.value = midiHz(chord[0] - 24);
      bg.gain.setValueAtTime(0, at);
      bg.gain.linearRampToValueAtTime(0.07, at + 0.8);
      bg.gain.setValueAtTime(0.07, at + Math.max(0, segLen - 0.8));
      bg.gain.linearRampToValueAtTime(0, at + segLen);
      bass.connect(bg);
      bg.connect(master);
      bass.start(at);
      bass.stop(at + segLen + 0.05);
      nodes.push(bass);
      for (var s = 0; s * beat < segLen; s += 2) {
        var pt = at + s * beat;
        var pl = actx.createOscillator();
        var pg = actx.createGain();
        pl.type = "triangle";
        pl.frequency.value = midiHz(chord[(s / 2) % 3] + 12);
        pg.gain.setValueAtTime(0, pt);
        pg.gain.linearRampToValueAtTime(0.03, pt + 0.012);
        pg.gain.exponentialRampToValueAtTime(0.0005, pt + 0.6);
        pl.connect(pg);
        pg.connect(master);
        pl.start(pt);
        pl.stop(pt + 0.65);
        nodes.push(pl);
      }
    }
    master.gain.setValueAtTime(volume, startAt + Math.max(0, duration - 1.5));
    master.gain.linearRampToValueAtTime(0, startAt + duration);
    return { master: master, nodes: nodes };
  }

  function scheduleVoices(actx, dest, timeline, buffers, startAt, offset) {
    var sources = [];
    timeline.scenes.forEach(function (item) {
      var buf = buffers[item.index];
      if (!buf) {
        return;
      }
      var when = item.voStart - offset;
      var src = actx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      if (when >= 0) {
        src.start(startAt + when);
      } else if (-when < buf.duration) {
        src.start(startAt, -when);
      } else {
        return;
      }
      sources.push(src);
    });
    return sources;
  }

  function pickMime() {
    var candidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    if (typeof MediaRecorder === "undefined") {
      return null;
    }
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return "";
  }

  // ------------------------------------------------------------------
  // Post kit + checklist
  // ------------------------------------------------------------------
  var HASHTAGS = {
    en: "#engineering #howitworks #explained #learnontiktok #science #tech #shorts",
    id: "#faktaunik #teknik #engineering #belajardisosmed #sains #edukasi #fyp"
  };

  function postKit(project) {
    var scenes = project.scenes || [];
    var hook = scenes[0] ? scenes[0].narration : "";
    var bullets = scenes.slice(1, -1).map(function (s) {
      var line = s.headline || "";
      if (s.stat) {
        line += " — " + s.stat;
      }
      return "• " + line;
    });
    var outro = scenes.length > 1 ? scenes[scenes.length - 1].narration : "";
    return [
      "TITLE:",
      (project.title || "") + " #shorts",
      "",
      "CAPTION:",
      hook,
      bullets.join("\n"),
      outro,
      "",
      "HASHTAGS:",
      HASHTAGS[project.lang] || HASHTAGS.en
    ].join("\n");
  }

  function checklist(project, timeline) {
    var first = timeline.scenes[0];
    var lastScene = project.scenes[project.scenes.length - 1] || {};
    var lastText = (lastScene.narration || "") + " " + (lastScene.headline || "");
    return [
      { ok: first && first.dur <= 6.5, text: "Hook scene is short (≤ 6 s)" },
      { ok: timeline.total <= 60, text: "Total length ≤ 60 s (" + timeline.total.toFixed(0) + " s)" },
      { ok: project.captions !== false, text: "Burned-in captions on" },
      { ok: /\?|follow|ikuti|komen|comment|next|berikutnya/i.test(lastText), text: "Last scene asks a question / CTA" },
      { ok: project.scenes.some(function (s) { return /\d/.test(s.stat || s.narration || ""); }), text: "Uses at least one concrete number" },
      { ok: project.scenes.length >= 4 && project.scenes.length <= 9, text: "4–9 scenes" }
    ];
  }

  window.SC = {
    W: W,
    H: H,
    FPS: FPS,
    buildTimeline: buildTimeline,
    sceneAt: sceneAt,
    renderFrame: renderFrame,
    makeAssets: makeAssets,
    scheduleMusic: scheduleMusic,
    scheduleVoices: scheduleVoices,
    pickMime: pickMime,
    postKit: postKit,
    checklist: checklist,
    captionChunks: captionChunks,
    MOODS: MOODS
  };
})();
