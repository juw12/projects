/* ------------------------------------------- views: us, program & settings */
function viewUs() {
  const now = ui.now;
  const n = names();
  const checkins = state.checkins.slice().sort(byDate).reverse();
  const last = checkins[0];
  const daysSince = last ? daysBetween(parseDate(last.date), now) : null;
  const hearts = value => `<span class="pips" role="img" aria-label="${value} of 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= value ? "on" : ""}"></i>`).join("")}</span>`;
  const stageIdx = currentStageIndex(state);
  const talkStatus = id => state.talks[id]?.status || "todo";
  const agreed = TALKS.filter(t => talkStatus(t.id) === "agreed").length;
  const programCard = viewProgram();
  return `<div class="section-head"><div><h1>Us</h1><p class="muted">The relationship is the plan. Check in monthly, talk about the big stuff before it's urgent, and keep dreaming.</p></div></div>
  ${programCard}
  <div class="grid" style="margin-top:14px">
    <section class="card">
      <div class="spread"><h2>Monthly check-in</h2>${daysSince === null || daysSince >= 30 ? '<span class="chip warn">Due</span>' : `<span class="chip ok">Next in ${30 - daysSince} days</span>`}</div>
      <p class="small muted">10 minutes, phones away. Rate how you feel, share one appreciation, one need, one plan.</p>
      <button type="button" class="primary" data-act="checkin">Start check-in</button>
      ${trendSVG()}
      ${checkins.length ? `<ul class="clean" style="margin-top:12px">${checkins.slice(0, 4).map(c => `<li>
        <div class="spread"><b>${esc(formatDate(c.date))}</b><button type="button" class="ghost" data-act="delete-checkin" data-id="${esc(c.id)}" aria-label="Delete check-in">${icon("trash")}</button></div>
        <div class="small">${esc(n.a)} ${hearts(c.ratingA)} · ${esc(n.b)} ${hearts(c.ratingB)}</div>
        ${c.appreciate ? `<div class="small"><span class="muted">Appreciated:</span> ${esc(c.appreciate)}</div>` : ""}
        ${c.need ? `<div class="small"><span class="muted">Need:</span> ${esc(c.need)}</div>` : ""}
        ${c.plan ? `<div class="small"><span class="muted">Next month:</span> ${esc(c.plan)}</div>` : ""}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="card">
      <h2>Bucket list for two</h2>
      <form class="row" data-form="bucket" style="flex-wrap:nowrap;margin-bottom:10px"><input name="text" placeholder="See the northern lights…" aria-label="New bucket list item" style="flex:1;min-width:0"><button type="submit">Add</button></form>
      ${state.bucket.length ? `<div class="bucket">${state.bucket.map(item => {
        const pot = state.funds.find(f => f.bucketId === item.id);
        const potProgress = pot ? fundStatus(pot, state, ui.now).progress : 0;
        const potTag = pot
          ? `<span class="small muted">${potProgress >= 1 ? "· funded" : `· ${Math.round(potProgress * 100)}% saved`}</span>`
          : item.done ? "" : `<button type="button" class="ghost small" data-act="bucket-save" data-id="${esc(item.id)}" aria-label="Start a savings pot for ${esc(item.text)}" title="Start a savings pot for this" style="white-space:nowrap">${icon("wallet")} Save</button>`;
        return `<span class="item ${item.done ? "done" : ""}">
        <span>${esc(item.text)}</span>${potTag}
        <button type="button" class="ghost" data-act="toggle-bucket" data-id="${esc(item.id)}" aria-label="${item.done ? "Mark not done" : "Mark done"}"><span class="tick ${item.done ? "on" : ""}">${item.done ? icon("check") : ""}</span></button>
        <button type="button" class="ghost" data-act="delete-bucket" data-id="${esc(item.id)}" aria-label="Delete ${esc(item.text)}">${icon("close")}</button></span>`;
      }).join("")}</div>`
        : `<div class="empty">Dream a little: places, experiences, things to learn together.</div>`}
    </section>
  </div>
  <div class="section-head"><div><h2>Talk before you decide</h2><p class="muted small">Conversations that strong couples have before life forces them. ${agreed}/${TALKS.length} agreed.</p></div></div>
  ${STAGES.map((stage, index) => {
    const topics = TALKS.filter(t => t.stage === stage.id);
    if (!topics.length) return "";
    return `<h3 style="margin-top:14px">${stage.name}${index === stageIdx ? ' <span class="chip">now</span>' : ""}</h3>
      ${topics.map(topic => {
        const entry = state.talks[topic.id] || {};
        const status = entry.status || "todo";
        const chip = status === "agreed" ? '<span class="chip ok">✓ Agreed</span>' : status === "talked" ? '<span class="chip">Talked</span>' : '<span class="chip warn">Not yet</span>';
        return `<details class="talk"><summary><span><b>${esc(topic.title)}</b></span>${chip}</summary>
          <ol>${topic.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ol>
          <label class="field">Status<select data-talk-status="${esc(topic.id)}">
            ${[["todo", "Not yet"], ["talked", "We talked"], ["agreed", "We agreed"]].map(([value, label]) => `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="field">What we decided<textarea data-talk-note="${esc(topic.id)}" placeholder="Write down what you agreed, in your own words.">${esc(entry.note || "")}</textarea></label>
        </details>`;
      }).join("")}`;
  }).join("")}`;
}

function trendSVG() {
  const points = checkinTrend(state.checkins).slice(-12);
  if (points.length < 2) return "";
  const width = 300;
  const height = 46;
  const x = i => 6 + i * (width - 12) / (points.length - 1);
  const y = score => height - 6 - (score - 1) / 4 * (height - 12);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const last = points[points.length - 1].score;
  const previous = points[points.length - 2].score;
  const direction = last > previous ? "Trending warmer" : last < previous ? "A little lower — worth talking about" : "Steady";
  return `<svg class="trend" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Connection trend over ${points.length} check-ins">
    <path d="${path}" fill="none" style="stroke:var(--rose)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="3" style="fill:var(--rose)"/>`).join("")}</svg>
    <div class="small muted">Connection trend: ${direction}</div>`;
}

/** Whole-plan printable summary (rendered into #print-area just before printing). */
function printSummaryHTML() {
  const n = names();
  const cur = state.couple.currency;
  const now = new Date();
  const milestones = state.milestones.slice().sort(byDate);
  const agreedTalks = TALKS.filter(t => state.talks[t.id]?.status === "agreed");
  return `<h1>${esc(n.a)} & ${esc(n.b)} — Our life plan</h1>
    <p>Together since ${esc(formatDate(state.couple.since))}${state.couple.wedding ? ` · Wedding ${esc(formatDate(state.couple.wedding))}` : ""} · Printed ${esc(now.toLocaleDateString())}</p>
    <h2>Roadmap</h2>
    <table><thead><tr><th>Stage</th><th>Milestone</th><th>Date</th><th>Ages</th><th>Done</th></tr></thead><tbody>
    ${milestones.map(m => `<tr><td>${esc(STAGES[STAGE_INDEX[m.stage] ?? 0].name)}</td><td>${esc(m.title)}</td><td>${esc(formatDate(m.date))}</td><td>${agesLine(m.date).replace("Ages ", "")}</td><td>${m.done ? "✓" : ""}</td></tr>`).join("")}
    </tbody></table>
    <h2>Goals</h2>
    <table><thead><tr><th>Goal</th><th>Whose</th><th>Target</th><th>Progress</th></tr></thead><tbody>
    ${state.goals.map(g => `<tr><td>${esc(g.title)}</td><td>${esc(ownerLabel(g.owner))}</td><td>${esc(g.due ? formatDate(g.due, "month") : "")}</td><td>${Math.round(goalProgress(g) * 100)}%</td></tr>`).join("")}
    </tbody></table>
    <h2>Savings</h2>
    <table><thead><tr><th>Pot</th><th>Saved</th><th>Target</th><th>Per month</th></tr></thead><tbody>
    ${state.funds.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(money(fundSaved(f, state), cur))}</td><td>${esc(money(f.target, cur))}</td><td>${esc(money(f.monthly, cur))}</td></tr>`).join("")}
    </tbody></table>
    <h2>What we agreed</h2>
    ${agreedTalks.length ? agreedTalks.map(t => `<p><b>${esc(t.title)}:</b> ${esc(state.talks[t.id].note || "Agreed")}</p>`).join("") : "<p>—</p>"}
    <h2>Bucket list</h2>
    <p>${state.bucket.map(b => `${b.done ? "✓" : "○"} ${esc(b.text)}`).join(" &nbsp; ") || "—"}</p>`;
}

function viewProgram() {
  const program = state.program;
  const progress = programProgress(program);
  const disclaimer = '<p class="small muted">Short summaries of published research (The Gottman Institute, PREP). Educational, not therapy — if things feel hard, a licensed couples counsellor can help.</p>';
  if (!program.started) {
    return `<section class="card hero"><div class="spread"><div><h2>Foundations: 8 weeks to a stronger team</h2>
      <p class="small">One short, research-based session a week: love maps, turning toward each other, fighting fair, money as a team and more. About 20 minutes together.</p></div></div>
      <button type="button" class="primary" data-act="program-start">Start week 1</button>${disclaimer}</section>`;
  }
  const weeks = PROGRAM.map((week, index) => {
    const number = index + 1;
    const done = program.done[number];
    const open = number === progress.currentWeek;
    return `<details class="talk" ${open ? "open" : ""}><summary><span><b>Week ${number}: ${esc(week.title)}</b></span>
        ${done ? '<span class="chip ok">✓ Done</span>' : open ? '<span class="chip">This week</span>' : ""}</summary>
      <p class="small">${esc(week.idea)}</p>
      <p class="small"><b>Try this:</b></p><ol class="small">${week.exercise.map(step => `<li>${esc(step)}</li>`).join("")}</ol>
      <p class="small"><b>Talk about:</b></p><ul class="small">${week.prompts.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
      <p class="small muted">Source: ${week.sourceUrl ? `<a href="${esc(week.sourceUrl)}" target="_blank" rel="noopener">${esc(week.sourceName)}</a>` : esc(week.sourceName)}</p>
      <label class="field">Our notes<textarea data-program-note="${number}" placeholder="What did we learn or agree?">${esc(program.notes[number] || "")}</textarea></label>
      ${done ? `<p class="small muted">Completed ${esc(formatDate(done))}</p>` : `<button type="button" class="primary" data-act="program-done" data-id="${number}">Mark week ${number} done</button>`}
    </details>`;
  }).join("");
  return `<section class="card"><div class="spread"><h2>Foundations</h2><span class="chip ${progress.finished ? "ok" : ""}">${progress.doneCount}/${PROGRAM.length} weeks</span></div>
    <div class="bar" style="margin:8px 0"><span style="width:${progress.doneCount / PROGRAM.length * 100}%"></span></div>
    ${progress.finished ? '<p class="small">You finished all 8 weeks. Keep the weekly State of the Union going.</p>' : ""}
    ${weeks}${disclaimer}</section>`;
}

/**
 * Plain-language privacy status. Single source of truth so every screen says the same thing:
 * by default nothing leaves the device; partner sync uploads only ciphertext; reminders upload only times.
 */
function privacyStatus(syncOn = Boolean(sync && sync.active), remindersOn = reminders.enabled) {
  const parts = [];
  if (!syncOn && !remindersOn) {
    parts.push("Your plan lives only in this browser — nothing is uploaded.");
  } else {
    parts.push("Your plan is stored in this browser.");
    if (syncOn) parts.push("Partner sync uploads it end-to-end encrypted; the server can't read it.");
    if (remindersOn) parts.push("Reminders send the server only the times to ping, never the text.");
  }
  return parts.join(" ");
}

function syncStatusText() {
  if (!sync || !sync.active) return "";
  if (sync.status === "error") return `${sync.error || "Sync paused."} Will retry.`;
  if (sync.status === "syncing") return "Syncing…";
  const last = sync.config.lastSyncAt;
  return last ? `✓ Synced ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first sync…";
}

function viewConnect() {
  const syncCard = sync && sync.active
    ? `<p class="small"><span class="chip ok">Sharing one plan</span> <span class="muted" id="sync-status">${esc(syncStatusText())}</span></p>
       <label class="field">Pairing link — send only to your partner<input readonly value="${esc(sync.inviteLink())}" id="invite-link" onfocus="this.select()"></label>
       <div class="row"><button type="button" data-act="sync-copy">Copy link</button><button type="button" data-act="sync-share">Share…</button>
         <button type="button" data-act="sync-now">Sync now</button><button type="button" data-act="sync-rotate">Replace link…</button>
         <button type="button" class="ghost" data-act="sync-leave">Stop syncing on this device</button></div>
       <p class="small muted">${sync.protected
         ? "Passphrase-protected: the link alone can't open or change your plan. Your partner enters the passphrase once on their phone."
         : "Anyone with this link can open your plan. Add a passphrase or, if the link leaked, use <b>Replace link</b> — the old link stops working immediately."}</p>`
    : `<p class="small">Use one plan on both your phones. Changes sync within seconds and merge item by item, so you can both edit.</p>
       <label class="field">Passphrase (optional, recommended)<input id="sync-pass" type="password" autocomplete="new-password" minlength="6" placeholder="Something only you two know"></label>
       <p class="small muted">Tell it to your partner in person or by phone — not in the same message as the link. Then a leaked link alone can't open your plan.</p>
       <button type="button" class="primary" data-act="sync-create">Create a pairing link</button>
       <p class="small muted">End-to-end encrypted: your plan is locked on this device before upload, and the key only lives inside the link (after the #), which is never sent to the server.</p>`;
  const pref = reminders.pref();
  const reminderCard = pref?.enabled
    ? `<p class="small"><span class="chip ok">On</span> ${pref.nextAt ? `Next: ${esc(new Date(pref.nextAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}` : ""}</p>
       <div class="row"><button type="button" data-act="push-test">Send a test</button><button type="button" class="ghost" data-act="push-off">Turn off</button></div>`
    : `<p class="small">Get a nudge for monthly check-ins, upcoming milestones, anniversaries, birthdays and backups.</p>
       <button type="button" class="primary" data-act="push-on">Turn on reminders</button>
       ${reminders.isIOS() && !reminders.isStandalone() ? '<p class="small muted">On iPhone/iPad: first tap Share → <b>Add to Home Screen</b>, then open Together from your Home Screen.</p>' : ""}`;
  const installCard = reminders.isStandalone()
    ? '<p class="small"><span class="chip ok">✓ Installed</span> Together works offline.</p>'
    : ui.installPrompt
      ? '<p class="small">Add Together to your home screen — it opens like an app and works offline.</p><button type="button" class="primary" data-act="install">Install app</button>'
      : `<p class="small">${reminders.isIOS() ? "Tap Share → <b>Add to Home Screen</b>." : "Use your browser's menu → <b>Install app</b> / <b>Add to Home screen</b>."} It opens like an app and works offline.</p>`;
  return `<h2 class="settings-group">Connect</h2>
  <div class="grid" style="margin-bottom:14px">
    <section class="card"><h2>Partner sync</h2>${syncCard}</section>
    <section class="card"><h2>Reminders</h2>${reminderCard}
      <p class="small muted" style="margin-top:10px">Prefer your calendar?</p>
      <div class="row"><button type="button" data-act="ics-checkin">Monthly check-in (.ics)</button><button type="button" data-act="ics-milestones">Milestones (.ics)</button></div>
      <p class="small muted">Reminder text stays on your device; the server only knows when to ping.</p></section>
    <section class="card"><h2>Install & share</h2>${installCard}
      <h3 style="margin-top:14px">Share Together</h3>
      <p class="small">Free, private and open source. Know a couple who'd like it?</p>
      <div class="row"><button type="button" data-act="share-app">Share the app</button>
        <a class="btn" href="${SOURCE_URL}" target="_blank" rel="noopener">Source code</a>
        <a class="btn" href="https://github.com/juw12/projects/issues/new?title=Together%20feedback%3A%20" target="_blank" rel="noopener">Feedback</a></div></section>
  </div>`;
}

function viewSettings() {
  const c = state.couple;
  const backupLine = state.lastBackupAt
    ? `Last backup: ${esc(new Date(state.lastBackupAt).toLocaleDateString())}${backupDue(state, ui.now) ? ' <span class="chip warn">due</span>' : ' <span class="chip ok">Up to date</span>'}`
    : 'No backup yet <span class="chip warn">recommended</span>';
  return `<div class="section-head"><h1>Settings & backup</h1></div>
  ${viewConnect()}
  <h2 class="settings-group">Our details & data</h2>
  <div class="grid">
    <form class="card" data-form="profile">
      <h2>About us</h2>
      <div class="fields-2">
        <label class="field">Partner 1 name<input name="aName" value="${esc(c.a.name)}" required></label>
        <label class="field">Partner 2 name<input name="bName" value="${esc(c.b.name)}" required></label>
        <label class="field">Partner 1 birthday<input name="aBirth" type="date" value="${esc(c.a.birth)}"></label>
        <label class="field">Partner 2 birthday<input name="bBirth" type="date" value="${esc(c.b.birth)}"></label>
        <label class="field">Together since<input name="since" type="date" value="${esc(c.since)}"></label>
        <label class="field">Wedding date<input name="wedding" type="date" value="${esc(c.wedding)}"></label>
        <label class="field">Life stage<select name="stage">${STAGES.map(s => `<option value="${s.id}" ${c.stage === s.id ? "selected" : ""}>${s.name}</option>`).join("")}</select></label>
        <label class="field">Currency symbol<input name="currency" value="${esc(c.currency)}" maxlength="4"></label>
      </div>
      <button class="primary" type="submit">Save</button>
    </form>
    <section class="card">
      <h2>Backup & privacy</h2>
      <p class="small muted" data-privacy>${esc(privacyStatus())}</p>
      <p class="small muted">Clearing browser data erases this device's copy${sync && sync.active ? " (your partner's phone still has one)" : ""}, so export a backup now and then.</p>
      <p class="small">${backupLine}</p>
      <div class="row">
        <button type="button" class="primary" data-act="export">Export backup</button>
        <label class="btn" tabindex="0" role="button" data-file-trigger>Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
        <button type="button" data-act="print">Print our plan</button>
      </div>
    </section>
    <section class="card">
      <h2>Appearance</h2>
      <p class="small muted">Applies to this device only.</p>
      <div class="segmented" role="group" aria-label="Appearance">${THEME_OPTIONS.map(option =>
        `<button type="button" data-act="theme" data-id="${option.id}" aria-pressed="${theme.preference === option.id}">${icon(option.icon)}<span>${option.label}</span></button>`).join("")}</div>
    </section>
    <section class="card">
      <h2>Our children</h2>
      <p class="small muted">Add children (or a due date) and their ages appear on every milestone.</p>
      ${state.kids.length ? `<ul class="clean">${state.kids.map(kid => `<li class="spread"><div>${esc(kid.name)} <span class="small muted">· ${esc(formatDate(kid.birth))}${parseDate(kid.birth) > ui.now ? " (expected)" : ""}</span></div>
        <button type="button" class="ghost" data-act="delete-kid" data-id="${esc(kid.id)}" aria-label="Remove ${esc(kid.name)}">${icon("trash")}</button></li>`).join("")}</ul>` : ""}
      <form data-form="kid" style="margin-top:8px">
        <div class="fields-2">
          <label class="field">Name<input name="name" required></label>
          <label class="field">Birthday or due date<input name="birth" type="date" required></label>
        </div>
        <button type="submit">Add child</button></form>
      <h3 style="margin-top:16px">Roadmap</h3>
      <button type="button" data-act="template">Add suggested milestones</button>
      <h3 style="margin-top:16px">Danger zone</h3>
      <button type="button" data-act="reset" class="danger">Erase everything on this device</button>
    </section>
  </div>`;
}

