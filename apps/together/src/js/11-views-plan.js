/* -------------------------------------------------------------------- views */
function render() {
  const onboarding = !state.couple.a.name && !state.couple.b.name;
  const tabs = document.getElementById("tabs");
  tabs.hidden = onboarding;
  tabs.innerHTML = TABS.map(tab => `<button type="button" data-act="tab" data-id="${tab.id}" ${ui.tab === tab.id ? 'aria-current="page"' : ""}>
      ${icon(tab.icon, "i ico")}<span>${tab.label}</span></button>`).join("");
  const n = names();
  const pill = document.getElementById("saved-pill");
  pill.innerHTML = savedPillHTML();
  pill.title = privacyStatus();
  document.getElementById("brand-sub").textContent = onboarding ? "Our life plan, from first date to golden years" : `${n.a} & ${n.b}`;
  const view = document.getElementById("view");
  const views = { home: viewHome, roadmap: viewRoadmap, goals: viewGoals, money: viewMoney, us: viewUs, settings: viewSettings };
  view.innerHTML = onboarding ? viewOnboarding() : (views[ui.tab] || viewHome)();
}

/** Status pill in the header: where the plan lives right now. */
function savedPillHTML() {
  if (sync && sync.active) {
    return sync.status === "error" ? `${icon("alert")}<span>Sync paused</span>` : `${icon("sync")}<span>Shared with partner</span>`;
  }
  return `${icon("lock")}<span>Saved on this device</span>`;
}

function viewOnboarding() {
  return `<div class="onboard">
    <div class="hello"><div class="mark" aria-hidden="true">${icon("logo", "i logo-lg")}</div>
      <h1>Plan your whole life together</h1>
      <p class="muted">From dating to marriage, a home, kids and growing old side by side. Takes about a minute.</p></div>
    <form class="card" data-form="onboard">
      <div class="fields-2">
        <label class="field">Your name<input name="aName" required autocomplete="off" placeholder="e.g. Mia"></label>
        <label class="field">Your partner's name<input name="bName" required autocomplete="off" placeholder="e.g. Leo"></label>
        <label class="field">Your birthday<input name="aBirth" type="date"></label>
        <label class="field">Partner's birthday<input name="bBirth" type="date"></label>
        <label class="field">Together since<input name="since" type="date"></label>
        <label class="field">Where are you now?
          <select name="stage">${STAGES.slice(0, 6).map(s => `<option value="${s.id}">${s.name}</option>`).join("")}</select></label>
      </div>
      <label class="field">Wedding date (if set or already married)<input name="wedding" type="date"></label>
      <label class="row small"><input type="checkbox" name="template" checked style="width:auto"> Start us with a suggested life roadmap (fully editable)</label>
      <div class="actions row" style="justify-content:flex-end;margin-top:12px"><button class="primary" type="submit">Start our plan</button></div>
    </form>
    <p class="privacy">${icon("lock")} Private by design: no account, no sign-up. Your plan stays in this browser unless you turn on partner sync — then it's end-to-end encrypted before it leaves your phone.</p>
  </div>`;
}

/** What an iPhone/iPad visitor needs to do to install Together and get push reminders. */
function iosInfo(userAgent = navigator.userAgent, touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
  const ios = /iphone|ipad|ipod/i.test(userAgent) || touchMac;
  const match = userAgent.match(/OS (\d+)[_.](\d+)/);
  const version = ios && match ? Number(match[1]) + Number(match[2]) / 100 : null;
  return {
    ios,
    version,
    inApp: ios && /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|GSA\/|Twitter|MicroMessenger|TikTok/i.test(userAgent),
    pushCapable: ios && (version === null || version >= 16.04),
  };
}
function iosInstallBanner() {
  const info = iosInfo();
  if (!info.ios || reminders.isStandalone() || localStorage.getItem(`${store.key}.iosHintDismissed`)) return "";
  const body = info.inApp
    ? `<p class="small">You're in an in-app browser, which can't install apps. Tap <b>•••</b> → <b>Open in Safari</b>, then come back to this banner.</p>`
    : `<ol class="small" style="margin:6px 0 6px 18px;padding:0">
        <li>Tap <b>Share</b> ${icon("share")} (bottom bar in Safari, or the address bar menu in Chrome/Edge).</li>
        <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open <b>Together</b> from your Home Screen and turn on reminders in Settings.</li>
      </ol>
      ${info.pushCapable ? "" : `<p class="small muted">Your iOS ${esc(String(Math.floor(info.version)))} can install Together, but push reminders need iOS 16.4 or newer — use the calendar (.ics) reminders in Settings instead.</p>`}`;
  return `<section class="card" style="margin-bottom:14px">
    <div class="spread"><h2 style="margin:0">Put Together on your Home Screen</h2>
      <button type="button" class="ghost" data-act="ios-hint-dismiss" aria-label="Dismiss">${icon("close")}</button></div>
    <p class="small">On iPhone and iPad, Apple only allows reminders for web apps that are added to the Home Screen.</p>
    ${body}
  </section>`;
}

