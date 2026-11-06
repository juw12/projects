/* ------------------------------------------------- reminders & web push */
/** Upcoming reminder moments (next 120 days). Text stays on the device; only times go to the server. */
function reminderSchedule(plan, now = new Date()) {
  const list = [];
  const nowMs = now.getTime();
  const at = (date, hour) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0).getTime();
  const add = (time, title, body, tag) => {
    if (time > nowMs + 60e3 && time < nowMs + 120 * 864e5) list.push({ at: time, title: i18n.text(title), body: i18n.text(body), tag });
  };
  const nameA = plan.couple.a.name || "Partner A";
  const nameB = plan.couple.b.name || "Partner B";
  const lastCheckin = plan.checkins.slice().sort(byDate).pop();
  let due = lastCheckin ? new Date(parseDate(lastCheckin.date).getTime() + 30 * 864e5) : new Date(nowMs + 864e5);
  if (at(due, 19) <= nowMs) due = new Date(nowMs + 864e5);
  for (let i = 0; i < 4; i++) {
    add(at(due, 19), "Monthly check-in", `${nameA} & ${nameB}: 10 minutes, phones away.`, `checkin-${i}`);
    due = addMonths(due, 1);
  }
  for (const m of plan.milestones) {
    const date = parseDate(m.date);
    if (m.done || !date) continue;
    add(at(new Date(date.getTime() - 7 * 864e5), 9), `One week to go: ${m.title}`, "Open Together to get ready.", `ms-${m.id}-7`);
    add(at(date, 9), `Today: ${m.title}`, "Tick it off in Together when it happens.", `ms-${m.id}`);
  }
  for (const party of upcomingCelebrations(plan, now, 120)) {
    const date = parseDate(party.date);
    add(at(new Date(date.getTime() - 7 * 864e5), 9), `In a week: ${party.text}`, "Time to plan something special.", `party-${party.date}-7`);
    add(at(date, 8), `Today: ${party.text}`, "Celebrate each other today.", `party-${party.date}`);
  }
  const hasData = plan.milestones.length + plan.goals.length + plan.checkins.length > 0;
  if (hasData) {
    const base = plan.lastBackupAt ? new Date(new Date(plan.lastBackupAt).getTime() + 30 * 864e5) : new Date(nowMs + 3 * 864e5);
    add(at(base, 10), "Back up your plan", "Settings → Export backup keeps your plan safe.", "backup");
  }
  const program = plan.program || { started: "", done: {} };
  if (program.started && !programProgress(program).finished) {
    const week = programProgress(program).currentWeek;
    let next = parseDate(program.started) || now;
    while (at(next, 19) <= nowMs) next = new Date(next.getTime() + 7 * 864e5);
    add(at(next, 19), `Foundations week ${week}`, PROGRAM[week - 1].title, "program");
  }
  // Weekly money mission: Sunday evening, while any pot still has a monthly plan.
  if ((plan.funds || []).some(fund => (Number(fund.monthly) || 0) > 0)) {
    const sunday = new Date(startOfWeek(now).getTime() + 6 * 864e5);
    for (let i = 0; i < 4; i++) {
      const day = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 7 * i);
      add(at(day, 18), "This week's money mission", `${nameA} & ${nameB}: check this week's pots on Home before the week ends.`, `money-week-${i}`);
    }
  }
  return list.sort((x, y) => x.at - y.at).slice(0, 60);
}

/** Tiny IndexedDB key-value store shared with the service worker (sw.js reads "reminders"). */
const swStore = {
  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("together-sw", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};

const reminders = {
  timer: null,
  prefKey() {
    return store.key + ".push";
  },
  pref() {
    try {
      return JSON.parse(localStorage.getItem(this.prefKey())) || null;
    } catch (error) {
      return null;
    }
  },
  savePref(pref) {
    if (pref) localStorage.setItem(this.prefKey(), JSON.stringify(pref));
    else localStorage.removeItem(this.prefKey());
  },
  get enabled() {
    return Boolean(this.pref()?.enabled);
  },
  isIOS() {
    return iosInfo().ios;
  },
  isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  },
  supported() {
    return location.protocol !== "file:" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  },
  async enable() {
    if (!this.supported()) {
      throw new Error(this.isIOS() && !iosInfo().pushCapable
        ? "Push reminders need iOS 16.4 or newer. Use the calendar (.ics) reminders below instead."
        : this.isIOS() && !this.isStandalone()
        ? "On iPhone/iPad: tap Share → Add to Home Screen, open Together from your Home Screen, then turn reminders on there."
        : "This browser can't receive push notifications. Use the calendar reminders below instead.");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notifications are blocked — allow them for this site in your browser settings.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription())
      || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u.decode(VAPID_PUBLIC_KEY) }));
    const pref = this.pref() || { id: b64u.encode(crypto.getRandomValues(new Uint8Array(16))) };
    pref.enabled = true;
    this.savePref(pref);
    await this.sync(subscription);
    await registration.showNotification(i18n.text("Reminders are on"), { body: i18n.text("We'll nudge you about check-ins, milestones and anniversaries."), icon: "icons/icon-192.png", tag: "together-welcome" });
  },
  async disable() {
    const pref = this.pref();
    this.savePref(null);
    if (pref) await fetch(`${CLOUD_URL}/v1/push/${pref.id}`, { method: "DELETE" }).catch(() => {});
    if (this.supported()) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }
  },
  /** Hand the reminder texts to the service worker and the times to the server. */
  async sync(subscription) {
    const pref = this.pref();
    if (!pref?.enabled || !this.supported()) return;
    if (!subscription) {
      const registration = await navigator.serviceWorker.ready;
      subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
    }
    const upcoming = reminderSchedule(state);
    await swStore.set("reminders", upcoming);
    const response = await fetch(`${CLOUD_URL}/v1/push/${pref.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), times: upcoming.map(r => r.at) }),
    });
    if (!response.ok) throw new Error(`Reminder server error (${response.status})`);
    const summary = await response.json();
    this.savePref({ ...this.pref(), nextAt: summary.nextAt, count: summary.count, syncedAt: Date.now() });
  },
  schedule() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch(() => {}), 2500);
  },
};

