/* Mint — UI. Hash router + views. All data goes through MintStore. */
(function () {
  "use strict";

  var Core = window.MintCore;
  var X = window.MintXlsx;
  var Guides = window.MintGuides;
  var DRAFT_KEY = "mint.studio";
  var AI_KEY = "mint.ai";
  var UI_THEME_KEY = "mint.uitheme";
  var REF_PREFIX = "mint.ref.";
  var REF_DAYS = 30;

  var store = null;
  var user = null;
  var view = null;
  var draft = null;
  var tweakLog = [];
  var pendingAuth = null;

  // Inside the Android/iPhone app shell (Capacitor around this same site) a few things work differently.
  var NATIVE = /MintApp\//.test(navigator.userAgent) || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var APK_URL = "https://github.com/juw12/projects/releases/download/mint-android/Mint-android.apk";
  var BASE_TITLE = document.title;
  var installPrompt = null;
  var countsAt = 0;

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

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).split(",")[1] || "");
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsDataURL(blob);
    });
  }

  // WebViews ignore <a download>; the app saves the file to its cache and opens the phone's share sheet
  // (Save to Files / Drive, WhatsApp, open in Excel or Sheets).
  function nativeSave(name, blob) {
    var plugins = window.Capacitor && window.Capacitor.Plugins;
    if (!NATIVE || !plugins || !plugins.Filesystem || !plugins.Share) {
      return false;
    }
    blobToBase64(blob).then(function (data) {
      return plugins.Filesystem.writeFile({ path: name, data: data, directory: "CACHE" });
    }).then(function (written) {
      return plugins.Share.share({ title: name, files: [written.uri], dialogTitle: "Save or open " + name }).catch(function (err) {
        if (!/cancel/i.test(String((err && err.message) || err))) {
          throw err;
        }
      });
    }).catch(function (err) {
      toast("Couldn\u2019t save the file: " + errorMessage(err), "bad");
    });
    return true;
  }

  function openExternal(url) {
    if (NATIVE) {
      // The app shell hands other sites (checkouts, links) to the phone's browser.
      window.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    if (nativeSave(name, blob)) {
      return;
    }
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
    var bytes = X.build(spec, { author: author || (user && user.name) || "Mint", footer: "Made with Mint." });
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
      html += "<th title=\"" + esc(c.type + (c.formula ? " = " + c.formula : "")) + "\">" + esc(c.name) + (c.type === "formula" ? " <span class=\"fx\">fx</span>" : "") + (c.locked ? " <span class=\"fx lock\" title=\"Formula included in the full template\">\ud83d\udd12 fx</span>" : "") + "</th>";
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
    return fetch(cfg.endpoint.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model || "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: Core.aiSystemPrompt() },
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
    function fallback(err) {
      var g = Core.generate(prompt);
      g.notes.unshift("AI unavailable (" + errorMessage(err) + ") \u2014 used the quick generator.");
      return g;
    }
    var path;
    if (useAi && cfg.endpoint && cfg.key) {
      path = aiGenerate(prompt).then(function (spec) {
        return { spec: spec, notes: ["Generated with your AI model (" + (cfg.model || "default") + ")."] };
      }).catch(fallback);
    } else if (useAi && store.ai) {
      path = store.aiTemplate(prompt).then(function (res) {
        var spec = Core.normalize(res.spec);
        spec.prompt = prompt;
        var notes = ["Designed by Mint AI. Tweak anything below \u2014 or ask in words."];
        if (typeof res.remaining === "number" && res.remaining <= 3) {
          notes.push(res.remaining + " AI generations left today.");
        }
        return { spec: spec, notes: notes };
      }).catch(fallback);
    } else {
      path = Promise.resolve(Core.generate(prompt));
    }
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
      (cfg.endpoint && cfg.key ? "<label class=\"aitoggle\"><input type=\"checkbox\" data-use-ai checked> Use my AI</label>" :
        (store && store.ai ? "<label class=\"aitoggle\" title=\"Designed by an AI model; the quick generator is used if AI is busy\"><input type=\"checkbox\" data-use-ai checked> Mint AI</label>" : "")) +
      "<button class=\"btn primary\" type=\"submit\">\u2728 Generate</button></div></form>";
  }

  function viewHome() {
    var html = "<section class=\"hero\"><h1>Prompt a spreadsheet template.<br><span>Tweak it. Sell it.</span></h1>" +
      "<p class=\"lede\">Describe what you need in English or Bahasa Indonesia. Mint builds a themed Excel / Google Sheets template with live formulas, dropdowns and a dashboard \u2014 then publish it to the market, or let affiliates sell it for you.</p>" +
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
      var flag = "mint.clicked." + query.ref;
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
      } else if (l.pendingOrder) {
        var po = l.pendingOrder;
        buyArea = "<div class=\"orderbox\"><p class=\"small\"><strong>Order " + esc(po.ref) + "</strong> \u2014 waiting for payment</p>" +
          "<ol class=\"steps small\"><li>Pay " + esc(money(po.price, po.currency)) + " on the seller\u2019s checkout.</li><li>Put <strong>" + esc(po.ref) + "</strong> in the payment note.</li><li>The seller confirms \u2192 it unlocks in your library.</li></ol>" +
          (l.paymentUrl ? "<a class=\"btn primary block\" href=\"" + esc(l.paymentUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">Pay on " + esc(l.paymentHost || "seller\u2019s checkout") + " \u2197</a>" : "") +
          "<button class=\"btn block\" data-copy=\"" + esc(po.ref) + "\">Copy reference " + esc(po.ref) + "</button>" +
          "<button class=\"btn ghost block small\" data-cancel-order=\"" + esc(po.id) + "\">Cancel order</button></div>";
      } else {
        buyArea = "<button class=\"btn primary block\" data-buy>" + (l.price > 0 ? "Buy \u2014 " + esc(price) : "Get it free") + "</button>" +
          (l.price > 0 ? "<p class=\"muted small\">" + (store.mode === "cloud" ? (l.paymentHost ? "You\u2019ll pay on <strong>" + esc(l.paymentHost) + "</strong>. " : "") + "You pay the seller directly on their checkout (QRIS, e-wallet, card\u2026). Your order reference unlocks the template once the seller confirms. Your name and email are shared with the seller for this order." : "Offline \u2014 connect to buy.") + "</p>" : "");
      }
      var aff = l.commissionPct > 0 && l.price > 0 && !l.isSeller ?
        "<div class=\"panel aff\"><h3>Earn " + l.commissionPct + "% promoting this</h3><p class=\"small\">" + esc(money(l.price * l.commissionPct / 100, l.currency)) + " per sale you refer (30-day attribution).</p><button class=\"btn block\" data-afflink>Get affiliate link</button><div id=\"affOut\"></div></div>" : "";
      view.innerHTML = "<section class=\"item\"><div class=\"itemmain\"><a class=\"muted small\" href=\"#/market\">\u2190 Market</a>" +
        "<h1>" + esc(l.title) + "</h1><p class=\"meta\">by <strong>" + esc(l.sellerName) + "</strong> \u00b7 " + esc(l.category) + " \u00b7 " + stars(l.rating) + (l.ratingCount ? " (" + l.ratingCount + ")" : "") + " \u00b7 " + (l.sales || 0) + " sold</p>" +
        "<p>" + esc(l.description) + "</p>" +
        (l.tags && l.tags.length ? "<p class=\"tags\">" + l.tags.map(function (t) { return "<span>#" + esc(t) + "</span>"; }).join("") + "</p>" : "") +
        "<h2>Live preview</h2>" + (l.spec.preview ? "<p class=\"note small\" data-preview-note>\ud83d\udd12 Preview \u2014 columns marked \ud83d\udd12 show sample results only. The formulas, dropdown logic and dashboard come with the file after purchase.</p>" : "") + renderSheet(l.spec, { maxRows: 8 }) +
        "<p class=\"muted small\">Includes " + l.spec.sheet.columns.length + " columns, " + l.spec.summary.length + " dashboard cards, " + l.spec.rules.length + " colour rules, dropdowns and 200 ready rows. Works in Excel &amp; Google Sheets.</p>" +
        "<h2>Reviews</h2><div id=\"reviews\">" + (l.reviews.length ? l.reviews.map(function (r) {
          return "<div class=\"review\"><div>" + stars(r.rating) + " \u00b7 <strong>" + esc(r.name) + "</strong></div><p>" + esc(r.body) + "</p></div>";
        }).join("") : "<p class=\"muted\">No reviews yet.</p>") + "</div>" +
        (owned ? "<form class=\"panel\" data-review><h3>Rate this template</h3><select name=\"rating\" aria-label=\"Rating\">" + [5, 4, 3, 2, 1].map(function (n) {
          return "<option value=\"" + n + "\">" + "\u2605\u2605\u2605\u2605\u2605".slice(0, n) + "</option>";
        }).join("") + "</select><textarea name=\"body\" rows=\"2\" maxlength=\"800\" placeholder=\"What did it help with?\"></textarea><button class=\"btn\" type=\"submit\">Post review</button></form>" : "") +
        (!l.isSeller && store.mode === "cloud" ? "<p class=\"muted small\"><button type=\"button\" class=\"linkbtn\" data-report" + (l.reported ? " disabled" : "") + ">" + (l.reported ? "Reported \u2014 thanks, we\u2019ll take a look" : "\u26a0 Report this template") + "</button></p>" : "") +
        "</div><aside class=\"itemside\"><div class=\"panel buy\"><div class=\"price\">" + esc(price) + "</div>" + buyArea + "</div>" + aff + "</aside></section>";

      view.onclick = function (e) {
        var b = e.target.closest("button");
        if (!b) {
          return;
        }
        if (b.hasAttribute("data-buy")) {
          var payWindow = null;
          requireLogin("Log in to get this template").then(function () {
            if (l.price > 0 && store.mode === "cloud" && !NATIVE) {
              payWindow = window.open("", "_blank");
            }
            return store.order(l.id, activeRef(l.id));
          }).then(function (res) {
            if (res.order.status === "paid") {
              if (payWindow) {
                payWindow.close();
              }
              toast(res.existing ? "Already in your library" : "Added to your library \ud83c\udf89");
            } else {
              if (payWindow && res.paymentUrl) {
                payWindow.location = res.paymentUrl;
              } else if (payWindow) {
                payWindow.close();
              } else if (NATIVE && res.paymentUrl) {
                openExternal(res.paymentUrl);
              }
              toast("Order " + res.order.ref + " created \u2014 pay on the seller\u2019s checkout and add the reference");
            }
            refreshCounts(true);
            viewItem(id, {});
          }).catch(function (err) {
            if (payWindow) {
              payWindow.close();
            }
            toast(errorMessage(err), "bad");
          });
        } else if (b.hasAttribute("data-report")) {
          requireLogin("Log in to report a template").then(function () {
            var reason = window.prompt("What\u2019s wrong with this template? (copied, misleading, broken, spam, offensive\u2026)");
            if (!reason || !reason.trim()) {
              return null;
            }
            return store.report(l.id, reason.trim()).then(function () {
              toast("Thanks \u2014 report sent");
              viewItem(id, {});
            });
          }).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        } else if (b.dataset.cancelOrder) {
          if (window.confirm("Cancel this order? Only do this if you haven\u2019t paid.")) {
            store.orderAction(b.dataset.cancelOrder, "cancel").then(function () {
              toast("Order cancelled");
              viewItem(id, {});
            }).catch(function (err) {
              toast(errorMessage(err), "bad");
            });
          }
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
    view.innerHTML = "<section><h1>Your library</h1><div id=\"orders\"></div><div id=\"lib\"><p class=\"muted\">Loading\u2026</p></div></section>";
    store.orders().then(function (orders) {
      var open = orders.filter(function (o) { return o.status === "pending"; });
      var closed = orders.filter(function (o) { return o.status === "rejected"; }).slice(0, 5);
      if (!open.length && !closed.length) {
        return;
      }
      document.getElementById("orders").innerHTML = "<h2>Orders</h2><div class=\"list\">" + open.concat(closed).map(function (o) {
        return "<div class=\"row\"><div><strong>" + esc(o.title) + "</strong> <span class=\"pill" + (o.status === "pending" ? " warn" : "") + "\">" + (o.status === "pending" ? "waiting for seller" : o.status) + "</span>" +
          "<div class=\"muted small\">" + esc(o.ref) + " \u00b7 " + esc(money(o.price, o.currency)) + " \u00b7 " + esc(o.sellerName) + "</div></div>" +
          "<div class=\"rowact\">" + (o.paymentUrl ? "<a class=\"btn small primary\" href=\"" + esc(o.paymentUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">Pay \u2197</a>" : "") +
          "<a class=\"btn small\" href=\"#/item/" + encodeURIComponent(o.listingId) + "\">View</a></div></div>";
      }).join("") + "</div><p class=\"muted small\">Paid already? The seller confirms your payment using the reference \u2014 the template then appears below.</p>";
    }).catch(function () {});
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
      var pendingHtml = s.pending && s.pending.length ? "<h2>Orders to confirm <span class=\"pill warn\">" + s.pending.length + "</span></h2><p class=\"muted small\">Check your payment app for the reference in the payment note, then confirm. Confirmed buyers can download immediately.</p><div class=\"list\">" + s.pending.map(function (o) {
        return "<div class=\"row\"><div><strong>" + esc(o.ref) + "</strong> \u00b7 " + esc(o.title) + "<div class=\"muted small\">" + esc(o.buyerName) + " &lt;" + esc(o.buyerEmail) + "&gt; \u00b7 " + esc(money(o.price, o.currency)) + " \u00b7 " + new Date(o.created * 1000).toLocaleString() + (o.viaAffiliate ? " \u00b7 via affiliate" : "") + "</div></div>" +
          "<div class=\"rowact\"><button class=\"btn small primary\" data-order=\"" + esc(o.id) + "\" data-act=\"confirm\">Payment received</button><button class=\"btn small ghost danger\" data-order=\"" + esc(o.id) + "\" data-act=\"reject\">Not paid</button></div></div>";
      }).join("") + "</div>" : "";
      var owed = (s.payouts || []).filter(function (p) { return !p.commissionPaid; });
      var payoutHtml = s.payouts && s.payouts.length ? "<h2>Affiliate commissions</h2><p class=\"muted small\">Pay affiliates to the details they gave, then mark it paid.</p><div class=\"list\">" + s.payouts.map(function (p) {
        return "<div class=\"row\"><div><strong>" + esc(money(p.commission, p.currency)) + "</strong> \u2192 " + esc(p.affiliateName) + " <span class=\"pill" + (p.commissionPaid ? " on" : " warn") + "\">" + (p.commissionPaid ? "paid" : "owed") + "</span>" +
          "<div class=\"muted small\">" + esc(p.title) + " \u00b7 " + esc(p.ref) + " \u00b7 " + (p.affiliatePayout ? "pay to: " + esc(p.affiliatePayout) : "affiliate hasn\u2019t added payout details yet") + "</div></div>" +
          (p.commissionPaid ? "" : "<div class=\"rowact\"><button class=\"btn small\" data-order=\"" + esc(p.id) + "\" data-act=\"commission-paid\">Mark paid</button></div>") + "</div>";
      }).join("") + "</div>" + (owed.length ? "" : "") : "";
      document.getElementById("sellBody").innerHTML = "<div class=\"kpis\">" + kpis + "</div>" + pendingHtml +
        "<h2>Listings</h2>" + (s.listings.length ? "<div class=\"list\">" + s.listings.map(function (l) {
          return "<div class=\"row\"><div><strong>" + esc(l.title) + "</strong> <span class=\"pill " + (l.status === "live" ? "on" : "") + "\">" + l.status + "</span><div class=\"muted small\">" + esc(priceLabel(l)) + " \u00b7 " + l.sales + " sold \u00b7 affiliate " + l.commissionPct + "% \u00b7 net " + esc(money(l.net, l.currency)) + "</div></div>" +
            "<div class=\"rowact\"><a class=\"btn small\" href=\"#/item/" + encodeURIComponent(l.id) + "\">View</a><a class=\"btn small\" href=\"#/kit/" + encodeURIComponent(l.id) + "\">Content kit</a>" +
            "<button class=\"btn small\" data-edit=\"" + esc(l.id) + "\">Edit</button>" +
            "<button class=\"btn small ghost\" data-status=\"" + esc(l.id) + "\" data-live=\"" + (l.status === "live" ? "0" : "1") + "\">" + (l.status === "live" ? "Unpublish" : "Republish") + "</button></div>" +
            "<form class=\"editform\" data-editform=\"" + esc(l.id) + "\" hidden><div class=\"two\"><label>Price (" + esc(l.currency) + ")<input name=\"price\" type=\"number\" min=\"0\" step=\"any\" value=\"" + l.price + "\"></label>" +
            "<label>Affiliate %<input name=\"commission\" type=\"number\" min=\"0\" max=\"50\" step=\"5\" value=\"" + l.commissionPct + "\"></label></div>" +
            "<label>Payment link<input name=\"paymentUrl\" type=\"url\" value=\"" + esc(l.paymentUrl || "") + "\" placeholder=\"https://\"></label><button class=\"btn small primary\" type=\"submit\">Save</button></form></div>";
        }).join("") + "</div>" : "<p class=\"muted\">No listings yet \u2014 publish a draft below.</p>") + payoutHtml +
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
        if (b.dataset.order) {
          var act = b.dataset.act;
          if (act === "reject" && !window.confirm("Mark this order as not paid? The buyer can order again.")) {
            return;
          }
          store.orderAction(b.dataset.order, act).then(function () {
            refreshCounts(true);
            toast(act === "confirm" ? "Confirmed \u2014 the buyer can download now" : act === "reject" ? "Order rejected" : "Commission marked paid");
            viewSell();
          }).catch(function (err) {
            toast(errorMessage(err), "bad");
          });
        } else if (b.dataset.edit) {
          var ef = view.querySelector("[data-editform=\"" + b.dataset.edit + "\"]");
          ef.hidden = !ef.hidden;
        } else if (b.dataset.status) {
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
      view.onsubmit = function (e) {
        var f = e.target;
        if (!f.hasAttribute("data-editform")) {
          return;
        }
        e.preventDefault();
        store.editListing(f.dataset.editform, {
          price: parseFloat(f.price.value) || 0,
          commissionPct: parseInt(f.commission.value, 10) || 0,
          paymentUrl: f.paymentUrl.value.trim()
        }).then(function () {
          toast("Listing updated");
          viewSell();
        }).catch(function (err) {
          toast(errorMessage(err), "bad");
        });
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
        "<label>Your payment link <span class=\"muted small\">(required for paid templates)</span><input name=\"paymentUrl\" type=\"url\" placeholder=\"https://lynk.id/\u2026 \u00b7 saweria.co/\u2026 \u00b7 Stripe/PayPal/Gumroad link\"></label>" +
        "<p class=\"muted small\">Buyers pay you directly there and add their order reference; you confirm in your dashboard and they get the file. Mint never holds your money.</p>" +
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
    store.affiliate().then(function (res) {
      var links = res.links;
      var clicks = 0;
      var sales = 0;
      var earned = {};
      links.forEach(function (l) {
        clicks += l.clicks;
        sales += l.sales;
        earned[l.currency] = (earned[l.currency] || 0) + l.earnings;
      });
      var earnedText = Object.keys(earned).map(function (k) { return money(earned[k], k); }).join(" + ") || money(0, "USD");
      var payoutForm = "<form class=\"panel\" data-payout><h3>Where should sellers pay you?</h3><p class=\"muted small\">Shown only to sellers who owe you commission. E.g. \u201cBCA 1234567 a.n. Your Name\u201d, \u201cGoPay 0812\u2026\u201d or a PayPal email.</p>" +
        "<input name=\"payout\" maxlength=\"300\" value=\"" + esc(res.payoutInfo || "") + "\" placeholder=\"Bank / e-wallet / PayPal\"><button class=\"btn small\" type=\"submit\">Save payout details</button></form>";
      document.getElementById("affBody").innerHTML = payoutForm + "<div class=\"kpis\"><div class=\"kpi\"><span>Links</span><b>" + links.length + "</b></div><div class=\"kpi\"><span>Clicks</span><b>" + clicks + "</b></div>" +
        "<div class=\"kpi\"><span>Referred sales</span><b>" + sales + "</b></div><div class=\"kpi good\"><span>Earned</span><b>" + esc(earnedText) + "</b></div>" +
        "<div class=\"kpi\"><span>Conversion</span><b>" + (clicks ? Math.round(sales / clicks * 1000) / 10 + "%" : "\u2014") + "</b></div></div>" +
        (links.length ? "<div class=\"list\">" + links.map(function (l) {
          var url = itemLink(l.listingId, l.code);
          return "<div class=\"row\"><div><strong>" + esc(l.title) + "</strong><div class=\"muted small\">" + l.commissionPct + "% of " + esc(money(l.price, l.currency)) + " \u00b7 " + l.clicks + " clicks \u00b7 " + l.sales + " sales" + (l.pendingSales ? " (+" + l.pendingSales + " awaiting payment)" : "") + " \u00b7 earned " + esc(money(l.earnings, l.currency)) + " \u00b7 paid out " + esc(money(l.paidOut || 0, l.currency)) + "</div></div>" +
            "<div class=\"rowact\"><button class=\"btn small\" data-copy=\"" + esc(url) + "\">Copy link</button><a class=\"btn small primary\" href=\"#/kit/" + encodeURIComponent(l.listingId) + "\">Content kit</a></div></div>";
        }).join("") + "</div>" : "<div class=\"empty\"><p>No links yet. Find templates with an <span class=\"badge\">Earn %</span> badge.</p><a class=\"btn primary\" href=\"#/market?sort=popular\">Find templates to promote</a></div>");
      view.onclick = function (e) {
        var b = e.target.closest("button[data-copy]");
        if (b) {
          copy(b.dataset.copy);
        }
      };
      view.onsubmit = function (e) {
        if (!e.target.hasAttribute("data-payout")) {
          return;
        }
        e.preventDefault();
        store.updateProfile({ payoutInfo: e.target.payout.value.trim() }).then(function (u) {
          user = u;
          toast("Payout details saved");
        }).catch(function (err) {
          toast(errorMessage(err), "bad");
        });
      };
    }).catch(function (err) {
      document.getElementById("affBody").innerHTML = "<p class=\"bad\">" + esc(errorMessage(err)) + "</p>";
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
    ctx.fillText("mint \u00b7 link in bio", 420, pillY + 58);
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
      "<label>Password<input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label><button class=\"btn primary block\" type=\"submit\">Log in</button>" +
      (store.mode === "cloud" ? "<button type=\"button\" class=\"linkbtn\" data-forgot>Forgot password?</button>" : "") + "</form>" +
      "<form class=\"panel\" data-register><h2>Create account</h2><label>Name<input name=\"name\" autocomplete=\"name\" required maxlength=\"60\"></label>" +
      "<label>Email<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>" +
      "<label>Password (8+ characters)<input name=\"password\" type=\"password\" autocomplete=\"new-password\" minlength=\"8\" required></label>" +
      "<button class=\"btn primary block\" type=\"submit\">Create account</button></form></div>" +
      (store.mode === "offline" ? "<p class=\"muted small center\">Mint is offline right now \u2014 this account only lives in this browser until the connection is back.</p>" : "<p class=\"muted small center\">Your account works on every device. Passwords are hashed; we never see them.</p>");
  }

  function recoverForm() {
    return "<form class=\"panel\" data-recover><h2>Reset password</h2><p class=\"muted small\">Use the recovery code you saved when you created your account (MINT-XXXX-XXXX-XXXX). Without it the account can\u2019t be recovered \u2014 Mint stores no other way to prove it\u2019s you.</p>" +
      "<label>Email<input name=\"email\" type=\"email\" autocomplete=\"email\" required></label>" +
      "<label>Recovery code<input name=\"code\" required autocomplete=\"off\" autocapitalize=\"characters\" placeholder=\"MINT-XXXX-XXXX-XXXX\"></label>" +
      "<label>New password (8+ characters)<input name=\"password\" type=\"password\" minlength=\"8\" autocomplete=\"new-password\" required></label>" +
      "<button class=\"btn primary block\" type=\"submit\">Reset and log in</button><button type=\"button\" class=\"linkbtn\" data-back-login>Back to log in</button></form>";
  }

  function loginForm() {
    var holder = document.createElement("div");
    holder.innerHTML = authForms("");
    return holder.querySelector("form[data-login]").outerHTML;
  }

  // Shown once after sign-up or a reset; the server keeps only a hash of it.
  function showRecoveryCode(code, intro) {
    if (!code) {
      return;
    }
    var modal = document.getElementById("modal");
    var email = user ? user.email : "";
    modal.innerHTML = "<div class=\"modalbox\" role=\"dialog\" aria-modal=\"true\" aria-label=\"Your recovery code\"><h2>\ud83d\udd11 Save your recovery code</h2>" +
      "<p>" + esc(intro) + "</p><p class=\"rcode\" data-rcode>" + esc(code) + "</p>" +
      "<div class=\"two\"><button class=\"btn\" data-rcopy>Copy</button><button class=\"btn\" data-rsave>Save as file</button></div>" +
      "<label class=\"checkline\"><input type=\"checkbox\" data-rack> I saved it somewhere safe</label>" +
      "<button class=\"btn primary block\" data-rdone disabled>Done</button></div>";
    modal.hidden = false;
    modal.onsubmit = null;
    modal.onchange = function (e) {
      if (e.target.hasAttribute("data-rack")) {
        modal.querySelector("[data-rdone]").disabled = !e.target.checked;
      }
    };
    modal.onclick = function (e) {
      var b = e.target.closest("button");
      if (!b) {
        return;
      }
      if (b.hasAttribute("data-rcopy")) {
        copy(code);
      } else if (b.hasAttribute("data-rsave")) {
        download("mint-recovery-code.txt", "Mint recovery code" + (email ? " for " + email : "") + "\n\n" + code +
          "\n\nIf you forget your password: Log in > Forgot password? > enter your email, this code and a new password.\nThe code works once; Mint shows a new one after you use it.\n", "text/plain");
      } else if (b.hasAttribute("data-rdone")) {
        modal.hidden = true;
        modal.onchange = null;
      }
    };
  }

  function handleAuthSubmit(e, done) {
    if (e.target.hasAttribute("data-recover")) {
      e.preventDefault();
      var rf = e.target;
      store.recover(rf.email.value, rf.code.value, rf.password.value).then(function (u) {
        user = u;
        renderHeader();
        done(u);
        showRecoveryCode(store.lastRecoveryCode, "Password changed and other devices signed out. Your old recovery code is used up \u2014 here is the new one.");
      }).catch(function (err) {
        toast(errorMessage(err), "bad");
      });
      return true;
    }
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
      if (isRegister && store.mode === "cloud") {
        showRecoveryCode(store.lastRecoveryCode, "If you ever forget your password, this code is the only way back into your account. Keep it in your notes or password manager.");
      }
      refreshCounts(true);
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

  function securityPanels() {
    var codeText = store.hasRecoveryCode ?
      "You have a recovery code. Lost it? Make a new one \u2014 the old one stops working." :
      "You don\u2019t have a recovery code yet. Make one now so you can reset a forgotten password.";
    return "<form class=\"panel\" data-password><h2>Change password</h2>" +
      "<label>Current password<input name=\"current\" type=\"password\" autocomplete=\"current-password\" required></label>" +
      "<label>New password (8+ characters)<input name=\"next\" type=\"password\" minlength=\"8\" autocomplete=\"new-password\" required></label>" +
      "<button class=\"btn\" type=\"submit\">Change password</button><p class=\"muted small\">Your other devices are signed out.</p></form>" +
      "<form class=\"panel\" data-newcode><h2>Recovery code</h2><p class=\"muted small\" data-code-state>" + codeText + "</p>" +
      "<label>Password<input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>" +
      "<button class=\"btn\" type=\"submit\">New recovery code</button></form>" +
      "<form class=\"panel dangerzone\" data-delete><h2>Delete account</h2><p class=\"muted small\">Removes your login, drafts, affiliate links and payout details and takes your listings off the market. " +
      "Buyers keep templates they already paid for and order records stay for their bookkeeping. This can\u2019t be undone.</p>" +
      "<label>Password<input name=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>" +
      "<label>Type DELETE to confirm<input name=\"confirm\" required autocomplete=\"off\"></label>" +
      "<button class=\"btn danger\" type=\"submit\">Delete my account</button></form>";
  }

  function securitySubmit(f) {
    if (f.hasAttribute("data-password")) {
      store.changePassword(f.current.value, f.next.value).then(function () {
        f.reset();
        toast("Password changed \u2014 other devices signed out");
      }).catch(function (err) {
        toast(errorMessage(err), "bad");
      });
      return true;
    }
    if (f.hasAttribute("data-newcode")) {
      store.newRecoveryCode(f.password.value).then(function (code) {
        f.reset();
        store.hasRecoveryCode = true;
        showRecoveryCode(code, "Your previous recovery code no longer works. Save this new one.");
      }).catch(function (err) {
        toast(errorMessage(err), "bad");
      });
      return true;
    }
    if (f.hasAttribute("data-delete")) {
      if (f.confirm.value.trim().toUpperCase() !== "DELETE") {
        toast("Type DELETE to confirm", "bad");
        return true;
      }
      store.deleteAccount(f.password.value).then(function () {
        user = null;
        applyCounts(null);
        renderHeader();
        toast("Your account was deleted");
        go("#/");
      }).catch(function (err) {
        toast(errorMessage(err), "bad");
      });
      return true;
    }
    return false;
  }

  // --- Install / phone apps
  function viewInstall() {
    var ua = navigator.userAgent;
    var isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);
    var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    if (NATIVE || standalone) {
      view.innerHTML = "<section class=\"narrow\"><h1>\ud83d\udcf2 You\u2019re using the Mint app</h1><p class=\"muted\">It always loads the latest version of Mint, so there\u2019s nothing to update by hand.</p><a class=\"btn primary\" href=\"#/\">Back to Mint</a></section>";
      return;
    }
    var android = "<div class=\"panel" + (isAndroid ? " pick" : "") + "\" data-install-android><h2>\ud83e\udd16 Android</h2>" +
      "<p><a class=\"btn primary\" href=\"" + APK_URL + "\" rel=\"noopener\">\u2b07 Download the Android app (APK)</a></p>" +
      "<ol class=\"steps small\"><li>Open the downloaded <strong>Mint-android.apk</strong>.</li><li>Allow installs from your browser when Android asks (one time).</li><li>Open Mint from your home screen. Same account and templates as the website.</li></ol>" +
      (installPrompt ? "<p class=\"muted small\">Or install straight from Chrome:</p><button class=\"btn\" data-install-pwa>Install from Chrome</button>" : "<p class=\"muted small\">Prefer no APK? In Chrome open the \u22ee menu \u2192 <strong>Install app</strong> / <strong>Add to Home screen</strong>.</p>") + "</div>";
    var ios = "<div class=\"panel" + (isIos ? " pick" : "") + "\" data-install-ios><h2>\ud83d\udcf1 iPhone &amp; iPad</h2>" +
      "<ol class=\"steps small\"><li>Open <strong>juw12.github.io/projects/mint</strong> in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong> (the square with the arrow) \u2192 <strong>Add to Home Screen</strong> \u2192 <strong>Add</strong>.</li><li>Open Mint from the home screen \u2014 it runs full-screen with its own icon.</li></ol>" +
      "<p class=\"muted small\">Not in the App Store yet (that needs an Apple developer account). The home-screen app is the same Mint with the same account.</p></div>";
    var desktop = "<div class=\"panel\"><h2>\ud83d\udcbb Computer</h2><p class=\"small\">Chrome or Edge: click the install icon in the address bar (or menu \u2192 <strong>Install Mint</strong>). Everything also works right here in the browser.</p>" +
      (installPrompt && !isAndroid ? "<button class=\"btn\" data-install-pwa>Install Mint</button>" : "") + "</div>";
    var order = isIos ? [ios, android, desktop] : isAndroid ? [android, ios, desktop] : [desktop, android, ios];
    view.innerHTML = "<section class=\"narrow\"><h1>\ud83d\udcf2 Get the Mint app</h1><p class=\"muted\">One account everywhere: web, Android and iPhone. The apps load the live Mint, so new features arrive without updating.</p>" + order.join("") + "</section>";
    view.onclick = function (e) {
      var b = e.target.closest("button[data-install-pwa]");
      if (!b || !installPrompt) {
        return;
      }
      installPrompt.prompt();
      installPrompt.userChoice.then(function (choice) {
        installPrompt = null;
        if (choice && choice.outcome === "accepted") {
          toast("Installed \ud83c\udf89");
        }
        viewInstall();
      });
    };
  }

  // --- Notification badges (orders to confirm, commissions owed, orders awaiting payment)
  function setBadge(nav, n) {
    document.querySelectorAll("[data-nav=\"" + nav + "\"]").forEach(function (a) {
      var b = a.querySelector(".nbadge");
      if (!n) {
        if (b) {
          b.remove();
        }
        return;
      }
      if (!b) {
        b = document.createElement("span");
        b.className = "nbadge";
        a.appendChild(b);
      }
      b.textContent = n > 9 ? "9+" : String(n);
      b.title = n + " waiting for you";
    });
  }

  function applyCounts(c) {
    var sell = c ? (c.ordersToConfirm || 0) + (c.commissionsOwed || 0) : 0;
    var library = c ? c.awaitingPayment || 0 : 0;
    setBadge("sell", sell);
    setBadge("library", library);
    var urgent = c ? c.ordersToConfirm || 0 : 0;
    document.title = (urgent ? "(" + urgent + ") " : "") + BASE_TITLE;
  }

  function refreshCounts(force) {
    if (!store || store.mode !== "cloud" || !user) {
      applyCounts(null);
      return;
    }
    if (!force && Date.now() - countsAt < 15000) {
      applyCounts(store.counts);
      return;
    }
    countsAt = Date.now();
    store.me().then(function (u) {
      if (!u) {
        user = null;
        renderHeader();
      }
      applyCounts(u ? store.counts : null);
    }).catch(function () {});
  }

  function viewAccount() {
    if (!user) {
      return loginWall("Account", "Log in or create an account to buy, sell and earn as an affiliate.");
    }
    var cfg = aiConfig();
    view.innerHTML = "<section class=\"narrow\"><h1>Account</h1><div class=\"panel\"><p><strong>" + esc(user.name) + "</strong><br><span class=\"muted\">" + esc(user.email) + "</span></p>" +
      "<p class=\"small\">" + (store.mode === "cloud" ? "Connected to Mint \u00b7 platform fee " + store.feePct + "%" + (store.ai ? " \u00b7 Mint AI on" : "") : "Offline \u2014 changes stay in this browser") + "</p>" +
      "<button class=\"btn\" data-logout>Log out</button>" + (store.mode === "offline" ? " <button class=\"btn ghost danger\" data-reset>Clear offline data</button>" : "") + "</div>" +
      "<form class=\"panel\" data-profile><h2>Profile & payouts</h2><label>Display name<input name=\"name\" maxlength=\"60\" required value=\"" + esc(user.name) + "\"></label>" +
      "<label>Affiliate payout details<input name=\"payout\" maxlength=\"300\" value=\"" + esc(user.payoutInfo || "") + "\" placeholder=\"BCA 1234567 a.n. Name \u00b7 GoPay 0812\u2026 \u00b7 PayPal email\"></label>" +
      "<button class=\"btn\" type=\"submit\">Save</button></form>" +
      (store.mode === "cloud" ? securityPanels() : "") +
      (NATIVE ? "" : "<div class=\"panel\"><h2>\ud83d\udcf2 Mint on your phone</h2><p class=\"muted small\">Android app, iPhone home-screen app, or install from your browser.</p><a class=\"btn\" href=\"#/install\">Get the app</a></div>") +
      "<form class=\"panel\" data-ai><h2>Advanced: your own AI model</h2><p class=\"muted small\">Mint AI is built in. If you prefer your own OpenAI-compatible model, add it here \u2014 the key stays in this browser and is sent only to that endpoint.</p>" +
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
          applyCounts(null);
          renderHeader();
          go("#/");
        });
      } else if (b.hasAttribute("data-reset") && window.confirm("Erase the offline data stored in this browser?")) {
        store.reset().then(function () {
          user = null;
          renderHeader();
          go("#/");
        });
      }
    };
    view.onsubmit = function (e) {
      if (securitySubmit(e.target)) {
        e.preventDefault();
        return;
      }
      if (e.target.hasAttribute("data-profile")) {
        e.preventDefault();
        store.updateProfile({ name: e.target.name.value.trim(), payoutInfo: e.target.payout.value.trim() }).then(function (u) {
          user = u;
          renderHeader();
          toast("Saved");
        }).catch(function (err) {
          toast(errorMessage(err), "bad");
        });
        return;
      }
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
    document.getElementById("modeBadge").textContent = store.mode === "cloud" ? "Live" : "Offline";
    document.getElementById("modeBadge").classList.toggle("off", store.mode !== "cloud");
    document.getElementById("modeBadge").title = store.mode === "cloud" ? "Connected to Mint" : "Can\u2019t reach Mint \u2014 working offline in this browser";
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
    refreshCounts(false);
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
    if (page === "install") {
      return viewInstall();
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
    document.documentElement.classList.toggle("native-app", NATIVE);
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPrompt = e;
    });
    window.addEventListener("appinstalled", function () {
      installPrompt = null;
    });
    setInterval(function () {
      if (document.visibilityState === "visible") {
        refreshCounts(true);
      }
    }, 60000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        refreshCounts(false);
      }
    });
    document.addEventListener("click", function (e) {
      var forgot = e.target.closest("[data-forgot]");
      if (forgot) {
        var loginEl = forgot.closest("form");
        var email = loginEl.email ? loginEl.email.value : "";
        loginEl.outerHTML = recoverForm();
        var rec = document.querySelector("form[data-recover]");
        rec.email.value = email;
        (email ? rec.code : rec.email).focus();
        return;
      }
      var back = e.target.closest("[data-back-login]");
      if (back) {
        back.closest("form").outerHTML = loginForm();
        return;
      }
      var chip = e.target.closest("[data-example]");
      if (chip) {
        var form = chip.closest("form");
        form.querySelector("textarea").value = chip.dataset.example;
        form.querySelector("textarea").focus();
      }
    });
    loadDraftLocal();
    window.MintStore.connect().then(function (s) {
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
