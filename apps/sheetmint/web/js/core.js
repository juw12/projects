/*
 * Sheetmint core — template model, prompt → template generator, tweak commands,
 * a safe spreadsheet formula engine (no eval), themes and promo-copy generator.
 * Pure functions, no DOM. Exposed as globalThis.SheetmintCore.
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
    mint: ["mint", "teal", "fresh"],
    ocean: ["ocean", "blue", "biru", "navy"],
    sunset: ["sunset", "orange", "oranye", "warm"],
    lavender: ["lavender", "purple", "ungu", "violet"],
    blush: ["blush", "pink", "pastel", "cute", "aesthetic", "girly"],
    forest: ["forest", "green", "hijau", "nature"],
    mono: ["mono", "minimal", "minimalist", "black and white", "clean", "simple"],
    midnight: ["midnight", "dark", "gelap", "night"]
  };

  var CURRENCIES = {
    USD: { symbol: "$", locale: "en-US", scale: 1, decimals: 2 },
    IDR: { symbol: "Rp", locale: "id-ID", scale: 15000, decimals: 0 },
    EUR: { symbol: "\u20ac", locale: "de-DE", scale: 0.92, decimals: 2 },
    GBP: { symbol: "\u00a3", locale: "en-GB", scale: 0.79, decimals: 2 },
    SGD: { symbol: "S$", locale: "en-SG", scale: 1.35, decimals: 2 },
    MYR: { symbol: "RM", locale: "ms-MY", scale: 4.7, decimals: 2 },
    JPY: { symbol: "\u00a5", locale: "ja-JP", scale: 150, decimals: 0 },
    CNY: { symbol: "\u00a5", locale: "zh-CN", scale: 7.2, decimals: 2 }
  };

  var CURRENCY_WORDS = [
    [/\b(idr|rupiah|rp)\b/, "IDR"],
    [/\b(eur|euro|euros)\b|\u20ac/, "EUR"],
    [/\b(gbp|pound|pounds|sterling)\b|\u00a3/, "GBP"],
    [/\b(sgd|singapore dollar)\b/, "SGD"],
    [/\b(myr|ringgit)\b/, "MYR"],
    [/\b(jpy|yen)\b/, "JPY"],
    [/\b(cny|rmb|yuan|renminbi)\b/, "CNY"],
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
    if (/(date|deadline|due|tanggal|start|end|day|tgl)/.test(n)) {
      return { type: "date" };
    }
    if (/(price|cost|amount|total|budget|revenue|fee|salary|harga|biaya|jumlah uang|value|income|expense|paid amount|setoran|iuran|gaji|bayar|nominal|modal|omzet|tagihan)/.test(n)) {
      return { type: "currency" };
    }
    if (/(%|percent|rate|margin|probability|persen)/.test(n)) {
      return { type: "percent" };
    }
    if (/(qty|quantity|count|hours|jam|stok|stock|units|score|minutes|reps|sets|kg|weight|number|nomor)/.test(n)) {
      return { type: "number" };
    }
    if (/(done|paid|complete|selesai|lunas|yes\/no|checked)/.test(n)) {
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
      bp.keywords.forEach(function (k) {
        if (lower.indexOf(k) !== -1) {
          score += k.length > 5 ? 3 : 2;
        }
      });
      return { bp: bp, score: score };
    }).sort(function (a, b) {
      return b.score - a.score;
    });
  }

  function parseListedColumns(text) {
    var m = /(?:columns?|kolom|fields?)\s*[:\-]\s*([^.\n]+)/i.exec(text);
    if (!m) {
      m = /\bwith\s+([a-z0-9 ,&/'%()-]+?(?:,| and )[a-z0-9 ,&/'%()-]+)$/i.exec(text.trim());
    }
    if (!m) {
      return [];
    }
    return m[1].split(/,|\band\b|\bdan\b|&/i).map(function (s) {
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

  function generate(prompt, options) {
    options = options || {};
    var text = String(prompt || "").trim();
    var currency = detectCurrency(text) || options.currency || "USD";
    var theme = detectTheme(text);
    var ranked = scoreBlueprints(text);
    var spec;
    var notes = [];
    var quoted = /["\u201c]([^"\u201d]{3,60})["\u201d]/.exec(text);

    if (ranked[0].score > 0) {
      spec = specFromBlueprint(ranked[0].bp, { currency: currency, prompt: text });
      notes.push("Started from the \u201c" + ranked[0].bp.title + "\u201d blueprint.");
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
        notes.push("Added a \u201c" + pair[1] + "\u201d column.");
      }
    });
    if (theme) {
      spec.theme = theme;
      notes.push("Theme: " + themeById(theme).name + ".");
    }
    if (currency !== "USD") {
      notes.push("Currency: " + currency + ".");
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
    checkbox: "check", check: "check", "yes/no": "check", formula: "formula", rumus: "formula"
  };

  function applyOneTweak(spec, raw) {
    var t = raw.trim();
    var lower = t.toLowerCase();
    var m;

    // add N rows
    if ((m = /^(?:add|tambah(?:kan)?)\s+(\d{1,3})\s+(?:rows?|baris)/i.exec(t))) {
      var n = Math.min(200, parseInt(m[1], 10));
      for (var i = 0; i < n; i++) {
        spec.sheet.rows.push(sampleRow(spec, spec.sheet.rows.length));
      }
      return "Added " + n + " rows.";
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
      var tm = /\s+(?:as|sebagai|type)\s+(?:a\s+|an\s+)?([a-z/]+)\s*$/i.exec(rest);
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
      spec.summary.push({ id: uid("s"), label: titleCase(m[1]) + " " + col3.name.toLowerCase(), fn: fn, column: col3.name, match: "" });
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
    var parts = String(text || "").split(/\n|;|\.\s+(?=[A-Za-z])/).map(function (s) {
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

  root.SheetmintCore = {
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
    promoKit: promoKit
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
