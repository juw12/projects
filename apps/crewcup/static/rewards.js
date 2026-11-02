/* Company coffee rewards — admin "Rewards" tab, employee "From the company" section, café voucher redemption.
   Data comes from /api/state → `rewards`, which the server scopes per viewer. */

const RW_REASON = {
  great_work: "Great work",
  team_win: "Team milestone",
  thank_you: "Thank you",
  welcome: "Welcome to the team",
  anniversary: "Work anniversary",
  birthday: "Happy birthday",
  partner: "Thanks from our company",
};
const RW_SOURCE = { admin: "Manual", rule: "Automatic", nomination: "Nomination" };
const RW_MANUAL_REASONS = ["great_work", "team_win", "thank_you", "welcome", "anniversary", "birthday"];
const RW_RULES = [
  ["welcome", "Welcome coffee for new joiners", "Sent automatically when someone is provisioned via SCIM."],
  ["anniversary", "Work anniversary", "On each anniversary of the joining date."],
  ["birthday", "Birthday coffee", "Only for employees who opt in. Birthdays are never shown to colleagues."],
];

function rw() {
  return S.rewards || { mine: [], wall: [], nominations: [], recent: [], vouchers: [], rules: {} };
}

function rwNames(names) {
  if (names.length <= 3) {
    return names.join(", ");
  }
  return names.slice(0, 3).join(", ") + " " + t("+{n} more", { n: names.length - 3 });
}

function rwCups(count) {
  return count === 1 ? t("1 coffee") : t("{n} coffees", { n: count });
}

/* ------------------------------------------------------------------ admin */

