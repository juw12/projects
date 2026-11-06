/* -------------------------------------------------------------- self-tests */
async function runSelfTests() {
  const realBefore = localStorage.getItem(APP_KEY);
  store.key = "together.selftest";
  store.persist = true;
  const tests = [];
  const test = async (name, fn) => {
    try {
      const ok = await fn();
      tests.push({ name, ok: ok === true, msg: ok === true ? "" : String(ok) });
    } catch (error) {
      tests.push({ name, ok: false, msg: String(error && error.stack || error) });
    }
  };
  const fixedNow = new Date(2026, 0, 15);
  state = blankState();

  await test("create couple via onboarding form handler", () => {
    forms.onboard({ aName: "Ann", bName: "Ben", aBirth: "1996-03-10", bBirth: "1994-11-02", since: "2023-06-01", wedding: "", stage: "dating", template: "on" });
    return state.couple.a.name === "Ann" && state.milestones.length > 10 || "couple not created";
  });
  await test("milestone ages: ageOn handles birthdays", () =>
    ageOn("1996-03-10", new Date(2026, 2, 9)) === 29 && ageOn("1996-03-10", new Date(2026, 2, 10)) === 30 || "wrong age");
  await test("milestone template spans dating to golden years", () => {
    const list = buildTemplate({ ...state.couple, retireAge: 65 }, fixedNow);
    const stages = new Set(list.map(m => m.stage));
    return stages.has("dating") && stages.has("married") && stages.has("kids") && stages.has("retire") && stages.has("golden") || [...stages].join();
  });
  await test("milestone template: retire date = both partners reach retire age", () => {
    const list = buildTemplate({ ...state.couple, retireAge: 65 }, fixedNow);
    return list.find(m => m.stage === "retire").date === "2061-03-10" || list.find(m => m.stage === "retire").date;
  });
  await test("milestone template skips past stages for married couples", () => {
    const list = buildTemplate({ ...state.couple, stage: "married", wedding: "2025-06-01", retireAge: 65 }, fixedNow);
    return !list.some(m => m.stage === "dating" || m.stage === "engaged") || "past stages included";
  });
  await test("goal add and complete via steps", () => {
    const goal = { id: "g1", title: "Trip", category: "travel", owner: "both", due: "", notes: "", done: false,
      steps: [{ id: "s1", text: "Book", done: true }, { id: "s2", text: "Pack", done: false }] };
    state.goals.push(goal);
    const half = goalProgress(goal) === 0.5;
    goal.steps[1].done = true;
    return half && goalProgress(goal) === 1 || "progress wrong";
  });
  await test("savings: months to reach target", () => monthsToReach(1000, 400, 100) === 6 && monthsToReach(500, 600, 0) === 0 && monthsToReach(500, 0, 0) === Infinity || "months wrong");
  await test("savings: required monthly for a deadline", () => Math.abs(requiredMonthly(1200, 0, new Date(2027, 0, 15), fixedNow) - 100) < 1e-9 || "required wrong");
  await test("savings: retirement future value", () => {
    const fv = futureValue(1000, 100, 12, 1);
    const expected = 1000 * Math.pow(1.01, 12) + 100 * (Math.pow(1.01, 12) - 1) / 0.01;
    return Math.abs(fv - expected) < 1e-6 && futureValue(100, 10, 0, 1) === 220 || fv;
  });
  await test("savings: on-track status vs linked milestone", () => {
    const test_state = blankState();
    test_state.milestones = [{ id: "m1", title: "Wedding", date: "2027-01-15", stage: "married", done: false }];
    const behind = fundStatus({ target: 2400, saved: 0, monthly: 100, milestoneId: "m1" }, test_state, fixedNow);
    const ahead = fundStatus({ target: 1200, saved: 0, monthly: 100, milestoneId: "m1" }, test_state, fixedNow);
    return behind.onTrack === false && Math.round(behind.needed) === 200 && ahead.onTrack === true || JSON.stringify([behind.onTrack, behind.needed, ahead.onTrack]);
  });
  await test("persist round trip", () => {
    store.save(state);
    const loaded = store.load();
    return loaded.couple.b.name === "Ben" && loaded.goals.length === 1 && loaded.schema === SCHEMA_VERSION || "load mismatch";
  });
  await test("export/import round trip", () => {
    const text = store.exportText(state);
    const result = store.importText(text);
    return !result.error && JSON.stringify(result.state.milestones) === JSON.stringify(state.milestones) || result.error;
  });
  await test("import rejects foreign or broken files", () =>
    !!store.importText("{not json").error && !!store.importText('{"hello":1}').error && !!store.importText('{"app":"together","state":{"schema":99}}').error || "accepted bad file");
  await test("migration from prototype schema", () => {
    const migrated = migrate({ a: "X", b: "Y", since: "2020-01-01", goals: [{ title: "G", done: true }], funds: [{ name: "F", target: 10, saved: 5, monthly: 1 }] });
    return migrated.couple.a.name === "X" && migrated.goals[0].done === true && migrated.funds[0].target === 10 && Array.isArray(migrated.checkins) || "migration failed";
  });
  await test("milestone overdue surfaces in focus, list capped at 5", () => {
    const probe = blankState();
    probe.milestones = [{ id: "o", title: "Engagement", stage: "engaged", date: "2025-12-01", done: false }];
    probe.goals = [{ id: "g", title: "G", category: "love", owner: "both", steps: [{ id: "s", text: "x", done: false }] }];
    probe.couple.since = "2020-01-20";
    const items = focusItems(probe, fixedNow);
    return items.some(i => i.icon === "clock" && i.text.includes("Engagement")) && items.length <= 5 && items[0].icon === "calendar" || JSON.stringify(items);
  });
  await test("focus items suggest a check-in and a talk", () => {
    const items = focusItems(state, fixedNow);
    return items.some(i => i.act === "checkin") && items.some(i => i.text.startsWith("Talk about")) || JSON.stringify(items);
  });
  await test("xss: names, goals, milestones, bucket render as text", () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    state.couple.a.name = evil;
    state.goals.push({ id: "x", title: evil, category: "love", owner: "a", due: "", notes: evil, done: false, steps: [{ id: "y", text: evil, done: false }] });
    state.milestones.push({ id: "z", title: evil, stage: "dating", date: "2030-01-01", done: false, notes: evil });
    state.bucket.push({ id: "b", text: evil, done: false });
    state.checkins.push({ id: "c", date: "2026-01-01", ratingA: 3, ratingB: 3, appreciate: evil, need: "", plan: "" });
    state.program = { started: "2026-01-01", done: {}, notes: { 1: evil } };
    state.kids.push({ id: "k-evil", name: evil, birth: "2020-01-01" });
    state.retirement.eduCost = 1000;
    let injected = 0;
    for (const tab of TABS) {
      ui.tab = tab.id;
      render();
      injected += document.querySelectorAll("#view img, #tabs img").length;
    }
    return injected === 0 && !window.__xss || `injected ${injected}`;
  });
  await test("xss: all tabs render without throwing", () => {
    for (const tab of TABS) {
      ui.tab = tab.id;
      render();
    }
    return true;
  });
  await test("delete with undo restores item", () => {
    const before = state.bucket.length;
    removeFrom("bucket", "b", "Bucket item");
    const removed = state.bucket.length === before - 1;
    document.getElementById("toast-undo").click();
    return removed && state.bucket.length === before || "undo failed";
  });
  await test("milestone ages include children once born", () => {
    state.couple.a.name = "Ann";
    state.kids = [{ id: "k1", name: "Kai", birth: "2028-05-01" }];
    const before = agesLine("2028-04-30");
    const after = agesLine("2033-06-01");
    return !before.includes("Kai") && after.includes("Kai 5") || `${before} | ${after}`;
  });
  await test("milestone celebrations: anniversary within 30 days", () => {
    const party = upcomingCelebrations({ couple: { ...state.couple, since: "2023-02-01", wedding: "", a: { name: "A", birth: "" }, b: { name: "B", birth: "" } }, kids: [] }, fixedNow);
    return party.length === 1 && party[0].days === 17 && party[0].years === 3 || JSON.stringify(party);
  });
  await test("calendar export: valid iCalendar with escaping", () => {
    const ics = buildICS([{ uid: "a", title: "Wedding, finally; yay", date: "2027-10-09", allDay: true }, { uid: "b", title: "Check-in", date: "2026-02-01", time: "19:00", rrule: "FREQ=MONTHLY" }]);
    return ics.startsWith("BEGIN:VCALENDAR") && ics.includes("SUMMARY:Wedding\\, finally\\; yay") && ics.includes("DTEND;VALUE=DATE:20271010") &&
      ics.includes("DTSTART:20260201T190000") && ics.includes("RRULE:FREQ=MONTHLY") && ics.split("BEGIN:VEVENT").length === 3 || ics;
  });
  await test("goal check-in trend averages both partners", () => {
    const trend = checkinTrend([{ date: "2026-02-01", ratingA: 5, ratingB: 3 }, { date: "2026-01-01", ratingA: 2, ratingB: 2 }]);
    return trend.length === 2 && trend[0].score === 2 && trend[1].score === 4 || JSON.stringify(trend);
  });
  await test("print summary includes every section and escapes text", () => {
    const html = printSummaryHTML();
    const box = document.createElement("div");
    box.innerHTML = html;
    return ["Roadmap", "Goals", "Savings", "What we agreed", "Bucket list"].every(h => html.includes(h)) && !box.querySelector("img") || "summary incomplete";
  });
  await test("persist: backup nudge after 30 days, not before", () => {
    const probe = { milestones: [{}], goals: [], checkins: [], lastBackupAt: null };
    const never = backupDue(probe, fixedNow);
    probe.lastBackupAt = new Date(2026, 0, 1).toISOString();
    const recent = backupDue(probe, fixedNow);
    probe.lastBackupAt = new Date(2025, 11, 1).toISOString();
    const stale = backupDue(probe, fixedNow);
    const empty = backupDue({ milestones: [], goals: [], checkins: [], lastBackupAt: null }, fixedNow);
    return never && !recent && stale && !empty || JSON.stringify([never, recent, stale, empty]);
  });
  await test("e2e couple onboarding through the real form", () => {
    state = blankState();
    ui.tab = "home";
    render();
    const form = document.querySelector('[data-form="onboard"]');
    if (!form || !document.getElementById("tabs").hidden) return "onboarding not shown or tabs visible";
    form.aName.value = "Zoe";
    form.bName.value = "Sam";
    form.aBirth.value = "1998-01-20";
    form.bBirth.value = "1997-07-07";
    form.stage.value = "engaged";
    form.wedding.value = "2027-09-18";
    form.requestSubmit();
    const weddingMilestone = state.milestones.find(m => m.title.startsWith("Wedding"));
    return state.couple.a.name === "Zoe" && !document.getElementById("tabs").hidden && !!document.querySelector(".hero") &&
      weddingMilestone && weddingMilestone.date === "2027-09-18" && !state.milestones.some(m => m.stage === "dating") || "onboarding flow failed";
  });
  await test("e2e goal dialog add, then tick a step", () => {
    actions.tab("goals");
    document.querySelector('[data-act="add-goal"]').click();
    const dialog = document.getElementById("dialog");
    if (!dialog.open) return "dialog did not open";
    const form = document.getElementById("dialog-form");
    form.title.value = "Visit Japan";
    form.category.value = "travel";
    form.steps.value = "Save flights\nBook ryokan";
    form.requestSubmit();
    const goal = state.goals.find(g => g.title === "Visit Japan");
    if (!goal || goal.steps.length !== 2 || dialog.open) return "goal not created from dialog";
    const box = document.querySelector(`[data-toggle="step"][data-goal="${goal.id}"]`);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return goalProgress(goal) === 0.5 || "step toggle failed";
  });
  await test("e2e savings deposit and children form", () => {
    state.funds.push({ id: "f1", name: "Honeymoon", target: 3000, saved: 100, monthly: 100, milestoneId: "" });
    actions.tab("money");
    const deposit = document.querySelector('[data-form="deposit"][data-id="f1"]');
    deposit.amount.value = "250";
    deposit.requestSubmit();
    actions.tab("settings");
    const kidForm = document.querySelector('[data-form="kid"]');
    kidForm.name.value = "Mo";
    kidForm.birth.value = "2029-03-03";
    kidForm.requestSubmit();
    const logged = state.contributions.find(c => c.fundId === "f1");
    return fundSaved(state.funds[0], state) === 350 && logged && logged.amount === 250 && state.kids.length === 1 && store.load().kids.length === 1 || "deposit/kid failed";
  });
  await test("sync: stamps changed records and tombstones deletions", () => {
    const before = migrate({ ...blankState(), goals: [{ id: "g1", title: "A", steps: [] }, { id: "g2", title: "B", steps: [] }] });
    const after = JSON.parse(JSON.stringify(before));
    after.goals[0].title = "A2";
    after.goals.splice(1, 1);
    stampChanges(before, after, 5000);
    return after.goals[0]._ts === 5000 && after._deleted.g2 === 5000 || JSON.stringify(after);
  });
  await test("sync: merge keeps both partners' concurrent edits; newest edit of the same item wins", () => {
    const base = migrate({ ...blankState(), milestones: [{ id: "m", title: "Wedding", date: "2027-10-10", stage: "married", _ts: 1 }] });
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    mine.goals.push({ id: "gm", title: "Mine", steps: [], _ts: 10 });
    mine.milestones[0].title = "Wedding (old idea)";
    mine.milestones[0]._ts = 10;
    theirs.bucket.push({ id: "bt", text: "Theirs", _ts: 11 });
    theirs.milestones[0].title = "Wedding in Bali";
    theirs.milestones[0]._ts = 20;
    const merged = mergeStates(mine, theirs, 30);
    return merged.goals.length === 1 && merged.bucket.length === 1 && merged.milestones[0].title === "Wedding in Bali" || JSON.stringify(merged);
  });
  await test("sync: field-level merge keeps both partners' edits to different fields of the same goal", () => {
    const base = migrate({ ...blankState(), goals: [{ id: "g", title: "Buy a home", notes: "", due: "", owner: "both", category: "home", done: false,
      steps: [{ id: "s1", text: "Save deposit", done: false }, { id: "s2", text: "Get mortgage pre-approval", done: false }] }] });
    stampChanges(blankState(), base, 1);
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    const mineBefore = JSON.parse(JSON.stringify(mine));
    const theirsBefore = JSON.parse(JSON.stringify(theirs));
    mine.goals[0].title = "Buy a flat";
    mine.goals[0].steps[0].done = true;
    stampChanges(mineBefore, mine, 10);
    theirs.goals[0].notes = "Near the park";
    theirs.goals[0].steps[1].done = true;
    theirs.goals[0].steps.push({ id: "s3", text: "View 5 places", done: false });
    stampChanges(theirsBefore, theirs, 20);
    const ab = mergeStates(mine, theirs, 30).goals[0];
    const ba = mergeStates(theirs, mine, 30).goals[0];
    const ok = goal => goal.title === "Buy a flat" && goal.notes === "Near the park" && goal.steps.length === 3
      && goal.steps.find(s => s.id === "s1").done && goal.steps.find(s => s.id === "s2").done;
    return ok(ab) && ok(ba) && recordBody(ab) === recordBody(ba) || JSON.stringify({ ab, ba });
  });
  await test("sync: field-level merge — same field still newest-wins; a removed step stays removed", () => {
    const base = migrate({ ...blankState(), goals: [{ id: "g", title: "Trip", notes: "", steps: [{ id: "s1", text: "Book", done: false }, { id: "s2", text: "Pack", done: false }] }] });
    stampChanges(blankState(), base, 1);
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    const mineBefore = JSON.parse(JSON.stringify(mine));
    const theirsBefore = JSON.parse(JSON.stringify(theirs));
    mine.goals[0].title = "Trip to Rome";
    mine.goals[0].steps = mine.goals[0].steps.filter(s => s.id !== "s2");
    stampChanges(mineBefore, mine, 10);
    theirs.goals[0].title = "Trip to Lisbon";
    stampChanges(theirsBefore, theirs, 20);
    const goal = mergeStates(mine, theirs, 30).goals[0];
    return goal.title === "Trip to Lisbon" && goal.steps.length === 1 && goal.steps[0].id === "s1" || JSON.stringify(goal);
  });
  await test("sync: field-level merge for couple names and Foundations weeks done on different phones", () => {
    const base = blankState();
    stampChanges(blankState(), base, 1);
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    const mineBefore = JSON.parse(JSON.stringify(mine));
    const theirsBefore = JSON.parse(JSON.stringify(theirs));
    mine.couple.a.name = "Ann";
    mine.program.done["1"] = true;
    mine.retirement.saved = 5000;
    stampChanges(mineBefore, mine, 10);
    theirs.couple.b.name = "Ben";
    theirs.program.done["2"] = true;
    theirs.program.notes["2"] = "We'll try the stress-reducing chat on Sundays";
    theirs.retirement.monthly = 300;
    theirs.talks.money = { status: "talked", note: "" };
    stampChanges(theirsBefore, theirs, 20);
    const merged = mergeStates(mine, theirs, 30);
    return merged.couple.a.name === "Ann" && merged.couple.b.name === "Ben" && merged.program.done["1"] && merged.program.done["2"]
      && merged.program.notes["2"].startsWith("We'll") && merged.retirement.saved === 5000 && merged.retirement.monthly === 300
      && merged.talks.money.status === "talked" || JSON.stringify({ couple: merged.couple, program: merged.program, retirement: merged.retirement });
  });
  await test("sync: plans from the previous version (no per-field stamps) still merge newest-record-wins", () => {
    const old = migrate({ ...blankState(), goals: [{ id: "g", title: "Old title", notes: "old", steps: [], _ts: 5 }] });
    const newer = migrate({ ...blankState(), goals: [{ id: "g", title: "New title", notes: "new", steps: [], _ts: 9 }] });
    const goal = mergeStates(old, newer, 10).goals[0];
    return goal.title === "New title" && goal.notes === "new" || JSON.stringify(goal);
  });
  await test("sync: deletion beats an older edit, a newer edit (undo) beats the deletion", () => {
    const edited = migrate({ ...blankState(), funds: [{ id: "f", name: "Car", _ts: 100 }] });
    const deleted = migrate({ ...blankState(), _deleted: { f: 200 } });
    const restored = migrate({ ...blankState(), funds: [{ id: "f", name: "Car", _ts: 300 }] });
    return mergeStates(edited, deleted, 400).funds.length === 0 && mergeStates(deleted, restored, 400).funds.length === 1 || "tombstone rules wrong";
  });
  await test("sync: fingerprint ignores ordering and save time", () => {
    const a = migrate({ ...blankState(), bucket: [{ id: "1", text: "x" }, { id: "2", text: "y" }], updatedAt: "a" });
    const b = migrate({ ...blankState(), bucket: [{ id: "2", text: "y" }, { id: "1", text: "x" }], updatedAt: "b" });
    return planFingerprint(a) === planFingerprint(b) || "fingerprints differ";
  });
  await test("sync: end-to-end encryption round trip; wrong key cannot read", async () => {
    const secret = b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
    const other = b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
    const { encKey, auth } = await deriveSyncKeys(secret);
    const sealed = await sealPlan({ hello: "Ann loves Ben" }, encKey);
    const opened = await openPlan(sealed, encKey);
    let wrongKeyFailed = false;
    try {
      await openPlan(sealed, (await deriveSyncKeys(other)).encKey);
    } catch (error) {
      wrongKeyFailed = true;
    }
    return opened.hello === "Ann loves Ben" && !sealed.includes("Ann loves") && wrongKeyFailed && auth.length >= 40 || "crypto failed";
  });
  const mockRoomServer = () => {
    // Mirrors the worker: many rooms; a room is only created by a version-0 PUT; DELETE needs auth.
    const rows = new Map();
    let firstRoom = null;
    const respond = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const handler = async (url, options = {}) => {
      const method = options.method || "GET";
      const parsed = new URL(url);
      const room = parsed.pathname.split("/").pop();
      const row = rows.get(room);
      if (method === "GET") {
        if (!row) return respond(404, { error: "no such room" });
        if (parsed.searchParams.has("since") && Number(parsed.searchParams.get("since")) >= row.version) return new Response(null, { status: 204 });
        return respond(200, { version: row.version, data: row.data });
      }
      const body = JSON.parse(options.body);
      if (method === "DELETE") {
        if (row && row.auth !== body.auth) return respond(403, {});
        rows.delete(room);
        return respond(200, { ok: true });
      }
      if (!row) {
        if (Number(body.baseVersion) !== 0) return respond(404, { error: "room is gone" });
        rows.set(room, { version: 1, auth: body.auth, data: body.data });
        firstRoom = firstRoom || room;
        return respond(200, { version: 1 });
      }
      if (row.auth !== body.auth) return respond(403, {});
      if (body.baseVersion !== row.version) return respond(409, { version: row.version, data: row.data });
      rows.set(room, { ...row, version: row.version + 1, data: body.data });
      return respond(200, { version: row.version + 1 });
    };
    handler.peek = (room = firstRoom) => rows.get(room) || null;
    handler.has = room => rows.has(room);
    return handler;
  };
  const twoDeviceScenario = async (endpoint, fetchImpl) => {
    const makeDevice = (key, plan) => {
      const device = { plan };
      device.client = new SyncClient({
        configKey: key, endpoint, fetchImpl,
        getState: () => device.plan,
        applyRemote: remote => {
          device.plan = mergeStates(device.plan, remote);
        },
      });
      return device;
    };
    const edit = (device, mutate, now) => {
      const before = JSON.parse(JSON.stringify(device.plan));
      mutate(device.plan);
      stampChanges(before, device.plan, now);
    };
    const t0 = Date.now();
    const a = makeDevice("together.selftest.syncA", blankState());
    edit(a, plan => {
      plan.couple.a.name = "Ann";
      plan.couple.b.name = "Ben";
      plan.milestones.push({ id: "m1", title: "Wedding", date: "2027-10-10", stage: "married", done: false });
    }, t0 + 1);
    const link = await a.client.create();
    const [room, secret] = link.split("#join=")[1].split(".");
    const b = makeDevice("together.selftest.syncB", blankState());
    await b.client.join(room, secret);
    const joined = b.plan.couple.a.name === "Ann" && b.plan.milestones.length === 1;
    edit(a, plan => plan.goals.push({ id: "gA", title: "Save", steps: [], category: "money", owner: "both" }), t0 + 2);
    await a.client.run(() => a.client.pushNow());
    edit(b, plan => plan.bucket.push({ id: "bB", text: "Northern lights", done: false }), t0 + 3);
    await b.client.run(() => b.client.pushNow());
    edit(a, plan => {
      plan.milestones[0].title = "Wedding (draft)";
    }, t0 + 4);
    edit(b, plan => {
      plan.milestones = [];
    }, t0 + 5);
    await b.client.run(() => b.client.pushNow());
    await a.client.pull();
    await a.client.run(() => a.client.pushNow());
    await b.client.pull();
    const converged = planFingerprint(a.plan) === planFingerprint(b.plan);
    const result = {
      joined, converged,
      goal: b.plan.goals.some(g => g.id === "gA"),
      bucket: a.plan.bucket.some(x => x.id === "bB"),
      deletionWon: !a.plan.milestones.length && !b.plan.milestones.length,
      versions: [a.client.config.version, b.client.config.version],
    };
    return { a, b, result };
  };
  await test("sync: passphrase-protected link — the link alone can't read or write; replacing the link retires the old room", async () => {
    const server = mockRoomServer();
    const makeClient = (key, holder) => new SyncClient({
      configKey: key, endpoint: "https://mock.invalid", fetchImpl: server,
      getState: () => holder.plan,
      applyRemote: remote => {
        holder.plan = mergeStates(holder.plan, remote);
      },
    });
    const a = { plan: blankState() };
    a.plan.couple.a.name = "Ann";
    stampChanges(blankState(), a.plan, Date.now());
    const clientA = makeClient("together.selftest.passA", a);
    const link = await clientA.create("blue whale 42");
    const [room, secret, flag] = link.split("#join=")[1].split(".");
    const b = { plan: blankState() };
    const clientB = makeClient("together.selftest.passB", b);
    const failures = [];
    for (const attempt of ["", "wrong horse"]) {
      try {
        await clientB.join(room, secret, attempt, true);
        failures.push(`joined with "${attempt}"`);
      } catch (error) {
        if (clientB.active) failures.push("stayed active after a failed join");
      }
    }
    await clientB.join(room, secret, "blue whale 42", true);
    const joined = b.plan.couple.a.name === "Ann";
    // An attacker holding only the link (no passphrase):
    const linkOnly = await deriveSyncKeys(secret);
    let attackerRead = true;
    try {
      await openPlan(server.peek(room).data, linkOnly.encKey);
    } catch (error) {
      attackerRead = false;
    }
    const attackerWrite = await server(`https://mock.invalid/v1/rooms/${room}`, { method: "PUT", body: JSON.stringify({ auth: linkOnly.auth, baseVersion: server.peek(room).version, data: "x" }) });
    // Replace the link: old room disappears, partner's old link can't resurrect it
    const newLink = await clientA.rotate("");
    const newRoom = newLink.split("#join=")[1].split(".")[0];
    await clientB.pull();
    let resurrected = false;
    try {
      await clientB.run(() => clientB.pushNow());
    } catch (error) {
      resurrected = server.has(room);
    }
    const result = {
      flag, failures, joined, attackerRead, attackerWriteStatus: attackerWrite.status,
      oldRoomGone: !server.has(room), newRoomLive: server.has(newRoom), newLinkUnprotected: !newLink.endsWith(".p"),
      partnerTold: clientB.status === "error" && /replaced/i.test(clientB.error), resurrected,
    };
    clientA.leave();
    clientB.leave();
    const ok = flag === "p" && !failures.length && joined && !attackerRead && result.attackerWriteStatus === 403
      && result.oldRoomGone && result.newRoomLive && result.newLinkUnprotected && result.partnerTold && !resurrected;
    return ok || JSON.stringify(result);
  });
  await test("sync: two phones converge through an encrypted room (409 conflict + merge + delete)", async () => {
    const server = mockRoomServer();
    const { a, b, result } = await twoDeviceScenario("https://mock.invalid", server);
    const stored = server.peek().data;
    a.client.leave();
    b.client.leave();
    const ok = result.joined && result.converged && result.goal && result.bucket && result.deletionWon && !stored.includes('"Ann"') && !stored.includes('"Wedding"');
    return ok || JSON.stringify(result);
  });
  await test("savings: bank CSV — amount column, mixed number formats, monthly surplus", () => {
    const csv = "\uFEFFDate,Description,Amount,Balance\n2026-01-03,Salary,\"3,200.00\",5000\n2026-01-10,Rent,-1200.00,3800\n2026-01-15,\"Groceries, weekly\",(150.50),3649.5\n2026-02-03,Salary,3200,6849.5\n2026-02-11,Rent,-1200,5649.5\n";
    const r = analyzeStatement(csv);
    return r.months?.length === 2 && Math.abs(r.months[0].net - 1849.5) < 1e-9 && Math.abs(r.months[1].net - 2000) < 1e-9
      && Math.abs(r.avgNet - 1924.75) < 1e-9 && r.columns.amount === "Amount" || JSON.stringify(r);
  });
  await test("savings: bank CSV — semicolons, European decimals, debit/credit columns, day-first dates", () => {
    const csv = "Buchungstag;Text;Debit;Credit\n03.02.2026;Gehalt;;2.500,00\n14.02.2026;Miete;900,00;\n28.02.2026;Markt;45,50;\n";
    const r = analyzeStatement(csv);
    const us = analyzeStatement("Posted Date,Payee,Amount\n04/23/2026,Paycheck,2000\n04/24/2026,Store,-25.10\n");
    return r.months?.length === 1 && r.months[0].month === "2026-02" && Math.abs(r.months[0].income - 2500) < 1e-9
      && Math.abs(r.months[0].spending - 945.5) < 1e-9 && us.months?.[0]?.month === "2026-04" && Math.abs(us.avgNet - 1974.9) < 1e-9
      && parseAmount("1.234,56") === 1234.56 && parseAmount("12.00-") === -12 && parseAmount("45 DR") === -45 && Number.isNaN(parseAmount("n/a"))
      || JSON.stringify({ r, us });
  });
  await test("savings: net-worth CSV import parses date/assets/debts", () => {
    const list = parseNetWorthCsv("Date,Assets,Debts\n2026-01-31,\"12,000\",3000\n2026-02-28,12500,2900\nbad,row,\n");
    return list.length === 2 && list[0].assets === 12000 && list[1].debts === 2900 || JSON.stringify(list);
  });
  await test("reminders: iOS install guidance — version, in-app browsers, push support", () => {
    const safari17 = iosInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1", false);
    const old = iosInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", false);
    const insta = iosInfo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0", false);
    const android = iosInfo("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", false);
    const ipadDesktop = iosInfo("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", true);
    return safari17.ios && safari17.pushCapable && !safari17.inApp && old.ios && !old.pushCapable && insta.inApp && !android.ios
      && ipadDesktop.ios && ipadDesktop.pushCapable || JSON.stringify({ safari17, old, insta, android, ipadDesktop });
  });
  await test("privacy: wording matches what is switched on (never claims 'nothing is uploaded' while syncing)", () => {
    const off = privacyStatus(false, false);
    const syncing = privacyStatus(true, false);
    const both = privacyStatus(true, true);
    const remindersOnly = privacyStatus(false, true);
    const ok = /nothing is uploaded/.test(off) && !/nothing is uploaded/.test(syncing) && /encrypted/.test(syncing)
      && /times/.test(both) && /encrypted/.test(both) && !/nothing is uploaded/.test(remindersOnly) && /never the text/.test(remindersOnly)
      && !/no cloud/i.test(viewOnboarding()) && /encrypted/.test(viewOnboarding());
    return ok || JSON.stringify({ off, syncing, both, remindersOnly });
  });
  await test("trust: password-protected backup round-trips; wrong password fails; file holds no plaintext", async () => {
    const plan = migrate({ ...blankState(), couple: { ...blankState().couple, a: { name: "Zoe", birth: "" }, b: { name: "Sam", birth: "" } } });
    const plain = store.exportText(plan);
    const locked = await encryptBackup(plain, "correct horse");
    const parsed = store.importText(locked);
    let wrongRejected = false;
    try {
      await decryptBackup(parsed.encrypted, "wrong horse");
    } catch (error) {
      wrongRejected = true;
    }
    const reopened = store.importText(await decryptBackup(parsed.encrypted, "correct horse"));
    return Boolean(parsed.encrypted) && wrongRejected && reopened.state?.couple.a.name === "Zoe" && !locked.includes('"Zoe"') && !locked.includes("Sam")
      || JSON.stringify({ parsed: Boolean(parsed.encrypted), wrongRejected, reopened: reopened.error });
  });
  await test("milestone template covers later life: parents' care, retirement check, where to live, wills & wishes", () => {
    const list = buildTemplate({ ...blankState().couple, a: { name: "A", birth: "1996-01-01" }, b: { name: "B", birth: "1996-01-01" }, stage: "dating", retireAge: 65 }, new Date(2026, 0, 15));
    const titles = list.map(m => m.title).join(" | ");
    const ok = ["caring for our parents", "Retirement check", "where we'll live", "Wills, powers of attorney"].every(t => titles.includes(t))
      && list.every((m, i) => !i || STAGE_INDEX[list[i - 1].stage] <= STAGE_INDEX[m.stage] || list[i - 1].date <= m.date);
    return ok || titles;
  });
  await test("design: no emoji anywhere — every tab, check-in dialog, focus list and reminder texts", () => {
    const pictograph = /\p{Extended_Pictographic}/u;
    const savedState = state;
    const savedTab = ui.tab;
    const found = [];
    try {
      state = demoState();
      for (const tab of TABS) {
        ui.tab = tab.id;
        render();
        const shown = document.querySelector(".topbar").innerText + document.getElementById("tabs").innerText + document.getElementById("view").innerText;
        if (pictograph.test(shown)) found.push(`${tab.id}: ${(shown.match(/\p{Extended_Pictographic}/gu) || []).join("")}`);
      }
      checkinDialog();
      const dialogText = document.getElementById("dialog").innerText;
      document.getElementById("dialog").close();
      if (pictograph.test(dialogText)) found.push("check-in dialog");
      for (const item of focusItems(state, new Date())) {
        if (pictograph.test(item.text) || !ICONS[item.icon]) found.push(`focus: ${item.icon} ${item.text}`);
      }
      for (const reminder of reminderSchedule(state, new Date())) {
        const words = `${reminder.title || ""} ${reminder.body || ""}`;
        if (pictograph.test(words)) found.push(`reminder: ${words}`);
      }
    } finally {
      state = savedState;
      ui.tab = savedTab;
      render();
    }
    return !found.length || found.join(" | ");
  });
  await test("migration: emoji the app generated is removed from saved titles; emoji the couple typed is kept", () => {
    const plan = migrate({ ...blankState(), schema: SCHEMA_VERSION, milestones: [
      { id: "m1", stage: "married", title: "Wedding day 💒", date: "2027-06-01", done: false, notes: "" },
      { id: "m2", stage: "golden", title: "Wills, powers of attorney & wishes written down 🕊️", date: "2060-01-01", done: false, notes: "" },
      { id: "m3", stage: "dating", title: "Our trip to Bali 🌴", date: "2026-08-01", done: false, notes: "" },
    ] });
    const titles = plan.milestones.map(m => m.title);
    return (titles[0] === "Wedding day" && titles[1] === "Wills, powers of attorney & wishes written down" && titles[2] === "Our trip to Bali 🌴") || titles.join(" | ");
  });
  await test("appearance: system / light / dark resolve, persist per device and drive the page theme", () => {
    const before = theme.preference;
    const resolves = resolveTheme("system", true) === "dark" && resolveTheme("system", false) === "light"
      && resolveTheme("light", true) === "light" && resolveTheme("dark", false) === "dark" && resolveTheme("bogus", false) === "light";
    theme.set("dark");
    const darkApplied = document.documentElement.dataset.theme === "dark" && theme.preference === "dark";
    theme.set("light");
    const lightApplied = document.documentElement.dataset.theme === "light" && theme.preference === "light";
    const background = getComputedStyle(document.body).backgroundColor;
    theme.set("dark");
    const darkBackground = getComputedStyle(document.body).backgroundColor;
    theme.set(before);
    return (resolves && darkApplied && lightApplied && background !== darkBackground) || JSON.stringify({ resolves, darkApplied, lightApplied, background, darkBackground });
  });
  await test("savings: required monthly for a target and today's-money conversion", () => {
    const monthly = requiredMonthlyForTarget(0, 1200, 0, 1);
    const withGrowth = requiredMonthlyForTarget(0, futureValue(0, 100, 6, 10), 6, 10);
    const real = toTodaysMoney(121, 10, 2);
    return Math.abs(monthly - 100) < 1e-9 && Math.abs(withGrowth - 100) < 1e-6 && Math.abs(real - 100) < 1e-9 && requiredMonthlyForTarget(5000, 1000, 5, 3) === 0 || [monthly, withGrowth, real].join();
  });
  await test("savings: retirement target, on-track ratio and education funds", () => {
    const plan = migrate({ ...blankState(), couple: { ...blankState().couple, a: { name: "A", birth: "1996-01-15" }, b: { name: "B", birth: "1996-01-15" }, retireAge: 66 },
      retirement: { saved: 0, monthly: 0, rate: 0, fees: 0, inflation: 0, spend: 40000, withdrawal: 4, eduCost: 10000, eduInflation: 0 },
      kids: [{ id: "k", name: "Kid", birth: "2026-01-15" }] });
    const r = retirementPlan(plan, fixedNow);
    const edu = educationPlans(plan, fixedNow);
    return r.targetReal === 1000000 && Math.abs(r.neededMonthly - 1000000 / 432) < 1e-6 && r.onTrack === 0
      && edu.length === 1 && Math.abs(edu[0].cost - 10000) < 1e-9 && Math.abs(edu[0].monthly - 10000 / 216) < 1e-6 || JSON.stringify({ r, edu });
  });
  await test("reminders: schedule check-in, milestone and anniversary pings in time order", () => {
    const plan = migrate({ ...blankState(), couple: { ...blankState().couple, a: { name: "A", birth: "" }, b: { name: "B", birth: "" }, since: "2020-02-01" },
      milestones: [{ id: "m", title: "Move", date: "2026-03-01", stage: "home", done: false }] });
    const list = reminderSchedule(plan, fixedNow);
    const tags = list.map(r => r.tag);
    const sorted = list.every((r, i) => !i || list[i - 1].at <= r.at);
    const inWindow = list.every(r => r.at > fixedNow.getTime() && r.at < fixedNow.getTime() + 120 * 864e5);
    return tags.includes("checkin-0") && tags.includes("ms-m") && tags.includes("ms-m-7") && tags.some(t => t.startsWith("party-")) && sorted && inWindow || JSON.stringify(tags);
  });
  await test("goal program: Foundations progress and weekly reminder", () => {
    const program = { started: "2026-01-01", done: { 1: "2026-01-02", 2: "2026-01-09" }, notes: {} };
    const progress = programProgress(program);
    const plan = migrate({ ...blankState(), program });
    const ping = reminderSchedule(plan, fixedNow).find(r => r.tag === "program");
    return progress.doneCount === 2 && progress.currentWeek === 3 && !progress.finished && PROGRAM.length === 8 && ping && ping.title.includes("week 3") || JSON.stringify({ progress, ping });
  });

  /* ---- shared piggy bank, weekly plan, financial freedom, bucket-list pots ---- */
  await test("piggy bank: older plans without a deposit log load with an empty one", () => {
    const { contributions, ...older } = blankState();
    const loaded = migrate({ ...older, funds: [{ id: "o", name: "Old pot", target: 100, saved: 40, monthly: 0 }] });
    return Array.isArray(loaded.contributions) && loaded.contributions.length === 0 && fundSaved(loaded.funds[0], loaded) === 40 || JSON.stringify(loaded.contributions);
  });
  await test("piggy bank: balance = starting amount + logged deposits, split by partner", () => {
    const plan = migrate({ ...blankState(),
      funds: [{ id: "p", name: "Trip", target: 1000, saved: 100, monthly: 50, milestoneId: "" }],
      contributions: [
        { id: "c1", fundId: "p", amount: 200, by: "a", date: "2026-01-10" },
        { id: "c2", fundId: "p", amount: 150, by: "b", date: "2026-01-12" },
        { id: "c3", fundId: "p", amount: -50, by: "both", date: "2026-01-13" },
        { id: "c4", fundId: "other", amount: 999, by: "a", date: "2026-01-13" },
      ] });
    const fund = plan.funds[0];
    const split = contributionSplit(fundContributions(fund, plan));
    const status = fundStatus(fund, plan, fixedNow);
    return fundSaved(fund, plan) === 400 && split.a === 200 && split.b === 150 && split.both === -50 &&
      status.progress === 0.4 && status.months === 12 || JSON.stringify({ split, status });
  });
  await test("piggy bank: both partners depositing at the same time keep both deposits after sync", () => {
    const base = migrate({ ...blankState(), funds: [{ id: "p", name: "Home", target: 5000, saved: 1000, monthly: 0, milestoneId: "" }] });
    stampChanges(blankState(), base, 1);
    const mine = JSON.parse(JSON.stringify(base));
    const theirs = JSON.parse(JSON.stringify(base));
    const mineBefore = JSON.parse(JSON.stringify(mine));
    const theirsBefore = JSON.parse(JSON.stringify(theirs));
    mine.contributions.push({ id: "cm", fundId: "p", amount: 100, by: "a", date: "2026-01-15" });
    theirs.contributions.push({ id: "ct", fundId: "p", amount: 250, by: "b", date: "2026-01-15" });
    stampChanges(mineBefore, mine, 10);
    stampChanges(theirsBefore, theirs, 10);
    const merged = mergeStates(mine, theirs, 20);
    const undone = JSON.parse(JSON.stringify(merged));
    undone.contributions = undone.contributions.filter(c => c.id !== "cm");
    stampChanges(merged, undone, 30);
    const afterUndo = mergeStates(merged, undone, 40);
    return fundSaved(merged.funds[0], merged) === 1350 && merged.contributions.length === 2 &&
      fundSaved(afterUndo.funds[0], afterUndo) === 1250 || JSON.stringify({ merged: merged.contributions, afterUndo: afterUndo.contributions });
  });
  await test("piggy bank: editing a pot's balance keeps the deposit history", () => {
    state.funds = [{ id: "pe", name: "Car", target: 8000, saved: 500, monthly: 100, milestoneId: "" }];
    state.contributions = [{ id: "ce", fundId: "pe", amount: 300, by: "a", date: "2026-01-02" }];
    actions["edit-fund"]("pe");
    const form = document.getElementById("dialog-form");
    const shown = Number(form.saved.value);
    form.saved.value = "1000";
    form.requestSubmit();
    const fund = state.funds[0];
    const afterBalanceEdit = fund.saved;
    actions["edit-fund"]("pe");
    document.getElementById("dialog-form").name.value = "Our car";
    document.getElementById("dialog-form").requestSubmit();
    return shown === 800 && afterBalanceEdit === 700 && fundSaved(fund, state) === 1000 && fund.saved === 700 &&
      fund.name === "Our car" && state.contributions.length === 1 || JSON.stringify({ shown, fund });
  });
  await test("weekly plan: weekly target = monthly × 12 / 52 and counts only this week's deposits", () => {
    const plan = migrate({ ...blankState(),
      funds: [
        { id: "w1", name: "Trip", target: 10000, saved: 0, monthly: 520, milestoneId: "" },
        { id: "w2", name: "Full", target: 100, saved: 100, monthly: 50, milestoneId: "" },
        { id: "w3", name: "No plan", target: 100, saved: 0, monthly: 0, milestoneId: "" },
      ],
      contributions: [
        { id: "x1", fundId: "w1", amount: 60, by: "a", date: "2026-01-12" },
        { id: "x2", fundId: "w1", amount: 40, by: "b", date: "2026-01-18" },
        { id: "x3", fundId: "w1", amount: 500, by: "a", date: "2026-01-11" },
      ],
      bucket: [{ id: "d1", text: "Paris", done: false }, { id: "d2", text: "Already did it", done: true }] });
    const week = weeklyPlan(plan, fixedNow);
    const pot = week.pots[0];
    return week.pots.length === 1 && Math.abs(pot.weekly - 120) < 1e-9 && Math.abs(pot.daily - 120 / 7) < 1e-9 &&
      pot.added === 100 && pot.split.a === 60 && pot.split.b === 40 && !pot.done &&
      toISO(week.weekStart) === "2026-01-12" && toISO(week.weekEnd) === "2026-01-18" && week.daysLeft === 4 &&
      week.fun && week.fun.id === "d1" || JSON.stringify(week);
  });
  await test("weekly plan: a pot behind its milestone uses the amount it really needs", () => {
    const plan = migrate({ ...blankState(),
      milestones: [{ id: "m1", title: "Wedding", stage: "married", date: "2027-01-15", done: false }],
      funds: [{ id: "b1", name: "Wedding", target: 12000, saved: 0, monthly: 100, milestoneId: "m1" }] });
    const pot = weeklyPlan(plan, fixedNow).pots[0];
    return pot && pot.behind && Math.abs(pot.weekly - 1000 / WEEKS_PER_MONTH) < 1e-9 || JSON.stringify(pot);
  });
  await test("weekly plan: Sunday money-mission reminders while a pot has a monthly plan", () => {
    const withPlan = migrate({ ...blankState(), funds: [{ id: "r1", name: "Trip", target: 1000, saved: 0, monthly: 100 }] });
    const tags = reminderSchedule(withPlan, fixedNow).filter(r => r.tag.startsWith("money-week-"));
    const firstDay = tags.length ? new Date(tags[0].at) : null;
    const none = reminderSchedule(migrate(blankState()), fixedNow).some(r => r.tag.startsWith("money-week-"));
    return tags.length === 4 && firstDay.getDay() === 0 && toISO(firstDay) === "2026-01-18" && firstDay.getHours() === 18 && !none || JSON.stringify(tags);
  });
  await test("financial freedom: target = yearly spending ÷ withdrawal rate; date matches a direct simulation", () => {
    const base = blankState();
    const plan = migrate({ ...base,
      couple: { ...base.couple, a: { name: "A", birth: "1996-03-10" }, b: { name: "B", birth: "1994-11-02" } },
      retirement: { ...base.retirement, saved: 100000, monthly: 2000, rate: 6, fees: 0, inflation: 2, spend: 40000, withdrawal: 4 } });
    const fi = freedomPlan(plan, fixedNow);
    const monthlyRate = (1.06 / 1.02 - 1) / 12;
    let value = 100000;
    let months = 0;
    while (value < 1e6) {
      value = value * (1 + monthlyRate) + 2000;
      months += 1;
    }
    const free = freedomPlan(migrate({ ...plan, retirement: { ...plan.retirement, saved: 2e6 } }), fixedNow);
    const stuck = freedomPlan(migrate({ ...plan, retirement: { ...plan.retirement, saved: 0, monthly: 0 } }), fixedNow);
    const unset = freedomPlan(migrate({ ...plan, retirement: { ...plan.retirement, spend: 0 } }), fixedNow);
    return Math.abs(fi.target - 1e6) < 1e-6 && fi.months === months && fi.ageA === ageOn("1996-03-10", fi.date) &&
      fi.soonerBy > 0 && free.months === 0 && stuck.months === null && unset === null || JSON.stringify({ fi, months, free, stuck });
  });
  await test("financial freedom: roadmap milestone is added once, then its date is updated", () => {
    state.retirement = { ...state.retirement, saved: 50000, monthly: 1500, rate: 5, fees: 0.5, inflation: 2.5, spend: 30000, withdrawal: 4 };
    actions["freedom-milestone"]();
    const firstDate = (state.milestones.find(m => m.auto === "freedom") || {}).date;
    state.retirement = { ...state.retirement, monthly: 3000 };
    actions["freedom-milestone"]();
    const all = state.milestones.filter(m => m.auto === "freedom");
    return firstDate && all.length === 1 && all[0].date < firstDate && all[0].title === "Financially free" || JSON.stringify({ firstDate, all });
  });
  await test("e2e bucket dream → linked savings pot shows its progress on the bucket list", () => {
    state.bucket = [{ id: "bk", text: "Safari in Kenya", done: false }];
    state.funds = [];
    state.contributions = [];
    actions.tab("us");
    const start = document.querySelector('[data-act="bucket-save"][data-id="bk"]');
    if (!start) return "no Save for it button";
    start.click();
    const form = document.getElementById("dialog-form");
    if (form.name.value !== "Safari in Kenya" || form.bucketId.value !== "bk") return "dialog not prefilled";
    form.target.value = "4000";
    form.saved.value = "1000";
    form.requestSubmit();
    actions.tab("us");
    const tag = document.querySelector(".bucket .item").textContent;
    const pot = state.funds[0];
    actions.tab("money");
    const chip = document.getElementById("view").textContent.includes("For: Safari in Kenya");
    return pot && pot.bucketId === "bk" && tag.includes("25% saved") && chip && !document.querySelector('[data-act="bucket-save"]') || tag;
  });
  await test("e2e home weekly card: add money with who added it, progress updates", () => {
    state.funds = [{ id: "hw", name: "Holiday", target: 5000, saved: 0, monthly: 520, milestoneId: "" }];
    state.contributions = [];
    actions.tab("home");
    const form = document.querySelector('.week-card [data-form="deposit"][data-id="hw"]');
    if (!form) return "no weekly deposit form";
    form.amount.value = "70";
    form.by.value = "b";
    form.requestSubmit();
    const entry = state.contributions[0];
    const card = document.querySelector(".week-card").textContent;
    const remembered = localStorage.getItem(store.key + ME_KEY_SUFFIX);
    return entry && entry.by === "b" && entry.amount === 70 && entry.date === toISO(new Date()) && card.includes("In this week:") && remembered === "b" || card;
  });
  await test("xss: pot names, bucket dreams and the weekly card render as text", () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    state.bucket = [{ id: "ev", text: evil, done: false }];
    state.funds = [{ id: "fe", name: evil, target: 900, saved: 0, monthly: 300, milestoneId: "", bucketId: "ev" }];
    state.contributions = [{ id: "ce", fundId: "fe", amount: 10, by: "a", date: toISO(new Date()) }];
    state.goals = [{ id: "ge", title: evil, category: "love", owner: "both", due: "", notes: "", done: false, steps: [{ id: "se", text: evil, done: false }] }];
    let injected = 0;
    for (const tab of ["home", "money", "us"]) {
      actions.tab(tab);
      injected += document.querySelectorAll("#view img").length;
    }
    actions["bucket-save"]("ev");
    injected += document.querySelectorAll("#dialog img").length;
    document.getElementById("dialog").close();
    return injected === 0 && !window.__xss || `injected ${injected}`;
  });

  /* ---- debts, savings rate, fair split, streaks, challenges, dates, Mint, Rupiah ---- */
  await test("amounts: Rupiah shorthand and separators parse correctly", () => {
    const cases = { "25k": 25000, "250rb": 250000, "1,5jt": 1.5e6, "2 juta": 2e6, "Rp 25.000": 25000, "Rp1.500.000": 1.5e6,
      "12.50": 12.5, "12,5": 12.5, "1,250.50": 1250.5, "1.250,50": 1250.5, "-30": -30, "300": 300 };
    const wrong = Object.entries(cases).filter(([input, expected]) => Math.abs(parseTypedAmount(input) - expected) > 1e-9);
    return !wrong.length && Number.isNaN(parseTypedAmount("abc")) && Number.isNaN(parseTypedAmount("")) || JSON.stringify(wrong.map(([i]) => [i, parseTypedAmount(i)]));
  });
  await test("amounts: Rupiah is shown as Rp 1.500.000", () =>
    money(1500000, "Rp") === "Rp 1.500.000" && money(2500, "IDR") === "Rp 2.500" || `${money(1500000, "Rp")} | ${money(2500, "IDR")}`);
  await test("debts: snowball pays the smallest first and rolls its payment into the next debt", () => {
    const debts = [{ id: "A", balance: 300, rate: 0, minimum: 50 }, { id: "B", balance: 1000, rate: 0, minimum: 50 }];
    const plan = simulateDebts(debts, 100, "snowball");
    return plan.feasible && plan.payoff.A === 2 && plan.payoff.B === 7 && plan.months === 7 && plan.totalInterest === 0 && plan.budget === 200 || JSON.stringify(plan);
  });
  await test("debts: avalanche pays less interest than snowball; minimums below interest never clear", () => {
    const debts = [{ id: "A", balance: 300, rate: 5, minimum: 50 }, { id: "B", balance: 1000, rate: 20, minimum: 50 }];
    const avalanche = simulateDebts(debts, 100, "avalanche");
    const snowball = simulateDebts(debts, 100, "snowball");
    const stuck = simulateDebts([{ id: "C", balance: 10000, rate: 24, minimum: 100 }], 0, "avalanche");
    return avalanche.totalInterest < snowball.totalInterest && snowball.payoff.A < avalanche.payoff.A && !stuck.feasible && stuck.months === null ||
      JSON.stringify({ avalanche, snowball, stuck: stuck.months });
  });
  await test("debts: freedom comes sooner once debt payments move into investing", () => {
    const base = blankState();
    const plan = migrate({ ...base,
      retirement: { ...base.retirement, saved: 20000, monthly: 800, rate: 6, fees: 0, inflation: 2, spend: 30000, withdrawal: 4, debtExtra: 200 },
      debts: [{ id: "d", name: "Car", balance: 8000, rate: 6, minimum: 300 }] });
    const fi = freedomPlan(plan, fixedNow);
    const debts = debtPlan(plan, fixedNow);
    return fi.afterDebts && fi.afterDebts.amount === 500 && fi.afterDebts.months < fi.months && debts.months > 0 && toISO(fi.afterDebts.debtFreeDate) === toISO(debts.date) ||
      JSON.stringify({ fi: fi.months, after: fi.afterDebts, debts: debts.months });
  });
  await test("savings rate: years to freedom match a direct simulation and fall as the rate rises", () => {
    const base = blankState();
    const plan = migrate({ ...base,
      retirement: { ...base.retirement, saved: 0, monthly: 500, rate: 5, fees: 0, inflation: 0, withdrawal: 4, incomeA: 3000, incomeB: 2000 },
      funds: [{ id: "p", name: "Trip", target: 9000, saved: 0, monthly: 500 }] });
    const result = savingsRatePlan(plan);
    let value = 0;
    let months = 0;
    while (value < 5000 * 0.5 * 12 / 0.04) {
      value = value * (1 + 0.05 / 12) + 2500;
      months += 1;
    }
    const half = result.rows.find(row => row.rate === 0.5);
    const falling = result.rows.every((row, i) => i === 0 || row.years < result.rows[i - 1].years);
    return Math.abs(result.currentRate - 0.2) < 1e-9 && Math.abs(half.years - months / 12) < 1e-9 && falling && savingsRatePlan(migrate(blankState())) === null ||
      JSON.stringify({ result, months });
  });
  await test("fair split: weekly targets follow income, and 'together' deposits count half each", () => {
    const base = blankState();
    const plan = migrate({ ...base,
      retirement: { ...base.retirement, incomeA: 6000, incomeB: 4000, splitMode: "income" },
      funds: [{ id: "s1", name: "Trip", target: 10000, saved: 0, monthly: 520 }],
      contributions: [{ id: "k1", fundId: "s1", amount: 40, by: "both", date: "2026-01-13" }, { id: "k2", fundId: "s1", amount: 30, by: "a", date: "2026-01-14" }] });
    const pot = weeklyPlan(plan, fixedNow).pots[0];
    const equal = weeklyPlan(migrate({ ...plan, retirement: { ...plan.retirement, splitMode: "equal" } }), fixedNow).pots[0];
    return Math.abs(pot.targets.a - 72) < 1e-9 && Math.abs(pot.targets.b - 48) < 1e-9 && pot.byPartner.a === 50 && pot.byPartner.b === 20 &&
      Math.abs(equal.targets.a - 60) < 1e-9 || JSON.stringify({ targets: pot.targets, byPartner: pot.byPartner });
  });
  await test("streak: counts consecutive weeks that hit the combined target, including this week once done", () => {
    const plan = migrate({ ...blankState(),
      funds: [{ id: "t1", name: "Trip", target: 100000, saved: 0, monthly: 520 }],
      contributions: [
        { id: "e1", fundId: "t1", amount: 130, by: "a", date: "2026-01-07" },
        { id: "e2", fundId: "t1", amount: 125, by: "b", date: "2026-01-02" },
        { id: "e3", fundId: "t1", amount: 50, by: "a", date: "2025-12-24" },
      ] });
    const before = savingStreak(plan, fixedNow);
    plan.contributions.push({ id: "e4", fundId: "t1", amount: 120, by: "both", date: "2026-01-15" });
    const after = savingStreak(plan, fixedNow);
    return before.weeks === 2 && !before.thisWeekDone && after.weeks === 3 && after.thisWeekDone || JSON.stringify({ before, after });
  });
  await test("challenges: 52-week steps grow weekly; a tick adds that week's amount to the pot once", () => {
    const status = challengeStatus({ kind: "52week", unit: 10, started: "2026-01-01", ticks: {} }, fixedNow);
    state.funds = [{ id: "cf", name: "Trip", target: 50000, saved: 0, monthly: 0, milestoneId: "" }];
    state.contributions = [];
    state.challenges = [{ id: "ch1", kind: "52week", fundId: "cf", unit: 10, started: toISO(new Date()), ticks: {} }];
    actions["challenge-tick"]("ch1");
    actions["challenge-tick"]("ch1");
    const logged = state.contributions.filter(c => c.fundId === "cf");
    return status.step === 3 && status.amount === 30 && status.goal === 13780 && logged.length === 1 && logged[0].amount === 10 &&
      state.challenges[0].ticks[1] && fundSaved(state.funds[0], state) === 10 || JSON.stringify({ status, logged });
  });
  await test("date nights: fun money left this month and an affordable bucket-list idea", () => {
    const base = blankState();
    const plan = migrate({ ...base,
      retirement: { ...base.retirement, funMonthly: 200 },
      dates: [{ id: "dn1", date: "2026-01-03", text: "Movie", cost: 50 }, { id: "dn2", date: "2025-12-20", text: "Old", cost: 500 }],
      bucket: [{ id: "bb1", text: "Hot-air balloon", done: false, cost: 900 }, { id: "bb2", text: "Cooking class", done: false, cost: 100 }] });
    const fun = funPlan(plan, fixedNow);
    const noBudget = funPlan(migrate(blankState()), fixedNow);
    return fun.spent === 50 && fun.left === 150 && fun.idea.text === "Cooking class" && fun.idea.bucketId === "bb2" && DATE_IDEAS.includes(noBudget.idea.text) ||
      JSON.stringify({ fun, noBudget });
  });
  await test("e2e date night: 'We did it' logs the date and can tick off the bucket list", () => {
    state.retirement = { ...state.retirement, funMonthly: 300 };
    state.dates = [];
    state.bucket = [{ id: "bd", text: "Salsa lesson", done: false, cost: 60 }];
    actions["date-done"]();
    const form = document.getElementById("dialog-form");
    const prefilled = form.text.value === "Salsa lesson" && form.tickBucket && form.tickBucket.checked;
    form.cost.value = "55";
    form.requestSubmit();
    return prefilled && state.dates.length === 1 && state.dates[0].cost === 55 && state.bucket[0].done && funPlan(state, new Date()).left === 245 || JSON.stringify(state.dates);
  });
  await test("e2e debts: add a debt in the dialog, switch to snowball through the real form", () => {
    state.debts = [];
    actions.tab("money");
    document.querySelector('[data-act="add-debt"]').click();
    const form = document.getElementById("dialog-form");
    form.name.value = "Card";
    form.balance.value = "2.500";
    form.rate.value = "18";
    form.minimum.value = "100";
    form.requestSubmit();
    const select = document.querySelector('[data-form="retirement"] [name="debtMethod"]');
    select.value = "snowball";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const split = document.querySelector('[data-form="retirement"] [name="splitMode"]');
    split.value = "income";
    split.dispatchEvent(new Event("change", { bubbles: true }));
    const debt = state.debts[0];
    return debt && debt.balance === 2500 && debt.rate === 18 && debt.minimum === 100 && state.retirement.debtMethod === "snowball" &&
      state.retirement.splitMode === "income" && document.getElementById("view").textContent.includes("Debt-free around") || JSON.stringify({ debt, r: state.retirement });
  });
  const mintFixture = () => {
    const book = {
      meta: { name: "Rumah", currency: "IDR" },
      incomes: { i1: { id: "i1", amount: 10000000, freq: "monthly" } },
      categories: { c1: { id: "c1", group: "needs" }, c2: { id: "c2", group: "savings" } },
      txns: {
        t1: { id: "t1", date: "2025-11-05", amount: 4000000, cat: "c1" },
        t2: { id: "t2", date: "2025-11-20", amount: 1000000, cat: "c2" },
        t3: { id: "t3", date: "2025-12-05", amount: 6000000, cat: "c1" },
        t4: { id: "t4", date: "2025-12-10", amount: 2000000, cat: "c2" },
        t5: { id: "t5", date: "2025-12-11", amount: 9e9, cat: "c1", _del: true },
        t6: { id: "t6", date: "2026-01-02", amount: 1000000, cat: "c1" },
      },
    };
    const items = { "mint.budget.books": JSON.stringify([{ id: "bk1", name: "Rumah" }]), "mint.budget.book.bk1": JSON.stringify(book) };
    return { getItem: key => (key in items ? items[key] : null) };
  };
  await test("mint: reads budgets from this browser and averages the last complete months", () => {
    const books = readMintBooks(mintFixture());
    const summary = summarizeMintBook(books[0].book, fixedNow);
    const broken = readMintBooks({ getItem: () => "{not json" });
    return books.length === 1 && summary.months === 2 && summary.spent === 5e6 && summary.saved === 1.5e6 && summary.income === 1e7 &&
      summary.currency === "IDR" && broken.length === 0 || JSON.stringify(summary);
  });
  await test("e2e mint: 'Use spending' sets the freedom number's yearly spending", () => {
    ui.mintStorage = mintFixture();
    ui.now = fixedNow;
    actions.tab("money");
    const button = document.querySelector('[data-act="mint-spend"]');
    if (!button) return "no Mint card button";
    button.click();
    const spend = state.retirement.spend;
    ui.mintStorage = null;
    ui.now = new Date();
    return spend === 6e7 || `spend ${spend}`;
  });
  await test("xss: debts, dates, challenges and Mint names render as text", () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    state.funds = [{ id: "fx", name: evil, target: 900, saved: 0, monthly: 300, milestoneId: "" }];
    state.debts = [{ id: "dx", name: evil, balance: 500, rate: 10, minimum: 50 }];
    state.dates = [{ id: "tx", date: toISO(new Date()), text: evil, cost: 5 }];
    state.challenges = [{ id: "cx", kind: "nospend", fundId: "fx", unit: 20, started: toISO(new Date()), ticks: {} }];
    state.bucket = [{ id: "bx", text: evil, done: false, cost: 1 }];
    ui.mintStorage = { getItem: key => key === "mint.budget.books" ? JSON.stringify([{ id: "m" }]) : key === "mint.budget.book.m" ? JSON.stringify({ meta: { name: evil, currency: evil }, txns: {} }) : null };
    let injected = 0;
    for (const tab of ["home", "money", "us"]) {
      actions.tab(tab);
      injected += document.querySelectorAll("#view img").length;
    }
    for (const open of [() => actions["edit-debt"]("dx"), () => actions["date-done"](), () => actions["add-challenge"]()]) {
      open();
      injected += document.querySelectorAll("#dialog img").length;
      document.getElementById("dialog").close();
    }
    ui.mintStorage = null;
    return injected === 0 && !window.__xss || `injected ${injected}`;
  });
  await test("kids' plan: balance = last checked balance + later deposits; growth = balance − what went in", () => {
    const plan = { id: "kp", kidId: "k1", name: "University", targetAge: 18, product: "deposit", rate: 5, tax: 20, start: 1000, since: "2025-01-01", monthly: 100, cost: 0 };
    const logs = [
      { id: "l1", planId: "kp", kind: "deposit", amount: 100, by: "a", date: "2025-02-01" },
      { id: "l2", planId: "kp", kind: "deposit", amount: 100, by: "b", date: "2025-03-01" },
      { id: "l3", planId: "kp", kind: "balance", amount: 1250, by: "", date: "2025-03-15" },
      { id: "l4", planId: "kp", kind: "deposit", amount: 100, by: "both", date: "2025-04-01" },
      { id: "x", planId: "other", kind: "deposit", amount: 999, by: "a", date: "2025-04-01" },
    ];
    const withSnapshot = kidPlanBalance(plan, { kidLogs: logs });
    const without = kidPlanBalance(plan, { kidLogs: logs.filter(l => l.kind !== "balance") });
    return withSnapshot.balance === 1350 && withSnapshot.putIn === 1300 && withSnapshot.growth === 50 && withSnapshot.measured &&
      without.balance === 1300 && !without.measured && kidPlanNetRate(plan) === 4 || JSON.stringify({ withSnapshot, without });
  });
  await test("kids' plan: projection to age 18, goal grows with inflation, needed monthly and rate close the gap", () => {
    const plan = { id: "kp", kidId: "k1", name: "University", targetAge: 18, product: "index", rate: 6, tax: 0, start: 10000, since: "2025-01-15", monthly: 200, cost: 50000, inflation: 5 };
    const plan$ = migrate({ ...blankState(), kids: [{ id: "k1", name: "Ayu", birth: "2016-01-15" }], kidPlans: [plan] });
    const p = projectKidPlan(plan, plan$, fixedNow);
    const noBirth = projectKidPlan({ ...plan, kidId: "missing" }, plan$, fixedNow);
    const close = (x, y, tolerance = 1) => Math.abs(x - y) <= tolerance;
    const ok = p && p.months === 96 && p.series.length === 9 && p.series[0].value === 10000 && p.series[0].age === 10 && p.series[8].age === 18 &&
      close(p.final, futureValue(10000, 200, 6, 8), 0.01) && close(p.costThen, 50000 * Math.pow(1.05, 8), 0.01) && p.gap > 0 &&
      close(futureValue(10000, p.neededMonthly, 6, 8), p.costThen) && close(futureValue(10000, 200, p.neededRate, 8), p.costThen) &&
      close(p.series[8].putIn, 10000 + 200 * 96, 0.01) && noBirth === null;
    return ok || JSON.stringify({ months: p && p.months, final: p && p.final, costThen: p && p.costThen, neededRate: p && p.neededRate });
  });
  await test("kids' plan: real growth is the money-weighted yearly return of deposits and a checked balance", () => {
    const simple = annualizedReturn([{ date: new Date(2025, 0, 1), amount: -100 }, { date: new Date(2026, 0, 1), amount: 110 }]);
    const end = new Date(2026, 0, 1);
    const yearsBetween = (from, to) => (to - from) / (365.25 * 864e5);
    const monthly = Array.from({ length: 12 }, (_, m) => ({ date: new Date(2025, m, 1), amount: -100 }));
    const value = monthly.reduce((sum, flow) => sum + 100 * Math.pow(1.06, yearsBetween(flow.date, end)), 0);
    const steady = annualizedReturn([...monthly, { date: end, amount: value }]);
    const plan = { id: "rg", kidId: "k", start: 1000, since: "2025-01-01", rate: 5, tax: 0 };
    const early = kidRealGrowth(plan, { kidLogs: [{ id: "b1", planId: "rg", kind: "balance", amount: 1050, date: "2025-02-01" }] });
    const year = kidRealGrowth(plan, { kidLogs: [{ id: "b2", planId: "rg", kind: "balance", amount: 1100, date: "2026-01-01" }] });
    return Math.abs(simple - 10) < 0.05 && Math.abs(steady - 6) < 0.01 && early.tooSoon && Math.abs(year.rate - 10) < 0.05 &&
      annualizedReturn([{ date: end, amount: -5 }]) === null || JSON.stringify({ simple, steady, early, year });
  });
  await test("trips: per-night and per-day lines plus buffer; saving before, a daily allowance during, the verdict after", () => {
    const trip = { id: "t1", kind: "honeymoon", date: "2026-03-01", nights: 7, buffer: 10,
      budget: { flights: 1000, stay: 100, food: 50, activities: 300, transport: 0, other: 0 } };
    const budget = tripBudget(trip);
    const plan = migrate({ ...blankState(), trips: [trip],
      funds: [{ id: "tf", name: "Bali", target: 2640, saved: 640, monthly: 0, milestoneId: "" }],
      tripSpends: [{ id: "s1", tripId: "t1", cat: "food", amount: 400, date: "2026-03-01" }, { id: "s2", tripId: "t1", cat: "mystery", amount: 200, date: "2026-03-02" }] });
    const unlinked = tripStatus(trip, plan, fixedNow);
    const before = tripStatus({ ...trip, fundId: "tf" }, plan, fixedNow);
    const during = tripStatus(trip, plan, new Date(2026, 2, 3, 15));
    const after = tripStatus(trip, plan, new Date(2026, 2, 20));
    const someday = tripStatus({ ...trip, date: "" }, plan, fixedNow);
    return budget.days === 8 && budget.subtotal === 2400 && budget.buffer === 240 && budget.total === 2640 &&
      unlinked.phase === "before" && unlinked.monthsLeft === 1 && unlinked.neededMonthly === 2640 &&
      before.saved === 640 && before.toSave === 2000 && before.neededMonthly === 2000 &&
      during.phase === "during" && during.dayNumber === 3 && during.daysLeft === 6 && during.spent === 600 && during.perDayLeft === 340 &&
      during.spentBy.other === 200 && after.phase === "after" && someday.phase === "someday" ||
      JSON.stringify({ budget: budget.total, unlinked: unlinked.neededMonthly, during: [during.dayNumber, during.perDayLeft], phases: [after.phase, someday.phase] });
  });
  await test("e2e trip: plan a honeymoon → pot tied to the Honeymoon milestone; spending logs; budget edits move the pot target", () => {
    const leaveOn = toISO(addMonths(new Date(), 6));
    state.couple.stage = "engaged";
    state.milestones = [{ id: "mh", stage: "married", title: "Honeymoon", date: leaveOn, done: false, notes: "" }];
    state.funds = [];
    state.contributions = [];
    state.trips = [];
    state.tripSpends = [];
    ui.now = new Date();
    actions.tab("money");
    document.querySelector('[data-act="add-trip"]').click();
    const form = document.getElementById("dialog-form");
    const prefilled = form.kind.value === "honeymoon" && form.date.value === leaveOn && form.nights.value === "7" && form.savePot.checked;
    form.name.value = "Bali";
    form.b_flights.value = "1.400";
    form.b_stay.value = "150";
    form.b_food.value = "80";
    form.requestSubmit();
    const trip = state.trips[0];
    const fund = trip && findIn(state.funds, trip.fundId);
    const potOk = fund && fund.target === 3399 && fund.milestoneId === "mh" && state.milestones.length === 1 && fund.monthly > 0;
    const spendForm = document.querySelector('[data-form="trip-spend"]');
    spendForm.amount.value = "200";
    spendForm.cat.value = "food";
    spendForm.requestSubmit();
    actions["edit-trip"](trip.id);
    const editForm = document.getElementById("dialog-form");
    editForm.b_stay.value = "200";
    editForm.requestSubmit();
    const spend = state.tripSpends[0];
    return prefilled && potOk && spend && spend.amount === 200 && spend.cat === "food" && findIn(state.funds, trip.fundId).target === 3784 &&
      document.getElementById("view").textContent.includes("Trips & honeymoon") || JSON.stringify({ prefilled, trip, fund, spends: state.tripSpends });
  });
  await test("e2e kids' plan: 'Plan it' pre-fills, deposits and a balance check log, switching product resets untouched presets", () => {
    state.kids = [{ id: "kk", name: "Ayu", birth: "2020-06-01" }];
    state.retirement = { ...state.retirement, eduCost: 100000, eduInflation: 5 };
    state.kidPlans = [];
    state.kidLogs = [];
    ui.now = new Date();
    actions.tab("money");
    document.querySelector('[data-act="plan-kid"][data-id="kk"]').click();
    const form = document.getElementById("dialog-form");
    const prefilled = form.goal.value === "university" && parseTypedAmount(form.cost.value) === 100000 && Number(form.monthly.value) > 0;
    form.start.value = "5000";
    form.requestSubmit();
    const plan = state.kidPlans[0];
    const created = plan && plan.rate === 4 && plan.tax === 20 && plan.start === 5000 && plan.targetAge === 18 && plan.name === "University";
    const depositForm = document.querySelector('[data-form="kid-deposit"]');
    depositForm.amount.value = "250";
    depositForm.requestSubmit();
    actions["kid-balance"](plan.id);
    const balanceForm = document.getElementById("dialog-form");
    balanceForm.amount.value = "5400";
    balanceForm.requestSubmit();
    const balance = kidPlanBalance(plan, state);
    const rendered = document.querySelector("#view .growth-chart") && document.getElementById("view").textContent.includes("projected by then");
    actions["edit-kidplan"](plan.id);
    const editForm = document.getElementById("dialog-form");
    editForm.product.value = "index";
    editForm.requestSubmit();
    return prefilled && created && state.kidLogs.length === 2 && balance.balance === 5400 && balance.measured && rendered &&
      plan.product === "index" && plan.rate === 9 && plan.tax === 0 || JSON.stringify({ prefilled, plan, logs: state.kidLogs, balance });
  });
  await test("sync: kids' deposits and trip spending from two phones both survive; budget lines merge field by field", () => {
    const base = migrate({ ...blankState(),
      kids: [{ id: "k1", name: "Ayu", birth: "2020-01-01" }],
      kidPlans: [{ id: "p1", kidId: "k1", name: "University", targetAge: 18, product: "deposit", rate: 4, tax: 20, start: 0, since: "2025-01-01", monthly: 100 }],
      trips: [{ id: "t1", name: "Bali", kind: "honeymoon", date: "2026-09-01", nights: 7, buffer: 10, budget: { flights: 1000, stay: 100, food: 50, activities: 0, transport: 0, other: 0 }, fundId: "", milestoneId: "" }] });
    stampChanges(null, base, 1000);
    const phoneA = JSON.parse(JSON.stringify(base));
    phoneA.kidLogs.push({ id: "la", planId: "p1", kind: "deposit", amount: 100, by: "a", date: "2026-01-10" });
    phoneA.trips[0].budget.stay = 180;
    stampChanges(base, phoneA, 2000);
    const phoneB = JSON.parse(JSON.stringify(base));
    phoneB.kidLogs.push({ id: "lb", planId: "p1", kind: "deposit", amount: 150, by: "b", date: "2026-01-10" });
    phoneB.tripSpends.push({ id: "sb", tripId: "t1", cat: "food", amount: 30, by: "b", date: "2026-01-10" });
    phoneB.trips[0].budget.food = 70;
    stampChanges(base, phoneB, 3000);
    const merged = mergeStates(phoneA, phoneB, 4000);
    const budget = merged.trips[0].budget;
    return merged.kidLogs.length === 2 && merged.tripSpends.length === 1 && budget.stay === 180 && budget.food === 70 &&
      kidPlanBalance(merged.kidPlans[0], merged).balance === 250 || JSON.stringify({ logs: merged.kidLogs, budget });
  });
  await test("xss: trip, destination, plan and child names render as text", () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    state.kids = [{ id: "kx", name: evil, birth: "2021-01-01" }];
    state.kidPlans = [{ id: "px", kidId: "kx", name: evil, targetAge: 18, product: "custom", rate: 5, tax: 0, start: 0, since: "2025-01-01", monthly: 50, cost: 1000 }];
    state.kidLogs = [{ id: "lx", planId: "px", kind: "deposit", amount: 10, by: "a", date: toISO(new Date()) }];
    state.trips = [{ id: "tx", name: evil, kind: "holiday", destination: evil, date: toISO(addMonths(new Date(), 2)), nights: 2, buffer: 0, budget: { stay: 50 }, fundId: "", milestoneId: "" }];
    state.tripSpends = [{ id: "sx", tripId: "tx", cat: "other", amount: 5, date: toISO(new Date()), note: evil }];
    let injected = 0;
    for (const tab of ["home", "money"]) {
      actions.tab(tab);
      injected += document.querySelectorAll("#view img").length;
    }
    for (const open of [() => actions["edit-trip"]("tx"), () => actions["edit-kidplan"]("px"), () => actions["kid-balance"]("px")]) {
      open();
      injected += document.querySelectorAll("#dialog img").length;
      document.getElementById("dialog").close();
    }
    state.kids = [];
    state.kidPlans = [];
    state.kidLogs = [];
    state.trips = [];
    state.tripSpends = [];
    return injected === 0 && !window.__xss || `injected ${injected}`;
  });
  localStorage.removeItem(store.key + ME_KEY_SUFFIX);
  if (params.has("cloud")) {
    await test("cloud: live encrypted sync between two phones via the deployed worker", async () => {
      const { a, b, result } = await twoDeviceScenario(CLOUD_URL, (...args) => fetch(...args));
      const { auth } = await a.client.keysReady();
      const raw = await (await fetch(`${CLOUD_URL}/v1/rooms/${a.client.config.room}`)).json();
      const deleted = await a.client.request("DELETE", { auth });
      a.client.leave();
      b.client.leave();
      const ok = result.joined && result.converged && result.goal && result.bucket && result.deletionWon && !raw.data.includes('"Ann"') && deleted.ok;
      return ok || JSON.stringify({ result, deleted: deleted.status });
    });
    await test("cloud: push reminder schedule stored (times only) and removed", async () => {
      const id = b64u.encode(crypto.getRandomValues(new Uint8Array(16)));
      const at = Date.now() + 2 * 864e5;
      const put = await fetch(`${CLOUD_URL}/v1/push/${id}`, { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: "https://push.example.invalid/selftest" }, times: [at, at + 864e5] }) });
      const summary = await put.json();
      const del = await fetch(`${CLOUD_URL}/v1/push/${id}`, { method: "DELETE" });
      const after = await (await fetch(`${CLOUD_URL}/v1/push/${id}`)).json();
      return put.ok && summary.count === 2 && summary.nextAt === at && del.ok && after.count === 0 || JSON.stringify({ summary, after });
    });
  }
  localStorage.removeItem("together.selftest");
  await test("isolation: real user data untouched", () => localStorage.getItem(APP_KEY) === realBefore || "real key changed");

  const report = document.createElement("pre");
  report.id = "selftest-report";
  report.textContent = JSON.stringify({ tests, errors: capturedErrors });
  document.body.appendChild(report);
}

