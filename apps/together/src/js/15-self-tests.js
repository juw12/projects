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
    return items.some(i => i.icon === "⏰" && i.text.includes("Engagement")) && items.length <= 5 && items[0].icon === "🎉" || JSON.stringify(items);
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
    return state.funds[0].saved === 350 && state.kids.length === 1 && store.load().kids.length === 1 || "deposit/kid failed";
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

