"use strict";
// Spoken-expense parser shared with Tally ("coffee 25k and taxi 50 ribu yesterday").
// Wrapped so its helpers stay private; Mint uses window.TallyParse.parseExpenses.
(function () {
// Turns a spoken sentence into one or more expenses.
// "lunch 120 and grab 35 yesterday" -> [{amount:120, desc:"Lunch", cat:"Food"}, {amount:35, desc:"Grab", cat:"Transport"}]

const CATEGORIES = {
  Food: ["lunch", "dinner", "breakfast", "brunch", "food", "coffee", "tea", "boba", "cafe", "restaurant", "snack", "meal", "pizza", "burger", "starbucks", "mcdonald", "kfc", "makan", "kopi", "drink", "beer", "sarapan", "jajan", "bakso", "nasi",
    "午餐", "晚餐", "早餐", "早午餐", "宵夜", "咖啡", "奶茶", "飲料", "饮料", "便當", "便当", "吃飯", "吃饭", "午饭", "晚饭", "早饭", "外賣", "外卖", "餐"],
  Groceries: ["grocery", "groceries", "supermarket", "market", "costco", "walmart", "seveneleven", "family mart", "familymart", "indomaret", "alfamart", "fruit", "vegetables", "sayur", "buah", "pasar",
    "超市", "全聯", "全联", "家樂福", "家乐福", "全家", "萊爾富", "買菜", "买菜", "水果"],
  Transport: ["taxi", "uber", "grab", "gojek", "lyft", "bus", "train", "mrt", "metro", "subway", "gas", "fuel", "petrol", "bensin", "parking", "toll", "ticket", "fare", "ojek", "parkir", "tol", "angkot", "kereta",
    "計程車", "计程车", "出租车", "打車", "打车", "捷運", "地鐵", "地铁", "公車", "公交", "高鐵", "高铁", "火車", "火车", "加油", "停車", "停车", "油錢", "油钱"],
  Shopping: ["shopping", "clothes", "shirt", "shoes", "amazon", "shopee", "tokopedia", "lazada", "gift", "book", "gadget", "baju", "sepatu", "belanja",
    "衣服", "鞋", "購物", "购物", "網購", "网购", "蝦皮", "淘宝", "淘寶", "禮物", "礼物", "書", "书"],
  Bills: ["bill", "rent", "electricity", "water bill", "internet", "phone bill", "wifi", "subscription", "netflix", "spotify", "insurance", "listrik", "pulsa", "kos", "sewa", "tagihan", "air pdam",
    "電費", "电费", "水費", "水费", "房租", "網路費", "网费", "電話費", "话费", "訂閱", "订阅", "保險", "保险"],
  Health: ["doctor", "medicine", "pharmacy", "hospital", "clinic", "dentist", "gym", "vitamin", "obat", "dokter", "apotek", "rumah sakit",
    "醫生", "医生", "看病", "藥", "药", "診所", "诊所", "醫院", "医院", "牙醫", "牙医", "健身"],
  Entertainment: ["movie", "cinema", "game", "concert", "karaoke", "party", "bar", "bioskop", "nonton",
    "電影", "电影", "遊戲", "游戏", "唱歌", "演唱會", "演唱会", "ktv"],
  Travel: ["hotel", "flight", "airbnb", "airline", "trip", "tiket pesawat", "liburan",
    "飯店", "酒店", "住宿", "機票", "机票", "旅行", "旅遊", "旅游"],
};

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE_WORDS = { hundred: 100, thousand: 1000, million: 1000000 };

// "one hundred twenty five" -> "125"
function wordsToDigits(text) {
  const tokens = text.split(/\s+/);
  const out = [];
  let total = 0;
  let current = 0;
  let inNumber = false;
  const flush = () => {
    if (inNumber) {
      out.push(String(total + current));
    }
    total = 0;
    current = 0;
    inNumber = false;
  };
  for (const token of tokens) {
    const word = token.replace(/-/g, "");
    if (word in NUMBER_WORDS) {
      current += NUMBER_WORDS[word];
      inNumber = true;
    } else if (word in SCALE_WORDS && inNumber) {
      if (SCALE_WORDS[word] === 100) {
        current *= 100;
      } else {
        total += current * SCALE_WORDS[word];
        current = 0;
      }
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(" ");
}

function normalize(text) {
  let t = " " + text.toLowerCase().trim() + " ";
  t = t.replace(/\b(?:7|seven)[\s-]?(?:eleven|11)\b/g, "seveneleven");
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(\w+)/g, "$1 $2");
  t = wordsToDigits(t);
  t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");   // 1,250 -> 1250
  t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");   // 1,250,000 needs a second pass
  t = t.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2");  // 1.250 (thousands dot) -> 1250
  t = t.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2");
  t = t.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2"); // 12,50 -> 12.50
  return " " + t.replace(/\s+/g, " ").trim() + " ";
}

function isoDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DATE_PATTERNS = [
  [/\b(the )?day before yesterday\b|\bkemarin lusa\b|前天/, () => 2],
  [/(\d+)\s*(?:天前|hari (?:yang )?lalu)/, (m) => Number(m[1])],
  [/\b(\d+) days? ago\b/, (m) => Number(m[1])],
  [/\b(yesterday|last night|kemarin)\b|昨天|昨晚/, () => 1],
  [/\b(today|tonight|this morning|hari ini)\b|今天|今晚/, () => 0],
];

function findDaysAgo(text) {
  for (const [pattern, toDays] of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { daysAgo: toDays(match), text: text.replace(pattern, " ") };
    }
  }
  return { daysAgo: null, text };
}

const AMOUNT = /(?:[$€£¥₹]|rp\.?\s?|nt\$?\s?)?(\d+(?:\.\d+)?)\s*(k|rb|ribu|thousand|jt|juta|million|千|萬|万)?(?![a-z\d])(?:\s*(?:dollars?|bucks?|usd|ntd|nt|twd|yuan|rmb|rupiah|idr|euros?|pounds?|yen|rupees?|baht|ringgit|pesos?|kuai|塊錢|块钱|塊|块|元|圓))?/i;
const MULTIPLIERS = { k: 1e3, rb: 1e3, ribu: 1e3, thousand: 1e3, jt: 1e6, juta: 1e6, million: 1e6, 千: 1e3, 萬: 1e4, 万: 1e4 };
const CJK_FILLER = /^(?:我)?(?:花了|花|買了|买了|付了|用了|買|买|付)|(?:花了|塊錢|块钱|錢|钱)$/g;

const LEADING_FILLER = /^(?:(?:ok(?:ay)?|hey|so|um+|uh+|i|i've|just|have|also|then|add|log|record|expense|spent|spend|paid|pay|bought|buy|got|beli|bayar|untuk)\s+)+/;
const EDGE_STOPWORDS = /^(?:(?:for|on|at|to|the|a|an|of|my|in|with|buat|di)\s+)+|(?:\s+(?:for|on|at|to|the|a|an|of|my|in|with|buat|di))+$/g;

function guessCategory(desc) {
  const text = " " + desc.toLowerCase() + " ";
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some((k) => (/[^\x00-\x7f]/.test(k) ? text.includes(k) : text.includes(" " + k) || text.includes(k + " ")))) {
      return category;
    }
  }
  return "Other";
}

function amountOf(match) {
  const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1;
  return Math.round(parseFloat(match[1]) * multiplier * 100) / 100;
}

// Prefer a number said with a currency or "k"; otherwise the largest ("2 coffees 120" -> 120).
function pickAmount(chunk) {
  const matches = [...chunk.matchAll(new RegExp(AMOUNT.source, "gi"))];
  if (!matches.length) {
    return null;
  }
  const marked = matches.filter((m) => /[^\d.\s]/.test(m[0]));
  const candidates = marked.length ? marked : matches;
  return candidates.reduce((best, m) => (amountOf(m) > amountOf(best) ? m : best));
}

function parseOne(chunk) {
  const match = pickAmount(chunk);
  if (!match) {
    return null;
  }
  const amount = amountOf(match);
  let desc = (" " + chunk.replace(match[0], " ") + " ")
    .replace(/[.!?。，！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  desc = desc.replace(LEADING_FILLER, "").replace(EDGE_STOPWORDS, "").trim();
  let previous;
  do {
    previous = desc;
    desc = desc.replace(CJK_FILLER, "").trim();
  } while (desc !== previous);
  const category = guessCategory(desc);
  if (!desc) {
    desc = category;
  }
  desc = desc.replace(/seveneleven/g, "7-Eleven");
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return { amount, desc, cat: category };
}

// Returns an array of {amount, desc, cat, date}. Empty array = nothing understood.
function parseExpenses(spoken) {
  const { daysAgo, text } = findDaysAgo(normalize(spoken));
  const date = isoDate(daysAgo ?? 0);
  const pieces = text.split(/\s*(?:,|;|，|、|；|\band\b|\bdan\b|\bthen\b|\bplus\b|\balso\b|還有|还有|然後|然后|和|跟)\s*/);

  // A piece without a number belongs to its neighbour ("coffee and cake 120").
  const chunks = [];
  let pending = "";
  for (const piece of pieces) {
    if (!piece.trim()) {
      continue;
    }
    const joined = pending ? pending + " and " + piece : piece;
    if (AMOUNT.test(piece)) {
      chunks.push(joined);
      pending = "";
    } else {
      pending = joined;
    }
  }
  if (pending && chunks.length) {
    chunks[chunks.length - 1] += " " + pending;
  }

  return chunks
    .map(parseOne)
    .filter((e) => e && e.amount > 0)
    .map((e) => ({ ...e, date }));
}





// ---- Trades for Mint's Invest tab: "beli 10 lot BBCA di 9000", "bought 5 AAPL at 190", "jual 2 lot TLKM".
// One lot on the Indonesia Stock Exchange is 100 shares.
const ASSET_ALIASES = [
  [/\b(?:bitcoin|btc)\b/, { symbol: "BTC", cls: "crypto", name: "Bitcoin" }],
  [/\b(?:ethereum|eth|ether)\b/, { symbol: "ETH", cls: "crypto", name: "Ethereum" }],
  [/\b(?:emas|gold|antam|logam mulia)\b/, { symbol: "GOLD", cls: "gold", name: "Gold (grams)" }],
];
const TRADE_STOP = new Set(("bought buy buying beli membeli purchased purchase add added sold sell selling jual menjual dijual " +
  "lot lots lembar share shares saham unit units gram grams gr coin coins koin at di harga per each seharga for of and the a an " +
  "rp rupiah ribu rb jt juta k usd idr dollars dollar bucks total saya aku i my me today yesterday kemarin hari ini tadi " +
  "with dengan sebanyak some more again lagi").split(" "));

function parseTrade(spoken) {
  let t = normalize(spoken);
  const side = /\b(?:sold|sell|selling|jual|menjual|dijual)\b/.test(t) ? "sell" : "buy";
  let price = null;
  const priceMatch = t.match(new RegExp("(?:\\bat\\b|@|\\bdi\\b|\\bharga\\b|\\bper\\b|\\beach\\b|\\bseharga\\b|\\bfor\\b)\\s*" + AMOUNT.source, "i"));
  if (priceMatch) {
    price = amountOf(priceMatch);
    t = t.replace(priceMatch[0], " ");
  }
  const isTotal = /\btotal\b/.test(t);
  let alias = null;
  for (const [pattern, info] of ASSET_ALIASES) {
    if (pattern.test(t)) {
      alias = info;
      t = t.replace(pattern, " ");
      break;
    }
  }
  const qtyMatch = t.match(/(\d+(?:\.\d+)?)\s*(lots?|lembar|shares?|saham|units?|grams?|gr|coins?|koin)?(?![a-z\d])/);
  if (!qtyMatch) {
    return null;
  }
  let qty = parseFloat(qtyMatch[1]);
  if (qtyMatch[2] && /^lot/.test(qtyMatch[2])) {
    qty *= 100;
  }
  t = t.replace(qtyMatch[0], " ");
  let symbol = alias ? alias.symbol : null;
  if (!symbol) {
    const words = t.split(/\s+/).filter((w) => /^[a-z]{2,6}$/.test(w) && !TRADE_STOP.has(w));
    symbol = words.length ? words[0].toUpperCase() : null;
  }
  if (!symbol || !(qty > 0)) {
    return null;
  }
  if (price && isTotal) {
    price = Math.round((price / qty) * 100) / 100;
  }
  return { side, symbol, qty, price, cls: alias ? alias.cls : "stocks", name: alias ? alias.name : "" };
}

  window.TallyParse = { parseExpenses: parseExpenses, parseTrade: parseTrade };
})();
