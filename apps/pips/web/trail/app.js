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
      importBtn: "From screenshot", importChoose: "Choose screenshot", importApply: "Add to my day",
      importHow: "Take a screenshot of Settings > Screen Time > See All App & Website Activity (Android: Digital Wellbeing), then choose it here.",
      importPaste: "...or paste the text here (iPhone: open the screenshot in Photos, press and hold the text, Select All, Copy)",
      importNote: "Screen Time only shows a total per app, so the hours are a guess you can change. Tip: tap one hour bar in Screen Time, screenshot it and pick that hour above.",
      importSpread: "Spread over my day ({start}-{end})", importAt: "All in {hour}",
      importLoading: "Reading the screenshot on this phone... (first time downloads about 7 MB)",
      importReading: "Reading... {pct}%", importFound: "Found {n} apps, {time}. Check the text, then tap Add to my day.",
      importNone: "No app times found. Check the text or paste it instead.", importAdded: "Added {n} apps",
      importFailed: "Could not read the screenshot here. Paste the text instead (see the box below).",
      importReplace: "Replace the apps already on this day?",
      autoTitle: "Automatic", autoHint: "no typing", autoGet: "Download Android app",
      autoAndroid: "Android: get the app. It reads your screen time by itself and keeps a trail for every day.",
      autoStep1: "Open the download and tap Install (allow installs from your browser once).",
      autoStep2: "In Phone Trail tap Open settings and switch on Usage access.",
      autoStep3: "Done: your trail fills in by itself. Tap an app to change its type.",
      autoIos: "iPhone: Apple keeps Screen Time data for App Store apps only. Free way: take a screenshot of Settings > Screen Time > See All App & Website Activity and tap From screenshot below.",
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
      importBtn: "Dari screenshot", importChoose: "Pilih screenshot", importApply: "Tambahkan ke hariku",
      importHow: "Ambil screenshot Pengaturan > Durasi Layar > Lihat Semua Aktivitas App & Situs Web (Android: Digital Wellbeing), lalu pilih di sini.",
      importPaste: "...atau tempel teksnya di sini (iPhone: buka screenshot di Foto, tekan lama teksnya, Pilih Semua, Salin)",
      importNote: "Durasi Layar hanya menunjukkan total per aplikasi, jadi jamnya tebakan yang bisa kamu ubah. Tips: ketuk satu batang jam di Durasi Layar, screenshot, lalu pilih jam itu di atas.",
      importSpread: "Sebar di hariku ({start}-{end})", importAt: "Semua di jam {hour}",
      importLoading: "Membaca screenshot di HP ini... (pertama kali mengunduh sekitar 7 MB)",
      importReading: "Membaca... {pct}%", importFound: "Ketemu {n} aplikasi, {time}. Cek teksnya, lalu ketuk Tambahkan ke hariku.",
      importNone: "Tidak ada waktu aplikasi. Cek teksnya atau tempel saja.", importAdded: "{n} aplikasi ditambahkan",
      importFailed: "Screenshot tidak bisa dibaca di sini. Tempel teksnya saja (lihat kotak di bawah).",
      importReplace: "Ganti aplikasi yang sudah ada di hari ini?",
      autoTitle: "Otomatis", autoHint: "tanpa mengetik", autoGet: "Unduh aplikasi Android",
      autoAndroid: "Android: pakai aplikasinya. Screen time kamu dibaca otomatis dan jejaknya tersimpan setiap hari.",
      autoStep1: "Buka file unduhan lalu ketuk Instal (izinkan instalasi dari browser sekali saja).",
      autoStep2: "Di Phone Trail ketuk Buka pengaturan lalu aktifkan Akses penggunaan.",
      autoStep3: "Selesai: jejak kamu terisi sendiri. Ketuk aplikasi untuk mengganti jenisnya.",
      autoIos: "iPhone: data Durasi Layar hanya untuk aplikasi App Store. Cara gratis: screenshot Pengaturan > Durasi Layar > Lihat Semua Aktivitas App & Situs Web, lalu ketuk Dari screenshot di bawah.",
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
      importBtn: "從截圖匯入", importChoose: "選擇截圖", importApply: "加入今天",
      importHow: "截圖「設定 > 螢幕使用時間 > 查看所有 App 與網站活動」（Android：數位健康），然後在這裡選擇。",
      importPaste: "……或把文字貼在這裡（iPhone：在「照片」打開截圖，長按文字，全選，拷貝）",
      importNote: "螢幕使用時間只顯示每個 App 的總時間，所以時段是猜的，可以自己改。小技巧：在螢幕使用時間點一個小時的長條，截圖後在上面選那個小時。",
      importSpread: "平均分配到我的時段（{start}-{end}）", importAt: "全部在 {hour}",
      importLoading: "正在這支手機上讀取截圖……（第一次會下載約 7 MB）",
      importReading: "讀取中…… {pct}%", importFound: "找到 {n} 個 App，共 {time}。確認文字後點「加入今天」。",
      importNone: "沒有找到 App 時間。請檢查文字或直接貼上。", importAdded: "已加入 {n} 個 App",
      importFailed: "這裡無法讀取截圖。請改為貼上文字（見下方方框）。",
      importReplace: "要取代這一天已有的 App 嗎？",
      autoTitle: "自動", autoHint: "免輸入", autoGet: "下載 Android App",
      autoAndroid: "Android：安裝 App，自動讀取螢幕使用時間，每天都會留下軌跡。",
      autoStep1: "開啟下載的檔案並點「安裝」（第一次需允許從瀏覽器安裝）。",
      autoStep2: "在 Phone Trail 點「開啟設定」，開啟「使用情形存取權」。",
      autoStep3: "完成：軌跡會自動產生。點 App 可以切換類型。",
      autoIos: "iPhone：螢幕使用時間資料只開放給 App Store 的 App。免費做法：截圖「設定 > 螢幕使用時間 > 查看所有 App 與網站活動」，再點下方的「從截圖匯入」。",
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
      importBtn: "从截图导入", importChoose: "选择截图", importApply: "加入今天",
      importHow: "截图“设置 > 屏幕使用时间 > 查看所有 App 与网站活动”（Android：数字健康），然后在这里选择。",
      importPaste: "……或把文字粘贴到这里（iPhone：在“照片”打开截图，长按文字，全选，拷贝）",
      importNote: "屏幕使用时间只显示每个 App 的总时间，所以时段是估计的，可以自己改。小技巧：在屏幕使用时间点一个小时的柱子，截图后在上面选那个小时。",
      importSpread: "平均分配到我的时段（{start}-{end}）", importAt: "全部在 {hour}",
      importLoading: "正在这部手机上读取截图……（第一次会下载约 7 MB）",
      importReading: "读取中…… {pct}%", importFound: "找到 {n} 个 App，共 {time}。确认文字后点“加入今天”。",
      importNone: "没有找到 App 时间。请检查文字或直接粘贴。", importAdded: "已加入 {n} 个 App",
      importFailed: "这里无法读取截图。请改为粘贴文字（见下方方框）。",
      importReplace: "要替换这一天已有的 App 吗？",
      autoTitle: "自动", autoHint: "免输入", autoGet: "下载 Android App",
      autoAndroid: "Android：安装 App，自动读取屏幕使用时间，每天都会留下轨迹。",
      autoStep1: "打开下载的文件并点“安装”（第一次需允许从浏览器安装）。",
      autoStep2: "在 Phone Trail 点“打开设置”，开启“使用情况访问权限”。",
      autoStep3: "完成：轨迹会自动生成。点 App 可以切换类型。",
      autoIos: "iPhone：屏幕使用时间数据只开放给 App Store 的 App。免费做法：截图“设置 > 屏幕使用时间 > 查看所有 App 与网站活动”，再点下方的“从截图导入”。",
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
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    if ($("importWhen")) {
      importWhenOptions();
    }
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

  // ---- Import from a Screen Time / Digital Wellbeing screenshot (read on the phone, nothing uploaded) ----
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const OCR_LANGS = { en: "eng", id: "eng", zh_TW: "chi_tra+eng", zh_CN: "chi_sim+eng" };

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? values[key] : ""));
  }

  function hh(hour) {
    return String(hour).padStart(2, "0") + ":00";
  }

  function importWhenOptions() {
    const select = $("importWhen");
    const previous = select.value || "spread";
    select.innerHTML = "";
    const spread = document.createElement("option");
    spread.value = "spread";
    spread.textContent = fill(t("importSpread"), { start: hh(prefs.start), end: hh(prefs.end) });
    select.appendChild(spread);
    for (let h = prefs.start; h < prefs.end; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = fill(t("importAt"), { hour: hh(h) });
      select.appendChild(opt);
    }
    select.value = [...select.options].some((o) => o.value === previous) ? previous : "spread";
  }

  function importStatus(message) {
    $("importStatus").textContent = message || "";
  }

  function previewImport() {
    const parsed = PipsImport.parseUsageText($("importText").value);
    if (!parsed.apps.length) {
      importStatus(t("importNone"));
      return parsed;
    }
    const minutes = parsed.apps.reduce((sum, a) => sum + a.minutes, 0);
    importStatus(fill(t("importFound"), { n: parsed.apps.length, time: PipsTrail.fmtDuration(minutes * 60) }));
    return parsed;
  }

  function loadOcr() {
    if (window.Tesseract) {
      return Promise.resolve(window.Tesseract);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = OCR_SCRIPT;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Greyscale, dark mode -> light, small screenshots enlarged: helps OCR a lot.
  async function prepareImage(file) {
    const bitmap = await createImageBitmap(file);
    const scale = bitmap.width < 1000 ? 2 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = grey;
      sum += grey;
    }
    if (sum / (px.length / 4) < 110) {
      for (let i = 0; i < px.length; i += 4) {
        px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  async function readScreenshot(file) {
    importStatus(t("importLoading"));
    let worker = null;
    try {
      const Tesseract = await loadOcr();
      const canvas = await prepareImage(file);
      worker = await Tesseract.createWorker(OCR_LANGS[lang] || "eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            importStatus(fill(t("importReading"), { pct: Math.round(m.progress * 100) }));
          }
        },
      });
      const result = await worker.recognize(canvas);
      $("importText").value = result.data.text.trim();
      previewImport();
    } catch (err) {
      importStatus(t("importFailed"));
    } finally {
      if (worker) {
        worker.terminate().catch(() => {});
      }
    }
  }

  function applyImport() {
    const parsed = previewImport();
    if (!parsed.apps.length) {
      return;
    }
    const when = $("importWhen").value;
    const options = { startHour: prefs.start, endHour: prefs.end };
    let placed;
    if (when === "spread") {
      if (state.entries.length && !confirm(t("importReplace"))) {
        return;
      }
      placed = PipsImport.placeEntries(parsed.apps, Object.assign({ mode: "spread" }, options));
      state.entries = [];
      if (parsed.pickups !== null) {
        state.pickups = String(parsed.pickups);
        $("pickups").value = state.pickups;
      }
    } else {
      const hour = Number(when);
      placed = PipsImport.placeEntries(parsed.apps, Object.assign({ mode: "hour", hour }, options));
      state.entries = state.entries.filter((e) => Number(e.hour) !== hour);
    }
    for (const entry of placed) {
      state.entries.push({ app: entry.app, hour: entry.hour, minutes: entry.minutes, category: categoryFor(entry.app) });
    }
    commit();
    toast(fill(t("importAdded"), { n: parsed.apps.length }));
    $("importPanel").hidden = true;
  }

  function initImport() {
    importWhenOptions();
    $("importToggle").onclick = () => {
      $("importPanel").hidden = !$("importPanel").hidden;
    };
    $("importFile").onchange = () => {
      const file = $("importFile").files[0];
      $("importFile").value = "";
      if (file) {
        readScreenshot(file);
      }
    };
    $("importText").oninput = () => {
      if ($("importText").value.trim()) {
        previewImport();
      } else {
        importStatus("");
      }
    };
    $("importApply").onclick = applyImport;
  }

  function init() {
    const platform = detectPlatform();
    if (platform !== "other") {
      document.body.classList.add("is-" + platform);
    }
    applyLanguage();
    initImport();
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
      importWhenOptions();
      commit();
    };
    $("end").onchange = () => {
      prefs.end = Math.max(Number($("end").value), prefs.start + 1);
      savePrefs();
      importWhenOptions();
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
