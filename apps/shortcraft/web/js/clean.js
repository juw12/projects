/* Shortcraft template "clean" — calm, minimal, poll-first layouts for A/B shorts.
 *
 * Same scene data as "pop" (hook, price, bars, chat, math, stamp, poll), drawn with:
 *   - a flat navy canvas, faint drifting dot grid, one soft glow (no colour blobs)
 *   - story-style segmented progress (one segment per scene)
 *   - one typeface (Plus Jakarta Sans, bundled in web/fonts) and a single card style
 *   - A/B colour language: option A = mint, option B = coral, numbers = yellow
 *   - an optional tiny talking host (project.avatar) bottom-left that speaks the
 *     captions in a chat bubble — below the content area, clear of the right rail
 * Safe zones (1080x1920): platform UI covers y < 140, the right rail below y ~1000 and
 * the bottom ~320 px, so content lives in y 390-1380, captions/host at 1452, source 1556.
 */
(function () {
  "use strict";

  var W = 1080;
  var H = 1920;
  var FONT = "'Jakarta', 'Avenir Next', 'Helvetica Neue', Arial, sans-serif";
  var EMOJI = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";

  var C = {
    bg: "#071B26",
    glow: "15,59,58",
    surface: "#0D2733",
    surface2: "#143645",
    line: "rgba(255,255,255,0.08)",
    ink: "#F4F7F8",
    soft: "rgba(244,247,248,0.70)",
    mute: "rgba(244,247,248,0.45)",
    yellow: "#FFD447",
    a: "#4DE1C1",
    b: "#FF6B6B",
    dark: "#071B26"
  };
  var DEFAULT_C = Object.assign({}, C);
  var PALETTE_MAP = { bg1: "bg", yellow: "yellow", green: "a", cyan: "a", pink: "b" };

  var CONTENT_TOP = 390;
  var CONTENT_BOTTOM = 1380;
  var CAPTION_Y = 1450;
  var SOURCE_Y = 1556;

  if (document.fonts && document.fonts.load) {
    document.fonts.load("800 80px Jakarta");
    document.fonts.load("600 40px Jakarta");
  }

  // ---------------------------------------------------------------- helpers
  function applyPalette(palette) {
    Object.keys(DEFAULT_C).forEach(function (key) {
      C[key] = DEFAULT_C[key];
    });
    if (!palette) {
      return;
    }
    Object.keys(PALETTE_MAP).forEach(function (key) {
      if (typeof palette[key] === "string") {
        C[PALETTE_MAP[key]] = palette[key];
      }
    });
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function easeOut(x) {
    x = clamp(x, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  function easeInOut(x) {
    x = clamp(x, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function backOut(x) {
    x = clamp(x, 0, 1);
    var c1 = 1.2;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  function progress(local, start, dur) {
    return clamp((local - start) / dur, 0, 1);
  }

  function formatRp(n) {
    return "Rp" + Math.round(n).toLocaleString("id-ID");
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setFont(ctx, weight, size) {
    ctx.font = weight + " " + Math.round(size) + "px " + FONT;
  }

  function wrap(ctx, text, maxWidth) {
    var lines = [];
    String(text || "").split("\n").forEach(function (para) {
      var line = "";
      para.split(/\s+/).filter(Boolean).forEach(function (word) {
        var test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      });
      lines.push(line);
    });
    return lines;
  }

  function fitWrapped(ctx, text, weight, maxSize, maxWidth, maxLines, minSize) {
    var size = maxSize;
    var lines;
    while (size > (minSize || 36)) {
      setFont(ctx, weight, size);
      lines = wrap(ctx, text, maxWidth);
      var widest = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }));
      if (lines.length <= maxLines && widest <= maxWidth) {
        return { size: size, lines: lines };
      }
      size -= 4;
    }
    setFont(ctx, weight, size);
    return { size: size, lines: wrap(ctx, text, maxWidth) };
  }

  function card(ctx, x, y, w, h, opts) {
    opts = opts || {};
    ctx.fillStyle = opts.fill || C.surface;
    roundRect(ctx, x, y, w, h, opts.radius || 40);
    ctx.fill();
    ctx.strokeStyle = opts.stroke || C.line;
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.stroke();
  }

  function pill(ctx, text, cx, cy, opts) {
    opts = opts || {};
    var size = opts.size || 34;
    setFont(ctx, opts.weight || 800, size);
    var w = ctx.measureText(text).width + size * 1.3;
    var h = size * 1.9;
    ctx.fillStyle = opts.fill || C.yellow;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = opts.color || C.dark;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy + size * 0.06);
    return w;
  }

  function iconTile(ctx, icon, cx, cy, size, local, delay) {
    if (!icon) {
      return;
    }
    var p = backOut(progress(local, delay || 0.1, 0.45));
    if (p <= 0) {
      return;
    }
    ctx.save();
    ctx.translate(cx, cy + Math.sin(local * 1.8) * 6);
    ctx.scale(p, p);
    card(ctx, -size / 2, -size / 2, size, size, { fill: C.surface2, radius: size * 0.3 });
    ctx.font = Math.round(size * 0.56) + "px " + EMOJI;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, 0, size * 0.04);
    ctx.restore();
  }

  /** Centered headline. Words before "atau" tint mint (A), after it coral (B) when abTint. */
  function headline(ctx, text, y, local, opts) {
    opts = opts || {};
    var maxW = opts.maxWidth || W - 160;
    var fit = fitWrapped(ctx, text, 800, opts.size || 92, maxW, opts.maxLines || 3, 44);
    var lineH = fit.size * 1.16;
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var splitAt = -1;
    if (opts.abTint) {
      words.forEach(function (word, i) {
        if (splitAt < 0 && /^atau$/i.test(word)) {
          splitAt = i;
        }
      });
    }
    var wordIndex = 0;
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, li) {
      var p = easeOut(progress(local, 0.04 + li * 0.08, 0.4));
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate(0, (1 - p) * 26);
      setFont(ctx, 800, fit.size);
      var lineWords = line.split(" ");
      var space = ctx.measureText(" ").width;
      var widths = lineWords.map(function (w) { return ctx.measureText(w).width; });
      var total = widths.reduce(function (a, b) { return a + b; }, 0) + space * (lineWords.length - 1);
      var x = W / 2 - total / 2;
      ctx.textAlign = "left";
      lineWords.forEach(function (word, i) {
        var color = opts.color || C.ink;
        if (splitAt >= 0) {
          if (wordIndex < splitAt) {
            color = C.a;
          } else if (wordIndex === splitAt) {
            color = C.soft;
          } else {
            color = C.b;
          }
        }
        ctx.fillStyle = color;
        ctx.fillText(word, x, y + li * lineH);
        x += widths[i] + space;
        wordIndex += 1;
      });
      ctx.restore();
    });
    return y + fit.lines.length * lineH;
  }

  function subline(ctx, text, y, local, delay) {
    if (!text) {
      return y;
    }
    var p = easeOut(progress(local, delay || 0.35, 0.4));
    ctx.save();
    ctx.globalAlpha *= p;
    var fit = fitWrapped(ctx, text, 600, 42, W - 200, 2, 30);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, y + i * fit.size * 1.3 + (1 - p) * 16);
    });
    ctx.restore();
    return y + fit.lines.length * fit.size * 1.3;
  }

  function countValue(scene, local, delay, dur) {
    return (scene.value || 0) * easeOut(progress(local, delay, dur));
  }

  // ---------------------------------------------------------------- shared layers
  var gridCache = null;

  function dotGrid() {
    if (gridCache) {
      return gridCache;
    }
    gridCache = document.createElement("canvas");
    gridCache.width = W;
    gridCache.height = H + 60;
    var g = gridCache.getContext("2d");
    g.fillStyle = "rgba(255,255,255,0.045)";
    for (var y = 30; y < H + 60; y += 60) {
      for (var x = 30; x < W; x += 60) {
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    return gridCache;
  }

  function background(ctx, t) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    var gx = W * 0.5 + Math.sin(t * 0.15) * 120;
    var glow = ctx.createRadialGradient(gx, 260, 20, gx, 260, 1100);
    glow.addColorStop(0, "rgba(" + C.glow + ",0.75)");
    glow.addColorStop(1, "rgba(" + C.glow + ",0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(dotGrid(), 0, -((t * 8) % 60));
  }

  function segments(ctx, timeline, t) {
    var x0 = 48;
    var gap = 8;
    var usable = W - 96 - gap * (timeline.scenes.length - 1);
    var x = x0;
    timeline.scenes.forEach(function (item) {
      var w = usable * (item.dur / timeline.total);
      var fill = clamp((t - item.start) / item.dur, 0, 1);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      roundRect(ctx, x, 150, w, 6, 3);
      ctx.fill();
      if (fill > 0) {
        ctx.fillStyle = C.ink;
        roundRect(ctx, x, 150, Math.max(6, w * fill), 6, 3);
        ctx.fill();
      }
      x += w + gap;
    });
  }

  function header(ctx, project, docked) {
    var brand = (project.kicker || "").toUpperCase();
    if (!brand) {
      return;
    }
    var episode = project.episode ? project.episode.replace(/^eps?\s*/i, "#") : "";
    setFont(ctx, 800, 28);
    var brandW = ctx.measureText(brand).width;
    setFont(ctx, 600, 28);
    var epW = episode ? ctx.measureText("  ·  " + episode).width : 0;
    var w = brandW + epW + 76;
    ctx.fillStyle = "rgba(13,39,51,0.85)";
    roundRect(ctx, 48, 186, w, 60, 30);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.yellow;
    ctx.beginPath();
    ctx.arc(78, 216, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    setFont(ctx, 800, 28);
    ctx.fillStyle = C.ink;
    ctx.fillText(brand, 98, 218);
    if (episode) {
      setFont(ctx, 600, 28);
      ctx.fillStyle = C.mute;
      ctx.fillText("  ·  " + episode, 98 + brandW, 218);
    }
    if (!docked) {
      // A | B toggle chip — the channel's question, always on screen
      var cx = W - 48 - 70;
      ctx.fillStyle = "rgba(13,39,51,0.85)";
      roundRect(ctx, cx - 70, 186, 140, 60, 30);
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.stroke();
      setFont(ctx, 800, 28);
      ctx.textAlign = "center";
      ctx.fillStyle = C.a;
      ctx.fillText("A", cx - 32, 218);
      ctx.fillStyle = C.mute;
      ctx.fillText("|", cx, 216);
      ctx.fillStyle = C.b;
      ctx.fillText("B", cx + 32, 218);
    }
  }

  function captionState(item, t) {
    // shared with the engine: real word timings when the clip was aligned (caption_timing.py)
    return window.SC.captionAt(item, t);
  }

  function captions(ctx, project, item, t) {
    if (project.captions === false) {
      return;
    }
    var state = captionState(item, t);
    if (!state) {
      return;
    }
    var words = state.text.split(/\s+/).filter(Boolean);
    var active = Math.min(words.length - 1, state.active);
    var size = 66;
    var spacing = 18;
    var widths;
    var total;
    do {
      setFont(ctx, 800, size);
      widths = words.map(function (w) { return ctx.measureText(w).width; });
      total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (words.length - 1);
      size -= 4;
    } while (total > W - 160 && size > 40);
    size += 4;
    var p = easeOut(state.sinceStart / 0.16);
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.6 * p;
    ctx.translate(W / 2, CAPTION_Y + (1 - p) * 10);
    var x = -total / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    words.forEach(function (word, i) {
      if (i === active) {
        ctx.fillStyle = C.yellow;
        roundRect(ctx, x - 12, -size * 0.66, widths[i] + 24, size * 1.32, size * 0.3);
        ctx.fill();
        ctx.fillStyle = C.dark;
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = C.ink;
      }
      ctx.fillText(word, x, 3);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      x += widths[i] + spacing;
    });
    ctx.restore();
  }

  function sourceLine(ctx, project, scene) {
    var source = scene.source || project.source;
    if (!source) {
      return;
    }
    var size = 24;
    var text = "Sumber: " + source;
    setFont(ctx, 600, size);
    while (ctx.measureText(text).width > W - 160 && size > 17) {
      size -= 1;
      setFont(ctx, 600, size);
    }
    ctx.fillStyle = C.mute;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, SOURCE_Y);
  }

  // ---------------------------------------------------------------- host + chat bubble
  // A tiny talking host in the caption row (bottom-left) "says" each caption chunk in a
  // chat bubble. It sits below the content area and left of the platform's right rail, so
  // it never covers the scene animation. project.avatar = {
  //   name, skin, hair, shirt, glasses (bool), hairStyle ("short"|"long"|"hijab"),
  //   src (optional: a small looping/lip-synced clip that replaces the drawn face)
  // }
  var HOST = { x: 122, y: 1452, r: 58 };
  var BUBBLE_LEFT = 206;
  var BUBBLE_RIGHT_MAX = 920;      // keep clear of TikTok/Reels/Shorts right rail
  var envelopes = typeof WeakMap === "function" ? new WeakMap() : null;
  var hostVideos = {};

  /** Loudness envelope (60 Hz, 0..1) of a decoded narration buffer, cached per buffer. */
  function envelopeOf(buffer) {
    if (envelopes && envelopes.has(buffer)) {
      return envelopes.get(buffer);
    }
    var data = buffer.getChannelData(0);
    var hop = Math.max(1, Math.floor(buffer.sampleRate / 60));
    var count = Math.ceil(data.length / hop);
    var env = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      var sum = 0;
      var n = 0;
      for (var j = i * hop; j < Math.min(data.length, (i + 1) * hop); j += 4) {
        sum += data[j] * data[j];
        n += 1;
      }
      env[i] = Math.sqrt(sum / Math.max(1, n));
    }
    var sorted = Array.prototype.slice.call(env).sort(function (a, b) { return a - b; });
    var ref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)] || 0);
    var smooth = 0;
    for (var k = 0; k < count; k++) {
      var v = clamp(env[k] / ref, 0, 1);
      smooth = v > smooth ? v : smooth * 0.75 + v * 0.25;   // fast attack, soft release
      env[k] = smooth;
    }
    if (envelopes) {
      envelopes.set(buffer, env);
    }
    return env;
  }

  /** 0..1 mouth opening: real voice loudness when buffers exist, else a caption-driven guess. */
  function voiceLevel(item, t, speaking) {
    var studio = window.ShortcraftStudio;
    var buffer = studio && studio.state && studio.state.voiceBuffers && studio.state.voiceBuffers[item.index];
    if (buffer && buffer.getChannelData) {
      var env = envelopeOf(buffer);
      var index = Math.floor((t - item.voStart) * 60);
      return index >= 0 && index < env.length ? env[index] : 0;
    }
    if (!speaking) {
      return 0;
    }
    return clamp(0.25 + 0.75 * Math.abs(Math.sin(t * 13.0)) * (0.55 + 0.45 * Math.sin(t * 4.7)), 0, 1);
  }

  function hostVideo(avatar) {
    if (!avatar || !avatar.src) {
      return null;
    }
    if (!hostVideos[avatar.src]) {
      var video = document.createElement("video");
      video.muted = true;
      video.loop = !!avatar.loop;
      video.playsInline = true;
      video.preload = "auto";
      video.src = avatar.src;
      hostVideos[avatar.src] = video;
    }
    return hostVideos[avatar.src];
  }

  function syncVideo(video, t, loop) {
    if (!video || video.readyState < 1 || !video.duration) {
      return;
    }
    var target = loop ? t % video.duration : Math.min(t, video.duration - 0.05);
    var exporting = document.body && document.body.classList.contains("exporting");
    if (exporting) {
      if (video.paused) {
        video.play().catch(function () {});
      }
      if (Math.abs(video.currentTime - target) > 0.3) {
        video.currentTime = target;
      }
    } else if (Math.abs(video.currentTime - target) > 0.04) {
      video.pause();
      video.currentTime = target;
    }
  }

  /** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
  function shadeColor(hex, amount) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) {
      return hex;
    }
    var n = parseInt(m[1], 16);
    var channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
      var v = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
      return Math.round(clamp(v, 0, 255));
    });
    return "rgb(" + channels.join(",") + ")";
  }

  /** Drawn host face in a 200x200 design space centred on (0,0). */
  function drawFace(ctx, avatar, t, level, speaking) {
    var skin = avatar.skin || "#F6D5B8";        // bright, warm East/Southeast-Asian tone
    var skinShade = avatar.skinShade || shadeColor(skin, -0.12);
    var hair = avatar.hair || "#15110F";
    var shirt = avatar.shirt || C.a;
    var style = avatar.hairStyle || "short";
    var blinkPhase = (t + 0.7) % 3.6;
    var blink = blinkPhase < 0.12 ? Math.abs(blinkPhase - 0.06) / 0.06 : 1;
    var bob = speaking ? Math.sin(t * 5.5) * 2.5 : Math.sin(t * 1.2) * 1.2;
    var tilt = speaking ? Math.sin(t * 2.1) * 0.04 : 0;

    // shoulders
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(0, 112, 78, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.moveTo(-16, 64);
    ctx.lineTo(0, 86);
    ctx.lineTo(16, 64);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(0, bob);
    ctx.rotate(tilt);
    if (style === "hijab") {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.ellipse(0, 4, 60, 70, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // neck + head + ears
    ctx.fillStyle = skin;
    ctx.fillRect(-15, 34, 30, 34);
    ctx.fillStyle = skinShade;
    ctx.fillRect(-15, 44, 30, 12);                 // shadow under the chin
    if (style !== "hijab") {
      ctx.beginPath();
      ctx.arc(-43, 2, 10, 0, Math.PI * 2);
      ctx.arc(43, 2, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, -2, 43, 51, 0, 0, Math.PI * 2);
    ctx.fill();

    // hair
    ctx.fillStyle = hair;
    if (style === "short") {
      // straight black hair with a soft side-swept fringe
      ctx.beginPath();
      ctx.ellipse(0, -28, 47, 32, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-46, -26);
      ctx.quadraticCurveTo(-40, -58, 0, -58);
      ctx.quadraticCurveTo(40, -58, 46, -26);
      ctx.lineTo(44, -14);
      ctx.quadraticCurveTo(30, -30, 8, -27);
      ctx.quadraticCurveTo(-14, -24, -30, -30);
      ctx.quadraticCurveTo(-38, -22, -44, -12);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-47, -28, 8, 24);
      ctx.fillRect(39, -28, 8, 24);
      ctx.fillStyle = "rgba(255,255,255,0.10)";    // sheen
      ctx.beginPath();
      ctx.ellipse(-12, -46, 16, 5, -0.25, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === "long") {
      ctx.beginPath();
      ctx.ellipse(0, -26, 50, 36, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-52, -28, 16, 92);
      ctx.fillRect(36, -28, 16, 92);
      ctx.beginPath();
      ctx.ellipse(-6, -38, 42, 18, -0.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === "hijab") {
      ctx.beginPath();
      ctx.ellipse(0, -30, 50, 30, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    // brows, eyes, glasses
    var lift = level * 4;
    ctx.strokeStyle = "rgba(30,20,20,0.85)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.moveTo(side * 9, -21 - lift);
      ctx.quadraticCurveTo(side * 18, -24 - lift, side * 26, -20 - lift * 0.5);
      ctx.stroke();
      // almond eyes: wider than tall, outer corner slightly lifted, upper lid line
      ctx.save();
      ctx.translate(side * 17, -5);
      ctx.rotate(side * -0.08);
      ctx.fillStyle = "#1B1414";
      ctx.beginPath();
      ctx.ellipse(0, 0, 7.5, Math.max(0.8, 4.2 * blink), 0, 0, Math.PI * 2);
      ctx.fill();
      if (blink > 0.6) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";   // catch-light
        ctx.beginPath();
        ctx.arc(side * 2 - 1.5, -1.4, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-9, -1.5 * blink);
      ctx.quadraticCurveTo(0, -6.5 * blink, 9.5, -2.5 * blink);
      ctx.stroke();
      ctx.restore();
      ctx.lineWidth = 4;
      // blush
      ctx.fillStyle = "rgba(255,120,120,0.22)";
      ctx.beginPath();
      ctx.ellipse(side * 26, 13, 9, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // small nose
    ctx.strokeStyle = skinShade;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-3, 9);
    ctx.quadraticCurveTo(0, 12, 3, 9);
    ctx.stroke();
    if (avatar.glasses) {
      ctx.strokeStyle = "rgba(20,20,20,0.9)";
      ctx.lineWidth = 3.5;
      roundRect(ctx, -32, -16, 26, 22, 8);
      ctx.stroke();
      roundRect(ctx, 6, -16, 26, 22, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, -7);
      ctx.lineTo(6, -7);
      ctx.stroke();
    }

    // mouth: opens with voice loudness, small smile when quiet
    if (level > 0.08) {
      var open = 3 + 13 * level;
      ctx.fillStyle = "#4A1F22";
      ctx.beginPath();
      ctx.ellipse(0, 25, 10 + 3 * level, open / 2 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#E57A7A";
      ctx.beginPath();
      ctx.ellipse(0, 25 + open * 0.28, 6, Math.max(1, open * 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#4A1F22";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(0, 18, 10, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHost(ctx, project, item, t, speaking) {
    var avatar = project.avatar || {};
    var level = voiceLevel(item, t, speaking);
    var x = HOST.x;
    var y = HOST.y;
    var r = HOST.r;

    // speaking halo
    if (speaking) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.3 * level;
      ctx.fillStyle = C.a;
      ctx.beginPath();
      ctx.arc(x, y, r + 7 + level * 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = C.surface2;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    var video = hostVideo(avatar);
    syncVideo(video, t, !!avatar.loop);
    if (video && video.readyState >= 2 && video.videoWidth) {
      var side = Math.min(video.videoWidth, video.videoHeight);
      var sx = (video.videoWidth - side) / 2;
      var sy = Math.max(0, (video.videoHeight - side) * 0.3);
      ctx.drawImage(video, sx, sy, side, side, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.translate(x, y + r * 0.08);
      ctx.scale(r / 100, r / 100);
      drawFace(ctx, avatar, t, level, speaking);
    }
    ctx.restore();
    ctx.strokeStyle = speaking ? C.a : "rgba(77,225,193,0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    // online dot
    ctx.fillStyle = C.bg;
    ctx.beginPath();
    ctx.arc(x + r * 0.72, y + r * 0.72, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3DDC84";
    ctx.beginPath();
    ctx.arc(x + r * 0.72, y + r * 0.72, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  function bubbleShape(ctx, x, y, w, h) {
    var r = Math.min(30, h / 2);
    var tailY = HOST.y;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.lineTo(x, Math.min(y + h - r, tailY + 12));
    ctx.lineTo(x - 18, tailY);
    ctx.lineTo(x, Math.max(y + r, tailY - 12));
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Caption chunk spoken by the host, inside a chat bubble; "•••" between chunks. */
  function chatCaptions(ctx, project, item, t) {
    var state = captionState(item, t);
    var x = BUBBLE_LEFT;
    var maxW = BUBBLE_RIGHT_MAX - BUBBLE_LEFT;
    if (!state || project.captions === false) {
      var local = t - item.start;
      if (local > 0.05 && local < item.dur - 0.1) {
        // typing indicator
        var h0 = 76;
        ctx.fillStyle = "rgba(13,39,51,0.94)";
        bubbleShape(ctx, x, HOST.y - h0 / 2, 128, h0);
        ctx.fill();
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 2;
        ctx.stroke();
        for (var d = 0; d < 3; d++) {
          ctx.fillStyle = "rgba(244,247,248," + (0.3 + 0.7 * Math.abs(Math.sin(t * 6 + d * 0.9))) + ")";
          ctx.beginPath();
          ctx.arc(x + 36 + d * 28, HOST.y, 7.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    var words = state.text.split(/\s+/).filter(Boolean);
    var active = Math.min(words.length - 1, state.active);
    var padX = 34;
    var spacing = 14;
    var size = 54;
    var widths;
    var total;
    do {
      setFont(ctx, 800, size);
      widths = words.map(function (w) { return ctx.measureText(w).width; });
      total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (words.length - 1);
      size -= 2;
    } while (total + padX * 2 > maxW && size > 32);
    size += 2;
    var w = Math.min(maxW, total + padX * 2);
    var h = size * 1.9;
    var pop = easeOut(state.sinceStart / 0.14);
    ctx.save();
    ctx.translate(x, HOST.y);
    ctx.scale(0.96 + 0.04 * pop, 0.96 + 0.04 * pop);
    ctx.translate(-x, -HOST.y);
    ctx.fillStyle = "rgba(13,39,51,0.94)";
    bubbleShape(ctx, x, HOST.y - h / 2, w, h);
    ctx.fill();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    var cx = x + padX;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    words.forEach(function (word, i) {
      if (i === active) {
        ctx.fillStyle = C.yellow;
        roundRect(ctx, cx - 9, HOST.y - size * 0.62, widths[i] + 18, size * 1.24, size * 0.28);
        ctx.fill();
        ctx.fillStyle = C.dark;
      } else {
        ctx.fillStyle = C.ink;
      }
      ctx.fillText(word, cx, HOST.y + 3);
      cx += widths[i] + spacing;
    });
    ctx.restore();
    if (project.avatar && project.avatar.name) {
      setFont(ctx, 700, 24);
      ctx.fillStyle = C.mute;
      ctx.textAlign = "left";
      ctx.fillText(project.avatar.name, x + 6, HOST.y - h / 2 - 22);
    }
  }

  // ---------------------------------------------------------------- layouts
  var LAYOUTS = {};

  LAYOUTS.hook = function (ctx, scene, item, local, box) {
    var y = box.top;
    {
      if (scene.badge) {
        var pb = backOut(progress(local, 0, 0.35));
        ctx.save();
        ctx.globalAlpha *= pb;
        pill(ctx, scene.badge, W / 2, y + 40, { size: 32 });
        ctx.restore();
      }
      iconTile(ctx, scene.icon, W / 2, y + 260, 240, local, 0.12);
      y += scene.icon ? 480 : 220;
    }
    y = headline(ctx, scene.headline || "", y + 50, local, {
      size: box.faceBig ? 86 : 100,
      maxLines: box.faceBig ? 3 : 4,
      abTint: true
    });
    if (scene.value) {
      var v = countValue(scene, local, 0.4, 1.1);
      setFont(ctx, 800, 112);
      ctx.fillStyle = C.yellow;
      ctx.textAlign = "center";
      ctx.fillText(scene.prefix === "" ? Math.round(v).toLocaleString("id-ID") : formatRp(v), W / 2, y + 90);
      y += 160;
    }
    if (y + 40 < box.bottom) {
      subline(ctx, scene.sub, y + 40, local, 0.5);
    }
  };

  LAYOUTS.price = function (ctx, scene, item, local, box) {
    var pc = easeOut(progress(local, 0, 0.4));
    var rows = scene.rows || [];
    var top = box.top + 20;
    var h = 430 + rows.length * 108;
    ctx.save();
    ctx.globalAlpha *= pc;
    card(ctx, 72, top, W - 144, h, { radius: 48 });
    iconTile(ctx, scene.icon, 72 + 110, top + 110, 120, local, 0.1);
    if (scene.stamp) {
      var ps = backOut(progress(local, 1.6, 0.35));
      if (ps > 0) {
        setFont(ctx, 800, 30);
        var sw = ctx.measureText(scene.stamp).width + 40;
        ctx.save();
        ctx.translate(W - 72 - 40 - sw / 2, top + 110);
        ctx.scale(ps, ps);
        pill(ctx, scene.stamp, 0, 0, { size: 30, fill: C.b, color: C.dark });
        ctx.restore();
      }
    }
    var fit = fitWrapped(ctx, scene.headline || "", 700, 52, W - 260, 2, 34);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, top + 230 + i * fit.size * 1.2);
    });
    var bigText = scene.big != null ? String(scene.big) : formatRp(countValue(scene, local, 0.35, 1.3));
    ctx.save();
    ctx.globalAlpha *= scene.big != null ? easeOut(progress(local, 0.35, 0.4)) : 1;
    setFont(ctx, 800, 136);
    while (ctx.measureText(bigText).width > W - 260) {
      ctx.font = ctx.font.replace(/\d+px/, function (m) { return (parseInt(m, 10) - 6) + "px"; });
    }
    ctx.fillStyle = C.yellow;
    ctx.fillText(bigText, W / 2, top + 345 + (fit.lines.length - 1) * 30);
    ctx.restore();
    rows.forEach(function (row, i) {
      var p = easeOut(progress(local, 1.1 + i * 0.25, 0.35));
      var ry = top + 470 + (fit.lines.length - 1) * 30 + i * 108;
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate((1 - p) * 30, 0);
      ctx.fillStyle = C.surface2;
      roundRect(ctx, 120, ry - 42, W - 240, 84, 24);
      ctx.fill();
      setFont(ctx, 600, 36);
      ctx.fillStyle = C.soft;
      ctx.textAlign = "left";
      ctx.fillText(row.label, 156, ry + 2);
      setFont(ctx, 800, 38);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "right";
      ctx.fillText(row.value, W - 156, ry + 2);
      ctx.restore();
    });
    ctx.restore();
  };

  LAYOUTS.bars = function (ctx, scene, item, local, box) {
    var y = headline(ctx, scene.headline || "", box.top + 50, local, { size: 76, maxLines: 3 });
    y = subline(ctx, scene.sub, y + 10, local, 0.3) + 80;
    var bars = scene.bars || [];
    var max = Math.max.apply(null, bars.map(function (b) { return b.value; }).concat([1]));
    var barH = Math.min(120, (box.bottom - y) / Math.max(1, bars.length) - 80);
    var colors = [C.b, C.a];
    bars.forEach(function (bar, i) {
      var p = easeOut(progress(local, 0.6 + i * 0.35, 0.9));
      var by = y + i * (barH + 92);
      setFont(ctx, 700, 36);
      ctx.fillStyle = C.soft;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(bar.label, 96, by - 18);
      ctx.fillStyle = C.surface;
      roundRect(ctx, 96, by, W - 192, barH, barH / 2);
      ctx.fill();
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.stroke();
      var w = Math.max(barH, (W - 192) * (bar.value / max) * p);
      ctx.fillStyle = bar.hl ? C.yellow : colors[i % 2];
      roundRect(ctx, 96, by, w, barH, barH / 2);
      ctx.fill();
      setFont(ctx, 800, Math.min(52, barH * 0.46));
      ctx.textBaseline = "middle";
      var label = bar.display || String(bar.value);
      var lw = ctx.measureText(label).width;
      var inside = w > lw + 70;
      ctx.fillStyle = inside ? C.dark : C.ink;
      ctx.globalAlpha = clamp(p * 2, 0, 1);
      ctx.fillText(label, inside ? 96 + w - lw - 34 : 96 + w + 24, by + barH / 2 + 2);
      ctx.globalAlpha = 1;
    });
  };

  LAYOUTS.chat = function (ctx, scene, item, local, box) {
    var p0 = easeOut(progress(local, 0, 0.3));
    ctx.save();
    ctx.globalAlpha *= p0;
    pill(ctx, scene.headline || "", W / 2, box.top + 40, { size: 32, fill: C.surface2, color: C.ink, stroke: C.line });
    ctx.restore();
    var messages = scene.messages || [];
    var span = Math.max(1.2, item.voDur - 0.4);
    var y = box.top + 140;
    messages.forEach(function (m, i) {
      var appear = 0.25 + (span * i) / Math.max(1, messages.length);
      var mine = m.from !== "them";
      setFont(ctx, 600, 44);
      var lines = wrap(ctx, m.text, 620);
      var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 72;
      var h = lines.length * 58 + 48;
      if (local < appear - 0.45 || y + h > box.bottom) {
        return;
      }
      var x = mine ? W - 84 - w : 84;
      if (local < appear) {
        var tx = mine ? W - 84 - 150 : 84;
        ctx.fillStyle = mine ? "rgba(77,225,193,0.30)" : C.surface2;
        roundRect(ctx, tx, y, 150, 84, 42);
        ctx.fill();
        for (var d = 0; d < 3; d++) {
          ctx.fillStyle = "rgba(244,247,248," + (0.35 + 0.65 * Math.abs(Math.sin(local * 7 + d))) + ")";
          ctx.beginPath();
          ctx.arc(tx + 42 + d * 33, y + 42, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        y += 112;
        return;
      }
      var p = backOut(progress(local, appear, 0.3));
      ctx.save();
      ctx.translate(mine ? x + w : x, y + h);
      ctx.scale(p, p);
      ctx.translate(mine ? -w : 0, -h);
      ctx.fillStyle = mine ? C.a : C.surface2;
      roundRect(ctx, 0, 0, w, h, 34);
      ctx.fill();
      ctx.fillStyle = mine ? C.dark : C.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      lines.forEach(function (line, li) {
        ctx.fillText(line, 36, 52 + li * 58);
      });
      ctx.restore();
      y += h + 30;
    });
  };

  LAYOUTS.math = function (ctx, scene, item, local, box) {
    var y = headline(ctx, scene.headline || "", box.top + 50, local, { size: 70, maxLines: 2 }) + 50;
    var lines = scene.lines || [];
    var perLine = Math.max(0.6, (item.voDur * 0.45) / Math.max(1, lines.length));
    var cardH = lines.length * 110 + 50;
    var pc = easeOut(progress(local, 0.2, 0.35));
    ctx.save();
    ctx.globalAlpha *= pc;
    card(ctx, 72, y, W - 144, cardH, { radius: 40 });
    ctx.restore();
    lines.forEach(function (line, i) {
      var start = 0.4 + i * perLine;
      var p = easeOut(progress(local, start, 0.35));
      if (p <= 0) {
        return;
      }
      var ly = y + 80 + i * 110;
      var parts = line.split(/\s*=\s*/);
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate((1 - p) * 24, 0);
      var size = 46;
      setFont(ctx, 600, size);
      var label = parts.length > 1 ? parts.slice(0, -1).join(" = ") : line;
      var value = parts.length > 1 ? parts[parts.length - 1] : "";
      setFont(ctx, 800, size);
      var valueW = value ? ctx.measureText(value).width : 0;
      setFont(ctx, 600, size);
      while (ctx.measureText(label).width + valueW > W - 330 && size > 28) {
        size -= 2;
        setFont(ctx, 800, size);
        valueW = value ? ctx.measureText(value).width : 0;
        setFont(ctx, 600, size);
      }
      ctx.fillStyle = C.soft;
      ctx.textAlign = value ? "left" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, value ? 120 : W / 2, ly);
      if (value) {
        setFont(ctx, 800, size);
        ctx.fillStyle = C.ink;
        ctx.textAlign = "right";
        ctx.fillText(value, W - 120, ly);
      }
      if (i < lines.length - 1) {
        ctx.fillStyle = C.line;
        ctx.fillRect(120, ly + 55, W - 240, 2);
      }
      ctx.restore();
    });
    if (scene.result) {
      var rs = 0.4 + lines.length * perLine;
      var pr = backOut(progress(local, rs, 0.4));
      if (pr > 0) {
        var ry = y + cardH + 120;
        var fit = fitWrapped(ctx, scene.result, 800, 72, W - 260, 2, 40);
        var h = fit.lines.length * fit.size * 1.15 + 60;
        ctx.save();
        ctx.translate(W / 2, ry);
        ctx.scale(pr, pr);
        ctx.fillStyle = C.yellow;
        roundRect(ctx, -(W - 144) / 2, -h / 2, W - 144, h, 36);
        ctx.fill();
        setFont(ctx, 800, fit.size);
        ctx.fillStyle = C.dark;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        fit.lines.forEach(function (line, i) {
          ctx.fillText(line, 0, 4 + (i - (fit.lines.length - 1) / 2) * fit.size * 1.15);
        });
        ctx.restore();
      }
    }
    if (scene.sub) {
      subline(ctx, scene.sub, Math.min(box.bottom - 30, y + cardH + 260), local, 0.4 + lines.length * perLine + 0.4);
    }
  };

  LAYOUTS.stamp = function (ctx, scene, item, local, box) {
    var quote = scene.quote || scene.headline || "";
    var y = box.top;
    if (scene.icon) {
      iconTile(ctx, scene.icon, W / 2, y + 110, 180, local, 0.05);
      y += 260;
    } else {
      y += 120;
    }
    y = headline(ctx, quote, y + 30, local, { size: 88, maxLines: 4 });
    y = subline(ctx, scene.sub, y + 24, local, 0.5);
    if (scene.stamp) {
      // verdict chip: slides up with a check mark instead of a rubber stamp
      var ps = easeOut(progress(local, 0.9, 0.35));
      if (ps > 0) {
        var cy = Math.min(y + 110, box.bottom - 50);
        ctx.save();
        ctx.globalAlpha *= ps;
        ctx.translate(0, (1 - ps) * 30);
        setFont(ctx, 800, 40);
        var text = "✓  " + scene.stamp;
        var w = ctx.measureText(text).width + 70;
        ctx.fillStyle = "rgba(255,212,71,0.12)";
        roundRect(ctx, W / 2 - w / 2, cy - 44, w, 88, 44);
        ctx.fill();
        ctx.strokeStyle = C.yellow;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = C.yellow;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, W / 2, cy + 2);
        ctx.restore();
      }
    }
  };

  LAYOUTS.poll = function (ctx, scene, item, local, box) {
    var y = headline(ctx, scene.headline || "", box.top + 60, local, { size: 88, maxLines: 2 }) + 60;
    var options = scene.options || [];
    var colors = [C.a, C.b];
    var optionH = 190;
    // the "tap" cursor alternates between the options to invite a choice
    var cycle = (local - 1.2) % 2.4;
    var tapIndex = local > 1.2 ? (cycle < 1.2 ? 0 : 1) : -1;
    var tapPhase = local > 1.2 ? (cycle % 1.2) / 1.2 : 0;
    options.forEach(function (opt, i) {
      var p = easeOut(progress(local, 0.35 + i * 0.25, 0.45));
      var oy = y + i * (optionH + 36);
      var tapped = tapIndex === i && tapPhase > 0.35 && tapPhase < 0.7;
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate((1 - p) * (i ? 60 : -60), 0);
      if (tapped) {
        ctx.translate(W / 2, oy + optionH / 2);
        ctx.scale(0.98, 0.98);
        ctx.translate(-W / 2, -(oy + optionH / 2));
      }
      card(ctx, 72, oy, W - 144, optionH, {
        radius: 44,
        fill: tapped ? colors[i] : C.surface,
        stroke: colors[i],
        lineWidth: 3
      });
      ctx.fillStyle = tapped ? C.dark : colors[i];
      ctx.beginPath();
      ctx.arc(72 + 100, oy + optionH / 2, 52, 0, Math.PI * 2);
      ctx.fill();
      setFont(ctx, 800, 56);
      ctx.fillStyle = tapped ? colors[i] : C.dark;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i ? "B" : "A", 72 + 100, oy + optionH / 2 + 3);
      var label = String(opt).replace(/^[AB]\s*[—–-]\s*/, "");
      var fit = fitWrapped(ctx, label, 800, 50, W - 144 - 230, 2, 32);
      ctx.fillStyle = tapped ? C.dark : C.ink;
      ctx.textAlign = "left";
      fit.lines.forEach(function (line, li) {
        ctx.fillText(line, 72 + 186, oy + optionH / 2 + 3 + (li - (fit.lines.length - 1) / 2) * fit.size * 1.15);
      });
      ctx.restore();
    });
    if (tapIndex >= 0 && options.length) {
      var oyTap = y + tapIndex * (optionH + 36) + optionH / 2;
      var press = Math.sin(clamp((tapPhase - 0.2) / 0.6, 0, 1) * Math.PI);
      ctx.save();
      ctx.font = "96px " + EMOJI;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = clamp(tapPhase * 5, 0, 1) * clamp((1 - tapPhase) * 5, 0, 1);
      ctx.fillText("👆", W - 200, oyTap + 70 - press * 26);
      ctx.restore();
    }
    var pc = easeOut(progress(local, 1.0, 0.4));
    if (pc > 0 && scene.cta) {
      ctx.save();
      ctx.globalAlpha *= pc;
      var bob = Math.sin(local * 4) * 4;
      pill(ctx, scene.cta, W / 2, Math.min(box.bottom - 30, y + options.length * (optionH + 36) + 70) + bob, { size: 38 });
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- frame
  function drawClean(ctx, project, timeline, t, assets, SC) {
    applyPalette(project.palette);
    var item = SC.sceneAt(timeline, t);
    var scene = item.scene;
    var local = t - item.start;
    background(ctx, t);
    segments(ctx, timeline, t);

    var box = { top: CONTENT_TOP, bottom: CONTENT_BOTTOM, faceBig: false };
    var enter = easeOut(progress(local, 0, 0.35));
    var leave = item.index < timeline.scenes.length - 1 ? easeOut(progress(local, item.dur - 0.18, 0.18)) : 0;
    ctx.save();
    ctx.globalAlpha = enter * (1 - leave);
    ctx.translate(0, (1 - enter) * 50 - leave * 30);
    var layout = LAYOUTS[scene.layout] || LAYOUTS.hook;
    layout(ctx, scene, item, local, box);
    ctx.restore();
    ctx.globalAlpha = 1;

    header(ctx, project, false);
    if (project.avatar) {
      var speaking = !!captionState(item, t);
      chatCaptions(ctx, project, item, t);
      drawHost(ctx, project, item, t, speaking);
    } else {
      captions(ctx, project, item, t);
    }
    sourceLine(ctx, project, scene);
  }

  window.SC_TEMPLATES = window.SC_TEMPLATES || {};
  window.SC_TEMPLATES.clean = drawClean;
  window.SC_CLEAN_LAYOUTS = Object.keys(LAYOUTS);
})();