function adminRewards() {
  const office = S.data.offices[S.adminOffice];
  const data = rw();
  const value = office.karma_reward;
  const budget = office.budgets.rewards || { limit: 0, spent: 0, held: {} };
  const available = budget.limit - budget.spent - Object.values(budget.held).reduce((a, b) => a + b, 0);
  const people = Object.values(S.data.employees).filter((emp) => emp.active && emp.office === office.id).sort((a, b) => a.name.localeCompare(b.name));
  const teams = [...new Set(people.map((emp) => emp.team))].sort();
  const kind = d("rw_kind", "person");
  const coffees = Number(d("rw_coffees", 1));
  const person = d("rw_person", people[0] ? people[0].id : "");
  const team = d("rw_team", teams[0] || "");
  const count = kind === "person" ? 1 : kind === "team" ? people.filter((emp) => emp.team === team).length : people.length;
  const total = count * coffees * value;
  const officeRewards = data.recent.filter((row) => row.office === office.id);
  const monthCups = officeRewards.reduce((sum, row) => sum + row.count * row.coffees, 0);
  const partners = (S.social ? S.social.people : []).filter((member) => member.city === cityOfOffice(office));
  const vouchers = data.vouchers.filter((voucher) => voucher.office === office.id);
  const rules = data.rules || {};
  return `<div class="stack">
    <div class="grid g4">
      ${kpi(t("Rewards budget left"), money(office.country, available))}
      ${kpi(t("Coffees given (recent)"), monthCups)}
      ${kpi(t("Value of one company coffee"), money(office.country, value))}
      ${kpi(t("Nominations waiting"), data.nominations.filter((item) => item.office === office.id).length)}
    </div>
    <div class="split">
      <div class="stack">
        <div class="card stack">
          <h3>{{i:gift}} ${t("Give a coffee from the company")}</h3>
          <div class="row seg">${[["person", "A person"], ["team", "A team"], ["office", "Whole office"]].map(([key, label]) => `<button class="btn small ${kind === key ? "sel" : ""}" data-act="rwkind" data-v="${key}">${t(label)}</button>`).join("")}</div>
          ${kind === "person" ? `<label class="field">${t("Employee")}<select data-draft="rw_person" data-change="rerender">${people.map((emp) => `<option value="${emp.id}" ${emp.id === person ? "selected" : ""}>${esc(emp.name)} · ${esc(emp.team)}</option>`).join("")}</select></label>` : ""}
          ${kind === "team" ? `<label class="field">${t("Team")}<select data-draft="rw_team" data-change="rerender">${teams.map((name) => `<option value="${esc(name)}" ${name === team ? "selected" : ""}>${esc(name)} (${people.filter((emp) => emp.team === name).length})</option>`).join("")}</select></label>` : ""}
          <div class="grid g2">
            <label class="field">${t("Reason")}<select data-draft="rw_reason">${RW_MANUAL_REASONS.map((key) => `<option value="${key}" ${d("rw_reason", "great_work") === key ? "selected" : ""}>${t(RW_REASON[key])}</option>`).join("")}</select></label>
            <label class="field">${t("Coffees per person")}<select data-draft="rw_coffees" data-change="rerender">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${n === coffees ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div>
          <label class="field">${t("Message")}<input type="text" maxlength="200" data-draft="rw_msg" value="${esc(d("rw_msg", ""))}" placeholder="${esc(t("e.g. Thanks for leading the payments launch"))}"></label>
          <label class="check"><input type="checkbox" data-draft="rw_announce" ${d("rw_announce", true) ? "checked" : ""}> ${t("Share a shout-out on the company feed (company only)")}</label>
          <div class="row between">
            <span class="small ${total > available ? "" : "muted"}">${t(count === 1 ? "1 recipient × {c} × {v} = {total}" : "{n} recipients × {c} × {v} = {total}", { n: count, c: rwCups(coffees), v: money(office.country, value), total: money(office.country, total) })}${total > available ? " · " + t("over budget") : ""}</span>
            <button class="btn primary" ${total > available || !count ? "disabled" : ""} data-act="rwgive">${t("Send reward")}</button>
          </div>
          <div class="small muted">${t("Arrives as gift credit, usable at any partner café. Recorded as an individual benefit in Spend & tax.")}</div>
        </div>
        <div class="card stack">
          <h3>{{i:star}} ${t("Nominations from employees")}</h3>
          ${data.nominations.filter((item) => item.office === office.id).map((item) => `<div class="report">
            <div class="row between"><span><b>${esc(S.data.employees[item.nominee].name)}</b> <span class="small muted">${t("nominated by")} ${esc(S.data.employees[item.by].name)} · ${esc(dayHm(item.ts, office.tz_min))}</span></span><span class="chip">${t(RW_REASON[item.reason])}</span></div>
            <div class="small" style="margin:6px 0">“${esc(item.message)}”</div>
            <div class="row"><select data-draft="nmc_${item.id}">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(d("nmc_" + item.id, 1)) === n ? "selected" : ""}>${rwCups(n)}</option>`).join("")}</select>
              <button class="btn small good" data-act="rwdecide" data-nom="${item.id}" data-v="1">${t("Approve")}</button>
              <button class="btn small" data-act="rwdecide" data-nom="${item.id}" data-v="0">${t("Decline")}</button></div>
          </div>`).join("") || `<div class="empty">${t("No nominations waiting.")}</div>`}
        </div>
        <div class="card stack">
          <h3>{{i:receipt}} ${t("Recent rewards")}</h3>
          <table><thead><tr><th>${t("When")}</th><th>${t("Recipients")}</th><th>${t("Reason")}</th><th class="right">${t("Total")}</th><th>${t("Source")}</th></tr></thead><tbody>
          ${officeRewards.map((row) => `<tr><td class="nowrap">${esc(dayHm(row.ts, office.tz_min))}</td><td>${esc(rwNames(row.names))}<div class="small muted">${rwCups(row.coffees)} ${t("each")}${row.public ? " · " + t("shared on feed") : ""}</div></td><td>${t(RW_REASON[row.reason] || row.reason)}</td><td class="right">${money(office.country, row.amount * row.count)}</td><td><span class="chip">${t(RW_SOURCE[row.source] || row.source)}</span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">${t("No rewards yet")}</td></tr>`}
          </tbody></table>
        </div>
      </div>
      <div class="stack">
        ${adminLoyaltyCard()}
        <div class="card stack">
          <h3>{{i:zap}} ${t("Automatic rewards")}</h3>
          ${RW_RULES.map(([key, label, help]) => { const rule = rules[key] || { on: false, coffees: 1 }; return `<div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
            <label class="check" style="align-items:flex-start"><input type="checkbox" data-draft="rr_on_${key}" ${d("rr_on_" + key, rule.on) ? "checked" : ""}><span><b>${t(label)}</b><div class="small muted">${t(help)}</div></span></label>
            <select data-draft="rr_c_${key}" style="width:110px">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(d("rr_c_" + key, rule.coffees)) === n ? "selected" : ""}>${rwCups(n)}</option>`).join("")}</select>
          </div>`; }).join("")}
          <button class="btn" data-act="rwrules">${t("Save rules")}</button>
        </div>
        <div class="card stack">
          <h3>{{i:share}} ${t("Thank someone at another company")}</h3>
          <div class="small muted">${t("Send a coffee to a client or partner on the Network. They get a voucher code any partner café in their city can redeem.")}</div>
          ${partners.length ? `
            <label class="field">${t("Person")}<select data-draft="rwp_to">${partners.map((member) => `<option value="${esc(member.key)}" ${d("rwp_to", partners[0].key) === member.key ? "selected" : ""}>${esc(member.name)} · ${esc(member.company_name)}</option>`).join("")}</select></label>
            <div class="grid g2">
              <label class="field">${t("Coffees")}<select data-draft="rwp_coffees">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(d("rwp_coffees", 1)) === n ? "selected" : ""}>${rwCups(n)}</option>`).join("")}</select></label>
              <label class="field">${t("Message")}<input type="text" maxlength="200" data-draft="rwp_msg" value="${esc(d("rwp_msg", ""))}" placeholder="${esc(t("e.g. Thanks for the workshop"))}"></label>
            </div>
            <button class="btn primary" data-act="rwpartner">${t("Send voucher")}</button>`
            : `<div class="empty">${t("Nobody from other companies is visible in this city yet.")}</div>`}
          ${vouchers.map((voucher) => `<div class="chat-row">
            <div class="row between"><span><b>${esc(voucher.to_name)}</b> <span class="small muted">${esc(((S.social && S.social.companies.find((c) => c.id === voucher.to_company)) || {}).name || "")}</span></span>
              <span class="chip ${voucher.status === "redeemed" ? "ok" : voucher.status === "expired" ? "bad" : "warn"}">${t(voucher.status === "redeemed" ? "Redeemed" : voucher.status === "expired" ? "Expired" : "Not used yet")}</span></div>
            <div class="small">${t("Code")} <b class="mono">${esc(voucher.code)}</b> · ${rwCups(voucher.coffees)} · ${money(voucher.country, voucher.amount)} · ${t("valid until")} ${esc(dayHm(voucher.expires, office.tz_min))}</div>
            ${voucher.thanks ? `<div class="small muted">“${esc(voucher.thanks)}”</div>` : ""}
          </div>`).join("")}
        </div>
      </div>
    </div>
  </div>`;
}

function cityOfOffice(office) {
  const cities = { o_jkt: "Jakarta", o_sg: "Singapore", o_kl: "Kuala Lumpur", o_bkk: "Bangkok", o_mnl: "Manila", o_hcm: "Ho Chi Minh City" };
  return cities[office.id] || "";
}

/* ------------------------------------------------------------------ employee */

function empRewardsSection() {
  const emp = me();
  const office = officeOf(emp);
  const data = rw();
  const colleagues = Object.values(S.data.employees).filter((other) => other.id !== emp.id && other.active && other.office === emp.office).sort((a, b) => a.name.localeCompare(b.name));
  const birthday = data.birthday || { on: false, date: null };
  const status = { pending: ["warn", "Waiting for review"], approved: ["ok", "Approved"], declined: ["", "Not approved"] };
  return `<div class="grid g2">
    <div class="stack">
      <div class="card stack">
        <h3>{{i:building}} ${t("From the company")}</h3>
        ${data.mine.length ? data.mine.map((row) => `<div class="note gift"><span class="tm">${esc(dayHm(row.ts, office.tz_min))}</span><span><b>${t(RW_REASON[row.reason] || row.reason)}</b> · ${rwCups(row.coffees)} (${money(office.country, row.amount)})${row.message ? `<div class="small muted">${esc(row.message)}</div>` : ""}</span></div>`).join("")
          : `<div class="empty">${t("Company rewards you receive appear here and as gift credit in your wallet.")}</div>`}
      </div>
      <div class="card stack">
        <h3>{{i:star}} ${t("Recognition at {office}", { office: office.name })}</h3>
        ${data.wall.length ? data.wall.map((row) => `<div class="note"><span class="tm">${esc(dayHm(row.ts, office.tz_min).split(" ")[0])}</span><span><b>${esc(rwNames(row.names))}</b> · ${t(RW_REASON[row.reason] || row.reason)}${row.message ? `<div class="small muted">${esc(row.message)}</div>` : ""}</span></div>`).join("")
          : `<div class="empty">${t("No public recognition yet.")}</div>`}
      </div>
    </div>
    <div class="stack">
      <div class="card stack">
        <h3>{{i:award}} ${t("Nominate a colleague for a company coffee")}</h3>
        <div class="small muted">${t("An admin reviews nominations. If approved, the company pays — not you.")}</div>
        <label class="field">${t("Colleague")}<select data-draft="nm_to">${colleagues.map((other) => `<option value="${other.id}" ${d("nm_to", colleagues[0] && colleagues[0].id) === other.id ? "selected" : ""}>${esc(other.name)} · ${esc(other.team)}</option>`).join("")}</select></label>
        <label class="field">${t("Reason")}<select data-draft="nm_reason">${["great_work", "team_win", "thank_you"].map((key) => `<option value="${key}" ${d("nm_reason", "great_work") === key ? "selected" : ""}>${t(RW_REASON[key])}</option>`).join("")}</select></label>
        <label class="field">${t("What did they do?")}<input type="text" maxlength="200" data-draft="nm_msg" value="${esc(d("nm_msg", ""))}" placeholder="${esc(t("e.g. Stayed late to fix the release"))}"></label>
        <button class="btn primary" data-act="rwnominate">${t("Submit nomination")}</button>
        ${data.nominations.length ? data.nominations.map((item) => { const [tone, label] = status[item.status] || ["", item.status]; return `<div class="row between small"><span>${esc(S.data.employees[item.nominee].name)} · ${t(RW_REASON[item.reason])}</span><span class="chip ${tone}">${t(label)}</span></div>`; }).join("") : ""}
      </div>
      <div class="card stack">
        <h3>{{i:calendar}} ${t("Birthday coffee")}</h3>
        <label class="check"><input type="checkbox" data-draft="bd_on" ${d("bd_on", birthday.on) ? "checked" : ""}> ${t("Let the company send me a coffee on my birthday")}</label>
        <label class="field">${t("Birthday (MM-DD, no year)")}<input type="text" maxlength="5" data-draft="bd_date" value="${esc(d("bd_date", birthday.date || ""))}" placeholder="03-21" style="max-width:120px"></label>
        <button class="btn small" data-act="rwbirthday">${t("Save")}</button>
        <div class="small muted">${t("Used only to send your coffee. Never shown to colleagues or other companies.")}</div>
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ café */

