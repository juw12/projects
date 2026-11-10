// Glow language & region, shared by every Glow app (home, GlowChat, GlowRoom, GlowLead, Profile).
// On first open Glow asks for the app language and the region you are in. The choice is stored in
// this browser under "glow.locale.v1" (same origin = every Glow app sees it) and never sent anywhere.
//
// The region decides:
//   - which AI models Glow offers (some providers don't serve every country, see REGIONS below),
//   - cautions shown next to models that are restricted for some users in that region,
//   - the local context the AI is told about (currency, units) and the voice-input language.
// Load this script before glow-apps.js. API: window.GlowLocale (see the bottom of this file).
(function () {
  "use strict";

  const STORE_KEY = "glow.locale.v1";
  const scriptBase = new URL("./", document.currentScript ? document.currentScript.src : location.href);
  // Re-check the provider rules in REGIONS whenever this date is more than a few months old.
  const RULES_CHECKED = "2026-10";

  const LANGUAGES = {
    en: { native: "English", ai: "English", speech: "en-US", region: "INTL" },
    id: { native: "Bahasa Indonesia", ai: "Bahasa Indonesia", speech: "id-ID", region: "ID" },
    "zh-CN": { native: "简体中文", ai: "Simplified Chinese (简体中文)", speech: "zh-CN", region: "CN" },
    "zh-TW": { native: "繁體中文", ai: "Traditional Chinese (繁體中文)", speech: "zh-TW", region: "TW" },
  };

  // Model families, matched against the bare model id ("gpt-5-mini", "anthropic/claude-opus-5-5").
  const FAMILIES = {
    openai: /(^|\/)(gpt-(?!oss)|o[1-9](-|$)|chatgpt|dall-e|codex|sora)|^openai\//i,
    anthropic: /(^|\/)claude|^anthropic\//i,
    google: /(^|\/)(gemini|imagen|veo)|^google\//i,
    xai: /(^|\/)grok|^x-ai\//i,
    deepseek: /deepseek/i,
  };
  const PROVIDER_NAMES = { openai: "OpenAI (GPT)", anthropic: "Anthropic (Claude)", google: "Google (Gemini)", xai: "xAI (Grok)" };

  // Models from providers that serve mainland China, plus open-weight models (GPT-OSS, Llama).
  const CHINA_ALLOWED = [
    /deepseek/i, /qwen|qwq/i, /glm|zhipu/i, /kimi|moonshot/i, /minimax/i, /doubao|seedream|seed-|bytedance/i,
    /ernie|baidu/i, /hunyuan|tencent/i, /baichuan/i, /stepfun|(^|\/)step-/i, /gpt-oss/i, /llama/i,
  ];

  // allow: only these model families are offered. block: these provider families are hidden.
  // caution: a short warning shown next to that family. Sources (checked RULES_CHECKED):
  //   OpenAI and Anthropic don't support mainland China, Hong Kong or Macau; Google restricts the Gemini
  //   API there. Public generative-AI services in mainland China also need a CAC filing.
  //   DeepSeek is banned on government devices in Taiwan, Australia and US federal agencies, and Italy's
  //   privacy regulator blocked its app.
  const REGIONS = {
    INTL: { flag: "🌐", currency: "USD", lang: "en", units: "metric" },
    ID: { flag: "🇮🇩", currency: "IDR", lang: "id", units: "metric" },
    CN: { flag: "🇨🇳", currency: "CNY", lang: "zh-CN", units: "metric", allow: CHINA_ALLOWED, network: true },
    HK: { flag: "🇭🇰", currency: "HKD", lang: "zh-TW", units: "metric", block: ["openai", "anthropic", "google"] },
    TW: { flag: "🇹🇼", currency: "TWD", lang: "zh-TW", units: "metric", caution: { deepseek: "deepseekGov" } },
    SG: { flag: "🇸🇬", currency: "SGD", lang: "en", units: "metric" },
    MY: { flag: "🇲🇾", currency: "MYR", lang: "en", units: "metric" },
    US: { flag: "🇺🇸", currency: "USD", lang: "en", units: "US customary", caution: { deepseek: "deepseekGov" } },
    EU: { flag: "🇪🇺", currency: "EUR", lang: "en", units: "metric", caution: { deepseek: "deepseekPrivacy" } },
    AU: { flag: "🇦🇺", currency: "AUD", lang: "en", units: "metric", caution: { deepseek: "deepseekGov" } },
  };
  const REGION_ORDER = ["ID", "CN", "HK", "TW", "SG", "MY", "US", "EU", "AU", "INTL"];

  // Approximate US-dollar rates for showing prices in your currency (always marked "≈"; the checkout
  // charges in the store's currency). Source: Bank Indonesia and market rates, 27–28 Oct 2026.
  const USD_RATES = { USD: 1, IDR: 18116, CNY: 6.669, HKD: 7.844, TWD: 32.42, SGD: 1.281, MYR: 4.089, EUR: 0.8967, AUD: 1.422 };
  const RATES_DATE = "2026-10-28";

  // Endpoints that replace the defaults in a region. Fill in a China-reachable domain (an ICP-filed
  // domain bound to the Glow cloud worker; *.workers.dev is often blocked in mainland China), see docs/CHINA.md.
  const REGION_ENDPOINTS = {
    CN: { cloud: "" },
  };

  // GlowChat's "Your own AI keys" section is hidden for now, so its tip in the region summary is too.
const OWN_KEY_TIP_SHOWN = false;
// OpenAI-compatible AI providers that serve mainland China, for "Your own AI keys" in GlowChat.
  // The keys stay in the browser and requests go straight to the provider.
  const CHINA_PROVIDERS = [
    { id: "deepseek", name: "DeepSeek 深度求索", url: "https://api.deepseek.com/v1", keys: "https://platform.deepseek.com/api_keys" },
    { id: "qwen", name: "Qwen 通义千问 (Alibaba Cloud Model Studio)", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", keys: "https://bailian.console.aliyun.com/" },
    { id: "kimi", name: "Kimi 月之暗面 (Moonshot)", url: "https://api.moonshot.cn/v1", keys: "https://platform.moonshot.cn/console/api-keys" },
    { id: "glm", name: "GLM 智谱 (Zhipu BigModel)", url: "https://open.bigmodel.cn/api/paas/v4", keys: "https://open.bigmodel.cn/usercenter/apikeys" },
  ];

  // Regions where using Glow needs an explicit OK that messages go to AI providers in other countries:
  // China's PIPL asks for separate consent to cross-border transfers; the EU (GDPR) needs clear information.
  const CONSENT_REGIONS = { CN: "pipl", EU: "gdpr" };
  const PRIVACY_ANCHORS = { CN: "cn", HK: "hk", TW: "tw", ID: "id", EU: "eu", SG: "sg", MY: "my", AU: "au", US: "us" };

  // Windows can't draw flag emoji (it shows "CN"), so flags are left out there.
  const SHOW_FLAGS = !/Windows/.test(navigator.userAgent || "");
  const TIMEZONE_REGIONS = {
    "Asia/Jakarta": "ID", "Asia/Makassar": "ID", "Asia/Jayapura": "ID", "Asia/Pontianak": "ID",
    "Asia/Shanghai": "CN", "Asia/Chongqing": "CN", "Asia/Harbin": "CN", "Asia/Urumqi": "CN",
    "Asia/Hong_Kong": "HK", "Asia/Macau": "HK", "Asia/Taipei": "TW", "Asia/Singapore": "SG",
    "Asia/Kuala_Lumpur": "MY", "Asia/Kuching": "MY",
  };

  const STRINGS = {
    en: {
      "region.INTL": "Other / international", "region.ID": "Indonesia", "region.CN": "Mainland China", "region.HK": "Hong Kong & Macau",
      "region.TW": "Taiwan", "region.SG": "Singapore", "region.MY": "Malaysia", "region.US": "United States", "region.EU": "European Union", "region.AU": "Australia",
      "welcome.title": "Welcome to Glow",
      "welcome.sub": "Choose your language and where you are. You can change both any time in Profile & settings.",
      "welcome.language": "Language",
      "welcome.region": "Where are you?",
      "welcome.suggested": "suggested from your device",
      "welcome.continue": "Continue",
      "welcome.private": "Saved only in this browser. Nothing is sent to a server.",
      "welcome.allModels": "Every Glow AI model is available here.",
      "welcome.limited": "{providers} don't offer their models here, so Glow hides them and uses {preferred} instead.",
      "welcome.chinaOnly": "Glow offers models from providers that serve mainland China ({preferred}) and hides the others (OpenAI, Anthropic, Google, xAI).",
      "welcome.network": "Puter sign-in, Google, GitHub and the instant cloud browser may be blocked or slow here. Glow Free and DeepSeek / Qwen work best.",
      "welcome.local": "Answers use local context: {currency}, {units} units.",
      "welcome.work": "This is a work or government device (hide DeepSeek and other restricted models)",
      "welcome.consent.pipl": "I agree that my messages are sent to AI providers, some outside mainland China, to get answers (cross-border transfer under PIPL).",
      "welcome.consent.gdpr": "I understand my messages are sent to the AI provider I choose, which may be outside the EU. Glow itself stores nothing on a server.",
      "welcome.privacy": "Privacy notice for your region",
      "welcome.chinaKeys": "Tip: in GlowChat Settings you can use your own DeepSeek, Qwen, Kimi or GLM key, which work in mainland China.",
      "price.approx": "≈ {price} / month (rate of {date})",
      "caution.deepseekGov": "DeepSeek is banned on government devices here: don't use it for government work.",
      "caution.deepseekPrivacy": "DeepSeek stores data in China and an EU regulator (Italy) has blocked its app: avoid personal data.",
      "models.hidden": "🌏 {count} models aren't offered in {region}, so they're hidden. Change it in Language & region.",
      "menu.language": "Language & region",
      "units.metric": "metric", "units.US customary": "US customary",
      "apps.home": "Your Glow home: start anything",
      "apps.lead": "Your AI lead: plans, delegates to the apps, checks",
      "apps.chat": "Chat, Council and Arena with any AI model",
      "apps.room": "An AI crew that researches, codes and reports back",
      "apps.news": "Latest AI news, refreshed twice a day",
      "home.news": "📰 GlowNews · Today in AI",
      "home.tile.news": "Today's AI news, grouped and summarised twice a day.",
      "home.pill.news": "📰 AI news",
      "home.newsAll": "All AI news →",
      "news.title": "GlowNews",
      "news.brief": "The briefing",
      "news.askBrief": "Discuss today's AI news with Glow",
      "news.copy": "Copy briefing",
      "news.search": "Search stories, companies, models…",
      "news.onlyNew": "New for you",
      "news.saved": "Saved",
      "news.fine": "Stories come from the publishers linked on each card. Summaries marked ✦ AI are written by free AI from the publishers' own text and can contain mistakes: open the source before you rely on one.",
      "apps.spark": "A tiny AI we built from scratch: writes on your device",
      "home.tile.spark": "Our own tiny AI. It writes fairy tales on your device, even offline.",
      "home.pill.spark": "✨ Tiny AI",
      "spark.title": "GlowSpark",
      "spark.lede": "A tiny AI we built from scratch. It writes fairy tales right here on your device: no account, no server, no waiting.",
      "spark.writerTitle": "Start a tale",
      "spark.promptLabel": "How the tale begins",
      "spark.placeholder": "How does the tale begin? Write the first words in English, or pick a starter above.",
      "spark.creativity": "Creativity",
      "spark.length": "Length",
      "spark.short": "Short",
      "spark.medium": "Medium",
      "spark.long": "Long",
      "spark.write": "Write",
      "spark.stop": "Stop",
      "spark.again": "Another version",
      "spark.more": "Keep writing",
      "spark.taleTitle": "Your tale",
      "spark.hint": "Tap any word to see what else the model considered, and send the tale down that path. Dotted words are the ones it was least sure about.",
      "spark.copy": "Copy",
      "spark.speak": "Read aloud",
      "spark.chat": "Continue in GlowChat",
      "spark.altTitle": "Instead, the model could have written",
      "spark.numbersTitle": "The numbers, measured",
      "spark.numbersLede": "Nothing here is an estimate. Every figure is read from the benchmark file our scripts wrote, and the two marked with a green dot are timed on your device as you use it.",
      "spark.barsTitle": "How well does it predict stories it never read?",
      "spark.versusTitle": "Where it wins, where it loses",
      "spark.versusLede": "GlowSpark is not a rival to ChatGPT, Claude or Gemini at knowing things. It goes after what they cannot do: start instantly, run anywhere, work offline and keep every word on your device.",
      "spark.v.cloud": "Cloud chatbots",
      "spark.v.web": "Big models in the browser",
      "spark.v.chrome": "Chrome's built-in AI",
      "spark.v.r1": "Knowledge and reasoning",
      "spark.v.r1.us": "None. It has only read old fairy tales.",
      "spark.v.r1.cloud": "The best there is",
      "spark.v.r1.web": "Good, for small models",
      "spark.v.r1.chrome": "Good, for a small model",
      "spark.v.r2": "Before the first word",
      "spark.v.r2.us": "One small download",
      "spark.v.r2.cloud": "Sign-in for most, then a round trip to a data centre for every reply",
      "spark.v.r2.web": "A model download that is many times larger",
      "spark.v.r2.chrome": "A model download managed by Chrome",
      "spark.v.r3": "Runs on",
      "spark.v.r3.us": "Any modern browser, phones included. Plain JavaScript on the CPU.",
      "spark.v.r3.cloud": "Anything with a connection",
      "spark.v.r3.web": "Browsers and devices with WebGPU",
      "spark.v.r3.chrome": "Desktop Chrome on supported hardware",
      "spark.v.r4": "Works offline",
      "spark.v.r4.us": "Yes, after the first visit",
      "spark.v.r4.cloud": "No",
      "spark.v.r4.web": "Yes, after the download",
      "spark.v.r4.chrome": "Yes, after the download",
      "spark.v.r5": "Where your words go",
      "spark.v.r5.us": "Nowhere. There is no server to send them to.",
      "spark.v.r5.cloud": "To the provider's servers",
      "spark.v.r5.web": "They stay on the device",
      "spark.v.r5.chrome": "They stay on the device",
      "spark.v.r6": "Account, key or usage limit",
      "spark.v.r6.us": "None",
      "spark.v.r6.cloud": "Usually an account, and limits on free plans",
      "spark.v.r6.web": "None",
      "spark.v.r6.chrome": "None",
      "spark.v.r7": "Can you see why it chose a word?",
      "spark.v.r7.us": "Yes. Tap any word for the alternatives and their odds.",
      "spark.v.r7.cloud": "Not in the chat apps",
      "spark.v.r7.web": "Only if the app builds it",
      "spark.v.r7.chrome": "No",
      "spark.v.sources": "Sources for the other columns, checked on",
      "spark.v.direct": "read directly",
      "spark.v.search": "through a web search, because the page would not open from the network this was built on",
      "spark.v.noBench": "We did not benchmark those systems ourselves, so no speed, size or quality number is claimed for them.",
      "spark.limitsTitle": "What it can't do",
      "spark.limit1": "It cannot answer questions. It knows no facts, only how old tales tend to go. For answers, use GlowChat.",
      "spark.limit2": "It writes English only, in the voice of books from a century or more ago, and it carries their old-fashioned ideas too.",
      "spark.limit3": "It loses the thread fast. The phrases sound like a fairy tale, but sentences often go wrong, and characters and plot change from line to line.",
      "spark.limit4": "It remembers only the last few hundred words, so a long tale forgets how it began.",
      "spark.builtTitle": "Built from scratch",
      "spark.built1": "The tokenizer: our own byte-pair encoder, trained on the books. No tokenizer library.",
      "spark.built2": "The model: a small transformer that started from random numbers. No pretrained weights, nothing downloaded from another model.",
      "spark.built3": "The training: one laptop processor, no graphics card, public-domain books only.",
      "spark.built4": "The engine: plain JavaScript written for this page. No AI library, no WebGPU, no WebAssembly.",
      "spark.selftest": "Check this engine against the reference",
      "spark.booksTitle": "The books it learned from",
      "spark.booksLede": "All are in the public domain in the USA and come from Project Gutenberg. Books marked “held out” were never shown to the model: they are the test.",
      "spark.fine": "GlowSpark makes things up: that is all it does. Its tales are generated on your device by a small model trained on old books, and can be odd, wrong or dated. Nothing you type or generate here leaves this page unless you choose to send it to GlowChat.",
      "spark.status.waking": "Waking the model…",
      "spark.status.loading": "Downloading the model… {percent}%",
      "spark.status.ready": "Ready in {seconds} s",
      "spark.status.local": "running on this device, nothing is sent anywhere",
      "spark.status.offline": "You're offline and the model isn't saved on this device yet.",
      "spark.status.failed": "The model couldn't load.",
      "spark.retry": "Try again",
      "spark.writeFailed": "Something went wrong while writing. Try again.",
      "spark.speed": "{n} words a second on this device",
      "spark.alt.written": "written",
      "spark.alt.none": "The model saw no other word here.",
      "spark.starter.0": "A little fox",
      "spark.starter.1": "Three daughters",
      "spark.starter.2": "The dark forest",
      "spark.starter.3": "The fisherman",
      "spark.starter.4": "The rabbit",
      "spark.starter.5": "A poor woodcutter",
      "spark.mood.safest": "Safest",
      "spark.mood.calm": "Calm",
      "spark.mood.balanced": "Balanced",
      "spark.mood.wild": "Wild",
      "spark.copied": "Tale copied",
      "spark.copyFailed": "Couldn't copy the tale",
      "spark.stat.ready": "from opening this page to ready, on this device",
      "spark.stat.speed": "words a second, on this device",
      "spark.stat.download": "to download: model, tokenizer and engine together",
      "spark.stat.parameters": "parameters, all trained from random numbers",
      "spark.stat.books": "public-domain books read ({size} of text)",
      "spark.stat.training": "of training, on one laptop processor",
      "spark.stat.perplexity": "perplexity on unseen books (lower is better)",
      "spark.bar.shipped": "GlowSpark, as you download it",
      "spark.bar.float": "GlowSpark, before shrinking to 8-bit",
      "spark.bar.baseline": "Our first quick try ({minutes} min of training)",
      "spark.bar.xzPrimed": "xz, handed every training book",
      "spark.bar.xz": "xz",
      "spark.bar.bzip2": "bzip2",
      "spark.bar.gzip": "gzip",
      "spark.barsLede": "Bits needed per character to store {books} books ({size}) the model never read. Lower is better: the better you predict the next word, the fewer bits you need. The other rows are file compressors on the same text.",
      "spark.benchNote": "On the laptop that built it ({hardware}), with the files served from that same laptop so download time isn't counted: ready {cold} s after opening the page, then {speed} words a second. {note}",
      "spark.versusDownload": "One {size} download",
      "spark.booksCount": "{read} read · {held} held out",
      "spark.heldOut": "held out",
      "spark.benchMissing": "The benchmark file couldn't load, so no figures are shown.",
      "spark.selftest.running": "Checking…",
      "spark.selftest.error": "The check couldn't run. Try again when you're online.",
      "spark.selftest.pass": "✓ Match. On {same} of {total} test openings this engine picks the same words as the PyTorch reference, and its scores differ by at most {diff} (limit {tolerance}).",
      "spark.selftest.fail": "✕ Mismatch: {same} of {total} test openings agree, largest score difference {diff} (limit {tolerance}). Please tell us.",
      "apps.title": "Glow apps", "apps.here": "You're here", "profile": "Profile & settings",
      "home.h1": "Get things done<br>with free AI.",
      "home.lede": "Type what you need. Glow picks the right helper for you.",
      "home.placeholder": "What do you need? e.g. Plan a 3-day trip to Bali",
      "home.hint": "Free, no sign-up needed.", "home.start": "Start",
      "home.ex1": "✈ Plan a trip", "home.ex1.q": "Plan a 3-day trip to Bali on a small budget",
      "home.ex2": "🔎 Compare laptops", "home.ex2.q": "Compare the best budget laptops under $600 with sources",
      "home.ex3": "✉ Write an email", "home.ex3.q": "Write a short, friendly follow-up email after a job interview",
      "home.choose": "Or choose:", "home.pill.chat": "💬 Chat", "home.pill.room": "🏢 AI crew", "home.pill.lead": "👑 Lead a goal",
      "home.tile.chat": "Ask questions, write and brainstorm.", "home.tile.room": "An AI crew searches the web and runs code.",
      "home.tile.lead": "Give one big goal; it plans and checks the work.",
      "home.recent": "Jump back in", "home.recentChats": "💬 Recent chats", "home.recentMissions": "🏢 Recent crew missions",
      "home.noChats": "No chats yet.", "home.noMissions": "No crew missions yet.", "home.untitled": "Untitled chat",
      "home.guestChip": "👤 Guest", "home.guestText": "You're using Glow as a guest. A free sign-in gives stronger models in every Glow app.",
      "home.signedText": "Signed in as {name}. Every Glow app uses this account.", "home.signIn": "Sign in",
      "home.reason.chat": "GlowChat will answer right away.",
      "home.reason.room": "The GlowRoom crew will search the web or run code for this.",
      "home.reason.lead": "GlowLead will plan this big goal step by step.",
      "home.setup": "📥 Get the Glow apps for Windows, Android and iPhone",
      "home.foot": "✦ Glow · free · your chats stay in your browser",
      "home.install": "Install Glow", "home.installAll": "Install every Glow app", "home.plans": "Plans & Glow Pro", "home.privacy": "Privacy", "home.terms": "Terms & refunds", "home.projects": "All projects",
    },
    id: {
      "region.INTL": "Lainnya / internasional", "region.ID": "Indonesia", "region.CN": "Tiongkok daratan", "region.HK": "Hong Kong & Makau",
      "region.TW": "Taiwan", "region.SG": "Singapura", "region.MY": "Malaysia", "region.US": "Amerika Serikat", "region.EU": "Uni Eropa", "region.AU": "Australia",
      "welcome.title": "Selamat datang di Glow",
      "welcome.sub": "Pilih bahasa dan lokasimu. Keduanya bisa diubah kapan saja di Profil & pengaturan.",
      "welcome.language": "Bahasa",
      "welcome.region": "Kamu di mana?",
      "welcome.suggested": "disarankan dari perangkatmu",
      "welcome.continue": "Lanjut",
      "welcome.private": "Hanya disimpan di browser ini. Tidak ada yang dikirim ke server.",
      "welcome.allModels": "Semua model Glow AI tersedia di sini.",
      "welcome.limited": "{providers} tidak menyediakan modelnya di sini, jadi Glow menyembunyikannya dan memakai {preferred}.",
      "welcome.chinaOnly": "Glow menampilkan model dari penyedia yang melayani Tiongkok daratan ({preferred}) dan menyembunyikan yang lain (OpenAI, Anthropic, Google, xAI).",
      "welcome.network": "Login Puter, Google, GitHub dan browser cloud instan mungkin diblokir atau lambat di sini. Glow Free dan DeepSeek / Qwen paling lancar.",
      "welcome.local": "Jawaban memakai konteks lokal: {currency}, satuan {units}.",
      "welcome.work": "Ini perangkat kantor atau pemerintah (sembunyikan DeepSeek dan model terbatas lainnya)",
      "welcome.consent.pipl": "Saya setuju pesan saya dikirim ke penyedia AI, sebagian di luar Tiongkok daratan, untuk mendapatkan jawaban (transfer lintas batas menurut PIPL).",
      "welcome.consent.gdpr": "Saya paham pesan saya dikirim ke penyedia AI pilihan saya, yang mungkin di luar UE. Glow sendiri tidak menyimpan apa pun di server.",
      "welcome.privacy": "Pemberitahuan privasi untuk wilayahmu",
      "welcome.chinaKeys": "Tips: di Pengaturan GlowChat kamu bisa memakai kunci DeepSeek, Qwen, Kimi atau GLM sendiri, yang berfungsi di Tiongkok daratan.",
      "price.approx": "≈ {price} / bulan (kurs {date})",
      "caution.deepseekGov": "DeepSeek dilarang di perangkat pemerintah di sini: jangan dipakai untuk pekerjaan pemerintah.",
      "caution.deepseekPrivacy": "DeepSeek menyimpan data di Tiongkok dan regulator UE (Italia) memblokir aplikasinya: hindari data pribadi.",
      "models.hidden": "🌏 {count} model tidak tersedia di {region}, jadi disembunyikan. Ubah di Bahasa & wilayah.",
      "menu.language": "Bahasa & wilayah",
      "units.metric": "metrik", "units.US customary": "AS",
      "apps.home": "Beranda Glow: mulai apa saja",
      "apps.lead": "Pemimpin AI-mu: merencanakan, membagi tugas, memeriksa",
      "apps.chat": "Chat, Dewan dan Arena dengan model AI apa pun",
      "apps.room": "Kru AI yang meriset, membuat kode dan melapor",
      "apps.news": "Berita AI terbaru, diperbarui dua kali sehari",
      "home.news": "📰 GlowNews · AI hari ini",
      "home.tile.news": "Berita AI hari ini, dikelompokkan dan diringkas dua kali sehari.",
      "home.pill.news": "📰 Berita AI",
      "home.newsAll": "Semua berita AI →",
      "news.title": "GlowNews",
      "news.brief": "Ringkasan",
      "news.askBrief": "Bahas berita AI hari ini dengan Glow",
      "news.copy": "Salin ringkasan",
      "news.search": "Cari berita, perusahaan, model…",
      "news.onlyNew": "Baru untukmu",
      "news.saved": "Disimpan",
      "news.fine": "Berita berasal dari penerbit yang ditautkan di setiap kartu. Ringkasan bertanda ✦ AI ditulis oleh AI gratis dari teks penerbit dan bisa keliru: buka sumbernya sebelum mengandalkannya.",
      "apps.spark": "AI mungil buatan kami sendiri: menulis di perangkatmu",
      "home.tile.spark": "AI mungil buatan kami. Menulis dongeng di perangkatmu, bahkan saat offline.",
      "home.pill.spark": "✨ AI mungil",
      "spark.title": "GlowSpark",
      "spark.lede": "AI mungil yang kami buat dari nol. Ia menulis dongeng langsung di perangkatmu: tanpa akun, tanpa server, tanpa menunggu.",
      "spark.writerTitle": "Mulai sebuah dongeng",
      "spark.promptLabel": "Awal dongengnya",
      "spark.placeholder": "Bagaimana dongengnya dimulai? Tulis kata-kata pertamanya dalam bahasa Inggris, atau pilih pembuka di atas.",
      "spark.creativity": "Kreativitas",
      "spark.length": "Panjang",
      "spark.short": "Pendek",
      "spark.medium": "Sedang",
      "spark.long": "Panjang",
      "spark.write": "Tulis",
      "spark.stop": "Berhenti",
      "spark.again": "Versi lain",
      "spark.more": "Lanjutkan",
      "spark.taleTitle": "Dongengmu",
      "spark.hint": "Ketuk kata mana pun untuk melihat pilihan lain yang dipertimbangkan model, lalu belokkan dongeng ke arah itu. Kata bergaris titik-titik adalah yang paling diragukannya.",
      "spark.copy": "Salin",
      "spark.speak": "Bacakan",
      "spark.chat": "Lanjutkan di GlowChat",
      "spark.altTitle": "Model juga bisa saja menulis",
      "spark.numbersTitle": "Angkanya, hasil pengukuran",
      "spark.numbersLede": "Tidak ada perkiraan di sini. Setiap angka dibaca dari berkas benchmark yang ditulis skrip kami, dan dua angka bertanda titik hijau diukur di perangkatmu saat kamu memakainya.",
      "spark.barsTitle": "Seberapa baik ia menebak cerita yang belum pernah dibacanya?",
      "spark.versusTitle": "Di mana ia unggul, di mana ia kalah",
      "spark.versusLede": "GlowSpark bukan saingan ChatGPT, Claude, atau Gemini dalam hal pengetahuan. Ia mengincar hal yang tidak bisa mereka lakukan: langsung menyala, jalan di mana saja, bekerja offline, dan menyimpan setiap kata di perangkatmu.",
      "spark.v.cloud": "Chatbot cloud",
      "spark.v.web": "Model besar di browser",
      "spark.v.chrome": "AI bawaan Chrome",
      "spark.v.r1": "Pengetahuan dan penalaran",
      "spark.v.r1.us": "Tidak ada. Ia hanya pernah membaca dongeng lama.",
      "spark.v.r1.cloud": "Yang terbaik saat ini",
      "spark.v.r1.web": "Bagus, untuk ukuran model kecil",
      "spark.v.r1.chrome": "Bagus, untuk ukuran model kecil",
      "spark.v.r2": "Sebelum kata pertama",
      "spark.v.r2.us": "Satu unduhan kecil",
      "spark.v.r2.cloud": "Kebanyakan perlu masuk akun, lalu setiap jawaban bolak-balik ke pusat data",
      "spark.v.r2.web": "Unduhan model yang berkali-kali lipat lebih besar",
      "spark.v.r2.chrome": "Unduhan model yang diatur oleh Chrome",
      "spark.v.r3": "Berjalan di",
      "spark.v.r3.us": "Browser modern apa pun, termasuk ponsel. JavaScript biasa di CPU.",
      "spark.v.r3.cloud": "Apa pun yang terhubung internet",
      "spark.v.r3.web": "Browser dan perangkat yang mendukung WebGPU",
      "spark.v.r3.chrome": "Chrome desktop pada perangkat keras yang didukung",
      "spark.v.r4": "Bekerja offline",
      "spark.v.r4.us": "Ya, setelah kunjungan pertama",
      "spark.v.r4.cloud": "Tidak",
      "spark.v.r4.web": "Ya, setelah diunduh",
      "spark.v.r4.chrome": "Ya, setelah diunduh",
      "spark.v.r5": "Ke mana kata-katamu pergi",
      "spark.v.r5.us": "Tidak ke mana-mana. Tidak ada server untuk dikirimi.",
      "spark.v.r5.cloud": "Ke server penyedia",
      "spark.v.r5.web": "Tetap di perangkat",
      "spark.v.r5.chrome": "Tetap di perangkat",
      "spark.v.r6": "Akun, kunci, atau batas pemakaian",
      "spark.v.r6.us": "Tidak ada",
      "spark.v.r6.cloud": "Biasanya perlu akun, dan paket gratis dibatasi",
      "spark.v.r6.web": "Tidak ada",
      "spark.v.r6.chrome": "Tidak ada",
      "spark.v.r7": "Bisakah kamu melihat alasan ia memilih sebuah kata?",
      "spark.v.r7.us": "Ya. Ketuk kata mana pun untuk melihat pilihan lain beserta peluangnya.",
      "spark.v.r7.cloud": "Tidak di aplikasi chat-nya",
      "spark.v.r7.web": "Hanya jika aplikasinya menyediakannya",
      "spark.v.r7.chrome": "Tidak",
      "spark.v.sources": "Sumber untuk kolom lain, diperiksa pada",
      "spark.v.direct": "dibaca langsung",
      "spark.v.search": "lewat penelusuran web, karena halamannya tidak bisa dibuka dari jaringan tempat ini dibuat",
      "spark.v.noBench": "Kami tidak menguji sendiri sistem-sistem itu, jadi tidak ada angka kecepatan, ukuran, atau kualitas yang kami klaim untuk mereka.",
      "spark.limitsTitle": "Yang tidak bisa dilakukannya",
      "spark.limit1": "Ia tidak bisa menjawab pertanyaan. Ia tidak tahu fakta apa pun, hanya tahu bagaimana dongeng lama biasanya berjalan. Untuk jawaban, pakai GlowChat.",
      "spark.limit2": "Ia hanya menulis dalam bahasa Inggris, dengan gaya buku-buku seabad lalu atau lebih, dan ikut membawa gagasan kuno dari buku-buku itu.",
      "spark.limit3": "Ia cepat kehilangan alur. Frasanya terdengar seperti dongeng, tetapi kalimatnya sering kacau, dan tokoh serta jalan ceritanya berubah dari baris ke baris.",
      "spark.limit4": "Ia hanya mengingat beberapa ratus kata terakhir, jadi dongeng yang panjang akan lupa bagaimana ia bermula.",
      "spark.builtTitle": "Dibuat dari nol",
      "spark.built1": "Tokenizer: byte-pair encoder buatan kami sendiri, dilatih dari buku-buku itu. Tanpa pustaka tokenizer.",
      "spark.built2": "Model: transformer kecil yang berangkat dari angka acak. Tanpa bobot pra-latih, tidak ada yang diunduh dari model lain.",
      "spark.built3": "Pelatihan: satu prosesor laptop, tanpa kartu grafis, hanya buku domain publik.",
      "spark.built4": "Mesin: JavaScript biasa yang ditulis untuk halaman ini. Tanpa pustaka AI, tanpa WebGPU, tanpa WebAssembly.",
      "spark.selftest": "Cocokkan mesin ini dengan acuannya",
      "spark.booksTitle": "Buku-buku yang dipelajarinya",
      "spark.booksLede": "Semuanya domain publik di AS dan berasal dari Project Gutenberg. Buku bertanda “disisihkan” tidak pernah diperlihatkan kepada model: itulah bahan ujinya.",
      "spark.fine": "GlowSpark mengarang cerita: hanya itu yang dilakukannya. Dongengnya dibuat di perangkatmu oleh model kecil yang dilatih dari buku-buku lama, dan bisa aneh, keliru, atau ketinggalan zaman. Apa pun yang kamu ketik atau hasilkan di sini tidak meninggalkan halaman ini, kecuali kamu memilih mengirimnya ke GlowChat.",
      "spark.status.waking": "Membangunkan model…",
      "spark.status.loading": "Mengunduh model… {percent}%",
      "spark.status.ready": "Siap dalam {seconds} dtk",
      "spark.status.local": "berjalan di perangkat ini, tidak ada yang dikirim ke mana pun",
      "spark.status.offline": "Kamu sedang offline dan model belum tersimpan di perangkat ini.",
      "spark.status.failed": "Model gagal dimuat.",
      "spark.retry": "Coba lagi",
      "spark.writeFailed": "Ada yang salah saat menulis. Coba lagi.",
      "spark.speed": "{n} kata per detik di perangkat ini",
      "spark.alt.written": "ditulis",
      "spark.alt.none": "Model tidak melihat kata lain di sini.",
      "spark.starter.0": "Rubah kecil",
      "spark.starter.1": "Tiga putri",
      "spark.starter.2": "Hutan gelap",
      "spark.starter.3": "Sang nelayan",
      "spark.starter.4": "Si kelinci",
      "spark.starter.5": "Penebang kayu miskin",
      "spark.mood.safest": "Paling aman",
      "spark.mood.calm": "Tenang",
      "spark.mood.balanced": "Seimbang",
      "spark.mood.wild": "Liar",
      "spark.copied": "Dongeng disalin",
      "spark.copyFailed": "Dongeng gagal disalin",
      "spark.stat.ready": "dari membuka halaman ini sampai siap, di perangkat ini",
      "spark.stat.speed": "kata per detik, di perangkat ini",
      "spark.stat.download": "untuk diunduh: model, tokenizer, dan mesin sekaligus",
      "spark.stat.parameters": "parameter, semuanya dilatih dari angka acak",
      "spark.stat.books": "buku domain publik yang dibaca ({size} teks)",
      "spark.stat.training": "pelatihan, di satu prosesor laptop",
      "spark.stat.perplexity": "perplexity pada buku yang belum dilihat (makin rendah makin baik)",
      "spark.bar.shipped": "GlowSpark, seperti yang kamu unduh",
      "spark.bar.float": "GlowSpark, sebelum diperkecil ke 8-bit",
      "spark.bar.baseline": "Percobaan kilat pertama kami (latihan {minutes} mnt)",
      "spark.bar.xzPrimed": "xz, diberi semua buku latihan",
      "spark.bar.xz": "xz",
      "spark.bar.bzip2": "bzip2",
      "spark.bar.gzip": "gzip",
      "spark.barsLede": "Jumlah bit per karakter untuk menyimpan {books} buku ({size}) yang tidak pernah dibaca model. Makin rendah makin baik: makin jitu menebak kata berikutnya, makin sedikit bit yang dibutuhkan. Baris lainnya adalah program kompresi berkas pada teks yang sama.",
      "spark.benchNote": "Di laptop yang membuatnya ({hardware}), dengan berkas disajikan dari laptop yang sama sehingga waktu unduh tidak dihitung: siap {cold} dtk setelah halaman dibuka, lalu {speed} kata per detik. {note}",
      "spark.versusDownload": "Satu unduhan {size}",
      "spark.booksCount": "{read} dibaca · {held} disisihkan",
      "spark.heldOut": "disisihkan",
      "spark.benchMissing": "Berkas benchmark gagal dimuat, jadi tidak ada angka yang ditampilkan.",
      "spark.selftest.running": "Memeriksa…",
      "spark.selftest.error": "Pemeriksaan gagal dijalankan. Coba lagi saat kamu online.",
      "spark.selftest.pass": "✓ Cocok. Pada {same} dari {total} pembuka uji, mesin ini memilih kata yang sama dengan acuan PyTorch, dan selisih skornya paling besar {diff} (batas {tolerance}).",
      "spark.selftest.fail": "✕ Tidak cocok: {same} dari {total} pembuka uji sesuai, selisih skor terbesar {diff} (batas {tolerance}). Tolong beri tahu kami.",
      "apps.title": "Aplikasi Glow", "apps.here": "Kamu di sini", "profile": "Profil & pengaturan",
      "home.h1": "Selesaikan apa saja<br>dengan AI gratis.",
      "home.lede": "Ketik apa yang kamu perlukan. Glow memilih pembantu yang tepat.",
      "home.placeholder": "Apa yang kamu perlukan? mis. Rencanakan liburan 3 hari ke Bali",
      "home.hint": "Gratis, tanpa daftar.", "home.start": "Mulai",
      "home.ex1": "✈ Rencana liburan", "home.ex1.q": "Rencanakan liburan 3 hari ke Bali dengan budget kecil",
      "home.ex2": "🔎 Bandingkan laptop", "home.ex2.q": "Bandingkan laptop terbaik di bawah Rp 9 juta beserta sumbernya",
      "home.ex3": "✉ Tulis email", "home.ex3.q": "Tulis email follow-up singkat dan ramah setelah wawancara kerja",
      "home.choose": "Atau pilih:", "home.pill.chat": "💬 Chat", "home.pill.room": "🏢 Kru AI", "home.pill.lead": "👑 Pimpin tujuan",
      "home.tile.chat": "Bertanya, menulis dan bertukar ide.", "home.tile.room": "Kru AI mencari di web dan menjalankan kode.",
      "home.tile.lead": "Beri satu tujuan besar; ia merencanakan dan memeriksa hasilnya.",
      "home.recent": "Lanjutkan", "home.recentChats": "💬 Chat terbaru", "home.recentMissions": "🏢 Misi kru terbaru",
      "home.noChats": "Belum ada chat.", "home.noMissions": "Belum ada misi kru.", "home.untitled": "Chat tanpa judul",
      "home.guestChip": "👤 Tamu", "home.guestText": "Kamu memakai Glow sebagai tamu. Masuk gratis untuk model yang lebih kuat di semua aplikasi Glow.",
      "home.signedText": "Masuk sebagai {name}. Semua aplikasi Glow memakai akun ini.", "home.signIn": "Masuk",
      "home.reason.chat": "GlowChat akan langsung menjawab.",
      "home.reason.room": "Kru GlowRoom akan mencari di web atau menjalankan kode untuk ini.",
      "home.reason.lead": "GlowLead akan merencanakan tujuan besar ini langkah demi langkah.",
      "home.setup": "📥 Dapatkan aplikasi Glow untuk Windows, Android dan iPhone",
      "home.foot": "✦ Glow · gratis · chat tetap di browsermu",
      "home.install": "Pasang Glow", "home.installAll": "Pasang semua aplikasi Glow", "home.plans": "Paket & Glow Pro", "home.privacy": "Privasi", "home.terms": "Ketentuan & pengembalian dana", "home.projects": "Semua proyek",
    },
    "zh-CN": {
      "region.INTL": "其他 / 国际", "region.ID": "印度尼西亚", "region.CN": "中国大陆", "region.HK": "香港和澳门",
      "region.TW": "台湾", "region.SG": "新加坡", "region.MY": "马来西亚", "region.US": "美国", "region.EU": "欧盟", "region.AU": "澳大利亚",
      "welcome.title": "欢迎使用 Glow",
      "welcome.sub": "选择你的语言和所在地区。之后可随时在“个人资料与设置”中更改。",
      "welcome.language": "语言",
      "welcome.region": "你在哪里？",
      "welcome.suggested": "根据你的设备推荐",
      "welcome.continue": "继续",
      "welcome.private": "仅保存在此浏览器中，不会发送到任何服务器。",
      "welcome.allModels": "这里可以使用所有 Glow AI 模型。",
      "welcome.limited": "{providers} 不在这里提供服务，因此 Glow 会隐藏它们，改用 {preferred}。",
      "welcome.chinaOnly": "Glow 只提供面向中国大陆服务的模型（{preferred}），并隐藏其他模型（OpenAI、Anthropic、Google、xAI）。",
      "welcome.network": "Puter 登录、Google、GitHub 和即时云浏览器在这里可能被屏蔽或很慢。Glow Free 和 DeepSeek / 通义千问最稳定。",
      "welcome.local": "回答会使用本地信息：{currency}，{units}单位。",
      "welcome.work": "这是工作或政府设备（隐藏 DeepSeek 等受限模型）",
      "welcome.consent.pipl": "我同意将我的消息发送给 AI 服务商（部分位于中国大陆境外）以获得回答（依据《个人信息保护法》的跨境传输单独同意）。",
      "welcome.consent.gdpr": "我了解我的消息会发送给我选择的 AI 服务商，可能位于欧盟境外。Glow 本身不在服务器上保存任何内容。",
      "welcome.privacy": "你所在地区的隐私说明",
      "welcome.chinaKeys": "提示：可在 GlowChat 设置中使用你自己的 DeepSeek、通义千问、Kimi 或智谱 GLM 密钥，这些在中国大陆可用。",
      "price.approx": "≈ 每月 {price}（{date} 汇率）",
      "caution.deepseekGov": "此地区禁止在政府设备上使用 DeepSeek：请勿用于政府工作。",
      "caution.deepseekPrivacy": "DeepSeek 的数据存储在中国，且欧盟监管机构（意大利）已封禁其应用：请避免输入个人数据。",
      "models.hidden": "🌏 有 {count} 个模型在{region}不提供，已隐藏。可在“语言与地区”中更改。",
      "menu.language": "语言与地区",
      "units.metric": "公制", "units.US customary": "英制",
      "apps.home": "Glow 主页：从这里开始",
      "apps.lead": "你的 AI 主管：规划、分派任务、检查成果",
      "apps.chat": "与任意 AI 模型聊天，还有议会和竞技场",
      "apps.room": "会调研、写代码并汇报的 AI 团队",
      "apps.news": "最新 AI 资讯，每天更新两次",
      "home.news": "📰 GlowNews · 今日 AI",
      "home.tile.news": "今日 AI 资讯，每天两次分组整理并摘要。",
      "home.pill.news": "📰 AI 资讯",
      "home.newsAll": "全部 AI 资讯 →",
      "news.title": "GlowNews",
      "news.brief": "要点速览",
      "news.askBrief": "和 Glow 聊聊今天的 AI 资讯",
      "news.copy": "复制速览",
      "news.search": "搜索新闻、公司、模型…",
      "news.onlyNew": "新内容",
      "news.saved": "已收藏",
      "news.fine": "新闻来自每张卡片上链接的发布方。标有 ✦ AI 的摘要由免费 AI 根据发布方原文撰写，可能有误：使用前请打开原文核实。",
      "apps.spark": "我们从零打造的小型 AI：直接在你的设备上写作",
      "home.tile.spark": "我们自己的小型 AI，在你的设备上写童话，离线也能用。",
      "home.pill.spark": "✨ 小型 AI",
      "spark.title": "GlowSpark",
      "spark.lede": "我们从零打造的小型 AI。它就在你的设备上写童话：不用账号，不经服务器，无需等待。",
      "spark.writerTitle": "开始一个故事",
      "spark.promptLabel": "故事的开头",
      "spark.placeholder": "故事怎么开头？用英文写下开头几个词，或在上方选一个开头。",
      "spark.creativity": "创意",
      "spark.length": "长度",
      "spark.short": "短",
      "spark.medium": "中",
      "spark.long": "长",
      "spark.write": "开始写",
      "spark.stop": "停止",
      "spark.again": "换一个版本",
      "spark.more": "继续写",
      "spark.taleTitle": "你的故事",
      "spark.hint": "点任意一个词，看看模型还考虑过哪些词，并让故事走向那条路。带虚线的词是它最没把握的。",
      "spark.copy": "复制",
      "spark.speak": "朗读",
      "spark.chat": "到 GlowChat 续写",
      "spark.altTitle": "模型本来也可能写",
      "spark.numbersTitle": "实测数字",
      "spark.numbersLede": "这里没有估算。每个数字都读取自我们脚本生成的基准测试文件，带绿点的两项是在你使用时于你的设备上实时计时的。",
      "spark.barsTitle": "它对从没读过的故事预测得有多准？",
      "spark.versusTitle": "它赢在哪里，输在哪里",
      "spark.versusLede": "论知识，GlowSpark 不是 ChatGPT、Claude 或 Gemini 的对手。它瞄准的是它们做不到的事：瞬间启动、随处运行、离线可用，并且每个字都留在你的设备上。",
      "spark.v.cloud": "云端聊天机器人",
      "spark.v.web": "浏览器里的大模型",
      "spark.v.chrome": "Chrome 内置 AI",
      "spark.v.r1": "知识与推理",
      "spark.v.r1.us": "没有。它只读过古老的童话。",
      "spark.v.r1.cloud": "目前最强",
      "spark.v.r1.web": "就小模型而言不错",
      "spark.v.r1.chrome": "就小模型而言不错",
      "spark.v.r2": "写出第一个词之前",
      "spark.v.r2.us": "一次很小的下载",
      "spark.v.r2.cloud": "多数需要登录，之后每次回复都要往返数据中心",
      "spark.v.r2.web": "要下载大出许多倍的模型",
      "spark.v.r2.chrome": "由 Chrome 管理的模型下载",
      "spark.v.r3": "运行环境",
      "spark.v.r3.us": "任何现代浏览器，包括手机。纯 JavaScript，在 CPU 上运行。",
      "spark.v.r3.cloud": "任何能联网的设备",
      "spark.v.r3.web": "支持 WebGPU 的浏览器和设备",
      "spark.v.r3.chrome": "受支持硬件上的桌面版 Chrome",
      "spark.v.r4": "离线可用",
      "spark.v.r4.us": "可以，首次访问之后",
      "spark.v.r4.cloud": "不行",
      "spark.v.r4.web": "可以，下载之后",
      "spark.v.r4.chrome": "可以，下载之后",
      "spark.v.r5": "你的文字去了哪里",
      "spark.v.r5.us": "哪儿也不去。根本没有可以发送的服务器。",
      "spark.v.r5.cloud": "发送到服务商的服务器",
      "spark.v.r5.web": "留在设备上",
      "spark.v.r5.chrome": "留在设备上",
      "spark.v.r6": "账号、密钥或用量限制",
      "spark.v.r6.us": "都没有",
      "spark.v.r6.cloud": "通常需要账号，免费版有用量限制",
      "spark.v.r6.web": "都没有",
      "spark.v.r6.chrome": "都没有",
      "spark.v.r7": "能看到它为什么选这个词吗？",
      "spark.v.r7.us": "能。点任意一个词，就能看到其他候选词和概率。",
      "spark.v.r7.cloud": "聊天应用里看不到",
      "spark.v.r7.web": "只有应用自己做了才行",
      "spark.v.r7.chrome": "不能",
      "spark.v.sources": "其他几列的资料来源，核对日期",
      "spark.v.direct": "直接阅读",
      "spark.v.search": "通过网络搜索核对，因为在构建本页的网络上打不开该页面",
      "spark.v.noBench": "我们没有亲自测试这些系统，所以不对它们给出任何速度、大小或质量数字。",
      "spark.limitsTitle": "它做不到的事",
      "spark.limit1": "它不能回答问题。它不懂任何事实，只知道老故事通常怎么发展。想要答案，请用 GlowChat。",
      "spark.limit2": "它只会写英文，文风来自一百多年前的书，也带着那些书里的陈旧观念。",
      "spark.limit3": "它很快就会跑题。词句听起来像童话，但句子常常不通，人物和情节每一行都在变。",
      "spark.limit4": "它只记得最后几百个词，所以长故事会忘了自己是怎么开头的。",
      "spark.builtTitle": "从零打造",
      "spark.built1": "分词器：我们自己写的字节对编码器，用这些书训练。没有用任何分词库。",
      "spark.built2": "模型：一个从随机数开始的小型 Transformer。没有预训练权重，没有从别的模型下载任何东西。",
      "spark.built3": "训练：一台笔记本电脑的处理器，不用显卡，只用公有领域的书。",
      "spark.built4": "引擎：专为本页编写的纯 JavaScript。没有 AI 库，不用 WebGPU，不用 WebAssembly。",
      "spark.selftest": "用参考实现核对这个引擎",
      "spark.booksTitle": "它读过的书",
      "spark.booksLede": "全部在美国属于公有领域，来自 Project Gutenberg。标有“留作测试”的书从未给模型看过：它们就是考题。",
      "spark.fine": "GlowSpark 只会编故事，仅此而已。这些故事由一个用旧书训练的小模型在你的设备上生成，可能古怪、有错或过时。你在这里输入或生成的内容都不会离开本页，除非你选择把它发送到 GlowChat。",
      "spark.status.waking": "正在唤醒模型…",
      "spark.status.loading": "正在下载模型… {percent}%",
      "spark.status.ready": "{seconds} 秒就绪",
      "spark.status.local": "在本设备上运行，不向任何地方发送内容",
      "spark.status.offline": "你处于离线状态，而模型还没有保存到这台设备上。",
      "spark.status.failed": "模型加载失败。",
      "spark.retry": "重试",
      "spark.writeFailed": "写作时出了点问题，请再试一次。",
      "spark.speed": "本设备上每秒 {n} 个词",
      "spark.alt.written": "已采用",
      "spark.alt.none": "模型在这里没有考虑别的词。",
      "spark.starter.0": "小狐狸",
      "spark.starter.1": "三个女儿",
      "spark.starter.2": "黑森林",
      "spark.starter.3": "渔夫",
      "spark.starter.4": "兔子",
      "spark.starter.5": "穷樵夫",
      "spark.mood.safest": "最稳",
      "spark.mood.calm": "平稳",
      "spark.mood.balanced": "均衡",
      "spark.mood.wild": "奔放",
      "spark.copied": "故事已复制",
      "spark.copyFailed": "故事复制失败",
      "spark.stat.ready": "从打开本页到就绪，在本设备上",
      "spark.stat.speed": "词每秒，在本设备上",
      "spark.stat.download": "下载量：模型、分词器和引擎合计",
      "spark.stat.parameters": "个参数，全部从随机数训练而来",
      "spark.stat.books": "本公有领域的书（{size} 文本）",
      "spark.stat.training": "训练时间，用一台笔记本电脑的处理器",
      "spark.stat.perplexity": "在未读过的书上的困惑度（越低越好）",
      "spark.bar.shipped": "GlowSpark（你下载到的版本）",
      "spark.bar.float": "GlowSpark（压缩到 8 位之前）",
      "spark.bar.baseline": "我们的第一次快速尝试（训练 {minutes} 分钟）",
      "spark.bar.xzPrimed": "xz（把全部训练用书都给它）",
      "spark.bar.xz": "xz",
      "spark.bar.bzip2": "bzip2",
      "spark.bar.gzip": "gzip",
      "spark.barsLede": "存储模型从未读过的 {books} 本书（{size}）时，每个字符需要的比特数。越低越好：下一个词预测得越准，需要的比特就越少。其他几行是文件压缩工具在同一文本上的成绩。",
      "spark.benchNote": "在构建它的笔记本电脑上（{hardware}），文件由同一台电脑提供，因此不含下载时间：打开页面后 {cold} 秒就绪，之后每秒 {speed} 个词。{note}",
      "spark.versusDownload": "只需下载 {size}",
      "spark.booksCount": "读过 {read} 本 · 留作测试 {held} 本",
      "spark.heldOut": "留作测试",
      "spark.benchMissing": "基准测试文件加载失败，因此不显示任何数字。",
      "spark.selftest.running": "正在核对…",
      "spark.selftest.error": "核对无法运行。请联网后再试。",
      "spark.selftest.pass": "✓ 一致。在 {total} 个测试开头中的 {same} 个上，这个引擎选出的词与 PyTorch 参考实现相同，分数最大相差 {diff}（上限 {tolerance}）。",
      "spark.selftest.fail": "✕ 不一致：{total} 个测试开头中有 {same} 个相符，分数最大相差 {diff}（上限 {tolerance}）。请告诉我们。",
      "apps.title": "Glow 应用", "apps.here": "当前位置", "profile": "个人资料与设置",
      "home.h1": "用免费 AI<br>把事情做成。",
      "home.lede": "说出你的需求，Glow 会为你挑选合适的助手。",
      "home.placeholder": "你需要什么？例如：规划一次 3 天的杭州之旅",
      "home.hint": "免费，无需注册。", "home.start": "开始",
      "home.ex1": "✈ 规划旅行", "home.ex1.q": "用不多的预算规划一次 3 天的杭州之旅",
      "home.ex2": "🔎 比较笔记本", "home.ex2.q": "比较 4000 元以内最值得买的笔记本电脑，并附上来源",
      "home.ex3": "✉ 写邮件", "home.ex3.q": "写一封简短友好的面试后跟进邮件",
      "home.choose": "或选择：", "home.pill.chat": "💬 聊天", "home.pill.room": "🏢 AI 团队", "home.pill.lead": "👑 主导目标",
      "home.tile.chat": "提问、写作、头脑风暴。", "home.tile.room": "AI 团队帮你上网搜索、运行代码。",
      "home.tile.lead": "交给它一个大目标，它会规划并检查成果。",
      "home.recent": "继续上次", "home.recentChats": "💬 最近的聊天", "home.recentMissions": "🏢 最近的团队任务",
      "home.noChats": "还没有聊天。", "home.noMissions": "还没有团队任务。", "home.untitled": "未命名聊天",
      "home.guestChip": "👤 访客", "home.guestText": "你正以访客身份使用 Glow。免费登录即可在所有 Glow 应用中使用更强的模型。",
      "home.signedText": "已登录为 {name}。所有 Glow 应用共用此账户。", "home.signIn": "登录",
      "home.reason.chat": "GlowChat 会马上回答。",
      "home.reason.room": "GlowRoom 团队会为此上网搜索或运行代码。",
      "home.reason.lead": "GlowLead 会一步步规划这个大目标。",
      "home.setup": "📥 获取 Windows、Android 和 iPhone 版 Glow 应用",
      "home.foot": "✦ Glow · 免费 · 聊天记录只保存在你的浏览器中",
      "home.install": "安装 Glow", "home.installAll": "安装全部 Glow 应用", "home.plans": "套餐与 Glow Pro", "home.privacy": "隐私", "home.terms": "条款与退款", "home.projects": "所有项目",
    },
    "zh-TW": {
      "region.INTL": "其他 / 國際", "region.ID": "印尼", "region.CN": "中國大陸", "region.HK": "香港與澳門",
      "region.TW": "台灣", "region.SG": "新加坡", "region.MY": "馬來西亞", "region.US": "美國", "region.EU": "歐盟", "region.AU": "澳洲",
      "welcome.title": "歡迎使用 Glow",
      "welcome.sub": "選擇你的語言和所在地區。之後可隨時在「個人檔案與設定」中變更。",
      "welcome.language": "語言",
      "welcome.region": "你在哪裡？",
      "welcome.suggested": "根據你的裝置建議",
      "welcome.continue": "繼續",
      "welcome.private": "只儲存在這個瀏覽器中，不會傳送到任何伺服器。",
      "welcome.allModels": "這裡可以使用所有 Glow AI 模型。",
      "welcome.limited": "{providers} 不在這裡提供服務，因此 Glow 會隱藏它們，改用 {preferred}。",
      "welcome.chinaOnly": "Glow 只提供服務中國大陸的模型（{preferred}），並隱藏其他模型（OpenAI、Anthropic、Google、xAI）。",
      "welcome.network": "Puter 登入、Google、GitHub 和即時雲端瀏覽器在這裡可能被封鎖或很慢。Glow Free 和 DeepSeek / 通義千問最穩定。",
      "welcome.local": "回答會使用在地資訊：{currency}，{units}單位。",
      "welcome.work": "這是公務或工作裝置（隱藏 DeepSeek 等受限模型）",
      "welcome.consent.pipl": "我同意將我的訊息傳送給 AI 服務商（部分位於中國大陸境外）以取得回答（依《個人信息保護法》的跨境傳輸單獨同意）。",
      "welcome.consent.gdpr": "我了解我的訊息會傳送給我選擇的 AI 服務商，可能位於歐盟境外。Glow 本身不在伺服器上儲存任何內容。",
      "welcome.privacy": "你所在地區的隱私說明",
      "welcome.chinaKeys": "提示：可在 GlowChat 設定中使用你自己的 DeepSeek、通義千問、Kimi 或智譜 GLM 金鑰，這些在中國大陸可用。",
      "price.approx": "≈ 每月 {price}（{date} 匯率）",
      "caution.deepseekGov": "此地區禁止在政府裝置上使用 DeepSeek：請勿用於公務。",
      "caution.deepseekPrivacy": "DeepSeek 的資料存放在中國，且歐盟監管機關（義大利）已封鎖其應用程式：請避免輸入個人資料。",
      "models.hidden": "🌏 有 {count} 個模型在{region}不提供，已隱藏。可在「語言與地區」中變更。",
      "menu.language": "語言與地區",
      "units.metric": "公制", "units.US customary": "英制",
      "apps.home": "Glow 首頁：從這裡開始",
      "apps.lead": "你的 AI 主管：規劃、分派任務、檢查成果",
      "apps.chat": "與任意 AI 模型聊天，還有議會和競技場",
      "apps.room": "會研究、寫程式並回報的 AI 團隊",
      "apps.news": "最新 AI 新聞，每天更新兩次",
      "home.news": "📰 GlowNews · 今日 AI",
      "home.tile.news": "今日 AI 新聞，每天兩次分組整理並摘要。",
      "home.pill.news": "📰 AI 新聞",
      "home.newsAll": "全部 AI 新聞 →",
      "news.title": "GlowNews",
      "news.brief": "重點速覽",
      "news.askBrief": "和 Glow 聊聊今天的 AI 新聞",
      "news.copy": "複製速覽",
      "news.search": "搜尋新聞、公司、模型…",
      "news.onlyNew": "新內容",
      "news.saved": "已收藏",
      "news.fine": "新聞來自每張卡片上連結的發布者。標有 ✦ AI 的摘要由免費 AI 根據發布者原文撰寫，可能有誤：使用前請打開原文查證。",
      "apps.spark": "我們從零打造的小型 AI：直接在你的裝置上寫作",
      "home.tile.spark": "我們自己的小型 AI，在你的裝置上寫童話，離線也能用。",
      "home.pill.spark": "✨ 小型 AI",
      "spark.title": "GlowSpark",
      "spark.lede": "我們從零打造的小型 AI。它就在你的裝置上寫童話：不用帳號，不經伺服器，無需等待。",
      "spark.writerTitle": "開始一個故事",
      "spark.promptLabel": "故事的開頭",
      "spark.placeholder": "故事怎麼開頭？用英文寫下開頭幾個字，或在上方選一個開頭。",
      "spark.creativity": "創意",
      "spark.length": "長度",
      "spark.short": "短",
      "spark.medium": "中",
      "spark.long": "長",
      "spark.write": "開始寫",
      "spark.stop": "停止",
      "spark.again": "換一個版本",
      "spark.more": "繼續寫",
      "spark.taleTitle": "你的故事",
      "spark.hint": "點任意一個詞，看看模型還考慮過哪些詞，並讓故事走向那條路。帶虛線的詞是它最沒把握的。",
      "spark.copy": "複製",
      "spark.speak": "朗讀",
      "spark.chat": "到 GlowChat 續寫",
      "spark.altTitle": "模型本來也可能寫",
      "spark.numbersTitle": "實測數字",
      "spark.numbersLede": "這裡沒有估算。每個數字都讀取自我們腳本產生的基準測試檔，帶綠點的兩項是在你使用時於你的裝置上即時計時的。",
      "spark.barsTitle": "它對從沒讀過的故事預測得有多準？",
      "spark.versusTitle": "它贏在哪裡，輸在哪裡",
      "spark.versusLede": "論知識，GlowSpark 不是 ChatGPT、Claude 或 Gemini 的對手。它瞄準的是它們做不到的事：瞬間啟動、隨處執行、離線可用，並且每個字都留在你的裝置上。",
      "spark.v.cloud": "雲端聊天機器人",
      "spark.v.web": "瀏覽器裡的大模型",
      "spark.v.chrome": "Chrome 內建 AI",
      "spark.v.r1": "知識與推理",
      "spark.v.r1.us": "沒有。它只讀過古老的童話。",
      "spark.v.r1.cloud": "目前最強",
      "spark.v.r1.web": "就小模型而言不錯",
      "spark.v.r1.chrome": "就小模型而言不錯",
      "spark.v.r2": "寫出第一個詞之前",
      "spark.v.r2.us": "一次很小的下載",
      "spark.v.r2.cloud": "多數需要登入，之後每次回覆都要往返資料中心",
      "spark.v.r2.web": "要下載大出許多倍的模型",
      "spark.v.r2.chrome": "由 Chrome 管理的模型下載",
      "spark.v.r3": "執行環境",
      "spark.v.r3.us": "任何現代瀏覽器，包括手機。純 JavaScript，在 CPU 上執行。",
      "spark.v.r3.cloud": "任何能連網的裝置",
      "spark.v.r3.web": "支援 WebGPU 的瀏覽器和裝置",
      "spark.v.r3.chrome": "受支援硬體上的桌面版 Chrome",
      "spark.v.r4": "離線可用",
      "spark.v.r4.us": "可以，首次造訪之後",
      "spark.v.r4.cloud": "不行",
      "spark.v.r4.web": "可以，下載之後",
      "spark.v.r4.chrome": "可以，下載之後",
      "spark.v.r5": "你的文字去了哪裡",
      "spark.v.r5.us": "哪裡也不去。根本沒有可以傳送的伺服器。",
      "spark.v.r5.cloud": "傳送到服務商的伺服器",
      "spark.v.r5.web": "留在裝置上",
      "spark.v.r5.chrome": "留在裝置上",
      "spark.v.r6": "帳號、金鑰或用量限制",
      "spark.v.r6.us": "都沒有",
      "spark.v.r6.cloud": "通常需要帳號，免費版有用量限制",
      "spark.v.r6.web": "都沒有",
      "spark.v.r6.chrome": "都沒有",
      "spark.v.r7": "能看到它為什麼選這個詞嗎？",
      "spark.v.r7.us": "能。點任意一個詞，就能看到其他候選詞和機率。",
      "spark.v.r7.cloud": "聊天應用程式裡看不到",
      "spark.v.r7.web": "只有應用程式自己做了才行",
      "spark.v.r7.chrome": "不能",
      "spark.v.sources": "其他幾欄的資料來源，核對日期",
      "spark.v.direct": "直接閱讀",
      "spark.v.search": "透過網路搜尋核對，因為在建置本頁的網路上打不開該頁面",
      "spark.v.noBench": "我們沒有親自測試這些系統，所以不對它們給出任何速度、大小或品質數字。",
      "spark.limitsTitle": "它做不到的事",
      "spark.limit1": "它不能回答問題。它不懂任何事實，只知道老故事通常怎麼發展。想要答案，請用 GlowChat。",
      "spark.limit2": "它只會寫英文，文風來自一百多年前的書，也帶著那些書裡的陳舊觀念。",
      "spark.limit3": "它很快就會離題。詞句聽起來像童話，但句子常常不通，人物和情節每一行都在變。",
      "spark.limit4": "它只記得最後幾百個詞，所以長故事會忘了自己是怎麼開頭的。",
      "spark.builtTitle": "從零打造",
      "spark.built1": "分詞器：我們自己寫的位元組對編碼器，用這些書訓練。沒有用任何分詞函式庫。",
      "spark.built2": "模型：一個從隨機數開始的小型 Transformer。沒有預訓練權重，沒有從別的模型下載任何東西。",
      "spark.built3": "訓練：一台筆電的處理器，不用顯示卡，只用公有領域的書。",
      "spark.built4": "引擎：專為本頁撰寫的純 JavaScript。沒有 AI 函式庫，不用 WebGPU，不用 WebAssembly。",
      "spark.selftest": "用參考實作核對這個引擎",
      "spark.booksTitle": "它讀過的書",
      "spark.booksLede": "全部在美國屬於公有領域，來自 Project Gutenberg。標有「留作測試」的書從未給模型看過：它們就是考題。",
      "spark.fine": "GlowSpark 只會編故事，僅此而已。這些故事由一個用舊書訓練的小模型在你的裝置上產生，可能古怪、有錯或過時。你在這裡輸入或產生的內容都不會離開本頁，除非你選擇把它傳送到 GlowChat。",
      "spark.status.waking": "正在喚醒模型…",
      "spark.status.loading": "正在下載模型… {percent}%",
      "spark.status.ready": "{seconds} 秒就緒",
      "spark.status.local": "在本裝置上執行，不向任何地方傳送內容",
      "spark.status.offline": "你處於離線狀態，而模型還沒有儲存到這台裝置上。",
      "spark.status.failed": "模型載入失敗。",
      "spark.retry": "重試",
      "spark.writeFailed": "寫作時出了點問題，請再試一次。",
      "spark.speed": "本裝置上每秒 {n} 個詞",
      "spark.alt.written": "已採用",
      "spark.alt.none": "模型在這裡沒有考慮別的詞。",
      "spark.starter.0": "小狐狸",
      "spark.starter.1": "三個女兒",
      "spark.starter.2": "黑森林",
      "spark.starter.3": "漁夫",
      "spark.starter.4": "兔子",
      "spark.starter.5": "窮樵夫",
      "spark.mood.safest": "最穩",
      "spark.mood.calm": "平穩",
      "spark.mood.balanced": "均衡",
      "spark.mood.wild": "奔放",
      "spark.copied": "故事已複製",
      "spark.copyFailed": "故事複製失敗",
      "spark.stat.ready": "從打開本頁到就緒，在本裝置上",
      "spark.stat.speed": "詞每秒，在本裝置上",
      "spark.stat.download": "下載量：模型、分詞器和引擎合計",
      "spark.stat.parameters": "個參數，全部從隨機數訓練而來",
      "spark.stat.books": "本公有領域的書（{size} 文字）",
      "spark.stat.training": "訓練時間，用一台筆電的處理器",
      "spark.stat.perplexity": "在未讀過的書上的困惑度（越低越好）",
      "spark.bar.shipped": "GlowSpark（你下載到的版本）",
      "spark.bar.float": "GlowSpark（壓縮到 8 位元之前）",
      "spark.bar.baseline": "我們的第一次快速嘗試（訓練 {minutes} 分鐘）",
      "spark.bar.xzPrimed": "xz（把全部訓練用書都給它）",
      "spark.bar.xz": "xz",
      "spark.bar.bzip2": "bzip2",
      "spark.bar.gzip": "gzip",
      "spark.barsLede": "儲存模型從未讀過的 {books} 本書（{size}）時，每個字元需要的位元數。越低越好：下一個詞預測得越準，需要的位元就越少。其他幾列是檔案壓縮工具在同一文字上的成績。",
      "spark.benchNote": "在建置它的筆電上（{hardware}），檔案由同一台筆電提供，因此不含下載時間：打開頁面後 {cold} 秒就緒，之後每秒 {speed} 個詞。{note}",
      "spark.versusDownload": "只需下載 {size}",
      "spark.booksCount": "讀過 {read} 本 · 留作測試 {held} 本",
      "spark.heldOut": "留作測試",
      "spark.benchMissing": "基準測試檔載入失敗，因此不顯示任何數字。",
      "spark.selftest.running": "正在核對…",
      "spark.selftest.error": "核對無法執行。請連網後再試。",
      "spark.selftest.pass": "✓ 一致。在 {total} 個測試開頭中的 {same} 個上，這個引擎選出的詞與 PyTorch 參考實作相同，分數最大相差 {diff}（上限 {tolerance}）。",
      "spark.selftest.fail": "✕ 不一致：{total} 個測試開頭中有 {same} 個相符，分數最大相差 {diff}（上限 {tolerance}）。請告訴我們。",
      "apps.title": "Glow 應用程式", "apps.here": "目前位置", "profile": "個人檔案與設定",
      "home.h1": "用免費 AI<br>把事情做好。",
      "home.lede": "說出你的需求，Glow 會替你挑選合適的助手。",
      "home.placeholder": "你需要什麼？例如：規劃 3 天的花蓮之旅",
      "home.hint": "免費，無需註冊。", "home.start": "開始",
      "home.ex1": "✈ 規劃旅行", "home.ex1.q": "用小預算規劃 3 天的花蓮之旅",
      "home.ex2": "🔎 比較筆電", "home.ex2.q": "比較 NT$20,000 以內最值得買的筆電，並附上來源",
      "home.ex3": "✉ 寫信", "home.ex3.q": "寫一封簡短友善的面試後追蹤信",
      "home.choose": "或選擇：", "home.pill.chat": "💬 聊天", "home.pill.room": "🏢 AI 團隊", "home.pill.lead": "👑 主導目標",
      "home.tile.chat": "提問、寫作、腦力激盪。", "home.tile.room": "AI 團隊幫你上網搜尋、執行程式碼。",
      "home.tile.lead": "交給它一個大目標，它會規劃並檢查成果。",
      "home.recent": "繼續上次", "home.recentChats": "💬 最近的聊天", "home.recentMissions": "🏢 最近的團隊任務",
      "home.noChats": "還沒有聊天。", "home.noMissions": "還沒有團隊任務。", "home.untitled": "未命名聊天",
      "home.guestChip": "👤 訪客", "home.guestText": "你正以訪客身分使用 Glow。免費登入即可在所有 Glow 應用程式中使用更強的模型。",
      "home.signedText": "已登入為 {name}。所有 Glow 應用程式共用此帳戶。", "home.signIn": "登入",
      "home.reason.chat": "GlowChat 會馬上回答。",
      "home.reason.room": "GlowRoom 團隊會為此上網搜尋或執行程式碼。",
      "home.reason.lead": "GlowLead 會一步步規劃這個大目標。",
      "home.setup": "📥 取得 Windows、Android 和 iPhone 版 Glow 應用程式",
      "home.foot": "✦ Glow · 免費 · 聊天紀錄只保存在你的瀏覽器中",
      "home.install": "安裝 Glow", "home.installAll": "安裝全部 Glow 應用程式", "home.plans": "方案與 Glow Pro", "home.privacy": "隱私", "home.terms": "條款與退款", "home.projects": "所有專案",
    },
  };

  // Automated browsers (tests) never see the first-run picker and keep the international defaults,
  // unless the URL asks for it with ?glowlocale=ask.
  const automated = !!navigator.webdriver && !/[?&#]glowlocale=ask\b/.test(location.search + location.hash);
  const embedded = (function () {
    try {
      return window.top !== window;
    } catch (error) {
      return true;
    }
  })();

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && LANGUAGES[saved.lang] && REGIONS[saved.region] && consentOk(saved.region, saved.consent)) return saved;
    } catch (error) {
      // Unreadable: ask again.
    }
    return null;
  }

  function consentOk(region, consent) {
    return !CONSENT_REGIONS[region] || !!(consent && consent.region === region && consent.at);
  }

  function detectLanguage() {
    for (const tag of navigator.languages || [navigator.language || "en"]) {
      const lower = String(tag).toLowerCase();
      if (/^zh-(tw|hk|mo|hant)/.test(lower)) return "zh-TW";
      if (/^zh/.test(lower)) return "zh-CN";
      if (/^(id|in|ms)\b/.test(lower)) return "id";
      if (/^en/.test(lower)) return "en";
    }
    return "en";
  }

  function detectRegion(lang) {
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (error) {
      zone = "";
    }
    if (TIMEZONE_REGIONS[zone]) return TIMEZONE_REGIONS[zone];
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage)|^Pacific\/Honolulu/.test(zone)) return "US";
    if (/^Australia\//.test(zone)) return "AU";
    if (/^Europe\/(Berlin|Paris|Rome|Madrid|Amsterdam|Brussels|Vienna|Warsaw|Prague|Stockholm|Copenhagen|Helsinki|Dublin|Lisbon|Athens|Budapest|Bucharest|Sofia|Zagreb|Ljubljana|Bratislava|Vilnius|Riga|Tallinn|Luxembourg|Malta|Nicosia)$/.test(zone)) return "EU";
    return LANGUAGES[lang].region;
  }

  function suggestion() {
    const lang = detectLanguage();
    return { lang, region: detectRegion(lang) };
  }

  function current() {
    const saved = readSaved();
    if (saved) return { lang: saved.lang, region: saved.region, chosen: true, workDevice: !!saved.workDevice };
    if (automated) return { lang: "en", region: "INTL", chosen: false, workDevice: false };
    return { ...suggestion(), chosen: false, workDevice: false };
  }

  function t(key, vars, langOverride) {
    const lang = langOverride || current().lang;
    let text = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) text = text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] != null ? String(vars[name]) : match));
    return text;
  }

  // Readers in mainland China see the names used there; everyone else sees neutral names.
  const MAINLAND_NAMES = { HK: "中国香港、澳门", TW: "中国台湾" };
  function regionName(code, lang, viewerRegion) {
    const language = lang || current().lang;
    const viewer = viewerRegion || current().region;
    if (language === "zh-CN" && viewer === "CN" && MAINLAND_NAMES[code]) return MAINLAND_NAMES[code];
    return t(`region.${code}`, null, language);
  }

  // ---- AI models per region ----
  function bareModelId(value) {
    const text = String(value || "");
    const split = text.indexOf("::");
    const provider = split === -1 ? "" : text.slice(0, split);
    let id = split === -1 ? text : text.slice(split + 2);
    id = id.replace(/^openrouter:/, "");
    return { provider, id };
  }

  function modelFamily(value) {
    const { id } = bareModelId(value);
    return Object.keys(FAMILIES).find((family) => FAMILIES[family].test(id)) || "";
  }

  // value: a Glow model value ("puter::gpt-5-mini", "openrouter::anthropic/claude-…") or a bare id.
  function modelPolicy(value, regionCode) {
    const code = regionCode || current().region;
    const region = REGIONS[code] || REGIONS.INTL;
    const { provider, id } = bareModelId(value);
    const family = modelFamily(value);
    // Your own computer, your own endpoint, Glow Offline on this device and the offline demo are never filtered.
    if (["ollama", "custom", "demo", "local", "library"].includes(provider)) return { allowed: true, family, caution: "" };
    let allowed = true;
    if (region.allow) allowed = provider === "free" || region.allow.some((pattern) => pattern.test(id));
    else if (region.block) allowed = !region.block.includes(family);
    const cautionKey = region.caution && region.caution[family];
    // A work or government device hides restricted models instead of warning (DeepSeek everywhere).
    if (current().workDevice && (cautionKey || family === "deepseek")) allowed = false;
    return {
      allowed,
      family,
      reason: allowed ? "" : regionName(code),
      caution: cautionKey ? t(`caution.${cautionKey}`) : "",
    };
  }

  function modelAllowed(value, regionCode) {
    return modelPolicy(value, regionCode).allowed;
  }

  function regionSummary(code, lang) {
    const region = REGIONS[code] || REGIONS.INTL;
    const lines = [];
    if (region.allow) {
      lines.push(t("welcome.chinaOnly", { preferred: "DeepSeek, Qwen, GLM, Kimi, MiniMax" }, lang));
    } else if (region.block && region.block.length) {
      lines.push(t("welcome.limited", { providers: region.block.map((f) => PROVIDER_NAMES[f]).join(", "), preferred: "DeepSeek, Qwen, GLM, Kimi" }, lang));
    } else {
      lines.push(t("welcome.allModels", null, lang));
    }
    for (const key of Object.values(region.caution || {})) lines.push("⚠ " + t(`caution.${key}`, null, lang));
    if (region.network) lines.push("📶 " + t("welcome.network", null, lang));
    // Own AI keys are hidden in GlowChat for now (OWN_AI_SERVICES_SHOWN in chat/app.js), so the key tip is too.
  if (code === "CN" && OWN_KEY_TIP_SHOWN) lines.push("🔑 " + t("welcome.chinaKeys", null, lang));
    if (code !== "INTL") lines.push(t("welcome.local", { currency: region.currency, units: t(`units.${region.units}`, null, lang) }, lang));
    return lines;
  }

  // A short note for system prompts so answers fit the user's language and place.
  function aiContext() {
    const now = current();
    if (!now.chosen) return "";
    const language = LANGUAGES[now.lang];
    const region = REGIONS[now.region];
    let text = `\n\nThe user's Glow app language is ${language.ai}. When it is unclear which language to use, reply in ${language.ai}.`;
    if (now.region !== "INTL") {
      text += ` The user is in ${regionName(now.region, "en")}: when it helps, use local context (prices in ${region.currency}, ${region.units} units, local services, holidays and rules).`;
    }
    return text;
  }

  function speechLanguage() {
    const now = current();
    return now.chosen ? LANGUAGES[now.lang].speech : (navigator.language || "en-US");
  }

  function formatMoney(amount, currency) {
    const now = current();
    const code = currency || (REGIONS[now.region] || REGIONS.INTL).currency;
    try {
      return new Intl.NumberFormat(now.lang, { style: "currency", currency: code, maximumFractionDigits: code === "IDR" ? 0 : 2 }).format(amount);
    } catch (error) {
      return `${code} ${amount}`;
    }
  }

  // ---- translate a page: data-i18n (text), data-i18n-html (trusted markup from STRINGS),
  // data-i18n-placeholder, data-i18n-title, data-i18n-example (the prompt an example button fills in) ----
  function apply(root) {
    const scope = root || document;
    document.documentElement.lang = current().lang;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    scope.querySelectorAll("[data-i18n-example]").forEach((el) => {
      el.dataset.example = t(el.dataset.i18nExample);
    });
  }

  const listeners = new Set();
  function onChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function save(lang, region, extras) {
    const more = extras || {};
    const previous = readSaved();
    const record = { lang, region, savedAt: Date.now(), rules: RULES_CHECKED, workDevice: !!more.workDevice };
    if (CONSENT_REGIONS[region]) record.consent = more.consent ? { region, kind: CONSENT_REGIONS[region], at: Date.now() } : null;
    localStorage.setItem(STORE_KEY, JSON.stringify(record));
    const changed = !previous || previous.lang !== lang || previous.region !== region || !!previous.workDevice !== record.workDevice;
    if (changed && translatorOn) {
      location.reload();
      return;
    }
    apply();
    window.dispatchEvent(new CustomEvent("glow-locale", { detail: current() }));
    if (!changed) return;
    // Pages that can't re-render live (model lists, prompts already built) reload once.
    if (listeners.size) listeners.forEach((callback) => callback(current()));
    else location.reload();
  }


  // ---- whole-app translation: the English UI text of GlowChat, GlowRoom, GlowLead and Profile is
  // swapped for the chosen language using the phrase lists in shared/i18n/ui.<lang>.js (built by
  // tools/build_i18n.py). Chat messages, chat titles, mission results and anything you type are never touched.
  const SKIP_TEXT = "script,style,code,pre,textarea,svg,[contenteditable],[data-no-i18n],#messages,#history,.bubble,.markdown,.msg-content,.mission-output,.report,#glow-locale-picker";
  const SKIP_ATTR = "[data-no-i18n],#messages,#history,.bubble,.markdown,#glow-locale-picker";
  const ATTRS = ["placeholder", "title", "aria-label"];
  let uiStrings = null;
  let uiPatterns = [];
  let translatorOn = false;
  const shownText = new WeakMap();
  const SPLIT = /^([^A-Za-z0-9"'(“]*)([\s\S]*?)([\s→›»:]*)$/;

  function translateUi(raw) {
    if (!uiStrings || !raw) return null;
    const parts = SPLIT.exec(raw);
    if (!parts) return null;
    const core = parts[2].replace(/\s+/g, " ").trim();
    if (!core || !/[A-Za-z]/.test(core)) return null;
    let hit = Object.prototype.hasOwnProperty.call(uiStrings, core) ? uiStrings[core] : null;
    if (hit == null) {
      for (const [pattern, replacement] of uiPatterns) {
        if (pattern.test(core)) {
          hit = core.replace(pattern, replacement);
          break;
        }
      }
    }
    if (hit == null) return null;
    return parts[1] + hit + parts[3];
  }

  function letterNodes(parent) {
    return [...parent.childNodes].filter((node) => node.nodeType === 3 && /[A-Za-z]{2}/.test(originalOf(node)));
  }

  function originalOf(node) {
    const memo = shownText.get(node);
    if (memo && node.nodeValue === memo.shown) return memo.original;
    return node.nodeValue;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_TEXT)) return;
    const original = originalOf(node);
    if (!/[A-Za-z]{2}/.test(original)) return;
    // A sentence split by a link (text <a>link</a> text) is translated only when every piece is known,
    // so a paragraph is never half English, half translated.
    const siblings = letterNodes(parent);
    if (siblings.length > 1 && siblings.some((other) => other !== node && translateUi(originalOf(other)) == null)) return;
    const translated = translateUi(original);
    if (translated == null || translated === node.nodeValue) return;
    shownText.set(node, { original, shown: translated });
    node.nodeValue = translated;
  }

  function translateAttributes(element) {
    if (element.closest(SKIP_ATTR)) return;
    for (const name of ATTRS) {
      const value = element.getAttribute(name);
      if (!value || !/[A-Za-z]{2}/.test(value)) continue;
      const key = "data-i18n-was-" + name;
      const shownKey = "data-i18n-shown-" + name;
      const original = element.getAttribute(shownKey) === value ? element.getAttribute(key) : value;
      const translated = translateUi(original);
      if (translated == null || translated === value) continue;
      element.setAttribute(key, original);
      element.setAttribute(shownKey, translated);
      element.setAttribute(name, translated);
    }
  }

  function translateTree(root) {
    if (!translatorOn || !root) return;
    if (root.nodeType === 3) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    const start = root.nodeType === 9 ? root.body : root;
    if (!start) return;
    if (start.nodeType === 1) translateAttributes(start);
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === 3) translateTextNode(node);
      else translateAttributes(node);
    }
  }

  let pending = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const batch = pending;
    pending = new Set();
    batch.forEach((node) => {
      if (node.isConnected) translateTree(node);
    });
  }
  const observer = typeof MutationObserver === "function" ? new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") pending.add(mutation.target);
      else if (mutation.type === "attributes") pending.add(mutation.target);
      else mutation.addedNodes.forEach((node) => pending.add(node));
    }
    if (!scheduled && pending.size) {
      scheduled = true;
      (window.queueMicrotask || setTimeout)(flush);
    }
  }) : null;

  function registerStrings(payload) {
    if (!payload || payload.lang !== current().lang) return;
    uiStrings = payload.phrases || {};
    uiPatterns = (payload.patterns || []).map(([source, replacement]) => [new RegExp(source), replacement]);
    translatorOn = true;
    const start = () => {
      translateTree(document.body);
      if (observer) observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }

  function loadUiStrings() {
    const lang = current().lang;
    if (lang === "en" || automated && !/[?&#]glowlocale=/.test(location.search + location.hash)) return;
    const script = document.createElement("script");
    script.src = new URL(`i18n/ui.${lang}.js`, scriptBase).href;
    script.async = false;
    document.head.appendChild(script);
  }

  // ---- prices in your currency (approximate) ----
  function localPrice(label) {
    const match = String(label || "").match(/(?:US)?\$\s?(\d+(?:\.\d{1,2})?)/);
    const now = current();
    const currency = (REGIONS[now.region] || REGIONS.INTL).currency;
    if (!match || currency === "USD" || !USD_RATES[currency]) return "";
    const amount = Number(match[1]) * USD_RATES[currency];
    const rounded = currency === "IDR" ? Math.round(amount / 1000) * 1000 : Math.round(amount);
    return t("price.approx", { price: formatMoney(rounded, currency), date: RATES_DATE });
  }

  function endpoint(name) {
    const overrides = REGION_ENDPOINTS[current().region] || {};
    return overrides[name] || "";
  }

  // ---- the first-run picker (also opened from Profile & settings and the menus) ----
  const CSS = `
.glow-locale-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,9,.62);backdrop-filter:blur(6px);
  display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
.glow-locale-card{width:min(480px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#30302e;color:#f5f4ee;
  border:1px solid rgba(255,255,255,.12);border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.5);padding:22px 22px 18px}
.glow-locale-card h2{margin:0 0 4px;font-size:22px}
.glow-locale-card p{margin:0 0 14px;color:#c9c7bd}
.glow-locale-label{display:block;margin:14px 0 8px;font-weight:650}
.glow-locale-label small{font-weight:400;color:#a8a69c;margin-left:6px}
.glow-locale-langs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.glow-locale-lang{padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);
  color:inherit;font:inherit;cursor:pointer;text-align:left}
.glow-locale-lang:hover{background:rgba(255,255,255,.08)}
.glow-locale-lang[aria-checked="true"]{border-color:#e8875d;background:rgba(232,135,93,.18);font-weight:650}
.glow-locale-select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#262624;color:inherit;font:inherit}
.glow-locale-info{margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:13.5px;color:#d8d6cc}
.glow-locale-info div+div{margin-top:6px}
.glow-locale-go{margin-top:16px;width:100%;padding:12px;border:0;border-radius:12px;background:#d97757;color:#fff;font:650 16px/1 inherit;cursor:pointer}
.glow-locale-go:hover{filter:brightness(1.06)}
.glow-locale-private{margin:10px 0 0;text-align:center;font-size:12.5px;color:#a8a69c}
.glow-locale-check{display:flex;gap:8px;align-items:flex-start;margin:12px 0 0;font-size:13.5px;cursor:pointer}
.glow-locale-check input{margin-top:3px;accent-color:#d97757}
.glow-locale-consent{padding:10px 12px;border-radius:12px;border:1px solid rgba(232,135,93,.45);background:rgba(232,135,93,.08)}
.glow-locale-privacy{display:inline-block;margin-top:10px;font-size:13px;color:#e8875d}
.glow-locale-go:disabled{opacity:.45;cursor:not-allowed}
@media (prefers-color-scheme: light){
  .glow-locale-card{background:#faf9f5;color:#2b2a27;border-color:rgba(0,0,0,.1)}
  .glow-locale-card p,.glow-locale-info{color:#55534c}
  .glow-locale-lang{border-color:rgba(0,0,0,.14);background:#fff}
  .glow-locale-select{background:#fff;border-color:rgba(0,0,0,.14)}
  .glow-locale-info{background:rgba(0,0,0,.04)}
}`;

  let picker = null;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function openPicker(options) {
    const settings = options || {};
    if (picker) return picker;
    if (!document.getElementById("glow-locale-style")) {
      const style = document.createElement("style");
      style.id = "glow-locale-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const start = current();
    const suggested = suggestion();
    let lang = start.lang;
    let region = start.region;
    let regionTouched = start.chosen;
    let workDevice = !!start.workDevice;
    const savedNow = readSaved();
    let consent = !!(savedNow && savedNow.consent && savedNow.consent.region === region);

    const backdrop = document.createElement("div");
    backdrop.className = "glow-locale-backdrop";
    backdrop.id = "glow-locale-picker";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "glow-locale-title");

    function render() {
      const regionOptions = REGION_ORDER.map((code) => `<option value="${code}"${code === region ? " selected" : ""}>${SHOW_FLAGS ? REGIONS[code].flag + " " : ""}${escapeHtml(regionName(code, lang, region))}</option>`).join("");
      const consentKind = CONSENT_REGIONS[region];
      const privacyHref = new URL(`../privacy.html#${PRIVACY_ANCHORS[region] || "top"}`, scriptBase).href;
      const langButtons = Object.entries(LANGUAGES).map(([code, info]) => `<button type="button" class="glow-locale-lang" role="radio" data-lang="${code}" aria-checked="${code === lang}">${escapeHtml(info.native)}</button>`).join("");
      const hint = !start.chosen && region === suggested.region ? `<small>${escapeHtml(t("welcome.suggested", null, lang))}</small>` : "";
      backdrop.innerHTML = `<div class="glow-locale-card">
        <h2 id="glow-locale-title">✦ ${escapeHtml(t("welcome.title", null, lang))}</h2>
        <p>${escapeHtml(t("welcome.sub", null, lang))}</p>
        <span class="glow-locale-label">${escapeHtml(t("welcome.language", null, lang))}</span>
        <div class="glow-locale-langs" role="radiogroup">${langButtons}</div>
        <label class="glow-locale-label" for="glow-locale-region">${escapeHtml(t("welcome.region", null, lang))}${hint}</label>
        <select class="glow-locale-select" id="glow-locale-region">${regionOptions}</select>
        <div class="glow-locale-info" id="glow-locale-info">${regionSummary(region, lang).map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
        <label class="glow-locale-check"><input type="checkbox" id="glow-locale-work"${workDevice ? " checked" : ""}> <span>${escapeHtml(t("welcome.work", null, lang))}</span></label>
        ${consentKind ? `<label class="glow-locale-check glow-locale-consent"><input type="checkbox" id="glow-locale-consent"${consent ? " checked" : ""}> <span>${escapeHtml(t("welcome.consent." + consentKind, null, lang))}</span></label>` : ""}
        <a class="glow-locale-privacy" href="${privacyHref}" target="_blank" rel="noopener">🔒 ${escapeHtml(t("welcome.privacy", null, lang))} ↗</a>
        <button type="button" class="glow-locale-go" id="glow-locale-go"${consentKind && !consent ? " disabled" : ""}>${escapeHtml(t("welcome.continue", null, lang))} →</button>
        <p class="glow-locale-private">🔒 ${escapeHtml(t("welcome.private", null, lang))}</p>
      </div>`;
      backdrop.querySelectorAll("[data-lang]").forEach((button) => {
        button.addEventListener("click", () => {
          lang = button.dataset.lang;
          // The region follows the language until you pick one yourself, unless your current
          // region already speaks it (a Traditional Chinese reader in Hong Kong stays in Hong Kong).
          if (!regionTouched && REGIONS[region].lang !== lang) {
            region = suggested.region && REGIONS[suggested.region].lang === lang ? suggested.region : LANGUAGES[lang].region;
          }
          render();
          const again = backdrop.querySelector(`[data-lang="${lang}"]`);
          if (again) again.focus();
        });
      });
      backdrop.querySelector("#glow-locale-region").addEventListener("change", (event) => {
        region = event.target.value;
        regionTouched = true;
        consent = !!(savedNow && savedNow.consent && savedNow.consent.region === region);
        render();
        backdrop.querySelector("#glow-locale-region").focus();
      });
      backdrop.querySelector("#glow-locale-work").addEventListener("change", (event) => {
        workDevice = event.target.checked;
      });
      const consentBox = backdrop.querySelector("#glow-locale-consent");
      if (consentBox) {
        consentBox.addEventListener("change", (event) => {
          consent = event.target.checked;
          backdrop.querySelector("#glow-locale-go").disabled = !consent;
        });
      }
      backdrop.querySelector("#glow-locale-go").addEventListener("click", () => {
        if (CONSENT_REGIONS[region] && !consent) return;
        close();
        save(lang, region, { workDevice, consent });
      });
    }

    function close() {
      backdrop.remove();
      picker = null;
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(event) {
      // The first-run picker needs an answer; later it can be closed with Escape.
      if (event.key === "Escape" && settings.dismissible) {
        event.stopPropagation();
        close();
      }
    }
    if (settings.dismissible) {
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close();
      });
    }
    document.addEventListener("keydown", onKey, true);
    render();
    document.body.appendChild(backdrop);
    const first = backdrop.querySelector('[aria-checked="true"]') || backdrop.querySelector("[data-lang]");
    if (first) first.focus();
    picker = backdrop;
    return backdrop;
  }

  function firstRun() {
    apply();
    if (readSaved() || automated || embedded) return;
    openPicker({ dismissible: false });
  }

  document.documentElement.lang = current().lang;
  // A China-reachable cloud service (if configured) replaces the default for the apps that read it.
  if (endpoint("cloud") && !window.GLOW_CLOUD_SERVICE_URL) window.GLOW_CLOUD_SERVICE_URL = endpoint("cloud");
  loadUiStrings();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", firstRun);
  else firstRun();

  // Another Glow tab changed the language or region: follow it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY) return;
    apply();
    if (listeners.size) listeners.forEach((callback) => callback(current()));
  });

  window.GlowLocale = {
    get: current,
    t,
    apply,
    onChange,
    openPicker: () => openPicker({ dismissible: true }),
    save,
    regionName,
    regionSummary,
    modelPolicy,
    modelAllowed,
    modelFamily,
    aiContext,
    speechLanguage,
    formatMoney,
    languages: Object.keys(LANGUAGES),
    regions: REGION_ORDER.slice(),
    rulesChecked: RULES_CHECKED,
    registerStrings,
    translateUi,
    translatePage: () => translateTree(document.body),
    localPrice,
    endpoint,
    chinaProviders: CHINA_PROVIDERS.map((p) => ({ ...p })),
    privacyUrl: () => new URL(`../privacy.html#${PRIVACY_ANCHORS[current().region] || "top"}`, scriptBase).href,
  };
})();
