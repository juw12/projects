/*
  Bridge dashboard
  - Operator: screen inquiries, get suggested matches, introduce, track deals & fees,
    onboard / publish client companies.
  - Company owner: see introductions made to them, update status, edit their portal.
*/
(function () {
  "use strict";

  const view = document.getElementById("view");
  const state = {
    me: null,
    tab: "overview",
    inquiryFilter: { status: "", type: "" },
    openInquiry: null,
    companies: []
  };

  const INQUIRY_STATUSES = ["new", "screening", "introduced", "in_talks", "won", "lost", "spam"];
  const INTRO_STATUSES = ["sent", "accepted", "declined", "in_talks", "won", "lost"];

  // ------------------------------------------------------------ utilities

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      el.classList.remove("show");
    }, 2800);
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin"
    }).then(function (response) {
      if (response.status === 401) {
        location.href = "/?next=/bridge";
        throw new Error("Please log in");
      }
      return response.json().then(function (data) {
        if (!response.ok) {
          throw new Error(data.error || "Request failed");
        }
        return data;
      });
    });
  }

  function money(value) {
    const n = Number(value || 0);
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function date(value) {
    return value ? new Date(value).toLocaleDateString() : "";
  }

  function scoreBadge(score, label) {
    return '<span class="score ' + esc(label) + '">' + esc(label.toUpperCase()) + " " + score + "</span>";
  }

  const ACRONYMS = { nda: "NDA", rfq: "RFQ", id: "ID", url: "URL", cad: "CAD" };

  // "in_talks" -> "In talks", "investorType" -> "Investor type", "nda" -> "NDA"
  function humanize(value) {
    const words = String(value || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(function (word) {
        return ACRONYMS[word] || word;
      });
    const text = words.join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function options(list, selected) {
    return list.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === selected ? " selected" : "") + ">" + esc(humanize(s)) + "</option>";
    }).join("");
  }

  function fieldList(fields) {
    return '<dl class="kv">' + Object.keys(fields).map(function (key) {
      const value = Array.isArray(fields[key]) ? fields[key].join(", ") : fields[key];
      return "<dt>" + esc(humanize(key)) + "</dt><dd>" + esc(value) + "</dd>";
    }).join("") + "</dl>";
  }

  // ------------------------------------------------------------ shell

  const ICONS = {
    overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    building: '<path d="M4 21V5l8-3v19M12 9h8v12M8 8h.01M8 12h.01M8 16h.01M16 13h.01M16 17h.01M2 21h20"/>',
    portal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };

  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  const PAGES = {
    overview: { title: "Overview", operator: "Pipeline, introductions and revenue across the network.", owner: "Your showcase traffic and the introductions we make for you." },
    inquiries: { title: "Inquiries", operator: "Screen incoming requests, review suggested matches and make introductions.", owner: "" },
    companies: { title: "Companies", operator: "Onboard client companies, edit their showcase and control publishing.", owner: "" },
    portal: { title: "My showcase", operator: "", owner: "Preview and edit your public showcase." }
  };

  function renderTabs() {
    const operator = state.me.is_operator;
    const items = operator
      ? [["overview", "Overview", "overview"], ["inquiries", "Inquiries", "inbox"], ["companies", "Companies", "building"]]
      : [["overview", "Overview", "overview"], ["inquiries", "Introductions", "inbox"], ["portal", "My showcase", "portal"]];
    let html = '<div class="side-label">Workspace</div>' + items.map(function (t) {
      const badge = t[0] === "inquiries" && state.awaiting ? '<span class="count">' + state.awaiting + "</span>" : "";
      return '<button data-tab="' + t[0] + '" class="' + (state.tab === t[0] ? "active" : "") + '">' + icon(t[2]) + t[1] + badge + "</button>";
    }).join("");
    html += '<div class="side-label">Links</div>';
    if (operator) {
      html += '<a href="/outreach">' + icon("send") + "Outreach pipeline</a>";
    }
    html += '<a href="/hub" target="_blank">' + icon("globe") + "Public hub</a>";
    document.getElementById("tabs").innerHTML = html;

    const page = PAGES[state.tab];
    const label = state.tab === "inquiries" && !operator ? "Introductions" : page.title;
    document.getElementById("pageTitle").textContent = label;
    document.getElementById("pageSub").textContent = operator ? page.operator : (page.owner || "Introductions made to your company by " + state.me.hub + ".");
    document.getElementById("pageActions").innerHTML = operator && state.tab === "companies"
      ? '<a class="btn btn-primary btn-sm" href="#onboard" id="onboardJump">' + icon("plus") + "Onboard company</a>"
      : '<a class="btn btn-light btn-sm" href="/hub" target="_blank">' + icon("external") + "View hub</a>";
  }

  function render() {
    renderTabs();
    view.innerHTML = '<div class="card empty">Loading…</div>';
    if (state.tab === "overview") {
      renderOverview();
    } else if (state.tab === "inquiries") {
      renderInquiries();
    } else if (state.tab === "companies") {
      renderCompanies();
    } else if (state.tab === "portal") {
      renderPortal();
    }
  }

  document.getElementById("tabs").addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab]");
    if (button) {
      state.tab = button.dataset.tab;
      state.openInquiry = null;
      render();
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", function () {
    api("POST", "/api/auth/logout", {}).finally(function () {
      location.href = "/";
    });
  });

  // ------------------------------------------------------------ overview

  function bars(map) {
    const keys = Object.keys(map || {});
    if (!keys.length) {
      return '<p class="muted">No data yet.</p>';
    }
    const max = Math.max.apply(null, keys.map(function (k) {
      return map[k];
    }));
    return keys.sort(function (a, b) {
      return map[b] - map[a];
    }).map(function (k) {
      return '<div class="bar-row"><span style="text-transform:capitalize">' + esc(k.replace("_", " ")) +
        '</span><div class="bar-track"><div class="bar-fill" style="width:' + Math.round((map[k] / max) * 100) +
        '%"></div></div><b>' + map[k] + "</b></div>";
    }).join("");
  }

  function renderOverview() {
    api("GET", "/api/ic/stats").then(function (s) {
      if (s.is_operator) {
        const published = (s.companies_by_status || {}).published || 0;
        const drafts = (s.companies_by_status || {}).draft || 0;
        view.innerHTML =
          '<div class="grid grid-4">' +
          '<div class="kpi"><span>Awaiting screening</span><b>' + s.awaiting_screening + "</b><small>" + s.hot_awaiting + " hot</small></div>" +
          '<div class="kpi"><span>Introductions made</span><b>' + s.intros + "</b></div>" +
          '<div class="kpi"><span>Deals won</span><b>' + s.won + "</b><small>value " + money(s.deal_value_won) + "</small></div>" +
          '<div class="kpi"><span>Success fees earned</span><b>' + money(s.fees_won) + "</b></div>" +
          "</div>" +
          '<div class="grid grid-3" style="margin-top:20px">' +
          '<div class="card"><h3>Inquiries by type</h3>' + bars(s.inquiries_by_type) + "</div>" +
          '<div class="card"><h3>Pipeline status</h3>' + bars(s.inquiries_by_status) + "</div>" +
          '<div class="card"><h3>Network</h3><p><b>' + published + "</b> published · <b>" + drafts + "</b> draft companies</p>" +
          "<h4>Most viewed (30 days)</h4>" + (s.top_companies_30d.length ? s.top_companies_30d.map(function (c) {
            return '<div class="bar-row" style="grid-template-columns:1fr 50px"><a href="/c/' + esc(c.slug) + '/" target="_blank">' + esc(c.name) + "</a><b>" + c.views + "</b></div>";
          }).join("") : '<p class="muted">No companies yet.</p>') + "</div></div>" +
          '<div class="card" style="margin-top:20px"><h3>Your bridge workflow</h3><ol class="muted" style="margin:0;padding-left:18px">' +
          "<li>Prospect manufacturers in <a href=\"/outreach\">Outreach</a> (industry: <b>manufacturer</b>). Closing a lead creates their account and a draft portal.</li>" +
          "<li>Fill in their content under <b>Companies</b>, then publish. They appear on the <a href=\"/hub\" target=\"_blank\">hub</a>.</li>" +
          "<li>Screen every inquiry under <b>Inquiries</b>, use the suggested matches, and introduce.</li>" +
          "<li>Record deal value and your success fee when a deal closes.</li></ol></div>";
      } else {
        view.innerHTML =
          '<div class="grid grid-4">' +
          '<div class="kpi"><span>Showcase views (30 days)</span><b>' + s.views_30d + "</b></div>" +
          Object.keys(INTRO_STATUSES.reduce(function (acc, k) {
            acc[k] = 1;
            return acc;
          }, {})).slice(0, 3).map(function (k) {
            return '<div class="kpi"><span>Introductions: ' + esc(k.replace("_", " ")) + "</span><b>" + ((s.intros_by_status || {})[k] || 0) + "</b></div>";
          }).join("") + "</div>" +
          '<div class="grid grid-2" style="margin-top:20px">' +
          '<div class="card"><h3>Most viewed sections</h3>' + (s.views_by_page_30d.length ? s.views_by_page_30d.map(function (p) {
            return '<div class="bar-row" style="grid-template-columns:1fr 50px"><span>' + esc(p.page) + "</span><b>" + p.n + "</b></div>";
          }).join("") : '<p class="muted">No views yet. Your showcase is counted once it is published.</p>') + "</div>" +
          '<div class="card"><h3>How introductions work</h3><p class="muted">' + esc(state.me.hub) +
          " screens every buyer, investor and supplier inquiry and introduces only qualified ones. Update each introduction's status so we can follow up for you.</p></div></div>";
      }
    }).catch(function (error) {
      view.innerHTML = '<div class="card empty">' + esc(error.message) + "</div>";
    });
  }

  // ------------------------------------------------------------ inquiries (operator) / introductions (owner)

  function renderInquiries() {
    const f = state.inquiryFilter;
    const query = "?status=" + encodeURIComponent(f.status) + "&type=" + encodeURIComponent(f.type);
    Promise.all([
      api("GET", "/api/ic/inquiries" + (state.me.is_operator ? query : "")),
      state.me.is_operator ? api("GET", "/api/ic/companies") : Promise.resolve({ companies: [] })
    ]).then(function (results) {
      const items = results[0].inquiries;
      state.companies = results[1].companies;
      if (state.me.is_operator) {
        drawOperatorInquiries(items);
      } else {
        drawOwnerIntros(items);
      }
    }).catch(function (error) {
      view.innerHTML = '<div class="card empty">' + esc(error.message) + "</div>";
    });
  }

  function chipRow(name, values, current) {
    return '<div class="chips" data-filter="' + name + '"><span class="label">' + esc(name) + "</span>" + [""].concat(values).map(function (v) {
      return '<button class="chip' + (v === current ? " active" : "") + '" data-value="' + esc(v) + '">' + esc(v ? humanize(v) : "All") + "</button>";
    }).join("") + "</div>";
  }

  function drawOperatorInquiries(items) {
    const f = state.inquiryFilter;
    view.innerHTML =
      '<div class="filters">' +
      chipRow("status", INQUIRY_STATUSES, f.status) +
      chipRow("type", ["customer", "investor", "supplier", "listing", "general"], f.type) + "</div>" +
      '<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr>' +
      "<th>Date</th><th>Ref</th><th>Type</th><th>From</th><th>Source</th><th>Score</th><th>Status</th><th>Intros</th></tr></thead><tbody>" +
      (items.length ? items.map(function (q) {
        const open = state.openInquiry === q.id;
        return '<tr class="row-click' + (open ? " row-open" : "") + '" data-open="' + q.id + '"><td>' + date(q.created_at) + "</td><td><code>" + esc(q.ref) + "</code></td>" +
          '<td><span class="type-tag ' + esc(q.type) + '">' + esc(q.type) + "</span></td>" +
          "<td><b>" + esc(q.organisation || q.name) + '</b><br><span class="muted">' + esc(q.email) + "</span></td>" +
          "<td>" + esc(q.source) + "</td><td>" + scoreBadge(q.score, q.label) + "</td>" +
          '<td><span class="pill-status ' + esc(q.status) + '">' + esc(humanize(q.status)) + "</span></td><td>" + q.intros.length + "</td></tr>" +
          (open ? '<tr class="detail-panel"><td colspan="8" id="detail-' + q.id + '">' + inquiryDetail(q) + "</td></tr>" : "");
      }).join("") : '<tr><td colspan="8" class="empty">No inquiries yet. Share your hub link or publish a company portal.</td></tr>') +
      "</tbody></table></div>";

    view.querySelectorAll("[data-filter]").forEach(function (row) {
      row.addEventListener("click", function (event) {
        const chip = event.target.closest("[data-value]");
        if (chip) {
          state.inquiryFilter[row.dataset.filter] = chip.dataset.value;
          renderInquiries();
        }
      });
    });
    view.querySelectorAll("[data-open]").forEach(function (row) {
      row.addEventListener("click", function () {
        state.openInquiry = state.openInquiry === row.dataset.open ? null : row.dataset.open;
        drawOperatorInquiries(items);
      });
    });
    if (state.openInquiry) {
      const q = items.find(function (i) {
        return i.id === state.openInquiry;
      });
      if (q) {
        bindInquiryDetail(q);
      }
    }
  }

  function inquiryDetail(q) {
    const companyOptions = state.companies.filter(function (c) {
      return c.status !== "archived" && !q.intros.some(function (i) {
        return i.company_id === c.id;
      });
    }).map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.name) + " (" + esc(humanize(c.status)) + ")</option>";
    }).join("");
    return '<div class="detail-grid2">' +
      "<div><h4>Request</h4>" + fieldList(q.fields) +
      (q.intros.length ? "<h4 style=\"margin-top:14px\">Introduced to</h4>" + q.intros.map(function (i) {
        return '<div class="match"><span>' + esc(i.company_name) + "<small>" + date(i.created_at) + '</small></span><span class="pill-status ' + esc(i.status) + '">' + esc(humanize(i.status)) + "</span></div>";
      }).join("") : "") + "</div>" +
      "<div>" +
      '<h4>Suggested matches</h4><div id="matches-' + q.id + '"><p class="muted">Finding matches…</p></div>' +
      '<div class="mini-form" style="margin-top:12px">' +
      '<select id="introCompany-' + q.id + '"><option value="">Introduce to a company…</option>' + companyOptions + "</select>" +
      '<textarea id="introNote-' + q.id + '" placeholder="Note to the company (context, why it is a fit)…"></textarea>' +
      '<label class="inline-check"><input type="checkbox" id="introShare-' + q.id + '" checked> Share requester contact details</label>' +
      '<label class="inline-check"><input type="checkbox" id="introNotify-' + q.id + '"> Email the requester that we made the intro</label>' +
      '<button class="btn btn-primary btn-sm" data-introduce="' + q.id + '">Introduce</button></div>' +
      '<h4 style="margin-top:18px">Deal tracking</h4><div class="mini-form">' +
      '<select id="status-' + q.id + '">' + options(INQUIRY_STATUSES, q.status) + "</select>" +
      '<input id="deal-' + q.id + '" type="number" min="0" placeholder="Deal value" value="' + esc(q.deal_value == null ? "" : q.deal_value) + '">' +
      '<input id="fee-' + q.id + '" type="number" min="0" placeholder="Your success fee" value="' + esc(q.fee == null ? "" : q.fee) + '">' +
      '<textarea id="notes-' + q.id + '" placeholder="Private notes">' + esc(q.notes || "") + "</textarea>" +
      '<button class="btn btn-dark btn-sm" data-save="' + q.id + '">Save</button></div></div></div>' +
      (QUOTE_TYPES.indexOf(q.type) >= 0 ? quotesPanel(q) : "");
  }

  // ------------------------------------------------------------ supplier quotes (RFQ comparison)

  const QUOTE_TYPES = ["customer", "general"];

  function quotesPanel(q) {
    return '<div class="quotes-box"><h4>Supplier quotes for this RFQ</h4>' +
      '<p class="muted" style="margin:0 0 10px">Paste a supplier quote (e-mail text, any of EN / 中文 / Bahasa) or attach .xlsx / .csv / .txt / .eml. ' +
      'Titian extracts prices, tooling, MOQ and lead times, converts to USD and ranks cost per piece at the buyer\'s volumes.</p>' +
      '<div class="quote-form">' +
      '<input id="qSupplier-' + q.id + '" placeholder="Supplier name (optional)">' +
      '<input id="qFile-' + q.id + '" type="file" accept=".xlsx,.xlsm,.csv,.txt,.eml,.pdf">' +
      '<textarea id="qText-' + q.id + '" placeholder="…or paste the quote here"></textarea>' +
      '<button class="btn btn-primary btn-sm" data-add-quote="' + q.id + '">Add quote</button></div>' +
      '<div class="quote-volumes">Target volume <input id="qTarget-' + q.id + '" type="number" min="1" placeholder="auto">' +
      ' Scenarios <input id="qVolumes-' + q.id + '" placeholder="e.g. 1000,5000,20000">' +
      ' <button class="btn btn-light btn-sm" data-recalc="' + q.id + '">Recalculate</button></div>' +
      '<div id="quotes-' + q.id + '"><p class="muted">Loading quotes…</p></div></div>';
  }

  function usd(value, digits) {
    return value == null ? "–" : "$" + Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function days(value) {
    return value == null ? "?" : Math.round(value) + " d";
  }

  function drawQuotes(q, data) {
    const box = document.getElementById("quotes-" + q.id);
    if (!box) {
      return;
    }
    document.getElementById("qTarget-" + q.id).placeholder = data.target;
    const c = data.comparison;
    if (!c || !c.rows.length) {
      box.innerHTML = '<p class="muted">No supplier quotes yet.</p>';
      return;
    }
    const vols = c.volumes;
    const head = "<tr><th>#</th><th>Supplier</th><th>Unit @ " + c.target.toLocaleString() + "</th><th>Tooling</th>" +
      vols.map(function (v) {
        return "<th>Cost/pc @ " + v.toLocaleString() + "</th>";
      }).join("") + "<th>Tooling LT</th><th>Prod LT</th><th>MOQ</th><th>Incoterm</th><th>Open issues</th><th></th></tr>";
    const body = c.rows.map(function (row, index) {
      const e = row.evaluation;
      const t = e.scenarios[String(c.target)];
      const issues = e.issues.map(function (i) {
        return '<span class="issue ' + esc(i.severity) + '">' + esc(i.message) + "</span>";
      }).join("");
      return "<tr><td>" + (index + 1) + "</td><td><b>" + esc(row.supplier) + "</b><small>" + esc(row.quote.currency || "?") + "</small></td>" +
        "<td>" + usd(t.unit_usd, 3) + "</td><td>" + usd(e.tooling_usd, 0) + "</td>" +
        vols.map(function (v) {
          const s = e.scenarios[String(v)];
          const best = c.best_by_volume[String(v)] === row.supplier;
          return '<td class="' + (best ? "best" : "") + (s.notes.length ? " flagged" : "") + '" title="' + esc(s.notes.join("; ")) + '">' +
            usd(s.cost_per_pc, 2) + (s.notes.length ? " ⚠" : "") + "</td>";
        }).join("") +
        "<td>" + days(row.quote.tooling_lead_time_days) + "</td><td>" + days(row.quote.lead_time_days) + "</td>" +
        "<td>" + esc(row.quote.moq == null ? "?" : row.quote.moq.toLocaleString()) + "</td><td>" + esc(row.quote.incoterm || "?") + "</td>" +
        '<td class="issues">' + (issues || '<span class="muted">none</span>') + "</td>" +
        '<td><button class="btn btn-light btn-sm" data-del-quote="' + row.id + '">Remove</button></td></tr>';
    }).join("");
    box.innerHTML = '<div class="qtable-wrap"><table class="qtable">' + head + body + "</table></div>" +
      '<p class="muted" style="margin-top:8px">' + esc(c.formula) + ". Freight/duty is an allowance by Incoterm; FX: " +
      Object.keys(c.fx).filter(function (k) {
        return k !== "USD";
      }).map(function (k) {
        return k + " " + c.fx[k];
      }).join(", ") + " per USD (set RESPARK_FX). Green = cheapest at that volume, ⚠ = below MOQ or lowest quoted qty. Verify against the source quote before advising the buyer.</p>";
    box.querySelectorAll("[data-del-quote]").forEach(function (button) {
      button.addEventListener("click", function () {
        api("POST", "/api/ic/quotes/" + button.dataset.delQuote + "/delete").then(function () {
          loadQuotes(q);
        }).catch(function (error) {
          toast(error.message);
        });
      });
    });
  }

  function loadQuotes(q) {
    if (!document.getElementById("quotes-" + q.id)) {
      return;
    }
    const target = document.getElementById("qTarget-" + q.id).value;
    const volumes = document.getElementById("qVolumes-" + q.id).value;
    const query = "?target=" + encodeURIComponent(target) + "&volumes=" + encodeURIComponent(volumes);
    api("GET", "/api/ic/inquiries/" + q.id + "/quotes" + query).then(function (data) {
      drawQuotes(q, data);
    }).catch(function (error) {
      toast(error.message);
    });
  }

  function bindQuotes(q) {
    const addButton = document.querySelector('[data-add-quote="' + q.id + '"]');
    if (!addButton) {
      return;
    }
    loadQuotes(q);
    document.querySelector('[data-recalc="' + q.id + '"]').addEventListener("click", function () {
      loadQuotes(q);
    });
    addButton.addEventListener("click", function () {
      const fileInput = document.getElementById("qFile-" + q.id);
      const textInput = document.getElementById("qText-" + q.id);
      const payload = { supplier: document.getElementById("qSupplier-" + q.id).value };
      const send = function () {
        api("POST", "/api/ic/inquiries/" + q.id + "/quotes", payload).then(function (result) {
          toast("Quote added: " + result.extracted.supplier);
          fileInput.value = "";
          textInput.value = "";
          document.getElementById("qSupplier-" + q.id).value = "";
          loadQuotes(q);
        }).catch(function (error) {
          toast(error.message);
        });
      };
      const file = fileInput.files[0];
      if (file) {
        if (file.size > 400000) {
          toast("File too large (max 400 KB). Paste the text instead.");
          return;
        }
        const reader = new FileReader();
        reader.onload = function () {
          payload.filename = file.name;
          payload.content_b64 = String(reader.result).split(",")[1] || "";
          send();
        };
        reader.readAsDataURL(file);
      } else if (textInput.value.trim()) {
        payload.text = textInput.value;
        send();
      } else {
        toast("Paste a quote or choose a file first");
      }
    });
  }

  function bindInquiryDetail(q) {
    api("GET", "/api/ic/inquiries/" + q.id + "/matches").then(function (data) {
      const box = document.getElementById("matches-" + q.id);
      if (!box) {
        return;
      }
      box.innerHTML = data.matches.length ? data.matches.map(function (m) {
        return '<div class="match"><span><span class="match-score">' + m.score + "</span><b>" + esc(m.name) + "</b><small>" +
          esc(m.reasons.join(" · ")) + '</small></span><button class="btn btn-light btn-sm" data-pick="' + m.company_id + '">Select</button></div>';
      }).join("") : '<p class="muted">No strong matches. Pick a company manually or add more companies to the network.</p>';
      box.querySelectorAll("[data-pick]").forEach(function (button) {
        button.addEventListener("click", function (event) {
          event.stopPropagation();
          document.getElementById("introCompany-" + q.id).value = button.dataset.pick;
        });
      });
    }).catch(function () {});

    const panel = document.getElementById("detail-" + q.id);
    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    bindQuotes(q);
    panel.querySelector("[data-introduce]").addEventListener("click", function () {
      const companyId = document.getElementById("introCompany-" + q.id).value;
      if (!companyId) {
        toast("Choose a company first");
        return;
      }
      api("POST", "/api/ic/inquiries/" + q.id + "/introduce", {
        company_id: companyId,
        note: document.getElementById("introNote-" + q.id).value,
        share_contact: document.getElementById("introShare-" + q.id).checked,
        notify_requester: document.getElementById("introNotify-" + q.id).checked
      }).then(function (result) {
        toast(result.emailed ? "Introduction sent" : "Introduction saved (email not configured: see logs/outbox.log)");
        renderInquiries();
      }).catch(function (error) {
        toast(error.message);
      });
    });
    panel.querySelector("[data-save]").addEventListener("click", function () {
      api("POST", "/api/ic/inquiries/" + q.id + "/patch", {
        status: document.getElementById("status-" + q.id).value,
        deal_value: document.getElementById("deal-" + q.id).value,
        fee: document.getElementById("fee-" + q.id).value,
        notes: document.getElementById("notes-" + q.id).value
      }).then(function () {
        toast("Saved");
        renderInquiries();
      }).catch(function (error) {
        toast(error.message);
      });
    });
  }

  function drawOwnerIntros(items) {
    view.innerHTML =
      '<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr>' +
      "<th>Introduced</th><th>Type</th><th>From</th><th>Score</th><th>Note from the bridge</th><th>Status</th></tr></thead><tbody>" +
      (items.length ? items.map(function (q) {
        const open = state.openInquiry === q.id;
        return '<tr class="row-click" data-open="' + q.id + '"><td>' + date(q.introduced_at) + "</td>" +
          '<td><span class="type-tag ' + esc(q.type) + '">' + esc(q.type) + "</span></td>" +
          "<td><b>" + esc(q.organisation || q.name) + '</b><br><span class="muted">' + esc(q.email || "via " + state.me.hub) + "</span></td>" +
          "<td>" + scoreBadge(q.score, q.label) + "</td><td>" + esc(q.intro_note || "") + "</td>" +
          "<td>" + (q.needs_acceptance
            ? '<button class="btn btn-primary btn-sm" data-accept="' + q.intro_id + '">Accept introduction</button>'
            : '<select data-intro="' + q.intro_id + '">' + options(INTRO_STATUSES, q.intro_status) + "</select>") + "</td></tr>" +
          (q.needs_acceptance ? '<tr class="detail-panel"><td colspan="6"><b>Terms:</b> ' + esc(q.terms) +
            ' <span class="muted">Accept to unlock the contact details and start the conversation.</span></td></tr>' : "") +
          (open ? '<tr class="detail-panel"><td colspan="6">' + fieldList(q.fields) + "</td></tr>" : "");
      }).join("") : '<tr><td colspan="6" class="empty">No introductions yet. Once your showcase is live, ' + esc(state.me.hub) + " will introduce qualified buyers, investors and suppliers here.</td></tr>") +
      "</tbody></table></div>";

    view.querySelectorAll("[data-open]").forEach(function (row) {
      row.addEventListener("click", function (event) {
        if (event.target.closest("select, button")) {
          return;
        }
        state.openInquiry = state.openInquiry === row.dataset.open ? null : row.dataset.open;
        drawOwnerIntros(items);
      });
    });
    view.querySelectorAll("[data-accept]").forEach(function (button) {
      button.addEventListener("click", function () {
        button.disabled = true;
        api("POST", "/api/ic/intros/" + button.dataset.accept + "/accept", {}).then(function () {
          toast("Introduction accepted. Contact details unlocked.");
          renderInquiries();
        }).catch(function (error) {
          button.disabled = false;
          toast(error.message);
        });
      });
    });
    view.querySelectorAll("[data-intro]").forEach(function (select) {
      select.addEventListener("change", function () {
        api("POST", "/api/ic/intros/" + select.dataset.intro + "/patch", { status: select.value }).then(function () {
          toast("Status updated");
        }).catch(function (error) {
          toast(error.message);
        });
      });
    });
  }

  // ------------------------------------------------------------ companies (operator)

  function renderCompanies() {
    api("GET", "/api/ic/companies").then(function (data) {
      state.companies = data.companies;
      view.innerHTML =
        '<div class="card" id="onboard" style="margin-bottom:20px"><div class="panel-title"><h3>Onboard a company</h3><span class="form-note">Creates the owner login and a draft showcase</span></div>' +
        '<form class="form" id="newCompany" style="grid-template-columns:repeat(4,1fr)" novalidate>' +
        '<label><span>Company name <span class="req">*</span></span><input name="name" required></label>' +
        "<label><span>Owner login email</span><input name=\"owner_email\" type=\"email\" placeholder=\"creates their account\"></label>" +
        "<label><span>Country / city</span><input name=\"country\"></label>" +
        "<label><span>Industry</span><input name=\"industry\" placeholder=\"e.g. precision machining\"></label>" +
        '<div class="full"><button class="btn btn-primary btn-sm" type="submit">Create draft portal</button> ' +
        '<span class="form-note">Tip: closing a <b>manufacturer</b> lead in Outreach does this automatically.</span></div></form>' +
        '<div id="newCompanyResult"></div></div>' +
        '<div class="card" style="padding:0;overflow-x:auto"><table class="data-table"><thead><tr>' +
        "<th>Company</th><th>Owner</th><th>Status</th><th>Routing</th><th>Trust</th><th>Seeking</th><th>Views 30d</th><th>Intros</th><th></th></tr></thead><tbody>" +
        (state.companies.length ? state.companies.map(function (c) {
          return "<tr><td><b>" + esc(c.name) + '</b><br><span class="muted">' + esc(c.industry || "") + " " + esc(c.country || "") + "</span></td>" +
            "<td>" + esc(c.owner_email || "—") + "</td>" +
            '<td><select data-company="' + c.id + '" data-key="status">' + options(["draft", "published", "archived"], c.status) + "</select></td>" +
            '<td><select data-company="' + c.id + '" data-key="routing">' + options(["via_bridge", "direct"], c.routing) + "</select></td>" +
            "<td>" + trustPill(c.verification) + '<br><button class="btn btn-light btn-sm" style="margin-top:6px" data-verify="' + c.id + '">' +
            (c.verification && c.verification.status !== "none" ? "Update" : "Verify") + "</button></td>" +
            "<td>" + ["customers", "investment", "suppliers"].map(function (s) {
              return '<label class="inline-check" style="font-size:.8rem;display:flex;margin:2px 0"><input type="checkbox" data-seek="' + c.id + '" value="' + s + '"' + (c.seeking.indexOf(s) !== -1 ? " checked" : "") + "> " + esc(humanize(s)) + "</label>";
            }).join("") + "</td>" +
            "<td>" + c.views_30d + "</td><td>" + c.intros + "</td>" +
            '<td style="white-space:nowrap"><a class="btn btn-light btn-sm" href="/c/' + esc(c.slug) + '/" target="_blank">Open</a> ' +
            '<button class="btn btn-light btn-sm" data-edit="' + c.id + '">Edit content</button></td></tr>';
        }).join("") : '<tr><td colspan="9" class="empty">No companies yet. Onboard your first client above.</td></tr>') +
        "</tbody></table></div>" +
        '<p class="form-note" style="margin-top:10px"><b>Via bridge</b>: inquiries come to you first and you introduce them. <b>Direct</b>: portal inquiries go straight to the company (you still see everything).</p>';

      document.getElementById("newCompany").addEventListener("submit", function (event) {
        event.preventDefault();
        const form = new FormData(event.target);
        const payload = {};
        form.forEach(function (v, k) {
          payload[k] = v;
        });
        api("POST", "/api/ic/companies", payload).then(function (result) {
          document.getElementById("newCompanyResult").innerHTML =
            '<div class="bridge-note" style="margin-top:12px;background:#ecfdf5;border:1px solid #a7f3d0;padding:12px;border-radius:10px">' +
            'Draft portal created: <a href="/c/' + esc(result.slug) + '/" target="_blank">/c/' + esc(result.slug) + "/</a>" +
            (result.temp_password ? "<br>Owner login: <b>" + esc(result.owner_email) + "</b> / temporary password <code>" + esc(result.temp_password) + "</code> (share it securely)" : "") +
            "</div>";
          setTimeout(renderCompanies, 50);
        }).catch(function (error) {
          toast(error.message);
        });
      });
      view.querySelectorAll("[data-company]").forEach(function (select) {
        select.addEventListener("change", function () {
          const body = {};
          body[select.dataset.key] = select.value;
          api("POST", "/api/ic/companies/" + select.dataset.company + "/update", body).then(function () {
            toast("Updated");
          }).catch(function (error) {
            toast(error.message);
          });
        });
      });
      view.querySelectorAll("[data-seek]").forEach(function (box) {
        box.addEventListener("change", function () {
          const id = box.dataset.seek;
          const seeking = Array.from(view.querySelectorAll('[data-seek="' + id + '"]:checked')).map(function (b) {
            return b.value;
          });
          api("POST", "/api/ic/companies/" + id + "/update", { seeking: seeking }).then(function () {
            toast("Updated");
          }).catch(function (error) {
            toast(error.message);
          });
        });
      });
      view.querySelectorAll("[data-edit]").forEach(function (button) {
        button.addEventListener("click", function () {
          openEditor(button.dataset.edit);
        });
      });
      view.querySelectorAll("[data-verify]").forEach(function (button) {
        button.addEventListener("click", function () {
          const company = state.companies.find(function (c) {
            return c.id === button.dataset.verify;
          });
          openVerify(company);
        });
      });
    }).catch(function (error) {
      view.innerHTML = '<div class="card empty">' + esc(error.message) + "</div>";
    });
  }

  // ------------------------------------------------------------ verification (operator)

  const VERIFY_CHECKS = [
    ["registration", "Business registration checked (NIB / company registry)"],
    ["site_visit", "Factory visited or video-audited"],
    ["certificates", "Certificates sighted (ISO, SNI, etc.)"],
    ["references", "Customer references checked"]
  ];

  function trustPill(v) {
    const status = v ? v.status : "none";
    const labels = { verified: "Verified", partial: "Partial", expired: "Expired", none: "Not verified" };
    const classes = { verified: "won", partial: "screening", expired: "lost", none: "draft" };
    return '<span class="pill-status ' + classes[status] + '">' + labels[status] + "</span>";
  }

  function openVerify(company) {
    const v = company.verification || { checks: [] };
    const checked = {};
    (v.checks || []).forEach(function (c) {
      checked[c.key] = c.ok;
    });
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML =
      '<div class="modal" style="max-width:560px"><div class="panel-title"><h3>Verify ' + esc(company.name) + "</h3>" +
      '<button class="btn btn-light btn-sm" data-close>Close</button></div>' +
      '<p class="form-note">Only tick what you personally checked. Registration and a site visit are required for the public "Verified" badge; it expires after 12 months.</p>' +
      '<form class="form" id="verifyForm" style="grid-template-columns:1fr">' +
      VERIFY_CHECKS.map(function (c) {
        return '<label class="inline-check"><input type="checkbox" name="' + c[0] + '"' + (checked[c[0]] ? " checked" : "") + "> " + esc(c[1]) + "</label>";
      }).join("") +
      '<label><span>Registration number (shown publicly)</span><input name="registration_no" value="' + esc(v.registration_no || "") + '"></label>' +
      '<label><span>Private note (evidence, who you met, date)</span><textarea name="note">' + esc(v.note || "") + "</textarea></label>" +
      '<div style="display:flex;gap:8px;justify-content:space-between">' +
      '<button class="btn btn-primary btn-sm" type="submit">Save verification</button>' +
      (v.status && v.status !== "none" ? '<button class="btn btn-light btn-sm" type="button" data-revoke>Revoke badge</button>' : "") +
      "</div></form></div>";
    document.body.appendChild(back);

    function close() {
      back.remove();
    }

    function save(payload) {
      api("POST", "/api/ic/companies/" + company.id + "/verify", payload).then(function () {
        toast(payload.revoke ? "Badge revoked" : "Verification saved");
        close();
        renderCompanies();
      }).catch(function (error) {
        toast(error.message);
      });
    }

    back.querySelector("[data-close]").addEventListener("click", close);
    back.addEventListener("click", function (event) {
      if (event.target === back) {
        close();
      }
    });
    const revoke = back.querySelector("[data-revoke]");
    if (revoke) {
      revoke.addEventListener("click", function () {
        save({ revoke: true });
      });
    }
    back.querySelector("#verifyForm").addEventListener("submit", function (event) {
      event.preventDefault();
      const form = event.target;
      const checks = {};
      VERIFY_CHECKS.forEach(function (c) {
        checks[c[0]] = form.elements[c[0]].checked;
      });
      save({ checks: checks, registration_no: form.elements.registration_no.value, note: form.elements.note.value });
    });
  }

  // ------------------------------------------------------------ content editor (operator + owner)

  function openEditor(companyId) {
    api("GET", "/api/ic/companies/" + companyId).then(function (company) {
      const back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML =
        '<div class="modal"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
        "<h3 style=\"margin:0\">Edit showcase: " + esc(company.name) + "</h3>" +
        '<button class="btn btn-light btn-sm" data-close>Close</button></div>' +
        '<p class="muted">Company profile, products (with specs and 3D model type: gear, flange, pump, valve, shaft, bracket, or a <code>modelUrl</code>), ' +
        "investor figures and supplier categories. Replace all template values with verified data before publishing.</p>" +
        '<textarea class="json-editor" spellcheck="false">' + esc(JSON.stringify(company.data, null, 2)) + "</textarea>" +
        '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-save>Save</button>' +
        '<a class="btn btn-light" href="/c/' + esc(company.slug) + '/" target="_blank">Preview</a></div></div>';
      document.body.appendChild(back);
      back.querySelector("[data-close]").addEventListener("click", function () {
        back.remove();
      });
      back.querySelector("[data-save]").addEventListener("click", function () {
        let data;
        try {
          data = JSON.parse(back.querySelector("textarea").value);
        } catch (error) {
          toast("Invalid JSON: " + error.message);
          return;
        }
        api("POST", "/api/ic/companies/" + companyId + "/update", { data: data }).then(function () {
          toast("Saved");
          back.remove();
          render();
        }).catch(function (error) {
          toast(error.message);
        });
      });
    }).catch(function (error) {
      toast(error.message);
    });
  }

  // ------------------------------------------------------------ my portal (owner)

  function renderPortal() {
    const companies = state.me.companies;
    if (!companies.length) {
      view.innerHTML = '<div class="card empty">No showcase is linked to your account yet. Contact ' + esc(state.me.hub) + ".</div>";
      return;
    }
    view.innerHTML = '<div class="grid grid-2">' + companies.map(function (c) {
      return '<div class="card"><div class="pc-cat">' + esc(humanize(c.status)) + "</div><h3>" + esc(c.name) + "</h3>" +
        '<p class="muted">' + esc(c.tagline) + "</p>" +
        (c.status === "published"
          ? "<p>Live at <a href=\"" + esc(c.portal_url) + "\" target=\"_blank\">" + esc(location.origin + c.portal_url) + "</a> and listed on the hub.</p>"
          : "<p>Draft. Only you and " + esc(state.me.hub) + " can see it. We publish it once the content is verified.</p>") +
        '<div class="btn-row"><a class="btn btn-light btn-sm" href="' + esc(c.portal_url) + '" target="_blank">Preview</a>' +
        '<button class="btn btn-dark btn-sm" data-edit="' + c.id + '">Edit content</button></div></div>';
    }).join("") + "</div>";
    view.querySelectorAll("[data-edit]").forEach(function (button) {
      button.addEventListener("click", function () {
        openEditor(button.dataset.edit);
      });
    });
  }

  // ------------------------------------------------------------ boot

  api("GET", "/api/ic/me").then(function (me) {
    state.me = me;
    document.getElementById("hubName").textContent = me.hub;
    document.getElementById("roleLabel").textContent = me.is_operator ? "Operator console" : "Partner console";
    document.getElementById("userEmail").textContent = me.email;
    document.getElementById("userRole").textContent = me.is_operator ? "Operator" : (me.companies[0] ? me.companies[0].name : "Partner");
    document.getElementById("userAvatar").textContent = (me.email || "?").slice(0, 2).toUpperCase();
    document.title = me.hub + " console";
    if (me.is_operator) {
      api("GET", "/api/ic/stats").then(function (s) {
        state.awaiting = s.awaiting_screening;
        renderTabs();
      }).catch(function () {});
    }
    render();
  }).catch(function (error) {
    view.innerHTML = '<div class="card empty">' + esc(error.message) + "</div>";
  });
})();