function cafeVoucherBox() {
  return `<div class="card flat row">
    {{i:ticket}} <input type="text" class="mono" style="width:130px" data-draft="voucher" value="${esc(d("voucher", ""))}" placeholder="CC-XXXXXX">
    <button class="btn small" data-act="rwredeem">${t("Redeem voucher")}</button>
  </div>`;
}

/* ------------------------------------------------------------------ actions */

A.rwkind = (ds) => {
  S.drafts.rw_kind = ds.v;
  render();
};
A.rwgive = async () => {
  const office = S.data.offices[S.adminOffice];
  const people = Object.values(S.data.employees).filter((emp) => emp.active && emp.office === office.id).sort((a, b) => a.name.localeCompare(b.name));
  const teams = [...new Set(people.map((emp) => emp.team))].sort();
  const kind = d("rw_kind", "person");
  const target = kind === "person" ? d("rw_person", people[0].id) : kind === "team" ? d("rw_team", teams[0]) : null;
  const payload = await api("rewards.give", {
    office: office.id,
    target_kind: kind,
    target,
    coffees: Number(d("rw_coffees", 1)),
    reason: d("rw_reason", "great_work"),
    message: d("rw_msg", ""),
    announce: d("rw_announce", true),
  });
  if (payload.ok) {
    toast(t("Reward sent to {n} people", { n: payload.result.recipients }), "ok");
    S.drafts.rw_msg = "";
    render();
  }
};
A.rwdecide = (ds) => api("rewards.decide", { nomination: ds.nom, approve: ds.v === "1", coffees: Number(d("nmc_" + ds.nom, 1)) },
  { success: ds.v === "1" ? t("Nomination approved — coffee sent") : t("Nomination declined") });
