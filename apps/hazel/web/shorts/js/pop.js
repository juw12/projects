/* Hazel Shorts template "pop" — bold, high-energy layouts for trend/explainer shorts.
 *
 * Each scene picks a layout with `scene.layout`:
 *   hook   — badge + giant punch headline (+ optional counting stat)
 *   price  — product + rolling price counter, variant rows, "stamp" sticker
 *   bars   — animated comparison bars  (scene.bars = [{label, value, display, hl}])
 *   chat   — chat bubbles that pop in   (scene.messages = [{from: "me"|"them", text}])
 *   math   — typed equation lines + highlighted result (scene.lines, scene.result)
 *   stamp  — big quote + rubber stamp that slams in (scene.quote, scene.stamp)
 *   poll   — A/B options + "comment A or B" call to action (scene.options)
 * Theme: project.palette overrides colours (bg1, bg2, yellow, pink, cyan, green, ...).
 * Shared layers: moving gradient background, top progress bar, brand pill,
 * word-by-word karaoke captions, and a source footnote (scene.source / project.source).
 * Registers itself in window.SC_TEMPLATES; engine.renderFrame dispatches to it.
 */
(function () {
  "use strict";

  var W = 1080;
  var H = 1920;
  var P = {
    bg1: "#140F2E",
    bg2: "#2A0E3D",
    ink: "#FFFFFF",
    soft: "rgba(255,255,255,0.72)",
    faint: "rgba(255,255,255,0.14)",
    yellow: "#FFE14D",
    pink: "#FF3D7F",
    cyan: "#3DDCFF",
    green: "#3DFF9A",
    card: "rgba(255,255,255,0.08)",
    black: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
    sans: "'Helvetica Neue', Arial, sans-serif"
  };


  // Per-project colour theme: project.palette = {bg1, bg2, yellow, pink, cyan, green, ...}
  // overrides the defaults above; reset on every frame so projects never leak into each other.
  var DEFAULT_P = Object.assign({}, P);
  var THEME_KEYS = ["bg1", "bg2", "ink", "soft", "faint", "yellow", "pink", "cyan", "green", "card"];

  function applyPalette(palette) {
    THEME_KEYS.forEach(function (key) {
      P[key] = palette && typeof palette[key] === "string" ? palette[key] : DEFAULT_P[key];
    });
  }

  // ---------------------------------------------------------------- helpers
  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function easeOut(x) {
    x = clamp(x, 0, 1);
    return 1 - Math.pow(1 - x, 3);
  }

  function backOut(x) {
    x = clamp(x, 0, 1);
    var c1 = 1.70158;
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
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setFont(ctx, weight, size, family) {
    ctx.font = weight + " " + Math.round(size) + "px " + family;
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

  /** Largest font size (<= maxSize) whose wrapped text fits maxLines lines. */
  function fitWrapped(ctx, text, family, weight, maxSize, maxWidth, maxLines, minSize) {
    var size = maxSize;
    var lines;
    while (size > (minSize || 40)) {
      setFont(ctx, weight, size, family);
      lines = wrap(ctx, text, maxWidth);
      var widest = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }));
      if (lines.length <= maxLines && widest <= maxWidth) {
        return { size: size, lines: lines };
      }
      size -= 4;
    }
    setFont(ctx, weight, size, family);
    return { size: size, lines: wrap(ctx, text, maxWidth) };
  }

  function sticker(ctx, text, x, y, size, fill, color, angle, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.scale(scale || 1, scale || 1);
    setFont(ctx, "900", size, P.black);
    var w = ctx.measureText(text).width + size * 1.1;
    var h = size * 1.7;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, -w / 2 + 8, -h / 2 + 10, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------- shared layers
  function background(ctx, t) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, P.bg1);
    g.addColorStop(1, P.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var blobs = [
      { c: "255,61,127", x: 200, y: 420, r: 520, sx: 0.31, sy: 0.23 },
      { c: "61,220,255", x: 900, y: 1250, r: 560, sx: 0.19, sy: 0.27 },
      { c: "255,225,77", x: 520, y: 1700, r: 380, sx: 0.23, sy: 0.17 }
    ];
    blobs.forEach(function (b, i) {
      var x = b.x + Math.sin(t * b.sx + i) * 120;
      var y = b.y + Math.cos(t * b.sy + i * 2) * 110;
      var rg = ctx.createRadialGradient(x, y, 10, x, y, b.r);
      rg.addColorStop(0, "rgba(" + b.c + ",0.30)");
      rg.addColorStop(1, "rgba(" + b.c + ",0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    });
  }

  function topBar(ctx, project, timeline, t) {
    ctx.fillStyle = P.faint;
    ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = P.yellow;
    ctx.fillRect(0, 0, W * clamp(t / timeline.total, 0, 1), 10);
    var brand = (project.kicker || "").toUpperCase();
    if (brand) {
      setFont(ctx, "900", 30, P.black);
      var w = ctx.measureText(brand).width + 56;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, 48, 56, w, 64, 32);
      ctx.fill();
      ctx.fillStyle = P.pink;
      ctx.beginPath();
      ctx.arc(80, 88, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = P.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(brand, 100, 90);
    }
    if (project.episode) {
      setFont(ctx, "700", 30, P.sans);
      ctx.fillStyle = P.soft;
      ctx.textAlign = "right";
      ctx.fillText(project.episode, W - 52, 90);
    }
  }

  function captionState(item, t) {
    // shared with the engine: real word timings when the clip was aligned (caption_timing.py)
    return window.SC.captionAt(item, t);
  }

  /** Word-by-word karaoke caption: active word gets a yellow block. */
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
    var pop = backOut(state.sinceStart / 0.18);
    var size = 74;
    setFont(ctx, "900", size, P.black);
    var spacing = 22;
    var widths = words.map(function (w) { return ctx.measureText(w).width; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (words.length - 1);
    while (total > W - 120 && size > 44) {
      size -= 4;
      setFont(ctx, "900", size, P.black);
      widths = words.map(function (w) { return ctx.measureText(w).width; });
      total = widths.reduce(function (a, b) { return a + b; }, 0) + spacing * (words.length - 1);
    }
    var y = 1560;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
    var x = -total / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    words.forEach(function (word, i) {
      if (i === active) {
        ctx.fillStyle = P.yellow;
        roundRect(ctx, x - 12, -size * 0.68, widths[i] + 24, size * 1.36, 16);
        ctx.fill();
        ctx.fillStyle = "#14102A";
      } else {
        ctx.lineWidth = 10;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(word, x, 4);
        ctx.fillStyle = P.ink;
      }
      ctx.fillText(word, x, 4);
      x += widths[i] + spacing;
    });
    ctx.restore();
  }

  function footnote(ctx, project, scene) {
    var source = scene.source || project.source;
    if (!source) {
      return;
    }
    setFont(ctx, "600", 26, P.sans);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sumber: " + source, W / 2, 1830);
  }

  function headline(ctx, text, y, local, opts) {
    opts = opts || {};
    var fit = fitWrapped(ctx, text, P.black, "900", opts.size || 96, W - 140, opts.maxLines || 3, 48);
    var lineH = fit.size * 1.12;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, i) {
      var p = backOut(progress(local, 0.05 + i * 0.1, 0.35));
      ctx.save();
      ctx.translate(W / 2, y + i * lineH);
      ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p);
      ctx.globalAlpha = clamp(p * 1.5, 0, 1);
      setFont(ctx, "900", fit.size, P.black);
      ctx.lineWidth = 12;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.strokeText(line, 0, 6);
      ctx.fillStyle = opts.color || P.ink;
      ctx.fillText(line, 0, 0);
      ctx.restore();
    });
    return y + fit.lines.length * lineH;
  }

  function subline(ctx, text, y, local, delay) {
    if (!text) {
      return y;
    }
    var p = easeOut(progress(local, delay || 0.35, 0.4));
    ctx.globalAlpha = p;
    var fit = fitWrapped(ctx, text, P.sans, "700", 46, W - 180, 2, 30);
    ctx.fillStyle = P.soft;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, y + i * fit.size * 1.25 + (1 - p) * 30);
    });
    ctx.globalAlpha = 1;
    return y + fit.lines.length * fit.size * 1.25;
  }

  function emoji(ctx, icon, x, y, size, local, delay) {
    if (!icon) {
      return;
    }
    var p = backOut(progress(local, delay || 0.2, 0.45));
    ctx.save();
    ctx.translate(x, y + Math.sin(local * 2.2) * 10);
    ctx.rotate(Math.sin(local * 1.6) * 0.08);
    ctx.scale(p, p);
    ctx.font = Math.round(size) + "px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(icon, 0, 0);
    ctx.restore();
  }

  function countValue(scene, local, delay, dur) {
    var p = easeOut(progress(local, delay, dur));
    return (scene.value || 0) * p;
  }

  // ---------------------------------------------------------------- layouts
  var LAYOUTS = {};

  LAYOUTS.hook = function (ctx, scene, item, local) {
    if (scene.badge) {
      var pb = backOut(progress(local, 0, 0.35));
      sticker(ctx, scene.badge, W / 2, 330, 40, P.pink, P.ink, -0.04, pb);
    }
    emoji(ctx, scene.icon, W / 2, 620, 230, local, 0.15);
    var y = headline(ctx, scene.headline || "", scene.icon ? 900 : 640, local, { size: 108, maxLines: 4 });
    if (scene.value) {
      var v = countValue(scene, local, 0.4, 1.1);
      var shake = local < 1.6 ? Math.sin(local * 60) * (1.6 - local) * 4 : 0;
      setFont(ctx, "900", 120, P.black);
      ctx.fillStyle = P.yellow;
      ctx.textAlign = "center";
      ctx.fillText(scene.prefix === "" ? Math.round(v).toLocaleString("id-ID") : formatRp(v), W / 2 + shake, y + 110);
      y += 180;
    }
    subline(ctx, scene.sub, y + 50, local, 0.5);
  };

  LAYOUTS.price = function (ctx, scene, item, local) {
    var pc = easeOut(progress(local, 0, 0.4));
    var cardY = 300 + (1 - pc) * 80;
    ctx.globalAlpha = pc;
    ctx.fillStyle = P.card;
    roundRect(ctx, 70, cardY, W - 140, 980, 48);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    emoji(ctx, scene.icon, W / 2, cardY + 170, 170, local, 0.1);
    var fit = fitWrapped(ctx, scene.headline || "", P.black, "900", 70, W - 260, 2, 40);
    ctx.fillStyle = P.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fit.lines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, cardY + 330 + i * fit.size * 1.15);
    });
    // `big` shows non-rupiah facts (e.g. "-30%"); otherwise count up `value` as Rp.
    var priceText = scene.big != null
      ? String(scene.big)
      : formatRp(countValue(scene, local, 0.35, 1.3));
    ctx.globalAlpha = scene.big != null ? easeOut(progress(local, 0.35, 0.4)) : 1;
    setFont(ctx, "900", 132, P.black);
    while (ctx.measureText(priceText).width > W - 220) {
      ctx.font = ctx.font.replace(/\d+px/, function (m) { return (parseInt(m, 10) - 6) + "px"; });
    }
    ctx.fillStyle = P.yellow;
    ctx.fillText(priceText, W / 2, cardY + 500);
    ctx.globalAlpha = 1;
    (scene.rows || []).forEach(function (row, i) {
      var p = easeOut(progress(local, 1.3 + i * 0.25, 0.35));
      var ry = cardY + 640 + i * 110;
      ctx.globalAlpha = p;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      roundRect(ctx, 130 + (1 - p) * -60, ry - 42, W - 260, 84, 24);
      ctx.fill();
      setFont(ctx, "700", 40, P.sans);
      ctx.fillStyle = P.soft;
      ctx.textAlign = "left";
      ctx.fillText(row.label, 170, ry);
      setFont(ctx, "900", 42, P.black);
      ctx.fillStyle = P.ink;
      ctx.textAlign = "right";
      ctx.fillText(row.value, W - 170, ry);
      ctx.globalAlpha = 1;
    });
    if (scene.stamp) {
      var ps = progress(local, 2.0, 0.25);
      if (ps > 0) {
        var s = 1 + (1 - backOut(ps)) * 1.6;
        sticker(ctx, scene.stamp, W - 300, cardY + 70, 44, P.pink, P.ink, 0.12, s);
      }
    }
  };

  LAYOUTS.bars = function (ctx, scene, item, local) {
    var y = headline(ctx, scene.headline || "", 330, local, { size: 78, maxLines: 3 });
    y = subline(ctx, scene.sub, y + 20, local, 0.3) + 70;
    var bars = scene.bars || [];
    var max = Math.max.apply(null, bars.map(function (b) { return b.value; }).concat([1]));
    var barH = Math.min(150, (1380 - y) / Math.max(1, bars.length) - 50);
    bars.forEach(function (bar, i) {
      var p = easeOut(progress(local, 0.6 + i * 0.35, 0.9));
      var by = y + i * (barH + 70);
      setFont(ctx, "800", 40, P.sans);
      ctx.fillStyle = P.soft;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(bar.label, 90, by - 14);
      ctx.fillStyle = P.faint;
      roundRect(ctx, 90, by, W - 180, barH, 22);
      ctx.fill();
      var w = Math.max(44, (W - 180) * (bar.value / max) * p);
      ctx.fillStyle = bar.hl ? P.yellow : (i % 2 ? P.cyan : P.pink);
      roundRect(ctx, 90, by, w, barH, 22);
      ctx.fill();
      setFont(ctx, "900", Math.min(56, barH * 0.5), P.black);
      ctx.textBaseline = "middle";
      var label = bar.display || String(bar.value);
      var lw = ctx.measureText(label).width;
      var inside = w > lw + 60;
      ctx.fillStyle = inside ? "#14102A" : P.ink;
      ctx.textAlign = "left";
      ctx.globalAlpha = clamp(p * 2, 0, 1);
      ctx.fillText(label, inside ? 90 + w - lw - 30 : 90 + w + 24, by + barH / 2 + 2);
      ctx.globalAlpha = 1;
    });
  };

  LAYOUTS.chat = function (ctx, scene, item, local) {
    var title = scene.headline || "";
    setFont(ctx, "900", 56, P.black);
    ctx.fillStyle = P.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = easeOut(progress(local, 0, 0.3));
    ctx.fillText(title, W / 2, 250);
    ctx.globalAlpha = 1;
    var messages = scene.messages || [];
    var span = Math.max(1.2, item.voDur - 0.4);
    var y = 360;
    messages.forEach(function (m, i) {
      var appear = 0.25 + (span * i) / Math.max(1, messages.length);
      var mine = m.from !== "them";
      setFont(ctx, "700", 46, P.sans);
      var lines = wrap(ctx, m.text, 600);
      var w = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; })) + 70;
      var h = lines.length * 60 + 44;
      if (local < appear - 0.45 || y + h > 1420) {
        return;
      }
      var x = mine ? W - 70 - w : 70;
      if (local < appear) {
        // typing indicator
        ctx.fillStyle = mine ? "rgba(61,220,255,0.35)" : "rgba(255,255,255,0.18)";
        roundRect(ctx, mine ? W - 70 - 170 : 70, y, 170, 90, 45);
        ctx.fill();
        for (var d = 0; d < 3; d++) {
          ctx.fillStyle = "rgba(255,255,255," + (0.4 + 0.6 * Math.abs(Math.sin(local * 8 + d))) + ")";
          ctx.beginPath();
          ctx.arc((mine ? W - 70 - 170 : 70) + 50 + d * 35, y + 45, 10, 0, Math.PI * 2);
          ctx.fill();
        }
        y += 120;
        return;
      }
      var p = backOut(progress(local, appear, 0.3));
      ctx.save();
      ctx.translate(mine ? x + w : x, y);
      ctx.scale(p, p);
      ctx.translate(mine ? -w : 0, 0);
      ctx.fillStyle = mine ? P.cyan : "rgba(255,255,255,0.92)";
      roundRect(ctx, 0, 0, w, h, 36);
      ctx.fill();
      ctx.fillStyle = "#14102A";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      lines.forEach(function (line, li) {
        ctx.fillText(line, 35, 52 + li * 60);
      });
      ctx.restore();
      y += h + 34;
    });
  };

  LAYOUTS.math = function (ctx, scene, item, local) {
    var y = headline(ctx, scene.headline || "", 300, local, { size: 72, maxLines: 2 }) + 70;
    var lines = scene.lines || [];
    var perLine = Math.max(0.6, (item.voDur * 0.45) / Math.max(1, lines.length));
    var mono = "'Menlo','Courier New',monospace";
    var lineSize = 72;
    setFont(ctx, "800", lineSize, mono);
    var widest = lines.reduce(function (max, line) {
      return Math.max(max, ctx.measureText(line).width);
    }, 0);
    if (widest > W - 120) {
      lineSize = Math.max(40, Math.floor(lineSize * (W - 120) / widest));
    }
    lines.forEach(function (line, i) {
      var start = 0.4 + i * perLine;
      var chars = Math.floor(line.length * progress(local, start, perLine * 0.7));
      if (chars <= 0) {
        return;
      }
      setFont(ctx, "800", lineSize, mono);
      ctx.fillStyle = P.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var shown = line.slice(0, chars);
      ctx.fillText(shown + (chars < line.length && Math.floor(local * 6) % 2 ? "▌" : ""), W / 2, y + i * 120);
    });
    if (scene.result) {
      var rs = 0.4 + lines.length * perLine;
      var p = backOut(progress(local, rs, 0.4));
      if (p > 0) {
        var ry = y + lines.length * 120 + 110;
        ctx.save();
        ctx.translate(W / 2, ry);
        ctx.scale(p, p);
        // fit the result on up to 2 lines; the pill grows with the text and never exceeds the frame
        var resultFit = fitWrapped(ctx, scene.result, P.black, "900", 100, W - 190, 2, 44);
        var lineGap = resultFit.size * 1.12;
        setFont(ctx, "900", resultFit.size, P.black);
        var textW = resultFit.lines.reduce(function (max, line) {
          return Math.max(max, ctx.measureText(line).width);
        }, 0);
        var w = Math.min(W - 80, textW + 90);
        var h = resultFit.lines.length * lineGap + 70;
        ctx.fillStyle = P.yellow;
        roundRect(ctx, -w / 2, -h / 2, w, h, 40);
        ctx.fill();
        ctx.fillStyle = "#14102A";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        resultFit.lines.forEach(function (line, i) {
          ctx.fillText(line, 0, 6 + (i - (resultFit.lines.length - 1) / 2) * lineGap);
        });
        ctx.restore();
      }
    }
    subline(ctx, scene.sub, 1360, local, 0.4 + lines.length * perLine + 0.4);
  };

  LAYOUTS.stamp = function (ctx, scene, item, local) {
    var quote = scene.quote || scene.headline || "";
    var top = scene.icon ? 760 : 600;
    var subH = scene.sub ? 2 * 46 * 1.25 : 0;
    var stampBottomLimit = 1360; // stamp centre; captions start ~1500
    var quoteSize = 104;
    while (quoteSize > 64) {
      var fit = fitWrapped(ctx, quote, P.black, "900", quoteSize, W - 140, 4, 48);
      var bottom = top + fit.lines.length * fit.size * 1.12 + 40 + subH + 150;
      if (bottom <= stampBottomLimit) {
        break;
      }
      quoteSize -= 8;
    }
    emoji(ctx, scene.icon, W / 2, 470, 200, local, 0.05);
    var y = headline(ctx, quote, top, local, { size: quoteSize, maxLines: 4, color: P.ink });
    y = subline(ctx, scene.sub, y + 40, local, 0.5);
    if (scene.stamp) {
      var ps = progress(local, 0.9, 0.22);
      if (ps > 0) {
        var s = 1 + (1 - easeOut(ps)) * 2.2;
        ctx.save();
        ctx.translate(W / 2, Math.min(y + 150, stampBottomLimit));
        ctx.rotate(-0.12);
        ctx.scale(s, s);
        ctx.globalAlpha = clamp(ps * 2, 0, 1);
        setFont(ctx, "900", 92, P.black);
        var w = ctx.measureText(scene.stamp).width + 80;
        ctx.strokeStyle = P.pink;
        ctx.lineWidth = 12;
        roundRect(ctx, -w / 2, -80, w, 160, 20);
        ctx.stroke();
        ctx.fillStyle = P.pink;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(scene.stamp, 0, 6);
        ctx.restore();
      }
    }
  };

  LAYOUTS.poll = function (ctx, scene, item, local) {
    var y = headline(ctx, scene.headline || "", 360, local, { size: 96, maxLines: 3 }) + 80;
    var options = scene.options || [];
    options.forEach(function (opt, i) {
      var p = easeOut(progress(local, 0.4 + i * 0.3, 0.45));
      var oy = y + i * 300;
      var fromX = i % 2 ? W : -W;
      ctx.save();
      ctx.translate((1 - p) * fromX, oy);
      var pulse = 1 + Math.sin(local * 5 + i * Math.PI) * 0.015;
      ctx.translate(W / 2, 110);
      ctx.scale(pulse, pulse);
      ctx.translate(-W / 2, -110);
      ctx.fillStyle = i ? "rgba(61,220,255,0.22)" : "rgba(255,61,127,0.25)";
      roundRect(ctx, 90, 0, W - 180, 220, 44);
      ctx.fill();
      ctx.strokeStyle = i ? P.cyan : P.pink;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = i ? P.cyan : P.pink;
      ctx.beginPath();
      ctx.arc(200, 110, 66, 0, Math.PI * 2);
      ctx.fill();
      setFont(ctx, "900", 72, P.black);
      ctx.fillStyle = "#14102A";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i ? "B" : "A", 200, 116);
      var fit = fitWrapped(ctx, opt, P.black, "900", 54, W - 420, 2, 34);
      ctx.fillStyle = P.ink;
      ctx.textAlign = "left";
      fit.lines.forEach(function (line, li) {
        ctx.fillText(line, 300, 110 + (li - (fit.lines.length - 1) / 2) * fit.size * 1.15);
      });
      ctx.restore();
    });
    var pc = backOut(progress(local, 1.3, 0.4));
    if (pc > 0 && scene.cta) {
      sticker(ctx, scene.cta, W / 2, y + options.length * 300 + 60, 44, P.yellow, "#14102A", 0.03, pc * (1 + Math.sin(local * 6) * 0.03));
    }
  };

  // ---------------------------------------------------------------- frame
  function drawPop(ctx, project, timeline, t, assets, SC) {
    applyPalette(project.palette);
    var item = SC.sceneAt(timeline, t);
    var scene = item.scene;
    var local = t - item.start;
    background(ctx, t);

    // whip-in transition: content slides up and settles
    var enter = easeOut(progress(local, 0, 0.28));
    ctx.save();
    ctx.translate(0, (1 - enter) * 140);
    ctx.globalAlpha = 0.25 + 0.75 * enter;
    var layout = LAYOUTS[scene.layout] || LAYOUTS.hook;
    layout(ctx, scene, item, local);
    ctx.restore();
    ctx.globalAlpha = 1;

    topBar(ctx, project, timeline, t);
    captions(ctx, project, item, t);
    footnote(ctx, project, scene);

    // white flash on scene cut
    if (item.index > 0 && local < 0.08) {
      ctx.fillStyle = "rgba(255,255,255," + (0.35 * (1 - local / 0.08)) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  window.SC_TEMPLATES = window.SC_TEMPLATES || {};
  window.SC_TEMPLATES.pop = drawPop;
  window.SC_POP_LAYOUTS = Object.keys(LAYOUTS);
})();
