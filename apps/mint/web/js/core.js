/*
 * Mint core — template model, prompt → template generator, tweak commands,
 * a safe spreadsheet formula engine (no eval), themes and promo-copy generator.
 * Pure functions, no DOM. Exposed as globalThis.MintCore.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ themes
  var THEMES = [
    { id: "mint", name: "Mint", header: "0F766E", headerText: "FFFFFF", band: "ECFDF5", accent: "10B981", body: "FFFFFF", bodyText: "0F172A" },
    { id: "ocean", name: "Ocean", header: "1D4ED8", headerText: "FFFFFF", band: "EFF6FF", accent: "3B82F6", body: "FFFFFF", bodyText: "0F172A" },
    { id: "sunset", name: "Sunset", header: "C2410C", headerText: "FFFFFF", band: "FFF7ED", accent: "F97316", body: "FFFFFF", bodyText: "1C1917" },
    { id: "lavender", name: "Lavender", header: "6D28D9", headerText: "FFFFFF", band: "F5F3FF", accent: "8B5CF6", body: "FFFFFF", bodyText: "1E1B4B" },
    { id: "blush", name: "Blush (pastel)", header: "DB2777", headerText: "FFFFFF", band: "FDF2F8", accent: "F472B6", body: "FFFFFF", bodyText: "500724" },
    { id: "forest", name: "Forest", header: "166534", headerText: "FFFFFF", band: "F0FDF4", accent: "22C55E", body: "FFFFFF", bodyText: "052E16" },
    { id: "mono", name: "Minimal mono", header: "111827", headerText: "FFFFFF", band: "F3F4F6", accent: "6B7280", body: "FFFFFF", bodyText: "111827" },
    { id: "midnight", name: "Midnight (dark)", header: "020617", headerText: "E2E8F0", band: "1E293B", accent: "38BDF8", body: "0F172A", bodyText: "E2E8F0", dark: true }
  ];

  var THEME_WORDS = {
    mint: ["mint", "teal", "fresh", "薄荷", "menta"],
    ocean: ["ocean", "blue", "biru", "navy", "蓝", "海洋", "azul", "océano", "oceano"],
    sunset: ["sunset", "orange", "oranye", "warm", "橙", "日落", "naranja", "atardecer"],
    lavender: ["lavender", "purple", "ungu", "violet", "紫", "薰衣草", "morado", "lavanda"],
    blush: ["blush", "pink", "pastel", "cute", "aesthetic", "girly", "粉", "rosa", "rosado"],
    forest: ["forest", "green", "hijau", "nature", "绿", "森林", "verde", "bosque"],
    mono: ["mono", "minimal", "minimalist", "black and white", "clean", "simple", "简约", "极简", "黑白", "minimalista", "monocromo", "blanco y negro", "hitam putih"],
    midnight: ["midnight", "dark", "gelap", "tengah malam", "night", "深色", "暗色", "午夜", "oscuro", "medianoche"]
  };

  // scale = rough units per 1 USD, used only to size sample numbers in generated templates.
  var CURRENCIES = {
    USD: { symbol: "$", locale: "en-US", scale: 1, decimals: 2 },
    IDR: { symbol: "Rp", locale: "id-ID", scale: 15000, decimals: 0 },
    EUR: { symbol: "\u20ac", locale: "de-DE", scale: 0.92, decimals: 2 },
    GBP: { symbol: "\u00a3", locale: "en-GB", scale: 0.79, decimals: 2 },
    SGD: { symbol: "S$", locale: "en-SG", scale: 1.35, decimals: 2 },
    MYR: { symbol: "RM", locale: "ms-MY", scale: 4.7, decimals: 2 },
    JPY: { symbol: "\u00a5", locale: "ja-JP", scale: 150, decimals: 0 },
    CNY: { symbol: "\u00a5", locale: "zh-CN", scale: 7.2, decimals: 2 },
    AUD: { symbol: "A$", locale: "en-AU", scale: 1.5, decimals: 2 },
    TWD: { symbol: "NT$", locale: "zh-TW", scale: 32, decimals: 0 },
    PHP: { symbol: "\u20b1", locale: "en-PH", scale: 58, decimals: 2 },
    THB: { symbol: "\u0e3f", locale: "th-TH", scale: 35, decimals: 2 },
    VND: { symbol: "\u20ab", locale: "vi-VN", scale: 25000, decimals: 0 },
    INR: { symbol: "\u20b9", locale: "en-IN", scale: 85, decimals: 2 },
    HKD: { symbol: "HK$", locale: "zh-HK", scale: 7.8, decimals: 2 },
    KRW: { symbol: "\u20a9", locale: "ko-KR", scale: 1350, decimals: 0 },
    NZD: { symbol: "NZ$", locale: "en-NZ", scale: 1.7, decimals: 2 },
    CAD: { symbol: "C$", locale: "en-CA", scale: 1.38, decimals: 2 },
    MXN: { symbol: "MX$", locale: "es-MX", scale: 18, decimals: 2 },
    COP: { symbol: "COL$", locale: "es-CO", scale: 4000, decimals: 0 },
    BRL: { symbol: "R$", locale: "pt-BR", scale: 5.4, decimals: 2 },
    AED: { symbol: "AED", locale: "en-AE", scale: 3.67, decimals: 2 }
  };

  var CURRENCY_WORDS = [
    [/\b(idr|rupiah|rp)\b/, "IDR"],
    [/\b(eur|euro|euros)\b|\u20ac/, "EUR"],
    [/\b(gbp|pound|pounds|sterling)\b|\u00a3/, "GBP"],
    [/\b(sgd|singapore dollar)\b/, "SGD"],
    [/\b(myr|ringgit)\b/, "MYR"],
    [/\b(jpy|yen)\b/, "JPY"],
    [/\b(cny|rmb|yuan|renminbi)\b/, "CNY"],
    [/\b(twd|ntd|nt\$|new taiwan dollar)\b/, "TWD"],
    [/\b(thb|baht)\b/, "THB"],
    [/\b(vnd|dong)\b/, "VND"],
    [/\b(inr|rupee|rupees)\b/, "INR"],
    [/\b(krw|won)\b/, "KRW"],
    [/\b(hkd)\b/, "HKD"],
    [/\b(aud)\b/, "AUD"],
    [/\b(nzd)\b/, "NZD"],
    [/\b(cad)\b/, "CAD"],
    [/\b(mxn)\b/, "MXN"],
    [/\b(cop)\b/, "COP"],
    [/\b(brl|reais)\b/, "BRL"],
    [/\b(aed|dirham|dirhams)\b/, "AED"],
    [/\b(php|philippine peso)\b/, "PHP"],
    [/人民币/, "CNY"],
    [/欧元/, "EUR"],
    [/英镑|\blibras?( esterlinas?)?\b/, "GBP"],
    [/新加坡元|新元/, "SGD"],
    [/林吉特|马币/, "MYR"],
    [/日元|\byenes\b/, "JPY"],
    [/新台币|台币/, "TWD"],
    [/港元|港币/, "HKD"],
    [/印尼盾/, "IDR"],
    [/泰铢/, "THB"],
    [/越南盾/, "VND"],
    [/卢比/, "INR"],
    [/韩元/, "KRW"],
    [/澳元/, "AUD"],
    [/新西兰元|纽元/, "NZD"],
    [/加元/, "CAD"],
    [/\bpesos mexicanos\b/, "MXN"],
    [/\bpesos colombianos\b/, "COP"],
    [/雷亚尔|\breales\b/, "BRL"],
    [/迪拉姆/, "AED"],
    [/美元|美金|d[óo]lar(es)?\b/, "USD"],
    [/\b(usd|dollar|dollars)\b|\$/, "USD"]
  ];

  var CATEGORIES = ["Finance", "Business", "Productivity", "Lifestyle", "Health", "Education", "Creator", "Events", "Other"];

  // ------------------------------------------------------------------ helpers
  var idCounter = 0;

  function uid(prefix) {
    idCounter += 1;
    return (prefix || "c") + Date.now().toString(36).slice(-5) + idCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clampText(value, max) {
    return String(value === undefined || value === null ? "" : value).slice(0, max);
  }

  function titleCase(text) {
    return String(text).replace(/\s+/g, " ").trim().replace(/(^|[\s(\/-])([a-z])/g, function (m, pre, ch) {
      return pre + ch.toUpperCase();
    });
  }

  function titleFromPrompt(text) {
    var t = String(text)
      .replace(/(?:columns?|kolom|fields?)\s*[:\-].*$/i, "")
      .replace(/\s+(with|dengan|that|for tracking|including)\b.*$/i, "")
      .replace(/^(please\s+)?(make|create|build|generate|design|buat|bikin|i need|i want)\s+(me\s+)?(a|an|sebuah)?\s*/i, "")
      .replace(/^(track|tracking|log|catat)\s+(my|our)?\s*/i, "")
      .replace(/\b(template|spreadsheet|google sheets?|excel|sheet|tracker)\b/gi, "")
      .replace(/[^\w\s'&-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return titleCase(t || "Custom") + " Tracker";
  }

  function isoFromOffset(days) {
    var now = new Date();
    var d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days));
    return d.toISOString().slice(0, 10);
  }

  function serialFromIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) {
      return null;
    }
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function isoFromSerial(serial) {
    var ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  function todaySerial() {
    var now = new Date();
    return Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) {
        return THEMES[i];
      }
    }
    return THEMES[0];
  }

  // ------------------------------------------------------------------ type inference
  var DEFAULT_OPTIONS = {
    status: ["To do", "In progress", "Done"],
    priority: ["High", "Medium", "Low"],
    stage: ["Lead", "Contacted", "Proposal", "Won", "Lost"],
    platform: ["Instagram", "TikTok", "YouTube", "LinkedIn", "Blog"],
    category: ["General", "Work", "Personal"],
    type: ["Type A", "Type B", "Type C"]
  };

  function inferType(name) {
    var n = name.toLowerCase();
    if (/(date|deadline|due|tanggal|start|end|day|tgl|日期|时间|截止|到期|fecha|vencimiento|día|plazo)/.test(n)) {
      return { type: "date" };
    }
    if (/(price|cost|amount|total|budget|revenue|fee|salary|harga|biaya|jumlah uang|value|income|expense|paid amount|setoran|iuran|gaji|bayar|nominal|modal|omzet|tagihan|金额|价格|费用|成本|收入|支出|预算|工资|存款|总价|precio|costo|coste|importe|monto|presupuesto|ingreso|gasto|salario|aporte|cuota|pago)/.test(n)) {
      return { type: "currency" };
    }
    if (/(%|percent|rate|margin|probability|persen|百分比|比例|利率|porcentaje|tasa)/.test(n)) {
      return { type: "percent" };
    }
    if (/(qty|quantity|count|hours|jam|stok|stock|units|score|minutes|reps|sets|kg|weight|number|nomor|rating|数量|次数|小时|分钟|库存|分数|评分|重量|cantidad|horas|minutos|unidades|puntuación|puntos|peso|número)/.test(n)) {
      return { type: "number" };
    }
    if (/(done|paid|complete|selesai|lunas|yes\/no|checked|已完成|已付|完成|是否|hecho|pagado|completado|listo)/.test(n)) {
      return { type: "check" };
    }
    for (var key in DEFAULT_OPTIONS) {
      if (n.indexOf(key) !== -1) {
        return { type: "select", options: DEFAULT_OPTIONS[key].slice() };
      }
    }
    return { type: "text" };
  }

  function makeColumn(name, type, extra) {
    var col = { id: uid("c"), name: clampText(titleCase(name), 40), type: type || "text" };
    extra = extra || {};
    if (col.type === "select") {
      col.options = (extra.options || DEFAULT_OPTIONS.status).map(function (o) {
        return clampText(o, 40);
      });
    }
    if (col.type === "formula") {
      col.formula = clampText(extra.formula || "", 400);
      col.format = extra.format || "number";
    }
    if (extra.width) {
      col.width = extra.width;
    }
    return col;
  }

  // ------------------------------------------------------------------ blueprints
  // rows: positional values for non-formula columns. "d+N" → ISO date N days from today.
  var BLUEPRINTS = [
    {
      id: "budget", category: "Finance", theme: "mint",
      keywords: ["budget", "expense", "spending", "money", "finance", "anggaran", "pengeluaran", "keuangan", "uang"],
      title: "Monthly Budget Planner",
      description: "Plan vs actual spending by category with variance, over-budget flags and a dashboard.",
      columns: [["Category", "select", { options: ["Housing", "Food", "Transport", "Utilities", "Fun", "Savings", "Other"] }], ["Item", "text"], ["Planned", "currency"], ["Actual", "currency"], ["Difference", "formula", { formula: "[Planned]-[Actual]", format: "currency" }], ["Status", "formula", { formula: "IF([Actual]>[Planned],\"Over\",\"OK\")", format: "text" }]],
      rows: [["Housing", "Rent", 1200, 1200], ["Food", "Groceries", 400, 455], ["Transport", "Fuel", 150, 120], ["Utilities", "Electricity", 90, 104], ["Fun", "Streaming", 30, 30], ["Savings", "Emergency fund", 300, 300]],
      summary: [["Total planned", "SUM", "Planned"], ["Total spent", "SUM", "Actual"], ["Left to spend", "SUM", "Difference"], ["Categories over", "COUNTIF", "Status", "Over"]],
      rules: [["Difference", "<", 0, "bad"], ["Status", "=", "Over", "bad"], ["Status", "=", "OK", "good"]]
    },
    {
      id: "invoice", category: "Business", theme: "ocean",
      keywords: ["invoice", "billing", "client payment", "receivable", "faktur", "tagihan", "freelance"],
      title: "Freelance Invoice Tracker",
      description: "Track invoices, due dates and payments — days overdue are calculated automatically.",
      columns: [["Invoice #", "text"], ["Client", "text"], ["Issued", "date"], ["Due", "date"], ["Amount", "currency"], ["Paid", "check"], ["Days Overdue", "formula", { formula: "IF([Paid]=\"Yes\",0,MAX(0,TODAY()-[Due]))", format: "number" }]],
      rows: [["INV-001", "Acme Studio", "d-40", "d-10", 1800, "Yes"], ["INV-002", "Nusantara Co", "d-25", "d+5", 950, "No"], ["INV-003", "Bright Labs", "d-45", "d-15", 2400, "No"], ["INV-004", "Kopi Kita", "d-5", "d+25", 600, "No"]],
      summary: [["Invoiced", "SUM", "Amount"], ["Invoices", "COUNTA", "Invoice #"], ["Unpaid", "COUNTIF", "Paid", "No"], ["Worst overdue (days)", "MAX", "Days Overdue"]],
      rules: [["Days Overdue", ">", 0, "bad"], ["Paid", "=", "Yes", "good"]]
    },
    {
      id: "inventory", category: "Business", theme: "sunset",
      keywords: ["inventory", "stock", "warehouse", "sku", "stok", "gudang", "persediaan", "barang"],
      title: "Inventory & Reorder Tracker",
      description: "Stock levels, stock value and automatic reorder alerts per SKU.",
      columns: [["SKU", "text"], ["Item", "text"], ["Qty", "number"], ["Reorder Level", "number"], ["Unit Cost", "currency"], ["Stock Value", "formula", { formula: "[Qty]*[Unit Cost]", format: "currency" }], ["Reorder?", "formula", { formula: "IF([Qty]<=[Reorder Level],\"Reorder\",\"OK\")", format: "text" }]],
      rows: [["TS-BLK-M", "T-shirt black M", 42, 20, 6.5], ["TS-WHT-L", "T-shirt white L", 12, 20, 6.5], ["MUG-01", "Logo mug", 8, 10, 3.2], ["CAP-01", "Snapback cap", 55, 15, 4.1]],
      summary: [["Units in stock", "SUM", "Qty"], ["Stock value", "SUM", "Stock Value"], ["SKUs to reorder", "COUNTIF", "Reorder?", "Reorder"]],
      rules: [["Reorder?", "=", "Reorder", "bad"], ["Reorder?", "=", "OK", "good"]]
    },
    {
      id: "project", category: "Productivity", theme: "lavender",
      keywords: ["project", "task", "todo", "to-do", "sprint", "kanban", "tugas", "proyek", "pekerjaan"],
      title: "Project Task Tracker",
      description: "Tasks with owner, priority, status and due dates — overdue work turns red.",
      columns: [["Task", "text"], ["Owner", "text"], ["Priority", "select", { options: ["High", "Medium", "Low"] }], ["Status", "select", { options: ["To do", "In progress", "Blocked", "Done"] }], ["Due", "date"], ["Days Left", "formula", { formula: "IF([Status]=\"Done\",0,[Due]-TODAY())", format: "number" }]],
      rows: [["Write brief", "Ana", "High", "Done", "d-3"], ["Design mockups", "Budi", "High", "In progress", "d+4"], ["Client review", "Ana", "Medium", "To do", "d+9"], ["Fix feedback", "Citra", "Low", "Blocked", "d-1"]],
      summary: [["Tasks", "COUNTA", "Task"], ["Done", "COUNTIF", "Status", "Done"], ["Blocked", "COUNTIF", "Status", "Blocked"]],
      rules: [["Days Left", "<", 0, "bad"], ["Status", "=", "Done", "good"], ["Status", "=", "Blocked", "warn"]]
    },
    {
      id: "crm", category: "Business", theme: "ocean",
      keywords: ["crm", "lead", "leads", "pipeline", "sales", "client", "customer", "deal", "pelanggan", "penjualan"],
      title: "Sales Pipeline CRM",
      description: "Deals by stage with probability-weighted forecast and next-step dates.",
      columns: [["Company", "text"], ["Contact", "text"], ["Stage", "select", { options: ["Lead", "Contacted", "Proposal", "Won", "Lost"] }], ["Deal Value", "currency"], ["Probability", "percent"], ["Weighted", "formula", { formula: "[Deal Value]*[Probability]", format: "currency" }], ["Next Step", "date"]],
      rows: [["Acme Studio", "Rina", "Proposal", 5000, 0.5, "d+2"], ["Bright Labs", "Tom", "Contacted", 3200, 0.2, "d+5"], ["Kopi Kita", "Dewi", "Won", 1500, 1, "d-2"], ["Orbit Media", "Sam", "Lead", 8000, 0.1, "d+7"]],
      summary: [["Pipeline value", "SUM", "Deal Value"], ["Weighted forecast", "SUM", "Weighted"], ["Deals won", "COUNTIF", "Stage", "Won"]],
      rules: [["Stage", "=", "Won", "good"], ["Stage", "=", "Lost", "bad"]]
    },
    {
      id: "habit", category: "Lifestyle", theme: "blush",
      keywords: ["habit", "routine", "daily", "self care", "kebiasaan", "rutinitas", "journal"],
      title: "Habit Tracker",
      description: "Track daily habits for the week and see your completion rate at a glance.",
      columns: [["Habit", "text"], ["Mon", "check"], ["Tue", "check"], ["Wed", "check"], ["Thu", "check"], ["Fri", "check"], ["Sat", "check"], ["Sun", "check"], ["Score", "formula", { formula: "(([Mon]=\"Yes\")+([Tue]=\"Yes\")+([Wed]=\"Yes\")+([Thu]=\"Yes\")+([Fri]=\"Yes\")+([Sat]=\"Yes\")+([Sun]=\"Yes\"))/7", format: "percent" }]],
      rows: [["Drink 2L water", "Yes", "Yes", "No", "Yes", "Yes", "Yes", "No"], ["Read 20 pages", "Yes", "No", "Yes", "No", "Yes", "No", "Yes"], ["Workout", "No", "Yes", "No", "Yes", "No", "Yes", "No"], ["No phone after 10pm", "Yes", "Yes", "Yes", "No", "No", "Yes", "Yes"]],
      summary: [["Habits", "COUNTA", "Habit"], ["Average score", "AVERAGE", "Score"], ["Best habit score", "MAX", "Score"]],
      rules: [["Score", ">", 0.7, "good"], ["Score", "<", 0.4, "bad"]]
    },
    {
      id: "content", category: "Creator", theme: "blush",
      keywords: ["content", "social media", "instagram", "tiktok", "youtube", "posting", "calendar", "konten", "creator"],
      title: "Content Calendar",
      description: "Plan posts across platforms with status, publish dates and performance.",
      columns: [["Title", "text"], ["Platform", "select", { options: ["Instagram", "TikTok", "YouTube", "LinkedIn", "Blog"] }], ["Status", "select", { options: ["Idea", "Drafting", "Scheduled", "Published"] }], ["Publish Date", "date"], ["Views", "number"], ["Likes", "number"], ["Engagement", "formula", { formula: "IF([Views]>0,[Likes]/[Views],0)", format: "percent" }]],
      rows: [["5 budgeting myths", "TikTok", "Published", "d-6", 12400, 980], ["Template walkthrough", "YouTube", "Scheduled", "d+2", 0, 0], ["Behind the scenes", "Instagram", "Drafting", "d+5", 0, 0], ["Pricing tips thread", "LinkedIn", "Published", "d-3", 3100, 210]],
      summary: [["Posts", "COUNTA", "Title"], ["Published", "COUNTIF", "Status", "Published"], ["Total views", "SUM", "Views"]],
      rules: [["Status", "=", "Published", "good"], ["Engagement", ">", 0.05, "good"]]
    },
    {
      id: "meal", category: "Health", theme: "forest",
      keywords: ["meal", "recipe", "grocery", "diet", "food plan", "makan", "menu", "resep", "belanja"],
      title: "Weekly Meal Planner",
      description: "Plan meals, calories and grocery cost for the week.",
      columns: [["Day", "select", { options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }], ["Meal", "select", { options: ["Breakfast", "Lunch", "Dinner", "Snack"] }], ["Dish", "text"], ["Calories", "number"], ["Cost", "currency"], ["Prepped", "check"]],
      rows: [["Mon", "Breakfast", "Overnight oats", 380, 1.8, "Yes"], ["Mon", "Lunch", "Chicken rice bowl", 620, 4.5, "Yes"], ["Mon", "Dinner", "Veggie stir-fry", 540, 3.9, "No"], ["Tue", "Breakfast", "Greek yogurt + fruit", 300, 2.2, "No"]],
      summary: [["Meals planned", "COUNTA", "Dish"], ["Total calories", "SUM", "Calories"], ["Grocery cost", "SUM", "Cost"]],
      rules: [["Prepped", "=", "Yes", "good"], ["Calories", ">", 800, "warn"]]
    },
    {
      id: "workout", category: "Health", theme: "sunset",
      keywords: ["workout", "fitness", "gym", "exercise", "training", "olahraga", "latihan"],
      title: "Workout Log",
      description: "Log sets, reps and weight; training volume is calculated per exercise.",
      columns: [["Date", "date"], ["Exercise", "text"], ["Sets", "number"], ["Reps", "number"], ["Weight (kg)", "number"], ["Volume", "formula", { formula: "[Sets]*[Reps]*[Weight (kg)]", format: "number" }]],
      rows: [["d-2", "Squat", 4, 8, 80], ["d-2", "Bench press", 4, 8, 60], ["d-1", "Deadlift", 3, 5, 110], ["d-1", "Pull-up", 3, 10, 0]],
      summary: [["Sessions logged", "COUNTA", "Exercise"], ["Total volume", "SUM", "Volume"], ["Heaviest lift (kg)", "MAX", "Weight (kg)"]],
      rules: [["Volume", ">", 2000, "good"]]
    },
    {
      id: "rental", category: "Finance", theme: "forest",
      keywords: ["airbnb", "rental", "property", "landlord", "kos", "kost", "sewa", "villa", "host"],
      title: "Rental Property P&L",
      description: "Bookings, nightly rate, platform fees and net profit per stay.",
      columns: [["Guest", "text"], ["Check-in", "date"], ["Nights", "number"], ["Nightly Rate", "currency"], ["Platform Fee %", "percent"], ["Cleaning", "currency"], ["Net Profit", "formula", { formula: "[Nights]*[Nightly Rate]*(1-[Platform Fee %])-[Cleaning]", format: "currency" }]],
      rows: [["J. Smith", "d-20", 3, 85, 0.15, 25], ["A. Putri", "d-12", 5, 80, 0.15, 25], ["K. Tan", "d-4", 2, 95, 0.15, 25], ["M. Lee", "d+6", 4, 85, 0.15, 25]],
      summary: [["Nights booked", "SUM", "Nights"], ["Net profit", "SUM", "Net Profit"], ["Average rate", "AVERAGE", "Nightly Rate"]],
      rules: [["Net Profit", "<", 0, "bad"], ["Net Profit", ">", 300, "good"]]
    },
    {
      id: "pricing", category: "Business", theme: "sunset",
      keywords: ["etsy", "shopee", "tokopedia", "pricing", "product price", "margin", "seller fee", "profit calculator", "harga jual", "online shop", "reseller"],
      title: "Product Pricing & Profit Calculator",
      description: "Set prices with marketplace fees and see profit and margin per product.",
      columns: [["Product", "text"], ["Cost", "currency"], ["Price", "currency"], ["Fee %", "percent"], ["Shipping", "currency"], ["Profit", "formula", { formula: "[Price]*(1-[Fee %])-[Cost]-[Shipping]", format: "currency" }], ["Margin", "formula", { formula: "IF([Price]>0,[Profit]/[Price],0)", format: "percent" }]],
      rows: [["Digital planner", 0, 12, 0.1, 0], ["Sticker pack", 1.2, 5, 0.1, 0.8], ["Tote bag", 6, 18, 0.1, 2.5], ["Mug", 4.5, 9, 0.1, 3]],
      summary: [["Products", "COUNTA", "Product"], ["Average margin", "AVERAGE", "Margin"], ["Lowest profit", "MIN", "Profit"]],
      rules: [["Margin", "<", 0.2, "bad"], ["Margin", ">", 0.5, "good"]]
    },
    {
      id: "travel", category: "Lifestyle", theme: "ocean",
      keywords: ["travel", "trip", "itinerary", "vacation", "holiday", "liburan", "perjalanan", "jalan-jalan"],
      title: "Trip Itinerary & Budget",
      description: "Day-by-day itinerary with bookings and a running trip budget.",
      columns: [["Date", "date"], ["City", "text"], ["Activity", "text"], ["Booked", "check"], ["Cost", "currency"], ["Notes", "text"]],
      rows: [["d+30", "Bali", "Arrive + check in villa", "Yes", 120, "Airport pickup 3pm"], ["d+31", "Bali", "Ubud rice terraces", "No", 35, ""], ["d+32", "Bali", "Snorkel trip", "No", 60, "Bring reef-safe sunscreen"], ["d+33", "Lombok", "Fast boat", "Yes", 45, ""]],
      summary: [["Trip budget", "SUM", "Cost"], ["Activities", "COUNTA", "Activity"], ["Still to book", "COUNTIF", "Booked", "No"]],
      rules: [["Booked", "=", "No", "warn"], ["Booked", "=", "Yes", "good"]]
    },
    {
      id: "study", category: "Education", theme: "lavender",
      keywords: ["study", "exam", "student", "school", "class", "homework", "belajar", "ujian", "kuliah", "sekolah"],
      title: "Study Planner & Grade Tracker",
      description: "Assignments, deadlines, study hours and grades in one sheet.",
      columns: [["Subject", "text"], ["Assignment", "text"], ["Due", "date"], ["Hours Planned", "number"], ["Grade %", "percent"], ["Status", "select", { options: ["Not started", "Studying", "Submitted"] }]],
      rows: [["Math", "Problem set 4", "d+3", 4, 0, "Studying"], ["Physics", "Lab report", "d+6", 6, 0, "Not started"], ["English", "Essay draft", "d-2", 5, 0.88, "Submitted"], ["History", "Quiz prep", "d+1", 2, 0, "Studying"]],
      summary: [["Assignments", "COUNTA", "Assignment"], ["Study hours", "SUM", "Hours Planned"], ["Submitted", "COUNTIF", "Status", "Submitted"]],
      rules: [["Status", "=", "Submitted", "good"], ["Status", "=", "Not started", "warn"]]
    },
    {
      id: "event", category: "Events", theme: "blush",
      keywords: ["wedding", "event", "party", "guest", "rsvp", "nikah", "pernikahan", "acara", "undangan"],
      title: "Wedding & Event Guest List",
      description: "Guests, RSVP status, party size and per-guest cost.",
      columns: [["Guest", "text"], ["Side", "select", { options: ["Bride", "Groom", "Both"] }], ["RSVP", "select", { options: ["Pending", "Yes", "No"] }], ["Party Size", "number"], ["Cost per Head", "currency"], ["Cost", "formula", { formula: "IF([RSVP]=\"Yes\",[Party Size]*[Cost per Head],0)", format: "currency" }]],
      rows: [["The Wijaya family", "Bride", "Yes", 4, 45], ["Daniel & Mia", "Groom", "Pending", 2, 45], ["Aunt Sari", "Bride", "Yes", 1, 45], ["Office team", "Both", "No", 6, 45]],
      summary: [["Invited parties", "COUNTA", "Guest"], ["Confirmed", "COUNTIF", "RSVP", "Yes"], ["Catering cost", "SUM", "Cost"]],
      rules: [["RSVP", "=", "Yes", "good"], ["RSVP", "=", "No", "bad"], ["RSVP", "=", "Pending", "warn"]]
    }
  ];

  function blueprintById(id) {
    for (var i = 0; i < BLUEPRINTS.length; i++) {
      if (BLUEPRINTS[i].id === id) {
        return BLUEPRINTS[i];
      }
    }
    return null;
  }

  function scaleAmount(value, currency) {
    var c = CURRENCIES[currency] || CURRENCIES.USD;
    if (c.scale === 1) {
      return value;
    }
    var scaled = value * c.scale;
    if (c.decimals === 0) {
      var step = scaled >= 10000 ? 1000 : 1;
      return Math.round(scaled / step) * step;
    }
    return Math.round(scaled * 100) / 100;
  }

  function specFromBlueprint(bp, options) {
    options = options || {};
    var currency = options.currency || "USD";
    var columns = bp.columns.map(function (c) {
      return makeColumn(c[0], c[1], c[2]);
    });
    var inputCols = columns.filter(function (c) {
      return c.type !== "formula";
    });
    var rows = bp.rows.map(function (values) {
      var row = { id: uid("r") };
      inputCols.forEach(function (col, i) {
        var v = values[i];
        if (v === undefined) {
          v = "";
        }
        if (col.type === "date" && typeof v === "string" && /^d[+-]\d+$/.test(v)) {
          v = isoFromOffset(parseInt(v.slice(1), 10));
        }
        if (col.type === "currency" && typeof v === "number") {
          v = scaleAmount(v, currency);
        }
        row[col.id] = v;
      });
      return row;
    });
    var byName = {};
    columns.forEach(function (c) {
      byName[c.name.toLowerCase()] = c;
    });
    var summary = (bp.summary || []).map(function (s) {
      return { id: uid("s"), label: s[0], fn: s[1], column: s[2], match: s[3] === undefined ? "" : s[3] };
    });
    var rules = (bp.rules || []).map(function (r) {
      return { id: uid("k"), column: r[0], op: r[1], value: r[2], style: r[3] };
    });
    return {
      version: 1,
      title: options.title || bp.title,
      description: bp.description,
      category: bp.category,
      blueprint: bp.id,
      theme: options.theme || bp.theme,
      currency: currency,
      sheet: { name: "Data", columns: columns, rows: rows },
      summary: summary,
      rules: rules,
      prompt: options.prompt || ""
    };
  }

  // ------------------------------------------------------------------ prompt → template
  function detectCurrency(text) {
    var lower = text.toLowerCase();
    for (var i = 0; i < CURRENCY_WORDS.length; i++) {
      if (CURRENCY_WORDS[i][0].test(lower)) {
        return CURRENCY_WORDS[i][1];
      }
    }
    return null;
  }

  function detectTheme(text) {
    var lower = " " + text.toLowerCase() + " ";
    var best = null;
    Object.keys(THEME_WORDS).forEach(function (id) {
      THEME_WORDS[id].forEach(function (word) {
        if (!best && new RegExp("[^a-z]" + word.replace(/ /g, "\\s+") + "[^a-z]").test(lower)) {
          best = id;
        }
      });
    });
    return best;
  }

  function scoreBlueprints(text) {
    var lower = " " + text.toLowerCase() + " ";
    return BLUEPRINTS.map(function (bp) {
      var score = 0;
      bp.keywords.concat(BLUEPRINT_KEYWORDS_INTL[bp.id] || []).forEach(function (k) {
        if (lower.indexOf(k) !== -1) {
          score += k.length > 5 || /[\u3400-\u9fff]/.test(k) ? 3 : 2;
        }
      });
      return { bp: bp, score: score };
    }).sort(function (a, b) {
      return b.score - a.score;
    });
  }

  function parseListedColumns(text) {
    var m = /(?:columns?|kolom|fields?|columnas?|campos?)\s*[:：\-]\s*([^.。\n]+)/i.exec(text) ||
      /(?:列|字段)\s*[:：]\s*([^。\n]+)/.exec(text);
    if (!m) {
      m = /\bwith\s+([a-z0-9 ,&/'%()-]+?(?:,| and )[a-z0-9 ,&/'%()-]+)$/i.exec(text.trim());
    }
    if (!m) {
      return [];
    }
    return m[1].split(/,|，|、|;|；|\band\b|\bdan\b|\by\b|&/i).map(function (s) {
      return s.trim().replace(/^(a|an|the)\s+/i, "");
    }).filter(function (s) {
      return s.length > 1 && s.length < 40;
    }).slice(0, 15);
  }

  var EXTRA_COLUMNS = [
    [/\bpriorit(y|ies|as)\b/, "Priority"],
    [/\b(owner|assignee|pic|penanggung jawab)\b/, "Owner"],
    [/\b(notes?|catatan|keterangan)\b/, "Notes"],
    [/\b(deadline|due date|jatuh tempo)\b/, "Due"],
    [/\bstatus\b/, "Status"]
  ];


  // ------------------------------------------------------------------ template languages (3.5.2)
  // Blueprints are written in English. A prompt in Indonesian, Chinese or Spanish (or, when the prompt
  // gives no clue, the app language) gets the same template with its words in that language. Column
  // renames go through renameInFormulas, so formulas, cards and highlight rules keep working.
  // Check-box values stay "Yes"/"No" (the app reads them).
  var BLUEPRINT_KEYWORDS_INTL = {"budget": ["预算", "开支", "记账", "支出", "presupuesto", "gastos", "finanzas", "dinero"], "invoice": ["发票", "账单", "收款", "factura", "facturas", "cobros"], "inventory": ["库存", "存货", "仓库", "进货", "inventario", "existencias", "almacén", "almacen"], "project": ["项目", "任务", "待办", "proyecto", "tareas", "pendientes"], "crm": ["客户", "销售", "商机", "clientes", "ventas", "embudo"], "habit": ["习惯", "打卡", "hábitos", "habitos", "rutina"], "content": ["内容", "发布", "小红书", "抖音", "contenido", "publicaciones", "redes sociales"], "meal": ["餐", "菜单", "食谱", "饮食", "comidas", "menú", "menu semanal", "recetas"], "workout": ["健身", "训练", "锻炼", "entrenamiento", "gimnasio", "ejercicio"], "rental": ["民宿", "出租", "房东", "alquiler", "arriendo", "inquilinos"], "pricing": ["定价", "利润", "网店", "淘宝", "precios", "margen", "tienda online"], "travel": ["旅行", "旅游", "行程", "viaje", "itinerario", "vacaciones"], "study": ["学习", "考试", "作业", "成绩", "estudio", "examen", "tareas escolares", "notas"], "event": ["婚礼", "宾客", "活动", "派对", "boda", "invitados", "evento", "fiesta"]};

  var BLUEPRINT_L10N = {
    "id": {
      "Monthly Budget Planner": "Perencana Anggaran Bulanan",
      "Freelance Invoice Tracker": "Pelacak Tagihan Freelance",
      "Inventory & Reorder Tracker": "Pelacak Stok & Pemesanan Ulang",
      "Project Task Tracker": "Pelacak Tugas Proyek",
      "Sales Pipeline CRM": "CRM Pipeline Penjualan",
      "Habit Tracker": "Pelacak Kebiasaan",
      "Content Calendar": "Kalender Konten",
      "Weekly Meal Planner": "Perencana Menu Mingguan",
      "Workout Log": "Catatan Latihan",
      "Rental Property P&L": "Laba Rugi Properti Sewa",
      "Product Pricing & Profit Calculator": "Kalkulator Harga & Laba Produk",
      "Trip Itinerary & Budget": "Rencana Perjalanan & Anggaran",
      "Study Planner & Grade Tracker": "Perencana Belajar & Nilai",
      "Wedding & Event Guest List": "Daftar Tamu Pernikahan & Acara",
      "Custom Tracker": "Tracker Kustom",
      "Plan vs actual spending by category with variance, over-budget flags and a dashboard.": "Rencana vs pengeluaran nyata per kategori, dengan selisih, tanda lewat anggaran, dan dashboard.",
      "Track invoices, due dates and payments — days overdue are calculated automatically.": "Pantau tagihan, jatuh tempo, dan pembayaran — hari keterlambatan dihitung otomatis.",
      "Stock levels, stock value and automatic reorder alerts per SKU.": "Jumlah stok, nilai stok, dan peringatan pesan ulang otomatis per SKU.",
      "Tasks with owner, priority, status and due dates — overdue work turns red.": "Tugas dengan penanggung jawab, prioritas, status, dan tenggat — yang terlambat jadi merah.",
      "Deals by stage with probability-weighted forecast and next-step dates.": "Kesepakatan per tahap dengan perkiraan berbobot peluang dan tanggal langkah berikutnya.",
      "Track daily habits for the week and see your completion rate at a glance.": "Pantau kebiasaan harian selama seminggu dan lihat tingkat keberhasilanmu sekilas.",
      "Plan posts across platforms with status, publish dates and performance.": "Rencanakan posting di berbagai platform dengan status, tanggal terbit, dan performa.",
      "Plan meals, calories and grocery cost for the week.": "Rencanakan menu, kalori, dan biaya belanja untuk seminggu.",
      "Log sets, reps and weight; training volume is calculated per exercise.": "Catat set, repetisi, dan beban; volume latihan dihitung per gerakan.",
      "Bookings, nightly rate, platform fees and net profit per stay.": "Pemesanan, tarif per malam, biaya platform, dan laba bersih per menginap.",
      "Set prices with marketplace fees and see profit and margin per product.": "Tentukan harga dengan biaya marketplace dan lihat laba serta margin per produk.",
      "Day-by-day itinerary with bookings and a running trip budget.": "Rencana harian dengan pemesanan dan anggaran perjalanan berjalan.",
      "Assignments, deadlines, study hours and grades in one sheet.": "Tugas, tenggat, jam belajar, dan nilai dalam satu sheet.",
      "Guests, RSVP status, party size and per-guest cost.": "Tamu, status konfirmasi, jumlah orang, dan biaya per tamu.",
      "Category": "Kategori",
      "Item": "Item",
      "Planned": "Rencana",
      "Actual": "Aktual",
      "Difference": "Selisih",
      "Status": "Status",
      "Invoice #": "No. Tagihan",
      "Client": "Klien",
      "Issued": "Terbit",
      "Due": "Jatuh Tempo",
      "Amount": "Jumlah",
      "Paid": "Lunas",
      "Days Overdue": "Hari Terlambat",
      "SKU": "SKU",
      "Qty": "Jml",
      "Reorder Level": "Batas Pesan Ulang",
      "Unit Cost": "Biaya Satuan",
      "Stock Value": "Nilai Stok",
      "Reorder?": "Pesan Ulang?",
      "Task": "Tugas",
      "Owner": "Penanggung Jawab",
      "Priority": "Prioritas",
      "Days Left": "Sisa Hari",
      "Company": "Perusahaan",
      "Contact": "Kontak",
      "Stage": "Tahap",
      "Deal Value": "Nilai Kesepakatan",
      "Probability": "Peluang",
      "Weighted": "Berbobot",
      "Next Step": "Langkah Berikutnya",
      "Habit": "Kebiasaan",
      "Mon": "Sen",
      "Tue": "Sel",
      "Wed": "Rab",
      "Thu": "Kam",
      "Fri": "Jum",
      "Sat": "Sab",
      "Sun": "Min",
      "Score": "Skor",
      "Title": "Judul",
      "Platform": "Platform",
      "Publish Date": "Tanggal Terbit",
      "Views": "Tayangan",
      "Likes": "Suka",
      "Engagement": "Interaksi",
      "Day": "Hari",
      "Meal": "Waktu Makan",
      "Dish": "Hidangan",
      "Calories": "Kalori",
      "Cost": "Biaya",
      "Prepped": "Disiapkan",
      "Date": "Tanggal",
      "Exercise": "Gerakan",
      "Sets": "Set",
      "Reps": "Repetisi",
      "Weight (kg)": "Beban (kg)",
      "Volume": "Volume",
      "Guest": "Tamu",
      "Check-in": "Check-in",
      "Nights": "Malam",
      "Nightly Rate": "Tarif per Malam",
      "Platform Fee %": "Biaya Platform %",
      "Cleaning": "Kebersihan",
      "Net Profit": "Laba Bersih",
      "Product": "Produk",
      "Price": "Harga",
      "Fee %": "Biaya %",
      "Shipping": "Ongkir",
      "Profit": "Laba",
      "Margin": "Margin",
      "City": "Kota",
      "Activity": "Kegiatan",
      "Booked": "Sudah Dipesan",
      "Notes": "Catatan",
      "Subject": "Mata Pelajaran",
      "Assignment": "Tugas",
      "Hours Planned": "Rencana Jam",
      "Grade %": "Nilai %",
      "Side": "Pihak",
      "RSVP": "Konfirmasi",
      "Party Size": "Jumlah Orang",
      "Cost per Head": "Biaya per Orang",
      "Housing": "Tempat Tinggal",
      "Food": "Makanan",
      "Transport": "Transportasi",
      "Utilities": "Tagihan Rumah",
      "Fun": "Hiburan",
      "Savings": "Tabungan",
      "Other": "Lainnya",
      "Over": "Lewat",
      "OK": "OK",
      "Reorder": "Pesan Ulang",
      "High": "Tinggi",
      "Medium": "Sedang",
      "Low": "Rendah",
      "To do": "Belum",
      "In progress": "Berjalan",
      "Blocked": "Terhambat",
      "Done": "Selesai",
      "Lead": "Prospek",
      "Contacted": "Dihubungi",
      "Proposal": "Penawaran",
      "Won": "Menang",
      "Lost": "Kalah",
      "Idea": "Ide",
      "Drafting": "Draf",
      "Scheduled": "Terjadwal",
      "Published": "Terbit",
      "Breakfast": "Sarapan",
      "Lunch": "Makan Siang",
      "Dinner": "Makan Malam",
      "Snack": "Camilan",
      "Not started": "Belum Mulai",
      "Studying": "Sedang Belajar",
      "Submitted": "Dikumpulkan",
      "Bride": "Pengantin Wanita",
      "Groom": "Pengantin Pria",
      "Both": "Keduanya",
      "Pending": "Menunggu",
      "Yes": "Yes",
      "No": "No",
      "Total planned": "Total rencana",
      "Total spent": "Total terpakai",
      "Left to spend": "Sisa anggaran",
      "Categories over": "Kategori lewat",
      "Invoiced": "Ditagihkan",
      "Invoices": "Tagihan",
      "Unpaid": "Belum lunas",
      "Worst overdue (days)": "Terlambat terlama (hari)",
      "Units in stock": "Unit di stok",
      "Stock value": "Nilai stok",
      "SKUs to reorder": "SKU perlu dipesan",
      "Tasks": "Tugas",
      "Pipeline value": "Nilai pipeline",
      "Weighted forecast": "Perkiraan berbobot",
      "Deals won": "Kesepakatan menang",
      "Habits": "Kebiasaan",
      "Average score": "Skor rata-rata",
      "Best habit score": "Skor kebiasaan terbaik",
      "Posts": "Posting",
      "Total views": "Total tayangan",
      "Meals planned": "Menu direncanakan",
      "Total calories": "Total kalori",
      "Grocery cost": "Biaya belanja",
      "Sessions logged": "Sesi tercatat",
      "Total volume": "Total volume",
      "Heaviest lift (kg)": "Beban terberat (kg)",
      "Nights booked": "Malam terpesan",
      "Net profit": "Laba bersih",
      "Average rate": "Tarif rata-rata",
      "Products": "Produk",
      "Average margin": "Margin rata-rata",
      "Lowest profit": "Laba terendah",
      "Trip budget": "Anggaran perjalanan",
      "Activities": "Kegiatan",
      "Still to book": "Belum dipesan",
      "Assignments": "Tugas",
      "Study hours": "Jam belajar",
      "Invited parties": "Undangan",
      "Confirmed": "Terkonfirmasi",
      "Catering cost": "Biaya katering",
      "Rows": "Baris",
      "Rent": "Sewa",
      "Groceries": "Belanja dapur",
      "Fuel": "Bensin",
      "Electricity": "Listrik",
      "Streaming": "Streaming",
      "Emergency fund": "Dana darurat",
      "T-shirt black M": "Kaos hitam M",
      "T-shirt white L": "Kaos putih L",
      "Logo mug": "Mug logo",
      "Snapback cap": "Topi snapback",
      "Write brief": "Tulis brief",
      "Design mockups": "Desain mockup",
      "Client review": "Review klien",
      "Fix feedback": "Perbaiki masukan",
      "Drink 2L water": "Minum 2L air",
      "Read 20 pages": "Baca 20 halaman",
      "Workout": "Olahraga",
      "No phone after 10pm": "Tanpa HP setelah jam 10 malam",
      "5 budgeting myths": "5 mitos soal anggaran",
      "Template walkthrough": "Panduan template",
      "Behind the scenes": "Di balik layar",
      "Pricing tips thread": "Thread tips harga",
      "Overnight oats": "Overnight oats",
      "Chicken rice bowl": "Nasi ayam",
      "Veggie stir-fry": "Tumis sayur",
      "Greek yogurt + fruit": "Yogurt + buah",
      "Squat": "Squat",
      "Bench press": "Bench press",
      "Deadlift": "Deadlift",
      "Pull-up": "Pull-up",
      "Digital planner": "Planner digital",
      "Sticker pack": "Paket stiker",
      "Tote bag": "Tas tote",
      "Mug": "Mug",
      "Arrive + check in villa": "Tiba + check-in villa",
      "Ubud rice terraces": "Sawah terasering Ubud",
      "Snorkel trip": "Snorkeling",
      "Fast boat": "Fast boat",
      "Airport pickup 3pm": "Jemput bandara jam 3 sore",
      "Bring reef-safe sunscreen": "Bawa sunscreen ramah terumbu",
      "Math": "Matematika",
      "Physics": "Fisika",
      "English": "Bahasa Inggris",
      "History": "Sejarah",
      "Problem set 4": "Latihan soal 4",
      "Lab report": "Laporan praktikum",
      "Essay draft": "Draf esai",
      "Quiz prep": "Persiapan kuis",
      "The Wijaya family": "Keluarga Wijaya",
      "Aunt Sari": "Tante Sari",
      "Office team": "Tim kantor"
    },
    "zh": {
      "Monthly Budget Planner": "每月预算表",
      "Freelance Invoice Tracker": "自由职业发票追踪表",
      "Inventory & Reorder Tracker": "库存与补货表",
      "Project Task Tracker": "项目任务表",
      "Sales Pipeline CRM": "销售漏斗 CRM",
      "Habit Tracker": "习惯打卡表",
      "Content Calendar": "内容日历",
      "Weekly Meal Planner": "每周餐单",
      "Workout Log": "训练日志",
      "Rental Property P&L": "出租房收支表",
      "Product Pricing & Profit Calculator": "商品定价与利润计算器",
      "Trip Itinerary & Budget": "旅行行程与预算",
      "Study Planner & Grade Tracker": "学习计划与成绩表",
      "Wedding & Event Guest List": "婚礼与活动宾客名单",
      "Custom Tracker": "自定义表格",
      "Plan vs actual spending by category with variance, over-budget flags and a dashboard.": "按类别对比计划与实际支出，显示差额、超支提醒和仪表盘。",
      "Track invoices, due dates and payments — days overdue are calculated automatically.": "追踪发票、到期日和付款——逾期天数自动计算。",
      "Stock levels, stock value and automatic reorder alerts per SKU.": "每个 SKU 的库存数量、库存价值和自动补货提醒。",
      "Tasks with owner, priority, status and due dates — overdue work turns red.": "任务附负责人、优先级、状态和截止日期——逾期任务标红。",
      "Deals by stage with probability-weighted forecast and next-step dates.": "按阶段管理商机，含按概率加权的预测和下一步日期。",
      "Track daily habits for the week and see your completion rate at a glance.": "记录一周的每日习惯，一眼看到完成率。",
      "Plan posts across platforms with status, publish dates and performance.": "跨平台规划内容，含状态、发布日期和数据表现。",
      "Plan meals, calories and grocery cost for the week.": "规划一周的餐食、热量和买菜花费。",
      "Log sets, reps and weight; training volume is calculated per exercise.": "记录组数、次数和重量；每个动作的训练量自动计算。",
      "Bookings, nightly rate, platform fees and net profit per stay.": "每次入住的预订、每晚房价、平台费用和净利润。",
      "Set prices with marketplace fees and see profit and margin per product.": "结合平台费用定价，查看每件商品的利润和利润率。",
      "Day-by-day itinerary with bookings and a running trip budget.": "逐日行程，含预订情况和实时旅行预算。",
      "Assignments, deadlines, study hours and grades in one sheet.": "作业、截止日期、学习时长和成绩集中在一张表里。",
      "Guests, RSVP status, party size and per-guest cost.": "宾客、回复状态、同行人数和人均费用。",
      "Category": "类别",
      "Item": "项目",
      "Planned": "计划",
      "Actual": "实际",
      "Difference": "差额",
      "Status": "状态",
      "Invoice #": "发票号",
      "Client": "客户",
      "Issued": "开票日",
      "Due": "到期日",
      "Amount": "金额",
      "Paid": "已付",
      "Days Overdue": "逾期天数",
      "SKU": "SKU",
      "Qty": "数量",
      "Reorder Level": "补货线",
      "Unit Cost": "单位成本",
      "Stock Value": "库存价值",
      "Reorder?": "需补货?",
      "Task": "任务",
      "Owner": "负责人",
      "Priority": "优先级",
      "Days Left": "剩余天数",
      "Company": "公司",
      "Contact": "联系人",
      "Stage": "阶段",
      "Deal Value": "商机金额",
      "Probability": "成交概率",
      "Weighted": "加权金额",
      "Next Step": "下一步",
      "Habit": "习惯",
      "Mon": "周一",
      "Tue": "周二",
      "Wed": "周三",
      "Thu": "周四",
      "Fri": "周五",
      "Sat": "周六",
      "Sun": "周日",
      "Score": "完成率",
      "Title": "标题",
      "Platform": "平台",
      "Publish Date": "发布日期",
      "Views": "浏览量",
      "Likes": "点赞",
      "Engagement": "互动率",
      "Day": "星期",
      "Meal": "餐次",
      "Dish": "菜品",
      "Calories": "热量",
      "Cost": "费用",
      "Prepped": "已备好",
      "Date": "日期",
      "Exercise": "动作",
      "Sets": "组数",
      "Reps": "次数",
      "Weight (kg)": "重量 (kg)",
      "Volume": "训练量",
      "Guest": "宾客",
      "Check-in": "入住日",
      "Nights": "晚数",
      "Nightly Rate": "每晚房价",
      "Platform Fee %": "平台费率",
      "Cleaning": "清洁费",
      "Net Profit": "净利润",
      "Product": "商品",
      "Price": "售价",
      "Fee %": "费率",
      "Shipping": "运费",
      "Profit": "利润",
      "Margin": "利润率",
      "City": "城市",
      "Activity": "活动",
      "Booked": "已预订",
      "Notes": "备注",
      "Subject": "科目",
      "Assignment": "作业",
      "Hours Planned": "计划时长",
      "Grade %": "成绩 %",
      "Side": "所属方",
      "RSVP": "回复",
      "Party Size": "人数",
      "Cost per Head": "人均费用",
      "Housing": "住房",
      "Food": "餐饮",
      "Transport": "交通",
      "Utilities": "水电",
      "Fun": "娱乐",
      "Savings": "储蓄",
      "Other": "其他",
      "Over": "超支",
      "OK": "正常",
      "Reorder": "补货",
      "High": "高",
      "Medium": "中",
      "Low": "低",
      "To do": "待办",
      "In progress": "进行中",
      "Blocked": "受阻",
      "Done": "完成",
      "Lead": "线索",
      "Contacted": "已联系",
      "Proposal": "已报价",
      "Won": "赢单",
      "Lost": "丢单",
      "Idea": "想法",
      "Drafting": "草稿中",
      "Scheduled": "已排期",
      "Published": "已发布",
      "Breakfast": "早餐",
      "Lunch": "午餐",
      "Dinner": "晚餐",
      "Snack": "加餐",
      "Not started": "未开始",
      "Studying": "学习中",
      "Submitted": "已提交",
      "Bride": "新娘方",
      "Groom": "新郎方",
      "Both": "双方",
      "Pending": "待回复",
      "Yes": "Yes",
      "No": "No",
      "Total planned": "计划总额",
      "Total spent": "已花总额",
      "Left to spend": "剩余可花",
      "Categories over": "超支类别",
      "Invoiced": "已开票",
      "Invoices": "发票数",
      "Unpaid": "未付款",
      "Worst overdue (days)": "最长逾期 (天)",
      "Units in stock": "库存件数",
      "Stock value": "库存价值",
      "SKUs to reorder": "待补货 SKU",
      "Tasks": "任务数",
      "Pipeline value": "漏斗总额",
      "Weighted forecast": "加权预测",
      "Deals won": "赢单数",
      "Habits": "习惯数",
      "Average score": "平均完成率",
      "Best habit score": "最佳习惯完成率",
      "Posts": "内容数",
      "Total views": "总浏览量",
      "Meals planned": "已规划餐数",
      "Total calories": "总热量",
      "Grocery cost": "买菜花费",
      "Sessions logged": "已记录次数",
      "Total volume": "总训练量",
      "Heaviest lift (kg)": "最大重量 (kg)",
      "Nights booked": "已订晚数",
      "Net profit": "净利润",
      "Average rate": "平均房价",
      "Products": "商品数",
      "Average margin": "平均利润率",
      "Lowest profit": "最低利润",
      "Trip budget": "旅行预算",
      "Activities": "活动数",
      "Still to book": "待预订",
      "Assignments": "作业数",
      "Study hours": "学习时长",
      "Invited parties": "受邀方",
      "Confirmed": "已确认",
      "Catering cost": "餐饮费用",
      "Rows": "行数",
      "Rent": "房租",
      "Groceries": "买菜",
      "Fuel": "油费",
      "Electricity": "电费",
      "Streaming": "视频会员",
      "Emergency fund": "应急金",
      "T-shirt black M": "黑色 T 恤 M",
      "T-shirt white L": "白色 T 恤 L",
      "Logo mug": "logo 马克杯",
      "Snapback cap": "棒球帽",
      "Write brief": "写需求文档",
      "Design mockups": "设计样稿",
      "Client review": "客户审核",
      "Fix feedback": "按反馈修改",
      "Drink 2L water": "喝 2 升水",
      "Read 20 pages": "读 20 页书",
      "Workout": "健身",
      "No phone after 10pm": "晚上 10 点后不看手机",
      "5 budgeting myths": "5 个预算误区",
      "Template walkthrough": "模板讲解",
      "Behind the scenes": "幕后花絮",
      "Pricing tips thread": "定价技巧长帖",
      "Overnight oats": "隔夜燕麦",
      "Chicken rice bowl": "鸡肉饭",
      "Veggie stir-fry": "清炒时蔬",
      "Greek yogurt + fruit": "希腊酸奶配水果",
      "Squat": "深蹲",
      "Bench press": "卧推",
      "Deadlift": "硬拉",
      "Pull-up": "引体向上",
      "Digital planner": "电子手账",
      "Sticker pack": "贴纸包",
      "Tote bag": "帆布袋",
      "Mug": "马克杯",
      "Arrive + check in villa": "抵达并入住别墅",
      "Ubud rice terraces": "乌布梯田",
      "Snorkel trip": "浮潜之旅",
      "Fast boat": "快艇",
      "Airport pickup 3pm": "下午 3 点机场接机",
      "Bring reef-safe sunscreen": "带上珊瑚友好防晒霜",
      "Math": "数学",
      "Physics": "物理",
      "English": "英语",
      "History": "历史",
      "Problem set 4": "习题集 4",
      "Lab report": "实验报告",
      "Essay draft": "论文草稿",
      "Quiz prep": "小测准备",
      "The Wijaya family": "Wijaya 一家",
      "Aunt Sari": "Sari 阿姨",
      "Office team": "公司同事"
    },
    "es": {
      "Monthly Budget Planner": "Planificador de presupuesto mensual",
      "Freelance Invoice Tracker": "Control de facturas freelance",
      "Inventory & Reorder Tracker": "Control de inventario y reposición",
      "Project Task Tracker": "Control de tareas del proyecto",
      "Sales Pipeline CRM": "CRM de ventas",
      "Habit Tracker": "Registro de hábitos",
      "Content Calendar": "Calendario de contenido",
      "Weekly Meal Planner": "Planificador de comidas semanal",
      "Workout Log": "Registro de entrenamiento",
      "Rental Property P&L": "Pérdidas y ganancias del alquiler",
      "Product Pricing & Profit Calculator": "Calculadora de precios y beneficio",
      "Trip Itinerary & Budget": "Itinerario y presupuesto del viaje",
      "Study Planner & Grade Tracker": "Planificador de estudio y notas",
      "Wedding & Event Guest List": "Lista de invitados de boda y evento",
      "Custom Tracker": "Registro personalizado",
      "Plan vs actual spending by category with variance, over-budget flags and a dashboard.": "Gasto previsto frente a real por categoría, con diferencia, avisos de exceso y un panel.",
      "Track invoices, due dates and payments — days overdue are calculated automatically.": "Controla facturas, vencimientos y pagos: los días de retraso se calculan solos.",
      "Stock levels, stock value and automatic reorder alerts per SKU.": "Existencias, valor del stock y avisos automáticos de reposición por SKU.",
      "Tasks with owner, priority, status and due dates — overdue work turns red.": "Tareas con responsable, prioridad, estado y fecha límite: lo atrasado se pone en rojo.",
      "Deals by stage with probability-weighted forecast and next-step dates.": "Oportunidades por etapa con previsión ponderada por probabilidad y fecha del siguiente paso.",
      "Track daily habits for the week and see your completion rate at a glance.": "Registra tus hábitos diarios de la semana y ve tu porcentaje de cumplimiento de un vistazo.",
      "Plan posts across platforms with status, publish dates and performance.": "Planifica publicaciones en varias plataformas con estado, fecha y rendimiento.",
      "Plan meals, calories and grocery cost for the week.": "Planifica comidas, calorías y el coste de la compra de la semana.",
      "Log sets, reps and weight; training volume is calculated per exercise.": "Anota series, repeticiones y peso; el volumen se calcula por ejercicio.",
      "Bookings, nightly rate, platform fees and net profit per stay.": "Reservas, precio por noche, comisiones y beneficio neto por estancia.",
      "Set prices with marketplace fees and see profit and margin per product.": "Fija precios con las comisiones del marketplace y ve beneficio y margen por producto.",
      "Day-by-day itinerary with bookings and a running trip budget.": "Itinerario día a día con reservas y el presupuesto del viaje al momento.",
      "Assignments, deadlines, study hours and grades in one sheet.": "Trabajos, fechas de entrega, horas de estudio y notas en una sola hoja.",
      "Guests, RSVP status, party size and per-guest cost.": "Invitados, confirmación, número de personas y coste por invitado.",
      "Category": "Categoría",
      "Item": "Concepto",
      "Planned": "Previsto",
      "Actual": "Real",
      "Difference": "Diferencia",
      "Status": "Estado",
      "Invoice #": "N.º factura",
      "Client": "Cliente",
      "Issued": "Emitida",
      "Due": "Vence",
      "Amount": "Importe",
      "Paid": "Pagada",
      "Days Overdue": "Días de retraso",
      "SKU": "SKU",
      "Qty": "Cant.",
      "Reorder Level": "Nivel de reposición",
      "Unit Cost": "Coste unitario",
      "Stock Value": "Valor del stock",
      "Reorder?": "¿Reponer?",
      "Task": "Tarea",
      "Owner": "Responsable",
      "Priority": "Prioridad",
      "Days Left": "Días restantes",
      "Company": "Empresa",
      "Contact": "Contacto",
      "Stage": "Etapa",
      "Deal Value": "Valor del trato",
      "Probability": "Probabilidad",
      "Weighted": "Ponderado",
      "Next Step": "Siguiente paso",
      "Habit": "Hábito",
      "Mon": "Lun",
      "Tue": "Mar",
      "Wed": "Mié",
      "Thu": "Jue",
      "Fri": "Vie",
      "Sat": "Sáb",
      "Sun": "Dom",
      "Score": "Puntuación",
      "Title": "Título",
      "Platform": "Plataforma",
      "Publish Date": "Fecha de publicación",
      "Views": "Visualizaciones",
      "Likes": "Me gusta",
      "Engagement": "Interacción",
      "Day": "Día",
      "Meal": "Comida",
      "Dish": "Plato",
      "Calories": "Calorías",
      "Cost": "Coste",
      "Prepped": "Preparado",
      "Date": "Fecha",
      "Exercise": "Ejercicio",
      "Sets": "Series",
      "Reps": "Repeticiones",
      "Weight (kg)": "Peso (kg)",
      "Volume": "Volumen",
      "Guest": "Invitado",
      "Check-in": "Entrada",
      "Nights": "Noches",
      "Nightly Rate": "Precio por noche",
      "Platform Fee %": "Comisión %",
      "Cleaning": "Limpieza",
      "Net Profit": "Beneficio neto",
      "Product": "Producto",
      "Price": "Precio",
      "Fee %": "Comisión %",
      "Shipping": "Envío",
      "Profit": "Beneficio",
      "Margin": "Margen",
      "City": "Ciudad",
      "Activity": "Actividad",
      "Booked": "Reservado",
      "Notes": "Notas",
      "Subject": "Asignatura",
      "Assignment": "Trabajo",
      "Hours Planned": "Horas previstas",
      "Grade %": "Nota %",
      "Side": "Lado",
      "RSVP": "Confirmación",
      "Party Size": "Personas",
      "Cost per Head": "Coste por persona",
      "Housing": "Vivienda",
      "Food": "Comida",
      "Transport": "Transporte",
      "Utilities": "Suministros",
      "Fun": "Ocio",
      "Savings": "Ahorro",
      "Other": "Otros",
      "Over": "Excedido",
      "OK": "OK",
      "Reorder": "Reponer",
      "High": "Alta",
      "Medium": "Media",
      "Low": "Baja",
      "To do": "Pendiente",
      "In progress": "En curso",
      "Blocked": "Bloqueada",
      "Done": "Hecha",
      "Lead": "Prospecto",
      "Contacted": "Contactado",
      "Proposal": "Propuesta",
      "Won": "Ganado",
      "Lost": "Perdido",
      "Idea": "Idea",
      "Drafting": "Borrador",
      "Scheduled": "Programado",
      "Published": "Publicado",
      "Breakfast": "Desayuno",
      "Lunch": "Almuerzo",
      "Dinner": "Cena",
      "Snack": "Merienda",
      "Not started": "Sin empezar",
      "Studying": "Estudiando",
      "Submitted": "Entregado",
      "Bride": "Novia",
      "Groom": "Novio",
      "Both": "Ambos",
      "Pending": "Pendiente",
      "Yes": "Yes",
      "No": "No",
      "Total planned": "Total previsto",
      "Total spent": "Total gastado",
      "Left to spend": "Queda por gastar",
      "Categories over": "Categorías excedidas",
      "Invoiced": "Facturado",
      "Invoices": "Facturas",
      "Unpaid": "Sin pagar",
      "Worst overdue (days)": "Mayor retraso (días)",
      "Units in stock": "Unidades en stock",
      "Stock value": "Valor del stock",
      "SKUs to reorder": "SKU por reponer",
      "Tasks": "Tareas",
      "Pipeline value": "Valor del embudo",
      "Weighted forecast": "Previsión ponderada",
      "Deals won": "Tratos ganados",
      "Habits": "Hábitos",
      "Average score": "Puntuación media",
      "Best habit score": "Mejor hábito",
      "Posts": "Publicaciones",
      "Total views": "Visualizaciones totales",
      "Meals planned": "Comidas planificadas",
      "Total calories": "Calorías totales",
      "Grocery cost": "Coste de la compra",
      "Sessions logged": "Sesiones registradas",
      "Total volume": "Volumen total",
      "Heaviest lift (kg)": "Mayor peso (kg)",
      "Nights booked": "Noches reservadas",
      "Net profit": "Beneficio neto",
      "Average rate": "Precio medio",
      "Products": "Productos",
      "Average margin": "Margen medio",
      "Lowest profit": "Beneficio más bajo",
      "Trip budget": "Presupuesto del viaje",
      "Activities": "Actividades",
      "Still to book": "Por reservar",
      "Assignments": "Trabajos",
      "Study hours": "Horas de estudio",
      "Invited parties": "Grupos invitados",
      "Confirmed": "Confirmados",
      "Catering cost": "Coste del catering",
      "Rows": "Filas",
      "Rent": "Alquiler",
      "Groceries": "Compra",
      "Fuel": "Gasolina",
      "Electricity": "Luz",
      "Streaming": "Streaming",
      "Emergency fund": "Fondo de emergencia",
      "T-shirt black M": "Camiseta negra M",
      "T-shirt white L": "Camiseta blanca L",
      "Logo mug": "Taza con logo",
      "Snapback cap": "Gorra snapback",
      "Write brief": "Redactar el brief",
      "Design mockups": "Diseñar maquetas",
      "Client review": "Revisión del cliente",
      "Fix feedback": "Aplicar comentarios",
      "Drink 2L water": "Beber 2 L de agua",
      "Read 20 pages": "Leer 20 páginas",
      "Workout": "Entrenar",
      "No phone after 10pm": "Sin móvil después de las 22:00",
      "5 budgeting myths": "5 mitos del presupuesto",
      "Template walkthrough": "Recorrido por la plantilla",
      "Behind the scenes": "Detrás de cámaras",
      "Pricing tips thread": "Hilo de consejos de precios",
      "Overnight oats": "Avena remojada",
      "Chicken rice bowl": "Bol de arroz con pollo",
      "Veggie stir-fry": "Salteado de verduras",
      "Greek yogurt + fruit": "Yogur griego con fruta",
      "Squat": "Sentadilla",
      "Bench press": "Press de banca",
      "Deadlift": "Peso muerto",
      "Pull-up": "Dominadas",
      "Digital planner": "Agenda digital",
      "Sticker pack": "Pack de pegatinas",
      "Tote bag": "Bolsa de tela",
      "Mug": "Taza",
      "Arrive + check in villa": "Llegada y check-in en la villa",
      "Ubud rice terraces": "Arrozales de Ubud",
      "Snorkel trip": "Excursión de snorkel",
      "Fast boat": "Barco rápido",
      "Airport pickup 3pm": "Recogida en el aeropuerto a las 15:00",
      "Bring reef-safe sunscreen": "Lleva protector solar seguro para el arrecife",
      "Math": "Matemáticas",
      "Physics": "Física",
      "English": "Inglés",
      "History": "Historia",
      "Problem set 4": "Ejercicios 4",
      "Lab report": "Informe de laboratorio",
      "Essay draft": "Borrador del ensayo",
      "Quiz prep": "Preparar el examen",
      "The Wijaya family": "La familia Wijaya",
      "Aunt Sari": "Tía Sari",
      "Office team": "Equipo de la oficina"
    }
  };

  // words that read differently per blueprint (a rental guest is not a wedding guest)
  var BLUEPRINT_L10N_OVERRIDES = {"rental": {"es": {"Guest": "Huésped"}, "zh": {"Guest": "房客"}}};

  var CUSTOM_DESCRIPTION = {"id": "Tracker kustom dibuat dari: “{prompt}”.", "zh": "根据“{prompt}”生成的自定义表格。", "es": "Registro personalizado creado a partir de: “{prompt}”."};
  var TOTAL_LABEL = {"id": "Total {name}", "zh": "{name}合计", "es": "Total {name}"};
  // Dashboard cards a Studio tweak adds ("total of Qty", "合计 数量") follow the template's language
  var AGG_LABEL = {
    id: { total: "Total {name}", average: "Rata-rata {name}", max: "{name} tertinggi", min: "{name} terendah", count: "Jumlah data {name}" },
    zh: { total: "{name}合计", average: "平均{name}", max: "最高{name}", min: "最低{name}", count: "{name}计数" },
    es: { total: "Total {name}", average: "Promedio de {name}", max: "Máximo de {name}", min: "Mínimo de {name}", count: "Recuento de {name}" }
  };
  var AGG_ALIAS = { sum: "total", avg: "average" };

  var LANG_WORDS = {
    en: ["the", "for", "my", "with", "and", "in", "of", "to", "a", "an", "our", "your", "tracker", "track", "list", "planner", "plan", "log", "monthly", "weekly", "daily"],
    id: ["untuk", "dan", "yang", "dengan", "saya", "aku", "kami", "bulanan", "mingguan", "harian", "keluarga", "anggaran", "toko", "catatan", "daftar", "pengeluaran", "keuangan", "penjualan", "barang", "tugas", "jadwal", "buat", "bikin", "di", "ke", "dari", "ini", "itu", "kebiasaan", "kos"],
    es: ["para", "mi", "mis", "de", "del", "la", "el", "los", "las", "con", "y", "un", "una", "mensual", "semanal", "diario", "gastos", "presupuesto", "inventario", "tienda", "lista", "registro", "tareas", "clientes", "ventas", "boda", "viaje", "comidas", "plantilla", "quiero", "necesito", "mis"]
  };

  // "zh" | "id" | "es" | "en", or null when the prompt gives no clue.
  function detectPromptLang(text) {
    var t = String(text || "");
    if (/[\u3400-\u9fff]/.test(t)) {
      return "zh";
    }
    var words = t.toLowerCase().split(/[^a-z\u00e0-\u00ff]+/).filter(Boolean);
    var score = { en: 0, id: 0, es: 0 };
    words.forEach(function (w) {
      Object.keys(LANG_WORDS).forEach(function (lang) {
        if (LANG_WORDS[lang].indexOf(w) !== -1) {
          score[lang] += 1;
        }
      });
    });
    if (/[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00bf\u00a1]/.test(t)) {
      score.es += 2;
    }
    var best = null;
    var top = 0;
    Object.keys(score).forEach(function (lang) {
      if (score[lang] > top) {
        best = lang;
        top = score[lang];
      } else if (score[lang] === top) {
        best = top > 0 ? null : best;
      }
    });
    return best;
  }

  // One blueprint word or sentence in another language ("Habit Tracker" -> "习惯打卡表"); unknown text stays.
  function templateText(text, lang) {
    var map = BLUEPRINT_L10N[lang];
    return map && Object.prototype.hasOwnProperty.call(map, text) ? map[text] : text;
  }

  function localizeSpec(spec, lang) {
    var base = BLUEPRINT_L10N[lang];
    if (!base || !spec || !spec.sheet) {
      return spec;
    }
    var extra = (BLUEPRINT_L10N_OVERRIDES[spec.blueprint] || {})[lang] || {};
    var map = {};
    var lowerMap = {};
    Object.keys(base).concat(Object.keys(extra)).forEach(function (k) {
      map[k] = Object.prototype.hasOwnProperty.call(extra, k) ? extra[k] : base[k];
      lowerMap[k.toLowerCase()] = map[k];
    });
    // makeColumn title-cases names ("Cost Per Head", "Weight (Kg)"), so match case-insensitively
    function tr(s) {
      if (typeof s !== "string") {
        return s;
      }
      if (Object.prototype.hasOwnProperty.call(map, s)) {
        return map[s];
      }
      return Object.prototype.hasOwnProperty.call(lowerMap, s.toLowerCase()) ? lowerMap[s.toLowerCase()] : s;
    }
    var columns = spec.sheet.columns;
    var byLowerName = {};
    columns.forEach(function (c) {
      byLowerName[c.name.toLowerCase()] = c.name;
    });
    if (spec.blueprint === "custom" && spec.prompt && /^Custom tracker generated from: /.test(spec.description || "")) {
      spec.description = CUSTOM_DESCRIPTION[lang].replace("{prompt}", clampText(spec.prompt, 120));
    }
    spec.title = tr(spec.title);
    spec.description = tr(spec.description);
    // values first (they still match the English column names)
    columns.forEach(function (c) {
      if (c.options) {
        c.options = c.options.map(tr);
      }
      if (c.type === "formula" && c.formula) {
        c.formula = c.formula.replace(/"([^"]*)"/g, function (m, lit) {
          return "\"" + tr(lit) + "\"";
        });
      }
    });
    spec.sheet.rows.forEach(function (row) {
      columns.forEach(function (c) {
        var v = row[c.id];
        if (typeof v !== "string" || !v) {
          return;
        }
        var numbered = /^(.+) (\d+)$/.exec(v);
        if (numbered && numbered[1] === c.name && tr(c.name) !== c.name) {
          row[c.id] = tr(c.name) + " " + numbered[2];
        } else {
          row[c.id] = tr(v);
        }
      });
    });
    spec.rules.forEach(function (r) {
      if (typeof r.value === "string") {
        r.value = tr(r.value);
      }
    });
    spec.summary.forEach(function (s) {
      var total = /^Total (.+)$/.exec(s.label);
      if (tr(s.label) !== s.label || Object.prototype.hasOwnProperty.call(lowerMap, s.label.toLowerCase())) {
        s.label = tr(s.label);
      } else if (total && byLowerName[total[1]]) {
        s.label = TOTAL_LABEL[lang].replace("{name}", tr(byLowerName[total[1]]));
      }
      if (s.match) {
        s.match = tr(s.match);
      }
    });
    // then the column names, keeping every reference in step
    columns.forEach(function (c) {
      var name = tr(c.name);
      if (name !== c.name) {
        renameInFormulas(spec, c.name, name);
        c.name = clampText(name, 40);
      }
    });
    spec.lang = lang;
    return spec;
  }

  function stripColumnList(text) {
    return String(text || "").replace(/\s*(?:(?:with|dengan|con|和)\s*)?(?:columns?|kolom|fields?|columnas?|campos?|列|字段)\s*[:：\-].*$/i, "");
  }

  function generate(prompt, options) {
    options = options || {};
    var text = String(prompt || "").trim();
    var lang = detectPromptLang(text) || options.lang || "en";
    var words = BLUEPRINT_L10N[lang] || {};
    var currency = detectCurrency(text) || options.currency || "USD";
    var theme = detectTheme(text);
    // "列：项目、费用" lists the user's own columns; a column called 项目 (project) must not pick a blueprint
    var listedFirst = parseListedColumns(text);
    var ranked = scoreBlueprints(listedFirst.length ? stripColumnList(text) || text : text);
    var spec;
    var notes = [];
    var quoted = /["\u201c]([^"\u201d]{3,60})["\u201d]/.exec(text);

    if (ranked[0].score > 0) {
      spec = specFromBlueprint(ranked[0].bp, { currency: currency, prompt: text });
      notes.push("Started from the \u201c" + (words[ranked[0].bp.title] || ranked[0].bp.title) + "\u201d blueprint.");
    } else {
      var listed = parseListedColumns(text);
      var names = listed.length ? listed : ["Item", "Status", "Date", "Amount", "Notes"];
      var title = titleFromPrompt(text);
      spec = {
        version: 1,
        title: clampText(title, 70),
        description: "Custom tracker generated from: \u201c" + clampText(text, 120) + "\u201d.",
        category: "Other",
        blueprint: "custom",
        theme: "mint",
        currency: currency,
        sheet: {
          name: "Data",
          columns: names.map(function (n) {
            var t = inferType(n);
            return makeColumn(n, t.type, t);
          }),
          rows: []
        },
        summary: [],
        rules: [],
        prompt: text
      };
      for (var r = 0; r < 3; r++) {
        spec.sheet.rows.push(sampleRow(spec, r));
      }
      spec.sheet.columns.forEach(function (c) {
        if (c.type === "currency" || c.type === "number") {
          spec.summary.push({ id: uid("s"), label: "Total " + c.name.toLowerCase(), fn: "SUM", column: c.name, match: "" });
        }
      });
      spec.summary.unshift({ id: uid("s"), label: "Rows", fn: "COUNTA", column: spec.sheet.columns[0].name, match: "" });
      notes.push("No matching blueprint, so I built a custom tracker from your words.");
    }

    var existing = {};
    spec.sheet.columns.forEach(function (c) {
      existing[c.name.toLowerCase()] = true;
    });
    var lower = text.toLowerCase();
    EXTRA_COLUMNS.forEach(function (pair) {
      if (pair[0].test(lower) && !existing[pair[1].toLowerCase()]) {
        var t = inferType(pair[1]);
        spec.sheet.columns.push(makeColumn(pair[1], t.type, t));
        existing[pair[1].toLowerCase()] = true;
        notes.push("Added a \u201c" + (words[pair[1]] || pair[1]) + "\u201d column.");
      }
    });
    if (theme) {
      spec.theme = theme;
      notes.push("Theme: " + themeById(theme).name + ".");
    }
    if (currency !== "USD") {
      notes.push("Currency: " + currency + ".");
    }
    if (BLUEPRINT_L10N[lang]) {
      localizeSpec(spec, lang);
      if (spec.blueprint === "custom") {
        // "Registro de mis plantas" reads better than an English "… Tracker" title
        var head = stripColumnList(text)
          .split(/[\uff0c,\u3002.;\uff1b]/)[0]
          .replace(/^(?:buat|bikin)\s+(?:template\s+)?/i, "")
          .replace(/^(?:crea|haz|genera)\s+(?:una?\s+)?(?:plantilla\s+)?(?:de\s+)?/i, "")
          .replace(/^(?:建|做|创建|生成)(?:一个|一张|个)?/, "")
          .replace(/\s+/g, " ")
          .trim();
        if (head) {
          spec.title = clampText(head.charAt(0).toUpperCase() + head.slice(1), 70);
        }
      }
    }
    if (quoted) {
      spec.title = clampText(quoted[1], 70);
    }
    return { spec: normalize(spec), notes: notes };
  }

  function sampleRow(spec, index) {
    var row = { id: uid("r") };
    spec.sheet.columns.forEach(function (c) {
      if (c.type === "formula") {
        return;
      }
      var v = "";
      if (c.type === "date") {
        v = isoFromOffset(index * 3);
      } else if (c.type === "currency") {
        v = scaleAmount([120, 45, 300][index % 3], spec.currency);
      } else if (c.type === "number") {
        v = [3, 8, 5][index % 3];
      } else if (c.type === "percent") {
        v = [0.25, 0.5, 0.8][index % 3];
      } else if (c.type === "check") {
        v = index % 2 ? "No" : "Yes";
      } else if (c.type === "select") {
        v = c.options[index % c.options.length];
      } else {
        v = c.name + " " + (index + 1);
      }
      row[c.id] = v;
    });
    return row;
  }

  // ------------------------------------------------------------------ tweak commands
  function findColumn(spec, name) {
    var n = String(name).trim().toLowerCase().replace(/^["'\u201c]|["'\u201d]$/g, "");
    var cols = spec.sheet.columns;
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].name.toLowerCase() === n) {
        return cols[i];
      }
    }
    for (var j = 0; j < cols.length; j++) {
      if (cols[j].name.toLowerCase().indexOf(n) === 0) {
        return cols[j];
      }
    }
    return null;
  }

  function renameInFormulas(spec, oldName, newName) {
    var pattern = new RegExp("\\[" + oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]", "gi");
    spec.sheet.columns.forEach(function (c) {
      if (c.type === "formula" && c.formula) {
        c.formula = c.formula.replace(pattern, "[" + newName + "]");
      }
    });
    spec.summary.forEach(function (s) {
      if (s.column.toLowerCase() === oldName.toLowerCase()) {
        s.column = newName;
      }
    });
    spec.rules.forEach(function (r) {
      if (r.column.toLowerCase() === oldName.toLowerCase()) {
        r.column = newName;
      }
    });
  }

  var TYPE_WORDS = {
    text: "text", teks: "text", number: "number", angka: "number", money: "currency", currency: "currency", uang: "currency",
    percent: "percent", persen: "percent", date: "date", tanggal: "date", dropdown: "select", select: "select", pilihan: "select",
    checkbox: "check", check: "check", "yes/no": "check", formula: "formula", rumus: "formula",
    texto: "text", "número": "number", numero: "number", moneda: "currency", dinero: "currency", porcentaje: "percent",
    fecha: "date", lista: "select", desplegable: "select", casilla: "check", "fórmula": "formula",
    "文本": "text", "文字": "text", "数字": "number", "数值": "number", "金额": "currency", "货币": "currency",
    "百分比": "percent", "日期": "date", "下拉": "select", "下拉框": "select", "复选框": "check", "勾选": "check", "公式": "formula"
  };

  // Chinese and Spanish tweak commands are rewritten into the English grammar of applyOneTweak,
  // so one parser (and one set of replies) serves every language. Unknown phrasings pass through.
  var ZH_TOTALS = {
    "合计": "total", "总计": "total", "求和": "sum", "总和": "sum", "平均": "average", "平均值": "average",
    "最大": "max", "最大值": "max", "最小": "min", "最小值": "min", "计数": "count"
  };
  var ES_TOTALS = {
    total: "total", suma: "sum", promedio: "average", media: "average", "máximo": "max", maximo: "max",
    "mínimo": "min", minimo: "min", cuenta: "count", conteo: "count"
  };
  var COLOUR_WORDS = {
    "红": "red", "红色": "red", "绿": "green", "绿色": "green", "黄": "yellow", "黄色": "yellow",
    rojo: "red", verde: "green", amarillo: "yellow"
  };

  function isTypeWord(word) {
    return !!TYPE_WORDS[String(word).toLowerCase()];
  }

  // "供应商 类型 数字 选项 A、B" / "Estado como lista con opciones A o B" → "… as … options A, B"
  function tailToEnglish(tail) {
    var out = String(tail)
      .replace(/\s*(?:类型为|类型是|类型|作为|设为)\s*:?\s*(\S+?)(?=\s*(?:选项|公式|=|$))/g, function (m, word) {
        return isTypeWord(word) ? " as " + word : m;
      })
      .replace(/\s+(?:como|de tipo|tipo)\s+(\S+)(?=\s+(?:con\s+opciones|opciones)\b|\s*=|\s*$)/gi, function (m, word) {
        return isTypeWord(word) ? " as " + word : m;
      })
      .replace(/\s*(?:选项为|选项是|选项)\s*:?\s*/g, " options ")
      .replace(/\s+(?:con\s+opciones|opciones)\s*:?\s*/gi, " options ")
      .replace(/\s*(?:公式为|公式是|公式)\s*:?\s*=?\s*/g, " = ")
      .replace(/\s+f[óo]rmula\s*:?\s*=?\s*/gi, " = ");
    out = out.replace(/ options (.+)$/, function (m, list) {
      return " options " + list.replace(/\s*或\s*/g, ", ").replace(/\s+o\s+/gi, ", ");
    });
    return out.replace(/\s+/g, " ").trim();
  }

  // Drop a trailing / leading 列 ("备注列", "列 备注") unless that is the column's real name.
  function bareColumnName(spec, name) {
    var n = String(name).trim();
    var exact = findColumn(spec, n);
    if (exact && exact.name.toLowerCase() === n.toLowerCase()) {
      return n;
    }
    return n.replace(/\s*(?:列|栏|字段)$/, "").replace(/^(?:列|栏|字段)\s*/, "").trim() || n;
  }

  var ZH_NUMBERS = { "一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  var ES_NUMBERS = { un: 1, una: 1, otra: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
  var ID_NUMBERS = { satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };

  function zhTweak(spec, text) {
    var s = text.replace(/：/g, ":").replace(/[，、]/g, ",").replace(/＝/g, "=").trim();
    var m;
    if ((m = /^(?:添加|新增|增加|加上?|再加)\s*(\d{1,3}|[一两二三四五六七八九十])?\s*(?:个)?\s*(?:新的?)?\s*(?:行|条)(?:数据|记录)?$/.exec(s))) {
      return "add " + (ZH_NUMBERS[m[1]] || m[1] || 1) + " rows";
    }
    if ((m = /^(?:添加|新增|增加|加上?)\s*(?:一个?)?\s*(?:列|栏|字段)\s*:?\s*(.+)$/.exec(s))) {
      return "add column " + tailToEnglish(m[1]);
    }
    if ((m = /^(?:添加)?\s*(合计|总计|求和|总和|平均值|平均|最大值|最大|最小值|最小|计数)\s*:?\s*(.+)$/.exec(s))) {
      return ZH_TOTALS[m[1]] + " of " + bareColumnName(spec, m[2]);
    }
    if ((m = /^(?:添加|新增|增加|加上?)\s*(?:一个?)?\s*(.+?)\s*(?:列|栏|字段)\s*((?:类型|作为|选项|公式|=).*)?$/.exec(s))) {
      return "add column " + tailToEnglish(m[1] + " " + (m[2] || ""));
    }
    if ((m = /^(?:删除|删掉|移除|去掉|去除)\s*:?\s*(.+)$/.exec(s))) {
      return "remove column " + bareColumnName(spec, m[1]);
    }
    if ((m = /^(?:把|将)?\s*(?:货币|币种)\s*(?:改为|改成|换成|设为|为|用)?\s*:?\s*(.+)$/.exec(s))) {
      return "currency " + m[1];
    }
    if ((m = /^(?:使用|改用|换成)\s*(.+)$/.exec(s)) && detectCurrency(m[1])) {
      return "currency " + m[1];
    }
    if ((m = /^(?:把|将)?\s*(?:主题|配色|颜色|风格)\s*(?:改为|改成|换成|设为|为|用)?\s*:?\s*(.+)$/.exec(s))) {
      return "theme " + m[1];
    }
    if ((m = /^(?:把|将)?\s*(?:标题|模板名称|模板名|表名)\s*(?:改为|改成|设为|为|是)?\s*:?\s*(.+)$/.exec(s)) ||
        (m = /^(?:命名为|重命名模板为)\s*:?\s*(.+)$/.exec(s))) {
      return "title " + m[1];
    }
    if ((m = /^(?:把|将)\s*(.+?)\s*(?:重命名为|重命名成|改名为|改名成|改为|改成)\s*(.+)$/.exec(s)) ||
        (m = /^(?:重命名|改名)\s*(.+?)\s*(?:为|成|到|->|→)\s*(.+)$/.exec(s))) {
      return "rename column " + bareColumnName(spec, m[1]) + " to " + m[2].trim();
    }
    if ((m = /^(?:高亮|标记|突出显示|突出|标出)\s*(.+?)\s*(小于|低于|少于|<|大于|高于|多于|超过|>|等于|=)\s*(.+?)\s*(?:时|的)?\s*(?:标为|显示为|标|为|用)?\s*(红色|红|绿色|绿|黄色|黄)?$/.exec(s))) {
      var zhOp = /小于|低于|少于|</.test(m[2]) ? "below" : /大于|高于|多于|超过|>/.test(m[2]) ? "above" : "equal to";
      return "highlight " + bareColumnName(spec, m[1]) + " " + zhOp + " " + m[3] + (m[4] ? " " + COLOUR_WORDS[m[4]] : "");
    }
    // column first: "Actual 小于 0 标红", "把 利润 低于 0 的标成红色"
    if ((m = /^(?:把|将|当)?\s*(.+?)\s*(小于|低于|少于|<|大于|高于|多于|超过|>|等于|=)\s*(.+?)\s*(?:时|的)?\s*(?:行)?\s*(?:标为|标成|标记为|显示为|设为|变|标|高亮|突出显示)\s*(?:成|为)?\s*(红色|红|绿色|绿|黄色|黄)$/.exec(s))) {
      var zhOp2 = /小于|低于|少于|</.test(m[2]) ? "below" : /大于|高于|多于|超过|>/.test(m[2]) ? "above" : "equal to";
      return "highlight " + bareColumnName(spec, m[1]) + " " + zhOp2 + " " + m[3] + " " + COLOUR_WORDS[m[5] || m[4]];
    }
    return text;
  }

  function esTweak(spec, text) {
    var s = text.trim();
    var m;
    var art = "(?:(?:el|la|los|las|un|una)\\s+)?";
    if ((m = /^(?:añad[ea]|añadir|agreg[ae]|agregar|inserta|insertar|pon)\s+(\d{1,3}|una?|otra|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)?\s*(?:nuevas?\s+)?filas?(?:\s+nuevas?)?$/i.exec(s))) {
      return "add " + (ES_NUMBERS[(m[1] || "").toLowerCase()] || m[1] || 1) + " rows";
    }
    if ((m = new RegExp("^(?:añad[ea]|añadir|agreg[ae]|agregar|inserta|insertar|crea|crear)\\s+" + art + "(?:nueva\\s+)?(?:columna|campo)\\s+(.+)$", "i").exec(s))) {
      return "add column " + tailToEnglish(m[1]);
    }
    if ((m = new RegExp("^(?:elimina|eliminar|quita|quitar|borra|borrar|suprime|suprimir)\\s+" + art + "(?:columna\\s+|campo\\s+)?(.+)$", "i").exec(s))) {
      return "remove column " + m[1];
    }
    if ((m = /^(?:t[íi]tulo|ll[áa]mal[ao]|ponle\s+de\s+nombre|renombra(?:r)?\s+la\s+(?:plantilla|hoja)\s+(?:a|como))\s*:?\s+(.+)$/i.exec(s))) {
      return "title " + m[1];
    }
    if ((m = /^(?:renombra(?:r)?|cambia(?:r)?\s+el\s+nombre\s+de)\s+(?:la\s+columna\s+|el\s+campo\s+|columna\s+)?(.+?)\s+(?:a|por|como)\s+(.+)$/i.exec(s))) {
      return "rename column " + m[1] + " to " + m[2];
    }
    if ((m = /^(?:(?:cambia(?:r)?|pon(?:er)?|usa(?:r)?)\s+(?:la\s+)?)?(?:moneda|divisa)\s*(?:a\s+|en\s+|:)?\s*(.+)$/i.exec(s))) {
      return "currency " + m[1];
    }
    if ((m = /^(?:(?:cambia(?:r)?|pon(?:er)?|usa(?:r)?)\s+(?:el\s+)?)?(?:tema|estilo|color)\b\s*(?:a\s+|en\s+|:)?\s*(.+)$/i.exec(s))) {
      return "theme " + m[1];
    }
    if ((m = new RegExp("^(?:(?:añad[ea]|agreg[ae])\\s+" + art + ")?(suma|promedio|media|m[áa]ximo|m[íi]nimo|cuenta|conteo)\\s+(?:de\\s+" + art + ")?(.+)$", "i").exec(s)) ||
        (m = new RegExp("^(?:(?:añad[ea]|agreg[ae])\\s+" + art + ")?(total)\\s+de\\s+" + art + "(.+)$", "i").exec(s))) {
      return ES_TOTALS[m[1].toLowerCase()] + " of " + m[2];
    }
    if ((m = /^(?:resalta(?:r)?|marca(?:r)?|destaca(?:r)?|colorea(?:r)?)\s+(?:la\s+columna\s+|el\s+campo\s+)?(.+?)\s+(?:cuando\s+(?:sea|est[ée])\s+)?(menor\s+que|menos\s+de|por\s+debajo\s+de|debajo\s+de|mayor\s+que|m[áa]s\s+de|por\s+encima\s+de|encima\s+de|igual\s+a)\s+(.+?)(?:\s+(?:en\s+)?(rojo|verde|amarillo))?$/i.exec(s))) {
      var esOp = /menor|menos|debajo/i.test(m[2]) ? "below" : /mayor|m[áa]s|encima/i.test(m[2]) ? "above" : "equal to";
      return "highlight " + m[1] + " " + esOp + " " + m[3] + (m[4] ? " " + COLOUR_WORDS[m[4].toLowerCase()] : "");
    }
    return text;
  }

  // Indonesian: the base parser knows tambah/hapus/ganti nama/tema/mata uang; this adds highlight and card words
  var ID_TOTALS = {
    jumlah: "sum", jumlahkan: "sum", "rata-rata": "average", ratarata: "average",
    maks: "max", maksimum: "max", tertinggi: "max", minimum: "min", terendah: "min", hitung: "count"
  };
  var ID_COLOURS = { merah: "red", hijau: "green", kuning: "yellow" };

  function idTweak(text) {
    var s = String(text).trim();
    var m;
    if ((m = /^tambah(?:kan)?\s+(satu|se|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)?\s*baris(?:\s+baru)?$/i.exec(s))) {
      return "add " + (ID_NUMBERS[(m[1] || "").toLowerCase()] || 1) + " rows";
    }
    if ((m = /^(?:sorot|tandai|warnai)\s+(?:kolom\s+)?(.+?)\s+(?:jika\s+|kalau\s+|bila\s+)?(kurang\s+dari|di\s*bawah|lebih\s+kecil\s+dari|lebih\s+besar\s+dari|lebih\s+dari|di\s*atas|sama\s+dengan)\s+(.+?)(?:\s+(?:dengan\s+|warna\s+)?(merah|hijau|kuning))?$/i.exec(s))) {
      var op = /kurang|bawah|kecil/i.test(m[2]) ? "below" : /lebih|atas/i.test(m[2]) ? "above" : "equal to";
      return "highlight " + m[1] + " " + op + " " + m[3] + (m[4] ? " " + ID_COLOURS[m[4].toLowerCase()] : "");
    }
    if ((m = /^(jumlah(?:kan)?|rata-?rata|maks(?:imum)?|tertinggi|minimum|terendah|hitung)\s+(?:dari\s+|kolom\s+|of\s+)?(.+)$/i.exec(s))) {
      var word = m[1].toLowerCase();
      return (ID_TOTALS[word] || ID_TOTALS[word.replace("-", "")] || "sum") + " of " + m[2];
    }
    return null;
  }

  function localizeTweak(spec, text) {
    if (/[\u3400-\u9fff]/.test(text)) {
      return zhTweak(spec, text);
    }
    return idTweak(text) || esTweak(spec, text);
  }

  function applyOneTweak(spec, raw) {
    var t = localizeTweak(spec, raw.trim());
    var lower = t.toLowerCase();
    var m;

    // add N rows
    if ((m = /^(?:add|tambah(?:kan)?)\s+(\d{1,3}|an?|one|another)?\s*(?:new\s+|more\s+)?(?:rows?|baris)\b/i.exec(t))) {
      var n = Math.min(200, /^\d+$/.test(m[1] || "") ? parseInt(m[1], 10) : 1);
      for (var i = 0; i < n; i++) {
        spec.sheet.rows.push(sampleRow(spec, spec.sheet.rows.length));
      }
      return n === 1 ? "Added a row." : "Added " + n + " rows.";
    }
    // add column NAME [as TYPE] [with options a, b] [= formula]
    if ((m = /^(?:add|tambah(?:kan)?)\s+(?:a\s+|an\s+)?(?:column|kolom|field)\s+(.+)$/i.exec(t))) {
      var rest = m[1];
      var formula = null;
      var opts = null;
      var type = null;
      var fm = /\s*(?:=|formula|rumus)\s*(=?.+)$/i.exec(rest);
      if (fm && /\[/.test(fm[1])) {
        formula = fm[1].replace(/^=/, "").trim();
        rest = rest.slice(0, fm.index);
      }
      var om = /\s+(?:with options|options|pilihan)\s*:?\s*(.+)$/i.exec(rest);
      if (om) {
        opts = om[1].split(/,|\bor\b|\batau\b|\//).map(function (s) {
          return titleCase(s.trim());
        }).filter(Boolean);
        rest = rest.slice(0, om.index);
      }
      var tm = /\s+(?:as|sebagai|type)\s+(?:a\s+|an\s+)?(\S+)\s*$/i.exec(rest);
      if (tm && TYPE_WORDS[tm[1].toLowerCase()]) {
        type = TYPE_WORDS[tm[1].toLowerCase()];
        rest = rest.slice(0, tm.index);
      }
      var name = rest.trim().replace(/^["'\u201c]|["'\u201d]$/g, "");
      if (!name) {
        return null;
      }
      if (findColumn(spec, name) && findColumn(spec, name).name.toLowerCase() === name.toLowerCase()) {
        return "Column \u201c" + name + "\u201d already exists.";
      }
      var inferred = inferType(name);
      if (formula) {
        type = "formula";
      }
      if (opts) {
        type = "select";
      }
      type = type || inferred.type;
      var col = makeColumn(name, type, {
        options: opts || inferred.options,
        formula: formula,
        format: formula && /%|rate|margin/.test(name.toLowerCase()) ? "percent" : "number"
      });
      if (type === "formula") {
        var check = validateFormula(spec, col.formula);
        if (check) {
          return "Formula error: " + check;
        }
      }
      spec.sheet.columns.push(col);
      return "Added column \u201c" + col.name + "\u201d (" + col.type + ").";
    }
    // remove column
    if ((m = /^(?:remove|delete|drop|hapus)\s+(?:the\s+)?(?:column|kolom)?\s*(.+)$/i.exec(t))) {
      var target = findColumn(spec, m[1]);
      if (!target) {
        return "No column named \u201c" + m[1].trim() + "\u201d.";
      }
      spec.sheet.columns = spec.sheet.columns.filter(function (c) {
        return c !== target;
      });
      spec.sheet.rows.forEach(function (r) {
        delete r[target.id];
      });
      spec.summary = spec.summary.filter(function (s) {
        return s.column.toLowerCase() !== target.name.toLowerCase();
      });
      spec.rules = spec.rules.filter(function (r) {
        return r.column.toLowerCase() !== target.name.toLowerCase();
      });
      return "Removed \u201c" + target.name + "\u201d.";
    }
    // rename template
    if ((m = /^(?:call it|title|name it|rename (?:the )?(?:template|sheet) to|judul)\s*:?\s+(.+)$/i.exec(t))) {
      spec.title = clampText(m[1].replace(/^["'\u201c]|["'\u201d]$/g, ""), 70);
      return "Renamed the template to \u201c" + spec.title + "\u201d.";
    }
    // rename column
    if ((m = /^(?:rename|ubah nama|ganti nama)\s+(?:column\s+|kolom\s+)?(.+?)\s+(?:to|jadi|menjadi)\s+(.+)$/i.exec(t))) {
      var col2 = findColumn(spec, m[1]);
      if (!col2) {
        return "No column named \u201c" + m[1] + "\u201d.";
      }
      var newName = clampText(titleCase(m[2].replace(/^["'\u201c]|["'\u201d]$/g, "")), 40);
      renameInFormulas(spec, col2.name, newName);
      var old = col2.name;
      col2.name = newName;
      return "Renamed \u201c" + old + "\u201d to \u201c" + newName + "\u201d.";
    }
    // currency
    var cur = detectCurrency(t);
    if (cur && /(currency|mata uang|in |pakai|use |switch)/.test(lower)) {
      var prev = spec.currency;
      convertCurrency(spec, prev, cur);
      return "Currency changed to " + cur + ".";
    }
    // theme
    var th = detectTheme(t);
    if (th && /(theme|tema|make it|color|colour|warna|style|look|mode)/.test(lower)) {
      spec.theme = th;
      return "Theme set to " + themeById(th).name + ".";
    }
    // total / summary
    if ((m = /^(?:add\s+)?(total|sum|average|avg|max|min|count)\s+(?:of\s+|for\s+)?(.+)$/i.exec(t))) {
      var col3 = findColumn(spec, m[2]);
      if (!col3) {
        return "No column named \u201c" + m[2] + "\u201d.";
      }
      var fnMap = { total: "SUM", sum: "SUM", average: "AVERAGE", avg: "AVERAGE", max: "MAX", min: "MIN", count: "COUNTA" };
      var fn = fnMap[m[1].toLowerCase()];
      var aggWord = m[1].toLowerCase();
      var aggLabels = AGG_LABEL[spec.lang];
      var cardLabel = aggLabels
        ? aggLabels[AGG_ALIAS[aggWord] || aggWord].replace("{name}", spec.lang === "zh" ? col3.name : col3.name.toLowerCase())
        : titleCase(m[1]) + " " + col3.name.toLowerCase();
      cardLabel = cardLabel.charAt(0).toUpperCase() + cardLabel.slice(1);
      spec.summary.push({ id: uid("s"), label: clampText(cardLabel, 40), fn: fn, column: col3.name, match: "" });
      return "Added a " + fn + " card for \u201c" + col3.name + "\u201d.";
    }
    // highlight rules: highlight Profit below 0 red
    if ((m = /^(?:highlight|warnai|flag)\s+(.+?)\s+(below|under|less than|<|above|over|more than|>|equal to|=|is)\s+(.+?)(?:\s+(red|green|yellow|amber|bad|good|warn))?$/i.exec(t))) {
      var col4 = findColumn(spec, m[1]);
      if (!col4) {
        return "No column named \u201c" + m[1] + "\u201d.";
      }
      var opWord = m[2].toLowerCase();
      var op = /below|under|less|</.test(opWord) ? "<" : /above|over|more|>/.test(opWord) ? ">" : "=";
      var rawValue = m[3].replace(/^["'\u201c]|["'\u201d]$/g, "");
      var value = isNaN(parseFloat(rawValue)) ? rawValue : parseFloat(rawValue);
      var colour = (m[4] || (op === "<" ? "red" : "green")).toLowerCase();
      var style = /red|bad/.test(colour) ? "bad" : /yellow|amber|warn/.test(colour) ? "warn" : "good";
      spec.rules.push({ id: uid("k"), column: col4.name, op: op, value: value, style: style });
      return "Highlight rule added on \u201c" + col4.name + "\u201d.";
    }
    return null;
  }

  function convertCurrency(spec, from, to) {
    var a = CURRENCIES[from] || CURRENCIES.USD;
    var b = CURRENCIES[to] || CURRENCIES.USD;
    var ratio = b.scale / a.scale;
    spec.sheet.columns.forEach(function (c) {
      if (c.type !== "currency") {
        return;
      }
      spec.sheet.rows.forEach(function (r) {
        var v = parseFloat(r[c.id]);
        if (!isNaN(v)) {
          var converted = v * ratio;
          r[c.id] = b.decimals === 0 ? Math.round(converted / (converted >= 10000 ? 1000 : 1)) * (converted >= 10000 ? 1000 : 1) : Math.round(converted * 100) / 100;
        }
      });
    });
    spec.currency = to;
  }

  function renameColumn(spec, colId, newName) {
    var name = clampText(String(newName || "").trim(), 40);
    var col = spec.sheet.columns.filter(function (c) {
      return c.id === colId;
    })[0];
    if (!col || !name) {
      return "Column names can’t be empty.";
    }
    var clash = spec.sheet.columns.some(function (c) {
      return c !== col && c.name.toLowerCase() === name.toLowerCase();
    });
    if (clash) {
      return "Another column is already called “" + name + "”.";
    }
    renameInFormulas(spec, col.name, name);
    col.name = name;
    return null;
  }

  function applyTweak(spec, text) {
    var next = clone(spec);
    var parts = String(text || "").split(/\n|;|；|。|\.\s+(?=[A-Za-z\u00c0-\u00ff])/).map(function (s) {
      return s.trim().replace(/\.$/, "");
    }).filter(Boolean);
    var messages = [];
    var understood = 0;
    parts.forEach(function (part) {
      var msg = applyOneTweak(next, part);
      if (msg) {
        understood += 1;
        messages.push(msg);
      } else {
        messages.push("Didn\u2019t understand \u201c" + part + "\u201d. Try: add column Priority \u00b7 remove column Notes \u00b7 rename Cost to Price \u00b7 add 5 rows \u00b7 theme ocean \u00b7 currency IDR \u00b7 total of Amount \u00b7 highlight Profit below 0 red.");
      }
    });
    return { spec: normalize(next), messages: messages, changed: understood > 0 };
  }

  // ------------------------------------------------------------------ formula engine
  function tokenize(src) {
    var tokens = [];
    var i = 0;
    while (i < src.length) {
      var ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "[") {
        var end = src.indexOf("]", i);
        if (end === -1) {
          throw new Error("Missing ] in column reference");
        }
        tokens.push({ t: "ref", v: src.slice(i + 1, end).trim() });
        i = end + 1;
        continue;
      }
      if (ch === "\"") {
        var j = i + 1;
        var s = "";
        while (j < src.length && src[j] !== "\"") {
          s += src[j];
          j++;
        }
        if (j >= src.length) {
          throw new Error("Unclosed text string");
        }
        tokens.push({ t: "str", v: s });
        i = j + 1;
        continue;
      }
      var num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (num) {
        tokens.push({ t: "num", v: parseFloat(num[0]) });
        i += num[0].length;
        continue;
      }
      var ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
      if (ident) {
        tokens.push({ t: "id", v: ident[0].toUpperCase() });
        i += ident[0].length;
        continue;
      }
      var two = src.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "<>") {
        tokens.push({ t: "op", v: two });
        i += 2;
        continue;
      }
      if ("+-*/^&=<>(),%".indexOf(ch) !== -1) {
        tokens.push({ t: "op", v: ch });
        i++;
        continue;
      }
      throw new Error("Unexpected character \u201c" + ch + "\u201d");
    }
    return tokens;
  }

  var FUNCTIONS = ["IF", "AND", "OR", "NOT", "ROUND", "MIN", "MAX", "ABS", "TODAY", "IFERROR", "SUM", "AVERAGE"];

  function parse(src) {
    var tokens = tokenize(String(src || "").replace(/^=/, ""));
    var pos = 0;

    function peek() {
      return tokens[pos];
    }

    function eat(value) {
      var tok = tokens[pos];
      if (!tok || (value && tok.v !== value)) {
        throw new Error("Expected " + (value || "more input"));
      }
      pos++;
      return tok;
    }

    function comparison() {
      var left = concat();
      while (peek() && peek().t === "op" && ["=", "<>", "<", ">", "<=", ">="].indexOf(peek().v) !== -1) {
        var op = eat().v;
        left = { k: "bin", op: op, a: left, b: concat() };
      }
      return left;
    }

    function concat() {
      var left = additive();
      while (peek() && peek().v === "&") {
        eat();
        left = { k: "bin", op: "&", a: left, b: additive() };
      }
      return left;
    }

    function additive() {
      var left = term();
      while (peek() && (peek().v === "+" || peek().v === "-")) {
        var op = eat().v;
        left = { k: "bin", op: op, a: left, b: term() };
      }
      return left;
    }

    function term() {
      var left = power();
      while (peek() && (peek().v === "*" || peek().v === "/")) {
        var op = eat().v;
        left = { k: "bin", op: op, a: left, b: power() };
      }
      return left;
    }

    function power() {
      var base = unary();
      if (peek() && peek().v === "^") {
        eat();
        return { k: "bin", op: "^", a: base, b: power() };
      }
      return base;
    }

    function unary() {
      if (peek() && (peek().v === "-" || peek().v === "+")) {
        var op = eat().v;
        var operand = unary();
        return op === "-" ? { k: "neg", a: operand } : operand;
      }
      var node = primary();
      if (peek() && peek().v === "%") {
        eat();
        node = { k: "bin", op: "/", a: node, b: { k: "num", v: 100 } };
      }
      return node;
    }

    function primary() {
      var tok = peek();
      if (!tok) {
        throw new Error("Formula ended early");
      }
      if (tok.t === "num") {
        eat();
        return { k: "num", v: tok.v };
      }
      if (tok.t === "str") {
        eat();
        return { k: "str", v: tok.v };
      }
      if (tok.t === "ref") {
        eat();
        return { k: "ref", v: tok.v };
      }
      if (tok.t === "id") {
        eat();
        if (tok.v === "TRUE" || tok.v === "FALSE") {
          return { k: "bool", v: tok.v === "TRUE" };
        }
        if (FUNCTIONS.indexOf(tok.v) === -1) {
          throw new Error("Unknown function " + tok.v);
        }
        eat("(");
        var args = [];
        if (peek() && peek().v !== ")") {
          args.push(comparison());
          while (peek() && peek().v === ",") {
            eat();
            args.push(comparison());
          }
        }
        eat(")");
        return { k: "fn", name: tok.v, args: args };
      }
      if (tok.v === "(") {
        eat();
        var inner = comparison();
        eat(")");
        return { k: "group", a: inner };
      }
      throw new Error("Unexpected \u201c" + tok.v + "\u201d");
    }

    var ast = comparison();
    if (pos !== tokens.length) {
      throw new Error("Unexpected \u201c" + tokens[pos].v + "\u201d");
    }
    return ast;
  }

  function collectRefs(ast, out) {
    out = out || [];
    if (!ast) {
      return out;
    }
    if (ast.k === "ref") {
      out.push(ast.v);
    }
    ["a", "b"].forEach(function (key) {
      if (ast[key]) {
        collectRefs(ast[key], out);
      }
    });
    (ast.args || []).forEach(function (arg) {
      collectRefs(arg, out);
    });
    return out;
  }

  function validateFormula(spec, formula, selfName) {
    try {
      var ast = parse(formula);
      var refs = collectRefs(ast);
      for (var i = 0; i < refs.length; i++) {
        var col = findExact(spec, refs[i]);
        if (!col) {
          return "unknown column [" + refs[i] + "]";
        }
        if (selfName && col.name.toLowerCase() === selfName.toLowerCase()) {
          return "a column cannot reference itself";
        }
      }
      return null;
    } catch (err) {
      return err.message;
    }
  }

  function findExact(spec, name) {
    var n = String(name).toLowerCase();
    var cols = spec.sheet.columns;
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].name.toLowerCase() === n) {
        return cols[i];
      }
    }
    return null;
  }

  function toNumber(v) {
    if (typeof v === "number") {
      return v;
    }
    if (typeof v === "boolean") {
      return v ? 1 : 0;
    }
    if (v === "" || v === null || v === undefined) {
      return 0;
    }
    var n = parseFloat(v);
    if (isNaN(n)) {
      throw new Error("#VALUE!");
    }
    return n;
  }

  function truthy(v) {
    if (typeof v === "string") {
      if (v.toUpperCase() === "TRUE") {
        return true;
      }
      if (v === "" || v.toUpperCase() === "FALSE") {
        return false;
      }
      return toNumber(v) !== 0;
    }
    return !!toNumber(v);
  }

  function compare(a, b, op) {
    var bothNumeric = (typeof a === "number" || a === "" || typeof a === "boolean") && (typeof b === "number" || b === "" || typeof b === "boolean");
    var x = a;
    var y = b;
    if (bothNumeric) {
      x = toNumber(a);
      y = toNumber(b);
    } else {
      x = String(a).toLowerCase();
      y = String(b).toLowerCase();
    }
    switch (op) {
      case "=": return x === y;
      case "<>": return x !== y;
      case "<": return x < y;
      case ">": return x > y;
      case "<=": return x <= y;
      default: return x >= y;
    }
  }

  function evaluate(ast, lookup) {
    switch (ast.k) {
      case "num":
        return ast.v;
      case "str":
        return ast.v;
      case "bool":
        return ast.v;
      case "ref":
        return lookup(ast.v);
      case "group":
        return evaluate(ast.a, lookup);
      case "neg":
        return -toNumber(evaluate(ast.a, lookup));
      case "bin": {
        var a = evaluate(ast.a, lookup);
        var b = evaluate(ast.b, lookup);
        switch (ast.op) {
          case "+": return toNumber(a) + toNumber(b);
          case "-": return toNumber(a) - toNumber(b);
          case "*": return toNumber(a) * toNumber(b);
          case "/":
            if (toNumber(b) === 0) {
              throw new Error("#DIV/0!");
            }
            return toNumber(a) / toNumber(b);
          case "^": return Math.pow(toNumber(a), toNumber(b));
          case "&": return String(a) + String(b);
          default: return compare(a, b, ast.op);
        }
      }
      case "fn":
        return callFn(ast, lookup);
      default:
        throw new Error("Bad formula");
    }
  }

  function callFn(ast, lookup) {
    var args = ast.args;
    function val(i) {
      return evaluate(args[i], lookup);
    }
    switch (ast.name) {
      case "IF":
        return truthy(val(0)) ? (args.length > 1 ? val(1) : true) : (args.length > 2 ? val(2) : false);
      case "AND":
        return args.every(function (a) {
          return truthy(evaluate(a, lookup));
        });
      case "OR":
        return args.some(function (a) {
          return truthy(evaluate(a, lookup));
        });
      case "NOT":
        return !truthy(val(0));
      case "ROUND": {
        var digits = args.length > 1 ? toNumber(val(1)) : 0;
        var f = Math.pow(10, digits);
        var x = toNumber(val(0)) * f;
        return (x < 0 ? -Math.round(-x) : Math.round(x)) / f;
      }
      case "MIN":
        return Math.min.apply(null, args.map(function (a) {
          return toNumber(evaluate(a, lookup));
        }));
      case "MAX":
        return Math.max.apply(null, args.map(function (a) {
          return toNumber(evaluate(a, lookup));
        }));
      case "SUM":
        return args.reduce(function (acc, a) {
          return acc + toNumber(evaluate(a, lookup));
        }, 0);
      case "AVERAGE":
        return args.reduce(function (acc, a) {
          return acc + toNumber(evaluate(a, lookup));
        }, 0) / (args.length || 1);
      case "ABS":
        return Math.abs(toNumber(val(0)));
      case "TODAY":
        return todaySerial();
      case "IFERROR":
        try {
          return val(0);
        } catch (err) {
          return val(1);
        }
      default:
        throw new Error("Unknown function " + ast.name);
    }
  }

  // Excel formula text for one row (cell refs like E7).
  function toExcel(ast, refFor) {
    switch (ast.k) {
      case "num":
        return String(ast.v);
      case "str":
        return "\"" + ast.v.replace(/"/g, "\"\"") + "\"";
      case "bool":
        return ast.v ? "TRUE" : "FALSE";
      case "ref":
        return refFor(ast.v);
      case "group":
        return "(" + toExcel(ast.a, refFor) + ")";
      case "neg":
        return "-" + toExcel(ast.a, refFor);
      case "bin":
        return toExcel(ast.a, refFor) + ast.op + toExcel(ast.b, refFor);
      case "fn":
        return ast.name + "(" + ast.args.map(function (a) {
          return toExcel(a, refFor);
        }).join(",") + ")";
      default:
        return "";
    }
  }

  // ------------------------------------------------------------------ compute
  function cellValue(col, raw) {
    if (col.type === "date") {
      var serial = serialFromIso(raw);
      return serial === null ? "" : serial;
    }
    if (col.type === "number" || col.type === "currency" || col.type === "percent") {
      if (raw === "" || raw === null || raw === undefined) {
        return "";
      }
      var n = parseFloat(raw);
      return isNaN(n) ? String(raw) : n;
    }
    return raw === undefined || raw === null ? "" : raw;
  }

  function formatValue(value, format, currency) {
    if (value === "" || value === null || value === undefined) {
      return "";
    }
    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }
    if (typeof value === "string" && format !== "date") {
      return value;
    }
    var c = CURRENCIES[currency] || CURRENCIES.USD;
    var n = typeof value === "number" ? value : parseFloat(value);
    if (isNaN(n)) {
      return String(value);
    }
    if (format === "currency") {
      var fixed = Math.abs(n).toFixed(c.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, c.decimals === 0 ? "." : ",");
      return (n < 0 ? "-" : "") + c.symbol + (c.symbol.length > 1 ? " " : "") + fixed;
    }
    if (format === "percent") {
      return (Math.round(n * 1000) / 10) + "%";
    }
    if (format === "date") {
      return typeof value === "number" ? isoFromSerial(value) : String(value);
    }
    var rounded = Math.round(n * 100) / 100;
    return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function columnFormat(col) {
    if (col.type === "formula") {
      return col.format || "number";
    }
    if (col.type === "currency" || col.type === "percent" || col.type === "date" || col.type === "number") {
      return col.type;
    }
    return "text";
  }

  function ruleMatches(rule, value) {
    try {
      var target = rule.value;
      if (typeof value === "number" && !isNaN(parseFloat(target))) {
        target = parseFloat(target);
      }
      return compare(value, target, rule.op === "=" ? "=" : rule.op);
    } catch (err) {
      return false;
    }
  }

  function compute(spec) {
    var cols = spec.sheet.columns;
    var asts = {};
    var errors = {};
    cols.forEach(function (c) {
      if (c.type === "formula") {
        var problem = validateFormula(spec, c.formula, c.name);
        if (problem) {
          errors[c.id] = problem;
        } else {
          asts[c.id] = parse(c.formula);
        }
      }
    });
    var rows = spec.sheet.rows.map(function (row) {
      var values = {};
      var computing = {};
      function lookup(name) {
        var col = findExact(spec, name);
        if (!col) {
          throw new Error("#REF!");
        }
        return valueOf(col);
      }
      function valueOf(col) {
        if (col.id in values) {
          return values[col.id];
        }
        if (col.type !== "formula") {
          values[col.id] = cellValue(col, row[col.id]);
          return values[col.id];
        }
        if (errors[col.id]) {
          throw new Error("#ERROR");
        }
        if (computing[col.id]) {
          throw new Error("#CIRCULAR");
        }
        computing[col.id] = true;
        var v = evaluate(asts[col.id], lookup);
        values[col.id] = v;
        return v;
      }
      var cells = cols.map(function (col) {
        var value;
        var error = null;
        try {
          value = valueOf(col);
        } catch (err) {
          error = err.message.charAt(0) === "#" ? err.message : "#ERROR";
          value = error;
          values[col.id] = error;
        }
        var fmt = columnFormat(col);
        var display = error || formatValue(value, fmt, spec.currency);
        var style = "";
        if (!error) {
          spec.rules.forEach(function (rule) {
            if (rule.column.toLowerCase() === col.name.toLowerCase() && ruleMatches(rule, value)) {
              style = rule.style;
            }
          });
        }
        return { col: col, value: value, display: display, style: style, error: error };
      });
      return { id: row.id, cells: cells };
    });
    var summary = spec.summary.map(function (s) {
      var colIndex = -1;
      for (var i = 0; i < cols.length; i++) {
        if (cols[i].name.toLowerCase() === String(s.column).toLowerCase()) {
          colIndex = i;
        }
      }
      if (colIndex === -1) {
        return { label: s.label, display: "\u2014", value: null };
      }
      var vals = rows.map(function (r) {
        return r.cells[colIndex].value;
      }).filter(function (v) {
        return v !== "" && v !== null && !(typeof v === "string" && v.charAt(0) === "#");
      });
      var nums = vals.filter(function (v) {
        return typeof v === "number";
      });
      var result;
      switch (s.fn) {
        case "SUM": result = nums.reduce(function (a, b) { return a + b; }, 0); break;
        case "AVERAGE": result = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : 0; break;
        case "MIN": result = nums.length ? Math.min.apply(null, nums) : 0; break;
        case "MAX": result = nums.length ? Math.max.apply(null, nums) : 0; break;
        case "COUNTA": result = vals.length; break;
        case "COUNTIF":
          result = vals.filter(function (v) {
            return String(v).toLowerCase() === String(s.match).toLowerCase();
          }).length;
          break;
        default: result = 0;
      }
      var fmt = s.fn === "COUNTA" || s.fn === "COUNTIF" ? "number" : columnFormat(cols[colIndex]);
      return { label: s.label, value: result, display: formatValue(result, fmt === "text" ? "number" : fmt, spec.currency) };
    });
    return { rows: rows, summary: summary, errors: errors };
  }

  // ------------------------------------------------------------------ normalize / validate imported specs
  function normalize(raw) {
    raw = raw || {};
    var spec = {
      version: 1,
      title: clampText(raw.title || "Untitled template", 70),
      description: clampText(raw.description || "", 500),
      category: CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : "Other",
      blueprint: clampText(raw.blueprint || "custom", 30),
      theme: themeById(raw.theme).id,
      currency: CURRENCIES[raw.currency] ? raw.currency : "USD",
      prompt: clampText(raw.prompt || "", 400),
      sheet: { name: "Data", columns: [], rows: [] },
      summary: [],
      rules: []
    };
    // the language a template was written in, so later Studio tweaks label new cards the same way
    if (BLUEPRINT_L10N[raw.lang]) {
      spec.lang = raw.lang;
    }
    var seen = {};
    var srcCols = (raw.sheet && raw.sheet.columns) || [];
    srcCols.slice(0, 30).forEach(function (c) {
      var name = clampText(c && c.name, 40).trim();
      if (!name || seen[name.toLowerCase()]) {
        return;
      }
      seen[name.toLowerCase()] = true;
      var type = ["text", "number", "currency", "percent", "date", "select", "check", "formula"].indexOf(c.type) !== -1 ? c.type : "text";
      var col = { id: clampText(c.id || uid("c"), 24), name: name, type: type };
      if (type === "select") {
        col.options = (Array.isArray(c.options) && c.options.length ? c.options : DEFAULT_OPTIONS.status).slice(0, 20).map(function (o) {
          return clampText(o, 40);
        });
      }
      if (type === "formula") {
        col.formula = clampText(c.formula || "0", 400);
        col.format = ["number", "currency", "percent", "text", "date"].indexOf(c.format) !== -1 ? c.format : "number";
      }
      spec.sheet.columns.push(col);
    });
    if (!spec.sheet.columns.length) {
      spec.sheet.columns.push(makeColumn("Item", "text"));
    }
    var ids = {};
    spec.sheet.columns.forEach(function (c) {
      ids[c.id] = true;
    });
    var srcRows = (raw.sheet && raw.sheet.rows) || [];
    srcRows.slice(0, 500).forEach(function (r) {
      var row = { id: clampText((r && r.id) || uid("r"), 24) };
      Object.keys(r || {}).forEach(function (k) {
        if (ids[k]) {
          var v = r[k];
          row[k] = typeof v === "number" ? v : clampText(v, 200);
        }
      });
      spec.sheet.rows.push(row);
    });
    (raw.summary || []).slice(0, 12).forEach(function (s) {
      if (!s || !s.column) {
        return;
      }
      spec.summary.push({
        id: clampText(s.id || uid("s"), 24),
        label: clampText(s.label || s.fn, 40),
        fn: ["SUM", "AVERAGE", "MIN", "MAX", "COUNTA", "COUNTIF"].indexOf(s.fn) !== -1 ? s.fn : "SUM",
        column: clampText(s.column, 40),
        match: clampText(s.match === undefined ? "" : s.match, 40)
      });
    });
    (raw.rules || []).slice(0, 20).forEach(function (r) {
      if (!r || !r.column) {
        return;
      }
      spec.rules.push({
        id: clampText(r.id || uid("k"), 24),
        column: clampText(r.column, 40),
        op: ["<", ">", "="].indexOf(r.op) !== -1 ? r.op : "=",
        value: typeof r.value === "number" ? r.value : clampText(r.value, 40),
        style: ["good", "bad", "warn"].indexOf(r.style) !== -1 ? r.style : "good"
      });
    });
    return spec;
  }

  // ------------------------------------------------------------------ marketing kit
  function promoKit(listing, link) {
    var title = listing.title;
    var price = listing.price > 0 ? formatValue(listing.price, "currency", listing.currency) : "free";
    var cols = (listing.spec && listing.spec.sheet.columns || []).slice(0, 4).map(function (c) {
      return c.name;
    }).join(", ");
    var tag = "#" + String(listing.category || "templates").toLowerCase().replace(/[^a-z]/g, "") + " #spreadsheet #googlesheets #excel #productivity";
    return {
      x: "I stopped tracking " + String(listing.category || "this").toLowerCase() + " stuff by hand. \u201c" + title + "\u201d (" + price + ") does it for me \u2014 " + (cols ? cols + " and auto totals." : "auto totals and color flags.") + "\n\n" + link + "\n" + tag,
      linkedin: "Small systems compound.\n\nI\u2019ve been using \u201c" + title + "\u201d to keep " + String(listing.category || "work").toLowerCase() + " under control:\n\u2022 one sheet, no setup\n\u2022 formulas and color flags already built\n\u2022 works in Excel and Google Sheets\n\nGrab it here (" + price + "): " + link,
      tiktok: "SCENE 1 (hook, 2s): \u201cStop rebuilding this spreadsheet every month.\u201d\nSCENE 2 (demo, 8s): Screen-record typing one row \u2014 totals and colors update instantly.\nSCENE 3 (proof, 4s): Zoom on the dashboard cards.\nSCENE 4 (CTA, 3s): \u201c" + title + " \u2014 link in bio.\u201d\nCaption: " + title + " \ud83d\udc47 " + link + " " + tag,
      blog: "# How to set up a " + title.toLowerCase() + " in 10 minutes\n\n1. Why a spreadsheet beats an app for this\n2. The columns that matter (" + (cols || "the essentials") + ")\n3. Formulas that save time\n4. Common mistakes\n5. Free vs ready-made template \u2014 get \u201c" + title + "\u201d: " + link + "\n\nSEO keywords: " + title.toLowerCase() + ", " + title.toLowerCase() + " template, google sheets " + String(listing.category || "").toLowerCase() + " template",
      pinterest: title + " | Google Sheets & Excel template \u2014 " + (listing.description || "") + " " + link,
      whatsapp: "Hai! Aku pakai template \u201c" + title + "\u201d buat ngatur " + String(listing.category || "kerjaan").toLowerCase() + ", praktis banget. Cek di sini: " + link
    };
  }


  // ------------------------------------------------------------------ AI prompt (shared by the app and the Mint API)
  function aiSystemPrompt() {
    return "You design practical, ready-to-use spreadsheet templates for small businesses, freelancers and students. " +
      "Answer in the user's language for titles and column names. " + "Return ONLY JSON: {\"title\":str,\"description\":str,\"category\":one of " + JSON.stringify(CATEGORIES) +
      ",\"theme\":one of " + JSON.stringify(THEMES.map(function (t) { return t.id; })) +
      ",\"currency\":ISO code,\"sheet\":{\"columns\":[{\"id\":\"c1\",\"name\":str,\"type\":\"text|number|currency|percent|date|select|check|formula\",\"options\":[str] (select only),\"formula\":\"uses [Column Name], + - * / & = <> < > , IF AND OR NOT ROUND MIN MAX ABS TODAY IFERROR\" (formula only),\"format\":\"number|currency|percent|text\" (formula only)}],\"rows\":[{\"c1\":value}]},\"summary\":[{\"label\":str,\"fn\":\"SUM|AVERAGE|MIN|MAX|COUNTA|COUNTIF\",\"column\":column name,\"match\":str}],\"rules\":[{\"column\":name,\"op\":\"<|>|=\",\"value\":num or str,\"style\":\"good|bad|warn\"}]}. Dates as yyyy-mm-dd, check values Yes/No, 4-6 realistic sample rows, 4-9 columns.";
  }

  root.MintCore = {
    version: "1.0.0",
    THEMES: THEMES,
    CURRENCIES: CURRENCIES,
    CATEGORIES: CATEGORIES,
    BLUEPRINTS: BLUEPRINTS,
    uid: uid,
    clone: clone,
    themeById: themeById,
    blueprintById: blueprintById,
    specFromBlueprint: specFromBlueprint,
    generate: generate,
    detectPromptLang: detectPromptLang,
    localizeSpec: localizeSpec,
    templateText: templateText,
    applyTweak: applyTweak,
    renameColumn: renameColumn,
    makeColumn: makeColumn,
    inferType: inferType,
    sampleRow: sampleRow,
    parse: parse,
    evaluate: evaluate,
    toExcel: toExcel,
    collectRefs: collectRefs,
    validateFormula: validateFormula,
    compute: compute,
    formatValue: formatValue,
    columnFormat: columnFormat,
    normalize: normalize,
    serialFromIso: serialFromIso,
    isoFromSerial: isoFromSerial,
    todaySerial: todaySerial,
    promoKit: promoKit,
    aiSystemPrompt: aiSystemPrompt
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
