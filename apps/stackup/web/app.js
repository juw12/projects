/* Stackup — UI layer. All math lives in stackup-core.js. Offline-first, no dependencies. */
(function () {
  "use strict";

  var Core = window.StackupCore;
  var STORE_KEY = "stackup.v1";
  var THEME_KEY = "stackup.theme";
  var MC_SEED_KEY = "stackup.mcseed";

  var els = {};
  var state = null;
  var mcTimer = null;
  var lastAnalysis = null;
  var lastMc = null;

  // ---------- helpers ----------
  function $(id) {
    return document.getElementById(id);
  }

  function uid() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function freshPresets() {
    return Core.PRESETS.map(function (preset) {
      var copy = clone(preset);
      copy.id = uid();
      return copy;
    });
  }

  function decimals() {
    return active().units === "in" ? 4 : 3;
  }

  function fmt(value, places) {
    if (value === null || value === undefined || isNaN(value)) {
      return "\u2014";
    }
    if (value === Infinity) {
      return "\u221e";
    }
    if (value === -Infinity) {
      return "-\u221e";
    }
    return Number(value).toFixed(places === undefined ? decimals() : places);
  }

  function fmtPpm(ppm) {
    if (ppm === null || ppm === undefined) {
      return "\u2014";
    }
    if (ppm < 0.01) {
      return "< 0.01 ppm";
    }
    if (ppm >= 10000) {
      return (ppm / 10000).toFixed(2) + " %";
    }
    return Number(ppm.toPrecision(3)) + " ppm";
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 2200);
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stack";
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- state ----------
  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && Array.isArray(saved.stacks) && saved.stacks.length) {
        return saved;
      }
    } catch (err) {
      /* fall through to defaults */
    }
    var stacks = freshPresets();
    return { stacks: stacks, activeId: stacks[0].id };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      toast("Could not save locally (storage full or blocked)");
    }
  }

  function active() {
    var found = state.stacks.filter(function (s) {
      return s.id === state.activeId;
    })[0];
    if (!found) {
      found = state.stacks[0];
      state.activeId = found.id;
    }
    return found;
  }

  function blankContributor(n) {
    return { label: "Dimension " + n, part: "", nominal: 0, tolPlus: 0.05, tolMinus: 0.05, sens: 1, dist: "normal", k: 3 };
  }

  function addStack(stack, message) {
    stack.id = uid();
    state.stacks.push(stack);
    state.activeId = stack.id;
    save();
    renderAll();
    if (message) {
      toast(message);
    }
  }

  // ---------- rendering: picker + setup ----------
  function renderPicker() {
    els.stackSelect.innerHTML = "";
    state.stacks.forEach(function (stack) {
      var option = document.createElement("option");
      option.value = stack.id;
      option.textContent = stack.name || "Untitled stack";
      option.selected = stack.id === state.activeId;
      els.stackSelect.appendChild(option);
    });
  }

  function renderSetup() {
    var s = active();
    els.stackName.value = s.name || "";
    els.units.value = s.units === "in" ? "in" : "mm";
    els.lsl.value = s.lsl === null || s.lsl === undefined ? "" : s.lsl;
    els.usl.value = s.usl === null || s.usl === undefined ? "" : s.usl;
    els.targetCpk.value = s.targetCpk || 1.33;
    els.description.value = s.description || "";
    els.samples.value = String(s.samples || 50000);
    els.printTitle.textContent = s.name || "Untitled stack";
    els.printDate.textContent = new Date().toLocaleString();
  }

  // ---------- rendering: contributors ----------
  var COLUMNS = [
    { field: "label", label: "Dimension", type: "text", cls: "wide" },
    { field: "part", label: "Part / source", type: "text", cls: "wide" },
    { field: "nominal", label: "Nominal", type: "number", cls: "num-col" },
    { field: "tolPlus", label: "Tol +", type: "number", cls: "num-col" },
    { field: "tolMinus", label: "Tol \u2212", type: "number", cls: "num-col" },
    { field: "sens", label: "Sens.", type: "number", cls: "sens-col" },
    { field: "dist", label: "Distribution", type: "select", cls: "dist-col" },
    { field: "k", label: "k (\u03c3 at tol)", type: "number", cls: "k-col" }
  ];

  function renderTable() {
    var s = active();
    els.contribBody.innerHTML = "";
    s.contributors.forEach(function (c, index) {
      var tr = document.createElement("tr");
      var idx = document.createElement("td");
      idx.className = "idx";
      idx.textContent = String(index + 1);
      tr.appendChild(idx);

      COLUMNS.forEach(function (col) {
        var td = document.createElement("td");
        td.className = col.cls;
        td.setAttribute("data-label", col.label);
        var input;
        if (col.type === "select") {
          input = document.createElement("select");
          Object.keys(Core.DISTRIBUTIONS).forEach(function (key) {
            var option = document.createElement("option");
            option.value = key;
            option.textContent = Core.DISTRIBUTIONS[key].label;
            option.selected = c.dist === key;
            input.appendChild(option);
          });
        } else {
          input = document.createElement("input");
          input.type = col.type;
          if (col.type === "number") {
            input.step = "any";
            input.inputMode = "decimal";
          }
          input.value = c[col.field] === undefined || c[col.field] === null ? "" : c[col.field];
        }
        input.setAttribute("aria-label", col.label + " row " + (index + 1));
        input.dataset.field = col.field;
        input.dataset.index = String(index);
        if (col.field === "k" && c.dist !== "normal") {
          input.disabled = true;
          input.title = "k only applies to normal distributions";
        }
        td.appendChild(input);
        tr.appendChild(td);
      });

      var share = document.createElement("td");
      share.className = "share-cell";
      share.setAttribute("data-label", "Var. share");
      share.id = "share-" + index;
      tr.appendChild(share);

      var actions = document.createElement("td");
      actions.className = "row-actions";
      actions.setAttribute("data-label", " ");
      [["up", "\u2191", "Move up"], ["down", "\u2193", "Move down"], ["copy", "\u29c9", "Duplicate row"], ["del", "\u2715", "Delete row"]].forEach(function (spec) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn ghost" + (spec[0] === "del" ? " danger" : "");
        button.textContent = spec[1];
        button.title = spec[2];
        button.setAttribute("aria-label", spec[2] + " " + (index + 1));
        button.dataset.action = spec[0];
        button.dataset.index = String(index);
        actions.appendChild(button);
      });
      tr.appendChild(actions);
      els.contribBody.appendChild(tr);
    });
  }

  // ---------- results ----------
  function kpi(label, value, sub, tone) {
    var box = document.createElement("div");
    box.className = "kpi" + (tone ? " " + tone : "");
    var l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("div");
    v.className = "value";
    v.textContent = value;
    box.appendChild(l);
    box.appendChild(v);
    if (sub) {
      var s = document.createElement("div");
      s.className = "sub";
      s.textContent = sub;
      box.appendChild(s);
    }
    return box;
  }

  function renderVerdict(a) {
    var s = a.stack;
    var title;
    var body;
    var cpkText = fmt(a.cpk, 2);
    if (a.verdict === "pass-wc") {
      title = "PASS \u2014 worst case";
      body = "Every worst-case combination stays inside the spec. No statistical assumption needed.";
    } else if (a.verdict === "pass-stat") {
      title = "PASS (statistical) \u2014 worst case exceeds spec";
      body = "Cpk " + cpkText + " \u2265 target " + s.targetCpk + ", but worst case reaches " + fmt(a.wcMin) + " \u2026 " + fmt(a.wcMax) + " " + s.units + ". Only valid if each part process is capable and centred \u2014 confirm with FAI / Cpk data.";
    } else if (a.verdict === "fail") {
      title = "FAIL \u2014 Cpk " + cpkText + " < target " + s.targetCpk;
      body = "Expect about " + fmtPpm(a.ppm) + " out of spec (normal model). Use the biggest lever below to recover margin.";
    } else {
      title = "No spec limits";
      body = "Enter a lower and/or upper spec limit to judge this stack.";
    }
    els.verdict.className = "verdict " + a.verdict;
    els.verdict.innerHTML = "";
    var strong = document.createElement("strong");
    strong.textContent = title;
    var span = document.createElement("span");
    span.textContent = body;
    els.verdict.appendChild(strong);
    els.verdict.appendChild(span);
  }

  function renderKpis(a) {
    var s = a.stack;
    var u = " " + s.units;
    var cpkTone = a.cpk === null ? "" : a.cpk >= s.targetCpk ? "good" : a.cpk >= 1 ? "warn" : "bad";
    els.kpis.innerHTML = "";
    els.kpis.appendChild(kpi("Nominal gap", fmt(a.nominalGap) + u, "mean incl. asym. tol: " + fmt(a.mean)));
    els.kpis.appendChild(kpi("Worst case", fmt(a.wcMin) + " \u2026 " + fmt(a.wcMax), "\u00b1" + fmt(a.wcHalf) + u, a.verdict === "nospec" ? "" : a.wcPass ? "good" : "bad"));
    els.kpis.appendChild(kpi("RSS \u00b13\u03c3", fmt(a.rssMin) + " \u2026 " + fmt(a.rssMax), "\u03c3 = " + fmt(a.sigma, decimals() + 1) + u));
    els.kpis.appendChild(kpi("Cpk (target " + s.targetCpk + ")", fmt(a.cpk, 2), a.cp === null ? "one-sided spec" : "Cp " + fmt(a.cp, 2), cpkTone));
    els.kpis.appendChild(kpi("Predicted out of spec", fmtPpm(a.ppm), "normal model of the RSS result"));
    var mcBox = kpi("Monte Carlo out of spec", lastMc ? fmtPpm(lastMc.outFraction * 1e6) : "running\u2026", lastMc ? lastMc.samples.toLocaleString() + " runs \u00b7 \u03c3 " + fmt(lastMc.std, decimals() + 1) : "");
    mcBox.id = "mcKpi";
    els.kpis.appendChild(mcBox);
  }

  function renderPareto(a) {
    els.pareto.innerHTML = "";
    var rows = a.rows.map(function (row, index) {
      return { row: row, index: index };
    }).sort(function (x, y) {
      return y.row.varShare - x.row.varShare;
    });
    rows.forEach(function (item) {
      var r = item.row;
      var line = document.createElement("div");
      line.className = "pareto-row";
      var name = document.createElement("div");
      name.className = "name";
      name.textContent = (item.index + 1) + ". " + r.contributor.label;
      name.title = r.contributor.label + (r.contributor.part ? " \u2014 " + r.contributor.part : "");
      var track = document.createElement("div");
      track.className = "track";
      var fill = document.createElement("div");
      fill.className = "fill";
      fill.style.width = (r.varShare * 100).toFixed(1) + "%";
      track.appendChild(fill);
      var pct = document.createElement("div");
      pct.className = "pct";
      pct.textContent = (r.varShare * 100).toFixed(1) + "%";
      line.appendChild(name);
      line.appendChild(track);
      line.appendChild(pct);
      els.pareto.appendChild(line);
    });
    a.rows.forEach(function (row, index) {
      var cell = $("share-" + index);
      if (cell) {
        cell.textContent = (row.varShare * 100).toFixed(1) + "%";
      }
    });
  }

  function renderInsight(a) {
    var s = a.stack;
    var parts = [];
    if (a.lever && a.cpk !== null) {
      var c = a.lever.contributor;
      parts.push(
        "Biggest lever: \u201c" + c.label + "\u201d" + (c.part ? " (" + c.part + ")" : "") +
        " drives " + (a.lever.varShare * 100).toFixed(0) + "% of the variance. Halving its tolerance moves Cpk from " +
        fmt(a.cpk, 2) + " to " + fmt(a.lever.cpkIfHalved, 2) + "."
      );
    } else if (a.lever) {
      parts.push("Biggest lever: \u201c" + a.lever.contributor.label + "\u201d drives " + (a.lever.varShare * 100).toFixed(0) + "% of the variance.");
    }
    if (s.lsl !== null && s.usl !== null && a.sigma > 0) {
      var centre = (s.lsl + s.usl) / 2;
      var offset = a.mean - centre;
      if (Math.abs(offset) > 0.05 * (s.usl - s.lsl)) {
        parts.push(
          "The mean sits " + fmt(Math.abs(offset)) + " " + s.units + (offset > 0 ? " above" : " below") +
          " the spec centre. Re-centring a nominal by " + fmt(-offset) + " " + s.units + " would raise Cpk to " + fmt(a.cp, 2) + " with no tolerance change."
        );
      }
    }
    if (lastMc && a.ppm !== null && a.ppm > 1) {
      var ratio = (lastMc.outFraction * 1e6) / a.ppm;
      var hasNonNormal = a.rows.some(function (r) {
        return r.contributor.dist !== "normal";
      });
      if (hasNonNormal && (ratio < 0.7 || ratio > 1.4)) {
        parts.push("Monte Carlo and the normal estimate differ because some contributors are not normal \u2014 trust Monte Carlo for the tails.");
      }
    }
    els.insight.textContent = parts.join(" ") || "Add contributors to see where the variation comes from.";
  }

  // ---------- canvases ----------
  function prepCanvas(canvas) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(200, rect.width);
    var height = Math.max(100, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx: ctx, w: width, h: height };
  }

  function vline(ctx, x, top, bottom, color, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawHistogram(a, mc) {
    var c = prepCanvas(els.histCanvas);
    var ctx = c.ctx;
    var pad = { l: 10, r: 10, t: 12, b: 26 };
    var s = a.stack;
    var lo = Math.min(mc.histogram.lo, a.wcMin);
    var hi = Math.max(mc.histogram.hi, a.wcMax);
    if (s.lsl !== null) {
      lo = Math.min(lo, s.lsl);
      hi = Math.max(hi, s.lsl);
    }
    if (s.usl !== null) {
      lo = Math.min(lo, s.usl);
      hi = Math.max(hi, s.usl);
    }
    var span = hi - lo || 1;
    lo -= span * 0.05;
    hi += span * 0.05;
    function X(value) {
      return pad.l + ((value - lo) / (hi - lo)) * (c.w - pad.l - pad.r);
    }
    var maxCount = Math.max.apply(null, mc.histogram.counts) || 1;
    var plotH = c.h - pad.t - pad.b;
    ctx.fillStyle = cssVar("--bar");
    ctx.globalAlpha = 0.85;
    mc.histogram.counts.forEach(function (count, i) {
      var x0 = X(mc.histogram.lo + i * mc.histogram.width);
      var x1 = X(mc.histogram.lo + (i + 1) * mc.histogram.width);
      var barH = (count / maxCount) * plotH;
      ctx.fillRect(x0, pad.t + plotH - barH, Math.max(1, x1 - x0 - 1), barH);
    });
    ctx.globalAlpha = 1;
    var baseY = pad.t + plotH;
    ctx.strokeStyle = cssVar("--line");
    ctx.beginPath();
    ctx.moveTo(pad.l, baseY);
    ctx.lineTo(c.w - pad.r, baseY);
    ctx.stroke();
    vline(ctx, X(a.wcMin), pad.t, baseY, cssVar("--warn"), [3, 4]);
    vline(ctx, X(a.wcMax), pad.t, baseY, cssVar("--warn"), [3, 4]);
    vline(ctx, X(a.mean), pad.t, baseY, cssVar("--text"), [1, 3]);
    if (s.lsl !== null) {
      vline(ctx, X(s.lsl), pad.t, baseY, cssVar("--fail"), [7, 4]);
    }
    if (s.usl !== null) {
      vline(ctx, X(s.usl), pad.t, baseY, cssVar("--fail"), [7, 4]);
    }
    ctx.fillStyle = cssVar("--muted");
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    for (var t = 0; t <= 4; t++) {
      var value = lo + ((hi - lo) * t) / 4;
      var x = X(value);
      ctx.fillText(fmt(value), Math.min(c.w - 28, Math.max(28, x)), c.h - 8);
    }
  }

  function drawLoop(a) {
    var c = prepCanvas(els.loopCanvas);
    var ctx = c.ctx;
    var rows = a.rows;
    if (!rows.length) {
      return;
    }
    var positions = [0];
    rows.forEach(function (row) {
      positions.push(positions[positions.length - 1] + row.contributor.sens * row.mean);
    });
    var lo = Math.min.apply(null, positions);
    var hi = Math.max.apply(null, positions);
    var span = hi - lo || 1;
    var pad = { l: 14, r: 14, t: 10, b: 10 };
    var lanes = rows.length + 1;
    var laneH = Math.max(8, (c.h - pad.t - pad.b) / lanes);
    function X(value) {
      return pad.l + ((value - lo) / span) * (c.w - pad.l - pad.r);
    }
    function arrow(x0, x1, y, color, width) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      var dir = x1 >= x0 ? 1 : -1;
      if (Math.abs(x1 - x0) < 2) {
        ctx.beginPath();
        ctx.arc(x1, y, 3, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x1 - dir * 7, y - 4);
      ctx.lineTo(x1 - dir * 7, y + 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = "11px system-ui, sans-serif";
    rows.forEach(function (row, i) {
      var y = pad.t + laneH * (i + 0.5);
      var x0 = X(positions[i]);
      var x1 = X(positions[i + 1]);
      var color = row.contributor.sens >= 0 ? cssVar("--pass") : cssVar("--fail");
      ctx.globalAlpha = 0.35;
      vline(ctx, x1, y, pad.t + laneH * lanes, cssVar("--muted"), [2, 3]);
      ctx.globalAlpha = 1;
      arrow(x0, x1, y, color, 2);
      ctx.fillStyle = cssVar("--muted");
      var label = (i + 1) + "";
      ctx.textAlign = x1 >= x0 ? "left" : "right";
      ctx.fillText(label, x1 + (x1 >= x0 ? 6 : -6), y + 4);
    });
    var gy = pad.t + laneH * (lanes - 0.5);
    arrow(X(0), X(positions[positions.length - 1]), gy, cssVar("--accent"), 3);
    ctx.fillStyle = cssVar("--accent");
    ctx.textAlign = "center";
    ctx.fillText("gap " + fmt(a.mean), (X(0) + X(positions[positions.length - 1])) / 2, gy - 6);
  }

  // ---------- compute ----------
  function recompute(options) {
    var a = Core.analyze(active());
    lastAnalysis = a;
    if (!options || !options.keepMc) {
      lastMc = null;
    }
    renderVerdict(a);
    renderKpis(a);
    renderPareto(a);
    renderInsight(a);
    drawLoop(a);
    scheduleMonteCarlo();
  }

  function scheduleMonteCarlo() {
    clearTimeout(mcTimer);
    mcTimer = setTimeout(runMonteCarlo, 180);
  }

  function runMonteCarlo() {
    var s = active();
    if (!s.contributors.length) {
      return;
    }
    var seed = Number(sessionStorage.getItem(MC_SEED_KEY)) || s.seed || 12345;
    lastMc = Core.monteCarlo(s, { samples: Number(els.samples.value) || 50000, seed: seed });
    renderKpis(lastAnalysis);
    renderInsight(lastAnalysis);
    drawHistogram(lastAnalysis, lastMc);
  }

  function renderAll() {
    renderPicker();
    renderSetup();
    renderTable();
    recompute();
  }

  // ---------- events ----------
  function onSetupInput(event) {
    var s = active();
    var target = event.target;
    if (target === els.stackName) {
      s.name = target.value;
      els.printTitle.textContent = s.name;
      var option = els.stackSelect.querySelector('option[value="' + s.id + '"]');
      if (option) {
        option.textContent = s.name || "Untitled stack";
      }
    } else if (target === els.units) {
      s.units = target.value;
    } else if (target === els.lsl) {
      s.lsl = target.value === "" ? null : Number(target.value);
    } else if (target === els.usl) {
      s.usl = target.value === "" ? null : Number(target.value);
    } else if (target === els.targetCpk) {
      s.targetCpk = Number(target.value) || 1.33;
    } else if (target === els.description) {
      s.description = target.value;
    } else if (target === els.samples) {
      s.samples = Number(target.value);
    } else {
      return;
    }
    save();
    recompute();
  }

  function onTableInput(event) {
    var target = event.target;
    var field = target.dataset.field;
    if (!field) {
      return;
    }
    var row = active().contributors[Number(target.dataset.index)];
    if (!row) {
      return;
    }
    if (target.type === "number") {
      row[field] = target.value === "" ? 0 : Number(target.value);
    } else {
      row[field] = target.value;
    }
    if (field === "dist") {
      var kInput = target.closest("tr").querySelector('[data-field="k"]');
      kInput.disabled = target.value !== "normal";
    }
    save();
    recompute();
  }

  function onTableClick(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    var list = active().contributors;
    var index = Number(button.dataset.index);
    var action = button.dataset.action;
    if (action === "del") {
      list.splice(index, 1);
    } else if (action === "copy") {
      list.splice(index + 1, 0, clone(list[index]));
    } else if (action === "up" && index > 0) {
      list.splice(index - 1, 0, list.splice(index, 1)[0]);
    } else if (action === "down" && index < list.length - 1) {
      list.splice(index + 1, 0, list.splice(index, 1)[0]);
    } else {
      return;
    }
    save();
    renderTable();
    recompute();
  }

  function encodeShare(stack) {
    var json = JSON.stringify(stack);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeShare(text) {
    var b64 = text.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) {
      b64 += "=";
    }
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }

  function shareableStack() {
    var s = Core.normalizeStack(active());
    delete s.id;
    s.contributors.forEach(function (c) {
      delete c.id;
    });
    return s;
  }

  function importStacks(data) {
    var list = Array.isArray(data) ? data : data && Array.isArray(data.stacks) ? data.stacks : [data];
    var added = 0;
    list.forEach(function (raw) {
      if (!raw || !Array.isArray(raw.contributors)) {
        return;
      }
      var stack = Core.normalizeStack(raw);
      stack.id = uid();
      state.stacks.push(stack);
      state.activeId = stack.id;
      added++;
    });
    if (!added) {
      toast("No stacks found in that file");
      return;
    }
    save();
    renderAll();
    toast("Imported " + added + " stack" + (added > 1 ? "s" : ""));
  }

  function bind() {
    els.stackSelect.addEventListener("change", function () {
      state.activeId = els.stackSelect.value;
      save();
      renderAll();
    });
    els.newBtn.addEventListener("click", function () {
      addStack({ name: "New stack", units: "mm", lsl: 0, usl: null, targetCpk: 1.33, samples: 50000, seed: 12345, contributors: [blankContributor(1), blankContributor(2)] }, "New stack created");
      els.stackName.focus();
      els.stackName.select();
    });
    els.dupBtn.addEventListener("click", function () {
      var copy = clone(active());
      copy.name = copy.name + " (copy)";
      addStack(copy, "Stack duplicated");
    });
    els.delBtn.addEventListener("click", function () {
      if (!window.confirm("Delete \u201c" + active().name + "\u201d? This cannot be undone.")) {
        return;
      }
      state.stacks = state.stacks.filter(function (s) {
        return s.id !== state.activeId;
      });
      if (!state.stacks.length) {
        state.stacks = freshPresets();
      }
      state.activeId = state.stacks[0].id;
      save();
      renderAll();
      toast("Stack deleted");
    });
    els.presetSelect.addEventListener("change", function () {
      var preset = Core.PRESETS.filter(function (p) {
        return p.id === els.presetSelect.value;
      })[0];
      els.presetSelect.value = "";
      if (preset) {
        addStack(clone(preset), "Example loaded: " + preset.name);
      }
    });
    els.addRowBtn.addEventListener("click", function () {
      var list = active().contributors;
      list.push(blankContributor(list.length + 1));
      save();
      renderTable();
      recompute();
      var inputs = els.contribBody.querySelectorAll('input[data-field="label"]');
      if (inputs.length) {
        inputs[inputs.length - 1].focus();
        inputs[inputs.length - 1].select();
      }
    });
    els.setup.addEventListener("input", onSetupInput);
    els.samples.addEventListener("change", onSetupInput);
    els.contribBody.addEventListener("input", onTableInput);
    els.contribBody.addEventListener("change", onTableInput);
    els.contribBody.addEventListener("click", onTableClick);
    els.rerunBtn.addEventListener("click", function () {
      sessionStorage.setItem(MC_SEED_KEY, String(Math.floor(Math.random() * 1e9)));
      runMonteCarlo();
      toast("Monte Carlo re-run with a new seed");
    });
    els.exportJsonBtn.addEventListener("click", function () {
      download(slug(active().name) + ".stackup.json", JSON.stringify(shareableStack(), null, 2), "application/json");
    });
    els.exportCsvBtn.addEventListener("click", function () {
      download(slug(active().name) + ".csv", Core.toCsv(active()), "text/csv");
      toast("CSV saved \u2014 opens in Excel or Google Sheets");
    });
    els.importBtn.addEventListener("click", function () {
      els.importFile.click();
    });
    els.importFile.addEventListener("change", function () {
      var file = els.importFile.files[0];
      if (!file) {
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          importStacks(JSON.parse(reader.result));
        } catch (err) {
          toast("That file is not valid Stackup JSON");
        }
        els.importFile.value = "";
      };
      reader.readAsText(file);
    });
    els.shareBtn.addEventListener("click", function () {
      var url = location.href.split("#")[0] + "#s=" + encodeShare(shareableStack());
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          toast("Share link copied \u2014 the stack travels inside the link");
        }, function () {
          window.prompt("Copy this link", url);
        });
      } else {
        window.prompt("Copy this link", url);
      }
    });
    els.printBtn.addEventListener("click", function () {
      els.printDate.textContent = new Date().toLocaleString();
      window.print();
    });
    els.themeBtn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(THEME_KEY, next);
      recompute({ keepMc: true });
      if (lastMc) {
        drawHistogram(lastAnalysis, lastMc);
      }
    });
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (lastAnalysis) {
          drawLoop(lastAnalysis);
        }
        if (lastAnalysis && lastMc) {
          drawHistogram(lastAnalysis, lastMc);
        }
      }, 120);
    });
  }

  function applyTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    var prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.setAttribute("data-theme", saved || (prefersLight ? "light" : "dark"));
  }

  function importFromHash() {
    var match = location.hash.match(/^#s=([A-Za-z0-9_-]+)/);
    if (!match) {
      return false;
    }
    try {
      var stack = Core.normalizeStack(decodeShare(match[1]));
      stack.id = uid();
      state.stacks.push(stack);
      state.activeId = stack.id;
      save();
      history.replaceState(null, "", location.pathname + location.search);
      return stack.name;
    } catch (err) {
      return false;
    }
  }

  function init() {
    [
      "stackSelect", "newBtn", "dupBtn", "delBtn", "presetSelect", "importBtn", "importFile",
      "exportJsonBtn", "exportCsvBtn", "shareBtn", "printBtn", "themeBtn", "setup", "stackName",
      "units", "lsl", "usl", "targetCpk", "description", "contribBody", "addRowBtn", "loopCanvas",
      "verdict", "kpis", "histCanvas", "samples", "rerunBtn", "pareto", "insight", "toast",
      "printTitle", "printDate"
    ].forEach(function (id) {
      els[id] = $(id);
    });
    Core.PRESETS.forEach(function (preset) {
      var option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      els.presetSelect.appendChild(option);
    });
    state = load();
    var shared = importFromHash();
    bind();
    renderAll();
    if (shared) {
      toast("Shared stack added: " + shared);
    }
    if ("serviceWorker" in navigator && /^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* offline cache is optional */
      });
    }
  }

  applyTheme();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
