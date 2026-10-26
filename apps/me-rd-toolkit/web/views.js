/* ME R&D Toolkit – reference views and calculators. Limits/defaults come from the data pack (P.calc) when present. */
(function () {
  "use strict";
  const APP = window.APP;
  const { $, $$, esc, highlight, docLink, baseName, num, fmt, parseNumbers, mean, stdev, normCdf, verdict } = APP;
  const V = APP.VIEWS;
  const P = () => APP.P;
  const cfg = () => P().calc || {};

  // ------------------------------------------------------------------ rules
  function ruleBlock(rule, query, index) {
    let html = '<div class="card" id="rule-' + index + '"><h3 style="display:flex;justify-content:space-between;gap:8px"><span>' + highlight(rule.title, query) + "</span>" +
      '<span>' + APP.starButton("rule:" + index, "Rule · " + rule.title, "#rules?r=" + index) + ' <span class="pill">' + esc(rule.group) + "</span></span></h3>";
    if (rule.table) {
      html += '<div class="table-wrap"><table><thead><tr>' + rule.table.head.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
        rule.table.rows.map((row) => "<tr>" + row.map((c) => "<td>" + highlight(c, query) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    }
    if (rule.items) {
      html += '<div class="kv" style="margin-top:8px">' + rule.items.map((it) => '<div class="k">' + highlight(it.k, query) + "</div><div>" + highlight(it.v, query) + "</div>").join("") + "</div>";
    }
    if (rule.src) {
      html += '<div class="src">Source: ' + docLink(baseName(rule.src), rule.src) + "</div>";
    }
    return html + "</div>";
  }
  APP.ruleBlock = ruleBlock;

  V.rules = function (r) {
    const rules = P().rules;
    const query = (r.params.q || "").trim();
    const group = r.params.g || "";
    const groups = [];
    rules.forEach((rule) => {
      if (!groups.includes(rule.group)) {
        groups.push(rule.group);
      }
    });
    let html = "<h1>Design Rules</h1>" + APP.demoBanner() +
      '<div class="muted">Quick reference. Full wording lives in the checklists.</div>' +
      '<div class="toolbar"><input id="rule-search" type="search" placeholder="Search rules (boss, snap, draft, RJ45…)" value="' + esc(query) + '" style="flex:1;max-width:380px"></div>' +
      '<div class="chips"><a class="chip' + (group ? "" : " active") + '" href="#rules">All</a>' +
      groups.map((g) => '<a class="chip' + (g === group ? " active" : "") + '" href="#rules?g=' + encodeURIComponent(g) + '">' + esc(g) + "</a>").join("") + "</div>";
    const q = query.toLowerCase();
    const matches = rules.map((rule, i) => [rule, i]).filter(([rule]) => (!group || rule.group === group) && (!q || JSON.stringify(rule).toLowerCase().includes(q)));
    html += '<div class="grid cols-2" style="margin-top:12px">' + matches.map(([rule, i]) => ruleBlock(rule, query, i)).join("") + "</div>";
    if (!matches.length) {
      html += '<div class="card muted">No rule matches.</div>';
    }
    $("#view").innerHTML = html;
    APP.bindFilter("#rule-search", () => "#rules?" + (group ? "g=" + encodeURIComponent(group) + "&" : "") + "q=" + encodeURIComponent($("#rule-search").value.trim()));
    if (r.params.r) {
      const target = document.getElementById("rule-" + r.params.r);
      if (target) {
        target.scrollIntoView({ block: "start" });
        target.style.outline = "2px solid var(--accent)";
      }
    }
  };

  // ------------------------------------------------------------------ calculators
  const CALCS = APP.CALCS;

  function card(id, title, body, basis) {
    return '<div class="card calc" id="calc-' + id + '"><h3>' + title + "</h3>" + body + '<div class="out" id="' + id + '-out"></div>' +
      (basis ? '<div class="src">Basis: ' + esc(basis) + "</div>" : "") + "</div>";
  }

  function field(id, label, value, extra) {
    return '<div class="row"><label for="' + id + '">' + label + '</label><input type="number" inputmode="decimal" step="any" id="' + id + '" value="' + (value == null ? "" : value) + '"> ' + (extra || "") + "</div>";
  }

  function area(id, label, value) {
    return '<div class="row"><label for="' + id + '">' + label + '</label><textarea id="' + id + '" rows="2" style="flex:1;min-width:200px" inputmode="decimal">' + value + "</textarea></div>";
  }

  CALCS.push({
    id: "cpk",
    title: "Cpk / gap-step",
    html: () => card("cpk", "Cpk · gap / step measurement",
      field("cpk-nom", "Nominal (mm)", 0.5) + field("cpk-up", "Upper tol (+)", 0.1) + field("cpk-lo", "Lower tol (−)", -0.1) +
      area("cpk-data", "Measured values", "0.51 0.49 0.52 0.50 0.48 0.53 0.50 0.47 0.51 0.52 0.49 0.50") +
      field("cpk-good", "PASS if Cpk >", 1.33) + field("cpk-min", "FAIL if Cpk <", 1.0),
      cfg().cpkBasis || "Ca = |x̄ − centre| / (T/2), Cp = T / 6σ, Cpk = Cp(1 − Ca); estimated yield from the normal distribution."),
    calc: () => {
      const nom = num("cpk-nom");
      const usl = nom + num("cpk-up");
      const lsl = nom + num("cpk-lo");
      const data = parseNumbers($("#cpk-data").value);
      if (data.length < 2 || !(usl > lsl)) {
        return "Enter at least 2 values and a valid tolerance band.";
      }
      const m = mean(data);
      const s = stdev(data);
      const ca = Math.abs((m - (usl + lsl) / 2) * 2 / (usl - lsl));
      const cp = (usl - lsl) / (6 * s);
      const cpk = (1 - ca) * cp;
      const y = normCdf(usl, m, s) - normCdf(lsl, m, s);
      const out = data.filter((v) => v > usl || v < lsl).length;
      const grade = cpk > num("cpk-good") ? '<span class="verdict ok">PASS</span>' : (cpk >= num("cpk-min") ? '<span class="verdict warn">Need to improve</span>' : '<span class="verdict ng">FAIL</span>');
      return "n = " + data.length + " · spec " + fmt(lsl) + " ~ " + fmt(usl) + "<br>x̄ = <b>" + fmt(m, 4) + "</b> · σ = " + fmt(s, 4) + " · min " + fmt(Math.min(...data)) + " · max " + fmt(Math.max(...data)) +
        "<br>Ca = " + fmt(ca) + " · Cp = " + fmt(cp) + " · <b>Cpk = " + fmt(cpk) + "</b> → " + grade + "<br>Estimated yield " + fmt(y * 100, 3) + " % · out of spec: " + out;
    }
  });

  CALCS.push({
    id: "btn",
    title: "Button gap x̄ − 3σ",
    html: () => card("btn", "Button ↔ switch gap (x̄ − 3σ)",
      area("btn-data", "Measured gaps (mm)", "0.30 0.28 0.33 0.31 0.29 0.32 0.30 0.27 0.31 0.30 0.29 0.32") +
      field("btn-min", "Required x̄ − 3σ >", cfg().buttonMin != null ? cfg().buttonMin : 0),
      cfg().buttonBasis || "Lower 3σ bound of the gap must stay positive with margin so the button never pre-presses the switch."),
    calc: () => {
      const data = parseNumbers($("#btn-data").value);
      if (data.length < 2) {
        return "Enter values.";
      }
      const m = mean(data);
      const s = stdev(data);
      return "x̄ = " + fmt(m, 4) + " · σ = " + fmt(s, 4) + "<br>x̄ − 3σ = <b>" + fmt(m - 3 * s, 4) + "</b> · x̄ + 3σ = " + fmt(m + 3 * s, 4) + "<br>" +
        verdict(m - 3 * s > num("btn-min"), "PASS", "FAIL – risk of pre-press / no gap");
    }
  });

  CALCS.push({
    id: "torque",
    title: "Screw torque window",
    html: () => {
      const t = cfg().torque || {};
      return card("torque", "Screw torque setting",
        field("tq-y", "Min failure torque Y − 3s", 8, "kgf·cm") + field("tq-x", "Max seating torque X + 3s", 3, "kgf·cm") +
        field("tq-tol", "Driver tolerance ± (%)", t.tol || 10) + field("tq-up", "Upper margin factor", t.upper || 1) + field("tq-lo", "Lower margin factor", t.lower || 1) +
        '<details><summary class="small">Compute from raw samples</summary>' + area("tq-xs", "Seating torques", "") + area("tq-ys", "Failure torques", "") + "</details>",
        t.basis || "Production torque = (X + Y)/2; window = ± driver tolerance; PASS if Y−3s > upper × factor and X+3s < lower × factor.");
    },
    calc: () => {
      let y = num("tq-y");
      let x = num("tq-x");
      let extra = "";
      const xs = parseNumbers($("#tq-xs").value);
      const ys = parseNumbers($("#tq-ys").value);
      if (xs.length >= 2) {
        x = mean(xs) + 3 * stdev(xs);
        extra += "From samples X + 3s = " + fmt(x) + "<br>";
      }
      if (ys.length >= 2) {
        y = mean(ys) - 3 * stdev(ys);
        extra += "From samples Y − 3s = " + fmt(y) + "<br>";
      }
      const tol = num("tq-tol") / 100;
      const prod = (x + y) / 2;
      const upper = prod * (1 + tol);
      const lower = prod * (1 - tol);
      const ok = y > upper * num("tq-up") && x < lower * num("tq-lo");
      return extra + "Production torque <b>" + fmt(prod) + "</b> kgf·cm (" + fmt(prod * 0.0980665) + " N·m)<br>Setting window " + fmt(lower) + " ~ " + fmt(upper) +
        "<br>upper × " + num("tq-up") + " = " + fmt(upper * num("tq-up")) + " vs Y−3s " + fmt(y) + " · lower × " + num("tq-lo") + " = " + fmt(lower * num("tq-lo")) + " vs X+3s " + fmt(x) +
        "<br>" + verdict(ok, "PASS", "NG – window too narrow, improve boss / screw") +
        ((cfg().torque || {}).refFactor ? '<br><span class="muted small">Reference (X+3s) × ' + cfg().torque.refFactor + " = " + fmt(x * cfg().torque.refFactor) + "</span>" : "");
    }
  });

  CALCS.push({
    id: "ta",
    title: "Tolerance stack-up",
    html: () => card("ta", "Tolerance stack-up (worst case + RSS)",
      '<div class="small muted">Dir +1 increases the gap, −1 decreases it. Convert asymmetric tolerances to mean ± half band.</div>' +
      '<div class="stack-row small muted"><span>Dimension</span><span>Nominal</span><span>± Tol</span><span>Dir</span><span></span></div><div id="ta-rows"></div>' +
      '<button class="btn small" data-action="ta-add">+ Row</button>' + field("ta-lsl", "Gap lower limit", 0) + field("ta-usl", "Gap upper limit", ""),
      "Worst case = Σ|tᵢ|, RSS = √Σtᵢ². Verify with measured parts once samples exist."),
    init: () => {
      [["Housing boss height", 5.0, 0.05, -1], ["PCB thickness", 1.6, 0.16, -1], ["Switch height", 3.5, 0.3, -1], ["Button rib to datum", 10.5, 0.1, 1]].forEach((row) => addTaRow(row));
    },
    calc: () => {
      let nominal = 0;
      let wc = 0;
      let sq = 0;
      $$("#ta-rows .stack-row").forEach((row) => {
        const n = parseFloat($(".ta-nom", row).value) || 0;
        const t = Math.abs(parseFloat($(".ta-tol", row).value) || 0);
        nominal += parseFloat($(".ta-dir", row).value) * n;
        wc += t;
        sq += t * t;
      });
      const rss = Math.sqrt(sq);
      const lsl = num("ta-lsl");
      const usl = num("ta-usl");
      const inside = (lo, hi) => (!isFinite(lsl) || lo >= lsl) && (!isFinite(usl) || hi <= usl);
      return "Nominal gap <b>" + fmt(nominal) + "</b> mm<br>Worst case ±" + fmt(wc) + " → " + fmt(nominal - wc) + " ~ " + fmt(nominal + wc) + " " +
        verdict(inside(nominal - wc, nominal + wc), "inside spec", "outside spec", !inside(nominal - wc, nominal + wc)) +
        "<br>RSS ±" + fmt(rss) + " → <b>" + fmt(nominal - rss) + " ~ " + fmt(nominal + rss) + "</b> " + verdict(inside(nominal - rss, nominal + rss), "inside spec", "outside spec");
    }
  });

  function addTaRow(row) {
    const r = row || ["", 0, 0, 1];
    const div = document.createElement("div");
    div.className = "stack-row";
    div.innerHTML = '<input class="ta-name" value="' + esc(r[0]) + '" placeholder="Dimension"><input class="ta-nom" type="number" step="any" inputmode="decimal" value="' + r[1] + '">' +
      '<input class="ta-tol" type="number" step="any" inputmode="decimal" value="' + r[2] + '"><select class="ta-dir"><option value="1"' + (r[3] > 0 ? " selected" : "") + '>+1</option><option value="-1"' + (r[3] < 0 ? " selected" : "") + ">−1</option></select>" +
      '<button class="btn small" data-action="ta-del">×</button>';
    $("#ta-rows").appendChild(div);
  }
  APP.addTaRow = addTaRow;

  CALCS.push({
    id: "snap",
    title: "Snap-fit cantilever",
    html: () => {
      const s = cfg().snap || {};
      return card("snap", "Snap-fit / cantilever hook",
        '<div class="row"><label>Material preset</label><select id="sn-mat"><option value="">— custom —</option><option value="2300,45">ABS (≈E 2300, σy 45)</option>' +
        '<option value="2400,55">PC/ABS (≈E 2400, σy 55)</option><option value="2350,62">PC (≈E 2350, σy 62)</option><option value="2800,65">POM (≈E 2800, σy 65)</option></select></div>' +
        field("sn-e", "E (MPa)", 2400) + field("sn-sy", "Yield σy (MPa)", 55) + field("sn-l", "Length L (mm)", 12) + field("sn-t", "Root thickness t (mm)", 0.8) +
        field("sn-b", "Width b (mm)", 4) + field("sn-y", "Deflection y (mm)", 0.6) + field("sn-eall", "Allowable strain (%)", "", '<span class="muted small">blank = σy/E</span>') +
        field("sn-mu", "Friction μ", 0.5) + field("sn-a", "Lead-in angle (°)", 30) +
        field("sn-sf1", "Required stress SF ≥", s.sfStress || 1.5) + field("sn-sf2", "Required deflection SF ≥", s.sfDefl || 1.5) + field("sn-stop", "Stop wall at × y", s.stop || 1.5),
        s.basis || "Rectangular cantilever: ε = 1.5·t·y/L², σ = E·ε, P = b·t²·E·ε/(6L), W = P(μ + tanα)/(1 − μ·tanα). Material values are typical – use datasheets.");
    },
    init: () => {
      $("#sn-mat").addEventListener("change", (event) => {
        if (event.target.value) {
          const [e, sy] = event.target.value.split(",");
          $("#sn-e").value = e;
          $("#sn-sy").value = sy;
          runCalc("snap");
        }
      });
    },
    calc: () => {
      const E = num("sn-e");
      const sy = num("sn-sy");
      const L = num("sn-l");
      const t = num("sn-t");
      const y = num("sn-y");
      const a = num("sn-a") * Math.PI / 180;
      const mu = num("sn-mu");
      const strain = 1.5 * t * y / (L * L);
      const stress = E * strain;
      const sf1 = sy / stress;
      const eAllow = isFinite(num("sn-eall")) ? num("sn-eall") / 100 : sy / E;
      const yAllow = eAllow * L * L / (1.5 * t);
      const sf2 = yAllow / y;
      const force = num("sn-b") * t * t * E * strain / (6 * L);
      const mating = force * (mu + Math.tan(a)) / (1 - mu * Math.tan(a));
      return "ε = " + fmt(strain * 100, 2) + " % · σ = <b>" + fmt(stress, 1) + " MPa</b> (" + fmt(stress / 9.80665, 2) + " kgf/mm²)" +
        "<br>Stress SF <b>" + fmt(sf1, 2) + "</b> " + verdict(sf1 >= num("sn-sf1"), "OK", "below target → CAE") +
        "<br>Deflection SF <b>" + fmt(sf2, 2) + "</b> (max y " + fmt(yAllow) + " mm) " + verdict(sf2 >= num("sn-sf2"), "OK", "below target → CAE") +
        "<br>Stop wall at <b>" + fmt(num("sn-stop") * y) + " mm</b> · deflection force " + fmt(force, 2) + " N · assembly force " + fmt(mating, 2) + " N";
    }
  });

  CALCS.push({
    id: "pad",
    title: "Thermal pad compression",
    html: () => {
      const p = cfg().pad || {};
      return card("pad", "Thermal pad compression",
        field("pd-t", "Pad free thickness (mm)", 1.5) + field("pd-gap", "Nominal gap (mm)", 1.2) + field("pd-tol", "Gap tolerance RSS ± (mm)", 0.15) +
        field("pd-min", "Min compression (%)", ((p.minCompression || 0.1) * 100).toFixed(0)) + field("pd-f", "Force at max compression (N)", "") +
        field("pd-chip", "Chip allowable force (N)", "") + field("pd-ratio", "Max force ratio (%)", ((p.maxForceRatio || 1) * 100).toFixed(0)),
        p.basis || "Compression = (t₀ − gap)/t₀ evaluated at the worst-case gap.");
    },
    calc: () => {
      const t0 = num("pd-t");
      const g = num("pd-gap");
      const tol = num("pd-tol") || 0;
      const cMin = (t0 - (g + tol)) / t0;
      const cMax = (t0 - (g - tol)) / t0;
      let html = "Gap " + fmt(g - tol) + " ~ " + fmt(g + tol) + " mm<br>Compression min <b>" + fmt(cMin * 100, 1) + " %</b> · max " + fmt(cMax * 100, 1) + " %<br>" +
        verdict(cMin * 100 >= num("pd-min"), "Min compression OK", "Below minimum – risk of no contact");
      if (isFinite(num("pd-f")) && isFinite(num("pd-chip"))) {
        const ratio = 100 * num("pd-f") / num("pd-chip");
        html += "<br>Force ratio " + fmt(ratio, 1) + " % " + verdict(ratio <= num("pd-ratio"), "OK", "too much load on chip");
      }
      return html;
    }
  });

  CALCS.push({
    id: "cable",
    title: "Cable bend & length",
    html: () => card("cable", "Cable bend radius & length",
      field("cb-od", "Cable / harness OD (mm)", 1.13) +
      '<div class="row"><label>Type</label><select id="cb-type"><option value="10">Coax, flexing (10 × OD)</option><option value="5">Coax, fixed (5 × OD)</option><option value="2">Non-coax (2 × OD)</option></select></div>' +
      field("cb-len", "Shortest routed length (mm)", 120) + field("cb-min", "Length allowance min (+mm)", (cfg().cable || {}).min != null ? cfg().cable.min : 0) +
      field("cb-max", "Length allowance max (+mm)", (cfg().cable || {}).max != null ? cfg().cable.max : 10),
      "IPC-620 style bend-radius multipliers; length window = shortest route + allowances."),
    calc: () => {
      const od = num("cb-od");
      const k = parseFloat($("#cb-type").value);
      const len = num("cb-len");
      return "Min bend radius = " + k + " × OD = <b>" + fmt(k * od, 2) + " mm</b><br>Length spec: <b>" + fmt(len + num("cb-min"), 1) + " ~ " + fmt(len + num("cb-max"), 1) + " mm</b>";
    }
  });

  CALCS.push({
    id: "safety",
    title: "Enclosure opening",
    html: () => card("safety", "Enclosure opening (IEC) check",
      '<div class="row"><label>Standard</label><select id="sf-std"><option>62368</option><option>60950</option><option>60065</option></select></div>' +
      '<div class="row"><label>Housing</label><select id="sf-mat"><option value="plastic">Plastic</option><option value="metal">Metal</option></select></div>' +
      '<div class="row"><label>Location</label><select id="sf-loc"><option value="top">Top / side</option><option value="bottom">Bottom (or facing down when mounted)</option><option value="ign">Near ignition source (60065)</option></select></div>' +
      '<div class="row"><label>Shape</label><select id="sf-shape"><option value="hole">Round / square</option><option value="slot">Slot (width)</option></select></div>' +
      field("sf-size", "Opening size (mm)", 2.5),
      "Typical limits from IEC 62368 / 60950 / 60065 enclosure-opening clauses – always confirm with the safety team."),
    calc: () => {
      const std = $("#sf-std").value;
      const mat = $("#sf-mat").value;
      const loc = $("#sf-loc").value;
      const slot = $("#sf-shape").value === "slot";
      const size = num("sf-size");
      let limit = null;
      let note = "";
      if (std === "62368") {
        limit = slot ? 1 : (loc === "bottom" ? 3 : 5);
      } else if (std === "60950") {
        if (loc === "bottom") {
          note = mat === "plastic" ? "Plastic bottom: no openings, metal mesh or baffle." : "Metal bottom: per safety lookup table.";
        } else {
          limit = slot ? 1 : 3;
        }
      } else if (loc === "ign") {
        limit = slot ? 1 : 0;
        note = "Avoid openings near potential ignition sources.";
      } else {
        limit = slot ? 1 : 3;
      }
      if (limit == null) {
        return '<span class="verdict warn">' + esc(note) + "</span>";
      }
      return "Limit ≤ <b>" + limit + " mm</b><br>" + verdict(size <= limit, "OK", "Too large") + (note ? '<br><span class="muted small">' + esc(note) + "</span>" : "");
    }
  });

  CALCS.push({
    id: "color",
    title: "Colour ΔE",
    html: () => {
      const c = cfg().color || {};
      return card("color", "Colour difference ΔE",
        field("co-l", "ΔL", 0.3) + field("co-a", "Δa", 0.2) + field("co-b", "Δb", 0.4) + field("co-each", "Limit per axis", c.each || 1) + field("co-de", "Limit ΔE", c.dE || 1),
        c.basis || "CIE76 ΔE = √(ΔL² + Δa² + Δb²).");
    },
    calc: () => {
      const l = num("co-l");
      const a = num("co-a");
      const b = num("co-b");
      const de = Math.sqrt(l * l + a * a + b * b);
      const each = [l, a, b].every((v) => Math.abs(v) <= num("co-each"));
      return "ΔE = <b>" + fmt(de) + "</b><br>" + verdict(each && de <= num("co-de"), "PASS", "FAIL (" + (each ? "ΔE" : "axis") + " over limit)");
    }
  });

  CALCS.push({
    id: "drop",
    title: "Test severity factor",
    html: () => card("drop", "Test margin", field("dr-h", "Specified drop height (mm)", 760) + field("dr-f", "Margin factor", cfg().dropFactor || 1), "Optional engineering margin applied on top of the specified test level."),
    calc: () => "Test height with margin = <b>" + fmt(num("dr-h") * num("dr-f"), 0) + " mm</b>"
  });

  CALCS.push({
    id: "units",
    title: "Unit converter",
    html: () => card("units", "Unit converter", field("un-kg", "Stress (kgf/mm²)", 6) + field("un-kgcm", "Torque (kgf·cm)", 5) + field("un-in", "Length (inch)", 1),
      "1 kgf/mm² = 9.80665 MPa · 1 kgf·cm = 0.0980665 N·m · 1 in = 25.4 mm"),
    calc: () => fmt(num("un-kg"), 3) + " kgf/mm² = <b>" + fmt(num("un-kg") * 9.80665, 2) + " MPa</b><br>" + fmt(num("un-kgcm"), 3) + " kgf·cm = <b>" + fmt(num("un-kgcm") * 0.0980665) + " N·m</b> = " +
      fmt(num("un-kgcm") * 0.868, 2) + " lbf·in<br>" + num("un-in") + " in = <b>" + fmt(num("un-in") * 25.4, 2) + " mm</b>"
  });

  // Optional private add-on (private/calcs.js) can register extra calculators that use company tables.
  APP.addCalcs = function (factory) {
    factory({ card, field, area, cfg, num, fmt, esc, $ }).forEach((c) => CALCS.push(c));
  };

  function runCalc(id) {
    const calc = CALCS.find((c) => c.id === id);
    const out = document.getElementById(id + "-out");
    if (calc && out) {
      try {
        out.innerHTML = calc.calc();
      } catch (error) {
        out.textContent = "Check inputs";
      }
    }
  }
  APP.runCalc = runCalc;

  V.calc = function (r) {
    const only = r.params.c;
    const list = only ? CALCS.filter((c) => c.id === only) : CALCS;
    $("#view").innerHTML = "<h1>Calculators</h1><div class=\"muted\">Results update as you type. Limits are editable; defaults come from your data pack.</div>" +
      '<div class="chips" style="margin:12px 0"><a class="chip' + (only ? "" : " active") + '" href="#calc">All</a>' + CALCS.map((c) => '<a class="chip' + (c.id === only ? " active" : "") + '" href="#calc?c=' + c.id + '">' + esc(c.title) + "</a>").join("") + "</div>" +
      '<div class="grid cols-2">' + list.map((c) => c.html()).join("") + "</div>";
    list.forEach((c) => {
      if (c.init) {
        c.init();
      }
      const el = document.getElementById("calc-" + c.id);
      el.addEventListener("input", () => runCalc(c.id));
      el.addEventListener("change", () => runCalc(c.id));
      runCalc(c.id);
    });
  };

  // ------------------------------------------------------------------ materials & tests
  V.materials = function () {
    const ul = P().ulMaterials;
    if (!ul) {
      $("#view").innerHTML = "<h1>Materials</h1>" + APP.demoBanner();
      return;
    }
    let html = "<h1>Materials</h1>" +
      '<div class="table-wrap" style="margin-top:12px"><table><thead><tr>' + ul.head.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
      ul.rows.map((r) => "<tr>" + r.map((c, i) => "<td>" + (i === 3 ? '<span class="pill ' + (c === "V0" ? "ok" : "warn") + '">' + esc(c) + "</span>" : esc(c)) + "</td>").join("") + "</tr>").join("") +
      '</tbody></table></div><div class="card" style="margin-top:12px"><ul>' + ul.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>" +
      (ul.src ? '<div class="src">Source: ' + docLink(baseName(ul.src), ul.src) + "</div>" : "") + "</div>";
    const idx = P().rules.findIndex((r) => r.group === "Materials");
    if (idx >= 0) {
      html += "<h2>Material rules</h2>" + ruleBlock(P().rules[idx], "", idx);
    }
    $("#view").innerHTML = html;
  };

  V.tests = function () {
    const t = P().tests;
    if (!t) {
      $("#view").innerHTML = "<h1>Tests & Reliability</h1>" + APP.demoBanner();
      return;
    }
    let html = "<h1>Tests & Reliability</h1>" +
      '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Test</th><th>Condition</th><th>Qty</th><th class="hide-mobile">Notes</th></tr></thead><tbody>' +
      t.rows.map((r) => "<tr><td><b>" + esc(r[0]) + "</b></td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + '</td><td class="hide-mobile">' + esc(r[3]) + "</td></tr>").join("") +
      "</tbody></table></div>" + (t.src ? '<div class="src">Source: ' + docLink(baseName(t.src), t.src) + "</div>" : "") +
      (P().yieldTargets ? '<div class="card" style="margin-top:12px"><b>Yield targets:</b> ' + esc(P().yieldTargets) + "</div>" : "");
    const idx = P().rules.findIndex((r) => /opening/i.test(r.title));
    if (idx >= 0) {
      html += "<h2>Safety</h2>" + ruleBlock(P().rules[idx], "", idx);
    }
    $("#view").innerHTML = html;
  };

  // ------------------------------------------------------------------ lessons
  V.lessons = function (r) {
    const lessons = P().lessons;
    const area = r.params.a || "";
    const areas = Array.from(new Set(lessons.map((l) => l.area)));
    const full = lessons.filter((l) => l.issue && (!area || l.area === area));
    const titles = lessons.filter((l) => !l.issue && (!area || l.area === area));
    $("#view").innerHTML = "<h1>Lessons Learned</h1>" + APP.demoBanner() +
      '<div class="chips" style="margin:12px 0"><a class="chip' + (area ? "" : " active") + '" href="#lessons">All</a>' + areas.map((a) => '<a class="chip' + (a === area ? " active" : "") + '" href="#lessons?a=' + encodeURIComponent(a) + '">' + esc(a) + "</a>").join("") + "</div>" +
      '<div class="grid cols-2">' + full.map((l) => '<div class="card lesson"><h3>' + esc(l.title) + '</h3><span class="pill blue">' + esc(l.area) + "</span>" +
        "<dl><dt>Issue</dt><dd>" + esc(l.issue) + "</dd><dt>Root cause</dt><dd>" + esc(l.cause) + "</dd><dt>Rule for next design</dt><dd><ul>" + l.rules.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></dd></dl>" +
        (l.file ? '<div class="src">' + docLink(baseName(l.file), l.file) + "</div>" : "") + "</div>").join("") + "</div>" +
      (titles.length ? '<h2>Other decks</h2><div class="card">' + titles.map((l) => '<div style="margin:6px 0"><span class="pill">' + esc(l.area) + "</span> " + docLink(baseName(l.file), l.file) + "</div>").join("") + "</div>" : "");
  };

  // ------------------------------------------------------------------ SOPs & approval
  V.sops = function () {
    const sops = P().sops;
    $("#view").innerHTML = "<h1>SOPs & Procedures</h1>" + APP.demoBanner() +
      '<div class="chips" style="margin:12px 0">' + sops.map((s, i) => '<a class="chip" href="#sops" data-scroll="sop-' + i + '">' + esc(s.title) + "</a>").join("") + "</div>" +
      sops.map((s, i) => '<div class="card" id="sop-' + i + '" style="margin-bottom:12px"><h3 style="display:flex;justify-content:space-between;gap:8px">' + esc(s.title) + '<span class="pill blue">' + esc(s.area) + "</span></h3>" +
        '<ol class="steps">' + s.steps.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol>" +
        (s.notes.length ? '<div class="small" style="margin-top:10px"><b>Notes</b><ul>' + s.notes.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" : "") +
        (s.src ? '<div class="src">Source: ' + docLink(baseName(s.src), s.src) + "</div>" : "") +
        (s.refs && s.refs.length ? '<div class="src">' + s.refs.map((ref) => docLink(baseName(ref), ref)).join("<br>") + "</div>" : "") + "</div>").join("");
  };

  V.approval = function () {
    const a = P().approval;
    if (!a) {
      $("#view").innerHTML = "<h1>Part Approval</h1>" + APP.demoBanner();
      return;
    }
    const links = a.links || [];
    $("#view").innerHTML = "<h1>" + esc(a.title || "Part Approval") + "</h1>" +
      (links.length ? '<div class="toolbar">' + links.map((l, i) => '<a class="btn small' + (i ? "" : " primary") + '" href="' + esc(l[0]) + '">' + esc(l[1]) + "</a>").join("") + "</div>" : "") +
      '<div class="grid cols-2"><div class="card"><h3>' + esc(a.sheetTitle || "What to check") + '</h3><div class="kv">' + a.sheet.map((r) => '<div class="k">' + esc(r[0]) + "</div><div>" + esc(r[1]) + "</div>").join("") + "</div>" +
      '<p class="small"><b>Flow:</b> ' + esc(a.flow) + "</p>" + (a.sheetSrc ? '<div class="src">' + docLink(baseName(a.sheetSrc), a.sheetSrc) + "</div>" : "") + "</div>" +
      '<div class="card"><h3>' + esc(a.notesTitle || "Review notes") + '</h3><ul>' + a.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>" +
      '<div class="card"><h3>Reference documents</h3>' + P().library.filter((d) => new RegExp(a.docGroups || "approval", "i").test(d.group)).map((d) => '<div style="margin:4px 0">' + docLink(d.name, d.path) + "</div>").join("") + "</div></div>";
  };
})();