function viewHome() {
  const now = ui.now;
  const n = names();
  const since = parseDate(state.couple.since);
  const wedding = parseDate(state.couple.wedding);
  const daysTogether = since ? daysBetween(since, now) : null;
  const stageIdx = currentStageIndex(state);
  const next = nextMilestone(state, now);
  const doneMilestones = state.milestones.filter(m => m.done).length;
  const goalsDone = state.goals.filter(g => goalProgress(g) === 1).length;
  const saved = totalSaved(state);
  const focus = focusItems(state, now);
  const todayISO = toISO(now);
  const comingUp = state.milestones.filter(m => !m.done && m.date && m.date >= todayISO).sort(byDate).slice(1, 4);
  const marriedLine = wedding && wedding <= now ? `<p class="muted">Married ${relativeTime(state.couple.wedding, now).replace(" ago", "")}</p>` : "";
  return `${iosInstallBanner()}
  <section class="card hero">
    <div class="spread">
      <div>
        <h1>${esc(n.a)} & ${esc(n.b)}</h1>
        ${daysTogether !== null && daysTogether >= 0 ? `<div class="big">${daysTogether.toLocaleString()} days</div><p class="muted">together since ${esc(formatDate(state.couple.since))}</p>` : `<p class="muted">Add your “together since” date in Settings to start the counter.</p>`}
        ${marriedLine}
      </div>
      ${next ? `<div class="card next-card">
        <div class="small muted">Next milestone</div>
        <h3>${esc(next.title)}</h3>
        <div class="chip">${esc(relativeTime(next.date, now))}</div>
        <div class="small muted" style="margin-top:6px">${esc(formatDate(next.date))}<br>${agesLine(next.date)}</div></div>` : ""}
    </div>
  </section>
  <section class="card">
    <div class="spread"><h2>Our journey</h2><span class="chip">Now: ${STAGES[stageIdx].name}</span></div>
    <div class="journey" role="list">${STAGES.map((s, i) => `<div role="listitem" class="step ${i < stageIdx ? "done" : i === stageIdx ? "now" : ""}"><div class="dot" aria-hidden="true">${i < stageIdx ? icon("check") : i + 1}</div>${s.name}</div>`).join("")}</div>
    <p class="muted small">${STAGES[stageIdx].blurb}</p>
  </section>
  ${weekCardHTML(now)}
  <div class="grid" style="margin-top:14px">
    <section class="card">
      <h2>This month's focus</h2>
      ${focus.length ? `<ul class="clean">${focus.map(item => `<li class="focus-item"><span class="ico">${icon(item.icon)}</span>
        <div style="flex:1;min-width:0">${esc(item.text)}</div>
        <button class="ghost small" type="button" data-act="${item.act ? "checkin" : "tab"}" data-id="${item.tab || ""}">Go →</button></li>`).join("")}</ul>`
        : `<div class="empty">All caught up. Enjoy each other this month.</div>`}
    </section>
    <section class="card">
      <h2>At a glance</h2>
      <div class="stats">
        <div class="stat"><b>${doneMilestones}/${state.milestones.length}</b><span class="small muted">milestones</span></div>
        <div class="stat"><b>${goalsDone}/${state.goals.length}</b><span class="small muted">goals done</span></div>
        <div class="stat"><b>${esc(money(saved, state.couple.currency))}</b><span class="small muted">saved</span></div>
        <div class="stat"><b>${state.checkins.length}</b><span class="small muted">check-ins</span></div>
      </div>
      <h3 style="margin-top:16px">Coming up</h3>
      ${comingUp.length ? `<ul class="clean">${comingUp.map(m => `<li class="spread small"><div><b>${esc(m.title)}</b><br><span class="muted">${agesLine(m.date)}</span></div>
        <span class="chip">${esc(formatDate(m.date, "month"))}</span></li>`).join("")}</ul>` : '<p class="small muted">Add milestones on the Roadmap.</p>'}
      <p class="small muted" style="margin-top:12px">“The best thing to hold onto in life is each other.” — Audrey Hepburn</p>
    </section>
  </div>`;
}

