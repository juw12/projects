/* Pips Phone Trail - trail engine + sticker renderer.
 * Port of productivity-widget/focus_trail.py build_trail (v2.27); see shared/trail-spec.md.
 */
(function (global) {
  "use strict";

  const STEP_DAY = 300;
  const STEP_WEEK = 900;
  const LENGTH = { productive: 1.0, neutral: 0.55, distracting: 0.0 };
  const CLOCK_START = -90.0;
  const CLOCK_SWEEP = 180.0;
  const SWITCH_TURN_MIN = 18.0;
  const SWITCH_TURN_RANGE = 62.0;
  const SWITCH_DECAY = 0.55;
  const LOOP_SUBSTEPS = 10;
  const LOOP_SIZE = 0.9;
  const LOOP_DRIFT = 0.35;
  const MIN_CHUNK = 30;
  const CATEGORIES = ["productive", "neutral", "distracting"];

  const rad = (deg) => (deg * Math.PI) / 180;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function chaikinTagged(points, tags, iterations) {
    for (let it = 0; it < iterations; it++) {
      if (points.length < 3) {
        break;
      }
      const smooth = [points[0]];
      const smoothTags = [tags[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        const tag = tags[i + 1];
        smooth.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
        smooth.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
        smoothTags.push(tag, tag);
      }
      smooth.push(points[points.length - 1]);
      smoothTags.push(tags[tags.length - 1]);
      points = smooth;
      tags = smoothTags;
    }
    return { points, tags };
  }

  /**
   * hours: [{hour, apps: [[app, seconds, category], ...] (largest first), label}]
   * returns {points, tags, markers}
   */
  function buildTrail(hours, stepSeconds, startHour, endHour) {
    let x = 0;
    let y = 0;
    const points = [[x, y]];
    const tags = ["productive"];
    const markers = [];
    const span = Math.max(1, endHour - startHour);
    let zig = 1;
    for (const block of hours) {
      const apps = block.apps;
      if (block.label) {
        markers.push([x, y, block.label]);
      }
      const hourTotal = apps.reduce((sum, a) => sum + a[1], 0) || 1;
      const topShare = apps.length ? Math.max(...apps.map((a) => a[1])) / hourTotal : 1.0;
      const split = 1.0 - topShare;
      const kink = SWITCH_TURN_MIN + SWITCH_TURN_RANGE * split;
      let elapsed = 0;
      let offset = 0.0;
      apps.forEach(([, seconds, rawCategory], index) => {
        const category = LENGTH.hasOwnProperty(rawCategory) ? rawCategory : "neutral";
        if (index > 0 && seconds >= MIN_CHUNK) {
          zig = -zig;
          offset = zig * kink;
        }
        let remaining = seconds;
        while (remaining >= MIN_CHUNK) {
          const chunk = Math.min(stepSeconds, remaining);
          remaining -= chunk;
          const share = chunk / stepSeconds;
          const clock = (block.hour - startHour + (elapsed + chunk / 2) / 3600) / span;
          elapsed += chunk;
          const heading = CLOCK_START + CLOCK_SWEEP * clamp01(clock) + offset;
          offset *= SWITCH_DECAY;
          if (category === "distracting") {
            const turn = (360.0 * share) / LOOP_SUBSTEPS;
            let loopHeading = heading - 90;
            for (let k = 0; k < LOOP_SUBSTEPS; k++) {
              loopHeading += turn;
              x += LOOP_SIZE * share * Math.cos(rad(loopHeading));
              y += LOOP_SIZE * share * Math.sin(rad(loopHeading));
              points.push([x, y]);
              tags.push(category);
            }
            x += LOOP_DRIFT * share * Math.cos(rad(heading));
            y += LOOP_DRIFT * share * Math.sin(rad(heading));
            points.push([x, y]);
            tags.push(category);
            continue;
          }
          const length = LENGTH[category] * share;
          x += length * Math.cos(rad(heading));
          y += length * Math.sin(rad(heading));
          points.push([x, y]);
          tags.push(category);
        }
      });
    }
    if (points.length < 2) {
      return { points: [], tags: [], markers };
    }
    const smooth = chaikinTagged(points, tags, 2);
    return { points: smooth.points, tags: smooth.tags, markers };
  }

  /** entries: [{app, hour, minutes, category}] -> hour blocks for buildTrail (day view). */
  function hoursFromEntries(entries, startHour, endHour) {
    const byHour = new Map();
    for (const e of entries) {
      const hour = Number(e.hour);
      const seconds = Math.round(Number(e.minutes) * 60);
      if (!(hour >= startHour && hour < endHour) || !(seconds > 0)) {
        continue;
      }
      if (!byHour.has(hour)) {
        byHour.set(hour, new Map());
      }
      const apps = byHour.get(hour);
      const key = (e.app || "?").trim() || "?";
      const prev = apps.get(key) || [key, 0, e.category || "neutral"];
      prev[1] += seconds;
      prev[2] = e.category || prev[2];
      apps.set(key, prev);
    }
    return [...byHour.keys()]
      .sort((a, b) => a - b)
      .map((hour) => ({
        hour,
        apps: [...byHour.get(hour).values()].sort((a, b) => b[1] - a[1]),
        label: hour % 2 === 0 ? String(hour).padStart(2, "0") + ":00" : null,
      }));
  }

  function summarize(hours) {
    const perApp = new Map();
    let screen = 0;
    let productive = 0;
    for (const block of hours) {
      for (const [app, seconds, category] of block.apps) {
        screen += seconds;
        if (category === "productive") {
          productive += seconds;
        }
        perApp.set(app, (perApp.get(app) || 0) + seconds);
      }
    }
    const topApps = [...perApp.entries()].sort((a, b) => b[1] - a[1]);
    return { screen, productive, topApps };
  }

  function fmtDuration(seconds) {
    const minutes = Math.round((seconds || 0) / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }

  // ------------------------------------------------------------------ drawing
  function hexRgb(hex) {
    const v = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  }

  function trailColors(accentHex) {
    const accent = hexRgb(accentHex);
    const tint = accent.map((c) => Math.round(c + (255 - c) * 0.55));
    return {
      productive: `rgba(${accent.join(",")},1)`,
      neutral: `rgba(${tint.join(",")},0.92)`,
      distracting: "rgba(150,150,160,0.88)",
    };
  }

  const WIDTH_SHARE = { productive: 1.0, neutral: 0.8, distracting: 0.55 };
  const FONT = '"Segoe UI", system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif';

  function text(ctx, x, y, str, size, weight, fill, align, shadow) {
    ctx.save();
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.75)";
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.06;
    }
    ctx.fillStyle = fill || "#fff";
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function drawTrail(ctx, trail, box, accentHex, width, labels) {
    const [x0, y0, x1, y1] = box;
    const { points, tags, markers } = trail;
    if (points.length < 2) {
      text(ctx, (x0 + x1) / 2, (y0 + y1) / 2, labels.noData, 44, 600, "rgba(255,255,255,0.8)", "center", true);
      return;
    }
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const k = Math.min((x1 - x0) / (maxX - minX || 1e-6), (y1 - y0) / (maxY - minY || 1e-6));
    const offX = (x0 + x1) / 2 - (k * (minX + maxX)) / 2;
    const offY = (y0 + y1) / 2 - (k * (minY + maxY)) / 2;
    const map = ([a, b]) => [offX + k * a, offY + k * b];
    const mapped = points.map(map);
    const colors = trailColors(accentHex);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // shadow under the whole route
    ctx.beginPath();
    mapped.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = width * 1.5;
    ctx.stroke();
    // coloured runs
    let i = 1;
    while (i < mapped.length) {
      const tag = tags[i];
      ctx.beginPath();
      ctx.moveTo(...mapped[i - 1]);
      while (i < mapped.length && tags[i] === tag) {
        ctx.lineTo(...mapped[i]);
        i++;
      }
      ctx.strokeStyle = colors[tag] || colors.neutral;
      ctx.lineWidth = Math.max(1, width * (WIDTH_SHARE[tag] || 0.8));
      ctx.stroke();
    }
    // time markers, label pushed away from the trail centre
    const cx = mapped.reduce((s, p) => s + p[0], 0) / mapped.length;
    const cy = mapped.reduce((s, p) => s + p[1], 0) / mapped.length;
    const size = Math.max(18, width * 1.5);
    for (const [mx, my, label] of markers) {
      const [px, py] = map([mx, my]);
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const lx = px + (dx / dist) * (width * 1.4 + size * 1.1);
      const ly = py + (dy / dist) * (width * 1.4 + size * 0.8);
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, width * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = Math.max(1, width * 0.19);
      ctx.strokeStyle = "#14141a";
      ctx.stroke();
      text(ctx, lx, ly, label, size, 700, "rgba(255,255,255,0.92)", "center", true);
    }
    // start + end dots
    const [sx, sy] = mapped[0];
    ctx.beginPath();
    ctx.arc(sx, sy, width * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.lineWidth = Math.max(1, width * 0.25);
    ctx.strokeStyle = "#19191e";
    ctx.stroke();
    const [ex, ey] = mapped[mapped.length - 1];
    ctx.beginPath();
    ctx.arc(ex, ey, width * 1.25, 0, Math.PI * 2);
    ctx.fillStyle = colors.productive;
    ctx.fill();
    ctx.lineWidth = Math.max(1, width * 0.35);
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(ctx, cx, cy, accentHex, tags, labels, size) {
    const present = CATEGORIES.filter((c) => tags.includes(c));
    if (present.length < 2) {
      return;
    }
    const colors = trailColors(accentHex);
    ctx.save();
    ctx.font = `600 ${size}px ${FONT}`;
    const swatch = size * 1.4;
    const gap = size * 0.5;
    const spacing = size * 1.3;
    const items = present.map((c) => [c, labels[c], ctx.measureText(labels[c]).width]);
    let total = items.reduce((s, it) => s + swatch + gap + it[2], 0) + spacing * (items.length - 1);
    let x = cx - total / 2;
    for (const [category, label, w] of items) {
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + swatch, cy);
      ctx.lineCap = "round";
      ctx.lineWidth = size * 0.32;
      ctx.strokeStyle = colors[category];
      ctx.stroke();
      text(ctx, x + swatch + gap, cy, label, size, 600, "rgba(255,255,255,0.86)", "left", true);
      x += swatch + gap + w + spacing;
    }
    ctx.restore();
  }

  /**
   * Draw the 1080x1350 sticker.
   * opts: {hours, startHour, endHour, pickups, accent, background: 'dark'|'transparent'|'photo',
   *        title, labels: {...}, stepSeconds}
   */
  function renderSticker(canvas, opts) {
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 1080, 1350);
    if (opts.background === "dark") {
      const g = ctx.createLinearGradient(0, 0, 0, 1350);
      g.addColorStop(0, "#1d1f26");
      g.addColorStop(1, "#0d0e12");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1080, 1350);
    }
    const L = opts.labels;
    const trail = buildTrail(opts.hours, opts.stepSeconds || STEP_DAY, opts.startHour, opts.endHour);
    const sum = summarize(opts.hours);
    const columns = [
      [L.screen, fmtDuration(sum.screen)],
      [L.productive, fmtDuration(sum.productive)],
      [L.pickups, opts.pickups ? String(opts.pickups) : "-"],
    ];
    columns.forEach(([label, value], index) => {
      const x = 180 + index * 360;
      text(ctx, x, 95, label, 34, 400, "rgba(255,255,255,0.94)", "center", true);
      text(ctx, x, 168, value, 74, 900, "#fff", "center", true);
    });
    drawTrail(ctx, trail, [130, 280, 950, 1040], opts.accent, 16, L);
    drawLegend(ctx, 540, 1105, opts.accent, trail.tags, L, 28);
    const key = [L.keyStraight, L.keyKinks];
    if (trail.tags.includes("distracting")) {
      key.push(L.keyLoops);
    }
    text(ctx, 540, 1150, key.join("  ·  "), 26, 600, "rgba(255,255,255,0.8)", "center", true);
    text(ctx, 540, 1218, "PIPS · PHONE TRAIL", 44, 900, opts.accent, "center", true);
    const footer = [opts.title];
    if (sum.topApps.length) {
      footer.push(L.top.replace("{app}", sum.topApps[0][0]));
    }
    text(ctx, 540, 1274, footer.join("  ·  "), 32, 600, "#fff", "center", true);
    return { trail, summary: sum };
  }

  global.PipsTrail = {
    STEP_DAY,
    STEP_WEEK,
    buildTrail,
    hoursFromEntries,
    summarize,
    fmtDuration,
    trailColors,
    renderSticker,
  };
})(typeof window !== "undefined" ? window : globalThis);
