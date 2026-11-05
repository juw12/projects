/* ------------------------------------------------------- dialogs & actions */
function openDialog(title, fieldsHTML, onSubmit, submitLabel = "Save") {
  const dialog = document.getElementById("dialog");
  const form = document.getElementById("dialog-form");
  form.innerHTML = `<h2 id="dialog-title">${esc(title)}</h2>${fieldsHTML}
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></div>`;
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    dialog.close();
    onSubmit(values);
  };
  form.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.showModal();
  const first = form.querySelector("input, select, textarea");
  if (first) first.focus();
}
const stageOptions = selected => STAGES.map(s => `<option value="${s.id}" ${selected === s.id ? "selected" : ""}>${s.icon} ${s.name}</option>`).join("");

function milestoneDialog(existing) {
  const m = existing || { stage: STAGES[currentStageIndex(state)].id, title: "", date: "", notes: "" };
  openDialog(existing ? "Edit milestone" : "New milestone", `
    <label class="field">What's the milestone?<input name="title" required value="${esc(m.title)}" placeholder="e.g. Move in together"></label>
    <div class="fields-2"><label class="field">Target date<input name="date" type="date" value="${esc(m.date)}"></label>
    <label class="field">Life stage<select name="stage">${stageOptions(m.stage)}</select></label></div>
    <label class="field">Notes<textarea name="notes">${esc(m.notes)}</textarea></label>`, values => {
    if (existing) Object.assign(existing, values);
    else state.milestones.push({ id: uid(), done: false, ...values });
    commit(existing ? "Milestone updated" : "Milestone added");
  });
}
function goalDialog(existing) {
  const g = existing || { title: "", category: "love", owner: "both", due: "", notes: "" };
  const n = names();
  openDialog(existing ? "Edit goal" : "New goal", `
    <label class="field">Goal<input name="title" required value="${esc(g.title)}" placeholder="e.g. Pay off student loans"></label>
    <div class="fields-2">
      <label class="field">Category<select name="category">${Object.entries(CATEGORIES).map(([id, c]) => `<option value="${id}" ${g.category === id ? "selected" : ""}>${c.icon} ${c.name}</option>`).join("")}</select></label>
      <label class="field">Whose goal?<select name="owner">${[["both", "Both of us"], ["a", n.a], ["b", n.b]].map(([v, l]) => `<option value="${v}" ${g.owner === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label class="field">Target date<input name="due" type="date" value="${esc(g.due)}"></label></div>
    ${existing ? "" : '<label class="field">First steps (one per line)<textarea name="steps" placeholder="Agree a budget\nOpen a joint savings account"></textarea></label>'}
    <label class="field">Why it matters to us<textarea name="notes">${esc(g.notes)}</textarea></label>`, values => {
    const steps = (values.steps || "").split("\n").map(s => s.trim()).filter(Boolean).map(text => ({ id: uid(), text, done: false }));
    delete values.steps;
    if (existing) Object.assign(existing, values);
    else state.goals.push({ id: uid(), done: false, steps, ...values });
    commit(existing ? "Goal updated" : "Goal added");
  });
}
/** New/edit savings pot. "Saved so far" is the pot's full balance; logged deposits are kept and the
 *  stored starting amount absorbs the difference, so the history of who added what stays intact. */
function fundDialog(existing, preset = {}) {
  const f = existing || { name: "", target: "", saved: 0, monthly: "", milestoneId: "", bucketId: "", ...preset };
  const logged = existing ? fundLogged(existing, state) : 0;
  const balance = existing ? fundSaved(existing, state) : Number(f.saved) || 0;
  const upcoming = state.milestones.filter(m => !m.done && m.date).sort(byDate);
  const dreams = state.bucket.filter(item => !item.done || item.id === f.bucketId);
  openDialog(existing ? "Edit savings pot" : "New savings pot", `
    <label class="field">Name<input name="name" required value="${esc(f.name)}" placeholder="e.g. Wedding"></label>
    <div class="fields-2">
      <label class="field">Target (${esc(state.couple.currency)})<input name="target" type="number" step="any" min="0" required value="${esc(f.target)}"></label>
      <label class="field">Saved so far<input name="saved" type="number" step="any" min="0" value="${esc(Math.round(balance * 100) / 100)}"></label>
      <label class="field">We save per month<input name="monthly" type="number" step="any" min="0" value="${esc(f.monthly)}"></label>
      <label class="field">Needed by milestone<select name="milestoneId"><option value="">— none —</option>${upcoming.map(m => `<option value="${esc(m.id)}" ${f.milestoneId === m.id ? "selected" : ""}>${esc(m.title)} (${esc(formatDate(m.date, "month"))})</option>`).join("")}</select></label>
      ${dreams.length ? `<label class="field" style="grid-column:1/-1">For a bucket-list dream<select name="bucketId"><option value="">— none —</option>${dreams.map(item => `<option value="${esc(item.id)}" ${f.bucketId === item.id ? "selected" : ""}>${esc(item.text)}</option>`).join("")}</select></label>` : ""}
    </div>`, values => {
    const clean = { name: values.name, milestoneId: values.milestoneId, bucketId: values.bucketId || "", target: Number(values.target) || 0, monthly: Number(values.monthly) || 0 };
    const enteredBalance = Number(values.saved) || 0;
    // Only rewrite the starting amount when the balance was actually edited (keeps partner edits mergeable).
    if (!existing || Math.abs(enteredBalance - balance) > 0.005) clean.saved = enteredBalance - logged;
    if (existing) Object.assign(existing, clean);
    else state.funds.push({ id: uid(), saved: 0, ...clean });
    commit(existing ? "Savings pot updated" : "Savings pot added");
  });
}
function checkinDialog() {
  const n = names();
  const rating = (name, label) => `<fieldset style="border:0;padding:0;margin:0 0 10px"><legend class="small muted">${esc(label)}</legend><div class="rating">
    ${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${name}" value="${v}" aria-label="${v} of 5" ${v === 4 ? "checked" : ""}><span aria-hidden="true">${v}</span></label>`).join("")}</div><div class="rating-scale small muted" aria-hidden="true"><span>Distant</span><span>Very close</span></div></fieldset>`;
  openDialog("Our monthly check-in", `
    <p class="small muted">Take turns. Listen to understand, not to reply.</p>
    ${rating("ratingA", `${n.a}: how connected do you feel?`)}${rating("ratingB", `${n.b}: how connected do you feel?`)}
    <label class="field">Something I appreciated about you this month<textarea name="appreciate"></textarea></label>
    <label class="field">Something I need a bit more of<textarea name="need"></textarea></label>
    <label class="field">One thing we'll do together next month<input name="plan"></label>`, values => {
    state.checkins.push({ id: uid(), date: toISO(new Date()), ratingA: Number(values.ratingA) || 3, ratingB: Number(values.ratingB) || 3,
      appreciate: values.appreciate || "", need: values.need || "", plan: values.plan || "" });
    commit("Check-in saved.");
  });
}

function debtDialog(existing) {
  const d = existing || { name: "", balance: "", rate: "", minimum: "" };
  const cur = state.couple.currency;
  openDialog(existing ? "Edit debt" : "New debt", `
    <label class="field">What is it?<input name="name" required value="${esc(d.name)}" placeholder="e.g. Credit card, car loan"></label>
    <div class="fields-2">
      <label class="field">Still owed (${esc(cur)})${amountInput("balance", "Still owed", { value: d.balance, required: true })}</label>
      <label class="field">Interest per year (%)<input name="rate" type="number" step="0.01" min="0" value="${esc(d.rate)}" placeholder="e.g. 24"></label>
      <label class="field">Minimum payment / month (${esc(cur)})${amountInput("minimum", "Minimum payment per month", { value: d.minimum })}</label>
    </div>`, values => {
    const clean = { name: values.name.trim(), balance: Math.max(0, parseTypedAmount(values.balance) || 0), rate: Math.max(0, Number(values.rate) || 0), minimum: Math.max(0, parseTypedAmount(values.minimum) || 0) };
    if (existing) Object.assign(existing, clean);
    else state.debts.push({ id: uid(), ...clean });
    commit(existing ? "Debt updated" : "Debt added");
  });
}
function challengeDialog() {
  const cur = state.couple.currency;
  openDialog("Start a saving challenge", `
    <label class="field">Challenge<select name="kind">${Object.entries(CHALLENGES).map(([id, c]) => `<option value="${id}">${esc(c.name)}</option>`).join("")}</select></label>
    <p class="small muted">${Object.values(CHALLENGES).map(c => `<b>${esc(c.name)}:</b> ${esc(c.blurb)}`).join("<br>")}</p>
    <div class="fields-2">
      <label class="field">Into which pot?<select name="fundId">${state.funds.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select></label>
      <label class="field">Amount (${esc(cur)}): week 1 of 52, or per weekend${amountInput("unit", "Amount", { required: true })}</label>
    </div>`, values => {
    const unit = parseTypedAmount(values.unit);
    if (!(unit > 0) || !findIn(state.funds, values.fundId)) {
      toast("Enter an amount above zero.");
      return;
    }
    state.challenges.push({ id: uid(), kind: CHALLENGES[values.kind] ? values.kind : "52week", fundId: values.fundId, unit, started: toISO(new Date()), ticks: {} });
    commit("Challenge started. Week 1 is on Home.");
  }, "Start");
}
function dateDialog() {
  const fun = funPlan(state, new Date());
  const cur = state.couple.currency;
  openDialog("We went out", `
    <label class="field">What did you do?<input name="text" required value="${esc(fun.idea.text)}"></label>
    <div class="fields-2">
      <label class="field">When<input name="date" type="date" value="${esc(toISO(new Date()))}"></label>
      <label class="field">It cost (${esc(cur)})${amountInput("cost", "Cost", { value: fun.idea.cost || "" })}</label>
    </div>
    ${fun.idea.bucketId ? `<label class="row small"><input type="checkbox" name="tickBucket" value="${esc(fun.idea.bucketId)}" checked style="width:auto"> Tick it off our bucket list</label>` : ""}`, values => {
    const text = (values.text || "").trim();
    if (!text) return;
    state.dates.push({ id: uid(), date: parseDate(values.date) ? values.date : toISO(new Date()), text, cost: Math.max(0, parseTypedAmount(values.cost) || 0) });
    const item = values.tickBucket ? findIn(state.bucket, values.tickBucket) : null;
    if (item) item.done = true;
    commit(item ? "Date saved and ticked off the bucket list." : "Date saved. Have fun!");
  });
}
/** After a deposit: cheer when the couple's weekly streak reaches a milestone. */
function streakCelebration(before) {
  const after = savingStreak(state, new Date());
  if (after.weeks > before.weeks && STREAK_MILESTONES.includes(after.weeks)) {
    return ` ${after.weeks} weeks in a row, keep it going!`;
  }
  return after.thisWeekDone && !before.thisWeekDone ? " This week's target is done." : "";
}
function mintSummary(id) {
  const found = readMintBooks(mintStorage()).find(b => b.id === id);
  return found ? summarizeMintBook(found.book, ui.now) : null;  // same numbers the card shows
}

function findIn(list, id) {
  return list.find(item => item.id === id);
}
function removeFrom(key, id, label) {
  commitWithUndo(`${label} deleted`, () => {
    state[key] = state[key].filter(item => item.id !== id);
  });
}
function addTemplate() {
  const fresh = buildTemplate(state.couple, new Date());
  const existingTitles = new Set(state.milestones.map(m => m.title));
  const added = fresh.filter(m => !existingTitles.has(m.title));
  state.milestones.push(...added);
  commit(`${added.length} suggested milestones added`);
}
function downloadFile(filename, type, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = filename.replace(/[^\w.-]+/g, "_");
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Downloaded ${link.download}`);
}
function downloadBackup() {
  openDialog("Export a backup", `
    <p class="small">A backup file holds your whole plan. Add a password so it's safe to email or keep in cloud storage —
      without the password nobody can open it (including you, so don't lose it).</p>
    <label class="field">Password (optional, recommended)<input name="password" type="password" autocomplete="new-password" minlength="6"></label>`,
  async values => {
    const password = values.password || "";
    if (password && password.length < 6) {
      toast("Use at least 6 characters (or leave it empty for a plain file).");
      return;
    }
    const n = names();
    state.lastBackupAt = new Date().toISOString();
    persist();
    const plain = store.exportText(state);
    const body = password ? await encryptBackup(plain, password) : plain;
    downloadFile(`together-${n.a}-${n.b}-${toISO(new Date())}${password ? "-locked" : ""}.json`, "application/json", body);
    toast(password ? "Password-protected backup downloaded" : "Backup downloaded");
  }, "Download");
}
/** Ask for the password of an encrypted backup, then hand the decrypted text back to the normal import path. */
function importEncryptedBackup(envelope, onPlainText) {
  openDialog("Unlock backup", `
    <p class="small">This backup is password-protected.</p>
    <label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>`,
  async values => {
    try {
      onPlainText(await decryptBackup(envelope, values.password || ""));
    } catch (error) {
      toast(`${error.message}`);
    }
  }, "Unlock");
}

const actions = {
  "tab": id => {
    ui.tab = id || "home";
    render();
    window.scrollTo(0, 0);
    document.getElementById("view").focus({ preventScroll: true });
  },
  "add-milestone": () => milestoneDialog(null),
  "edit-milestone": id => milestoneDialog(findIn(state.milestones, id)),
  "delete-milestone": id => removeFrom("milestones", id, "Milestone"),
  "add-goal": () => goalDialog(null),
  "edit-goal": id => goalDialog(findIn(state.goals, id)),
  "delete-goal": id => removeFrom("goals", id, "Goal"),
  "goal-filter": id => {
    ui.goalFilter = id;
    render();
  },
  "theme": id => {
    theme.set(id);
    render();
  },
  "theme-cycle": () => {
    theme.cycle();
    if (ui.tab === "settings") render();
  },
  "add-fund": () => fundDialog(null),
  "edit-fund": id => fundDialog(findIn(state.funds, id)),
  "delete-fund": id => commitWithUndo("Savings pot deleted", () => {
    state.funds = state.funds.filter(fund => fund.id !== id);
    state.contributions = state.contributions.filter(c => c.fundId !== id);
  }),
  "delete-contribution": id => removeFrom("contributions", id, "Entry"),
  "bucket-save": id => {
    const item = findIn(state.bucket, id);
    if (item) fundDialog(null, { name: item.text.slice(0, 60), bucketId: item.id });
  },
  "freedom-milestone": () => {
    const plan = freedomPlan(state, new Date());
    if (!plan || !plan.date || !(plan.months > 0)) return;
    const date = toISO(plan.date);
    const retireOn = retirementDate(state.couple);
    const stage = retireOn && plan.date >= retireOn ? "retire" : "growth";
    const notes = `Freedom number ${money(plan.target, state.couple.currency)} (estimate from Money → Financial freedom).`;
    const existing = state.milestones.find(m => m.auto === "freedom");
    if (existing) Object.assign(existing, { date, stage, notes });
    else state.milestones.push({ id: uid(), auto: "freedom", stage, title: "Financially free", date, done: false, notes });
    commit(existing ? "Roadmap date updated" : "Added “Financially free” to your roadmap");
  },
  "default-funds": () => {
    for (const preset of DEFAULT_FUNDS) {
      const milestone = state.milestones.find(m => m.title === preset.milestoneTitle && !m.done);
      state.funds.push({ id: uid(), name: preset.name, target: 0, saved: 0, monthly: 0, milestoneId: milestone ? milestone.id : "" });
    }
    commit("Starter pots added — use Edit to set targets");
  },
  "checkin": () => checkinDialog(),
  "add-debt": () => debtDialog(null),
  "edit-debt": id => debtDialog(findIn(state.debts, id)),
  "delete-debt": id => removeFrom("debts", id, "Debt"),
  "add-challenge": () => {
    if (state.funds.length) challengeDialog();
  },
  "delete-challenge": id => removeFrom("challenges", id, "Challenge"),
  "challenge-tick": id => {
    const challenge = findIn(state.challenges, id);
    const fund = challenge && findIn(state.funds, challenge.fundId);
    if (!challenge || !fund) return;
    const status = challengeStatus(challenge, new Date());
    if (status.doneThisStep || status.finished) return;
    const before = savingStreak(state, new Date());
    if (status.amount > 0) {
      state.contributions.push({ id: uid(), fundId: fund.id, amount: status.amount, by: lastContributor(), date: toISO(new Date()) });
    }
    challenge.ticks = { ...(challenge.ticks || {}), [status.step]: toISO(new Date()) };
    const finished = challengeStatus(challenge, new Date()).finished;
    commit(finished ? `${status.def.name} complete! ${money(status.goal, state.couple.currency)} saved together.`
      : `Week ${status.step} done: ${money(status.amount, state.couple.currency)} into ${fund.name}.${streakCelebration(before)}`);
  },
  "date-done": () => dateDialog(),
  "delete-date": id => removeFrom("dates", id, "Date"),
  "mint-spend": id => {
    const summary = mintSummary(id);
    if (!summary || !(summary.spent > 0)) return;
    const spend = Math.round(summary.spent * 12);
    commitWithUndo(`Yearly spending set to ${money(spend, state.couple.currency)} from Mint`, () => {
      state.retirement = { ...state.retirement, spend };
    });
  },
  "mint-saving": id => {
    const summary = mintSummary(id);
    if (!summary || !(summary.saved > 0)) return;
    const monthly = Math.round(summary.saved);
    commitWithUndo(`Monthly investing set to ${money(monthly, state.couple.currency)} from Mint`, () => {
      state.retirement = { ...state.retirement, monthly };
    });
  },
  "delete-checkin": id => removeFrom("checkins", id, "Check-in"),
  "toggle-bucket": id => {
    const item = findIn(state.bucket, id);
    if (item) item.done = !item.done;
    commit(item && item.done ? "Ticked off the bucket list." : "");
  },
  "delete-bucket": id => removeFrom("bucket", id, "Bucket list item"),
  "template": () => addTemplate(),
  "export": () => downloadBackup(),
  "print": () => {
    document.getElementById("print-area").innerHTML = printSummaryHTML();
    window.print();
  },
  "delete-kid": id => removeFrom("kids", id, "Child"),
  "ics-checkin": () => {
    const start = new Date();
    start.setDate(start.getDate() + ((7 - start.getDay()) % 7 || 7));
    const n = names();
    downloadFile("together-monthly-checkin.ics", "text/calendar", buildICS([{ uid: "checkin-" + uid(), title: `${n.a} & ${n.b} — monthly check-in`,
      date: toISO(start), time: "19:00", rrule: "FREQ=MONTHLY", description: "10 minutes, phones away. Open Together → Us → Start check-in." }]));
  },
  "ics-milestones": () => {
    const today = toISO(new Date());
    const upcoming = state.milestones.filter(m => !m.done && m.date && m.date >= today);
    if (!upcoming.length) {
      toast("No upcoming milestones with dates yet");
      return;
    }
    downloadFile("together-milestones.ics", "text/calendar", buildICS(upcoming.map(m => ({ uid: "ms-" + m.id, title: m.title, date: m.date, allDay: true, description: m.notes }))));
  },
  "program-start": () => {
    state.program = { ...state.program, started: toISO(new Date()) };
    commit("Week 1 unlocked — about 20 minutes together");
  },
  "program-done": id => {
    state.program = { ...state.program, done: { ...state.program.done, [id]: toISO(new Date()) } };
    commit(Number(id) === PROGRAM.length ? "All 8 weeks done. Great teamwork." : `Week ${id} done`);
  },
  "delete-networth": id => removeFrom("networth", id, "Snapshot"),
  "sync-create": async () => {
    if (!navigator.onLine) {
      toast("You're offline — connect to create a pairing link.");
      return;
    }
    try {
      const passphrase = document.getElementById("sync-pass")?.value || "";
      if (passphrase && passphrase.trim().length < 6) {
        toast("Use at least 6 characters for the passphrase (or leave it empty).");
        return;
      }
      toast("Creating your encrypted pairing link…");
      await sync.create(passphrase);
      render();
      toast("Link ready — send it to your partner");
    } catch (error) {
      sync.leave();
      render();
      toast(`${error.message}`);
    }
  },
  "sync-copy": async () => {
    try {
      await navigator.clipboard.writeText(sync.inviteLink());
      toast("Link copied");
    } catch (error) {
      document.getElementById("invite-link")?.select();
      toast("Press Ctrl+C / long-press to copy");
    }
  },
  "sync-share": async () => {
    const link = sync.inviteLink();
    if (navigator.share) {
      navigator.share({ title: "Join our plan on Together", text: "Open this to share our life plan", url: link }).catch(() => {});
    } else {
      actions["sync-copy"]();
    }
  },
  "sync-now": async () => {
    await sync.pull().catch(() => {});
    render();
    toast(sync.status === "error" ? `${sync.error}` : "Up to date");
  },
  "ios-hint-dismiss": () => {
    localStorage.setItem(`${store.key}.iosHintDismissed`, "1");
    render();
  },
  "statement-use": () => {
    if (!ui.statement || !(ui.statement.avgNet > 0)) return;
    const monthly = Math.round(ui.statement.avgNet);
    commitWithUndo(`Retirement saving set to ${money(monthly, state.couple.currency)}/month`, () => {
      state.retirement = { ...state.retirement, monthly };
    });
  },
  "sync-rotate": () => {
    openDialog("Replace the pairing link", `
      <p class="small">Moves your plan to a new encrypted room with a new key and deletes the old one, so the old link opens nothing.
        Your partner will need the new link (and passphrase, if you set one).</p>
      <label class="field">New passphrase (optional)<input name="passphrase" type="password" autocomplete="new-password" placeholder="Leave empty for link-only"></label>`,
    async values => {
      const passphrase = values.passphrase || "";
      if (passphrase && passphrase.trim().length < 6) {
        toast("Use at least 6 characters for the passphrase (or leave it empty).");
        return;
      }
      try {
        toast("Replacing the link…");
        await sync.rotate(passphrase);
        render();
        toast("New link ready — send it to your partner");
      } catch (error) {
        render();
        toast(`${error.message}`);
      }
    }, "Replace link");
  },
  "sync-leave": () => {
    if (!confirm("Stop syncing on this device? Your plan stays here; your partner keeps their copy.")) return;
    sync.leave();
    render();
    toast("Sync stopped on this device");
  },
  "push-on": async () => {
    try {
      await reminders.enable();
      render();
      toast("Reminders on");
    } catch (error) {
      toast(`${error.message}`);
    }
  },
  "push-off": async () => {
    await reminders.disable();
    render();
    toast("Reminders off");
  },
  "push-test": async () => {
    // Real end-to-end test: server -> push service -> this phone's service worker.
    const pref = reminders.pref();
    try {
      await swStore.set("reminders", [
        { at: Date.now(), title: "Together", body: "Push works — your reminders will arrive like this.", tag: "together-test" },
        ...reminderSchedule(state),
      ]);
      const response = await fetch(`${CLOUD_URL}/v1/push/${pref.id}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.status === 429) toast("Just sent one — wait a few seconds.");
      else if (result.status === 201) toast("Sent through the push service — it should pop up in a few seconds.");
      else toast(`The push service refused it (${result.status || response.status}). Try turning reminders off and on.`);
    } catch (error) {
      toast("Couldn't reach the reminder server — are you offline?");
    }
  },
  "install": async () => {
    if (!ui.installPrompt) return;
    ui.installPrompt.prompt();
    await ui.installPrompt.userChoice.catch(() => {});
    ui.installPrompt = null;
    render();
  },
  "share-app": () => {
    const data = { title: "Together — plan your whole life as a couple", text: "A free, private app to plan our future together", url: PUBLIC_APP_URL };
    if (navigator.share) {
      navigator.share(data).catch(() => {});
    } else {
      navigator.clipboard.writeText(PUBLIC_APP_URL).then(() => toast("Link copied"), () => toast(PUBLIC_APP_URL));
    }
  },
  "reset": () => {
    if (!confirm("Erase your whole plan from this device? Export a backup first if you want to keep it.")) return;
    commitWithUndo("Plan erased", () => {
      state = blankState();
    });
  },
};

const forms = {
  onboard: values => {
    state.couple.a = { name: values.aName.trim(), birth: values.aBirth };
    state.couple.b = { name: values.bName.trim(), birth: values.bBirth };
    state.couple.since = values.since;
    state.couple.wedding = values.wedding;
    state.couple.stage = values.stage;
    if (values.template) state.milestones.push(...buildTemplate(state.couple, new Date()));
    ui.tab = "home";
    commit(`Welcome, ${state.couple.a.name} & ${state.couple.b.name}`);
  },
  profile: values => {
    Object.assign(state.couple, { since: values.since, wedding: values.wedding, stage: values.stage, currency: values.currency || "$" });
    state.couple.a = { name: values.aName.trim(), birth: values.aBirth };
    state.couple.b = { name: values.bName.trim(), birth: values.bBirth };
    commit("Saved");
  },
  "add-step": (values, form) => {
    const goal = findIn(state.goals, form.dataset.goal);
    const text = (values.text || "").trim();
    if (!goal || !text) return;
    goal.steps.push({ id: uid(), text, done: false });
    commit();
  },
  deposit: (values, form) => {
    const fund = findIn(state.funds, form.dataset.id);
    const amount = parseTypedAmount(values.amount);
    if (!fund || !amount || !Number.isFinite(amount)) return;
    const before = savingStreak(state, new Date());
    const by = ["a", "b", "both"].includes(values.by) ? values.by : "both";
    try {
      localStorage.setItem(store.key + ME_KEY_SUFFIX, by);
    } catch (error) {
      /* storage blocked: the choice just isn't remembered */
    }
    state.contributions.push({ id: uid(), fundId: fund.id, amount, by, date: toISO(new Date()) });
    const reached = fundSaved(fund, state) >= (Number(fund.target) || 0) && fund.target > 0;
    commit(amount > 0
      ? `${money(amount, state.couple.currency)} added to ${fund.name}${reached ? " — target reached!" : ""}${streakCelebration(before)}`
      : `${money(-amount, state.couple.currency)} taken out of ${fund.name}`);
  },
  networth: values => {
    const assets = Number(values.assets);
    if (!parseDate(values.date) || !Number.isFinite(assets)) return;
    state.networth.push({ id: uid(), date: values.date, assets, debts: Number(values.debts) || 0 });
    commit("Snapshot saved");
  },
  kid: values => {
    const name = (values.name || "").trim();
    if (!name || !parseDate(values.birth)) return;
    state.kids.push({ id: uid(), name, birth: values.birth });
    commit(`${name} added to the family`);
  },
  bucket: values => {
    const text = (values.text || "").trim();
    if (!text) return;
    const cost = parseTypedAmount(values.cost);
    state.bucket.push({ id: uid(), text, done: false, ...(cost > 0 ? { cost } : {}) });
    commit();
  },
};

function toast(message, withUndo = false) {
  if (!message) return;
  const box = document.getElementById("toast");
  document.getElementById("toast-text").textContent = message;
  document.getElementById("toast-undo").hidden = !withUndo;
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), withUndo ? 7000 : 2600);
}