/** Who is adding money on this device: remembered per device, never synced. */
const ME_KEY_SUFFIX = ".me";
function lastContributor() {
  try {
    const saved = localStorage.getItem(store.key + ME_KEY_SUFFIX);
    return ["a", "b", "both"].includes(saved) ? saved : "both";
  } catch (error) {
    return "both";
  }
}
function contributorSelect(label) {
  const n = names();
  const chosen = lastContributor();
  return `<select name="by" aria-label="${esc(label)}" style="flex:0 1 auto;width:auto;min-width:0">
    ${[["a", n.a], ["b", n.b], ["both", "Both"]].map(([value, text]) => `<option value="${value}" ${chosen === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>`;
}
function splitLine(split, cur) {
  const n = names();
  const parts = [];
  if (split.a) parts.push(`${esc(n.a)} ${esc(money(split.a, cur))}`);
  if (split.b) parts.push(`${esc(n.b)} ${esc(money(split.b, cur))}`);
  if (split.both) parts.push(`together ${esc(money(split.both, cur))}`);
  return parts.join(" · ");
}

/** Home card: this week's money missions (with a per-day figure), the next goal step and a fun pick. */
function weekCardHTML(now) {
  const cur = state.couple.currency;
  const plan = weeklyPlan(state, now);
  const streak = savingStreak(state, now);
  const n = names();
  const fun = funPlan(state, now);
  const range = `${plan.weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${plan.weekEnd.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  const potRows = plan.pots.map(p => {
    const share = p.weekly > 0 ? clamp(p.added / p.weekly, 0, 1) : 1;
    const partnerPart = (who, label) => {
      const target = p.targets[who];
      const putIn = p.byPartner[who];
      return `${esc(label)} ${esc(money(putIn, cur))} / ${esc(money(target, cur))}${putIn >= target - 0.5 ? " ✓" : ""}`;
    };
    return `<li class="week-pot">
      <div class="spread"><div style="min-width:0"><b>${esc(p.fund.name)}</b>
        <div class="small muted">${esc(money(p.weekly, cur))} this week · about ${esc(money(p.daily, cur))} a day${p.behind ? " · catching up" : ""}</div></div>
        ${p.done ? '<span class="chip ok">✓ Done</span>' : `<span class="chip">${esc(money(Math.max(0, p.weekly - p.added), cur))} to go</span>`}</div>
      <div class="bar" style="margin:6px 0" role="progressbar" aria-label="${esc(p.fund.name)} this week" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(share * 100)}"><span style="width:${share * 100}%"></span></div>
      <div class="small muted">In this week: ${partnerPart("a", n.a)} · ${partnerPart("b", n.b)}${plan.shares.byIncome ? " (split by income)" : ""}</div>
      ${p.done ? "" : `<form class="row" data-form="deposit" data-id="${esc(p.fund.id)}" style="margin-top:6px;flex-wrap:nowrap">
        ${amountInput("amount", `Add to ${p.fund.name}`, { style: "flex:1;min-width:0", placeholder: money(Math.max(0, p.weekly - p.added), cur) })}
        ${contributorSelect(`Who is adding to ${p.fund.name}`)}<button type="submit">+ Add</button></form>`}
    </li>`;
  }).join("");
  const moneyBlock = plan.pots.length
    ? `<div class="small" style="margin-bottom:6px"><b>${esc(money(plan.totalAdded, cur))}</b> of ${esc(money(plan.totalWeekly, cur))} into your pots this week</div><ul class="clean">${potRows}</ul>`
    : `<p class="small muted">Give a savings pot a monthly amount on the Money tab and you'll get a weekly target for it here.</p>`;
  const stepRow = plan.step ? `<label class="step-row"><input type="checkbox" data-toggle="step" data-goal="${esc(plan.step.goal.id)}" data-id="${esc(plan.step.step.id)}">
      <span><span class="muted">Goal step:</span> ${esc(plan.step.step.text)} <span class="muted">(${esc(plan.step.goal.title)})</span></span></label>` : "";
  let funRow = "";
  if (plan.fun) {
    const pot = plan.funPot;
    const potLine = pot ? ` · ${Math.round(fundStatus(pot, state, now).progress * 100)}% saved` : "";
    funRow = `<div class="focus-item" style="margin-top:8px"><span class="ico">${icon("heart")}</span>
      <div style="flex:1;min-width:0"><span class="muted small">Fun pick:</span> ${esc(plan.fun.text)}<span class="small muted">${potLine}</span>
        <div class="small muted">Plan one small step toward it together this week.</div></div>
      <button class="ghost small" type="button" data-act="tab" data-id="us">Go →</button></div>`;
  }
  const challengeRows = state.challenges.map(ch => {
    const s = challengeStatus(ch, now);
    const fund = state.funds.find(f => f.id === ch.fundId);
    if (s.finished || !fund) return "";
    return `<div class="focus-item" style="margin-top:8px"><span class="ico">${icon("target")}</span>
      <div style="flex:1;min-width:0"><span class="muted small">${esc(s.def.name)}, week ${s.step}:</span> ${esc(money(s.amount, cur))} into ${esc(fund.name)}</div>
      ${s.doneThisStep ? '<span class="chip ok">✓ Done</span>' : `<button class="small" type="button" data-act="challenge-tick" data-id="${esc(ch.id)}">Done</button>`}</div>`;
  }).join("");
  const dateRow = `<div class="focus-item" style="margin-top:8px"><span class="ico">${icon("calendar")}</span>
      <div style="flex:1;min-width:0"><span class="muted small">Date idea:</span> ${esc(fun.idea.text)}${fun.idea.cost ? ` <span class="small muted">(~${esc(money(fun.idea.cost, cur))})</span>` : ""}
        ${fun.budget ? `<div class="small muted">${esc(money(Math.max(0, fun.left), cur))} fun money left this month</div>` : ""}</div>
      <button class="ghost small" type="button" data-act="date-done">We did it</button></div>`;
  const streakChip = streak.weeks > 0
    ? `<span class="chip ok" title="Weeks in a row you hit this week's combined target">${streak.weeks}-week streak</span>`
    : plan.pots.length ? '<span class="chip">Start a streak this week</span>' : "";
  return `<section class="card week-card" style="margin-top:14px">
    <div class="week-head"><h2>This week together</h2><span class="week-chips">${streakChip}<span class="chip">${esc(range)} · ${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left</span></span></div>
    ${moneyBlock}
    <div style="margin-top:10px">${challengeRows}${stepRow}${dateRow}${funRow}</div>
  </section>`;
}

function lifelineSVG() {
  const now = ui.now;
  const startYear = now.getFullYear();
  const births = [parseDate(state.couple.a.birth), parseDate(state.couple.b.birth)].filter(Boolean);
  const youngest = births.length ? Math.max(...births.map(d => d.getFullYear())) : startYear - 30;
  const endYear = Math.max(youngest + 90, startYear + 10);
  const width = 1000;
  const height = 120;
  const pad = 30;
  const x = year => pad + (year - startYear) / (endYear - startYear) * (width - 2 * pad);
  const n = names();
  let ticks = "";
  for (let year = Math.ceil(startYear / 10) * 10; year <= endYear; year += 10) {
    const ageA = ageOn(state.couple.a.birth, new Date(year, 6, 1));
    const ageB = ageOn(state.couple.b.birth, new Date(year, 6, 1));
    ticks += `<line x1="${x(year)}" x2="${x(year)}" y1="56" y2="64" stroke="currentColor" opacity=".4"/>
      <text x="${x(year)}" y="80" text-anchor="middle" font-size="13" fill="currentColor" opacity=".75">${year}</text>
      ${ageA !== null ? `<text x="${x(year)}" y="97" text-anchor="middle" font-size="11" fill="currentColor" opacity=".55">${ageA}/${ageB ?? "?"}</text>` : ""}`;
  }
  const dots = state.milestones.filter(m => parseDate(m.date)).map(m => {
    const date = parseDate(m.date);
    const year = date.getFullYear() + date.getMonth() / 12;
    if (year < startYear || year > endYear) return "";
    const color = m.done ? "var(--green)" : "var(--rose)";
    return `<circle cx="${x(year)}" cy="60" r="7" style="fill:${color};stroke:var(--card)" stroke-width="2"><title>${esc(m.title)} — ${esc(formatDate(m.date))}</title></circle>`;
  }).join("");
  return `<svg class="lifeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Lifeline from ${startYear} to ${endYear} with milestones">
    <line x1="${pad}" x2="${width - pad}" y1="60" y2="60" style="stroke:var(--line-strong)" stroke-width="3" stroke-linecap="round"/>
    ${ticks}${dots}
    <text x="${pad}" y="30" font-size="13" fill="currentColor" opacity=".7">Now</text>
    <text x="${width - pad}" y="30" font-size="13" text-anchor="end" fill="currentColor" opacity=".7">${esc(n.a)} & ${esc(n.b)} at ~90</text>
    <text x="${pad}" y="114" font-size="11" fill="currentColor" opacity=".55">Ages ${esc(n.a)}/${esc(n.b)}</text>
  </svg>`;
}

function viewRoadmap() {
  const now = ui.now;
  const stageIdx = currentStageIndex(state);
  const header = `<div class="section-head"><div><h1>Our life roadmap</h1><p class="muted">Every milestone shows how old you'll both be. Tick them off as life happens.</p></div>
    <div class="row"><button type="button" data-act="add-milestone" class="primary">+ Milestone</button></div></div>`;
  if (!state.milestones.length) {
    return `${header}<div class="empty">No milestones yet.<br>
      <button type="button" class="primary" data-act="template" style="margin-top:10px">Suggest a lifelong roadmap</button></div>`;
  }
  const blocks = STAGES.map((stage, index) => {
    const items = state.milestones.filter(m => m.stage === stage.id).sort(byDate);
    return `<section class="stage-block">
      <div class="stage-title ${index === stageIdx ? "current" : ""}"><span class="badge" aria-hidden="true">${index + 1}</span>
        <h2 style="margin:0">${stage.name}</h2>${index === stageIdx ? '<span class="chip">You are here</span>' : ""}</div>
      <p class="small muted" style="margin:2px 0 0">${stage.blurb}</p>
      ${items.map(m => `<div class="ms ${m.done ? "done" : ""}">
        <input type="checkbox" data-toggle="milestone" data-id="${esc(m.id)}" ${m.done ? "checked" : ""} aria-label="Mark ${esc(m.title)} done">
        <div class="ms-body"><div class="ms-title">${esc(m.title)}</div>
          <div class="small muted">${esc(formatDate(m.date))}${m.date && !m.done ? ` · ${esc(relativeTime(m.date, now))}` : ""}</div>
          ${m.date ? `<div class="small muted">${agesLine(m.date)}</div>` : ""}
          ${m.notes ? `<div class="small">${esc(m.notes)}</div>` : ""}</div>
        <button type="button" class="ghost" data-act="edit-milestone" data-id="${esc(m.id)}" aria-label="Edit ${esc(m.title)}">${icon("pencil")}</button>
        <button type="button" class="ghost" data-act="delete-milestone" data-id="${esc(m.id)}" aria-label="Delete ${esc(m.title)}">${icon("trash")}</button>
      </div>`).join("")}
    </section>`;
  }).join("");
  return `${header}<div class="card lifeline-wrap" tabindex="0" aria-label="Lifeline, scroll sideways">${lifelineSVG()}</div><div style="margin-top:18px">${blocks}</div>`;
}

function viewGoals() {
  const filter = ui.goalFilter;
  const goals = state.goals
    .filter(g => filter === "all" || g.category === filter || g.owner === filter)
    .sort((x, y) => goalProgress(x) - goalProgress(y) || (x.due || "9999").localeCompare(y.due || "9999"));
  const n = names();
  const filterButtons = [["all", "All"], ["both", "Shared"], ["a", n.a], ["b", n.b],
    ...Object.entries(CATEGORIES).map(([id, c]) => [id, c.name])];
  return `<div class="section-head"><div><h1>Our goals</h1><p class="muted">Big dreams broken into small next steps. Shared goals, plus each other's personal goals to cheer on.</p></div>
    <button type="button" class="primary" data-act="add-goal">+ Goal</button></div>
  <div class="filters" role="group" aria-label="Filter goals">${filterButtons.map(([id, label]) =>
    `<button type="button" data-act="goal-filter" data-id="${esc(id)}" aria-pressed="${filter === id}">${esc(label)}</button>`).join("")}</div>
  ${goals.length ? `<div class="grid">${goals.map(goalCard).join("")}</div>` :
    `<div class="empty">${state.goals.length ? "No goals match this filter." : "Add your first goal — e.g. “Save for our wedding”, “Run a 10k together”, “Learn to cook 5 family recipes”."}</div>`}`;
}
function goalCard(goal) {
  const category = CATEGORIES[goal.category] || CATEGORIES.love;
  const progress = goalProgress(goal);
  const steps = goal.steps || [];
  return `<article class="card">
    <div class="goal-head">
      <div style="flex:1;min-width:0"><h3>${esc(goal.title)}</h3>
        <div class="row small"><span class="chip">${esc(category.name)}</span><span class="chip">${esc(ownerLabel(goal.owner))}</span>${goal.due ? `<span class="chip">${esc(formatDate(goal.due, "month"))}</span>` : ""}
          ${progress === 1 ? '<span class="chip ok">✓ Done</span>' : ""}
          <span style="margin-left:auto;white-space:nowrap">
            <button type="button" class="ghost" data-act="edit-goal" data-id="${esc(goal.id)}" aria-label="Edit ${esc(goal.title)}">${icon("pencil")}</button><button type="button" class="ghost" data-act="delete-goal" data-id="${esc(goal.id)}" aria-label="Delete ${esc(goal.title)}">${icon("trash")}</button></span></div></div></div>
    ${goal.notes ? `<p class="small muted">${esc(goal.notes)}</p>` : ""}
    <div class="bar" style="margin:8px 0" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100)}"><span style="width:${progress * 100}%"></span></div>
    ${steps.map(step => `<label class="step-row ${step.done ? "done" : ""}"><input type="checkbox" data-toggle="step" data-goal="${esc(goal.id)}" data-id="${esc(step.id)}" ${step.done ? "checked" : ""}><span>${esc(step.text)}</span></label>`).join("")}
    ${!steps.length ? `<label class="step-row"><input type="checkbox" data-toggle="goal" data-id="${esc(goal.id)}" ${goal.done ? "checked" : ""}><span>Mark goal complete</span></label>` : ""}
    <form class="row" data-form="add-step" data-goal="${esc(goal.id)}" style="margin-top:6px;flex-wrap:nowrap">
      <input name="text" placeholder="Add a next step…" aria-label="Add a step to ${esc(goal.title)}" style="flex:1;min-width:0"><button type="submit">Add</button></form>
  </article>`;
}

function viewMoney() {
  const now = ui.now;
  const cur = state.couple.currency;
  const total = totalSaved(state);
  const monthly = state.funds.reduce((sum, f) => sum + (Number(f.monthly) || 0), 0);
  const r = state.retirement;
  const plan = retirementPlan(state, now);
  const education = educationPlans(state, now);
  const fundCards = state.funds.map(fund => {
    const s = fundStatus(fund, state, now);
    const logged = fundContributions(fund, state).slice().sort(byDate);
    const who = splitLine(contributionSplit(logged), cur);
    const dream = fund.bucketId ? state.bucket.find(item => item.id === fund.bucketId) : null;
    let line;
    if (s.months === 0) line = '<span class="chip ok">Fully funded</span>';
    else if (!Number.isFinite(s.months)) line = '<span class="small muted">Add a monthly amount to see when you\'ll get there.</span>';
    else line = `<span class="small">Reached <b>${esc(s.reachDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }))}</b> (${s.months} months)</span>`;
    let deadlineLine = "";
    if (s.milestone) {
      deadlineLine = s.onTrack
        ? `<div class="chip ok" style="margin-top:6px">✓ On track for ${esc(s.milestone.title)}</div>`
        : `<div class="chip warn" style="margin-top:6px;white-space:normal">Needs ${esc(money(s.needed, cur))}/mo for ${esc(s.milestone.title)} (${esc(formatDate(s.milestone.date, "month"))})</div>`;
    }
    return `<article class="card">
      <div class="spread"><div style="min-width:0"><h3>${esc(fund.name)}</h3><div class="small muted">${esc(money(s.saved, cur))} of ${esc(money(fund.target, cur))} · ${esc(money(fund.monthly, cur))}/month</div>
        ${dream ? `<span class="chip" style="margin-top:4px;white-space:normal">${icon("heart")} For: ${esc(dream.text)}</span>` : ""}</div>
        <button type="button" class="ghost" data-act="edit-fund" data-id="${esc(fund.id)}" aria-label="Edit ${esc(fund.name)}">${icon("pencil")}</button>
        <button type="button" class="ghost" data-act="delete-fund" data-id="${esc(fund.id)}" aria-label="Delete ${esc(fund.name)}">${icon("trash")}</button></div>
      <div class="bar" style="margin:10px 0"><span style="width:${s.progress * 100}%"></span></div>
      ${line}${deadlineLine}
      ${who ? `<div class="small muted" style="margin-top:6px">Added so far: ${who}</div>` : ""}
      ${logged.length ? `<details class="small" style="margin-top:4px"><summary>History (${logged.length})</summary><ul class="clean">${logged.slice(-6).reverse().map(c => `<li class="spread">
          <span>${esc(formatDate(c.date))} · ${esc(c.by === "a" || c.by === "b" ? ownerLabel(c.by) : "Together")}</span><span>${Number(c.amount) < 0 ? "−" : "+"}${esc(money(Math.abs(Number(c.amount) || 0), cur))}
          <button type="button" class="ghost" data-act="delete-contribution" data-id="${esc(c.id)}" aria-label="Undo this ${esc(money(Math.abs(Number(c.amount) || 0), cur))} entry">${icon("close")}</button></span></li>`).join("")}</ul></details>` : ""}
      <form class="row" data-form="deposit" data-id="${esc(fund.id)}" style="margin-top:10px;flex-wrap:nowrap">
        ${amountInput("amount", `Add savings to ${fund.name}`, { style: "flex:1;min-width:0" })}
        ${contributorSelect(`Who is adding to ${fund.name}`)}<button type="submit">+ Add</button></form>
    </article>`;
  }).join("");
  return `<div class="section-head"><div><h1>Money for our life</h1><p class="muted">Savings pots for each big moment, linked to your roadmap so you know if you're on track.</p></div>
    <button type="button" class="primary" data-act="add-fund">+ Savings pot</button></div>
  <div class="card"><div class="stats">
    <div class="stat"><b>${esc(money(total, cur))}</b><span class="small muted">saved in pots</span></div>
    <div class="stat"><b>${esc(money(monthly, cur))}</b><span class="small muted">saved per month</span></div>
    <div class="stat"><b>${state.funds.filter(f => fundStatus(f, state, now).onTrack === false).length}</b><span class="small muted">pots behind</span></div></div></div>
  ${state.funds.length ? `<div class="grid" style="margin-top:14px">${fundCards}</div>` :
    `<div class="empty" style="margin-top:14px">No savings pots yet.<br><button type="button" class="primary" data-act="default-funds" style="margin-top:10px">Add starter pots (emergency, wedding, home)</button></div>`}
  ${challengesCardHTML(now)}
  ${incomeCardHTML()}
  ${debtCardHTML(now)}
  <div class="section-head"><h2>Retiring together</h2></div>
  <div class="card">
    <form class="fields-2" data-form="retirement">
      <label class="field">Retirement savings today (${esc(cur)})<input name="saved" type="number" step="any" value="${esc(r.saved)}"></label>
      <label class="field">We add per month (${esc(cur)})<input name="monthly" type="number" step="any" value="${esc(r.monthly)}"></label>
      <label class="field">Retire when both are age<input name="retireAge" type="number" min="40" max="85" value="${esc(state.couple.retireAge)}"></label>
      <label class="field">Yearly spending we want in retirement (today's ${esc(cur)})<input name="spend" type="number" step="any" value="${esc(r.spend)}"></label>
      <details class="assumptions" style="grid-column:1/-1">
        <summary class="small">Assumptions: ${esc(r.rate)}% return · ${esc(r.fees)}% fees · ${esc(r.inflation)}% inflation · ${esc(r.withdrawal)}% withdrawal — change</summary>
        <div class="fields-2" style="margin-top:8px">
          <label class="field">Expected yearly return (%)<input name="rate" type="number" step="0.1" value="${esc(r.rate)}"></label>
          <label class="field">Fees &amp; tax drag per year (%)<input name="fees" type="number" step="0.1" value="${esc(r.fees)}"></label>
          <label class="field">Inflation per year (%)<input name="inflation" type="number" step="0.1" value="${esc(r.inflation)}"></label>
          <label class="field">Safe withdrawal rate (%)<input name="withdrawal" type="number" step="0.1" value="${esc(r.withdrawal)}"></label>
        </div>
      </details>
    </form>
    <div class="stats" style="margin-top:6px">
      <div class="stat"><b>${esc(money(plan.projectedReal, cur))}</b><span class="small muted">projected, in today's money</span></div>
      <div class="stat"><b>${esc(money(plan.incomeReal, cur))}</b><span class="small muted">≈ yearly income it supports</span></div>
      ${plan.targetReal ? `<div class="stat"><b>${Math.round((plan.onTrack || 0) * 100)}%</b><span class="small muted">of the ${esc(money(plan.targetReal, cur))} you need</span></div>` : ""}
    </div>
    <p class="small" style="margin-top:10px">In about <b>${Math.round(plan.years)} years</b>${plan.retireOn ? ` (${esc(plan.retireOn.toLocaleDateString(undefined, { month: "short", year: "numeric" }))})` : ""} that's ${esc(money(plan.projectedNominal, cur))} in future money (return ${esc(plan.netRate.toFixed(1))}% after fees).
      ${plan.targetReal ? (plan.onTrack >= 1
        ? '<span class="chip ok">✓ On track</span>'
        : `<span class="chip warn" style="white-space:normal">Save about ${esc(money(plan.neededMonthly, cur))}/month to get there (you save ${esc(money(r.monthly, cur))})</span>`)
        : '<span class="muted">Add your desired yearly spending to see how much you need.</span>'}</p>
    <p class="small muted">Estimates only, using steady average returns. Real markets go up and down; tax rules differ by country. Not financial advice — check big decisions with a licensed adviser.</p>
  </div>
  ${freedomCardHTML(now)}
  <div class="grid" style="margin-top:14px">
    <section class="card">
      <h2>Education funds</h2>
      <form class="fields-2" data-form="retirement">
        <label class="field">Education cost per child (today's ${esc(cur)})<input name="eduCost" type="number" step="any" value="${esc(r.eduCost)}"></label>
        <label class="field">Education inflation per year (%)<input name="eduInflation" type="number" step="0.1" value="${esc(r.eduInflation)}"></label>
      </form>
      ${!state.kids.length ? '<p class="small muted">Add your children (or a due date) in Settings to plan their education funds.</p>'
        : !education.length ? '<p class="small muted">Enter an expected cost to see how much to save per child.</p>'
        : `<ul class="clean">${education.map(e => `<li class="spread small"><div><b>${esc(e.kid.name)}</b> — starts ${esc(e.start.toLocaleDateString(undefined, { month: "short", year: "numeric" }))}<br><span class="muted">≈ ${esc(money(e.cost, cur))} by then</span></div>
          <span class="chip">${esc(money(e.monthly, cur))}/mo</span></li>`).join("")}</ul>`}
    </section>
    <section class="card">
      <h2>Bank statement → real surplus</h2>
      <p class="small">Export a CSV from your bank app (most banks offer it under statements or transactions) and see what you really save each month.</p>
      <div class="row"><label class="btn" tabindex="0" role="button" data-file-trigger>Choose statement CSV<input type="file" accept=".csv,text/csv,text/plain" data-statement hidden></label>
        <label class="btn" tabindex="0" role="button" data-file-trigger>Import net-worth CSV<input type="file" accept=".csv,text/csv,text/plain" data-networth-csv hidden></label></div>
      ${statementResultHTML(cur)}
      <p class="small muted">Read on this device only — nothing is uploaded and individual transactions are never saved. No bank login, no aggregator.</p>
    </section>
    <section class="card">
      <h2>Net worth</h2>
      ${netWorthSummary(cur)}
      <form class="row" data-form="networth" style="margin-top:10px">
        <input name="date" type="date" value="${esc(toISO(now))}" aria-label="Date" style="flex:1 1 130px;min-width:0">
        <input name="assets" type="number" step="any" placeholder="Assets (${esc(cur)})" aria-label="Total assets" style="flex:1 1 110px;min-width:0" required>
        <input name="debts" type="number" step="any" placeholder="Debts (${esc(cur)})" aria-label="Total debts" style="flex:1 1 110px;min-width:0">
        <button type="submit">Add</button>
      </form>
      <p class="small muted">A monthly snapshot of everything you own minus everything you owe — no bank login needed.</p>
    </section>
    ${mintCardHTML()}
  </div>`;
}

/** Money tab: the "financial freedom" number and when you'll reach it, from the retirement assumptions. */
function freedomCardHTML(now) {
  const cur = state.couple.currency;
  const r = state.retirement;
  const plan = freedomPlan(state, now);
  const n = names();
  const head = `<div class="section-head"><div><h2>Financial freedom</h2>
    <p class="muted small">The point where your investments could pay for the life you want, so work becomes a choice.</p></div></div>`;
  if (!plan) {
    return `${head}<div class="card"><p class="small">Enter the <b>yearly spending we want</b> in Retiring together above to see your freedom number and the date you could reach it.</p></div>`;
  }
  const milestone = state.milestones.find(m => m.auto === "freedom");
  const ages = [plan.ageA !== null ? `${esc(n.a)} ${plan.ageA}` : "", plan.ageB !== null ? `${esc(n.b)} ${plan.ageB}` : ""].filter(Boolean).join(" · ");
  let when;
  if (plan.months === 0) {
    when = '<span class="chip ok">✓ Already there on these assumptions</span>';
  } else if (plan.months === null) {
    when = `<span class="chip warn" style="white-space:normal">Not reachable within 100 years at ${esc(money(plan.monthly, cur))}/month. Raise the monthly amount in Retiring together.</span>`;
  } else {
    when = `At ${esc(money(plan.monthly, cur))}/month you get there around <b>${esc(plan.date.toLocaleDateString(undefined, { month: "short", year: "numeric" }))}</b>
      (${Math.round(plan.months / 12)} years${ages ? `; ${ages}` : ""}).`;
  }
  const lever = plan.soonerBy > 0
    ? `<p class="small">Saving ${esc(money(plan.extraMonthly, cur))} more a month gets you there about <b>${plan.soonerBy >= 24 ? `${Math.round(plan.soonerBy / 12)} years` : `${plan.soonerBy} months`} sooner</b>.</p>` : "";
  const button = plan.date && plan.months > 0
    ? `<button type="button" data-act="freedom-milestone">${milestone ? "Update the date on our roadmap" : "Put it on our roadmap"}</button>` : "";
  return `${head}<div class="card">
    <div class="stats">
      <div class="stat"><b>${esc(money(plan.target, cur))}</b><span class="small muted">freedom number (${esc(money(r.spend, cur))}/year ÷ ${esc(r.withdrawal)}%)</span></div>
      <div class="stat"><b>${esc(money(plan.invested, cur))}</b><span class="small muted">invested today</span></div>
      <div class="stat"><b>${Math.round(plan.progress * 100)}%</b><span class="small muted">of the way</span></div>
    </div>
    <div class="bar" style="margin:10px 0" role="progressbar" aria-label="Progress to financial freedom" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(plan.progress * 100)}"><span style="width:${plan.progress * 100}%"></span></div>
    <p class="small">${when}</p>
    ${lever}
    ${plan.afterDebts && plan.afterDebts.date ? `<p class="small">Once you're debt-free (${esc(plan.afterDebts.debtFreeDate.toLocaleDateString(undefined, { month: "short", year: "numeric" }))}), moving the ${esc(money(plan.afterDebts.amount, cur))}/month you paid on debts into investing gets you free around <b>${esc(plan.afterDebts.date.toLocaleDateString(undefined, { month: "short", year: "numeric" }))}</b>.</p>` : ""}
    ${button}
    <p class="small muted">Uses your retirement savings, monthly amount and assumptions above, growing at ${esc(plan.realRate.toFixed(1))}% a year after fees and inflation. In today's money. An estimate, not financial advice.</p>
  </div>`;
}

function statementResultHTML(cur) {
  const result = ui.statement;
  if (!result) return "";
  if (result.error) return `<p class="small"><span class="chip warn">${esc(result.error)}</span></p>`;
  const rows = result.months.slice(-12).map(m => `<tr><td>${esc(m.month)}</td><td>${esc(money(m.income, cur))}</td><td>${esc(money(m.spending, cur))}</td>
    <td><b class="${m.net >= 0 ? "" : "neg"}">${esc(money(m.net, cur))}</b></td></tr>`).join("");
  return `<div style="overflow-x:auto;margin-top:8px"><table class="small" style="width:100%;border-collapse:collapse">
      <thead><tr><th align="left">Month</th><th align="left">In</th><th align="left">Out</th><th align="left">Net</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small">Average over ${result.months.length} month${result.months.length === 1 ? "" : "s"}: <b>${esc(money(result.avgNet, cur))}/month</b> left over
      <span class="muted">(${result.used} transactions · columns “${esc(result.columns.date)}” / “${esc(result.columns.amount)}”${result.skipped ? ` · ${result.skipped} rows skipped` : ""}; first and last months may be partial)</span></p>
    ${result.avgNet > 0 ? `<button type="button" data-act="statement-use">Use ${esc(money(Math.round(result.avgNet), cur))}/month as our retirement saving</button>` : '<p class="small"><span class="chip warn">Spending is above income on average — worth a money talk</span></p>'}`;
}

function netWorthSummary(cur) {
  const entries = state.networth.slice().sort(byDate);
  if (!entries.length) return '<div class="empty">Add your first snapshot to start the trend.</div>';
  const values = entries.map(e => (Number(e.assets) || 0) - (Number(e.debts) || 0));
  const latest = values[values.length - 1];
  const change = values.length > 1 ? latest - values[values.length - 2] : null;
  let chart = "";
  if (values.length > 1) {
    const recent = values.slice(-12);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const span = max - min || 1;
    const x = i => 6 + i * 288 / (recent.length - 1);
    const y = v => 40 - (v - min) / span * 34;
    chart = `<svg class="trend" viewBox="0 0 300 46" preserveAspectRatio="none" role="img" aria-label="Net worth trend"><path d="${recent.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(--green)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  return `<div class="money-big">${esc(money(latest, cur))}</div>
    ${change !== null ? `<span class="chip ${change >= 0 ? "ok" : "warn"}">${change >= 0 ? "▲" : "▼"} ${esc(money(Math.abs(change), cur))} since last snapshot</span>` : ""}
    ${chart}
    <ul class="clean small">${entries.slice(-3).reverse().map(e => `<li class="spread"><span>${esc(formatDate(e.date))}: ${esc(money((Number(e.assets) || 0) - (Number(e.debts) || 0), cur))}</span>
      <button type="button" class="ghost" data-act="delete-networth" data-id="${esc(e.id)}" aria-label="Delete snapshot">${icon("trash")}</button></li>`).join("")}</ul>`;
}

