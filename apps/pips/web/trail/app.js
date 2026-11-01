/* Pips Phone Trail - page logic: 1 add screen time (screenshot / paste / type), 2 check apps, 3 trail sticker. */
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
      trailEmpty: "Add your screen time in step 1 and your trail appears here.",
      showAll: "Show all {n} apps",
      showLess: "Show fewer",
      s1: "Add your screen time",
      s2: "Check your apps",
      s3: "Your trail",
      shotBtn: "Choose a Screen Time screenshot",
      shotHelpIos: "On iPhone: Settings › Screen Time › See All App & Website Activity, then take a screenshot.",
      shotHelpAndroid: "On Android: Settings › Digital Wellbeing, then take a screenshot.",
      androidBox: "On Android it can be automatic:",
      androidGet: "Get the free app",
      androidSub: "Reads your screen time by itself. Switch on Usage access once.",
      androidLink: "Android app",
      orLabel: "or use a screenshot",
      trySample: "Try a sample",
      typeIt: "Type it in",
      pasteIt: "Paste text",
      appName: "App name",
      addBtn: "Add",
      pasteHint: "Paste the text from your Screen Time screenshot (iPhone: open it in Photos, press and hold the text, Select All, Copy).",
      emptyList: "Your apps will show up here.",
      dotHint: "Tap a dot to change:",
      summary: "{time} · {n} apps",
      timesTitle: "Times of day (optional)",
      timesHint: "Screen Time only gives a total per app, so we spread them over your day. Change the hours here if you remember them.",
      dayWindow: "My day",
      shotFor: "Next screenshot is for",
      wholeDay: "the whole day",
      oneHour: "{hour} only",
      clearDay: "Clear this day",
      shapesTitle: "What do the shapes mean?",
      readingPct: "Reading your screenshot… {pct}%",
      loadingOcr: "Getting ready… (the first time takes a moment)",
      foundOk: "✓ Added {n} apps · {time}",
      noneFound: "Couldn't find any app times. Use the Screen Time list page (the one with minutes next to each app).",
      readFailed: "Couldn't read that picture here. Try “Paste text” instead.",
      replaceAsk: "Replace the apps already on this day?",
      privacy: "Everything stays on this phone.",
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
      trailEmpty: "Masukkan screen time di langkah 1, jejakmu muncul di sini.",
      showAll: "Tampilkan semua {n} aplikasi",
      showLess: "Tampilkan lebih sedikit",
      s1: "Masukkan screen time kamu",
      s2: "Cek aplikasimu",
      s3: "Jejakmu",
      shotBtn: "Pilih screenshot Durasi Layar",
      shotHelpIos: "Di iPhone: Pengaturan › Durasi Layar › Lihat Semua Aktivitas App & Situs Web, lalu ambil screenshot.",
      shotHelpAndroid: "Di Android: Pengaturan › Digital Wellbeing, lalu ambil screenshot.",
      androidBox: "Di Android bisa otomatis:",
      androidGet: "Ambil aplikasi gratis",
      androidSub: "Membaca screen time sendiri. Nyalakan Akses penggunaan sekali saja.",
      androidLink: "Aplikasi Android",
      orLabel: "atau pakai screenshot",
      trySample: "Coba contoh",
      typeIt: "Ketik sendiri",
      pasteIt: "Tempel teks",
      appName: "Nama aplikasi",
      addBtn: "Tambah",
      pasteHint: "Tempel teks dari screenshot Durasi Layar (iPhone: buka di Foto, tekan lama teksnya, Pilih Semua, Salin).",
      emptyList: "Aplikasimu akan muncul di sini.",
      dotHint: "Ketuk titik untuk mengganti:",
      summary: "{time} · {n} aplikasi",
      timesTitle: "Jam pemakaian (opsional)",
      timesHint: "Durasi Layar hanya memberi total per aplikasi, jadi kami sebar di harimu. Ubah jamnya di sini kalau kamu ingat.",
      dayWindow: "Hariku",
      shotFor: "Screenshot berikutnya untuk",
      wholeDay: "seharian",
      oneHour: "jam {hour} saja",
      clearDay: "Hapus hari ini",
      shapesTitle: "Apa arti bentuknya?",
      readingPct: "Membaca screenshot… {pct}%",
      loadingOcr: "Bersiap… (pertama kali agak lama)",
      foundOk: "✓ {n} aplikasi ditambahkan · {time}",
      noneFound: "Tidak ada waktu aplikasi. Pakai halaman daftar Durasi Layar (yang ada menit di samping tiap aplikasi).",
      readFailed: "Gambar tidak bisa dibaca di sini. Coba “Tempel teks”.",
      replaceAsk: "Ganti aplikasi yang sudah ada di hari ini?",
      privacy: "Semua tersimpan di HP ini.",
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
      trailEmpty: "在第 1 步加入螢幕使用時間，軌跡就會出現在這裡。",
      showAll: "顯示全部 {n} 個 App",
      showLess: "收起",
      s1: "加入你的螢幕使用時間",
      s2: "確認 App",
      s3: "你的軌跡",
      shotBtn: "選擇螢幕使用時間截圖",
      shotHelpIos: "iPhone：設定 › 螢幕使用時間 › 查看所有 App 與網站活動，然後截圖。",
      shotHelpAndroid: "Android：設定 › 數位健康，然後截圖。",
      androidBox: "Android 可以自動記錄：",
      androidGet: "下載免費 App",
      androidSub: "自動讀取螢幕使用時間。只要開啟一次「使用情形存取權」。",
      androidLink: "Android App",
      orLabel: "或用截圖",
      trySample: "看示範",
      typeIt: "手動輸入",
      pasteIt: "貼上文字",
      appName: "App 名稱",
      addBtn: "加入",
      pasteHint: "貼上螢幕使用時間截圖的文字（iPhone：在「照片」打開，長按文字，全選，拷貝）。",
      emptyList: "你的 App 會顯示在這裡。",
      dotHint: "點圓點切換：",
      summary: "{time} · {n} 個 App",
      timesTitle: "使用時段（選填）",
      timesHint: "螢幕使用時間只給每個 App 的總時間，所以我們平均分配到你的一天。記得的話可以在這裡改時段。",
      dayWindow: "我的一天",
      shotFor: "下一張截圖是",
      wholeDay: "整天",
      oneHour: "只有 {hour}",
      clearDay: "清除這一天",
      shapesTitle: "形狀代表什麼？",
      readingPct: "正在讀取截圖…… {pct}%",
      loadingOcr: "準備中……（第一次會久一點）",
      foundOk: "✓ 已加入 {n} 個 App · {time}",
      noneFound: "找不到 App 時間。請用螢幕使用時間的 App 列表頁（每個 App 旁邊有分鐘數的那頁）。",
      readFailed: "這裡無法讀取這張圖。請改用「貼上文字」。",
      replaceAsk: "要取代這一天已有的 App 嗎？",
      privacy: "所有資料只存在這支手機。",
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
      trailEmpty: "在第 1 步加入屏幕使用时间，轨迹就会出现在这里。",
      showAll: "显示全部 {n} 个 App",
      showLess: "收起",
      s1: "加入你的屏幕使用时间",
      s2: "确认 App",
      s3: "你的轨迹",
      shotBtn: "选择屏幕使用时间截图",
      shotHelpIos: "iPhone：设置 › 屏幕使用时间 › 查看所有 App 与网站活动，然后截图。",
      shotHelpAndroid: "Android：设置 › 数字健康，然后截图。",
      androidBox: "Android 可以自动记录：",
      androidGet: "下载免费 App",
      androidSub: "自动读取屏幕使用时间。只需开启一次“使用情况访问权限”。",
      androidLink: "Android App",
      orLabel: "或用截图",
      trySample: "看示例",
      typeIt: "手动输入",
      pasteIt: "粘贴文字",
      appName: "App 名称",
      addBtn: "加入",
      pasteHint: "粘贴屏幕使用时间截图的文字（iPhone：在“照片”打开，长按文字，全选，拷贝）。",
      emptyList: "你的 App 会显示在这里。",
      dotHint: "点圆点切换：",
      summary: "{time} · {n} 个 App",
      timesTitle: "使用时段（可选）",
      timesHint: "屏幕使用时间只给每个 App 的总时间，所以我们平均分配到你的一天。记得的话可以在这里改时段。",
      dayWindow: "我的一天",
      shotFor: "下一张截图是",
      wholeDay: "全天",
      oneHour: "只有 {hour}",
      clearDay: "清除这一天",
      shapesTitle: "形状代表什么？",
      readingPct: "正在读取截图…… {pct}%",
      loadingOcr: "准备中……（第一次会久一点）",
      foundOk: "✓ 已加入 {n} 个 App · {time}",
      noneFound: "找不到 App 时间。请用屏幕使用时间的 App 列表页（每个 App 旁边有分钟数的那页）。",
      readFailed: "这里无法读取这张图。请改用“粘贴文字”。",
      replaceAsk: "要替换这一天已有的 App 吗？",
      privacy: "所有数据只保存在这部手机。",
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
  const OCR_SCRIPT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const OCR_LANGS = { en: "eng", id: "eng", zh_TW: "chi_tra+eng", zh_CN: "chi_sim+eng" };

  let lang = store.getItem("pt.lang") || detectLang();
  let prefs = JSON.parse(store.getItem("pt.prefs") || "{}");
  prefs = Object.assign({ accent: ACCENTS[0], bg: "transparent", start: 7, end: 23 }, prefs);
  let userCats = JSON.parse(store.getItem("pt.cats") || "{}");
  let day = todayIso();
  let state = loadDay(day);
  let showAllApps = false;
  const SHORT_LIST = 8;

  // ---------- basics ----------
  function detectLang() {
    const n = (navigator.language || "en").toLowerCase();
    if (n.startsWith("id")) return "id";
    if (n.startsWith("zh")) return /tw|hk|hant/.test(n) ? "zh_TW" : "zh_CN";
    return "en";
  }
  function t(key) {
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  }
  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? values[key] : ""));
  }
  function hh(hour) {
    return String(hour).padStart(2, "0") + ":00";
  }
  function fmtMinutes(minutes) {
    return PipsTrail.fmtDuration(minutes * 60);
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
  function keyOf(app) {
    return (app || "").trim().toLowerCase();
  }
  function categoryFor(app) {
    const key = keyOf(app);
    if (userCats[key]) return userCats[key];
    const table = (window.PIPS_CATEGORIES && window.PIPS_CATEGORIES.apps) || {};
    return table[key] || "neutral";
  }
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 1800);
  }
  function setStatus(message, kind, busy) {
    const el = $("importStatus");
    el.className = "status" + (kind ? " " + kind : "");
    el.innerHTML = "";
    if (!message) return;
    if (busy) {
      const spinner = document.createElement("span");
      spinner.className = "spin";
      el.appendChild(spinner);
    }
    el.appendChild(document.createTextNode(message));
  }
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) return "android";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    return "other";
  }

  // ---------- language + selects ----------
  function hourOptions(select, from, to, value) {
    select.innerHTML = "";
    for (let h = from; h <= to; h++) {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = hh(h);
      if (h === value) opt.selected = true;
      select.appendChild(opt);
    }
  }
  function importWhenOptions() {
    const select = $("importWhen");
    const previous = select.value || "spread";
    select.innerHTML = "";
    const whole = document.createElement("option");
    whole.value = "spread";
    whole.textContent = t("wholeDay");
    select.appendChild(whole);
    for (let h = prefs.start; h < prefs.end; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = fill(t("oneHour"), { hour: hh(h) });
      select.appendChild(opt);
    }
    select.value = [...select.options].some((o) => o.value === previous) ? previous : "spread";
  }
  function applyLanguage() {
    document.documentElement.lang = lang.replace("_", "-");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    $("lang").value = lang;
    importWhenOptions();
  }

  // ---------- app list (step 2) ----------
  function appGroups() {
    const groups = new Map();
    for (const e of state.entries) {
      const key = keyOf(e.app);
      if (!key) continue;
      const group = groups.get(key) || { key, app: e.app.trim(), minutes: 0, category: e.category || categoryFor(e.app) };
      group.minutes += Number(e.minutes) || 0;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.minutes - a.minutes);
  }

  function spreadEntries(app, minutes) {
    return PipsImport.placeEntries([{ app, minutes }], { mode: "spread", startHour: prefs.start, endHour: prefs.end })
      .map((e) => ({ app: e.app, hour: e.hour, minutes: e.minutes, category: categoryFor(app) }));
  }

  // Change an app's total but keep the hours it already has.
  function setAppMinutes(key, minutes) {
    const own = state.entries.filter((e) => keyOf(e.app) === key);
    if (!own.length) return;
    if (!(minutes > 0)) {
      removeApp(key);
      return;
    }
    const old = own.reduce((s, e) => s + Number(e.minutes), 0) || 1;
    let remaining = minutes;
    own.forEach((e, i) => {
      const share = i === own.length - 1 ? remaining : Math.round((Number(e.minutes) * minutes) / old);
      e.minutes = Math.max(1, Math.min(60, share));
      remaining -= e.minutes;
    });
    if (remaining > 0) {
      state.entries.push(...spreadEntries(own[0].app, remaining));
    } else if (remaining < 0) {
      for (const e of own.slice().sort((a, b) => b.minutes - a.minutes)) {
        const cut = Math.min(-remaining, e.minutes - 1);
        e.minutes -= cut;
        remaining += cut;
        if (!remaining) break;
      }
    }
  }
  function removeApp(key) {
    state.entries = state.entries.filter((e) => keyOf(e.app) !== key);
  }
  function cycleCategory(key) {
    const next = CYCLE[(appGroups().find((g) => g.key === key) || {}).category] || "neutral";
    userCats[key] = next;
    store.setItem("pt.cats", JSON.stringify(userCats));
    state.entries.forEach((e) => {
      if (keyOf(e.app) === key) e.category = next;
    });
  }
  function renameApp(key, name) {
    const clean = name.trim();
    if (!clean) return;
    state.entries.forEach((e) => {
      if (keyOf(e.app) === key) {
        e.app = clean;
        e.category = categoryFor(clean);
      }
    });
  }

  function renderApps() {
    const box = $("apps");
    box.innerHTML = "";
    const groups = appGroups();
    $("legend").hidden = !groups.length;
    document.body.classList.toggle("has-data", groups.length > 0);
    $("step1").classList.toggle("done", groups.length > 0);
    const total = groups.reduce((s, g) => s + g.minutes, 0);
    $("summary").textContent = groups.length ? fill(t("summary"), { time: fmtMinutes(total), n: groups.length }) : "";
    if (!groups.length) {
      $("showAll").hidden = true;
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = t("emptyList");
      box.appendChild(empty);
      return;
    }
    const more = $("showAll");
    more.hidden = groups.length <= SHORT_LIST;
    more.textContent = showAllApps ? t("showLess") : fill(t("showAll"), { n: groups.length });
    const visible = showAllApps ? groups : groups.slice(0, SHORT_LIST);
    for (const g of visible) {
      const row = document.createElement("div");
      row.className = "app-row";

      const dot = document.createElement("button");
      dot.className = "dot " + g.category;
      dot.title = t(g.category);
      dot.setAttribute("aria-label", t(g.category));
      dot.onclick = () => {
        cycleCategory(g.key);
        commit();
      };

      const name = document.createElement("input");
      name.className = "name";
      name.value = g.app;
      name.onchange = () => {
        renameApp(g.key, name.value);
        commit();
      };

      const mins = document.createElement("input");
      mins.className = "mins";
      mins.type = "number";
      mins.min = "0";
      mins.inputMode = "numeric";
      mins.value = g.minutes;
      mins.onchange = () => {
        setAppMinutes(g.key, Math.round(Number(mins.value) || 0));
        commit();
      };

      const unit = document.createElement("span");
      unit.className = "unit";
      unit.textContent = "min";

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "×";
      del.setAttribute("aria-label", "remove");
      del.onclick = () => {
        removeApp(g.key);
        commit();
      };
      row.append(dot, name, mins, unit, del);
      box.appendChild(row);
    }
  }

  // Per-hour table inside "Times of day"
  function renderEntries() {
    const box = $("entries");
    box.innerHTML = "";
    state.entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.hour - b.entry.hour)
      .forEach(({ entry, index }) => {
        const row = document.createElement("div");
        row.className = "entry";
        const hour = document.createElement("select");
        hourOptions(hour, prefs.start, prefs.end - 1, Number(entry.hour));
        hour.onchange = () => {
          entry.hour = Number(hour.value);
          commit();
        };
        const app = document.createElement("input");
        app.value = entry.app;
        app.onchange = () => {
          entry.app = app.value.trim();
          entry.category = categoryFor(entry.app);
          commit();
        };
        const minutes = document.createElement("input");
        minutes.type = "number";
        minutes.min = "1";
        minutes.max = "60";
        minutes.inputMode = "numeric";
        minutes.value = entry.minutes;
        minutes.onchange = () => {
          entry.minutes = Math.max(0, Math.min(60, Number(minutes.value) || 0));
          state.entries = state.entries.filter((e) => e.minutes > 0);
          commit();
        };
        const del = document.createElement("button");
        del.className = "del";
        del.textContent = "×";
        del.onclick = () => {
          state.entries.splice(index, 1);
          commit();
        };
        row.append(hour, app, minutes, del);
        box.appendChild(row);
      });
  }

  // ---------- sticker (step 3) ----------
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
    return `${dateText}  ·  ${hh(prefs.start)}-${hh(prefs.end)}`;
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
      s.setAttribute("aria-label", color);
      s.onclick = () => {
        prefs.accent = color;
        savePrefs();
        document.documentElement.style.setProperty("--prod", color);
        renderSwatches();
        renderApps();
        renderSticker();
      };
      box.appendChild(s);
    }
  }

  function commit() {
    saveDay();
    $("pickups").value = state.pickups || "";
    renderApps();
    renderEntries();
    renderSticker();
  }

  // ---------- step 1: getting data in ----------
  function applyParsed(parsed) {
    if (!parsed.apps.length) {
      setStatus(t("noneFound"), "warn");
      return false;
    }
    const when = $("importWhen").value;
    const options = { startHour: prefs.start, endHour: prefs.end };
    let placed;
    if (when === "spread") {
      if (state.entries.length && !confirm(t("replaceAsk"))) {
        setStatus("");
        return false;
      }
      placed = PipsImport.placeEntries(parsed.apps, Object.assign({ mode: "spread" }, options));
      state.entries = [];
      if (parsed.pickups !== null) state.pickups = String(parsed.pickups);
    } else {
      const hour = Number(when);
      placed = PipsImport.placeEntries(parsed.apps, Object.assign({ mode: "hour", hour }, options));
      state.entries = state.entries.filter((e) => Number(e.hour) !== hour);
    }
    for (const e of placed) {
      state.entries.push({ app: e.app, hour: e.hour, minutes: e.minutes, category: categoryFor(e.app) });
    }
    commit();
    const minutes = parsed.apps.reduce((s, a) => s + a.minutes, 0);
    setStatus(fill(t("foundOk"), { n: parsed.apps.length, time: fmtMinutes(minutes) }), "ok");
    $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  function loadOcr() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
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
    setStatus(t("loadingOcr"), "", true);
    let worker = null;
    try {
      const Tesseract = await loadOcr();
      const canvas = await prepareImage(file);
      worker = await Tesseract.createWorker(OCR_LANGS[lang] || "eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setStatus(fill(t("readingPct"), { pct: Math.round(m.progress * 100) }), "", true);
          }
        },
      });
      const result = await worker.recognize(canvas);
      const text = result.data.text.trim();
      $("importText").value = text;
      applyParsed(PipsImport.parseUsageText(text));
    } catch (err) {
      setStatus(t("readFailed"), "warn");
      $("pasteBox").hidden = false;
    } finally {
      if (worker) worker.terminate().catch(() => {});
    }
  }

  function addTyped() {
    const app = $("newApp").value.trim();
    const minutes = Math.round(Number($("newMinutes").value) || 0);
    if (!app || minutes <= 0) {
      (app ? $("newMinutes") : $("newApp")).focus();
      return;
    }
    const key = keyOf(app);
    const existing = appGroups().find((g) => g.key === key);
    if (existing) {
      setAppMinutes(key, existing.minutes + minutes);
    } else {
      state.entries.push(...spreadEntries(app, minutes));
    }
    $("newApp").value = "";
    $("newMinutes").value = "";
    commit();
    $("newApp").focus();
  }

  // ---------- share ----------
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

  // ---------- wiring ----------
  function init() {
    const platform = detectPlatform();
    if (platform !== "other") document.body.classList.add("is-" + platform);
    applyLanguage();
    document.documentElement.style.setProperty("--prod", prefs.accent);
    $("date").value = day;
    $("bg").value = prefs.bg;
    hourOptions($("start"), 0, 22, prefs.start);
    hourOptions($("end"), 1, 24, prefs.end);
    $("appNames").innerHTML = QUICK_APPS.map((a) => `<option value="${a}">`).join("");

    $("lang").onchange = () => {
      lang = $("lang").value;
      store.setItem("pt.lang", lang);
      applyLanguage();
      commit();
    };
    $("date").onchange = () => {
      day = $("date").value || todayIso();
      state = loadDay(day);
      setStatus("");
      commit();
    };
    $("importFile").onchange = () => {
      const file = $("importFile").files[0];
      $("importFile").value = "";
      if (file) readScreenshot(file);
    };
    $("typeToggle").onclick = () => {
      $("typeBox").hidden = !$("typeBox").hidden;
      $("pasteBox").hidden = true;
      if (!$("typeBox").hidden) $("newApp").focus();
    };
    $("pasteToggle").onclick = () => {
      $("pasteBox").hidden = !$("pasteBox").hidden;
      $("typeBox").hidden = true;
      if (!$("pasteBox").hidden) $("importText").focus();
    };
    $("addApp").onclick = addTyped;
    $("newMinutes").onkeydown = (ev) => {
      if (ev.key === "Enter") addTyped();
    };
    $("importApply").onclick = () => {
      if (applyParsed(PipsImport.parseUsageText($("importText").value))) $("pasteBox").hidden = true;
    };
    $("sample").onclick = () => {
      state.entries = SAMPLE.map(([hour, app, minutes, category]) => ({ app, hour, minutes, category }));
      state.pickups = "63";
      setStatus("");
      commit();
    };
    $("clear").onclick = () => {
      if (!state.entries.length || confirm(t("clearConfirm"))) {
        state = { entries: [], pickups: "" };
        setStatus("");
        commit();
      }
    };
    $("pickups").oninput = () => {
      state.pickups = $("pickups").value;
      saveDay();
      renderSticker();
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
    $("showAll").onclick = () => {
      showAllApps = !showAllApps;
      renderApps();
    };
    $("share").onclick = share;
    $("save").onclick = async () => download(await canvasBlob());

    renderSwatches();
    commit();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (new URLSearchParams(location.search).has("sample")) $("sample").click();
  }

  init();
})();
