/* Respark - dashboard logic */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

let currentCampaign = null;

async function init() {
  const me = await api("GET", "/api/me");
  if (!me.ok) {
    location.href = "/";
    return;
  }
  $("#who").textContent = me.data.email;

  if (location.search.includes("checkout=success")) {
    const banner = $("#checkoutBanner");
    banner.textContent = "Payment successful - welcome aboard. Your subscription is now active.";
    banner.classList.remove("hidden");
    banner.classList.add("ok");
  } else if (location.search.includes("checkout=cancel")) {
    const banner = $("#checkoutBanner");
    banner.textContent = "Checkout canceled. No charge made.";
    banner.classList.remove("hidden");
  }

  await loadBilling();
  await loadCampaigns();
}

async function loadBilling() {
  const { data } = await api("GET", "/api/billing/status");
  const card = $("#billingCard");
  if (!data.subscription) return;
  const s = data.subscription;
  card.classList.remove("hidden");
  $("#billingPlan").textContent = (s.plan || "").toUpperCase() + " plan";
  const statusEl = $("#billingStatus");
  statusEl.textContent = s.status === "active" ? "Active" : (s.status || "Inactive");
  statusEl.className = "billing-status " + s.status;
  $("#manageBillingBtn").onclick = async () => {
    const r = await api("POST", "/api/billing/portal");
    if (r.ok && r.data.url) location.href = r.data.url;
    else alert(r.data.error || "Could not open billing portal");
  };
}

