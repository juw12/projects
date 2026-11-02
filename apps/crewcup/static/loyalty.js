/* CrewCup loyalty — points, star tiers, coupons, achievements, café offers and referrals.
   Data comes from /api/state → `loyalty`, scoped per viewer by the server. */

S.perks = { seg: new URLSearchParams(location.search).get("perks") || "perks" };

function lx() {
  return S.loyalty || null;
}

function starRow(count, total) {
  let out = "";
  for (let i = 1; i <= (total || 4); i += 1) {
    out += `<span class="star ${i <= count ? "on" : ""}">${ic("star")}</span>`;
  }
  return `<span class="stars">${out}</span>`;
}

function shortDate(ts) {
  return new Date((ts + contextTz() * 60) * 1000).toLocaleDateString(S.lang === "id" ? "id-ID" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function couponLabel(coupon, country) {
  const bits = [];
  if (coupon.cafe) {
    bits.push(t("only at {cafe}", { cafe: cafeName(coupon.cafe) }));
  }
  if (coupon.offpeak_only) {
    bits.push(t("off-peak slots"));
  }
  bits.push(t("until {date}", { date: shortDate(coupon.expires) }));
  return bits.join(" · ");
}

const COUPON_SOURCE = { points: "Points", achievement: "Achievement", cafe_promo: "Café offer", tier: "Tier gift", welcome: "Welcome", referral: "Referral" };

/* ------------------------------------------------------------------ employee tab */

function empGiftsTab() {
  const segs = [["perks", "My rewards"], ["offers", "Café offers"], ["gifts", "Send a coffee"], ["refer", "Invite & earn"]];
  let content;
  if (S.perks.seg === "achievements") {
    content = perksAchievements();
  } else if (S.perks.seg === "offers") {
    content = perksOffers();
  } else if (S.perks.seg === "refer") {
    content = perksRefer();
  } else if (S.perks.seg === "gifts") {
    content = empGifts();
  } else {
    content = perksOverview();
  }
  return `<div class="stack">
    <div class="row seg">${segs.map(([key, label]) => `<button class="btn small ${S.perks.seg === key || (key === "perks" && S.perks.seg === "achievements") ? "sel" : ""}" data-act="perkseg" data-v="${key}">${t(label)}</button>`).join("")}</div>
    ${content}
  </div>`;
}

function tierCard(data) {
  const tier = data.tier;
  const span = tier.next ? tier.next.at - tier.floor : 1;
  const pct = tier.next ? Math.round(((data.lifetime - tier.floor) / span) * 100) : 100;
  return `<div class="card tier-card tier-${tier.key}">
    <div class="row between" style="align-items:flex-start">
      <div>
        <div class="kpi-label">${t("Member tier")}</div>
        <div class="tier-name">${t(tier.label)} ${starRow(tier.stars, data.tiers.length)}</div>
        <div class="small muted">${t("{x}x points on every order", { x: tier.multiplier })}</div>
      </div>
      <div style="text-align:right">
        <div class="kpi-label">${t("Points balance")}</div>
        <div class="kpi">${data.points.toLocaleString()}</div>
        <div class="small muted">${t("{n} lifetime", { n: data.lifetime.toLocaleString() })}</div>
      </div>
    </div>
    <div class="bar" style="margin-top:12px"><i style="width:${Math.min(100, pct)}%"></i></div>
    <div class="small muted" style="margin-top:6px">${tier.next ? t("{n} points to {tier}", { n: tier.next.needed.toLocaleString(), tier: t(tier.next.label) }) : t("Top tier reached")}</div>
    <div class="row tier-scale">${data.tiers.map((row) => `<span class="chip ${row.key === tier.key ? "dark" : ""}">${t(row.label)} · ${row.at.toLocaleString()}</span>`).join("")}</div>
  </div>`;
}

function perksOverview() {
  const data = lx();
  if (!data) {
    return `<div class="empty">${t("Loading…")}</div>`;
  }
  const office = officeOf(me());
  const active = data.coupons.filter((coupon) => coupon.status === "active");
  const past = data.coupons.filter((coupon) => coupon.status !== "active").slice(0, 5);
  const earn = data.earn;
  return `<div class="split">
    <div class="stack">
      ${tierCard(data)}
      <div class="card stack">
        <div class="row between"><h3 style="margin:0">{{i:ticket}} ${t("My coupons")}</h3><span class="small muted">${t("{n} active", { n: active.length })}</span></div>
        ${active.length ? active.map((coupon) => `<div class="coupon">
          <div class="coupon-main"><b>${esc(coupon.title)}</b><div class="small muted">${esc(couponLabel(coupon, office.country))}</div></div>
          <div class="coupon-side"><span class="chip">${t(COUPON_SOURCE[coupon.source] || coupon.source)}</span><button class="btn small" data-act="usecoupon" data-coupon="${coupon.id}" data-cafe="${coupon.cafe || ""}">${t("Use")}</button></div>
        </div>`).join("") : `<div class="empty">${t("No coupons yet — earn them with achievements, claim café offers or redeem points.")}</div>`}
        ${past.length ? `<div class="small muted">${past.map((coupon) => `${esc(coupon.title)} — ${t(coupon.status === "used" ? "used" : "expired")}`).join(" · ")}</div>` : ""}
      </div>
      <div class="card stack">
        <div class="row between"><h3 style="margin:0">{{i:award}} ${t("Next achievements")}</h3><button class="btn small flat-btn" data-act="perkseg" data-v="achievements">${t("See all")} (${data.achievements.filter((row) => row.unlocked).length}/${data.achievements.length})</button></div>
        ${data.achievements.filter((row) => !row.unlocked).sort((a, b) => b.progress / b.target - a.progress / a.target).slice(0, 3).map((row) => `<div class="ach">
          <div class="ach-icon">${ic("award")}</div>
          <div style="flex:1;min-width:0"><div class="row between"><b>${t(row.title)}</b><span class="small muted">${row.progress} / ${row.target}</span></div>
          <div class="bar thin" style="margin-top:6px"><i style="width:${Math.round((row.progress / row.target) * 100)}%"></i></div></div>
        </div>`).join("") || `<div class="empty">${t("All achievements unlocked")}</div>`}
      </div>
    </div>
    <div class="stack">
      <div class="card stack">
        <h3>{{i:gift}} ${t("Redeem points")}</h3>
        ${data.store.map((item) => `<div class="row between store-row"><span>${esc(t(item.title))}</span><span class="row" style="gap:8px"><span class="small muted">${item.points} ${t("pts")}</span><button class="btn small ${data.points >= item.points ? "primary" : ""}" ${data.points >= item.points ? "" : "disabled"} data-act="perkredeem" data-item="${item.id}">${t("Redeem")}</button></span></div>`).join("")}
${data.donations ? `<div class="small muted">${t("{n} meals donated by CrewCup members so far.", { n: data.donations })}</div>` : ""}
      </div>
      <details class="card fold">
        <summary><h3 style="margin:0">{{i:receipt}} ${t("Points history")}</h3></summary>
        ${data.ledger.length ? data.ledger.map((row) => `<div class="row between small" style="border-bottom:1px solid var(--line);padding:5px 0"><span>${esc(row.reason)}</span><span class="${row.points < 0 ? "muted" : ""}"><b>${row.points > 0 ? "+" : ""}${row.points}</b> · ${esc(dayHm(row.ts, office.tz_min))}</span></div>`).join("") : `<div class="empty">${t("No points yet")}</div>`}
      </details>
      <details class="card fold">
        <summary><h3 style="margin:0">{{i:zap}} ${t("How to earn points")}</h3></summary>
        ${[
          [t("Each drink ordered"), earn.drink],
          [t("Bonus: reusable cup"), earn.reusable],
          [t("Bonus: joining a group run"), earn.group_run],
          [t("Doing a coffee run"), t("{a} + {b} per cup", { a: earn.runner_base, b: earn.runner_per_cup })],
          [t("Sending a coffee to a colleague"), earn.gift],
          [t("Coffee chat with another company"), earn.chat],
          [t("Joining a meetup"), earn.meetup],
          [t("Referral that joins (company / café)"), earn.referral_company + " / " + earn.referral_cafe],
        ].map(([label, points]) => `<div class="row between small"><span>${esc(label)}</span><b>+${points}</b></div>`).join("")}
        <div class="small muted">${t("Higher tiers earn more points per order.")}</div>
      </details>
    </div>
  </div>`;
}

function perksAchievements() {
  const data = lx();
  if (!data) {
    return "";
  }
  const done = data.achievements.filter((row) => row.unlocked).length;
  return `<div class="card stack">
    <div class="row between"><h3 style="margin:0"><button class="btn small flat-btn" data-act="perkseg" data-v="perks">${ic("chevron-left")} ${t("Back")}</button> ${t("Achievements")}</h3><span class="small muted">${t("{a} of {b} unlocked", { a: done, b: data.achievements.length })}</span></div>
    <div class="ach-grid">${data.achievements.map((row) => {
      const pct = Math.round((row.progress / row.target) * 100);
      const reward = [row.reward.points ? "+" + row.reward.points + " " + t("pts") : "", row.reward.coupon ? t("coupon") : ""].filter(Boolean).join(" + ");
      return `<div class="ach ${row.unlocked ? "done" : ""}">
        <div class="ach-icon">${ic(row.unlocked ? "award" : "lock")}</div>
        <div style="flex:1;min-width:0">
          <div class="row between"><b>${t(row.title)}</b><span class="small muted">${esc(reward)}</span></div>
          <div class="small muted">${t(row.desc)}</div>
          <div class="bar thin" style="margin-top:6px"><i style="width:${pct}%"></i></div>
          <div class="small muted" style="margin-top:3px">${row.unlocked ? t("Unlocked") : `${row.progress} / ${row.target}`}</div>
        </div>
      </div>`;
    }).join("")}</div>
  </div>`;
}

function perksOffers() {
  const data = lx();
  if (!data) {
    return "";
  }
  const office = officeOf(me());
  return `<div class="card stack">
    <h3>{{i:tag}} ${t("Offers from partner cafés")}</h3>
    <div class="small muted">${t("Claim an offer and it's added to your coupons.")}</div>
    ${data.promos.length ? data.promos.map((promo) => `<div class="coupon">
      <div class="coupon-main"><b>${esc(promo.title)}</b><div class="small muted">${esc(cafeName(promo.cafe))} · ${promo.kind === "percent" ? promo.value + "%" : money(promo.country, promo.value)}${promo.offpeak_only ? " · " + t("off-peak slots") : ""} · ${t("{n} left", { n: promo.left })} · ${t("ends {when}", { when: dayHm(promo.expires, office.tz_min) })}</div></div>
      <div class="coupon-side">${promo.claimed ? `<span class="chip ok">{{i:check}} ${t("Claimed")}</span>` : `<button class="btn small primary" ${promo.left > 0 ? "" : "disabled"} data-act="perkclaim" data-promo="${promo.id}">${t("Claim")}</button>`}</div>
    </div>`).join("") : `<div class="empty">${t("No café offers in your city right now.")}</div>`}
  </div>`;
}

function perksRefer() {
  const data = lx();
  if (!data) {
    return "";
  }
  const kind = d("ref_kind", "company");
  const status = { sent: ["", "Invitation sent"], contacted: ["warn", "In conversation"], joined: ["ok", "Joined"] };
  const share = t("Our team orders office coffee with CrewCup — group runs, company allowance, partner cafés. Sign up with my code {code}.", { code: data.code });
  return `<div class="split">
    <div class="stack">
      <div class="card stack">
        <h3>{{i:share}} ${t("Invite & earn")}</h3>
        <div class="small muted">${t("Know a company or café that would like CrewCup? Earn points when they join.")}</div>
        <div class="row seg">${[["company", "A company"], ["cafe", "A café"]].map(([key, label]) => `<button class="btn small ${kind === key ? "sel" : ""}" data-act="refkind" data-v="${key}">${t(label)}</button>`).join("")}</div>
        <label class="field">${t(kind === "company" ? "Company name" : "Café name")}<input type="text" maxlength="60" data-draft="ref_name" value="${esc(d("ref_name", ""))}" placeholder="${esc(kind === "company" ? t("e.g. Pandan Tech") : t("e.g. Kopi Lantai 3"))}"></label>
        <label class="field">${t("Contact work email")}<input type="email" maxlength="80" data-draft="ref_contact" value="${esc(d("ref_contact", ""))}" placeholder="hr@company.co.id"></label>
        <div class="row between"><span class="small muted">${t("Reward when they join: {n} points", { n: kind === "company" ? data.earn.referral_company : data.earn.referral_cafe })}</span><button class="btn primary" data-act="perkrefer">${t("Send referral")}</button></div>
        <div class="small muted">${t("We contact them once on your behalf. Your contact's email is never shown to anyone else.")}</div>
      </div>
      <div class="card stack">
        <h3>{{i:link}} ${t("Your referral code")}</h3>
        <div class="row"><span class="code-box mono">${esc(data.code)}</span><button class="btn small" data-act="copy" data-text="${esc(share)}">${t("Copy invite text")}</button></div>
        <div class="small muted">${esc(share)}</div>
      </div>
    </div>
    <div class="card stack">
      <h3>{{i:users}} ${t("My referrals")}</h3>
      ${data.referrals.length ? data.referrals.map((item) => { const [tone, label] = status[item.status] || ["", item.status]; return `<div class="chat-row"><div class="row between"><b>${esc(item.name)}</b><span class="chip ${tone}">${t(label)}</span></div><div class="small muted">${t(item.kind === "company" ? "Company" : "Café")} · ${esc(dayHm(item.ts, officeOf(me()).tz_min))}${item.points ? " · +" + item.points + " " + t("pts") : ""}</div></div>`; }).join("") : `<div class="empty">${t("No referrals yet.")}</div>`}
    </div>
  </div>`;
}

function loyaltyTeaser() {
  const data = lx();
  if (!data) {
    return "";
  }
  const active = data.coupons.filter((coupon) => coupon.status === "active").length;
  const nextAch = data.achievements.filter((row) => !row.unlocked).sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  return `<div class="card row between">
    <div class="row" style="gap:12px">${starRow(data.tier.stars, data.tiers.length)}<div><b>${t(data.tier.label)} · ${data.points.toLocaleString()} ${t("pts")}</b><div class="small muted">${t("{n} coupons ready", { n: active })}${nextAch ? " · " + t("Next: {title} ({a}/{b})", { title: t(nextAch.title), a: nextAch.progress, b: nextAch.target }) : ""}</div></div></div>
    <button class="btn small" data-act="tab" data-tab="gifts">${t("Rewards")}</button>
  </div>`;
}

/* ------------------------------------------------------------------ order integration */

function couponPicker(cafe) {
  const data = lx();
  if (!data) {
    return "";
  }
  const usable = data.coupons.filter((coupon) => coupon.status === "active" && coupon.country === cafe.country && (!coupon.cafe || coupon.cafe === cafe.id));
  if (!usable.length) {
    return "";
  }
  const chosen = d("order_coupon", "");
  const error = S.preview && S.preview.coupon_error;
  return `<label class="field">{{i:ticket}} ${t("Coupon")}<select data-draft="order_coupon" data-change="couponchange">
      <option value="">${t("No coupon")}</option>
      ${usable.map((coupon) => `<option value="${coupon.id}" ${chosen === coupon.id ? "selected" : ""}>${esc(coupon.title)}${coupon.offpeak_only ? " (" + t("off-peak") + ")" : ""}</option>`).join("")}
    </select></label>
    ${error ? `<div class="small" style="color:var(--bad)">${esc(msg(error))}</div>` : ""}`;
}

C.couponchange = () => {
  schedulePreview();
};

/* ------------------------------------------------------------------ café */

function cafePromosCard() {
  const data = lx();
  const cafe = S.data.cafes[persona().id];
  const promos = data ? data.promos : [];
  const kind = d("pm_kind", "percent");
  return `<div class="card stack">
    <h3>{{i:tag}} ${t("Promotions for CrewCup members")}</h3>
    <div class="small muted">${t("Members nearby claim your offer as a coupon. You fund the discount; it's applied automatically when they order.")}</div>
    <label class="field">${t("Title")}<input type="text" maxlength="60" data-draft="pm_title" value="${esc(d("pm_title", ""))}" placeholder="${esc(t("e.g. 20% off before 08:30"))}"></label>
    <div class="grid g3">
      <label class="field">${t("Type")}<select data-draft="pm_kind" data-change="rerender"><option value="percent" ${kind === "percent" ? "selected" : ""}>${t("Percent off")}</option><option value="amount" ${kind === "amount" ? "selected" : ""}>${t("Amount off")}</option></select></label>
      <label class="field">${kind === "percent" ? t("Percent") : t("Amount ({c})", { c: country(cafe.country).currency })}<input type="number" data-draft="pm_value" value="${esc(d("pm_value", kind === "percent" ? 15 : 5))}"></label>
      <label class="field">${t("Coupons available")}<input type="number" data-draft="pm_max" value="${esc(d("pm_max", 50))}"></label>
    </div>
    <label class="check"><input type="checkbox" data-draft="pm_offpeak" ${d("pm_offpeak", true) ? "checked" : ""}> ${t("Only valid in off-peak slots (fills quiet hours)")}</label>
    <button class="btn primary" data-act="promocreate">${t("Publish offer")}</button>
    ${promos.map((promo) => `<div class="row between small" style="border-top:1px solid var(--line);padding-top:6px"><span><b>${esc(promo.title)}</b> · ${promo.kind === "percent" ? promo.value + "%" : money(promo.country, promo.value)} · ${t("{a} claimed · {b} used", { a: promo.claimed, b: promo.redeemed })}</span>${promo.active ? `<button class="btn small" data-act="promoend" data-promo="${promo.id}">${t("End")}</button>` : `<span class="chip">${t("Ended")}</span>`}</div>`).join("")}
    ${data && data.subsidised_coupons ? `<div class="small muted">${t("{n} orders used CrewCup-funded coupons — you were paid the full price.", { n: data.subsidised_coupons })}</div>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ admin */

function adminLoyaltyCard() {
  const data = lx();
  if (!data || !data.members) {
    return "";
  }
  return `<div class="card stack">
    <h3>{{i:star}} ${t("Loyalty programme")}</h3>
    <div class="row">${Object.entries(data.members).map(([key, count]) => `<span class="chip">${t(key.charAt(0).toUpperCase() + key.slice(1))} · ${count}</span>`).join("")}</div>
    <div class="grid g2 small">
      <div>${t("Points outstanding")}<div class="kpi">${data.points_outstanding.toLocaleString()}</div></div>
      <div>${t("Coupons used")}<div class="kpi">${data.coupons_used}</div></div>
      <div>${t("Active coupons")}<div class="kpi">${data.coupons_active}</div></div>
      <div>${t("Referrals joined")}<div class="kpi">${data.referrals_joined}</div></div>
    </div>
    <div class="small muted">${t("Points and coupons are run and funded by CrewCup and partner cafés — they never touch your company budgets.")}</div>
  </div>`;
}

/* ------------------------------------------------------------------ actions */

A.perkseg = (ds) => {
  S.perks.seg = ds.v;
  render();
};
A.perkredeem = async (ds) => {
  const payload = await api("loyalty.redeem", { emp: me().id, item: ds.item });
  if (payload.ok) {
    toast(payload.result.donated ? t("Meal donated — thank you") : t("Coupon added: {title}", { title: payload.result.title }), "ok");
  }
};
A.perkclaim = (ds) => api("loyalty.claim", { emp: me().id, promo: ds.promo }, { success: t("Offer added to your coupons") });
A.refkind = (ds) => {
  S.drafts.ref_kind = ds.v;
  render();
};
A.perkrefer = async () => {
  const payload = await api("loyalty.refer", { emp: me().id, kind: d("ref_kind", "company"), name: d("ref_name", ""), contact: d("ref_contact", "") },
    { success: t("Referral sent — we'll let you know when they join") });
  if (payload.ok) {
    S.drafts.ref_name = "";
    S.drafts.ref_contact = "";
    render();
  }
};
A.usecoupon = (ds) => {
  S.drafts.order_coupon = ds.coupon;
  if (ds.cafe) {
    S.order.cafe = ds.cafe;
  }
  S.tab.emp = "order";
  render();
  schedulePreview();
};
A.promocreate = async () => {
  const cafe = S.data.cafes[persona().id];
  const kind = d("pm_kind", "percent");
  const raw = Number(d("pm_value", kind === "percent" ? 15 : 5));
  const payload = await api("loyalty.promo_create", {
    cafe: cafe.id,
    title: d("pm_title", ""),
    kind,
    value: kind === "percent" ? raw : toMinor(cafe.country, raw),
    offpeak_only: d("pm_offpeak", true),
    max_claims: Number(d("pm_max", 50)),
    days: 7,
  }, { success: t("Offer published to members nearby") });
  if (payload.ok) {
    S.drafts.pm_title = "";
    render();
  }
};
A.promoend = (ds) => api("loyalty.promo_end", { cafe: persona().id, promo: ds.promo }, { success: t("Offer ended") });
