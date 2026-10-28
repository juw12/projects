/* Vitals brain — pure logic, no DOM. Health score, fixes, goal planner,
 * chat intent engine and device playbooks. Loaded by the app and by tests. */
(function (root) {
  "use strict";

  const GB = 1024 ** 3;
  const MB = 1024 ** 2;

  function fmtBytes(bytes, digits) {
    if (bytes == null || isNaN(bytes)) return "—";
    const sign = bytes < 0 ? "-" : "";
    let n = Math.abs(bytes);
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    const d = digits != null ? digits : n >= 100 || i < 2 ? 0 : 1;
    return sign + n.toFixed(d) + " " + units[i];
  }

  function fmtDuration(seconds) {
    if (seconds == null) return "—";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    return m + "m";
  }

  // ------------------------------------------------------------ health score
  // Transparent: start at 100 and subtract named, visible penalties.
  function healthScore(v, scan) {
    const factors = [];
    const add = (system, label, points, detail) => factors.push({ system, label, points, detail });
    let known = 0;

    if (v && v.disk && v.disk.total) {
      known += 1;
      const freePct = (100 * v.disk.free) / v.disk.total;
      if (freePct < 5) add("storage", "Storage almost full", -30, fmtBytes(v.disk.free) + " free (" + freePct.toFixed(1) + "%). The OS needs free space for swap, updates and caches.");
      else if (freePct < 10) add("storage", "Storage low", -18, fmtBytes(v.disk.free) + " free (" + freePct.toFixed(0) + "%).");
      else if (freePct < 20) add("storage", "Storage getting tight", -6, fmtBytes(v.disk.free) + " free.");
      else add("storage", "Storage healthy", 0, fmtBytes(v.disk.free) + " free.");
    }
    if (v && v.memory && v.memory.percent != null) {
      known += 1;
      const p = v.memory.pressure;
      const swap = v.memory.swap_used ? " · " + fmtBytes(v.memory.swap_used) + " in swap" : "";
      if (p === "high") add("memory", "Memory under pressure", -20, Math.round(v.memory.percent) + "% used" + swap + ". Apps are being pushed to disk, which feels like lag.");
      else if (p === "elevated") add("memory", "Memory busy", -8, Math.round(v.memory.percent) + "% used" + swap + ".");
      else add("memory", "Memory comfortable", 0, Math.round(v.memory.percent) + "% used.");
    }
    if (v && v.cpu && v.cpu.percent != null) {
      known += 1;
      if (v.cpu.percent > 85) add("cpu", "Processor saturated", -12, Math.round(v.cpu.percent) + "% busy right now.");
      else if (v.cpu.percent > 60) add("cpu", "Processor busy", -5, Math.round(v.cpu.percent) + "% busy right now.");
      else add("cpu", "Processor relaxed", 0, Math.round(v.cpu.percent) + "% busy.");
    }
    if (v && v.battery && v.battery.present) {
      known += 1;
      const h = v.battery.health_percent;
      if (h == null) add("battery", "Battery wear unknown", 0, "This device does not report capacity.");
      else if (h < 80) add("battery", "Battery worn", -12, h.toFixed(0) + "% of design capacity" + (v.battery.cycles ? " after " + v.battery.cycles + " cycles" : "") + ".");
      else if (h < 88) add("battery", "Battery aging", -4, h.toFixed(0) + "% of design capacity.");
      else add("battery", "Battery healthy", 0, h.toFixed(0) + "% of design capacity.");
    }
    if (v && v.uptime != null && v.uptime > 14 * 86400) {
      add("system", "Not restarted in " + Math.floor(v.uptime / 86400) + " days", -3, "A restart applies updates and clears leaked memory.");
    }
    if (scan && scan.reclaimable > 10 * GB) {
      add("storage", "Lots of reclaimable junk", -4, fmtBytes(scan.reclaimable) + " can be cleaned.");
    }
    const score = Math.max(0, Math.min(100, 100 + factors.reduce((s, f) => s + f.points, 0)));
    const band = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Needs attention" : "Critical";
    return { score, band, factors, known, complete: known >= 3 };
  }

  // Per-system 0..1 fill for the orb rings (1 = healthy).
  function systemLevels(v) {
    const lv = {};
    if (v && v.disk && v.disk.total) lv.storage = Math.max(0.02, Math.min(1, v.disk.free / v.disk.total / 0.3));
    if (v && v.memory && v.memory.percent != null) lv.memory = Math.max(0.02, 1 - Math.max(0, v.memory.percent - 40) / 60);
    if (v && v.cpu && v.cpu.percent != null) lv.cpu = Math.max(0.02, 1 - v.cpu.percent / 100);
    if (v && v.battery && v.battery.present) {
      lv.battery = v.battery.health_percent != null ? Math.max(0.02, (v.battery.health_percent - 50) / 50) : (v.battery.percent || 0) / 100;
    }
    return lv;
  }

  // -------------------------------------------------------------- fixes
  function recommendations(ctx) {
    const v = ctx.vitals || {};
    const scan = ctx.scan;
    const procs = ctx.processes || [];
    const out = [];
    const add = (o) => out.push(o);
    const freePct = v.disk && v.disk.total ? (100 * v.disk.free) / v.disk.total : null;

    if (freePct != null && freePct < 15) {
      if (scan) {
        const safe = scan.categories.filter((c) => c.safety === "safe" && c.bytes > 0);
        const safeBytes = safe.reduce((s, c) => s + c.bytes, 0);
        if (safeBytes > 50 * MB) {
          add({ id: "clean-safe", level: freePct < 5 ? "high" : "med", icon: "broom",
            title: "Reclaim " + fmtBytes(safeBytes) + " of safe junk",
            body: "Caches, logs and build data that rebuild themselves. Held in the Undo Vault first.",
            action: { type: "clean-safe", label: "Review & clean" } });
        }
        const big = scan.categories.filter((c) => c.safety === "review" && c.bytes > 500 * MB).sort((a, b) => b.bytes - a.bytes)[0];
        if (big) {
          add({ id: "review-" + big.id, level: "med", icon: "search", title: big.name + ": " + fmtBytes(big.bytes),
            body: big.why, action: { type: "view", view: "clean", label: "Look through it" } });
        }
      } else {
        add({ id: "scan", level: freePct < 5 ? "high" : "med", icon: "search",
          title: "Only " + fmtBytes(v.disk.free) + " free — find what is safe to remove",
          body: "A scan takes under a minute and changes nothing on its own.",
          action: { type: "scan", label: "Scan storage" } });
      }
    }
    if (v.memory && v.memory.pressure && v.memory.pressure !== "normal") {
      const hog = procs.filter((p) => p.owned && !p.protected).sort((a, b) => b.rss - a.rss)[0];
      add({ id: "memory", level: v.memory.pressure === "high" ? "high" : "med", icon: "memory",
        title: "Memory is " + v.memory.pressure + (hog ? " — " + hog.name + " uses " + fmtBytes(hog.rss) : ""),
        body: "Closing one heavy app helps more than any 'RAM cleaner'. Vitals never force-frees memory — that only makes the next app launch slower.",
        action: hog ? { type: "quit", pid: hog.pid, name: hog.name, label: "Quit " + hog.name } : { type: "view", view: "performance", label: "See apps" } });
    }
    const cpuHog = procs.filter((p) => (p.cpu || 0) > 35 && !p.protected)[0];
    if (cpuHog) {
      add({ id: "cpu", level: cpuHog.cpu > 70 ? "high" : "med", icon: "cpu",
        title: cpuHog.name + " is using " + Math.round(cpuHog.cpu) + "% CPU",
        body: "Sustained load drains the battery and heats the device. If you are not using it, quitting it is the fix.",
        action: cpuHog.owned ? { type: "quit", pid: cpuHog.pid, name: cpuHog.name, label: "Quit it" } : { type: "view", view: "performance", label: "Details" } });
    }
    (ctx.anomalies || []).forEach((a) => add({ id: "anomaly-" + a.metric, level: "med", icon: "pulse",
      title: "Unusual for you: " + (a.metric === "cpu" ? "CPU" : "memory"), body: a.message,
      action: { type: "view", view: "performance", label: "Investigate" } }));
    if (v.battery && v.battery.present && v.battery.health_percent != null && v.battery.health_percent < 80) {
      add({ id: "battery-worn", level: "med", icon: "battery",
        title: "Battery holds " + Math.round(v.battery.health_percent) + "% of its original charge",
        body: "Software cannot restore capacity. Limit charging to 80% to slow further wear, or plan a replacement.",
        action: { type: "view", view: "battery", label: "Battery plan" } });
    }
    if (v.uptime && v.uptime > 14 * 86400) {
      add({ id: "restart", level: "low", icon: "restart", title: "Restart — up for " + Math.floor(v.uptime / 86400) + " days",
        body: "Applies pending updates and releases memory leaked by long-running apps.", action: null });
    }
    if (ctx.vaultBytes > 1 * GB) {
      add({ id: "vault", level: "low", icon: "vault", title: fmtBytes(ctx.vaultBytes) + " waiting in the Undo Vault",
        body: "Still on disk until the batch expires. Purge it when you are sure.", action: { type: "view", view: "vault", label: "Open vault" } });
    }
    const order = { high: 0, med: 1, low: 2 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  // ------------------------------------------------------- goal planner
  // Reach a target with the least risk: safe first (largest first), then
  // review categories, never touching anything the user excluded.
  const EXCLUDE_WORDS = {
    downloads: ["old-installers", "old-downloads"],
    download: ["old-installers", "old-downloads"],
    installers: ["old-installers"],
    backup: ["iphone-backups"],
    backups: ["iphone-backups"],
    iphone: ["iphone-backups"],
    trash: ["trash"],
    bin: ["trash"],
    node: ["stale-node-modules"],
    node_modules: ["stale-node-modules"],
    projects: ["stale-node-modules"],
    dev: ["stale-node-modules", "package-caches", "xcode-derived", "ios-device-support", "simulator-caches"],
    developer: ["stale-node-modules", "package-caches", "xcode-derived", "ios-device-support", "simulator-caches"],
    xcode: ["xcode-derived", "ios-device-support", "simulator-caches"],
    cache: ["app-caches", "browser-caches", "user-cache", "package-caches"],
    caches: ["app-caches", "browser-caches", "user-cache", "package-caches"],
    browser: ["browser-caches"],
    mail: ["mail-downloads"],
    duplicates: ["duplicates"],
    photos: ["duplicates", "large"],
    pictures: ["duplicates", "large"],
    videos: ["large"],
    large: ["large"],
  };

  const CATEGORY_LABELS = {
    "old-installers": "old installers", "old-downloads": "old downloads", "iphone-backups": "device backups",
    trash: "Trash", "stale-node-modules": "idle node_modules", "package-caches": "package caches",
    "xcode-derived": "Xcode data", "ios-device-support": "iOS device symbols", "simulator-caches": "simulator caches",
    "app-caches": "app caches", "browser-caches": "browser caches", "user-cache": "app caches",
    "mail-downloads": "Mail attachments", duplicates: "duplicates", large: "large files",
  };

  function describeExclusions(set) {
    const names = [];
    Array.from(set).forEach((id) => {
      const label = CATEGORY_LABELS[id] || id;
      if (!names.includes(label)) names.push(label);
    });
    return names.join(", ");
  }

  function parseExclusions(text) {
    const t = (text || "").toLowerCase();
    const m = t.match(/(?:without|except|but not|not|don'?t touch|do not touch|keep|leave|skip|exclude|excluding|no)\s+(?:my\s+|the\s+|any\s+)?([a-z_ ,&-]+)/g);
    const out = new Set();
    if (!m) return out;
    m.forEach((frag) => {
      Object.keys(EXCLUDE_WORDS).forEach((w) => {
        if (new RegExp("\\b" + w + "\\b").test(frag)) EXCLUDE_WORDS[w].forEach((c) => out.add(c));
      });
    });
    return out;
  }

  function planGoal(scan, goalBytes, opts) {
    const options = opts || {};
    const exclude = options.exclude || new Set();
    const allowReview = options.allowReview !== false;
    const candidates = [];
    (scan ? scan.categories : []).forEach((c) => {
      if (!c.bytes || exclude.has(c.id)) return;
      if (c.safety === "review" && !allowReview) return;
      candidates.push({ kind: "category", id: c.id, name: c.name, bytes: c.bytes, safety: c.safety, rank: c.safety === "safe" ? 0 : 2 });
    });
    if (scan && scan.duplicate_waste && !exclude.has("duplicates") && allowReview) {
      const ids = [];
      scan.duplicates.forEach((g) => (g.copy_ids || []).forEach((id) => ids.push(id)));
      if (ids.length) candidates.push({ kind: "targets", id: "duplicates", name: "Exact duplicate copies", bytes: scan.duplicate_waste, safety: "review", rank: 1, targets: ids });
    }
    candidates.sort((a, b) => a.rank - b.rank || b.bytes - a.bytes);
    const steps = [];
    let total = 0;
    for (const c of candidates) {
      if (total >= goalBytes) break;
      steps.push(c);
      total += c.bytes;
    }
    return { goal: goalBytes, steps, total, reached: total >= goalBytes, excluded: Array.from(exclude), available: candidates.reduce((s, c) => s + c.bytes, 0) };
  }

  // ------------------------------------------------------- playbooks
  const PLAYBOOKS = {
    iphone: {
      name: "iPhone & iPad",
      intro: "iOS does not let any app clean other apps' data — apps that claim to are mostly photo de-duplicators or subscription traps. These built-in steps are what actually works.",
      sections: [
        { title: "Free up storage", items: [
          { t: "Follow Apple's own suggestions", path: "Settings › General › iPhone Storage", why: "Lists recommendations such as Offload Unused Apps and Review Large Attachments, with the space each frees.", gain: "Often 1–10 GB" },
          { t: "Empty Recently Deleted photos", path: "Photos › Albums › Recently Deleted › Select › Delete All", why: "Deleted photos keep using space for 30 days.", gain: "Varies — often several GB" },
          { t: "Keep messages for 1 year", path: "Settings › Messages › Keep Messages › 1 Year", why: "Years of photos and videos in chats add up quietly.", gain: "Often 1–5 GB" },
          { t: "Offload apps you rarely open", path: "Settings › General › iPhone Storage › (app) › Offload App", why: "Removes the app but keeps your documents and data; reinstalling brings it back as it was.", gain: "App size" },
          { t: "Optimize photo storage", path: "Settings › Photos › Optimize iPhone Storage", why: "Keeps full-resolution originals in iCloud and smaller versions on the phone (needs iCloud Photos).", gain: "Large on big libraries" },
          { t: "Clear chat-app media", path: "WhatsApp › Settings › Storage and Data › Manage Storage", why: "Forwarded videos and voice notes are the usual culprit.", gain: "Varies" },
        ] },
        { title: "Make the battery last", items: [
          { t: "Check battery health and limit charging", path: "Settings › Battery › Battery Health & Charging", why: "Shows Maximum Capacity. Turn on Optimized Battery Charging (or the 80% Limit on models that offer it) to slow wear.", gain: "Slower aging" },
          { t: "Find the apps that drain it", path: "Settings › Battery", why: "Per-app usage for the last 24 hours and 10 days, including background activity.", gain: "Targets the real cause" },
          { t: "Limit Background App Refresh", path: "Settings › General › Background App Refresh", why: "Turn it off for apps that do not need to update while closed.", gain: "Noticeable for heavy app users" },
          { t: "Location: While Using, not Always", path: "Settings › Privacy & Security › Location Services", why: "Constant GPS use is one of the biggest silent drains.", gain: "Noticeable" },
          { t: "Use Low Power Mode below 30%", path: "Settings › Battery › Low Power Mode", why: "Pauses background work and reduces visual effects until you charge.", gain: "Extra hours" },
        ] },
        { title: "Keep it fast", items: [
          { t: "Keep at least 10% storage free", path: "Settings › General › iPhone Storage", why: "A nearly full phone slows down because iOS has no room for caches and updates.", gain: "Smoother" },
          { t: "Install iOS updates", path: "Settings › General › Software Update", why: "Fixes performance and battery bugs.", gain: "Varies" },
          { t: "Restart now and then", path: "Hold side + volume button › slide to power off", why: "Clears stuck processes. You do not need to swipe-close apps — that does not save battery.", gain: "Fixes glitches" },
        ] },
      ],
    },
    android: {
      name: "Android",
      intro: "Avoid 'booster' and 'cleaner' apps: Android restarts the apps they kill, which costs more battery than it saves. Use the tools built into your phone.",
      sections: [
        { title: "Free up storage", items: [
          { t: "Run Files by Google › Clean", path: "Files by Google › Clean", why: "Google's own cleaner shows junk files, duplicates, large files and unused apps — and asks before deleting.", gain: "Often 1–5 GB" },
          { t: "Check the storage breakdown", path: "Settings › Storage", why: "See which category (apps, images, video, system) is actually big.", gain: "Find the real culprit" },
          { t: "Clear one app's cache", path: "Settings › Apps › (app) › Storage & cache › Clear cache", why: "Safe — clears temporary data only. 'Clear storage' is different and erases the app's data.", gain: "Varies" },
          { t: "Free up space after photo backup", path: "Google Photos › Profile › Free up space", why: "Removes local copies that are already safely backed up.", gain: "Large on big libraries" },
          { t: "Clear chat-app media", path: "WhatsApp › Settings › Storage and data › Manage storage", why: "Forwarded videos and voice notes add up.", gain: "Varies" },
        ] },
        { title: "Make the battery last", items: [
          { t: "See per-app battery use", path: "Settings › Battery › Battery usage", why: "Find the app that drains in the background.", gain: "Targets the real cause" },
          { t: "Restrict a draining app", path: "Settings › Apps › (app) › Battery › Restricted", why: "Stops it running in the background.", gain: "Noticeable" },
          { t: "Turn on Adaptive Battery", path: "Settings › Battery › Adaptive preferences", why: "Learns which apps you use and limits the rest.", gain: "Noticeable" },
          { t: "Use your maker's charge protection", path: "Settings › Battery › Protect battery / Adaptive charging / Charging optimization", why: "Names vary by brand; capping at 80–85% slows battery wear.", gain: "Slower aging" },
          { t: "Dark theme on OLED screens", path: "Settings › Display › Dark theme", why: "Black pixels are off on OLED panels.", gain: "Small to moderate" },
        ] },
      ],
    },
    mac: {
      name: "Mac",
      intro: "Run the Vitals agent for real scans and the Undo Vault. These built-in settings pair well with it.",
      sections: [
        { title: "Storage", items: [
          { t: "Use macOS storage recommendations", path: "System Settings › General › Storage", why: "Store in iCloud, Optimize Storage and Empty Trash Automatically.", gain: "Varies" },
          { t: "Scan with Vitals", path: "Vitals › Clean › Scan", why: "Finds caches, Xcode data, idle node_modules, old installers and duplicates — every item reversible for 72 h.", gain: "Often 5–40 GB on dev machines" },
        ] },
        { title: "Battery", items: [
          { t: "Optimized Battery Charging", path: "System Settings › Battery › (i) next to Battery Health", why: "Delays charging past 80% when macOS predicts you will stay plugged in.", gain: "Slower aging" },
          { t: "Find energy-hungry apps", path: "Activity Monitor › Energy", why: "Or use Vitals Drain Detective, which keeps history and flags idle drainers.", gain: "Targets the real cause" },
          { t: "Low Power Mode on battery", path: "System Settings › Battery › Low Power Mode", why: "Reduces clock speed and brightness when unplugged.", gain: "Longer runtime" },
        ] },
        { title: "Speed", items: [
          { t: "Trim login items", path: "System Settings › General › Login Items & Extensions", why: "Fewer things at startup = faster boot and more free memory.", gain: "Faster boot" },
        ] },
      ],
    },
    windows: {
      name: "Windows",
      intro: "Run the Vitals agent for real scans. Windows also ships good built-in tools.",
      sections: [
        { title: "Storage", items: [
          { t: "Turn on Storage Sense", path: "Settings › System › Storage › Storage Sense", why: "Automatically clears temp files and old Recycle Bin items.", gain: "Ongoing" },
          { t: "Clean up Windows Update leftovers", path: "Settings › System › Storage › Cleanup recommendations / Temporary files", why: "Old update files can be several GB (needs admin).", gain: "Often 2–10 GB" },
        ] },
        { title: "Battery", items: [
          { t: "Read your battery report", path: "Terminal: powercfg /batteryreport", why: "Shows design vs full-charge capacity and cycle history.", gain: "Know the real wear" },
          { t: "Use your laptop's charge limit", path: "Lenovo Vantage / MyASUS / Dell Power Manager / Surface Smart Charging", why: "Capping at ~80% slows wear on always-plugged laptops.", gain: "Slower aging" },
          { t: "Energy saver on battery", path: "Settings › System › Power & battery", why: "Lowers background activity when unplugged.", gain: "Longer runtime" },
        ] },
        { title: "Speed", items: [
          { t: "Trim startup apps", path: "Task Manager › Startup apps", why: "Disable items with 'High' startup impact you do not need.", gain: "Faster boot" },
        ] },
      ],
    },
  };

  // ------------------------------------------------------- intent engine
  const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(tb|t|gb|gig|gigs|g|mb|m)\b/i;

  function parseSize(text) {
    const m = (text || "").match(SIZE_RE);
    if (!m) return null;
    const n = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    if (unit.startsWith("t")) return n * 1024 * GB;
    if (unit.startsWith("m")) return n * MB;
    return n * GB;
  }

  const INTENTS = [
    { id: "goal", test: (t) => SIZE_RE.test(t) && /(free|clear|make|need|get|reclaim|room|space|delete|clean)/.test(t) },
    { id: "undo", test: (t) => /\b(undo|restore|bring (it|them|back)|put (it|them) back|recover|revert|i need (it|that) back|mistake)\b/.test(t) },
    { id: "ram-myth", test: (t) => /(ram|memory)\s*(clean|boost|booster|free|purge|optimi[sz])|booster|task killer|kill all apps/.test(t) },
    { id: "quit", test: (t) => /\b(quit|close|kill|force quit|stop|end)\b\s+(?!all\b)([a-z0-9][\w .+-]{1,40})/.test(t) && !/battery|charging|draining|startup|login|boot|at launch/.test(t) },
    { id: "iphone", test: (t) => /\b(iphone|ios|ipad)\b/.test(t) },
    { id: "android", test: (t) => /\b(android|samsung|galaxy|pixel|xiaomi|redmi|oppo|vivo|oneplus|huawei)\b/.test(t) },
    { id: "battery-health", test: (t) => /battery/.test(t) && /(health|wear|replace|capacity|cycle|condition|old|worn|degrad)/.test(t) },
    { id: "battery-drain", test: (t) => /(drain|dying|dies|runtime|doesn'?t last|not last|losing charge|goes down fast|dropping fast)/.test(t) },
    { id: "charging", test: (t) => /(preserve|protect|extend|longevity|80 ?%|charg|keep it plugged|plugged in|lifespan|last for years)/.test(t) },
    { id: "battery-drain", test: (t) => /(battery|power)/.test(t) },
    { id: "hot", test: (t) => /\b(hot|heat|heating|fan|fans|loud|noisy|noise|warm|thermal|overheat\w*|burning)\b/.test(t) },
    { id: "slow", test: (t) => /(slow|lag|laggy|freez|stutter|sluggish|hang|beach ?ball|spinning|unresponsive|takes forever|not responding|speed up|faster|boost|optimi[sz]e|performance)/.test(t) },
    { id: "grew", test: (t) => /(grew|grow|growing|growth|suddenly|filled up|fills up|eating|what took|what is taking|what's taking|who ate)/.test(t) },
    { id: "large", test: (t) => /(large|big|biggest|huge|largest)\s*(files?|things|items|folders?)?/.test(t) },
    { id: "duplicates", test: (t) => /(duplicate|dupes?|copies|same file)/.test(t) },
    { id: "startup", test: (t) => /(startup|start up|login items?|boot|launch at|at login|on startup)/.test(t) },
    { id: "privacy", test: (t) => /(privacy|private|tracking|telemetry|upload|cloud|send my data|spy|safe to use|trust)/.test(t) },
    { id: "safe", test: (t) => /(is it safe|safe to delete|will i lose|what gets deleted|can i delete|what is .*cache|what are caches)/.test(t) },
    { id: "storage", test: (t) => /(storage|space|disk|full|clean|junk|cache|drive|ssd|hdd)/.test(t) },
    { id: "status", test: (t) => /(health|score|status|how('?s| is) my|check( up)?|diagnos|overview|summary|report|what('?s| is) wrong)/.test(t) },
    { id: "help", test: (t) => /^(hi|hey|hello|yo|help|what can you do|\?|menu|start)\b/.test(t) },
  ];

  function detectIntent(text) {
    const t = (text || "").toLowerCase().trim();
    for (const intent of INTENTS) {
      if (intent.test(t)) return intent.id;
    }
    return "unknown";
  }

  function findProcess(text, procs) {
    const m = (text || "").toLowerCase().match(/\b(?:quit|close|kill|force quit|stop|end)\b\s+(?:the\s+|my\s+)?([a-z0-9][\w .+-]{1,40})/);
    if (!m) return null;
    const want = m[1].replace(/\b(app|application|please|now|process)\b/g, "").trim();
    if (!want) return null;
    const scored = (procs || []).map((p) => {
      const n = p.name.toLowerCase();
      let s = 0;
      if (n === want) s = 3;
      else if (n.startsWith(want)) s = 2;
      else if (n.includes(want)) s = 1;
      return { p, s };
    }).filter((x) => x.s > 0);
    scored.sort((a, b) => b.s - a.s || (b.p.cpu || 0) - (a.p.cpu || 0) || b.p.rss - a.p.rss);
    return scored.length ? { name: want, match: scored[0].p, count: scored.length } : { name: want, match: null, count: 0 };
  }

  function topBy(procs, key, n) {
    return (procs || []).filter((p) => !p.protected).slice().sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, n);
  }

  function respond(text, ctx) {
    const c = ctx || {};
    const v = c.vitals || {};
    const scan = c.scan;
    const intent = detectIntent(text);
    const t = (text || "").toLowerCase();
    const r = { intent, text: "", chips: [], plan: null };
    const agent = c.mode === "agent" || c.mode === "demo";
    const phone = c.platform === "iphone" || c.platform === "android";

    const needAgent = () => {
      r.text += phone
        ? "\n\nOn a phone no web page can read other apps' storage — the steps above are the reliable route. To also see your laptop from here, run the Vitals agent on it and pair this phone (Devices)."
        : "\n\nFor real numbers, run the free local agent on this computer (`python server.py`) — or try **demo data** to see how it works.";
      r.chips.push(phone ? { label: "Pair with my laptop", action: "view", view: "devices" } : { label: "How to run the agent", action: "view", view: "devices" });
      if (!phone) r.chips.push({ label: "Try demo data", action: "demo" });
    };

    switch (intent) {
      case "help": {
        r.text = "Hi — I'm Vitals. Tell me what is bothering you in plain words and I'll check the device, explain what I find and offer a fix you can undo.\n\nTry: **\"free 10 GB without touching downloads\"**, **\"why is my laptop slow\"**, **\"battery drains overnight\"** or **\"what grew this week\"**.";
        r.chips = [
          { label: "Check my device", action: "say", text: "how is my device" },
          { label: "Free 5 GB", action: "say", text: "free 5 GB" },
          { label: "Why is it slow?", action: "say", text: "why is it slow" },
          { label: "Battery health", action: "say", text: "battery health" },
        ];
        break;
      }
      case "status": {
        const h = healthScore(v, scan);
        if (!h.known) {
          r.text = "I can't see this device's vital signs from the browser alone.";
          needAgent();
          break;
        }
        const neg = h.factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points);
        r.text = "Health score **" + h.score + "/100 — " + h.band + "**." + (neg.length ? "\n\nWhat is costing points:\n" + neg.map((f) => "- " + f.label + " (" + f.points + "): " + f.detail).join("\n") : "\n\nNothing is costing points right now. 👌");
        const fixes = recommendations(c).slice(0, 3);
        fixes.forEach((f) => f.action && r.chips.push(actionChip(f.action)));
        break;
      }
      case "goal": {
        const goal = parseSize(t);
        const exclude = parseExclusions(t);
        if (!agent) {
          r.text = "To free " + fmtBytes(goal) + " I need to look at your files, which a web page cannot do.";
          if (phone) r.text += "\n\n" + playbookSummary(c.platform, 0);
          needAgent();
          break;
        }
        if (!scan) {
          r.text = "I'll scan first (read-only, under a minute), then build a plan to free **" + fmtBytes(goal) + "**" + (exclude.size ? " without touching " + describeExclusions(exclude) : "") + ".";
          r.chips.push({ label: "Scan now", action: "scan", then: text, primary: true });
          break;
        }
        const plan = planGoal(scan, goal, { exclude });
        r.plan = plan;
        if (!plan.steps.length) {
          r.text = "I couldn't find anything to clean" + (exclude.size ? " with those exclusions" : "") + ". Check the large-files list — the space may be in your own files.";
          r.chips.push({ label: "Show large files", action: "view", view: "clean" });
          break;
        }
        r.text = (plan.reached ? "Here's the lowest-risk way to free **" + fmtBytes(goal) + "**:" : "I can only find **" + fmtBytes(plan.total) + "** of the " + fmtBytes(goal) + " you asked for. Here's all of it, safest first:") +
          (exclude.size ? "\n\nKept off-limits as you asked: " + describeExclusions(exclude) + "." : "") +
          "\n\nEverything goes to the **Undo Vault** for 72 h first.";
        r.chips.push({ label: "Clean this plan", action: "clean-plan", plan, primary: true });
        r.chips.push({ label: "Review items", action: "view", view: "clean" });
        break;
      }
      case "storage": {
        if (!agent) {
          r.text = phone ? playbookSummary(c.platform, 0) : "Storage cleaning needs the local agent — a browser tab cannot read your disk.";
          needAgent();
          break;
        }
        const free = v.disk ? fmtBytes(v.disk.free) + " free of " + fmtBytes(v.disk.total) : "";
        if (!scan) {
          r.text = "You have " + free + ". Want me to look for safe-to-remove files? The scan only reads; nothing changes until you confirm.";
          r.chips.push({ label: "Scan storage", action: "scan", primary: true });
          break;
        }
        const cats = scan.categories.filter((x) => x.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 5);
        r.text = "You have " + free + ". I found **" + fmtBytes(scan.reclaimable) + "** you could reclaim (" + fmtBytes(scan.safe_reclaimable) + " of it fully safe):\n" +
          cats.map((x) => "- " + x.name + " — " + fmtBytes(x.bytes) + (x.safety === "safe" ? " (safe)" : " (review)")).join("\n") +
          (scan.duplicate_waste ? "\n- Exact duplicates — " + fmtBytes(scan.duplicate_waste) : "");
        r.chips.push({ label: "Clean safe items", action: "clean-safe", primary: true });
        r.chips.push({ label: "Open Clean", action: "view", view: "clean" });
        break;
      }
      case "slow": {
        if (!agent) {
          r.text = phone ? playbookSummary(c.platform, 2) || playbookSummary(c.platform, 1) : "I can run a quick **throttle check** in this tab, but finding the app slowing you down needs the agent.";
          r.chips.push({ label: "Run throttle check", action: "benchmark" });
          needAgent();
          break;
        }
        const lines = [];
        if (v.memory && v.memory.pressure !== "normal") lines.push("**Memory is " + v.memory.pressure + "** (" + Math.round(v.memory.percent) + "% used" + (v.memory.swap_used ? ", " + fmtBytes(v.memory.swap_used) + " swapped to disk" : "") + "). This is the most likely cause of lag.");
        if (v.disk && v.disk.total && v.disk.free / v.disk.total < 0.1) lines.push("**Disk is nearly full** (" + fmtBytes(v.disk.free) + " free). With memory tight, the system needs that space to swap — a full disk makes everything crawl.");
        const hogs = topBy(c.processes, "cpu", 3).filter((p) => (p.cpu || 0) > 10);
        if (hogs.length) lines.push("Busiest apps: " + hogs.map((p) => p.name + " " + Math.round(p.cpu) + "%").join(", ") + ".");
        const memHogs = topBy(c.processes, "rss", 3);
        if (memHogs.length) lines.push("Biggest memory users: " + memHogs.map((p) => p.name + " " + fmtBytes(p.rss)).join(", ") + ".");
        (c.anomalies || []).forEach((a) => lines.push("Unusual for you: " + a.message));
        if (v.uptime > 14 * 86400) lines.push("Up for " + Math.floor(v.uptime / 86400) + " days — a restart would help.");
        r.text = lines.length ? lines.join("\n\n") : "Nothing looks wrong right now: CPU, memory and disk are all comfortable. If it felt slow a moment ago, ask me again while it happens — I compare against your normal.";
        const quitTarget = memHogs.find((p) => p.owned) || hogs.find((p) => p.owned);
        if (quitTarget) r.chips.push({ label: "Quit " + quitTarget.name, action: "quit", pid: quitTarget.pid, name: quitTarget.name });
        if (v.disk && v.disk.free / v.disk.total < 0.15) r.chips.push({ label: "Free up space", action: "say", text: "free 10 GB" });
        r.chips.push({ label: "Open Performance", action: "view", view: "performance" });
        break;
      }
      case "hot": {
        if (!agent) {
          r.text = "Heat almost always comes from sustained CPU or GPU load — a stuck tab, a sync loop or a video call.";
          needAgent();
          break;
        }
        const hogs = topBy(c.processes, "cpu", 4).filter((p) => (p.cpu || 0) > 5);
        r.text = (v.cpu ? "The processor is at **" + Math.round(v.cpu.percent) + "%**. " : "") +
          (hogs.length ? "Doing the work right now: " + hogs.map((p) => "**" + p.name + "** (" + Math.round(p.cpu) + "%)").join(", ") + ".\n\nIf you're not actively using the top one, quitting it is the fix. Also keep vents clear — soft surfaces trap heat." : "No single app is busy right now, so the heat may come from charging, a warm room or a blocked vent.");
        const q = hogs.find((p) => p.owned);
        if (q) r.chips.push({ label: "Quit " + q.name, action: "quit", pid: q.pid, name: q.name });
        r.chips.push({ label: "Open Performance", action: "view", view: "performance" });
        break;
      }
      case "battery-drain": {
        const b = v.battery || {};
        if (!agent) {
          r.text = (b.percent != null ? "Battery is at " + Math.round(b.percent) + "%" + (b.charging ? " and charging" : "") + ". " : "") +
            (phone ? playbookSummary(c.platform, 1) : "I can watch the drain rate while this tab is open, but finding which app drains it needs the agent.");
          needAgent();
          break;
        }
        const d = c.drain || {};
        const lines = [];
        if (b.present) lines.push("Battery at **" + b.percent + "%**" + (b.plugged ? " (plugged in)" : b.minutes_left ? ", about " + fmtDuration(b.minutes_left * 60) + " left" : "") + ".");
        if (d.percent_per_hour) lines.push("Measured drain: **" + d.percent_per_hour + "%/hour** on battery.");
        const users = (d.processes || []).filter((p) => p.battery_seconds > 0).slice(0, 4);
        if (users.length) lines.push("Biggest consumers while on battery: " + users.map((p) => p.name + " (" + p.battery_share + "%)").join(", ") + ".");
        else if ((d.processes || []).length) lines.push("Heaviest apps over the last day: " + d.processes.slice(0, 4).map((p) => p.name + " (" + p.share + "%)").join(", ") + ". Unplug for a while and I'll split out what drains on battery.");
        if ((d.idle_drainers || []).length) lines.push("**Idle drainers** — busy while you were away: " + d.idle_drainers.slice(0, 3).map((p) => p.name).join(", ") + ".");
        if (!d.processes || !d.processes.length) lines.push("I'm still collecting history — leave Vitals running and ask again in an hour.");
        r.text = lines.join("\n\n");
        r.chips.push({ label: "Open Battery", action: "view", view: "battery" });
        r.chips.push({ label: "Energy settings", action: "settings", target: "battery" });
        break;
      }
      case "battery-health": {
        const b = v.battery || {};
        if (!b.present || b.health_percent == null) {
          r.text = phone ? playbookSummary(c.platform, 1) : "This device doesn't report battery wear" + (agent ? "." : " to the browser.");
          if (!agent) needAgent();
          break;
        }
        r.text = "Your battery holds **" + b.health_percent.toFixed(0) + "%** of its design capacity (" + b.full_capacity + " of " + b.design_capacity + ")" + (b.cycles ? " after **" + b.cycles + " cycles**" : "") + ". Condition: **" + b.condition + "**." +
          (c.forecast && c.forecast.message ? "\n\n" + c.forecast.message : "") +
          (b.health_percent < 80 ? "\n\nNo software can restore lost capacity. What helps now: keep it between 20–80%, avoid heat, and plan a replacement if runtime is too short." : "\n\nTo slow wear: avoid sitting at 100% for days and keep it cool.");
        r.chips.push({ label: "Charging tips", action: "say", text: "how do I preserve my battery" });
        r.chips.push({ label: "Open Battery", action: "view", view: "battery" });
        break;
      }
      case "charging": {
        r.text = "Lithium batteries wear fastest when **full and warm**. The three habits that matter:\n- Keep charge between about 20% and 80% when you can.\n- Turn on your system's charge limit or optimized charging.\n- Avoid heat: don't charge under a pillow or in a hot car.\n\nDraining to 0% to 'calibrate' is a myth for modern batteries — it only adds wear.";
        const where = { mac: "System Settings › Battery › Battery Health › Optimized Battery Charging", windows: "your laptop maker's app (Lenovo Vantage, MyASUS, Dell Power Manager, Surface Smart Charging)", iphone: "Settings › Battery › Battery Health & Charging", android: "Settings › Battery › Protect battery / Adaptive charging (name varies by maker)" }[c.platform];
        if (where) r.text += "\n\nOn this device: **" + where + "**.";
        if (agent && c.platform !== "iphone" && c.platform !== "android") r.chips.push({ label: "Open battery settings", action: "settings", target: "battery" });
        break;
      }
      case "ram-myth": {
        r.text = "Honest answer: **RAM cleaners and boosters don't make devices faster.** Free memory is wasted memory — the system keeps recently used apps in RAM so they open instantly. Force-clearing it just makes the next launch slower, and on phones the system restarts killed apps, which costs battery.\n\nWhat actually helps when memory is tight: close the one app that is genuinely heavy." + (agent && v.memory ? "\n\nRight now memory pressure is **" + v.memory.pressure + "**." : "");
        if (agent) {
          const hog = topBy(c.processes, "rss", 1)[0];
          if (hog && hog.owned) r.chips.push({ label: "Quit " + hog.name + " (" + fmtBytes(hog.rss) + ")", action: "quit", pid: hog.pid, name: hog.name });
        }
        break;
      }
      case "quit": {
        if (!agent || c.mode === "demo" && !c.processes) {
          r.text = "I can only close apps when the local agent is running.";
          needAgent();
          break;
        }
        const f = findProcess(t, c.processes);
        if (!f || !f.match) {
          r.text = "I couldn't find a running app called \"" + (f ? f.name : "that") + "\".";
          r.chips.push({ label: "Show running apps", action: "view", view: "performance" });
          break;
        }
        const p = f.match;
        if (p.protected || !p.owned) {
          r.text = "**" + p.name + "** is part of the system or another user — I won't touch it.";
          break;
        }
        r.text = "Found **" + p.name + "** (pid " + p.pid + ", " + (p.cpu != null ? Math.round(p.cpu) + "% CPU, " : "") + fmtBytes(p.rss) + "). I'll ask it to quit normally, so it can still prompt you to save work.";
        r.chips.push({ label: "Quit " + p.name, action: "quit", pid: p.pid, name: p.name, primary: true });
        break;
      }
      case "undo": {
        const last = (c.vault || [])[0];
        if (!agent || !last) {
          r.text = agent ? "The Undo Vault is empty — nothing to restore." : "Undo works on cleanups done through the local agent.";
          break;
        }
        r.text = "Your latest cleanup — **" + last.label + "**, " + last.count + " item(s), " + fmtBytes(last.bytes) + " — is still in the vault. Restoring puts every item back exactly where it was.";
        r.chips.push({ label: "Restore it", action: "restore", batch: last.id, primary: true });
        r.chips.push({ label: "Open vault", action: "view", view: "vault" });
        break;
      }
      case "grew": {
        if (!agent) { r.text = "Growth tracking compares folder sizes between scans on your computer."; needAgent(); break; }
        if (!scan || !scan.growth || !scan.growth.length) {
          r.text = "I track folder sizes every time you scan. Run a scan now; next time I'll show exactly what grew.";
          r.chips.push({ label: "Scan now", action: "scan", primary: true });
          break;
        }
        const movers = scan.growth.filter((g) => g.delta != null);
        if (!movers.length) {
          r.text = "This is the first snapshot, so here are your biggest folders:\n" + scan.growth.slice(0, 6).map((g) => "- " + shortPath(g.path) + " — " + fmtBytes(g.bytes)).join("\n") + "\n\nScan again in a few days and I'll show what changed.";
        } else {
          r.text = "Since the last scan:\n" + movers.slice(0, 6).map((g) => "- " + shortPath(g.path) + " " + (g.delta >= 0 ? "**+" : "**") + fmtBytes(g.delta) + "** (now " + fmtBytes(g.bytes) + ")").join("\n");
        }
        r.chips.push({ label: "Open Clean", action: "view", view: "clean" });
        break;
      }
      case "large": {
        if (!agent) { needAgent(); break; }
        if (!scan) { r.text = "Run a scan and I'll list your largest files."; r.chips.push({ label: "Scan now", action: "scan", primary: true }); break; }
        const big = (scan.large_files || []).slice(0, 6);
        r.text = big.length ? "Your largest files:\n" + big.map((f) => "- " + shortPath(f.path) + " — " + fmtBytes(f.bytes)).join("\n") + "\n\nThese are your own files, so I never pick them automatically." : "No single file over 200 MB in your folders.";
        r.chips.push({ label: "Review in Clean", action: "view", view: "clean" });
        break;
      }
      case "duplicates": {
        if (!agent) { needAgent(); break; }
        if (!scan) { r.text = "Run a scan and I'll find byte-for-byte duplicates."; r.chips.push({ label: "Scan now", action: "scan", primary: true }); break; }
        const g = scan.duplicates || [];
        r.text = g.length ? "Found **" + g.length + "** sets of identical files wasting **" + fmtBytes(scan.duplicate_waste) + "**. I compare full content hashes, not names, and keep the oldest copy." : "No duplicate files over 1 MB found.";
        if (g.length) r.chips.push({ label: "Review duplicates", action: "view", view: "clean" });
        break;
      }
      case "startup": {
        if (!agent) { needAgent(); break; }
        const n = (c.startup || []).length;
        r.text = n ? "**" + n + "** items start automatically. The list is in Performance; disable the ones you don't need in system settings (Vitals only reads this list)." : "Open Performance to load your startup items.";
        r.chips.push({ label: "See startup items", action: "view", view: "performance" });
        r.chips.push({ label: "Open login settings", action: "settings", target: "startup" });
        break;
      }
      case "iphone":
      case "android": {
        const pb = PLAYBOOKS[intent];
        const which = /battery|drain|charg/.test(t) ? 1 : /slow|lag|fast|speed/.test(t) && pb.sections[2] ? 2 : 0;
        r.text = pb.intro + "\n\n" + playbookSummary(intent, which);
        r.chips.push({ label: "Open " + pb.name + " guide", action: "guide", platform: intent });
        break;
      }
      case "privacy": {
        r.text = "Vitals is **local-only**: the agent listens on 127.0.0.1, stores history in a SQLite file on your machine (`~/.vitals`), and never phones home — no account, no telemetry, no ads. The optional AI fallback only talks to a model on *this* computer (Ollama). The code is open source, so you can check every line.";
        break;
      }
      case "safe": {
        r.text = "Every item has a grade:\n- **Safe** — caches, logs and build data that apps recreate automatically. Worst case: an app opens a bit slower once.\n- **Review** — things only you can judge (old downloads, device backups, idle projects' node_modules). Never auto-selected.\n\nAnd nothing is deleted outright by default: cleanups go to the **Undo Vault** for 72 hours with one-click restore.";
        break;
      }
      default: {
        r.text = "";
        r.fallback = true;
        r.text = "I'm not sure I understood. I'm best at: freeing space toward a goal, explaining slowness or heat, battery drain and health, undoing a cleanup, and phone guides.";
        r.chips = [
          { label: "Check my device", action: "say", text: "how is my device" },
          { label: "Free 5 GB", action: "say", text: "free 5 GB" },
          { label: "Battery drain", action: "say", text: "why does my battery drain" },
        ];
      }
    }
    return r;
  }

  function actionChip(a) {
    if (a.type === "quit") return { label: a.label, action: "quit", pid: a.pid, name: a.name };
    if (a.type === "view") return { label: a.label, action: "view", view: a.view };
    if (a.type === "scan") return { label: a.label, action: "scan" };
    if (a.type === "clean-safe") return { label: a.label, action: "clean-safe" };
    return { label: a.label, action: a.type };
  }

  function playbookSummary(platform, sectionIndex) {
    const pb = PLAYBOOKS[platform];
    if (!pb || !pb.sections[sectionIndex]) return "";
    const s = pb.sections[sectionIndex];
    return "**" + s.title + "** on " + pb.name + ":\n" + s.items.slice(0, 4).map((i) => "- " + i.t + " — `" + i.path + "`").join("\n");
  }

  function shortPath(p) {
    if (!p) return "";
    return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~").replace(/^[A-Z]:\\Users\\[^\\]+/i, "~");
  }

  function detectPlatform(ua, platformHint, touchPoints) {
    const u = (ua || "").toLowerCase();
    if (/iphone|ipod/.test(u)) return "iphone";
    if (/ipad/.test(u) || (/macintosh/.test(u) && touchPoints > 1)) return "iphone";
    if (/android/.test(u)) return "android";
    if (/windows/.test(u)) return "windows";
    if (/mac os|macintosh/.test(u)) return "mac";
    if (/linux|cros/.test(u)) return "linux";
    return "unknown";
  }

  root.VitalsBrain = {
    GB, MB, fmtBytes, fmtDuration, healthScore, systemLevels, recommendations, planGoal, parseExclusions,
    parseSize, detectIntent, respond, findProcess, PLAYBOOKS, shortPath, detectPlatform,
  };
})(typeof window !== "undefined" ? window : globalThis);