async function loadCampaigns() {
  const { data } = await api("GET", "/api/campaigns");
  const list = $("#campaignsList");
  $("#campaignDetail").classList.add("hidden");
  list.classList.remove("hidden");

  if (!data.campaigns || data.campaigns.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <h3>No campaigns yet</h3>
        <p>Click "New campaign" above to start your first reactivation.</p>
      </div>`;
    return;
  }

  list.innerHTML = data.campaigns.map(c => `
    <button class="campaign-card" data-id="${c.id}">
      <h3>${escapeHtml(c.name)}</h3>
      <div class="meta">${escapeHtml(c.industry)} · created ${formatDate(c.created_at)}</div>
      <div class="counts">
        <span class="badge ${c.status}">${c.status}</span>
        <span>${c.customer_count} customers</span>
        <span>${c.sent_count}/${c.message_count} sent</span>
      </div>
    </button>
  `).join("");

  $$(".campaign-card").forEach(el => {
    el.addEventListener("click", () => openCampaign(el.dataset.id));
  });
}

async function openCampaign(id) {
  const { ok, data } = await api("GET", "/api/campaigns/" + id);
  if (!ok) { alert("Failed to load campaign"); return; }
  currentCampaign = data;

  $("#campaignsList").classList.add("hidden");
  $("#campaignDetail").classList.remove("hidden");
  $("#detailName").textContent = data.campaign.name;
  const badge = $("#detailStatus");
  badge.textContent = data.campaign.status;
  badge.className = "badge " + data.campaign.status;

  const launched = data.campaign.status !== "draft";
  $("#uploadBtn").disabled = launched;
  $("#generateBtn").disabled = launched;
  $("#launchBtn").disabled = launched;
  $("#csvInput").disabled = launched;

  await loadStats(id);
  renderPreview(data.messages || []);
}

async function loadStats(id) {
  const { data } = await api("GET", "/api/campaigns/" + id + "/stats");
  const row = $("#statsRow");
  const s = data.stats;
  const cards = [
    ["Total messages", s.total || 0],
    ["Sent", s.sent || 0],
    ["Opened", s.opened || 0],
    ["Replied", s.replied || 0],
    ["Failed", s.failed || 0],
    ["Customers", data.customers || 0],
  ];
  row.innerHTML = cards.map(([l, v]) => `
    <div class="stat-card"><div class="label">${l}</div><div class="value">${v}</div></div>
  `).join("");
}

function renderPreview(messages) {
  const area = $("#previewArea");
  if (!messages.length) {
    area.classList.add("hidden");
    area.innerHTML = "";
    return;
  }
  area.classList.remove("hidden");
  const byCustomer = {};
  messages.forEach(m => {
    const k = `${m.first_name || ""} ${m.last_name || ""}`.trim() || "(unnamed)";
    if (!byCustomer[k]) byCustomer[k] = [];
    byCustomer[k].push(m);
  });

  const html = Object.entries(byCustomer).slice(0, 5).map(([name, msgs]) => `
    <div style="margin-bottom:18px;">
      <h4 style="font-size:13px;color:var(--ink-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(name)} — ${msgs.length} messages</h4>
      ${msgs.map(m => `
        <div class="preview-card ${m.channel}">
          <div class="preview-meta">
            <span class="preview-tag ${m.channel}">${m.channel.toUpperCase()}</span>
            <span>#${m.sequence_num} · ${m.status}</span>
            ${m.sent_at ? `<span>sent ${formatDate(m.sent_at)}</span>` : `<span>scheduled ${formatDate(m.scheduled_at)}</span>`}
          </div>
          ${m.subject ? `<div class="preview-subject">${escapeHtml(m.subject)}</div>` : ""}
          <div class="preview-body">${escapeHtml(m.body)}</div>
        </div>
      `).join("")}
    </div>
  `).join("");

  area.innerHTML = html + (Object.keys(byCustomer).length > 5
    ? `<div class="preview-empty">Showing first 5 of ${Object.keys(byCustomer).length} customers</div>`
    : "");
}

$("#newCampaignBtn").addEventListener("click", () => {
  $("#newCampaignModal").classList.remove("hidden");
});
$$("[data-close]").forEach(b => b.addEventListener("click", () => {
  $("#newCampaignModal").classList.add("hidden");
}));

$("#newCampaignForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const { ok, data } = await api("POST", "/api/campaigns", {
    name: fd.get("name"),
    industry: fd.get("industry"),
  });
  if (ok) {
    $("#newCampaignModal").classList.add("hidden");
    e.target.reset();
    await loadCampaigns();
  } else {
    alert(data.error || "Failed to create campaign");
  }
});

$("#backBtn").addEventListener("click", () => loadCampaigns());

$("#uploadBtn").addEventListener("click", async () => {
  if (!currentCampaign) return;
  const csv = $("#csvInput").value.trim();
  const msg = $("#uploadMsg");
  msg.className = "msg";
  msg.textContent = "Importing…";
  const { ok, data } = await api("POST", "/api/campaigns/" + currentCampaign.campaign.id + "/customers", { csv });
  if (ok) {
    msg.classList.add("ok");
    msg.textContent = `Imported ${data.imported} customers.`;
    await openCampaign(currentCampaign.campaign.id);
  } else {
    msg.classList.add("err");
    msg.textContent = data.error || "Import failed";
  }
});

$("#generateBtn").addEventListener("click", async () => {
  if (!currentCampaign) return;
  const { ok, data } = await api("POST", "/api/campaigns/" + currentCampaign.campaign.id + "/generate");
  if (ok) {
    await openCampaign(currentCampaign.campaign.id);
  } else {
    alert(data.error || "Generation failed");
  }
});

$("#launchBtn").addEventListener("click", async () => {
  if (!currentCampaign) return;
  if (!confirm("Launch the campaign? Messages will start sending on their scheduled dates.")) return;
  const msg = $("#launchMsg");
  const { ok, data } = await api("POST", "/api/campaigns/" + currentCampaign.campaign.id + "/launch");
  if (ok) {
    msg.className = "msg ok";
    msg.textContent = `Launched. ${data.messages} messages queued.`;
    await openCampaign(currentCampaign.campaign.id);
  } else {
    msg.className = "msg err";
    msg.textContent = data.error || "Launch failed";
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("POST", "/api/auth/logout");
  location.href = "/";
});

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[m]);
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

init();