function bindEvents() {
  document.addEventListener("click", event => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const handler = actions[target.dataset.act];
    if (handler) handler(target.dataset.id);
  });
  document.addEventListener("submit", event => {
    const form = event.target.closest("[data-form]");
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const handler = forms[form.dataset.form];
    if (handler) handler(values, form);
  });
  document.addEventListener("change", event => {
    const el = event.target;
    if (el.dataset.toggle === "milestone") {
      const m = findIn(state.milestones, el.dataset.id);
      if (m) m.done = el.checked;
      commit(el.checked ? `Done: ${m.title}` : "");
    } else if (el.dataset.toggle === "step") {
      const goal = findIn(state.goals, el.dataset.goal);
      const step = goal && findIn(goal.steps, el.dataset.id);
      if (step) step.done = el.checked;
      commit(goal && goalProgress(goal) === 1 ? `Goal complete: ${goal.title}` : "");
    } else if (el.dataset.toggle === "goal") {
      const goal = findIn(state.goals, el.dataset.id);
      if (goal) goal.done = el.checked;
      commit(el.checked ? "Goal complete" : "");
    } else if (el.dataset.talkStatus) {
      state.talks[el.dataset.talkStatus] = { ...(state.talks[el.dataset.talkStatus] || {}), status: el.value };
      persist();
      const summaryChip = el.closest("details").querySelector("summary .chip");
      summaryChip.className = `chip ${el.value === "agreed" ? "ok" : el.value === "todo" ? "warn" : ""}`;
      summaryChip.textContent = el.value === "agreed" ? "✓ Agreed" : el.value === "talked" ? "Talked" : "Not yet";
    } else if (el.dataset.programNote) {
      state.program = { ...state.program, notes: { ...state.program.notes, [el.dataset.programNote]: el.value } };
      persist();
      toast("Saved");
    } else if (el.dataset.talkNote) {
      state.talks[el.dataset.talkNote] = { ...(state.talks[el.dataset.talkNote] || {}), note: el.value };
      persist();
      toast("Saved");
    } else if (el.closest('[data-form="retirement"]')) {
      const form = el.closest("form");
      const values = Object.fromEntries(new FormData(form).entries());
      const TEXT_SETTINGS = new Set(["splitMode", "debtMethod"]);
      const numeric = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, TEXT_SETTINGS.has(key) ? String(value) : Number(value) || 0]));
      const { retireAge, ...retirementValues } = numeric;
      state.retirement = { ...state.retirement, ...retirementValues };
      if ("retireAge" in values) state.couple.retireAge = clamp(retireAge || 65, 40, 85);
      commit();
    } else if (el.matches("[data-mint-book]")) {
      ui.mintBook = el.value;
      render();
    } else if (el.matches("[data-statement]") && el.files[0]) {
      el.files[0].text().then(text => {
        ui.statement = analyzeStatement(text);
        render();
        if (!ui.statement.error) toast(`Read ${ui.statement.used} transactions (nothing uploaded)`);
      });
      el.value = "";
    } else if (el.matches("[data-networth-csv]") && el.files[0]) {
      el.files[0].text().then(text => {
        const entries = parseNetWorthCsv(text);
        if (!entries.length) {
          toast("Need columns like Date, Assets, Debts");
          return;
        }
        const known = new Set(state.networth.map(e => e.date));
        const fresh = entries.filter(e => !known.has(e.date));
        commitWithUndo(`Added ${fresh.length} net-worth snapshot${fresh.length === 1 ? "" : "s"}`, () => {
          state.networth.push(...fresh.map(e => ({ id: uid(), ...e })));
        });
      });
      el.value = "";
    } else if (el.matches("[data-import]") && el.files[0]) {
      const reader = new FileReader();
      const applyImport = text => {
        const result = store.importText(text);
        if (result.encrypted) {
          importEncryptedBackup(result.encrypted, applyImport);
          return;
        }
        if (result.error) {
          toast(`${result.error}`);
          return;
        }
        if (!confirm("Replace the plan on this device with this backup?")) return;
        commitWithUndo("Backup imported ✓", () => {
          state = result.state;
        });
      };
      reader.onload = () => applyImport(String(reader.result));
      reader.readAsText(el.files[0]);
      el.value = "";
    }
  });
  document.addEventListener("keydown", event => {
    const trigger = event.target.closest && event.target.closest("[data-file-trigger]");
    if (trigger && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      trigger.querySelector("input[type=file]").click();
    }
  });
  document.getElementById("toast-undo").addEventListener("click", () => {
    if (!undoSnapshot) return;
    state = migrate(JSON.parse(undoSnapshot));
    undoSnapshot = null;
    persist();
    render();
    toast("Restored");
  });
}

