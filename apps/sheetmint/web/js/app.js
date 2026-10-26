/* Sheetmint — UI. Hash router + views. All data goes through SheetmintStore. */
(function () {
  "use strict";

  var Core = window.SheetmintCore;
  var X = window.SheetmintXlsx;
  var Guides = window.SheetmintGuides;
  var DRAFT_KEY = "sheetmint.studio";
  var AI_KEY = "sheetmint.ai";
  var UI_THEME_KEY = "sheetmint.uitheme";
  var REF_PREFIX = "sheetmint.ref.";
  var REF_DAYS = 30;

  var store = null;
  var user = null;
  var view = null;
  var draft = null;
  var tweakLog = [];
  var pendingAuth = null;

  var EXAMPLES = [
    "Freelance invoice tracker with notes",
    "Monthly budget in rupiah, pastel pink",
    "Inventory for my online shop, green",
    "Content calendar for TikTok and Instagram",
    "Airbnb host profit tracker",
    "Buat template catatan arisan kolom: Nama, Tanggal, Setoran"
  ];

  // ------------------------------------------------------------------ helpers
  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(value, currency) {
    return Core.formatValue(value, "currency", currency || "USD");
  }

  function priceLabel(l) {
    return l.price > 0 ? money(l.price, l.currency) : "Free";
  }

  function stars(rating) {
    if (!rating) {
      return "<span class=\"muted\">No ratings yet</span>";
    }
    var full = Math.round(rating);
    return "<span class=\"stars\" aria-label=\"" + rating + " out of 5\">" + "\u2605\u2605\u2605\u2605\u2605".slice(0, full) + "<span class=\"dim\">" + "\u2605\u2605\u2605\u2605\u2605".slice(0, 5 - full) + "</span></span> " + rating.toFixed(1);
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template";
  }

  function toast(message, kind) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.className = "toast show " + (kind || "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      el.className = "toast";
    }, 2600);
  }

  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function exportXlsx(spec, author) {
    var bytes = X.build(spec, { author: author || (user && user.name) || "Sheetmint", footer: "Made with Sheetmint." });
    download(slug(spec.title) + ".xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    toast("Downloaded .xlsx \u2014 opens in Excel and Google Sheets");
  }

  function exportCsv(spec) {
    download(slug(spec.title) + ".csv", X.toCsv(spec), "text/csv");
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Copied");
      }, function () {
        window.prompt("Copy:", text);
      });
    } else {
      window.prompt("Copy:", text);
    }
  }

  function baseUrl() {
    return location.href.split("#")[0];
  }

  function itemLink(id, code) {
    return baseUrl() + "#/item/" + encodeURIComponent(id) + (code ? "?ref=" + encodeURIComponent(code) : "");
  }

  function route() {
    var hash = location.hash.replace(/^#\/?/, "");
    var q = hash.indexOf("?");
    var path = q === -1 ? hash : hash.slice(0, q);
    var query = {};
    if (q !== -1) {
      hash.slice(q + 1).split("&").forEach(function (pair) {
        var kv = pair.split("=");
        if (kv[0]) {
          query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
        }
      });
    }
    return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: query };
  }

  function go(hash) {
    if (location.hash === hash) {
      render();
    } else {
      location.hash = hash;
    }
  }

  function themeVars(themeId) {
    var t = Core.themeById(themeId);
    return "--th:#" + t.header + ";--tht:#" + t.headerText + ";--tband:#" + t.band + ";--tbody:#" + t.body + ";--tbt:#" + t.bodyText + ";--tacc:#" + t.accent;
  }

  function errorMessage(err) {
    return (err && err.message) || "Something went wrong";
  }

  function requireLogin(reason) {
    return new Promise(function (resolve) {
      if (user) {
        resolve(user);
        return;
      }
      openAuth(reason, resolve);
    });
  }

  // ------------------------------------------------------------------ sheet preview
  function renderSheet(spec, opts) {
    opts = opts || {};
    var result = Core.compute(spec);
    var cols = spec.sheet.columns;
    var rows = result.rows.slice(0, opts.maxRows || 500);
    var html = "<div class=\"sheet\" style=\"" + themeVars(spec.theme) + "\"><table><thead><tr>";
    if (opts.editable) {
      html += "<th class=\"rownum\">#</th>";
    }
    cols.forEach(function (c) {
      html += "<th title=\"" + esc(c.type + (c.formula ? " = " + c.formula : "")) + "\">" + esc(c.name) + (c.type === "formula" ? " <span class=\"fx\">fx</span>" : "") + "</th>";
    });
    if (opts.editable) {
      html += "<th></th>";
    }
    html += "</tr></thead><tbody>";
    rows.forEach(function (row, r) {
      html += "<tr>";
      if (opts.editable) {
        html += "<td class=\"rownum\">" + (r + 1) + "</td>";
      }
      row.cells.forEach(function (cell) {
        var c = cell.col;
        var cls = (cell.style ? "is-" + cell.style : "") + (cell.error ? " is-error" : "");
        if (!opts.editable || c.type === "formula") {
          html += "<td class=\"" + cls + (c.type === "formula" ? " calc" : "") + " t-" + c.type + "\">" + esc(cell.display) + "</td>";
          return;
        }
        var raw = spec.sheet.rows[r][c.id];
        raw = raw === undefined || raw === null ? "" : raw;
        var attrs = " data-r=\"" + r + "\" data-c=\"" + esc(c.id) + "\" aria-label=\"" + esc(c.name + " row " + (r + 1)) + "\"";
        var input;
        if (c.type === "select" || c.type === "check") {
          var options = c.type === "check" ? ["Yes", "No"] : c.options;
          input = "<select" + attrs + "><option value=\"\"></option>" + options.map(function (o) {
            return "<option" + (String(o) === String(raw) ? " selected" : "") + ">" + esc(o) + "</option>";
          }).join("") + "</select>";
        } else if (c.type === "date") {
          input = "<input type=\"date\"" + attrs + " value=\"" + esc(raw) + "\">";
        } else if (c.type === "number" || c.type === "currency" || c.type === "percent") {
          input = "<input type=\"number\" step=\"any\" inputmode=\"decimal\"" + attrs + " value=\"" + esc(raw) + "\"" + (c.type === "percent" ? " title=\"0.25 = 25%\"" : "") + ">";
        } else {
          input = "<input type=\"text\"" + attrs + " value=\"" + esc(raw) + "\">";
        }
        html += "<td class=\"" + cls + " t-" + c.type + "\">" + input + "</td>";
      });
      if (opts.editable) {
        html += "<td><button class=\"icon\" data-del-row=\"" + r + "\" title=\"Delete row\" aria-label=\"Delete row " + (r + 1) + "\">\u2715</button></td>";
      }
      html += "</tr>";
    });
    if (!rows.length) {
      html += "<tr><td colspan=\"" + (cols.length + (opts.editable ? 2 : 0)) + "\" class=\"muted center\">No rows yet</td></tr>";
    }
    html += "</tbody></table></div>";
    if (result.summary.length) {
      html += "<div class=\"cards\" style=\"" + themeVars(spec.theme) + "\">" + result.summary.map(function (s) {
        return "<div class=\"card\"><div class=\"label\">" + esc(s.label) + "</div><div class=\"value\">" + esc(s.display) + "</div></div>";
      }).join("") + "</div>";
    }
    var errs = Object.keys(result.errors);
    if (errs.length) {
      html += "<p class=\"warn-box\">Formula problems: " + errs.map(function (id) {
        var col = cols.filter(function (c) { return c.id === id; })[0];
        return esc((col ? col.name : id) + " \u2014 " + result.errors[id]);
      }).join("; ") + "</p>";
    }
    return html;
  }

  function thumb(listing) {
    var cols = (listing.columns || []).slice(0, 4);
    var html = "<div class=\"thumb\" style=\"" + themeVars(listing.theme) + "\"><div class=\"thead\">" + cols.map(function (c) {
      return "<span>" + esc(c) + "</span>";
    }).join("") + "</div>";
    for (var i = 0; i < 4; i++) {
      html += "<div class=\"trow" + (i % 2 ? " band" : "") + "\">" + cols.map(function () {
        return "<span><i style=\"width:" + (40 + ((i * 37 + cols.length * 13) % 50)) + "%\"></i></span>";
      }).join("") + "</div>";
    }
    return html + "</div>";
  }

  function listingCard(l) {
    return "<a class=\"lcard\" href=\"#/item/" + encodeURIComponent(l.id) + "\">" + thumb(l) +
      "<div class=\"lbody\"><div class=\"ltitle\">" + esc(l.title) + "</div>" +
      "<div class=\"lmeta\">" + esc(l.sellerName) + " \u00b7 " + esc(l.category) + "</div>" +
      "<div class=\"lfoot\"><strong>" + esc(priceLabel(l)) + "</strong>" +
      (l.commissionPct > 0 && l.price > 0 ? "<span class=\"badge\">Earn " + l.commissionPct + "%</span>" : "") +
      "<span class=\"muted small\">" + (l.sales ? l.sales + " sold" : "New") + "</span></div></div></a>";
  }

  // ------------------------------------------------------------------ AI (optional, bring your own key)
  function aiConfig() {
    try {
      return JSON.parse(localStorage.getItem(AI_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function aiGenerate(prompt) {
    var cfg = aiConfig();
    var schema = "Return ONLY JSON: {\"title\":str,\"description\":str,\"category\":one of " + JSON.stringify(Core.CATEGORIES) +
      ",\"theme\":one of " + JSON.stringify(Core.THEMES.map(function (t) { return t.id; })) +
      ",\"currency\":ISO code,\"sheet\":{\"columns\":[{\"id\":\"c1\",\"name\":str,\"type\":\"text|number|currency|percent|date|select|check|formula\",\"options\":[str] (select only),\"formula\":\"uses [Column Name], + - * / & = <> < > , IF AND OR NOT ROUND MIN MAX ABS TODAY IFERROR\" (formula only),\"format\":\"number|currency|percent|text\" (formula only)}],\"rows\":[{\"c1\":value}]},\"summary\":[{\"label\":str,\"fn\":\"SUM|AVERAGE|MIN|MAX|COUNTA|COUNTIF\",\"column\":column name,\"match\":str}],\"rules\":[{\"column\":name,\"op\":\"<|>|=\",\"value\":num or str,\"style\":\"good|bad|warn\"}]}. Dates as yyyy-mm-dd, check values Yes/No, 4-6 realistic sample rows, 4-9 columns.";
    return fetch(cfg.endpoint.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model || "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You design practical spreadsheet templates. " + schema },
          { role: "user", content: prompt }
        ]
      })
    }).then(function (res) {
      if (!res.ok) {
        throw new Error("AI request failed (" + res.status + ")");
      }
      return res.json();
    }).then(function (data) {
      var text = data.choices[0].message.content;
      var spec = Core.normalize(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
      spec.prompt = prompt;
      if (spec.sheet.columns.length < 2) {
        throw new Error("AI returned too few columns");
      }
      return spec;
    });
  }

  function generateDraft(prompt, useAi) {
    prompt = String(prompt || "").trim();
    if (!prompt) {
      toast("Describe the template you want first");
      return Promise.resolve(false);
    }
    var cfg = aiConfig();
    var path = useAi && cfg.endpoint && cfg.key ? aiGenerate(prompt).then(function (spec) {
      return { spec: spec, notes: ["Generated with your AI model (" + (cfg.model || "default") + ")."] };
    }).catch(function (err) {
      var g = Core.generate(prompt);
      g.notes.unshift("AI failed (" + errorMessage(err) + "), used the built-in generator.");
      return g;
    }) : Promise.resolve(Core.generate(prompt));
    return path.then(function (g) {
      draft = { spec: g.spec, templateId: null };
      tweakLog = [{ who: "you", text: prompt }].concat(g.notes.map(function (n) {
        return { who: "mint", text: n };
      }));
      saveDraftLocal();
      return true;
    });
  }

  // ------------------------------------------------------------------ draft persistence
  function loadDraftLocal() {
    try {
      var saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (saved && saved.spec) {
        draft = { spec: Core.normalize(saved.spec), templateId: saved.templateId || null };
        tweakLog = saved.log || [];
      }
    } catch (err) {
      draft = null;
    }
  }

  function saveDraftLocal() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ spec: draft.spec, templateId: draft.templateId, log: tweakLog.slice(-20) }));
    } catch (err) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ views
  function promptBox(id, big) {
    var cfg = aiConfig();
    return "<form class=\"promptbox" + (big ? " big" : "") + "\" data-prompt-form>" +
      "<label class=\"skip\" for=\"" + id + "\">Describe your template</label>" +
      "<textarea id=\"" + id + "\" rows=\"" + (big ? 3 : 2) + "\" placeholder=\"e.g. Freelance invoice tracker in rupiah with notes, ocean theme\"></textarea>" +
      "<div class=\"promptrow\"><div class=\"chips\">" + EXAMPLES.map(function (e) {
        return "<button type=\"button\" class=\"chip\" data-example=\"" + esc(e) + "\">" + esc(e) + "</button>";
      }).join("") + "</div>" +
      (cfg.endpoint && cfg.key ? "<label class=\"aitoggle\"><input type=\"checkbox\" data-use-ai checked> Use my AI</label>" : "") +
      "<button class=\"btn primary\" type=\"submit\">\u2728 Generate</button></div></form>";
  }

  function viewHome() {
    var html = "<section class=\"hero\"><h1>Prompt a spreadsheet template.<br><span>Tweak it. Sell it.</span></h1>" +
      "<p class=\"lede\">Describe what you need in English or Bahasa Indonesia. Sheetmint builds a themed Excel / Google Sheets template with live formulas, dropdowns and a dashboard \u2014 then publish it to the market, or let affiliates sell it for you.</p>" +
      promptBox("homePrompt", true) + "</section>" +
      "<section class=\"steps\"><div><b>1</b><h3>Prompt</h3><p>\u201cInventory for my online shop, green\u201d \u2192 a working template in a second.</p></div>" +
      "<div><b>2</b><h3>Tweak</h3><p>Edit with words (\u201cadd column Supplier\u201d) or by hand. Pick a theme.</p></div>" +
      "<div><b>3</b><h3>Sell</h3><p>Publish with a price and affiliate %, get a content kit, track sales.</p></div></section>" +
      "<section><div class=\"sechead\"><h2>Fresh in the market</h2><a href=\"#/market\">Browse all \u2192</a></div><div class=\"grid\" id=\"homeMarket\"><p class=\"muted\">Loading\u2026</p></div></section>" +
      "<section><div class=\"sechead\"><h2>Creator guides</h2><a href=\"#/guides\">All guides \u2192</a></div><div class=\"guides\">" +
      Guides.slice(0, 3).map(guideCard).join("") + "</div></section>" +
      "<section class=\"cta-band\"><div><h2>Earn without making templates</h2><p>Join the affiliate program: share any listing with an \u201cEarn %\u201d badge and get paid commission on every sale you refer.</p></div><a class=\"btn\" href=\"#/guides/affiliate\">How it works</a></section>";
    view.innerHTML = html;
    store.browse({ sort: "new" }).then(function (items) {
      var el = document.getElementById("homeMarket");
      if (el) {
        el.innerHTML = items.slice(0, 6).map(listingCard).join("") || "<p class=\"muted\">No listings yet.</p>";
      }
    });
  }

  function guideCard(g) {
    return "<a class=\"gcard\" href=\"#/guides/" + g.slug + "\"><span class=\"gicon\">" + g.icon + "</span><h3>" + esc(g.title) + "</h3><p>" + esc(g.summary) + "</p></a>";
  }

  // --- Studio
  function viewStudio() {
    if (!draft) {
      view.innerHTML = "<section class=\"narrow\"><h1>Create a template</h1>" + promptBox("studioPrompt", true) +
        "<h2 class=\"mt\">\u2026or start from a blueprint</h2><div class=\"grid\">" + Core.BLUEPRINTS.map(function (bp) {
          var l = { id: bp.id, title: bp.title, columns: bp.columns.map(function (c) { return c[0]; }), theme: bp.theme };
          return "<button class=\"lcard asbutton\" data-blueprint=\"" + bp.id + "\">" + thumb(l) + "<div class=\"lbody\"><div class=\"ltitle\">" + esc(bp.title) + "</div><div class=\"lmeta\">" + esc(bp.category) + "</div></div></button>";
        }).join("") + "</div></section>";
      return;
    }
    var spec = draft.spec;
    view.innerHTML = "<div class=\"studio\">" +
      "<aside class=\"panel side\">" +
      "<h2>Tweak with words</h2><div class=\"log\" id=\"tweakLog\"></div>" +
      "<form data-tweak-form><textarea id=\"tweakInput\" rows=\"3\" placeholder=\"add column Supplier&#10;theme ocean&#10;highlight Qty below 5 red\"></textarea>" +
      "<button class=\"btn primary block\" type=\"submit\">Apply</button></form>" +
      "<h2>Theme</h2><div class=\"swatches\">" + Core.THEMES.map(function (t) {
        return "<button class=\"swatch" + (t.id === spec.theme ? " on" : "") + "\" data-theme=\"" + t.id + "\" title=\"" + esc(t.name) + "\" style=\"background:linear-gradient(135deg,#" + t.header + " 50%,#" + t.band + " 50%)\"><span class=\"skip\">" + esc(t.name) + "</span></button>";
      }).join("") + "</div>" +
      "<h2>Details</h2>" +
      "<label>Title<input data-detail=\"title\" value=\"" + esc(spec.title) + "\" maxlength=\"70\"></label>" +
      "<label>Description<textarea data-detail=\"description\" rows=\"3\" maxlength=\"500\">" + esc(spec.description) + "</textarea></label>" +
      "<div class=\"two\"><label>Category<select data-detail=\"category\">" + Core.CATEGORIES.map(function (c) {
        return "<option" + (c === spec.category ? " selected" : "") + ">" + c + "</option>";
      }).join("") + "</select></label>" +
      "<label>Currency<select data-detail=\"currency\">" + Object.keys(Core.CURRENCIES).map(function (c) {
        return "<option" + (c === spec.currency ? " selected" : "") + ">" + c + "</option>";
      }).join("") + "</select></label></div>" +
      "<div class=\"actions\">" +
      "<button class=\"btn\" data-act=\"save\">\ud83d\udcbe Save draft</button>" +
      "<button class=\"btn\" data-act=\"xlsx\">\u2b07 .xlsx</button>" +
      "<button class=\"btn\" data-act=\"csv\">\u2b07 CSV</button>" +
      "<button class=\"btn primary\" data-act=\"publish\">\ud83d\ude80 Publish to market</button>" +
      "<button class=\"btn ghost\" data-act=\"new\">\uff0b New template</button></div>" +
      "</aside>" +
      "<section class=\"work\"><div class=\"workhead\"><h1 id=\"studioTitle\">" + esc(spec.title) + "</h1><span class=\"muted small\">" + (draft.templateId ? "Saved draft" : "Unsaved") + " \u00b7 changes auto-save on this device</span></div>" +
      "<div id=\"preview\"></div><button class=\"btn small\" data-act=\"addrow\">\uff0b Add row</button>" +
      "<details open class=\"editor\"><summary>Columns</summary><div id=\"colEditor\"></div></details>" +
      "<details class=\"editor\"><summary>Dashboard cards</summary><div id=\"sumEditor\"></div></details>" +
      "<details class=\"editor\"><summary>Colour rules</summary><div id=\"ruleEditor\"></div></details>" +
      "</section></div>";
    refreshStudio();
  }

  function refreshStudio() {
    var spec = draft.spec;
    document.getElementById("preview").innerHTML = renderSheet(spec, { editable: true });
    document.getElementById("tweakLog").innerHTML = tweakLog.slice(-8).map(function (m) {
      return "<div class=\"msg " + m.who + "\">" + esc(m.text) + "</div>";
    }).join("") || "<p class=\"muted small\">Type a change and press Apply.</p>";
    var title = document.getElementById("studioTitle");
    if (title) {
      title.textContent = spec.title;
    }
    var colNames = spec.sheet.columns.map(function (c) { return c.name; });
    document.getElementById("colEditor").innerHTML = "<table class=\"edtable\"><thead><tr><th>Name</th><th>Type</th><th>Options / formula</th><th></th></tr></thead><tbody>" +
      spec.sheet.columns.map(function (c, i) {
        var extra = "";
        if (c.type === "select") {
          extra = "<input data-colfield=\"options\" data-colid=\"" + esc(c.id) + "\" value=\"" + esc(c.options.join(", ")) + "\" aria-label=\"Options for " + esc(c.name) + "\">";
        } else if (c.type === "formula") {
          var problem = Core.validateFormula(spec, c.formula, c.name);
          extra = "<input class=\"mono" + (problem ? " bad" : "") + "\" data-colfield=\"formula\" data-colid=\"" + esc(c.id) + "\" value=\"" + esc(c.formula) + "\" aria-label=\"Formula for " + esc(c.name) + "\" title=\"" + esc(problem || "Use [Column Name]") + "\">" +
            "<select data-colfield=\"format\" data-colid=\"" + esc(c.id) + "\" aria-label=\"Result format\">" + ["number", "currency", "percent", "text", "date"].map(function (f) {
              return "<option" + (f === c.format ? " selected" : "") + ">" + f + "</option>";
            }).join("") + "</select>";
        } else {
          extra = "<span class=\"muted small\">\u2014</span>";
        }
        return "<tr><td><input data-colfield=\"name\" data-colid=\"" + esc(c.id) + "\" value=\"" + esc(c.name) + "\" aria-label=\"Column name\"></td>" +
          "<td><select data-colfield=\"type\" data-colid=\"" + esc(c.id) + "\" aria-label=\"Column type\">" + ["text", "number", "currency", "percent", "date", "select", "check", "formula"].map(function (t) {
            return "<option" + (t === c.type ? " selected" : "") + ">" + t + "</option>";
          }).join("") + "</select></td><td class=\"extra\">" + extra + "</td>" +
          "<td class=\"rowbtns\"><button class=\"icon\" data-colmove=\"-1\" data-colid=\"" + esc(c.id) + "\" title=\"Move left\"" + (i === 0 ? " disabled" : "") + ">\u2191</button>" +
          "<button class=\"icon\" data-colmove=\"1\" data-colid=\"" + esc(c.id) + "\" title=\"Move right\"" + (i === spec.sheet.columns.length - 1 ? " disabled" : "") + ">\u2193</button>" +
          "<button class=\"icon danger\" data-coldel=\"" + esc(c.id) + "\" title=\"Delete column\">\u2715</button></td></tr>";
      }).join("") + "</tbody></table>" +
      "<form class=\"inline\" data-addcol><input id=\"newColName\" placeholder=\"New column name\" required maxlength=\"40\"><select id=\"newColType\">" +
      ["auto", "text", "number", "currency", "percent", "date", "select", "check", "formula"].map(function (t) { return "<option>" + t + "</option>"; }).join("") +
      "</select><button class=\"btn small\" type=\"submit\">Add column</button></form>";

    function colSelect(attr, idx, current) {
      return "<select " + attr + "=\"" + idx + "\" data-field=\"column\">" + colNames.map(function (n) {
        return "<option" + (n.toLowerCase() === String(current).toLowerCase() ? " selected" : "") + ">" + esc(n) + "</option>";
      }).join("") + "</select>";
    }
    document.getElementById("sumEditor").innerHTML = spec.summary.map(function (s, i) {
      return "<div class=\"edrow\"><input data-sum=\"" + i + "\" data-field=\"label\" value=\"" + esc(s.label) + "\" aria-label=\"Card label\">" +
        "<select data-sum=\"" + i + "\" data-field=\"fn\">" + ["SUM", "AVERAGE", "MIN", "MAX", "COUNTA", "COUNTIF"].map(function (f) {
          return "<option" + (f === s.fn ? " selected" : "") + ">" + f + "</option>";
        }).join("") + "</select>" + colSelect("data-sum", i, s.column) +
        (s.fn === "COUNTIF" ? "<input data-sum=\"" + i + "\" data-field=\"match\" value=\"" + esc(s.match) + "\" placeholder=\"equals\" aria-label=\"Count when equal to\">" : "") +
        "<button class=\"icon danger\" data-sumdel=\"" + i + "\" title=\"Remove card\">\u2715</button></div>";
    }).join("") + "<button class=\"btn small\" data-act=\"addsum\">\uff0b Add card</button>";
    document.getElementById("ruleEditor").innerHTML = spec.rules.map(function (r, i) {
      return "<div class=\"edrow\">" + colSelect("data-rule", i, r.column) +
        "<select data-rule=\"" + i + "\" data-field=\"op\">" + ["<", ">", "="].map(function (o) {
          return "<option" + (o === r.op ? " selected" : "") + ">" + o + "</option>";
        }).join("") + "</select><input data-rule=\"" + i + "\" data-field=\"value\" value=\"" + esc(r.value) + "\" aria-label=\"Value\">" +
        "<select data-rule=\"" + i + "\" data-field=\"style\">" + [["good", "green"], ["warn", "amber"], ["bad", "red"]].map(function (p) {
          return "<option value=\"" + p[0] + "\"" + (p[0] === r.style ? " selected" : "") + ">" + p[1] + "</option>";
        }).join("") + "</select><button class=\"icon danger\" data-ruledel=\"" + i + "\" title=\"Remove rule\">\u2715</button></div>";
    }).join("") + "<button class=\"btn small\" data-act=\"addrule\">\uff0b Add rule</button>";
    saveDraftLocal();
  }

  function studioChange(e) {
    var t = e.target;
    var spec = draft.spec;
    if (t.dataset.r !== undefined && t.dataset.c) {
      var col = spec.sheet.columns.filter(function (c) { return c.id === t.dataset.c; })[0];
      var value = t.value;
      if (col && (col.type === "number" || col.type === "currency" || col.type === "percent") && value !== "") {
        value = parseFloat(value);
      }
      spec.sheet.rows[+t.dataset.r][t.dataset.c] = value;
      refreshStudio();
      return;
    }
    if (t.dataset.detail) {
      var key = t.dataset.detail;
      if (key === "currency") {
        var res = Core.applyTweak(spec, "currency " + t.value);
        draft.spec = res.spec;
      } else {
        spec[key] = t.value;
      }
      refreshStudio();
      return;
    }
    if (t.dataset.colfield) {
      var c = spec.sheet.columns.filter(function (x) { return x.id === t.dataset.colid; })[0];
      if (!c) {
        return;
      }
      var field = t.dataset.colfield;
      if (field === "name") {
        var problem = Core.renameColumn(spec, c.id, t.value);
        if (problem) {
          toast(problem, "bad");
        }
      } else if (field === "type") {
        c.type = t.value;
        if (c.type === "select" && !c.options) {
          c.options = ["Option A", "Option B", "Option C"];
        }
        if (c.type === "formula" && !c.formula) {
          c.formula = "0";
          c.format = "number";
        }
        draft.spec = Core.normalize(spec);
      } else if (field === "options") {
        c.options = t.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
      } else if (field === "formula") {
        c.formula = t.value.replace(/^=/, "");
        var issue = Core.validateFormula(spec, c.formula, c.name);
        if (issue) {
          toast("Formula: " + issue, "bad");
        }
      } else if (field === "format") {
        c.format = t.value;
      }
      refreshStudio();
      return;
    }
    if (t.dataset.sum !== undefined) {
      spec.summary[+t.dataset.sum][t.dataset.field] = t.value;
      refreshStudio();
      return;
    }
    if (t.dataset.rule !== undefined) {
      var v = t.value;
      if (t.dataset.field === "value" && v !== "" && !isNaN(parseFloat(v)) && isFinite(v)) {
        v = parseFloat(v);
      }
      spec.rules[+t.dataset.rule][t.dataset.field] = v;
      refreshStudio();
    }
  }

  function studioClick(e) {
    var b = e.target.closest("button");
    if (!b) {
      return;
    }
    var spec = draft && draft.spec;
    if (b.dataset.blueprint) {
      var bp = Core.blueprintById(b.dataset.blueprint);
      draft = { spec: Core.specFromBlueprint(bp), templateId: null };
      tweakLog = [{ who: "mint", text: "Started from the \u201c" + bp.title + "\u201d blueprint." }];
      saveDraftLocal();
      viewStudio();
      return;
    }
    if (!spec) {
      return;
    }
    if (b.dataset.theme) {
      spec.theme = b.dataset.theme;
      viewStudio();
      return;
    }
    if (b.dataset.delRow !== undefined) {
      spec.sheet.rows.splice(+b.dataset.delRow, 1);
      refreshStudio();
      return;
    }
    if (b.dataset.coldel) {
      var name = (spec.sheet.columns.filter(function (c) { return c.id === b.dataset.coldel; })[0] || {}).name;
      draft.spec = Core.applyTweak(spec, "remove column " + name).spec;
      refreshStudio();
      return;
    }
    if (b.dataset.colmove) {
      var cols = spec.sheet.columns;
      var i = cols.map(function (c) { return c.id; }).indexOf(b.dataset.colid);
      var j = i + parseInt(b.dataset.colmove, 10);
      if (i >= 0 && j >= 0 && j < cols.length) {
        cols.splice(j, 0, cols.splice(i, 1)[0]);
      }
      refreshStudio();
      return;
    }
    if (b.dataset.sumdel !== undefined) {
      spec.summary.splice(+b.dataset.sumdel, 1);
      refreshStudio();
      return;
    }
    if (b.dataset.ruledel !== undefined) {
      spec.rules.splice(+b.dataset.ruledel, 1);
      refreshStudio();
      return;
    }
    var act = b.dataset.act;
    if (act === "addrow") {
      spec.sheet.rows.push({ id: Core.uid("r") });
      refreshStudio();
    } else if (act === "addsum") {
      spec.summary.push({ id: Core.uid("s"), label: "Total", fn: "SUM", column: spec.sheet.columns[0].name, match: "" });
      refreshStudio();
    } else if (act === "addrule") {
      spec.rules.push({ id: Core.uid("k"), column: spec.sheet.columns[0].name, op: "=", value: "", style: "good" });
      refreshStudio();
    } else if (act === "xlsx") {
      exportXlsx(spec);
    } else if (act === "csv") {
      exportCsv(spec);
    } else if (act === "save") {
      saveDraftToAccount().then(function (ok) {
        if (ok) {
          toast("Draft saved to your account");
          viewStudio();
        }
      });
    } else if (act === "publish") {
      saveDraftToAccount().then(function (ok) {
        if (ok) {
          go("#/publish/" + encodeURIComponent(draft.templateId));
        }
      });
    } else if (act === "new") {
      if (window.confirm("Start a new template? Unsaved changes to this one stay only if you saved the draft.")) {
        draft = null;
        tweakLog = [];
        localStorage.removeItem(DRAFT_KEY);
        viewStudio();
      }
    }
  }

  function saveDraftToAccount() {
    return requireLogin("Log in to save drafts and publish").then(function () {
      return store.saveTemplate(draft.templateId, draft.spec);
    }).then(function (t) {
      draft.templateId = t.id;
      saveDraftLocal();
      return true;
    }).catch(function (err) {
      toast(errorMessage(err), "bad");
      return false;
    });
  }

  function studioSubmit(e) {
    var form = e.target;
    if (form.hasAttribute("data-tweak-form")) {
      e.preventDefault();
      var input = document.getElementById("tweakInput");
      var text = input.value.trim();
      if (!text) {
        return;
      }
      var res = Core.applyTweak(draft.spec, text);
      draft.spec = res.spec;
      tweakLog.push({ who: "you", text: text });
      res.messages.forEach(function (m) {
        tweakLog.push({ who: /^Didn/.test(m) ? "err" : "mint", text: m });
      });
      input.value = "";
      if (/theme|tema|dark|gelap/i.test(text)) {
        viewStudio();
      } else {
        refreshStudio();
      }
      document.getElementById("tweakInput").focus();
    } else if (form.hasAttribute("data-addcol")) {
      e.preventDefault();
      var name = document.getElementById("newColName").value.trim();
      var type = document.getElementById("newColType").value;
      if (!name) {
        return;
      }
      var cmd = "add column " + name + (type !== "auto" ? (type === "formula" ? " = 0" : " as " + type) : "");
      if (type === "formula") {
        var spec = draft.spec;
        spec.sheet.columns.push(Core.makeColumn(name, "formula", { formula: "0", format: "number" }));
        tweakLog.push({ who: "mint", text: "Added formula column \u201c" + name + "\u201d \u2014 edit its formula below." });
      } else {
        var r = Core.applyTweak(draft.spec, cmd);
        draft.spec = r.spec;
        tweakLog.push({ who: "mint", text: r.messages[0] });
      }
      refreshStudio();
    }
  }

  // --- Market
  function viewMarket(query) {
    view.innerHTML = "<section><h1>Template market</h1><form class=\"filters\" data-filter>" +
      "<input type=\"search\" name=\"q\" placeholder=\"Search templates\u2026\" value=\"" + esc(query.q || "") + "\" aria-label=\"Search\">" +
      "<select name=\"category\" aria-label=\"Category\"><option value=\"\">All categories</option>" + Core.CATEGORIES.map(function (c) {
        return "<option" + (query.category === c ? " selected" : "") + ">" + c + "</option>";
      }).join("") + "</select>" +
      "<select name=\"sort\" aria-label=\"Sort\">" + [["new", "Newest"], ["popular", "Best selling"], ["rating", "Top rated"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]].map(function (p) {
        return "<option value=\"" + p[0] + "\"" + (query.sort === p[0] ? " selected" : "") + ">" + p[1] + "</option>";
      }).join("") + "</select>" +
      "<label class=\"check\"><input type=\"checkbox\" name=\"free\" value=\"1\"" + (query.free === "1" ? " checked" : "") + "> Free only</label></form>" +
      "<div class=\"grid\" id=\"marketGrid\"><p class=\"muted\">Loading\u2026</p></div></section>";
    store.browse(query).then(function (items) {
      document.getElementById("marketGrid").innerHTML = items.map(listingCard).join("") ||
        "<div class=\"empty\"><p>No templates match.</p><a class=\"btn primary\" href=\"#/create\">Create the first one</a></div>";
    });
  }

  // --- Item
  function captureRef(id, query) {
    if (query.ref) {
      localStorage.setItem(REF_PREFIX + id, JSON.stringify({ code: query.ref, ts: Date.now() }));
      var flag = "sheetmint.clicked." + query.ref;
      if (!sessionStorage.getItem(flag)) {
        sessionStorage.setItem(flag, "1");
        store.click(query.ref);
      }
    }
  }

  function activeRef(id) {
    try {
      var r = JSON.parse(localStorage.getItem(REF_PREFIX + id));
      if (r && Date.now() - r.ts < REF_DAYS * 86400000) {
        return r.code;
      }
    } catch (err) {
      /* ignore */
    }
    return "";
  }

  function viewItem(id, query) {
    captureRef(id, query);
    view.innerHTML = "<p class=\"muted\">Loading\u2026</p>";
    store.listing(id).then(function (l) {
      var owned = l.owned;
      var price = priceLabel(l);
      var buyArea;
      if (l.isSeller) {
        buyArea = "<p class=\"note\">This is your listing.</p><a class=\"btn block\" href=\"#/kit/" + encodeURIComponent(l.id) + "\">\ud83d\udce3 Content kit</a>";
      } else if (owned) {
        buyArea = "<p class=\"okline\">\u2714 In your library</p><button class=\"btn primary block\" data-dl=\"xlsx\">\u2b07 Download .xlsx</button><button class=\"btn block\" data-dl=\"csv\">\u2b07 CSV</button>";
      } else {
        buyArea = "<button class=\"btn primary block\" data-buy>" + (l.price > 0 ? "Buy now \u2014 " + esc(price) : "Get it free") + "</button>" +
          (l.paymentUrl ? "<a class=\"btn block\" href=\"" + esc(l.paymentUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">Pay on seller\u2019s checkout \u2197</a>" : "") +
          (l.price > 0 ? "<p class=\"muted small\">" + (store.mode === "demo" ? "Demo checkout \u2014 no real money moves." : "Test-mode checkout \u2014 no card is charged.") + (l.paymentUrl ? " For a real purchase use the seller\u2019s checkout." : "") + "</p>" : "");
      }
      var aff = l.commissionPct > 0 && l.price > 0 && !l.isSeller ?
        "<div class=\"panel aff\"><h3>Earn " + l.commissionPct + "% promoting this</h3><p class=\"small\">" + esc(money(l.price * l.commissionPct / 100, l.currency)) + " per sale you refer (30-day attribution).</p><button class=\"btn block\" data-afflink>Get affiliate link</button><div id=\"affOut\"></div></div>" : "";
      view.innerHTML = "<section class=\"item\"><div class=\"itemmain\"><a class=\"muted small\" href=\"#/market\">\u2190 Market</a>" +
        "<h1>" + esc(l.title) + "</h1><p class=\"meta\">by <strong>" + esc(l.sellerName) + "</strong> \u00b7 " + esc(l.category) + " \u00b7 " + stars(l.rating) + (l.ratingCount ? " (" + l.ratingCount + ")" : "") + " \u00b7 " + (l.sales || 0) + " sold</p>" +
        "<p>" + esc(l.description) + "</p>" +
        (l.tags && l.tags.length ? "<p class=\"tags\">" + l.tags.map(function (t) { return "<span>#" + esc(t) + "</span>"; }).join("") + "</p>" : "") +
        "<h2>Live preview</h2>" + renderSheet(l.spec, { maxRows: 8 }) +
        "<p class=\"muted small\">Includes " + l.spec.sheet.columns.length + " columns, " + l.spec.summary.length + " dashboard cards, " + l.spec.rules.length + " colour rules, dropdowns and 200 ready rows. Works in Excel &amp; Google Sheets.</p>" +
        "<h2>Reviews</h2><div id=\"reviews\">" + (l.reviews.length ? l.reviews.map(function (r) {
          return "<div class=\"review\"><div>" + stars(r.rating) + " \u00b7 <strong>" + esc(r.name) + "</strong></div><p>" + esc(r.body) + "</p></div>";
        }).join("") : "<p class=\"muted\">No reviews yet.</p>") + "</div>" +
        (owned ? "<form class=\"panel\" data-review><h3>Rate this template</h3><select name=\"rating\" aria-label=\"Rating\">" + [5, 4, 3, 2, 1].map(function (n) {
          return "<option value=\"" + n + "\">" + "\u2605\u2605\u2605\u2605\u2605".slice(0, n) + "</option>";
        }).join("") + "</select><textarea name=\"body\" rows=\"2\" maxlength=\"800\" placeholder=\"What did it help with?\"></textarea><button class=\"btn\" type=\"submit\">Post review</button></form>" : "") +
        "</div><aside class=\"itemside\"><div class=\"panel buy\"><div class=\"price\">" + esc(price) + "</div>" + buyArea + "</div>" + aff + "</aside></section>";

      view.onclick = function (e) {
        var b = e.target.closest("button");
        if (!b) {
          return;
        }
        if (b.hasAttribute("data-buy")) {
          requireLogin("Log in to get this template").then(function () {
            return store.buy(l.id, activeRef(l.id));
          }).then(function (res) {
            toast(res.alreadyOwned ? "Already in your library" : (l.price > 0 ? "Purchased (test checkout) \u2014 it\u2019s in your library" : "Added to your library"));
            viewItem(id, {});
          }).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        } else if (b.dataset.dl === "xlsx") {
          exportXlsx(l.spec, l.sellerName);
        } else if (b.dataset.dl === "csv") {
          exportCsv(l.spec);
        } else if (b.hasAttribute("data-afflink")) {
          requireLogin("Log in to become an affiliate").then(function () {
            return store.createLink(l.id);
          }).then(function (link) {
            var url = itemLink(l.id, link.code);
            document.getElementById("affOut").innerHTML = "<input readonly value=\"" + esc(url) + "\" aria-label=\"Your affiliate link\"><div class=\"two\"><button class=\"btn small\" data-copy=\"" + esc(url) + "\">Copy link</button><a class=\"btn small\" href=\"#/kit/" + encodeURIComponent(l.id) + "\">Content kit</a></div>";
          }).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        } else if (b.dataset.copy) {
          copy(b.dataset.copy);
        }
      };
      view.onsubmit = function (e) {
        if (e.target.hasAttribute("data-review")) {
          e.preventDefault();
          var f = e.target;
          store.review(l.id, f.rating.value, f.body.value).then(function () {
            toast("Thanks for the review");
            viewItem(id, {});
          }).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        }
      };
    }).catch(function (err) {
      view.innerHTML = "<div class=\"empty\"><h1>Not found</h1><p>" + esc(errorMessage(err)) + "</p><a class=\"btn\" href=\"#/market\">Back to market</a></div>";
    });
  }

  // --- Library
  function viewLibrary() {
    if (!user) {
      return loginWall("Your library", "Templates you buy or claim appear here.");
    }
    view.innerHTML = "<section><h1>Your library</h1><div id=\"lib\"><p class=\"muted\">Loading\u2026</p></div></section>";
    store.library().then(function (items) {
      var el = document.getElementById("lib");
      if (!items.length) {
        el.innerHTML = "<div class=\"empty\"><p>Nothing here yet.</p><a class=\"btn primary\" href=\"#/market\">Browse the market</a></div>";
        return;
      }
      el.innerHTML = "<div class=\"list\">" + items.map(function (it, i) {
        return "<div class=\"row\"><div><strong>" + esc(it.title) + "</strong><div class=\"muted small\">" + (it.price > 0 ? esc(money(it.price, it.currency)) : "Free") + " \u00b7 " + new Date(it.purchased * 1000).toLocaleDateString() + "</div></div>" +
          "<div class=\"rowact\"><button class=\"btn small primary\" data-lib=\"xlsx\" data-i=\"" + i + "\">.xlsx</button><button class=\"btn small\" data-lib=\"csv\" data-i=\"" + i + "\">CSV</button>" +
          "<button class=\"btn small\" data-lib=\"remix\" data-i=\"" + i + "\" title=\"Copy into the Studio for personal edits\">Customize</button><a class=\"btn small ghost\" href=\"#/item/" + encodeURIComponent(it.listingId) + "\">View</a></div></div>";
      }).join("") + "</div><p class=\"muted small\">Purchased templates are licensed for your own use. Re-selling someone else\u2019s template is not allowed.</p>";
      view.onclick = function (e) {
        var b = e.target.closest("button[data-lib]");
        if (!b) {
          return;
        }
        var it = items[+b.dataset.i];
        if (b.dataset.lib === "xlsx") {
          exportXlsx(it.spec);
        } else if (b.dataset.lib === "csv") {
          exportCsv(it.spec);
        } else {
          draft = { spec: Core.normalize(Core.clone(it.spec)), templateId: null };
          draft.spec.title = it.spec.title + " (my copy)";
          tweakLog = [{ who: "mint", text: "Opened a personal copy of \u201c" + it.title + "\u201d." }];
          saveDraftLocal();
          go("#/create");
        }
      };
    }).catch(function (err) {
      document.getElementById("lib").innerHTML = "<p class=\"bad\">" + esc(errorMessage(err)) + "</p>";
    });
  }

  // --- Sell dashboard
  function viewSell() {
    if (!user) {
      return loginWall("Sell templates", "Log in to save drafts, publish and track sales.");
    }
    view.innerHTML = "<section><div class=\"sechead\"><h1>Seller dashboard</h1><a class=\"btn primary\" href=\"#/create\">\uff0b New template</a></div><div id=\"sellBody\"><p class=\"muted\">Loading\u2026</p></div></section>";
    Promise.all([store.seller(), store.myTemplates()]).then(function (res) {
      var s = res[0];
      var drafts = res[1];
      var byCur = {};
      s.listings.forEach(function (l) {
        var k = l.currency;
        byCur[k] = byCur[k] || { gross: 0, fees: 0, commissions: 0, net: 0, sales: 0 };
        byCur[k].gross += l.gross;
        byCur[k].fees += l.fees;
        byCur[k].commissions += l.commissions;
        byCur[k].net += l.net;
        byCur[k].sales += l.sales;
      });
      var kpis = Object.keys(byCur).map(function (k) {
        var v = byCur[k];
        return "<div class=\"kpi\"><span>Sales (" + k + ")</span><b>" + v.sales + "</b></div><div class=\"kpi\"><span>Gross</span><b>" + esc(money(v.gross, k)) + "</b></div>" +
          "<div class=\"kpi\"><span>Platform fee (" + s.platformFeePct + "%)</span><b>" + esc(money(v.fees, k)) + "</b></div><div class=\"kpi\"><span>Affiliate payouts</span><b>" + esc(money(v.commissions, k)) + "</b></div>" +
          "<div class=\"kpi good\"><span>Your earnings</span><b>" + esc(money(v.net, k)) + "</b></div>";
      }).join("") || "<div class=\"kpi\"><span>Sales</span><b>0</b></div><div class=\"kpi\"><span>Your earnings</span><b>" + esc(money(0, "USD")) + "</b></div>";
      document.getElementById("sellBody").innerHTML = "<div class=\"kpis\">" + kpis + "</div>" +
        "<h2>Listings</h2>" + (s.listings.length ? "<div class=\"list\">" + s.listings.map(function (l) {
          return "<div class=\"row\"><div><strong>" + esc(l.title) + "</strong> <span class=\"pill " + (l.status === "live" ? "on" : "") + "\">" + l.status + "</span><div class=\"muted small\">" + esc(priceLabel(l)) + " \u00b7 " + l.sales + " sold \u00b7 affiliate " + l.commissionPct + "% \u00b7 net " + esc(money(l.net, l.currency)) + "</div></div>" +
            "<div class=\"rowact\"><a class=\"btn small\" href=\"#/item/" + encodeURIComponent(l.id) + "\">View</a><a class=\"btn small\" href=\"#/kit/" + encodeURIComponent(l.id) + "\">Content kit</a>" +
            "<button class=\"btn small ghost\" data-status=\"" + esc(l.id) + "\" data-live=\"" + (l.status === "live" ? "0" : "1") + "\">" + (l.status === "live" ? "Unpublish" : "Republish") + "</button></div></div>";
        }).join("") + "</div>" : "<p class=\"muted\">No listings yet \u2014 publish a draft below.</p>") +
        "<h2>Drafts</h2>" + (drafts.length ? "<div class=\"list\">" + drafts.map(function (d, i) {
          return "<div class=\"row\"><div><strong>" + esc(d.title) + "</strong><div class=\"muted small\">" + d.spec.sheet.columns.length + " columns \u00b7 edited " + new Date(d.updated * 1000).toLocaleString() + "</div></div>" +
            "<div class=\"rowact\"><button class=\"btn small\" data-open=\"" + i + "\">Edit</button><a class=\"btn small primary\" href=\"#/publish/" + encodeURIComponent(d.id) + "\">Publish</a><button class=\"btn small ghost danger\" data-deldraft=\"" + esc(d.id) + "\">Delete</button></div></div>";
        }).join("") + "</div>" : "<p class=\"muted\">No saved drafts.</p>") +
        "<h2>Recent sales</h2>" + (s.recent.length ? "<div class=\"list\">" + s.recent.map(function (r) {
          return "<div class=\"row\"><div>" + esc(r.title) + "<div class=\"muted small\">" + new Date(r.created * 1000).toLocaleString() + (r.viaAffiliate ? " \u00b7 via affiliate (\u2212" + esc(money(r.commission, r.currency)) + ")" : "") + "</div></div><strong>" + esc(r.price > 0 ? money(r.price, r.currency) : "Free") + "</strong></div>";
        }).join("") + "</div>" : "<p class=\"muted\">No sales yet. Share your listing with the content kit.</p>");
      view.onclick = function (e) {
        var b = e.target.closest("button");
        if (!b) {
          return;
        }
        if (b.dataset.status) {
          store.setStatus(b.dataset.status, b.dataset.live === "1").then(viewSell).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        } else if (b.dataset.open !== undefined) {
          var d = drafts[+b.dataset.open];
          draft = { spec: Core.normalize(d.spec), templateId: d.id };
          tweakLog = [{ who: "mint", text: "Opened draft \u201c" + d.title + "\u201d." }];
          saveDraftLocal();
          go("#/create");
        } else if (b.dataset.deldraft && window.confirm("Delete this draft?")) {
          store.deleteTemplate(b.dataset.deldraft).then(viewSell);
        }
      };
    }).catch(function (err) {
      document.getElementById("sellBody").innerHTML = "<p class=\"bad\">" + esc(errorMessage(err)) + "</p>";
    });
  }

  // --- Publish
  function viewPublish(templateId) {
    if (!user) {
      return loginWall("Publish", "Log in to publish templates.");
    }
    store.myTemplates().then(function (list) {
      var t = list.filter(function (x) { return x.id === templateId; })[0];
      if (!t) {
        view.innerHTML = "<div class=\"empty\"><p>Draft not found.</p><a class=\"btn\" href=\"#/sell\">Seller dashboard</a></div>";
        return;
      }
      var spec = Core.normalize(t.spec);
      var suggested = spec.currency === "IDR" ? 49000 : 7;
      view.innerHTML = "<section class=\"publish\"><form class=\"panel\" data-publish><h1>Publish \u201c" + esc(spec.title) + "\u201d</h1>" +
        "<label>Listing title<input name=\"title\" required maxlength=\"70\" value=\"" + esc(spec.title) + "\"></label>" +
        "<label>Description<textarea name=\"description\" required rows=\"4\" maxlength=\"1200\">" + esc(spec.description) + "</textarea></label>" +
        "<div class=\"two\"><label>Category<select name=\"category\">" + Core.CATEGORIES.map(function (c) {
          return "<option" + (c === spec.category ? " selected" : "") + ">" + c + "</option>";
        }).join("") + "</select></label><label>Tags (comma separated)<input name=\"tags\" placeholder=\"budget, finance, rupiah\"></label></div>" +
        "<div class=\"two\"><label>Price (" + spec.currency + ") \u2014 0 = free<input name=\"price\" type=\"number\" min=\"0\" step=\"any\" value=\"" + suggested + "\"></label>" +
        "<label>Affiliate commission: <output id=\"commOut\">25%</output><input name=\"commission\" type=\"range\" min=\"0\" max=\"50\" step=\"5\" value=\"25\"></label></div>" +
        "<label>Your payment link (optional)<input name=\"paymentUrl\" type=\"url\" placeholder=\"https://\u2026 Gumroad, Lemon Squeezy, Stripe Payment Link, Lynk.id\"></label>" +
        "<p class=\"muted small\">Platform fee " + store.feePct + "%. Example on a sale of <span id=\"exPrice\"></span>: affiliate gets <span id=\"exAff\"></span>, you keep <span id=\"exNet\"></span> (or <span id=\"exNet2\"></span> without an affiliate).</p>" +
        "<button class=\"btn primary\" type=\"submit\">\ud83d\ude80 Publish to market</button></form>" +
        "<div><h2>Buyer preview</h2>" + renderSheet(spec, { maxRows: 6 }) + "</div></section>";
      var form = view.querySelector("[data-publish]");
      function updateMath() {
        var p = parseFloat(form.price.value) || 0;
        var pct = parseInt(form.commission.value, 10);
        var fee = p * store.feePct / 100;
        var aff = p * pct / 100;
        document.getElementById("commOut").textContent = pct + "%";
        document.getElementById("exPrice").textContent = money(p, spec.currency);
        document.getElementById("exAff").textContent = money(aff, spec.currency);
        document.getElementById("exNet").textContent = money(p - fee - aff, spec.currency);
        document.getElementById("exNet2").textContent = money(p - fee, spec.currency);
      }
      form.oninput = updateMath;
      updateMath();
      form.onsubmit = function (e) {
        e.preventDefault();
        store.publish({
          templateId: t.id,
          title: form.title.value,
          description: form.description.value,
          category: form.category.value,
          tags: form.tags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
          price: parseFloat(form.price.value) || 0,
          currency: spec.currency,
          commissionPct: parseInt(form.commission.value, 10),
          paymentUrl: form.paymentUrl.value.trim(),
          spec: spec
        }).then(function (l) {
          toast("Published! \ud83c\udf89");
          go("#/item/" + encodeURIComponent(l.id));
        }).catch(function (err) {
          toast(errorMessage(err), "bad");
        });
      };
    });
  }

  // --- Affiliate
  function viewAffiliate() {
    if (!user) {
      return loginWall("Affiliate program", "Log in, open any listing with an \u201cEarn %\u201d badge and get your link.");
    }
    view.innerHTML = "<section><div class=\"sechead\"><h1>Affiliate dashboard</h1><a href=\"#/guides/affiliate\">How it works \u2192</a></div><div id=\"affBody\"><p class=\"muted\">Loading\u2026</p></div></section>";
    store.affiliate().then(function (links) {
      var clicks = 0;
      var sales = 0;
      var earned = {};
      links.forEach(function (l) {
        clicks += l.clicks;
        sales += l.sales;
        earned[l.currency] = (earned[l.currency] || 0) + l.earnings;
      });
      var earnedText = Object.keys(earned).map(function (k) { return money(earned[k], k); }).join(" + ") || money(0, "USD");
      document.getElementById("affBody").innerHTML = "<div class=\"kpis\"><div class=\"kpi\"><span>Links</span><b>" + links.length + "</b></div><div class=\"kpi\"><span>Clicks</span><b>" + clicks + "</b></div>" +
        "<div class=\"kpi\"><span>Referred sales</span><b>" + sales + "</b></div><div class=\"kpi good\"><span>Earned</span><b>" + esc(earnedText) + "</b></div>" +
        "<div class=\"kpi\"><span>Conversion</span><b>" + (clicks ? Math.round(sales / clicks * 1000) / 10 + "%" : "\u2014") + "</b></div></div>" +
        (links.length ? "<div class=\"list\">" + links.map(function (l) {
          var url = itemLink(l.listingId, l.code);
          return "<div class=\"row\"><div><strong>" + esc(l.title) + "</strong><div class=\"muted small\">" + l.commissionPct + "% of " + esc(money(l.price, l.currency)) + " \u00b7 " + l.clicks + " clicks \u00b7 " + l.sales + " sales \u00b7 earned " + esc(money(l.earnings, l.currency)) + "</div></div>" +
            "<div class=\"rowact\"><button class=\"btn small\" data-copy=\"" + esc(url) + "\">Copy link</button><a class=\"btn small primary\" href=\"#/kit/" + encodeURIComponent(l.listingId) + "\">Content kit</a></div></div>";
        }).join("") + "</div>" : "<div class=\"empty\"><p>No links yet. Find templates with an <span class=\"badge\">Earn %</span> badge.</p><a class=\"btn primary\" href=\"#/market?sort=popular\">Find templates to promote</a></div>");
      view.onclick = function (e) {
        var b = e.target.closest("button[data-copy]");
        if (b) {
          copy(b.dataset.copy);
        }
      };
    });
  }

  // --- Content kit
  function viewKit(listingId) {
    view.innerHTML = "<p class=\"muted\">Loading\u2026</p>";
    store.listing(listingId).then(function (l) {
      var linkPromise = user && !l.isSeller && l.commissionPct > 0 && l.price > 0 ? store.createLink(l.id).then(function (k) { return itemLink(l.id, k.code); }).catch(function () { return itemLink(l.id); }) : Promise.resolve(itemLink(l.id));
      return linkPromise.then(function (url) {
        var kit = Core.promoKit({ title: l.title, price: l.price, currency: l.currency, category: l.category, description: l.description, spec: l.spec }, url);
        var tabs = [["x", "X / Threads"], ["linkedin", "LinkedIn"], ["tiktok", "TikTok / Reels script"], ["pinterest", "Pinterest"], ["blog", "Blog outline (SEO)"], ["whatsapp", "WhatsApp (ID)"]];
        view.innerHTML = "<section><a class=\"muted small\" href=\"#/item/" + encodeURIComponent(l.id) + "\">\u2190 " + esc(l.title) + "</a><h1>Content kit</h1>" +
          "<p class=\"muted\">Ready-to-post copy with " + (url.indexOf("ref=") !== -1 ? "<strong>your affiliate link</strong>" : "the listing link") + " and a themed share card. Disclose affiliate links where required.</p>" +
          "<div class=\"kit\"><div><div class=\"tabs\" role=\"tablist\">" + tabs.map(function (t, i) {
            return "<button role=\"tab\" class=\"tab" + (i === 0 ? " on" : "") + "\" data-tab=\"" + t[0] + "\">" + t[1] + "</button>";
          }).join("") + "</div><textarea id=\"kitText\" rows=\"12\" aria-label=\"Promo copy\">" + esc(kit.x) + "</textarea>" +
          "<div class=\"two\"><button class=\"btn primary\" data-kitcopy>Copy text</button><button class=\"btn\" data-copy=\"" + esc(url) + "\">Copy link</button></div></div>" +
          "<div><canvas id=\"card\" width=\"1080\" height=\"1080\" aria-label=\"Share card preview\"></canvas><button class=\"btn block\" data-cardpng>\u2b07 Download share card (PNG)</button></div></div></section>";
        drawCard(document.getElementById("card"), l, url);
        view.onclick = function (e) {
          var b = e.target.closest("button");
          if (!b) {
            return;
          }
          if (b.dataset.tab) {
            view.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("on", t === b); });
            document.getElementById("kitText").value = kit[b.dataset.tab];
          } else if (b.hasAttribute("data-kitcopy")) {
            copy(document.getElementById("kitText").value);
          } else if (b.dataset.copy) {
            copy(b.dataset.copy);
          } else if (b.hasAttribute("data-cardpng")) {
            document.getElementById("card").toBlob(function (blob) {
              download(slug(l.title) + "-card.png", blob);
            });
          }
        };
      });
    }).catch(function (err) {
      view.innerHTML = "<div class=\"empty\"><p>" + esc(errorMessage(err)) + "</p></div>";
    });
  }

  function drawCard(canvas, l, url) {
    var ctx = canvas.getContext("2d");
    var t = Core.themeById(l.spec.theme);
    var W = 1080;
    ctx.fillStyle = "#" + t.band;
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "#" + t.header;
    ctx.fillRect(0, 0, W, 300);
    ctx.fillStyle = "#" + t.headerText;
    ctx.font = "bold 64px system-ui, -apple-system, Segoe UI, sans-serif";
    var words = l.title.split(" ");
    var line = "";
    var y = 120;
    words.forEach(function (w) {
      if (ctx.measureText(line + w).width > W - 140) {
        ctx.fillText(line.trim(), 70, y);
        line = "";
        y += 76;
      }
      line += w + " ";
    });
    ctx.fillText(line.trim(), 70, y);
    ctx.font = "32px system-ui, sans-serif";
    ctx.fillText("Excel & Google Sheets template", 70, 270);
    var cols = l.spec.sheet.columns.slice(0, 4);
    var tableX = 70;
    var tableY = 380;
    var colW = (W - 140) / Math.max(1, cols.length);
    ctx.fillStyle = "#" + t.header;
    ctx.fillRect(tableX, tableY, W - 140, 70);
    ctx.fillStyle = "#" + t.headerText;
    ctx.font = "bold 30px system-ui, sans-serif";
    cols.forEach(function (c, i) {
      ctx.fillText(c.name.slice(0, 14), tableX + 20 + i * colW, tableY + 46);
    });
    var computed = Core.compute(l.spec).rows.slice(0, 5);
    ctx.font = "28px system-ui, sans-serif";
    computed.forEach(function (row, r) {
      var ry = tableY + 70 + r * 66;
      ctx.fillStyle = r % 2 ? "#" + t.band : "#" + t.body;
      ctx.fillRect(tableX, ry, W - 140, 66);
      ctx.fillStyle = "#" + t.bodyText;
      row.cells.slice(0, 4).forEach(function (cell, i) {
        ctx.fillText(String(cell.display).slice(0, 15), tableX + 20 + i * colW, ry + 44);
      });
    });
    ctx.fillStyle = "#" + t.accent;
    var pillY = 830;
    ctx.fillRect(70, pillY, 300, 90);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.fillText(priceLabel(l), 100, pillY + 62);
    ctx.fillStyle = "#" + (t.dark ? t.bodyText : "334155");
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("sheetmint \u00b7 link in bio", 420, pillY + 58);
  }

  // --- Guides
  function viewGuides(slugName) {
    if (slugName) {
      var g = Guides.filter(function (x) { return x.slug === slugName; })[0];
      if (g) {
        view.innerHTML = "<article class=\"guide narrow\"><a class=\"muted small\" href=\"#/guides\">\u2190 All guides</a><h1>" + g.icon + " " + esc(g.title) + "</h1>" + g.body +
          "<div class=\"guidenav\">" + Guides.filter(function (x) { return x !== g; }).slice(0, 3).map(guideCard).join("") + "</div></article>";
        return;
      }
    }
    view.innerHTML = "<section><h1>Creator guides</h1><p class=\"muted\">Make, theme, price, promote and sell spreadsheet templates.</p><div class=\"guides\">" + Guides.map(guideCard).join("") + "</div></section>";
  }

  // --- Account & auth
  function authForms(reason) {
    return "<div class=\"authwrap\">" + (reason ? "<p class=\"note\">" + esc(reason) + "</p>" : "") +
      "<form class=\"panel\" data-login><h2>Log in</h2><label>Email<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>" +
      "<label>Password<input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label><button class=\"btn primary block\" type=\"submit\">Log in</button></form>" +
      "<form class=\"panel\" data-register><h2>Create account</h2><label>Name<input name=\"name\" autocomplete=\"name\" required maxlength=\"60\"></label>" +
      "<label>Email<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>" +
      "<label>Password (8+ characters)<input name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" required></label>" +
      "<button class=\"btn primary block\" type=\"submit\">Create account</button></form></div>" +
      (store.mode === "demo" ? "<p class=\"muted small center\">Demo mode: accounts live only in this browser. Run the Sheetmint server for real shared accounts.</p>" : "");
  }

  function handleAuthSubmit(e, done) {
    var f = e.target;
    var isLogin = f.hasAttribute("data-login");
    var isRegister = f.hasAttribute("data-register");
    if (!isLogin && !isRegister) {
      return false;
    }
    e.preventDefault();
    var p = isLogin ? store.login(f.email.value, f.password.value) : store.register(f.email.value, f.name.value, f.password.value);
    p.then(function (u) {
      user = u;
      renderHeader();
      toast("Welcome, " + u.name);
      done(u);
    }).catch(function (err) {
      toast(errorMessage(err), "bad");
    });
    return true;
  }

  function openAuth(reason, resolve) {
    var modal = document.getElementById("modal");
    modal.innerHTML = "<div class=\"modalbox\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Log in\"><button class=\"icon close\" data-close aria-label=\"Close\">\u2715</button>" + authForms(reason) + "</div>";
    modal.hidden = false;
    pendingAuth = resolve;
    modal.onsubmit = function (e) {
      handleAuthSubmit(e, function (u) {
        modal.hidden = true;
        var cb = pendingAuth;
        pendingAuth = null;
        if (cb) {
          cb(u);
        }
      });
    };
    modal.onclick = function (e) {
      if (e.target === modal || e.target.closest("[data-close]")) {
        modal.hidden = true;
        pendingAuth = null;
      }
    };
    var first = modal.querySelector("input");
    if (first) {
      first.focus();
    }
  }

  function loginWall(title, text) {
    view.innerHTML = "<section class=\"narrow\"><h1>" + esc(title) + "</h1><p class=\"muted\">" + esc(text) + "</p>" + authForms("") + "</section>";
    view.onsubmit = function (e) {
      handleAuthSubmit(e, function () {
        render();
      });
    };
  }

  function viewAccount() {
    if (!user) {
      return loginWall("Account", "Log in or create an account to buy, sell and earn as an affiliate.");
    }
    var cfg = aiConfig();
    view.innerHTML = "<section class=\"narrow\"><h1>Account</h1><div class=\"panel\"><p><strong>" + esc(user.name) + "</strong><br><span class=\"muted\">" + esc(user.email) + "</span></p>" +
      "<p class=\"small\">Mode: <strong>" + (store.mode === "server" ? "Server (shared marketplace)" : "Demo (this browser only)") + "</strong> \u00b7 platform fee " + store.feePct + "%</p>" +
      "<button class=\"btn\" data-logout>Log out</button>" + (store.mode === "demo" ? " <button class=\"btn ghost danger\" data-reset>Reset demo data</button>" : "") + "</div>" +
      "<form class=\"panel\" data-ai><h2>Optional: use your own AI</h2><p class=\"muted small\">The built-in generator works offline. To let an LLM design templates, add any OpenAI-compatible endpoint. Your key stays in this browser and is sent only to that endpoint.</p>" +
      "<label>Endpoint<input name=\"endpoint\" placeholder=\"https://api.openai.com/v1\" value=\"" + esc(cfg.endpoint || "") + "\"></label>" +
      "<div class=\"two\"><label>Model<input name=\"model\" placeholder=\"gpt-4o-mini\" value=\"" + esc(cfg.model || "") + "\"></label><label>API key<input name=\"key\" type=\"password\" value=\"" + esc(cfg.key || "") + "\"></label></div>" +
      "<button class=\"btn\" type=\"submit\">Save AI settings</button></form></section>";
    view.onclick = function (e) {
      var b = e.target.closest("button");
      if (!b) {
        return;
      }
      if (b.hasAttribute("data-logout")) {
        store.logout().then(function () {
          user = null;
          renderHeader();
          go("#/");
        });
      } else if (b.hasAttribute("data-reset") && window.confirm("Erase all demo accounts, listings and sales in this browser?")) {
        store.reset().then(function () {
          user = null;
          renderHeader();
          go("#/");
        });
      }
    };
    view.onsubmit = function (e) {
      if (e.target.hasAttribute("data-ai")) {
        e.preventDefault();
        var f = e.target;
        localStorage.setItem(AI_KEY, JSON.stringify({ endpoint: f.endpoint.value.trim(), model: f.model.value.trim(), key: f.key.value.trim() }));
        toast("AI settings saved");
      }
    };
  }

  // ------------------------------------------------------------------ shell
  function renderHeader() {
    var acc = document.getElementById("accountBtn");
    acc.textContent = user ? user.name.split(" ")[0] : "Log in";
    document.getElementById("modeBadge").textContent = store.mode === "server" ? "Live" : "Demo";
    document.getElementById("modeBadge").title = store.mode === "server" ? "Connected to the Sheetmint server" : "Demo mode: data stays in this browser, checkout moves no money";
    var r = route().parts[0] || "";
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      a.classList.toggle("on", a.dataset.nav === r || (r === "item" && a.dataset.nav === "market") || (r === "publish" && a.dataset.nav === "sell") || (r === "kit" && a.dataset.nav === "affiliate"));
    });
  }

  function render() {
    var r = route();
    view.onclick = null;
    view.onchange = null;
    view.onsubmit = null;
    renderHeader();
    window.scrollTo(0, 0);
    var page = r.parts[0] || "";
    if (page === "create") {
      viewStudio();
      view.onchange = studioChange;
      view.onclick = studioClick;
      view.onsubmit = function (e) {
        if (e.target.hasAttribute("data-prompt-form")) {
          promptSubmit(e);
        } else {
          studioSubmit(e);
        }
      };
      return;
    }
    if (page === "market") {
      viewMarket(r.query);
      view.onchange = function (e) {
        var f = e.target.form;
        if (f && f.hasAttribute("data-filter")) {
          filterGo(f);
        }
      };
      view.onsubmit = function (e) {
        if (e.target.hasAttribute("data-filter")) {
          e.preventDefault();
          filterGo(e.target);
        }
      };
      return;
    }
    if (page === "item") {
      return viewItem(r.parts[1], r.query);
    }
    if (page === "library") {
      return viewLibrary();
    }
    if (page === "sell") {
      return viewSell();
    }
    if (page === "publish") {
      return viewPublish(r.parts[1]);
    }
    if (page === "affiliate") {
      return viewAffiliate();
    }
    if (page === "kit") {
      return viewKit(r.parts[1]);
    }
    if (page === "guides") {
      return viewGuides(r.parts[1]);
    }
    if (page === "account") {
      return viewAccount();
    }
    viewHome();
    view.onsubmit = promptSubmit;
  }

  function filterGo(f) {
    var params = [];
    ["q", "category", "sort"].forEach(function (k) {
      if (f[k].value) {
        params.push(k + "=" + encodeURIComponent(f[k].value));
      }
    });
    if (f.free.checked) {
      params.push("free=1");
    }
    go("#/market" + (params.length ? "?" + params.join("&") : ""));
  }

  function promptSubmit(e) {
    if (!e.target.hasAttribute("data-prompt-form")) {
      return;
    }
    e.preventDefault();
    var ta = e.target.querySelector("textarea");
    var ai = e.target.querySelector("[data-use-ai]");
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Generating\u2026";
    generateDraft(ta.value, ai && ai.checked).then(function (ok) {
      btn.disabled = false;
      btn.textContent = "\u2728 Generate";
      if (ok) {
        go("#/create");
      }
    });
  }

  function init() {
    view = document.getElementById("view");
    var savedTheme = localStorage.getItem(UI_THEME_KEY);
    if (savedTheme) {
      document.documentElement.setAttribute("data-ui", savedTheme);
    }
    document.getElementById("uiThemeBtn").onclick = function () {
      var next = document.documentElement.getAttribute("data-ui") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-ui", next);
      localStorage.setItem(UI_THEME_KEY, next);
    };
    document.getElementById("accountBtn").onclick = function () {
      go("#/account");
    };
    document.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-example]");
      if (chip) {
        var form = chip.closest("form");
        form.querySelector("textarea").value = chip.dataset.example;
        form.querySelector("textarea").focus();
      }
    });
    loadDraftLocal();
    window.SheetmintStore.connect().then(function (s) {
      store = s;
      return store.me();
    }).then(function (u) {
      user = u;
      window.addEventListener("hashchange", render);
      render();
    }).catch(function (err) {
      view.innerHTML = "<div class=\"empty\"><p>Could not start: " + esc(errorMessage(err)) + "</p></div>";
    });
    if ("serviceWorker" in navigator && /^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
