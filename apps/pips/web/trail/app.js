/* Pips Phone Trail - page logic (manual entry from Screen Time / Digital Wellbeing). */
(function () {
  "use strict";

  const STRINGS = {
    en: {
      title: "Phone Trail", subtitle: "Your phone screen time as a route", day: "Day",
      saved: "saved on this phone", date: "Date", pickups: "Pickups", window: "Window",
      apps: "Apps you used", fromScreenTime: "copy from Screen Time / Digital Wellbeing",
      colApp: "App", colHour: "Hour", colMin: "Minutes", colType: "Type", add: "+ Add app",
      sample: "Try a sample day", clear: "Clear", productive: "Productive", neutral: "Neutral",
      distracting: "Distracting", tapDot: "tap a dot to change", sticker: "Sticker",
      bgClear: "Clear background", bgDark: "Dark background",
      how1: "Direction = time of day: the trail turns clockwise from morning to night.",
      how2: "Long straight strides = productive apps. Short steps = neutral.",
      how3: "Kinks = switching apps. Loops = distracting apps (going in circles).",
      share: "Share", save: "Save image", empty: "Tap an app above or + Add app",
      screen: "Screen time", pickupsCol: "Pickups", noData: "No phone time yet",
      keyStraight: "straight = one app", keyKinks: "kinks = switching", keyLoops: "loops = distracting",
      top: "top: {app}", savedToast: "Saved", copied: "Image copied", clearConfirm: "Clear this day?",
      appPlaceholder: "App name",
      autoTitle: "Automatic", autoHint: "no typing", autoGet: "Download Android app",
      autoAndroid: "Android: get the app. It reads your screen time by itself and keeps a trail for every day.",
      autoStep1: "Open the download and tap Install (allow installs from your browser once).",
      autoStep2: "In Phone Trail tap Open settings and switch on Usage access.",
      autoStep3: "Done: your trail fills in by itself. Tap an app to change its type.",
      autoIos: "iPhone: Apple only gives Screen Time data to apps from the App Store or TestFlight, so here you copy your times from Settings > Screen Time > See All App & Website Activity.",
    },
    id: {
      title: "Jejak HP", subtitle: "Screen time HP kamu jadi rute", day: "Hari",
      saved: "tersimpan di HP ini", date: "Tanggal", pickups: "Buka HP", window: "Jam",
      apps: "Aplikasi yang dipakai", fromScreenTime: "salin dari Screen Time / Digital Wellbeing",
      colApp: "Aplikasi", colHour: "Jam", colMin: "Menit", colType: "Jenis", add: "+ Tambah",
      sample: "Coba contoh", clear: "Hapus", productive: "Produktif", neutral: "Netral",
      distracting: "Mengganggu", tapDot: "ketuk titik untuk ganti", sticker: "Stiker",
      bgClear: "Latar transparan", bgDark: "Latar gelap",
      how1: "Arah = waktu: jejak berbelok searah jarum jam dari pagi ke malam.",
      how2: "Langkah panjang lurus = aplikasi produktif. Langkah pendek = netral.",
      how3: "Tikungan = ganti aplikasi. Putaran = aplikasi mengganggu (muter-muter).",
      share: "Bagikan", save: "Simpan gambar", empty: "Ketuk aplikasi di atas atau + Tambah",
      screen: "Screen time", pickupsCol: "Buka HP", noData: "Belum ada data",
      keyStraight: "lurus = satu aplikasi", keyKinks: "tikungan = ganti", keyLoops: "putaran = mengganggu",
      top: "top: {app}", savedToast: "Tersimpan", copied: "Gambar disalin", clearConfirm: "Hapus hari ini?",
      appPlaceholder: "Nama aplikasi",
      autoTitle: "Otomatis", autoHint: "tanpa mengetik", autoGet: "Unduh aplikasi Android",
      autoAndroid: "Android: pakai aplikasinya. Screen time kamu dibaca otomatis dan jejaknya tersimpan setiap hari.",
      autoStep1: "Buka file unduhan lalu ketuk Instal (izinkan instalasi dari browser sekali saja).",
      autoStep2: "Di Phone Trail ketuk Buka pengaturan lalu aktifkan Akses penggunaan.",
      autoStep3: "Selesai: jejak kamu terisi sendiri. Ketuk aplikasi untuk mengganti jenisnya.",
      autoIos: "iPhone: Apple hanya memberi data Screen Time ke aplikasi dari App Store atau TestFlight, jadi di sini salin waktumu dari Pengaturan > Durasi Layar > Lihat Semua Aktivitas App & Situs Web.",
    },
    zh_TW: {
      title: "手機軌跡", subtitle: "把手機螢幕使用時間畫成路線", day: "日期",
      saved: "儲存在這支手機", date: "日期", pickups: "拿起次數", window: "時段",
      apps: "使用的 App", fromScreenTime: "從「螢幕使用時間」/ 數位健康抄過來",
      colApp: "App", colHour: "時", colMin: "分鐘", colType: "類型", add: "+ 新增",
      sample: "看範例", clear: "清除", productive: "有生產力", neutral: "一般",
      distracting: "分心", tapDot: "點圓點切換", sticker: "貼紙",
      bgClear: "透明背景", bgDark: "深色背景",
      how1: "方向 = 時間：軌跡從早到晚順時針轉。",
      how2: "長直線 = 有生產力的 App，短步 = 一般。",
      how3: "轉折 = 切換 App，繞圈 = 分心的 App。",
      share: "分享", save: "儲存圖片", empty: "點上面的 App 或「+ 新增」",
      screen: "螢幕時間", pickupsCol: "拿起次數", noData: "還沒有資料",
      keyStraight: "直線 = 同一個 App", keyKinks: "轉折 = 切換", keyLoops: "繞圈 = 分心",
      top: "最多：{app}", savedToast: "已儲存", copied: "已複製圖片", clearConfirm: "清除這一天？",
      appPlaceholder: "App 名稱",
      autoTitle: "自動", autoHint: "免輸入", autoGet: "下載 Android App",
      autoAndroid: "Android：安裝 App，自動讀取螢幕使用時間，每天都會留下軌跡。",
      autoStep1: "開啟下載的檔案並點「安裝」（第一次需允許從瀏覽器安裝）。",
      autoStep2: "在 Phone Trail 點「開啟設定」，開啟「使用情形存取權」。",
      autoStep3: "完成：軌跡會自動產生。點 App 可以切換類型。",
      autoIos: "iPhone：Apple 只把螢幕使用時間資料提供給 App Store 或 TestFlight 的 App，所以請從「設定 > 螢幕使用時間 > 查看所有 App 與網站活動」抄下時間。",
    },
    zh_CN: {
      title: "手机轨迹", subtitle: "把手机屏幕使用时间画成路线", day: "日期",
      saved: "保存在这部手机", date: "日期", pickups: "拿起次数", window: "时段",
      apps: "使用的 App", fromScreenTime: "从「屏幕使用时间」/ 数字健康抄过来",
      colApp: "App", colHour: "时", colMin: "分钟", colType: "类型", add: "+ 添加",
      sample: "看示例", clear: "清除", productive: "有效率", neutral: "一般",
      distracting: "分心", tapDot: "点圆点切换", sticker: "贴纸",
      bgClear: "透明背景", bgDark: "深色背景",
      how1: "方向 = 时间：轨迹从早到晚顺时针转。",
      how2: "长直线 = 有效率的 App，短步 = 一般。",
      how3: "转折 = 切换 App，绕圈 = 分心的 App。",
      share: "分享", save: "保存图片", empty: "点上面的 App 或「+ 添加」",
      screen: "屏幕时间", pickupsCol: "拿起次数", noData: "还没有数据",
      keyStraight: "直线 = 同一个 App", keyKinks: "转折 = 切换", keyLoops: "绕圈 = 分心",
      top: "最多：{app}", savedToast: "已保存", copied: "已复制图片", clearConfirm: "清除这一天？",
      appPlaceholder: "App 名称",
      autoTitle: "自动", autoHint: "免输入", autoGet: "下载 Android App",
      autoAndroid: "Android：安装 App，自动读取屏幕使用时间，每天都会留下轨迹。",
      autoStep1: "打开下载的文件并点“安装”（第一次需允许从浏览器安装）。",
      autoStep2: "在 Phone Trail 点“打开设置”，开启“使用情况访问权限”。",
      autoStep3: "完成：轨迹会自动生成。点 App 可以切换类型。",
      autoIos: "iPhone：Apple 只把屏幕使用时间数据提供给 App Store 或 TestFlight 的 App，所以请从“设置 > 屏幕使用时间 > 查看所有 App 与网站活动”抄下时间。",
    },
  };

  const ACCENTS = ["#D0484C", "#FC4C02", "#B6FF3B", "#22D3EE", "#FF4FA3", "#8B5CF6", "#FFFFFF"];
  const QUICK_APPS = ["Instagram", "TikTok", "YouTube", "WhatsApp", "LINE", "Chrome", "Gmail",
    "Teams", "Slack", "Notion", "Maps", "Spotify", "Duolingo", "Kindle", "X", "Facebook"];
  const CYCLE = { productive: "neutral", neutral: "distracting", distracting: "productive" };
  const SAMPLE = [
    [7, "Gmail", 10, "productive"], [7, "Instagram", 7, "distracting"], [7, "WhatsApp", 5, "neutral"],
    [8, "Spotify", 15, "neutral"], [8, "Maps", 10, "neutral"], [9, "Teams", 8, "productive"],
    [9, "Slack", 6, "productive"], [10, "Notion", 20, "productive"], [12, "TikTok", 25, "distracting"],
    [12, "LINE", 7, "neutral"], [12, "Instagram", 5, "distracting"], [13, "Outlook", 9, "productive"],
    [13, "Calendar", 2, "productive"], [15, "YouTube", 10, "distracting"], [15, "Chrome", 5, "neutral"],
    [17, "Duolingo", 15, "productive"], [18, "WhatsApp", 10, "neutral"], [18, "Maps", 8, "neutral"],
    [18, "Spotify", 5, "neutral"], [20, "YouTube", 30, "distracting"], [20, "Netflix", 20, "distracting"],
    [21, "Kindle", 25, "productive"], [21, "Instagram", 4, "distracting"], [22, "TikTok", 15, "distracting"],
    [22, "WhatsApp", 3, "neutral"],
  ];

  const $ = (id) => document.getElementById(id);
  const store = window.localStorage;
  let lang = store.getItem("pt.lang") || detectLang();
  let prefs = JSON.parse(store.getItem("pt.prefs") || "{}");
  prefs = Object.assign({ accent: ACCENTS[0], bg: "transparent", start: 7, end: 23 }, prefs);
  let userCats = JSON.parse(store.getItem("pt.cats") || "{}");
  let day = todayIso();
  let state = loadDay(day);

  function detectLang() {
    const n = (navigator.language || "en").toLowerCase();
    if (n.startsWith("id")) return "id";
    if (n.startsWith("zh")) return /tw|hk|hant/.test(n) ? "zh_TW" : "zh_CN";
    return "en";
  }
  function t(key) {
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  }
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function loadDay(iso) {
    return JSON.parse(store.getItem("pt.day." + iso) || '{"entries":[],"pickups":""}');
  }
  function saveDay() {
    store.setItem("pt.day." + day, JSON.stringify(state));
  }
  function savePrefs() {
    store.setItem("pt.prefs", JSON.stringify(prefs));
  }

  function categoryFor(app) {
    const key = (app || "").trim().toLowerCase();
    if (userCats[key]) return userCats[key];
    const table = (window.PIPS_CATEGORIES && window.PIPS_CATEGORIES.apps) || {};
    return table[key] || "neutral";
  }

  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1600);
  }

  function applyLanguage() {
    document.documentElement.lang = lang.replace("_", "-");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    $("lang").value = lang;
  }

  function hourOptions(select, from, to, value) {
    select.innerHTML = "";
    for (let h = from; h <= to; h++) {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = String(h).padStart(2, "0") + ":00";
      if (h === value) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function defaultHour() {
    const now = new Date().getHours();
    return Math.min(prefs.end - 1, Math.max(prefs.start, now));
  }

  function renderChips() {
    const box = $("chips");
    box.innerHTML = "";
    for (const app of QUICK_APPS) {
      const b = document.createElement("button");
      b.className = "chip " + categoryFor(app);
      b.textContent = "+ " + app;
      b.onclick = () => {
        state.entries.push({ app, hour: defaultHour(), minutes: 15, category: categoryFor(app) });
        commit();
      };
      box.appendChild(b);
    }
  }

  function renderEntries() {
    const box = $("entries");
    box.innerHTML = "";
    if (!state.entries.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("empty");
      box.appendChild(p);
      return;
    }
    state.entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "entry";

      const app = document.createElement("input");
      app.className = "app";
      app.value = entry.app;
      app.placeholder = t("appPlaceholder");
      app.onchange = () => {
        entry.app = app.value.trim();
        entry.category = categoryFor(entry.app);
        commit();
      };

      const hour = document.createElement("select");
      hourOptions(hour, prefs.start, prefs.end - 1, Number(entry.hour));
      hour.onchange = () => {
        entry.hour = Number(hour.value);
        commit(false);
      };

      const minutes = document.createElement("input");
      minutes.className = "min";
      minutes.type = "number";
      minutes.min = "1";
      minutes.max = "60";
      minutes.inputMode = "numeric";
      minutes.value = entry.minutes;
      minutes.oninput = () => {
        entry.minutes = Math.max(0, Math.min(60, Number(minutes.value) || 0));
        commit(false);
      };

      const cat = document.createElement("button");
      cat.className = "cat " + entry.category;
      cat.title = t(entry.category);
      cat.onclick = () => {
        entry.category = CYCLE[entry.category] || "neutral";
        if (entry.app) {
          userCats[entry.app.trim().toLowerCase()] = entry.category;
          store.setItem("pt.cats", JSON.stringify(userCats));
          state.entries.forEach((e) => {
            if (e.app.trim().toLowerCase() === entry.app.trim().toLowerCase()) e.category = entry.category;
          });
        }
        commit();
      };

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.onclick = () => {
        state.entries.splice(index, 1);
        commit();
      };
      row.append(app, hour, minutes, cat, del);
      box.appendChild(row);
    });
  }

  function labels() {
    return {
      screen: t("screen"), productive: t("productive"), pickups: t("pickupsCol"), noData: t("noData"),
      neutral: t("neutral"), distracting: t("distracting"), keyStraight: t("keyStraight"),
      keyKinks: t("keyKinks"), keyLoops: t("keyLoops"), top: t("top"),
    };
  }

  function stickerTitle() {
    const d = new Date(day + "T12:00:00");
    const locale = { en: "en-GB", id: "id-ID", zh_TW: "zh-TW", zh_CN: "zh-CN" }[lang];
    const dateText = d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
    return `${dateText}  ·  ${String(prefs.start).padStart(2, "0")}:00-${String(prefs.end).padStart(2, "0")}:00`;
  }

  function renderSticker() {
    const hours = PipsTrail.hoursFromEntries(state.entries, prefs.start, prefs.end);
    PipsTrail.renderSticker($("canvas"), {
      hours, startHour: prefs.start, endHour: prefs.end, pickups: Number(state.pickups) || 0,
      accent: prefs.accent, background: prefs.bg, title: stickerTitle(), labels: labels(),
    });
  }

  function renderSwatches() {
    const box = $("swatches");
    box.innerHTML = "";
    for (const color of ACCENTS) {
      const s = document.createElement("button");
      s.className = "sw" + (color === prefs.accent ? " on" : "");
      s.style.background = color;
      s.onclick = () => {
        prefs.accent = color;
        savePrefs();
        document.documentElement.style.setProperty("--accent", color);
        document.documentElement.style.setProperty("--prod", color);
        renderSwatches();
        renderSticker();
      };
      box.appendChild(s);
    }
  }

  function commit(rebuildRows = true) {
    saveDay();
    if (rebuildRows) {
      renderEntries();
      renderChips();
    }
    renderSticker();
  }

  function canvasBlob() {
    return new Promise((resolve) => $("canvas").toBlob(resolve, "image/png"));
  }

  async function share() {
    const blob = await canvasBlob();
    const file = new File([blob], `pips-phone-trail-${day}.png`, { type: "image/png" });
    const sum = PipsTrail.summarize(PipsTrail.hoursFromEntries(state.entries, prefs.start, prefs.end));
    const textLine = `${t("screen")} ${PipsTrail.fmtDuration(sum.screen)} · ${t("productive")} ${PipsTrail.fmtDuration(sum.productive)} #PipsTrail`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: textLine });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast(t("copied"));
        return;
      } catch (err) {
        /* fall through to download */
      }
    }
    download(blob);
  }

  function download(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pips-phone-trail-${day}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t("savedToast"));
  }

  function detectPlatform() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) {
      return "android";
    }
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
      return "ios";
    }
    return "other";
  }

  function init() {
    const platform = detectPlatform();
    if (platform !== "other") {
      document.body.classList.add("is-" + platform);
    }
    applyLanguage();
    document.documentElement.style.setProperty("--accent", prefs.accent);
    document.documentElement.style.setProperty("--prod", prefs.accent);
    $("date").value = day;
    $("pickups").value = state.pickups || "";
    $("bg").value = prefs.bg;
    hourOptions($("start"), 0, 22, prefs.start);
    hourOptions($("end"), 1, 24, prefs.end);

    $("lang").onchange = () => {
      lang = $("lang").value;
      store.setItem("pt.lang", lang);
      applyLanguage();
      commit();
    };
    $("date").onchange = () => {
      day = $("date").value || todayIso();
      state = loadDay(day);
      $("pickups").value = state.pickups || "";
      commit();
    };
    $("pickups").oninput = () => {
      state.pickups = $("pickups").value;
      commit(false);
    };
    $("start").onchange = () => {
      prefs.start = Math.min(Number($("start").value), prefs.end - 1);
      savePrefs();
      commit();
    };
    $("end").onchange = () => {
      prefs.end = Math.max(Number($("end").value), prefs.start + 1);
      savePrefs();
      commit();
    };
    $("bg").onchange = () => {
      prefs.bg = $("bg").value;
      savePrefs();
      renderSticker();
    };
    $("add").onclick = () => {
      state.entries.push({ app: "", hour: defaultHour(), minutes: 10, category: "neutral" });
      commit();
      const inputs = document.querySelectorAll(".entry input.app");
      if (inputs.length) inputs[inputs.length - 1].focus();
    };
    $("sample").onclick = () => {
      state.entries = SAMPLE.map(([hour, app, minutes, category]) => ({ app, hour, minutes, category }));
      state.pickups = "63";
      $("pickups").value = "63";
      commit();
    };
    $("clear").onclick = () => {
      if (!state.entries.length || confirm(t("clearConfirm"))) {
        state = { entries: [], pickups: "" };
        $("pickups").value = "";
        commit();
      }
    };
    $("share").onclick = share;
    $("save").onclick = async () => download(await canvasBlob());

    renderSwatches();
    commit();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (new URLSearchParams(location.search).has("sample")) {
      $("sample").click();
    }
  }

  init();
})();