A.rwrules = () => {
  const rules = {};
  for (const [key] of RW_RULES) {
    const current = (rw().rules || {})[key] || { on: false, coffees: 1 };
    rules[key] = { on: d("rr_on_" + key, current.on), coffees: Number(d("rr_c_" + key, current.coffees)) };
  }
  return api("rewards.rules", { rules }, { success: t("Rules saved") });
};
A.rwpartner = async () => {
  const office = S.data.offices[S.adminOffice];
  const partners = (S.social ? S.social.people : []).filter((member) => member.city === cityOfOffice(office));
  const payload = await api("rewards.partner", {
    office: office.id,
    to: d("rwp_to", partners[0] && partners[0].key),
    coffees: Number(d("rwp_coffees", 1)),
    message: d("rwp_msg", ""),
  });
  if (payload.ok) {
    toast(t("Voucher {code} sent", { code: payload.result }), "ok");
    S.drafts.rwp_msg = "";
    render();
  }
};
A.rwnominate = async () => {
  const emp = me();
  const colleagues = Object.values(S.data.employees).filter((other) => other.id !== emp.id && other.active && other.office === emp.office).sort((a, b) => a.name.localeCompare(b.name));
  const payload = await api("rewards.nominate", {
    emp: emp.id,
    nominee: d("nm_to", colleagues[0] && colleagues[0].id),
    reason: d("nm_reason", "great_work"),
    message: d("nm_msg", ""),
  }, { success: t("Nomination sent to your admin") });
  if (payload.ok) {
    S.drafts.nm_msg = "";
    render();
  }
};
A.rwbirthday = () => {
  const birthday = rw().birthday || { on: false, date: null };
  return api("rewards.birthday", { emp: me().id, on: d("bd_on", birthday.on), birthday: d("bd_date", birthday.date || "") }, { success: t("Saved") });
};
A.rwredeem = async () => {
  const code = String(d("voucher", "")).trim();
  if (!code) {
    return;
  }
  const payload = await api("rewards.redeem", { cafe: persona().id, code });
  if (payload.ok) {
    toast(t("Voucher accepted: {n} for {name}", { n: rwCups(payload.result.coffees), name: payload.result.to }), "ok");
    S.drafts.voucher = "";
    render();
  }
};
