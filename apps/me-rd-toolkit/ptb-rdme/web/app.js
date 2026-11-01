(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch (_) { return String(iso); }
  }
  function showToast(msg, isError) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 4500);
  }
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, opts).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { throw new Error("HTTP " + r.status + " " + t.slice(0, 120)); });
      }
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") >= 0) return r.json();
      return r.blob();
    });
  }
  function el(tag, props) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "value") n.value = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      n.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  function pill(status) {
    var cls = "muted";
    if (status === "submitted" || status === "approved") cls = "ok";
    else if (status === "proposed") cls = "warn";
    else if (status === "rejected") cls = "danger";
    return el("span", { class: "status-pill " + cls }, status);
  }

  // --- Overtime view ---
  function renderOvertime(view) {
    view.textContent = "";
    var wrap = el("div", { class: "view-in" });

    Promise.all([api("/api/ot/today"), api("/api/colleagues")]).then(function (rs) {
      var today = rs[0];
      var colleagues = rs[1];
      var submitted = new Set(today.submitted_ids || []);
      var colleaguesById = {};
      colleagues.forEach(function (c) { colleaguesById[c.id] = c; });

      wrap.appendChild(el("div", { class: "page-head" },
        el("h1", { class: "page-title" }, "Today: " + today.date),
        el("p", { class: "page-sub" }, (submitted.size + " / " + colleagues.length + " submitted"))
      ));

      // Submit form
      var formCard = el("div", { class: "card" });
      formCard.appendChild(el("h3", {}, "Submit your overtime"));
      var select = el("select", { id: "sub-id" });
      select.appendChild(el("option", { value: "" }, "Select colleague…"));
      colleagues.forEach(function (c) {
        var opt = el("option", { value: c.id }, c.name + " (" + c.id + ")");
        select.appendChild(opt);
      });
      formCard.appendChild(el("div", { class: "field" }, el("label", {}, "Colleague"), select));

      var start = el("input", { type: "time", value: "17:00", id: "sub-start" });
      var end = el("input", { type: "time", value: "20:00", id: "sub-end" });
      var reason = el("textarea", { id: "sub-reason", placeholder: "加班事由 / reason" });
      var proj = el("input", { type: "text", value: "PTB", id: "sub-project" });
      formCard.appendChild(el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Start / 起"), start),
        el("div", { class: "field" }, el("label", {}, "End / 迄"), end),
        el("div", { class: "field" }, el("label", {}, "Project / 專案"), proj)
      ));
      formCard.appendChild(el("div", { class: "field" }, el("label", {}, "Reason / 事由"), reason));
      var satBox = el("input", { type: "checkbox", id: "sub-sat" });
      formCard.appendChild(el("label", { class: "checkbox-row" }, satBox, " Friday → add Saturday OT"));

      var btn = el("button", { class: "btn primary", onclick: function () {
        var payload = {
          colleague_id: select.value,
          start_time: start.value,
          end_time: end.value,
          total_hours: hoursBetween(start.value, end.value),
          reason: reason.value,
          project_code: proj.value,
          ot_date: today.date,
          includes_saturday_ot: satBox.checked,
        };
        if (!payload.colleague_id) { showToast("Pick a colleague", true); return; }
        if (!payload.reason) { showToast("Reason required", true); return; }
        api("/api/ot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(function (r) { showToast("OT submitted (#" + r.id + ")"); renderOvertime(view); })
          .catch(function (e) { showToast("Failed: " + e.message, true); });
      } }, "Submit OT");
      formCard.appendChild(el("div", { class: "actions" }, btn));

      // Export + refresh
      var exportBtn = el("a", {
        class: "btn ghost",
        href: "/api/ot/export?date=" + today.date,
        download: "ot_" + today.date + ".xlsx"
      }, "Download .xlsx");
      wrap.appendChild(formCard);
      wrap.appendChild(el("div", { class: "actions" }, exportBtn,
        el("button", { class: "btn", onclick: function () { renderOvertime(view); } }, "Refresh")));

      // Submitted today
      var subCard = el("div", { class: "card" });
      subCard.appendChild(el("h3", {}, "Submitted today (" + submitted.size + ")"));
      if (!today.rows || today.rows.length === 0) {
        subCard.appendChild(el("div", { class: "empty" }, "No submissions yet."));
      } else {
        var list = el("div", { class: "row-list" });
        today.rows.forEach(function (r) {
          var sat = r.includes_saturday_ot ? " + Sat " + (r.saturday_start_time || "?") + "–" + (r.saturday_end_time || "?") : "";
          list.appendChild(el("div", { class: "row-card" },
            el("div", { class: "row-top" },
              el("span", { class: "row-name" }, r.name || r.colleague_id),
              el("span", { class: "row-meta" }, r.start_time + "–" + r.end_time + " · " + r.total_hours + "h" + sat)
            ),
            el("div", { class: "row-detail" }, r.reason || "(no reason)"),
            el("div", { class: "row-meta" }, "Project: " + (r.project_code || "—") + " · " + fmtDateTime(r.submitted_at))
          ));
        });
        subCard.appendChild(list);
      }
      wrap.appendChild(subCard);

      // Pending
      var pending = colleagues.filter(function (c) { return !submitted.has(c.id); });
      var pendCard = el("div", { class: "card" });
      pendCard.appendChild(el("h3", {}, "Awaiting submission (" + pending.length + ")"));
      if (pending.length === 0) {
        pendCard.appendChild(el("div", { class: "empty" }, "Everyone submitted."));
      } else {
        var pl = el("div", { class: "row-list" });
        pending.forEach(function (c) {
          pl.appendChild(el("div", { class: "row-card" },
            el("div", { class: "row-name" }, c.name + " (" + c.id + ")"),
            el("div", { class: "row-meta" }, c.supervisor || "")
          ));
        });
        pendCard.appendChild(pl);
      }
      wrap.appendChild(pendCard);

      view.textContent = "";
      view.appendChild(wrap);
    }).catch(function (e) {
      view.textContent = "";
      view.appendChild(el("div", { class: "card empty" }, "Error loading overtime: " + esc(e.message)));
    });
  }

  function hoursBetween(s, e) {
    var a = s.split(":").map(Number), b = e.split(":").map(Number);
    var mins = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
    if (mins < 0) mins += 24 * 60;
    return Math.round(mins / 6) / 100;
  }

  // --- Drafts view (local Outlook) ---
  function renderDrafts(view) {
    view.textContent = "";
    var wrap = el("div", { class: "view-in" });
    wrap.appendChild(el("div", { class: "page-head" },
      el("h1", { class: "page-title" }, "Email drafts"),
      el("p", { class: "page-sub" }, "Your local Outlook Drafts folder (only on this PC)")
    ));
    api("/api/email/drafts").then(function (rows) {
      if (!rows || rows.length === 0) {
        wrap.appendChild(el("div", { class: "card empty" }, "No drafts in Outlook. Or Outlook desktop isn't installed on this PC."));
      } else if (rows[0] && rows[0].error) {
        wrap.appendChild(el("div", { class: "card empty" },
          el("strong", {}, "Outlook COM not available"),
          el("p", {}, "Run this widget on the same PC as Outlook desktop.")
        ));
      } else {
        var card = el("div", { class: "card" });
        card.appendChild(el("h3", {}, "Recent drafts (" + rows.length + ")"));
        var list = el("div", { class: "row-list" });
        rows.forEach(function (r) {
          list.appendChild(el("div", { class: "row-card" },
            el("div", { class: "row-top" },
              el("span", { class: "row-name" }, r.subject || "(no subject)"),
              el("span", { class: "row-meta" }, fmtDateTime(r.creation_time))
            ),
            el("div", { class: "row-detail" }, "To: " + (r.to || "—")),
            el("div", { class: "row-meta" }, r.body_preview || "")
          ));
        });
        card.appendChild(list);
        wrap.appendChild(card);
      }
      view.appendChild(wrap);
    });
    api("/api/email/inbox-unread").then(function (data) {
      if (!data) return;
      var n = data.unread;
      var card = el("div", { class: "card" });
      card.appendChild(el("h3", {}, "Inbox"));
      var row = el("div", { class: "kv" });
      row.appendChild(el("div", { class: "kv-row" },
        el("span", { class: "k" }, "Unread"), el("span", { class: "v" }, n < 0 ? "n/a" : n)
      ));
      card.appendChild(row);
      wrap.appendChild(card);
      view.appendChild(wrap);
    });
  }

  // --- Colleagues view ---
  function renderColleagues(view) {
    view.textContent = "";
    var wrap = el("div", { class: "view-in" });
    wrap.appendChild(el("div", { class: "page-head" },
      el("h1", { class: "page-title" }, "Team"),
      el("p", { class: "page-sub" }, "PTB RD ME — colleagues in this widget")
    ));
    api("/api/colleagues").then(function (rows) {
      var card = el("div", { class: "card" });
      if (!rows || rows.length === 0) {
        card.appendChild(el("div", { class: "empty" }, "No colleagues yet."));
      } else {
        var list = el("div", { class: "row-list" });
        rows.forEach(function (c) {
          list.appendChild(el("div", { class: "row-card" },
            el("div", { class: "row-top" },
              el("span", { class: "row-name" }, c.name + (c.is_consolidator ? "  · consolidator" : "")),
              el("span", { class: "row-meta" }, c.id)
            ),
            el("div", { class: "row-detail" }, c.email || ""),
            el("div", { class: "row-meta" }, "Dept: " + (c.department || "PTB RD ME") + " · Supervisor: " + (c.supervisor || "—"))
          ));
        });
        card.appendChild(list);
      }
      wrap.appendChild(card);
      view.appendChild(wrap);
    });
  }

  var routes = {
    "#/overtime": { tab: "overtime", render: renderOvertime },
    "#/drafts": { tab: "drafts", render: renderDrafts },
    "#/colleagues": { tab: "colleagues", render: renderColleagues },
  };

  function setActiveTab(tab) {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === tab);
    });
  }

  function render() {
    var hash = location.hash || "#/overtime";
    var route = routes[hash] || routes["#/overtime"];
    setActiveTab(route.tab);
    var view = $("#view");
    view.textContent = "";
    view.appendChild(el("div", { class: "loading" },
      el("span", { class: "spinner" }), el("p", {}, "Loading")
    ));
    try { route.render(view); } catch (e) {
      view.textContent = "";
      view.appendChild(el("div", { class: "card empty" }, "Error: " + e.message));
    }
  }

  window.addEventListener("hashchange", render);
  document.getElementById("refresh-btn").addEventListener("click", function () {
    var b = this;
    b.classList.add("spinning");
    render();
    setTimeout(function () { b.classList.remove("spinning"); }, 700);
  });
  if (!location.hash) location.hash = "#/overtime";
  render();
})();
