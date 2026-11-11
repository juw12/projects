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
      "apps.harness": "An agent harness we built from scratch: tools, permissions, every step shown",
      "apps.code": "Kilat, a small safe language: run code in a sandbox on your device",
      "home.tile.harness": "Our own agent harness. It lets an AI use tools, shows every step, and asks before anything changes.",
      "home.pill.harness": "🧰 Agent",
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
      "harness.theme.toLight": "Switch to light",
      "harness.theme.toDark": "Switch to dark",
      "harness.loadFailed": "The engine did not load. Check your connection and reload the page.",
      "harness.tool.calc": "Calculator",
      "harness.tool.text": "Text",
      "harness.tool.clock": "Calendar",
      "harness.tool.units": "Units",
      "harness.tool.notes": "Notebook",
      "harness.tool.library": "Library",
      "harness.tool.tale": "Storyteller",
      "harness.tool.calcDesc": "Exact arithmetic, however long the numbers.",
      "harness.tool.textDesc": "Counts letters and words, reverses text, changes case.",
      "harness.tool.clockDesc": "Knows today's date and does date arithmetic.",
      "harness.tool.unitsDesc": "Converts between units with exact factors.",
      "harness.tool.notesDesc": "Its only memory. Notes are saved in this browser.",
      "harness.tool.libraryDesc": "Searches the offline packs you installed in GlowChat.",
      "harness.tool.taleDesc": "Asks GlowSpark, Glow's own tiny story model, to continue an opening.",
      "harness.tool.notesRisk": "Asks before saving or deleting.",
      "harness.tool.taleRisk": "The first use downloads the story model, so it asks first.",
      "harness.ex.sum": "A long sum",
      "harness.ex.days": "Days until a date",
      "harness.ex.letters": "Count letters",
      "harness.ex.convert": "Miles to km",
      "harness.ex.chain": "Two steps",
      "harness.ex.remember": "Remember this",
      "harness.ex.recall": "Recall it",
      "harness.ex.tale": "A tiny tale",
      "harness.cat.arithmetic": "Arithmetic",
      "harness.cat.text": "Text",
      "harness.cat.dates": "Dates",
      "harness.cat.units": "Units",
      "harness.cat.memory": "Memory",
      "harness.cat.multistep": "Several steps",
      "harness.cat.controls": "Controls (knowledge, no tool helps)",
      "harness.status.done": "Answer",
      "harness.status.limit": "It ran out of steps or time",
      "harness.status.loop": "Stopped: it kept repeating itself",
      "harness.status.stopped": "Stopped",
      "harness.status.error": "It could not finish",
      "harness.who.rules": "the no-model rules",
      "harness.row.task": "Your task",
      "harness.ask.save": "Save a note: {key} = {value}",
      "harness.ask.delete": "Delete the note “{key}”",
      "harness.ask.clear": "Delete every saved note",
      "harness.ask.download": "Download GlowSpark, the small story model, and let it write on this device",
      "harness.ask.use": "Use {tool} with {args}",
      "harness.ask.someTool": "a tool",
      "harness.ask.untrusted": "It asks again because this run has read text from {source}. Such text can hide instructions meant to trick an AI, so nothing changes without your yes.",
      "harness.ask.destructive": "This deletes something saved in this browser. It cannot be undone.",
      "harness.ask.downloadWhy": "A one-time download. After that the story model works offline.",
      "harness.ask.write": "This saves something in this browser, on this device.",
      "harness.ask.everyTime": "You set this tool to ask every time.",
      "harness.ask.title": "It asks your permission",
      "harness.ask.once": "Allow once",
      "harness.ask.always": "Always allow",
      "harness.ask.deny": "Don't allow",
      "harness.ask.saidAlways": "✓ Allowed from now on",
      "harness.ask.saidNo": "✕ Not allowed",
      "harness.ask.saidOnce": "✓ Allowed this once",
      "harness.row.call": "It calls {tool}",
      "harness.badge.repaired": "Repaired: {code}",
      "harness.row.invalid": "The harness found no tool call and no answer in that reply",
      "harness.row.unknownTool": "It asked for a tool that does not exist: {tool}",
      "harness.row.badArgs": "{tool} cannot use those arguments",
      "harness.guard.abort": "You pressed Stop",
      "harness.guard.repairs": "It gave up after {limit} corrections in a row",
      "harness.guard.steps": "It reached the limit of {limit} steps",
      "harness.guard.time": "It reached the time limit of {seconds} s",
      "harness.guard.loop": "It kept making the same {tool} call, so the harness stopped the run",
      "harness.guard.duplicate": "It repeated a {tool} call it had already made, so the harness pointed it back to the earlier result",
      "harness.gate.off": "Blocked: you switched {tool} off",
      "harness.gate.blocked": "Blocked: {tool} needed a permission and nobody could give it",
      "harness.row.thinking": "Step {step}: thinking…",
      "harness.row.model": "Step {step}: {who} replied",
      "harness.badge.native": "sent as a native function call, turned back into text",
      "harness.row.modelError": "The brain did not answer",
      "harness.row.repairCount": "try {streak} of {limit}",
      "harness.row.repair": "The harness explained the mistake and asked again",
      "harness.row.compact": "Older tool results were shortened to keep the conversation small",
      "harness.row.running": "{tool} is working…",
      "harness.row.result": "{tool} returned",
      "harness.row.timeout": "{tool} took too long",
      "harness.row.failed": "{tool} could not do that",
      "harness.badge.untrusted": "untrusted text: given to the brain as data, not as instructions",
      "harness.badge.instructions": "contains what looks like instructions",
      "harness.badge.clipped": "shortened before the brain saw it",
      "harness.badge.repeat": "same call as before",
      "harness.wait.title": "The free model is busy",
      "harness.wait.text": "Too many people are using it right now. Trying again in {seconds} s. Press Stop to give up.",
      "harness.runStats.running": "working…",
      "harness.runStats": "Steps {steps} · Tool calls {calls} · {seconds} s",
      "harness.answer.stopped": "You stopped it before it had an answer.",
      "harness.answer.none": "It has no answer for this one.",
      "harness.note.unmatched": "With no model it only follows patterns: sums, dates, units, text and notes, asked in plain English. For anything else, try the free model or ask GlowChat.",
      "harness.note.fallback": "The run did not finish cleanly, so the harness put this together from what the tools returned. Check it before you rely on it.",
      "harness.note.implicit": "The brain did not mark its answer, so its whole reply is shown.",
      "harness.note.error": "What went wrong: {message}.",
      "harness.note.offline": "You are offline. The free model needs the internet. The no-model brain does not.",
      "harness.needTask": "Type a task first, or tap an example.",
      "harness.replay.running": "Replaying…",
      "harness.replay.failed": "The replay could not run.",
      "harness.replay.same": "✓ Replayed. The engine went through the recording again and made the same {events} moves in the same order.",
      "harness.replay.differs": "✕ The replay left the recording at move {at} of {events}. Please tell us.",
      "harness.exported": "Trace saved. It holds your task and every step.",
      "harness.copied": "Answer copied",
      "harness.copyFailed": "Couldn't copy",
      "harness.meta": "Ready · engine {version} · {tools} tools · no install, no account",
      "harness.privacy.freeHead": "This sends your task out.",
      "harness.privacy.free": "Your task and every tool result go to a free AI provider ({providers}). No account needed. These models are small, rationed and sometimes wrong.",
      "harness.privacy.rulesHead": "Nothing leaves this page.",
      "harness.privacy.rules": "No AI model at all: pattern rules choose the tools. It follows plain English requests about sums, dates, units, text and notes, and says so when it cannot.",
      "harness.examplesLabel": "Example tasks",
      "harness.tool.readOnly": "Only reads.",
      "harness.choice.allow": "Allow",
      "harness.choice.ask": "Ask",
      "harness.choice.off": "Off",
      "harness.notes.forget": "Forget {key}",
      "harness.notes.cleared": "Everything forgotten",
      "harness.table.alone": "alone",
      "harness.table.harness": "in the harness",
      "harness.table.tasks": "Tasks",
      "harness.table.noModel": "No model",
      "harness.table.total": "All tasks",
      "harness.table.answerable": "Without the tasks that need today's date or a saved note",
      "harness.m.sample": "This is a small test: {tasks} tasks, each asked {passes} time per model at temperature {temperature}. One or two tasks either way is noise, not a finding.",
      "harness.m.sampleNoModels": "This is a small test: {tasks} tasks. This build has no finished free-model run.",
      "harness.m.author": "The author of the harness also wrote the {tasks} tasks, the {cases} broken tool calls and the {attacks} attacks. Nobody independent has checked them.",
      "harness.m.rules": "The no-model brain is a set of patterns tuned on these same tasks, so its score is a best case, not a forecast for your own wording. It fails all {controls} control tasks by design: they need knowledge and it has none.",
      "harness.m.alone": "“Alone” is the same model, the same question and no tools. {count} tasks ({ids}) ask for today's date or for a note saved earlier, and a model alone is given neither. The free models still got some of them right alone ({list}). We never sent the date. One reply quotes a date line that we did not write, so it seems the providers add one. Only the {memory} memory tasks ({memoryIds}) cannot be answered alone at all. The last row of the table leaves all {count} out.",
      "harness.m.clock": "Why a model alone could get a date task right: the clock these tasks use is fixed to the same date as the runs (UTC), so a date added by a provider was the right one. On another day it would not match, and we have not tried that. One of those passes is generous: the task also asks to save a note, its checker reads only the day count, and the reply says a note was saved, which a model alone cannot do.",
      "harness.m.judge": "In the harness only the final answer is judged. A number passes when the right number appears in the answer as a whole number, whatever else is said.",
      "harness.m.approve": "The benchmark script approved every permission prompt, used an empty library and never loaded GlowSpark, so those two tools are not measured here.",
      "harness.m.corpus": "Broken tool calls: {recovered} of {cases} read correctly, across {families} kinds of breakage. Missed: {missed}. The strict baseline is a plain JSON read of the whole reply and reads {strict} of them by construction. It shows that repair is needed. It is not a comparison with another harness.",
      "harness.m.controls": "{held} of {controls} ordinary replies that must not be read as tool calls were left alone.",
      "harness.m.injection": "Prompt injection: {delivered} of {attacks} attacks reached the brain marked as data. A simulated brain that obeys every injected instruction then tried to save or delete. With the rule on, {held} were stopped at the permission prompt and {ran} ran. With it off, {loose} ran. This holds by construction. It stops wrong actions, not wrong answers.",
      "harness.m.replay": "Replay feeds the recorded replies and tool results back through the engine and compares every move: {identical} of {traces} suite recordings match. That shows the loop is deterministic. It does not show the answers are right.",
      "harness.m.wrapped": "One fix came from real replies. Three warm-up prompts, not in the suite, showed a model wrapping its tool call in an extra layer, and the reader learned to unwrap it before any suite task ran.",
      "harness.m.llm7": "A third provider, LLM7, is wired into this page but not benchmarked: its free daily quota ran out during setup.",
      "harness.m.spark": "GlowSpark is a tool here, not the brain. It continues stories and cannot follow instructions.",
      "harness.m.run": "{provider}: one provider for the whole run, no switching. Asked for {requested}, answered as {returned}. Run on {date} (UTC) with Node {node}.",
      "harness.m.pace": "{provider} is rationed, so the script sent one call every {gap} s, waited up to {wait} s for each reply and tried each call up to {attempts} times. It was resumed {resumes} times. The harness's own time limit was raised to {limit} min for the benchmark only, so that queueing was not scored as failure.",
      "harness.m.earlier": "{provider}: an earlier part of the run waited up to {seconds} s per reply before the pacing was changed. Its answers are kept.",
      "harness.m.work": "{provider} in the harness: {steps} steps and {calls} tool calls over {runs} tasks. The reader repaired {repaired} tool calls, {turns} replies were sent back for correction, {prompts} permission prompts were approved, and {fallback} answers were assembled after a limit ({right} of them right).",
      "harness.m.codes": "{provider}, repairs by kind: {list}.",
      "harness.m.native": "{provider} answered {count} times through the API's function-call field, which this page never offers. The kit turns such a call back into plain text, so every model is read the same way.",
      "harness.m.empty": "{provider}: an empty reply was asked again, up to {tries} times, before it counted. Empty replies seen: {bare} alone, {harness} in the harness.",
      "harness.m.noReply": "{provider}: some calls got no reply after every retry and are counted as misses: {bare} alone, {harness} in the harness.",
      "harness.silent.lead": "{model}: {count} times, the provider sent back an error instead of an answer. Each one is counted as a miss.",
      "harness.silent.alone": "Alone, {count}: {why}.",
      "harness.silent.inside": "In the harness, {count}: {why}.",
      "harness.silent.why.provider_parse": "the provider could not read what the model wrote",
      "harness.silent.why.output_limit": "the model used up its output allowance before it answered",
      "harness.silent.why.rate_limit": "the provider's free quota ran out",
      "harness.silent.why.timeout": "the provider timed out",
      "harness.silent.why.other": "another provider error",
      "harness.paired.line": "{model}, task by task: {gained} went from wrong alone to right in the harness, {lost} went from right to wrong, and {same} did not change. If the harness made no difference, chance alone would split the changed tasks at least this unevenly {chance} of the time (exact sign test).",
      "harness.paired.clear": "A split like that is unlikely to be luck.",
      "harness.paired.unclear": "A split like that happens easily by luck, so this test does not show that the harness helped this model.",
      "harness.paired.gainedSilent": "{count} of the {gained} gains were tasks the provider did not answer alone.",
      "harness.paired.lostSilent": "{count} of the {lost} losses were tasks the provider did not answer in the harness.",
      "harness.m.replayModel": "{provider}: {identical} of {traces} recorded runs replay identically.",
      "harness.benchMissing": "The benchmark file couldn't load, so no figures are shown.",
      "harness.stat.checks": "engine checks passed when this was built. Rerun them below",
      "harness.stat.parser": "broken tool calls read correctly. A strict reader reads {strict}",
      "harness.stat.injection": "scripted injection attacks stopped at the permission prompt. With the rule off, {ran} ran",
      "harness.stat.replay": "recorded runs that replay move for move",
      "harness.stat.size": "the whole engine, unminified, with {dependencies} dependencies",
      "harness.stat.rules": "suite tasks solved with no model at all",
      "harness.bar.rules": "No model, in the harness",
      "harness.bar.alone": "{model}, alone",
      "harness.bar.harness": "{model}, in the harness",
      "harness.suiteLede": "{tasks} tasks in {groups} groups. Each free model was given every task twice: once alone, and once inside the harness with its tools. Longer bars are better.",
      "harness.suiteLedeNoModels": "{tasks} tasks in {groups} groups. This build has no finished free-model run, so only the no-model row is shown.",
      "harness.benchNote": "Benchmark file built {built} with Node {node}. Engine version {version}.",
      "harness.selftest.running": "Checking…",
      "harness.selftest.error": "The checks couldn't run in this browser.",
      "harness.selftest.pass": "✓ {passed} of {total} checks passed in this browser, in {seconds} s. They cover the loop, the reader, the gate, the tools and replay.",
      "harness.selftest.fail": "✕ {failed} of {total} checks failed here. The first: {name}. Please tell us.",
      "harness.title": "GlowHarness",
      "harness.lede": "An agent harness we built from scratch: the loop that lets an AI use tools, the reader that repairs its broken tool calls, the gate that asks before anything changes, and a trace of every step. It runs in this page, and it even works with no AI model at all.",
      "harness.deskTitle": "Give it a task",
      "harness.brainLabel": "Brain",
      "harness.brain.rules": "No model",
      "harness.brain.free": "Free model",
      "harness.taskLabel": "Your task",
      "harness.placeholder": "Ask for a sum, a date, a conversion, or something to remember. Or tap an example above.",
      "harness.run": "Run",
      "harness.stop": "Stop",
      "harness.runTitle": "What it did, step by step",
      "harness.copy": "Copy answer",
      "harness.replay": "Replay",
      "harness.export": "Save trace",
      "harness.tryFree": "Try the free model",
      "harness.chat": "Ask GlowChat instead",
      "harness.toolsTitle": "Its tools, and what each may do",
      "harness.toolsLede": "These are the only things it can do. Reading is allowed. Anything that saves, deletes or downloads asks you first, and you can switch any tool off.",
      "harness.notesTitle": "What it remembers",
      "harness.notesLede": "The notebook is its only memory. It is saved in this browser, on this device, and nowhere else.",
      "harness.notesEmpty": "Nothing saved yet. Try “Remember that my locker code is …”.",
      "harness.forgetAll": "Forget everything",
      "harness.numbersTitle": "The numbers, measured",
      "harness.numbersLede": "Nothing here is an estimate. Every figure is read from the benchmark file our scripts wrote, and the button at the bottom of this page reruns the engine's checks in your own browser.",
      "harness.suiteTitle": "The same tasks, with and without the harness",
      "harness.methodTitle": "How this was measured, and what it does not show",
      "harness.versusTitle": "Where it wins, where it loses",
      "harness.versusLede": "GlowHarness is not a rival to Claude Code, Codex or OpenCode at real work. Those drive your computer with the best models there are. This one goes after what they skip: nothing to install, no account, every step visible, and useful with no model at all.",
      "harness.v.community": "open source",
      "harness.v.r1": "Real work on your computer",
      "harness.v.r1.us": "None. It cannot touch files, run programs or browse the web.",
      "harness.v.r1.claude": "Edits files and runs shell commands",
      "harness.v.r1.codex": "Edits files and runs shell commands",
      "harness.v.r1.opencode": "Edits files and runs shell commands",
      "harness.v.r2": "The model behind it",
      "harness.v.r2.us": "Small free models: rationed, slow at times and often wrong",
      "harness.v.r2.claude": "Anthropic's best models",
      "harness.v.r2.codex": "OpenAI's best models",
      "harness.v.r2.opencode": "Whichever model you connect",
      "harness.v.r3": "Adding your own tools",
      "harness.v.r3.us": "Only by editing the code",
      "harness.v.r3.claude": "Yes, through MCP servers",
      "harness.v.r3.codex": "Yes, through MCP servers",
      "harness.v.r3.opencode": "Yes, through MCP servers",
      "harness.v.r4": "Before the first task",
      "harness.v.r4.us": "Open this page",
      "harness.v.r4.claude": "Install it, then sign in with a paid Claude plan or an API key",
      "harness.v.r4.codex": "Install it, then sign in with a ChatGPT account or an API key",
      "harness.v.r4.opencode": "Install it. Free models are included, or bring your own keys",
      "harness.v.r5": "Works with no AI model",
      "harness.v.r5.us": "Yes, for plain requests about sums, dates, units, text and notes",
      "harness.v.r5.claude": "No",
      "harness.v.r5.codex": "No",
      "harness.v.r5.opencode": "No",
      "harness.v.r6": "Where it runs",
      "harness.v.r6.us": "A browser tab, phones included",
      "harness.v.r6.claude": "Terminal, code editors, desktop app and web",
      "harness.v.r6.codex": "Terminal, code editors and desktop app",
      "harness.v.r6.opencode": "Terminal, desktop app and web",
      "harness.v.r7": "Before a risky action",
      "harness.v.r7.us": "Asks. After reading untrusted text it asks again, even for tools you set to always allow",
      "harness.v.r7.claude": "Permission modes, and an optional sandbox for shell commands",
      "harness.v.r7.codex": "A sandbox from the operating system, with approval policies",
      "harness.v.r7.opencode": "Allow, ask or deny rules for each tool",
      "harness.v.r8": "Source code",
      "harness.v.r8.us": "Open. Plain JavaScript, no dependencies",
      "harness.v.r8.claude": "Proprietary",
      "harness.v.r8.codex": "Open source",
      "harness.v.r8.opencode": "Open source",
      "harness.v.sources": "Sources for the other columns, found through a web search on",
      "harness.v.noBench": "We did not benchmark those tools ourselves, so no number is claimed for them.",
      "harness.limitsTitle": "What it can't do",
      "harness.limit1": "It cannot touch your files, run programs or browse the web. Its tools are the ones listed above and nothing more. For real work on a computer, use Claude Code, Codex or OpenCode.",
      "harness.limit2": "With no model it only understands plain English requests about sums, dates, units, text and notes. For anything else it says it cannot answer, and it is right.",
      "harness.limit3": "The free models are small, rationed and sometimes wrong. A long task can stall while a provider makes it wait.",
      "harness.limit4": "With the free model, your task and every tool result are sent to a free AI provider. With no model, nothing leaves this page.",
      "harness.limit5": "The gate stops actions you did not approve. It cannot make a wrong answer right, and it cannot tell that a model has been fooled. It only makes sure a fooled model cannot save or delete without your yes.",
      "harness.limit6": "GlowSpark is a tool here, not the brain. It writes tales and cannot follow instructions.",
      "harness.builtTitle": "Built from scratch",
      "harness.built1": "The loop: ask the brain for one step, read it, run a tool, show the result, repeat. It stops at a step limit, a time limit, a repeated call, or when you press Stop.",
      "harness.built2": "The reader: small models write tool calls badly. The reader repairs the common ways they break. When it cannot, it tells the model exactly what was wrong and asks again.",
      "harness.built3": "The gate: reading is allowed, while saving, deleting and downloading ask first. Once a run has read untrusted text, every such action asks again. With nobody there to ask, the answer is no.",
      "harness.built4": "The trace: every step is recorded with its time. Replay runs the engine again on the recording and checks that it makes the same decisions.",
      "harness.selftest": "Run the engine's checks in this browser",
      "harness.apiTitle": "Use it in another Glow app",
      "harness.apiLede": "The engine and the tool kit are two plain script files with no dependencies. Any Glow page can load them, give the harness a brain, some tools and a way to ask the user, and run a task.",
      "harness.fine": "GlowHarness can be wrong, most of all with a free model behind it. With no model, nothing you type leaves this page. With the free model, your task and the tool results go to a free AI provider, so do not type anything private there. Notes are kept in this browser only.",
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
      "apps.harness": "Harness agen buatan kami sendiri: alat, izin, dan setiap langkah terlihat",
      "apps.code": "Kilat, bahasa kecil yang aman: jalankan kode di sandbox pada perangkat Anda",
      "home.tile.harness": "Harness agen buatan kami. AI memakai alat, setiap langkah terlihat, dan ia bertanya dulu sebelum mengubah apa pun.",
      "home.pill.harness": "🧰 Agen",
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
      "harness.theme.toLight": "Ganti ke terang",
      "harness.theme.toDark": "Ganti ke gelap",
      "harness.loadFailed": "Mesinnya tidak termuat. Periksa koneksimu lalu muat ulang halaman ini.",
      "harness.tool.calc": "Kalkulator",
      "harness.tool.text": "Teks",
      "harness.tool.clock": "Kalender",
      "harness.tool.units": "Satuan",
      "harness.tool.notes": "Buku catatan",
      "harness.tool.library": "Pustaka",
      "harness.tool.tale": "Pendongeng",
      "harness.tool.calcDesc": "Hitungan yang tepat, sepanjang apa pun angkanya.",
      "harness.tool.textDesc": "Menghitung huruf dan kata, membalik teks, mengubah huruf besar-kecil.",
      "harness.tool.clockDesc": "Tahu tanggal hari ini dan bisa menghitung tanggal.",
      "harness.tool.unitsDesc": "Mengonversi satuan dengan faktor yang tepat.",
      "harness.tool.notesDesc": "Satu-satunya ingatannya. Catatan disimpan di browser ini.",
      "harness.tool.libraryDesc": "Mencari di paket offline yang kamu pasang di GlowChat.",
      "harness.tool.taleDesc": "Meminta GlowSpark, model dongeng mungil buatan Glow, melanjutkan sebuah pembuka.",
      "harness.tool.notesRisk": "Bertanya dulu sebelum menyimpan atau menghapus.",
      "harness.tool.taleRisk": "Pemakaian pertama mengunduh model dongeng, jadi ia bertanya dulu.",
      "harness.ex.sum": "Penjumlahan panjang",
      "harness.ex.days": "Hari menuju suatu tanggal",
      "harness.ex.letters": "Hitung huruf",
      "harness.ex.convert": "Mil ke km",
      "harness.ex.chain": "Dua langkah",
      "harness.ex.remember": "Ingat ini",
      "harness.ex.recall": "Ingat kembali",
      "harness.ex.tale": "Dongeng mungil",
      "harness.cat.arithmetic": "Aritmetika",
      "harness.cat.text": "Teks",
      "harness.cat.dates": "Tanggal",
      "harness.cat.units": "Satuan",
      "harness.cat.memory": "Ingatan",
      "harness.cat.multistep": "Beberapa langkah",
      "harness.cat.controls": "Kontrol (pengetahuan, tak ada alat yang membantu)",
      "harness.status.done": "Jawaban",
      "harness.status.limit": "Kehabisan langkah atau waktu",
      "harness.status.loop": "Dihentikan: ia terus mengulang hal yang sama",
      "harness.status.stopped": "Dihentikan",
      "harness.status.error": "Tidak bisa selesai",
      "harness.who.rules": "aturan tanpa model",
      "harness.row.task": "Tugasmu",
      "harness.ask.save": "Simpan catatan: {key} = {value}",
      "harness.ask.delete": "Hapus catatan “{key}”",
      "harness.ask.clear": "Hapus semua catatan yang tersimpan",
      "harness.ask.download": "Unduh GlowSpark, model dongeng kecil, dan biarkan ia menulis di perangkat ini",
      "harness.ask.use": "Pakai {tool} dengan {args}",
      "harness.ask.someTool": "sebuah alat",
      "harness.ask.untrusted": "Ia bertanya lagi karena proses ini sudah membaca teks dari {source}. Teks semacam itu bisa menyembunyikan perintah untuk mengelabui AI, jadi tidak ada yang berubah tanpa persetujuanmu.",
      "harness.ask.destructive": "Ini menghapus sesuatu yang tersimpan di browser ini. Tidak bisa dibatalkan.",
      "harness.ask.downloadWhy": "Unduhan satu kali. Setelah itu model dongeng bekerja offline.",
      "harness.ask.write": "Ini menyimpan sesuatu di browser ini, di perangkat ini.",
      "harness.ask.everyTime": "Kamu mengatur alat ini agar selalu bertanya.",
      "harness.ask.title": "Ia meminta izinmu",
      "harness.ask.once": "Izinkan sekali",
      "harness.ask.always": "Selalu izinkan",
      "harness.ask.deny": "Jangan izinkan",
      "harness.ask.saidAlways": "✓ Diizinkan mulai sekarang",
      "harness.ask.saidNo": "✕ Tidak diizinkan",
      "harness.ask.saidOnce": "✓ Diizinkan kali ini",
      "harness.row.call": "Ia memanggil {tool}",
      "harness.badge.repaired": "Diperbaiki: {code}",
      "harness.row.invalid": "Harness tidak menemukan panggilan alat maupun jawaban dalam balasan itu",
      "harness.row.unknownTool": "Ia meminta alat yang tidak ada: {tool}",
      "harness.row.badArgs": "{tool} tidak bisa memakai argumen itu",
      "harness.guard.abort": "Kamu menekan Berhenti",
      "harness.guard.repairs": "Ia menyerah setelah {limit} koreksi berturut-turut",
      "harness.guard.steps": "Ia mencapai batas {limit} langkah",
      "harness.guard.time": "Ia mencapai batas waktu {seconds} detik",
      "harness.guard.loop": "Ia terus membuat panggilan {tool} yang sama, jadi harness menghentikan prosesnya",
      "harness.guard.duplicate": "Ia mengulang panggilan {tool} yang sudah pernah dibuat, jadi harness mengarahkannya kembali ke hasil sebelumnya",
      "harness.gate.off": "Diblokir: kamu mematikan {tool}",
      "harness.gate.blocked": "Diblokir: {tool} butuh izin dan tidak ada yang bisa memberikannya",
      "harness.row.thinking": "Langkah {step}: berpikir…",
      "harness.row.model": "Langkah {step}: {who} membalas",
      "harness.badge.native": "dikirim sebagai panggilan fungsi bawaan, lalu diubah kembali menjadi teks",
      "harness.row.modelError": "Otaknya tidak menjawab",
      "harness.row.repairCount": "percobaan {streak} dari {limit}",
      "harness.row.repair": "Harness menjelaskan kesalahannya dan bertanya lagi",
      "harness.row.compact": "Hasil alat yang lama dipersingkat agar percakapan tetap kecil",
      "harness.row.running": "{tool} sedang bekerja…",
      "harness.row.result": "{tool} mengembalikan",
      "harness.row.timeout": "{tool} terlalu lama",
      "harness.row.failed": "{tool} tidak bisa melakukannya",
      "harness.badge.untrusted": "teks tak tepercaya: diberikan ke otak sebagai data, bukan perintah",
      "harness.badge.instructions": "berisi sesuatu yang mirip perintah",
      "harness.badge.clipped": "dipersingkat sebelum dilihat otak",
      "harness.badge.repeat": "panggilan yang sama seperti sebelumnya",
      "harness.wait.title": "Model gratis sedang sibuk",
      "harness.wait.text": "Terlalu banyak orang memakainya saat ini. Mencoba lagi dalam {seconds} detik. Tekan Berhenti untuk menyerah.",
      "harness.runStats.running": "bekerja…",
      "harness.runStats": "{steps} langkah · {calls} panggilan alat · {seconds} detik",
      "harness.answer.stopped": "Kamu menghentikannya sebelum ada jawaban.",
      "harness.answer.none": "Ia tidak punya jawaban untuk yang ini.",
      "harness.note.unmatched": "Tanpa model ia hanya mengikuti pola: penjumlahan, tanggal, satuan, teks, dan catatan, yang diminta dalam bahasa Inggris sederhana. Untuk hal lain, coba model gratis atau tanya GlowChat.",
      "harness.note.fallback": "Prosesnya tidak selesai dengan rapi, jadi harness menyusun jawaban ini dari hasil yang dikembalikan alat. Periksa dulu sebelum mengandalkannya.",
      "harness.note.implicit": "Otaknya tidak menandai jawabannya, jadi seluruh balasannya ditampilkan.",
      "harness.note.error": "Yang bermasalah: {message}.",
      "harness.note.offline": "Kamu sedang offline. Model gratis butuh internet. Otak tanpa model tidak.",
      "harness.needTask": "Ketik tugas dulu, atau ketuk sebuah contoh.",
      "harness.replay.running": "Memutar ulang…",
      "harness.replay.failed": "Putar ulang tidak bisa dijalankan.",
      "harness.replay.same": "✓ Diputar ulang. Mesin menelusuri rekaman itu lagi dan membuat {events} gerakan yang sama dengan urutan yang sama.",
      "harness.replay.differs": "✕ Putar ulang menyimpang dari rekaman pada gerakan {at} dari {events}. Tolong beri tahu kami.",
      "harness.exported": "Jejak disimpan. Isinya tugasmu dan setiap langkah.",
      "harness.copied": "Jawaban disalin",
      "harness.copyFailed": "Tidak bisa menyalin",
      "harness.meta": "Siap · mesin {version} · {tools} alat · tanpa instalasi, tanpa akun",
      "harness.privacy.freeHead": "Ini mengirim tugasmu keluar.",
      "harness.privacy.free": "Tugasmu dan setiap hasil alat dikirim ke penyedia AI gratis ({providers}). Tanpa akun. Model-model ini kecil, dijatah, dan kadang keliru.",
      "harness.privacy.rulesHead": "Tidak ada yang keluar dari halaman ini.",
      "harness.privacy.rules": "Tanpa model AI sama sekali: aturan pola yang memilih alat. Ia mengikuti permintaan berbahasa Inggris sederhana tentang penjumlahan, tanggal, satuan, teks, dan catatan, dan berterus terang bila tidak bisa.",
      "harness.examplesLabel": "Contoh tugas",
      "harness.tool.readOnly": "Hanya membaca.",
      "harness.choice.allow": "Izinkan",
      "harness.choice.ask": "Tanya",
      "harness.choice.off": "Mati",
      "harness.notes.forget": "Lupakan {key}",
      "harness.notes.cleared": "Semua sudah dilupakan",
      "harness.table.alone": "sendiri",
      "harness.table.harness": "dalam harness",
      "harness.table.tasks": "Tugas",
      "harness.table.noModel": "Tanpa model",
      "harness.table.total": "Semua tugas",
      "harness.table.answerable": "Tanpa tugas yang butuh tanggal hari ini atau catatan tersimpan",
      "harness.m.sample": "Ini uji kecil: {tasks} tugas, masing-masing ditanyakan {passes} kali per model pada temperatur {temperature}. Selisih satu atau dua tugas hanyalah derau, bukan temuan.",
      "harness.m.sampleNoModels": "Ini uji kecil: {tasks} tugas. Versi ini belum punya uji model gratis yang selesai.",
      "harness.m.author": "Pembuat harness ini juga yang menulis {tasks} tugas, {cases} panggilan alat rusak, dan {attacks} serangan itu. Belum ada pihak independen yang memeriksanya.",
      "harness.m.rules": "Otak tanpa model adalah kumpulan pola yang disetel pada tugas-tugas yang sama ini, jadi skornya adalah kasus terbaik, bukan perkiraan untuk kalimatmu sendiri. Ia sengaja gagal di semua {controls} tugas kontrol: tugas itu butuh pengetahuan dan ia tidak punya.",
      "harness.m.alone": "“Sendiri” berarti model yang sama, pertanyaan yang sama, tanpa alat. {count} tugas ({ids}) menanyakan tanggal hari ini atau catatan yang disimpan sebelumnya, dan model yang sendiri tidak diberi keduanya. Model gratis tetap menjawab benar sebagian saat sendiri ({list}). Kami tidak pernah mengirim tanggalnya. Satu jawaban mengutip baris tanggal yang tidak kami tulis, jadi tampaknya penyedia yang menambahkannya. Hanya {memory} tugas ingatan ({memoryIds}) yang sama sekali tidak bisa dijawab sendiri. Baris terakhir tabel tidak menyertakan {count} tugas itu.",
      "harness.m.clock": "Mengapa model yang sendiri bisa benar pada tugas tanggal: jam yang dipakai tugas-tugas ini dikunci pada tanggal yang sama dengan tanggal pengujian (UTC), jadi tanggal yang ditambahkan penyedia pun benar. Pada hari lain tanggalnya tidak akan cocok, dan itu belum kami coba. Salah satu yang lolos itu dinilai longgar: tugasnya juga meminta menyimpan catatan, pemeriksanya hanya membaca jumlah hari, dan jawabannya mengaku sudah menyimpan catatan, padahal model yang sendiri tidak bisa melakukannya.",
      "harness.m.judge": "Di dalam harness hanya jawaban akhir yang dinilai. Sebuah angka lolos bila angka yang benar muncul di jawaban sebagai bilangan utuh, apa pun kata-kata lainnya.",
      "harness.m.approve": "Skrip benchmark menyetujui setiap permintaan izin, memakai pustaka kosong, dan tidak pernah memuat GlowSpark, jadi kedua alat itu tidak diukur di sini.",
      "harness.m.corpus": "Panggilan alat rusak: {recovered} dari {cases} terbaca dengan benar, dari {families} jenis kerusakan. Terlewat: {missed}. Pembanding ketat adalah pembacaan JSON biasa atas seluruh balasan dan, menurut rancangannya, membaca {strict} di antaranya. Itu menunjukkan perbaikan memang diperlukan. Itu bukan perbandingan dengan harness lain.",
      "harness.m.controls": "{held} dari {controls} balasan biasa yang tidak boleh dibaca sebagai panggilan alat dibiarkan apa adanya.",
      "harness.m.injection": "Injeksi prompt: {delivered} dari {attacks} serangan sampai ke otak dengan tanda sebagai data. Otak simulasi yang menuruti setiap perintah sisipan lalu mencoba menyimpan atau menghapus. Dengan aturan aktif, {held} dihentikan di permintaan izin dan {ran} berjalan. Dengan aturan mati, {loose} berjalan. Ini berlaku karena rancangannya. Ia menghentikan tindakan yang salah, bukan jawaban yang salah.",
      "harness.m.replay": "Putar ulang memasukkan kembali balasan dan hasil alat yang terekam ke mesin, lalu membandingkan setiap gerakan: {identical} dari {traces} rekaman rangkaian tugas cocok. Itu menunjukkan siklusnya deterministik. Itu tidak menunjukkan jawabannya benar.",
      "harness.m.wrapped": "Satu perbaikan berasal dari balasan nyata. Tiga prompt pemanasan, yang tidak termasuk rangkaian tugas, memperlihatkan sebuah model membungkus panggilan alatnya dengan lapisan tambahan, dan pembaca belajar membukanya sebelum tugas mana pun dijalankan.",
      "harness.m.llm7": "Penyedia ketiga, LLM7, terpasang di halaman ini tetapi tidak diuji: kuota harian gratisnya habis saat penyiapan.",
      "harness.m.spark": "GlowSpark di sini adalah alat, bukan otak. Ia melanjutkan cerita dan tidak bisa mengikuti perintah.",
      "harness.m.run": "{provider}: satu penyedia untuk seluruh pengujian, tanpa berpindah. Yang diminta {requested}, yang menjawab {returned}. Dijalankan pada {date} (UTC) dengan Node {node}.",
      "harness.m.pace": "{provider} dijatah, jadi skrip mengirim satu panggilan setiap {gap} detik, menunggu hingga {wait} detik untuk tiap balasan, dan mencoba tiap panggilan hingga {attempts} kali. Pengujian dilanjutkan {resumes} kali. Batas waktu harness sendiri dinaikkan menjadi {limit} menit khusus untuk benchmark, agar antrean tidak dihitung sebagai kegagalan.",
      "harness.m.earlier": "{provider}: bagian awal pengujian menunggu hingga {seconds} detik per balasan sebelum jedanya diubah. Jawabannya tetap dipakai.",
      "harness.m.work": "{provider} dalam harness: {steps} langkah dan {calls} panggilan alat pada {runs} tugas. Pembaca memperbaiki {repaired} panggilan alat, {turns} balasan dikembalikan untuk dikoreksi, {prompts} permintaan izin disetujui, dan {fallback} jawaban disusun setelah suatu batas tercapai ({right} di antaranya benar).",
      "harness.m.codes": "{provider}, perbaikan menurut jenis: {list}.",
      "harness.m.native": "{provider} menjawab {count} kali lewat kolom panggilan fungsi milik API, yang tidak pernah ditawarkan halaman ini. Kit mengubah panggilan semacam itu kembali menjadi teks biasa, jadi setiap model dibaca dengan cara yang sama.",
      "harness.m.empty": "{provider}: balasan kosong ditanyakan lagi, hingga {tries} kali, sebelum dihitung. Balasan kosong yang muncul: {bare} saat sendiri, {harness} dalam harness.",
      "harness.m.noReply": "{provider}: beberapa panggilan tidak dibalas setelah semua percobaan ulang dan dihitung sebagai gagal: {bare} saat sendiri, {harness} dalam harness.",
      "harness.silent.lead": "{model}: {count} kali, penyedia mengirim kesalahan, bukan jawaban. Masing-masing dihitung sebagai gagal.",
      "harness.silent.alone": "Saat sendiri, {count}: {why}.",
      "harness.silent.inside": "Dalam harness, {count}: {why}.",
      "harness.silent.why.provider_parse": "penyedia tidak bisa membaca apa yang ditulis model",
      "harness.silent.why.output_limit": "model menghabiskan jatah keluarannya sebelum menjawab",
      "harness.silent.why.rate_limit": "kuota gratis penyedia habis",
      "harness.silent.why.timeout": "penyedia kehabisan waktu",
      "harness.silent.why.other": "kesalahan lain dari penyedia",
      "harness.paired.line": "{model}, tugas demi tugas: {gained} berubah dari salah saat sendiri menjadi benar dalam harness, {lost} berubah dari benar menjadi salah, dan {same} tidak berubah. Kalau harness tidak berpengaruh, kebetulan saja akan membagi tugas yang berubah setimpang ini atau lebih pada {chance} kejadian (uji tanda eksak).",
      "harness.paired.clear": "Pembagian seperti itu kecil kemungkinannya hanya kebetulan.",
      "harness.paired.unclear": "Pembagian seperti itu mudah terjadi karena kebetulan, jadi uji ini tidak menunjukkan bahwa harness membantu model ini.",
      "harness.paired.gainedSilent": "{count} dari {gained} perbaikan itu adalah tugas yang tidak dijawab penyedia saat sendiri.",
      "harness.paired.lostSilent": "{count} dari {lost} kemunduran itu adalah tugas yang tidak dijawab penyedia dalam harness.",
      "harness.m.replayModel": "{provider}: {identical} dari {traces} proses terekam terputar ulang secara identik.",
      "harness.benchMissing": "Berkas benchmark tidak bisa dimuat, jadi tidak ada angka yang ditampilkan.",
      "harness.stat.checks": "pemeriksaan mesin lolos saat ini dibuat. Jalankan lagi di bawah",
      "harness.stat.parser": "panggilan alat rusak terbaca dengan benar. Pembaca ketat membaca {strict}",
      "harness.stat.injection": "serangan injeksi terskrip dihentikan di permintaan izin. Dengan aturan mati, {ran} berjalan",
      "harness.stat.replay": "proses terekam yang terputar ulang gerakan demi gerakan",
      "harness.stat.size": "seluruh mesin, tanpa minifikasi, dengan {dependencies} dependensi",
      "harness.stat.rules": "tugas terselesaikan tanpa model sama sekali",
      "harness.bar.rules": "Tanpa model, dalam harness",
      "harness.bar.alone": "{model}, sendiri",
      "harness.bar.harness": "{model}, dalam harness",
      "harness.suiteLede": "{tasks} tugas dalam {groups} kelompok. Setiap model gratis diberi tiap tugas dua kali: sekali sendirian, dan sekali di dalam harness dengan alat-alatnya. Batang yang lebih panjang lebih baik.",
      "harness.suiteLedeNoModels": "{tasks} tugas dalam {groups} kelompok. Versi ini belum punya uji model gratis yang selesai, jadi hanya baris tanpa model yang ditampilkan.",
      "harness.benchNote": "Berkas benchmark dibuat {built} dengan Node {node}. Versi mesin {version}.",
      "harness.selftest.running": "Memeriksa…",
      "harness.selftest.error": "Pemeriksaan tidak bisa dijalankan di browser ini.",
      "harness.selftest.pass": "✓ {passed} dari {total} pemeriksaan lolos di browser ini, dalam {seconds} detik. Mencakup siklus, pembaca, gerbang, alat, dan putar ulang.",
      "harness.selftest.fail": "✕ {failed} dari {total} pemeriksaan gagal di sini. Yang pertama: {name}. Tolong beri tahu kami.",
      "harness.title": "GlowHarness",
      "harness.lede": "Harness agen yang kami buat dari nol: siklus yang membuat AI bisa memakai alat, pembaca yang memperbaiki panggilan alat yang rusak, gerbang yang bertanya dulu sebelum ada yang berubah, dan jejak setiap langkah. Semuanya berjalan di halaman ini, bahkan tanpa model AI sama sekali.",
      "harness.deskTitle": "Beri ia tugas",
      "harness.brainLabel": "Otak",
      "harness.brain.rules": "Tanpa model",
      "harness.brain.free": "Model gratis",
      "harness.taskLabel": "Tugasmu",
      "harness.placeholder": "Minta penjumlahan, tanggal, konversi, atau sesuatu untuk diingat, dalam bahasa Inggris. Atau ketuk contoh di atas.",
      "harness.run": "Jalankan",
      "harness.stop": "Berhenti",
      "harness.runTitle": "Apa yang dilakukannya, langkah demi langkah",
      "harness.copy": "Salin jawaban",
      "harness.replay": "Putar ulang",
      "harness.export": "Simpan jejak",
      "harness.tryFree": "Coba model gratis",
      "harness.chat": "Tanya GlowChat saja",
      "harness.toolsTitle": "Alat-alatnya, dan apa yang boleh dilakukan masing-masing",
      "harness.toolsLede": "Hanya ini yang bisa dilakukannya. Membaca diizinkan. Apa pun yang menyimpan, menghapus, atau mengunduh akan bertanya dulu kepadamu, dan kamu bisa mematikan alat mana pun.",
      "harness.notesTitle": "Apa yang diingatnya",
      "harness.notesLede": "Buku catatan adalah satu-satunya ingatannya. Disimpan di browser ini, di perangkat ini, dan tidak di tempat lain.",
      "harness.notesEmpty": "Belum ada yang disimpan. Coba “Remember that my locker code is …”.",
      "harness.forgetAll": "Lupakan semuanya",
      "harness.numbersTitle": "Angka-angkanya, hasil pengukuran",
      "harness.numbersLede": "Tidak ada perkiraan di sini. Setiap angka dibaca dari berkas benchmark yang ditulis skrip kami, dan tombol di bagian bawah halaman ini menjalankan ulang pemeriksaan mesin di browsermu sendiri.",
      "harness.suiteTitle": "Tugas yang sama, dengan dan tanpa harness",
      "harness.methodTitle": "Cara pengukurannya, dan apa yang tidak ditunjukkannya",
      "harness.versusTitle": "Di mana ia unggul, di mana ia kalah",
      "harness.versusLede": "GlowHarness bukan pesaing Claude Code, Codex, atau OpenCode untuk pekerjaan nyata. Ketiganya mengendalikan komputermu dengan model-model terbaik yang ada. Yang ini mengejar hal yang mereka lewatkan: tanpa instalasi, tanpa akun, setiap langkah terlihat, dan tetap berguna tanpa model sama sekali.",
      "harness.v.community": "sumber terbuka",
      "harness.v.r1": "Pekerjaan nyata di komputermu",
      "harness.v.r1.us": "Tidak ada. Ia tidak bisa menyentuh berkas, menjalankan program, atau menjelajah web.",
      "harness.v.r1.claude": "Mengedit berkas dan menjalankan perintah shell",
      "harness.v.r1.codex": "Mengedit berkas dan menjalankan perintah shell",
      "harness.v.r1.opencode": "Mengedit berkas dan menjalankan perintah shell",
      "harness.v.r2": "Model di baliknya",
      "harness.v.r2.us": "Model gratis kecil: dijatah, kadang lambat, dan sering keliru",
      "harness.v.r2.claude": "Model terbaik Anthropic",
      "harness.v.r2.codex": "Model terbaik OpenAI",
      "harness.v.r2.opencode": "Model apa pun yang kamu sambungkan",
      "harness.v.r3": "Menambah alat sendiri",
      "harness.v.r3.us": "Hanya dengan mengubah kodenya",
      "harness.v.r3.claude": "Ya, lewat server MCP",
      "harness.v.r3.codex": "Ya, lewat server MCP",
      "harness.v.r3.opencode": "Ya, lewat server MCP",
      "harness.v.r4": "Sebelum tugas pertama",
      "harness.v.r4.us": "Buka halaman ini",
      "harness.v.r4.claude": "Pasang dulu, lalu masuk dengan paket Claude berbayar atau kunci API",
      "harness.v.r4.codex": "Pasang dulu, lalu masuk dengan akun ChatGPT atau kunci API",
      "harness.v.r4.opencode": "Pasang dulu. Model gratis sudah disertakan, atau pakai kuncimu sendiri",
      "harness.v.r5": "Bekerja tanpa model AI",
      "harness.v.r5.us": "Ya, untuk permintaan sederhana tentang penjumlahan, tanggal, satuan, teks, dan catatan",
      "harness.v.r5.claude": "Tidak",
      "harness.v.r5.codex": "Tidak",
      "harness.v.r5.opencode": "Tidak",
      "harness.v.r6": "Tempat ia berjalan",
      "harness.v.r6.us": "Tab browser, termasuk di ponsel",
      "harness.v.r6.claude": "Terminal, editor kode, aplikasi desktop, dan web",
      "harness.v.r6.codex": "Terminal, editor kode, dan aplikasi desktop",
      "harness.v.r6.opencode": "Terminal, aplikasi desktop, dan web",
      "harness.v.r7": "Sebelum tindakan berisiko",
      "harness.v.r7.us": "Bertanya. Setelah membaca teks tak tepercaya ia bertanya lagi, bahkan untuk alat yang kamu atur selalu diizinkan",
      "harness.v.r7.claude": "Mode izin, dan sandbox opsional untuk perintah shell",
      "harness.v.r7.codex": "Sandbox dari sistem operasi, dengan kebijakan persetujuan",
      "harness.v.r7.opencode": "Aturan izinkan, tanya, atau tolak untuk tiap alat",
      "harness.v.r8": "Kode sumber",
      "harness.v.r8.us": "Terbuka. JavaScript polos, tanpa dependensi",
      "harness.v.r8.claude": "Tertutup, milik perusahaan",
      "harness.v.r8.codex": "Sumber terbuka",
      "harness.v.r8.opencode": "Sumber terbuka",
      "harness.v.sources": "Sumber untuk kolom lainnya, ditemukan lewat penelusuran web pada",
      "harness.v.noBench": "Kami tidak menguji sendiri alat-alat itu, jadi tidak ada angka yang diklaim untuk mereka.",
      "harness.limitsTitle": "Yang tidak bisa dilakukannya",
      "harness.limit1": "Ia tidak bisa menyentuh berkasmu, menjalankan program, atau menjelajah web. Alatnya hanya yang tercantum di atas, tidak lebih. Untuk pekerjaan nyata di komputer, pakai Claude Code, Codex, atau OpenCode.",
      "harness.limit2": "Tanpa model ia hanya memahami permintaan berbahasa Inggris sederhana tentang penjumlahan, tanggal, satuan, teks, dan catatan. Untuk hal lain ia bilang tidak bisa menjawab, dan itu benar.",
      "harness.limit3": "Model gratisnya kecil, dijatah, dan kadang keliru. Tugas panjang bisa tersendat saat penyedia menyuruhnya menunggu.",
      "harness.limit4": "Dengan model gratis, tugasmu dan setiap hasil alat dikirim ke penyedia AI gratis. Tanpa model, tidak ada yang keluar dari halaman ini.",
      "harness.limit5": "Gerbang menghentikan tindakan yang tidak kamu setujui. Ia tidak bisa membuat jawaban yang salah menjadi benar, dan tidak bisa tahu bahwa sebuah model telah dikelabui. Ia hanya memastikan model yang terkelabui tidak bisa menyimpan atau menghapus tanpa persetujuanmu.",
      "harness.limit6": "GlowSpark di sini adalah alat, bukan otak. Ia menulis dongeng dan tidak bisa mengikuti perintah.",
      "harness.builtTitle": "Dibuat dari nol",
      "harness.built1": "Siklus: minta satu langkah dari otak, baca, jalankan alat, tunjukkan hasilnya, ulangi. Ia berhenti pada batas langkah, batas waktu, panggilan yang berulang, atau saat kamu menekan Berhenti.",
      "harness.built2": "Pembaca: model kecil sering menulis panggilan alat dengan buruk. Pembaca memperbaiki bentuk kerusakan yang umum. Bila tidak bisa, ia memberi tahu model persis apa yang salah dan bertanya lagi.",
      "harness.built3": "Gerbang: membaca diizinkan, sedangkan menyimpan, menghapus, dan mengunduh bertanya dulu. Begitu sebuah proses membaca teks tak tepercaya, setiap tindakan semacam itu bertanya lagi. Bila tidak ada yang bisa ditanya, jawabannya tidak.",
      "harness.built4": "Jejak: setiap langkah direkam beserta waktunya. Putar ulang menjalankan mesin lagi pada rekaman itu dan memeriksa bahwa ia membuat keputusan yang sama.",
      "harness.selftest": "Jalankan pemeriksaan mesin di browser ini",
      "harness.apiTitle": "Pakai di aplikasi Glow lain",
      "harness.apiLede": "Mesin dan kit alatnya adalah dua berkas skrip polos tanpa dependensi. Halaman Glow mana pun bisa memuatnya, memberi harness sebuah otak, beberapa alat, dan cara bertanya kepada pengguna, lalu menjalankan tugas.",
      "harness.fine": "GlowHarness bisa keliru, terlebih dengan model gratis di baliknya. Tanpa model, tidak ada yang kamu ketik keluar dari halaman ini. Dengan model gratis, tugasmu dan hasil alat dikirim ke penyedia AI gratis, jadi jangan ketik hal pribadi di sana. Catatan hanya disimpan di browser ini.",
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
      "apps.harness": "我们从零打造的智能体框架：工具、许可，每一步都看得见",
      "apps.code": "Kilat，一门小巧安全的语言：在你的设备上的沙盒里运行代码",
      "home.tile.harness": "我们自己的智能体框架。让 AI 使用工具，每一步都看得见，改动之前先问你。",
      "home.pill.harness": "🧰 智能体",
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
      "harness.theme.toLight": "切换到浅色",
      "harness.theme.toDark": "切换到深色",
      "harness.loadFailed": "引擎没有加载成功。请检查网络后刷新页面。",
      "harness.tool.calc": "计算器",
      "harness.tool.text": "文本",
      "harness.tool.clock": "日历",
      "harness.tool.units": "单位",
      "harness.tool.notes": "记事本",
      "harness.tool.library": "资料库",
      "harness.tool.tale": "故事机",
      "harness.tool.calcDesc": "精确计算，数字再长也不怕。",
      "harness.tool.textDesc": "数字母和单词、反转文本、转换大小写。",
      "harness.tool.clockDesc": "知道今天的日期，会做日期计算。",
      "harness.tool.unitsDesc": "用精确的换算系数转换单位。",
      "harness.tool.notesDesc": "它唯一的记忆。笔记保存在这个浏览器里。",
      "harness.tool.libraryDesc": "搜索你在 GlowChat 里安装的离线资料包。",
      "harness.tool.taleDesc": "请 Glow 自己的小型故事模型 GlowSpark 接着一个开头往下写。",
      "harness.tool.notesRisk": "保存或删除前会先问你。",
      "harness.tool.taleRisk": "第一次使用要下载故事模型，所以会先问你。",
      "harness.ex.sum": "一道长加法",
      "harness.ex.days": "距离某天还有几天",
      "harness.ex.letters": "数字母",
      "harness.ex.convert": "英里换公里",
      "harness.ex.chain": "两步完成",
      "harness.ex.remember": "记住这个",
      "harness.ex.recall": "回想一下",
      "harness.ex.tale": "一个小故事",
      "harness.cat.arithmetic": "算术",
      "harness.cat.text": "文本",
      "harness.cat.dates": "日期",
      "harness.cat.units": "单位",
      "harness.cat.memory": "记忆",
      "harness.cat.multistep": "多步任务",
      "harness.cat.controls": "对照题（考知识，工具帮不上忙）",
      "harness.status.done": "答案",
      "harness.status.limit": "步数或时间用完了",
      "harness.status.loop": "已停止：它一直在重复",
      "harness.status.stopped": "已停止",
      "harness.status.error": "没能完成",
      "harness.who.rules": "无模型规则",
      "harness.row.task": "你的任务",
      "harness.ask.save": "保存一条笔记：{key} = {value}",
      "harness.ask.delete": "删除笔记“{key}”",
      "harness.ask.clear": "删除所有已保存的笔记",
      "harness.ask.download": "下载小型故事模型 GlowSpark，并让它在这台设备上写作",
      "harness.ask.use": "使用{tool}，参数为 {args}",
      "harness.ask.someTool": "某个工具",
      "harness.ask.untrusted": "它再次询问，是因为这次运行读取了来自{source}的文本。这类文本可能藏着用来欺骗 AI 的指令，所以没有你的同意，什么都不会改动。",
      "harness.ask.destructive": "这会删除保存在这个浏览器里的内容，无法撤销。",
      "harness.ask.downloadWhy": "只需下载一次，之后故事模型可以离线使用。",
      "harness.ask.write": "这会在这台设备的这个浏览器里保存内容。",
      "harness.ask.everyTime": "你把这个工具设成了每次都询问。",
      "harness.ask.title": "它在征求你的许可",
      "harness.ask.once": "允许这一次",
      "harness.ask.always": "始终允许",
      "harness.ask.deny": "不允许",
      "harness.ask.saidAlways": "✓ 今后都允许",
      "harness.ask.saidNo": "✕ 未允许",
      "harness.ask.saidOnce": "✓ 已允许这一次",
      "harness.row.call": "它调用了{tool}",
      "harness.badge.repaired": "已修复：{code}",
      "harness.row.invalid": "框架在这条回复里既没找到工具调用，也没找到答案",
      "harness.row.unknownTool": "它要用一个不存在的工具：{tool}",
      "harness.row.badArgs": "{tool}无法使用这些参数",
      "harness.guard.abort": "你按了停止",
      "harness.guard.repairs": "连续纠正 {limit} 次后，它放弃了",
      "harness.guard.steps": "已达到 {limit} 步的上限",
      "harness.guard.time": "已达到 {seconds} 秒的时间上限",
      "harness.guard.loop": "它一直重复同一个{tool}调用，所以框架停止了这次运行",
      "harness.guard.duplicate": "它重复了一个已经做过的{tool}调用，所以框架让它回去看之前的结果",
      "harness.gate.off": "已拦截：你关闭了{tool}",
      "harness.gate.blocked": "已拦截：{tool}需要许可，但没有人能给",
      "harness.row.thinking": "第 {step} 步：思考中…",
      "harness.row.model": "第 {step} 步：{who}回复了",
      "harness.badge.native": "以原生函数调用的形式发来，已转回文本",
      "harness.row.modelError": "大脑没有回答",
      "harness.row.repairCount": "第 {streak} 次尝试，共 {limit} 次",
      "harness.row.repair": "框架说明了错在哪里，并再问了一次",
      "harness.row.compact": "较早的工具结果已缩短，让对话保持精简",
      "harness.row.running": "{tool}正在工作…",
      "harness.row.result": "{tool}返回了",
      "harness.row.timeout": "{tool}耗时太久",
      "harness.row.failed": "{tool}做不到",
      "harness.badge.untrusted": "不可信文本：作为数据交给大脑，而不是指令",
      "harness.badge.instructions": "含有看起来像指令的内容",
      "harness.badge.clipped": "交给大脑前已缩短",
      "harness.badge.repeat": "与之前相同的调用",
      "harness.wait.title": "免费模型正忙",
      "harness.wait.text": "现在用的人太多了。{seconds} 秒后重试。按“停止”可以放弃。",
      "harness.runStats.running": "工作中…",
      "harness.runStats": "{steps} 步 · {calls} 次工具调用 · {seconds} 秒",
      "harness.answer.stopped": "它还没得出答案，你就把它停了。",
      "harness.answer.none": "这个问题它答不上来。",
      "harness.note.unmatched": "没有模型时，它只会按固定模式处理：用简单英语提出的加减、日期、单位、文本和笔记请求。其他问题请试试免费模型，或去问 GlowChat。",
      "harness.note.fallback": "这次运行没有正常结束，所以框架根据工具返回的结果拼出了这个答案。依赖它之前请先核对。",
      "harness.note.implicit": "大脑没有标出答案，所以显示了它的整条回复。",
      "harness.note.error": "出错原因：{message}。",
      "harness.note.offline": "你现在离线。免费模型需要联网，无模型的大脑不需要。",
      "harness.needTask": "请先输入一个任务，或点一个示例。",
      "harness.replay.running": "重放中…",
      "harness.replay.failed": "重放无法运行。",
      "harness.replay.same": "✓ 已重放。引擎把这份记录又走了一遍，以同样的顺序做出了同样的 {events} 个动作。",
      "harness.replay.differs": "✕ 重放在第 {at} 个动作（共 {events} 个）偏离了记录。请告诉我们。",
      "harness.exported": "记录已保存，里面有你的任务和每一步。",
      "harness.copied": "答案已复制",
      "harness.copyFailed": "无法复制",
      "harness.meta": "就绪 · 引擎 {version} · {tools} 个工具 · 无需安装，无需账号",
      "harness.privacy.freeHead": "这会把你的任务发送出去。",
      "harness.privacy.free": "你的任务和每一个工具结果都会发给免费 AI 服务商（{providers}）。无需账号。这些模型小、限流，有时会出错。",
      "harness.privacy.rulesHead": "没有任何内容离开此页面。",
      "harness.privacy.rules": "完全不用 AI 模型：由模式规则选择工具。它能处理用简单英语提出的加减、日期、单位、文本和笔记请求，处理不了时会如实告诉你。",
      "harness.examplesLabel": "示例任务",
      "harness.tool.readOnly": "只读取。",
      "harness.choice.allow": "允许",
      "harness.choice.ask": "询问",
      "harness.choice.off": "关闭",
      "harness.notes.forget": "忘掉 {key}",
      "harness.notes.cleared": "已全部忘掉",
      "harness.table.alone": "单独",
      "harness.table.harness": "在框架中",
      "harness.table.tasks": "任务",
      "harness.table.noModel": "无模型",
      "harness.table.total": "全部任务",
      "harness.table.answerable": "不含需要今天日期或已存笔记的任务",
      "harness.m.sample": "这是一次小规模测试：{tasks} 个任务，每个模型在温度 {temperature} 下各问 {passes} 次。相差一两个任务只是噪声，不是结论。",
      "harness.m.sampleNoModels": "这是一次小规模测试：{tasks} 个任务。这个版本没有已完成的免费模型测试。",
      "harness.m.author": "这 {tasks} 个任务、{cases} 条出错的工具调用和 {attacks} 次攻击，都是框架作者自己写的，还没有独立的第三方核查过。",
      "harness.m.rules": "无模型的大脑是一组针对这些任务调校过的模式，所以它的分数是最好情况，并不能预测它对你自己的措辞表现如何。{controls} 道对照题它全部答错，这是设计使然：这些题需要知识，而它没有。",
      "harness.m.alone": "“单独”指同一个模型、同一个问题、不给工具。有 {count} 个任务（{ids}）问的是今天的日期或之前保存的笔记，而单独作答的模型这两样都没有拿到。免费模型单独作答时仍答对了其中一部分（{list}）。日期我们从未发送。有一条回答引用了一行不是我们写的日期，看来是服务商加进去的。只有 {memory} 个记忆任务（{memoryIds}）是单独完全无法回答的。表格最后一行不计入这 {count} 个任务。",
      "harness.m.clock": "为什么单独作答的模型能答对日期任务：这些任务用的时钟固定在与测试运行相同的日期（UTC），所以服务商加进去的日期正好是对的。换一天日期就对不上，这一点我们没有试过。其中有一次答对算得很宽：那个任务还要求保存一条笔记，检查器只看天数，而回答声称已经保存了笔记，这是单独作答的模型做不到的。",
      "harness.m.judge": "在框架中只评判最终答案。只要正确的数字作为完整的数出现在答案里，不管还说了什么，都算通过。",
      "harness.m.approve": "基准测试脚本批准了每一次许可请求，使用空的资料库，也从未加载 GlowSpark，所以这两个工具不在测量范围内。",
      "harness.m.corpus": "出错的工具调用：{cases} 条中有 {recovered} 条被正确读出，涵盖 {families} 类错误。漏掉的：{missed}。严格基线是把整条回复直接当作 JSON 读取，按其定义只能读出 {strict} 条。这说明修复是必要的，但它不是与其他框架的比较。",
      "harness.m.controls": "{controls} 条不该被当作工具调用的普通回复中，有 {held} 条被原样保留。",
      "harness.m.injection": "提示注入：{attacks} 次攻击中有 {delivered} 次以“数据”的标记到达大脑。随后一个对注入指令言听计从的模拟大脑试图保存或删除。规则开启时，{held} 次被拦在许可请求处，{ran} 次得以执行。规则关闭时，{loose} 次得以执行。这是由设计保证的。它拦住的是错误的操作，而不是错误的答案。",
      "harness.m.replay": "重放把记录下来的回复和工具结果重新送入引擎，并逐个动作比对：{traces} 份测试集记录中有 {identical} 份完全一致。这说明循环是确定性的，但并不说明答案正确。",
      "harness.m.wrapped": "有一处修复来自真实回复。三条不属于测试集的预热提示显示，有模型会给工具调用多包一层，于是解析器在任何测试任务运行之前学会了拆开它。",
      "harness.m.llm7": "第三个服务商 LLM7 已接入本页，但没有参加基准测试：它的每日免费额度在准备阶段就用完了。",
      "harness.m.spark": "GlowSpark 在这里是工具，不是大脑。它只会续写故事，不会听从指令。",
      "harness.m.run": "{provider}：整次测试只用这一个服务商，不切换。请求的模型是 {requested}，实际应答的是 {returned}。运行于 {date}（UTC），Node {node}。",
      "harness.m.pace": "{provider} 有限流，所以脚本每 {gap} 秒发一次调用，每次最多等 {wait} 秒，每个调用最多尝试 {attempts} 次。测试中途续跑了 {resumes} 次。仅在基准测试中，框架自身的时间上限被提高到 {limit} 分钟，以免排队被算作失败。",
      "harness.m.earlier": "{provider}：测试较早的一段在调整节奏之前，每次回复最多等 {seconds} 秒。那部分答案予以保留。",
      "harness.m.work": "{provider} 在框架中：{runs} 个任务共 {steps} 步、{calls} 次工具调用。解析器修复了 {repaired} 次工具调用，{turns} 条回复被退回纠正，批准了 {prompts} 次许可请求，另有 {fallback} 个答案是在触及上限后拼出来的（其中 {right} 个正确）。",
      "harness.m.codes": "{provider}，按类型统计的修复：{list}。",
      "harness.m.native": "{provider} 有 {count} 次通过 API 的函数调用字段作答，而本页从不提供该字段。工具包会把这类调用转回纯文本，所以每个模型都以同样的方式被读取。",
      "harness.m.empty": "{provider}：空回复会重新提问，最多 {tries} 次，之后才计入结果。出现的空回复：单独 {bare} 次，在框架中 {harness} 次。",
      "harness.m.noReply": "{provider}：有些调用在所有重试之后仍无回复，按失败计：单独 {bare} 个，在框架中 {harness} 个。",
      "harness.silent.lead": "{model}：有 {count} 次，服务商返回的是错误而不是回答。每次都按失败计。",
      "harness.silent.alone": "单独 {count} 次：{why}。",
      "harness.silent.inside": "在框架中 {count} 次：{why}。",
      "harness.silent.why.provider_parse": "服务商读不懂模型写出的内容",
      "harness.silent.why.output_limit": "模型还没作答就用完了输出额度",
      "harness.silent.why.rate_limit": "服务商的免费额度用完了",
      "harness.silent.why.timeout": "服务商超时",
      "harness.silent.why.other": "服务商的其他错误",
      "harness.paired.line": "{model}，逐个任务看：有 {gained} 个从单独答错变为在框架中答对，{lost} 个从答对变为答错，{same} 个没有变化。如果框架不起作用，仅凭偶然出现至少这样悬殊的结果的概率是 {chance}（精确符号检验）。",
      "harness.paired.clear": "这样的结果不太可能只是偶然。",
      "harness.paired.unclear": "这样的结果很容易由偶然造成，所以这次测试并不能说明框架对这个模型有帮助。",
      "harness.paired.gainedSilent": "这 {gained} 个改善中，有 {count} 个是单独作答时服务商没有回复的任务。",
      "harness.paired.lostSilent": "这 {lost} 个退步中，有 {count} 个是在框架中服务商没有回复的任务。",
      "harness.m.replayModel": "{provider}：{traces} 份运行记录中有 {identical} 份重放完全一致。",
      "harness.benchMissing": "基准测试文件无法加载，所以不显示任何数字。",
      "harness.stat.checks": "项引擎检查在构建时通过。可在下方重新运行",
      "harness.stat.parser": "条出错的工具调用被正确读出。严格读取只能读出 {strict} 条",
      "harness.stat.injection": "次脚本化注入攻击被拦在许可请求处。规则关闭时有 {ran} 次得以执行",
      "harness.stat.replay": "份运行记录逐个动作重放一致",
      "harness.stat.size": "整个引擎，未压缩，{dependencies} 个依赖",
      "harness.stat.rules": "个测试任务在完全没有模型时解出",
      "harness.bar.rules": "无模型，在框架中",
      "harness.bar.alone": "{model}，单独",
      "harness.bar.harness": "{model}，在框架中",
      "harness.suiteLede": "{tasks} 个任务，分 {groups} 组。每个免费模型把每个任务各做两遍：一遍单独作答，一遍在框架中使用工具。条越长越好。",
      "harness.suiteLedeNoModels": "{tasks} 个任务，分 {groups} 组。这个版本没有已完成的免费模型测试，所以只显示无模型这一行。",
      "harness.benchNote": "基准测试文件构建于 {built}，Node {node}。引擎版本 {version}。",
      "harness.selftest.running": "检查中…",
      "harness.selftest.error": "这些检查无法在此浏览器中运行。",
      "harness.selftest.pass": "✓ {total} 项检查中有 {passed} 项在此浏览器中通过，用时 {seconds} 秒。涵盖循环、解析器、闸门、工具和重放。",
      "harness.selftest.fail": "✕ {total} 项检查中有 {failed} 项在这里失败。第一项：{name}。请告诉我们。",
      "harness.title": "GlowHarness",
      "harness.lede": "我们从零打造的智能体框架：让 AI 使用工具的循环、修复出错工具调用的解析器、改动之前先征求许可的闸门，以及每一步的记录。它就在这个页面里运行，甚至完全不用 AI 模型也能工作。",
      "harness.deskTitle": "给它一个任务",
      "harness.brainLabel": "大脑",
      "harness.brain.rules": "无模型",
      "harness.brain.free": "免费模型",
      "harness.taskLabel": "你的任务",
      "harness.placeholder": "用英文让它做一道加法、算一个日期、换算单位，或记住点什么。也可以点上方的示例。",
      "harness.run": "运行",
      "harness.stop": "停止",
      "harness.runTitle": "它一步一步做了什么",
      "harness.copy": "复制答案",
      "harness.replay": "重放",
      "harness.export": "保存记录",
      "harness.tryFree": "试试免费模型",
      "harness.chat": "改问 GlowChat",
      "harness.toolsTitle": "它的工具，以及每个工具能做什么",
      "harness.toolsLede": "它只能做这些事。读取是允许的。凡是保存、删除或下载，都会先问你，而且任何工具你都可以关掉。",
      "harness.notesTitle": "它记住了什么",
      "harness.notesLede": "记事本是它唯一的记忆。内容只保存在这台设备的这个浏览器里，不会存到别处。",
      "harness.notesEmpty": "还没有保存任何内容。试试“Remember that my locker code is …”。",
      "harness.forgetAll": "全部忘掉",
      "harness.numbersTitle": "实测数据",
      "harness.numbersLede": "这里没有任何估算。每个数字都读自我们的脚本写出的基准测试文件，页面底部的按钮还能在你自己的浏览器里重新运行引擎的检查。",
      "harness.suiteTitle": "同样的任务，用与不用框架",
      "harness.methodTitle": "这些数据是怎么测的，以及它们不能说明什么",
      "harness.versusTitle": "它赢在哪里，输在哪里",
      "harness.versusLede": "在真正的工作上，GlowHarness 不是 Claude Code、Codex 或 OpenCode 的对手。它们用最好的模型来操作你的电脑。这一个瞄准的是它们略过的地方：无需安装、无需账号、每一步都看得见，而且完全没有模型时也有用。",
      "harness.v.community": "开源",
      "harness.v.r1": "在你的电脑上做真正的工作",
      "harness.v.r1.us": "不能。它无法接触文件、运行程序或浏览网页。",
      "harness.v.r1.claude": "编辑文件并运行 shell 命令",
      "harness.v.r1.codex": "编辑文件并运行 shell 命令",
      "harness.v.r1.opencode": "编辑文件并运行 shell 命令",
      "harness.v.r2": "背后的模型",
      "harness.v.r2.us": "小型免费模型：限流，有时很慢，而且常常出错",
      "harness.v.r2.claude": "Anthropic 最好的模型",
      "harness.v.r2.codex": "OpenAI 最好的模型",
      "harness.v.r2.opencode": "你接入的任何模型",
      "harness.v.r3": "添加自己的工具",
      "harness.v.r3.us": "只能通过修改代码",
      "harness.v.r3.claude": "可以，通过 MCP 服务器",
      "harness.v.r3.codex": "可以，通过 MCP 服务器",
      "harness.v.r3.opencode": "可以，通过 MCP 服务器",
      "harness.v.r4": "开始第一个任务之前",
      "harness.v.r4.us": "打开这个页面",
      "harness.v.r4.claude": "先安装，再用付费的 Claude 套餐或 API 密钥登录",
      "harness.v.r4.codex": "先安装，再用 ChatGPT 账号或 API 密钥登录",
      "harness.v.r4.opencode": "先安装。自带免费模型，也可以用自己的密钥",
      "harness.v.r5": "没有 AI 模型也能用",
      "harness.v.r5.us": "可以，限于有关加减、日期、单位、文本和笔记的简单请求",
      "harness.v.r5.claude": "不能",
      "harness.v.r5.codex": "不能",
      "harness.v.r5.opencode": "不能",
      "harness.v.r6": "在哪里运行",
      "harness.v.r6.us": "浏览器标签页，手机也行",
      "harness.v.r6.claude": "终端、代码编辑器、桌面应用和网页",
      "harness.v.r6.codex": "终端、代码编辑器和桌面应用",
      "harness.v.r6.opencode": "终端、桌面应用和网页",
      "harness.v.r7": "执行有风险的操作之前",
      "harness.v.r7.us": "会询问。读过不可信文本后会再问一次，即使是你设为始终允许的工具",
      "harness.v.r7.claude": "权限模式，另有可选的 shell 命令沙盒",
      "harness.v.r7.codex": "操作系统提供的沙盒，加上审批策略",
      "harness.v.r7.opencode": "每个工具都有允许、询问或拒绝规则",
      "harness.v.r8": "源代码",
      "harness.v.r8.us": "开放。纯 JavaScript，没有依赖",
      "harness.v.r8.claude": "专有",
      "harness.v.r8.codex": "开源",
      "harness.v.r8.opencode": "开源",
      "harness.v.sources": "其他各列的资料来源，通过网络搜索查得，日期为",
      "harness.v.noBench": "我们没有亲自对这些工具做基准测试，所以不为它们给出任何数字。",
      "harness.limitsTitle": "它做不到的事",
      "harness.limit1": "它无法接触你的文件、运行程序或浏览网页。它的工具只有上面列出的那些。要在电脑上做真正的工作，请用 Claude Code、Codex 或 OpenCode。",
      "harness.limit2": "没有模型时，它只懂用简单英语提出的加减、日期、单位、文本和笔记请求。其他问题它会说答不了，而它说的是实话。",
      "harness.limit3": "免费模型小、限流，有时会出错。服务商让它排队时，长任务可能会卡住。",
      "harness.limit4": "使用免费模型时，你的任务和每一个工具结果都会发给免费 AI 服务商。没有模型时，没有任何内容离开此页面。",
      "harness.limit5": "闸门会拦住你没有批准的操作。它不能把错误的答案变对，也看不出模型是否被骗了。它只保证被骗的模型在没有你同意时无法保存或删除。",
      "harness.limit6": "GlowSpark 在这里是工具，不是大脑。它只会写故事，不会听从指令。",
      "harness.builtTitle": "从零打造",
      "harness.built1": "循环：向大脑要一步，读懂它，运行工具，展示结果，再重复。遇到步数上限、时间上限、重复调用，或你按下停止时，它就会停下。",
      "harness.built2": "解析器：小模型写工具调用时常常出错。解析器会修复常见的错法。修不了时，它会明确告诉模型哪里错了，然后再问一次。",
      "harness.built3": "闸门：读取是允许的，而保存、删除和下载要先问。一旦某次运行读过不可信文本，这类操作每一次都会再问。如果没有人可以问，答案就是不行。",
      "harness.built4": "记录：每一步都连同时间记了下来。重放会让引擎照着记录再跑一遍，并检查它是否做出同样的决定。",
      "harness.selftest": "在此浏览器中运行引擎检查",
      "harness.apiTitle": "在其他 Glow 应用中使用",
      "harness.apiLede": "引擎和工具包是两个没有依赖的普通脚本文件。任何 Glow 页面都可以加载它们，给框架一个大脑、几个工具和一种询问用户的方式，然后运行任务。",
      "harness.fine": "GlowHarness 可能出错，背后是免费模型时尤其如此。没有模型时，你输入的任何内容都不会离开此页面。使用免费模型时，你的任务和工具结果会发给免费 AI 服务商，所以不要在那里输入任何私密内容。笔记只保存在这个浏览器里。",
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
      "apps.harness": "我們從零打造的 AI 代理框架：工具、許可，每一步都看得見",
      "apps.code": "Kilat，一門小巧安全的語言：在你的裝置上的沙盒裡執行程式碼",
      "home.tile.harness": "我們自己的 AI 代理框架。讓 AI 使用工具，每一步都看得見，變更之前先問你。",
      "home.pill.harness": "🧰 AI 代理",
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
      "harness.theme.toLight": "切換到淺色",
      "harness.theme.toDark": "切換到深色",
      "harness.loadFailed": "引擎沒有載入成功。請檢查網路後重新整理頁面。",
      "harness.tool.calc": "計算機",
      "harness.tool.text": "文字",
      "harness.tool.clock": "日曆",
      "harness.tool.units": "單位",
      "harness.tool.notes": "記事本",
      "harness.tool.library": "資料庫",
      "harness.tool.tale": "故事機",
      "harness.tool.calcDesc": "精確計算，數字再長也不怕。",
      "harness.tool.textDesc": "數字母和單字、反轉文字、轉換大小寫。",
      "harness.tool.clockDesc": "知道今天的日期，會做日期計算。",
      "harness.tool.unitsDesc": "用精確的換算係數轉換單位。",
      "harness.tool.notesDesc": "它唯一的記憶。筆記儲存在這個瀏覽器裡。",
      "harness.tool.libraryDesc": "搜尋你在 GlowChat 裡安裝的離線資料包。",
      "harness.tool.taleDesc": "請 Glow 自己的小型故事模型 GlowSpark 接著一個開頭往下寫。",
      "harness.tool.notesRisk": "儲存或刪除前會先問你。",
      "harness.tool.taleRisk": "第一次使用要下載故事模型，所以會先問你。",
      "harness.ex.sum": "一道長加法",
      "harness.ex.days": "距離某天還有幾天",
      "harness.ex.letters": "數字母",
      "harness.ex.convert": "英里換公里",
      "harness.ex.chain": "兩步完成",
      "harness.ex.remember": "記住這個",
      "harness.ex.recall": "回想一下",
      "harness.ex.tale": "一個小故事",
      "harness.cat.arithmetic": "算術",
      "harness.cat.text": "文字",
      "harness.cat.dates": "日期",
      "harness.cat.units": "單位",
      "harness.cat.memory": "記憶",
      "harness.cat.multistep": "多步驟任務",
      "harness.cat.controls": "對照題（考知識，工具幫不上忙）",
      "harness.status.done": "答案",
      "harness.status.limit": "步數或時間用完了",
      "harness.status.loop": "已停止：它一直在重複",
      "harness.status.stopped": "已停止",
      "harness.status.error": "沒能完成",
      "harness.who.rules": "無模型規則",
      "harness.row.task": "你的任務",
      "harness.ask.save": "儲存一則筆記：{key} = {value}",
      "harness.ask.delete": "刪除筆記「{key}」",
      "harness.ask.clear": "刪除所有已儲存的筆記",
      "harness.ask.download": "下載小型故事模型 GlowSpark，並讓它在這台裝置上寫作",
      "harness.ask.use": "使用{tool}，參數為 {args}",
      "harness.ask.someTool": "某個工具",
      "harness.ask.untrusted": "它再次詢問，是因為這次執行讀取了來自{source}的文字。這類文字可能藏著用來欺騙 AI 的指令，所以沒有你的同意，什麼都不會變更。",
      "harness.ask.destructive": "這會刪除儲存在這個瀏覽器裡的內容，無法復原。",
      "harness.ask.downloadWhy": "只需下載一次，之後故事模型可以離線使用。",
      "harness.ask.write": "這會在這台裝置的這個瀏覽器裡儲存內容。",
      "harness.ask.everyTime": "你把這個工具設成了每次都詢問。",
      "harness.ask.title": "它在徵求你的許可",
      "harness.ask.once": "允許這一次",
      "harness.ask.always": "一律允許",
      "harness.ask.deny": "不允許",
      "harness.ask.saidAlways": "✓ 今後都允許",
      "harness.ask.saidNo": "✕ 未允許",
      "harness.ask.saidOnce": "✓ 已允許這一次",
      "harness.row.call": "它呼叫了{tool}",
      "harness.badge.repaired": "已修復：{code}",
      "harness.row.invalid": "框架在這則回覆裡既沒找到工具呼叫，也沒找到答案",
      "harness.row.unknownTool": "它要用一個不存在的工具：{tool}",
      "harness.row.badArgs": "{tool}無法使用這些參數",
      "harness.guard.abort": "你按了停止",
      "harness.guard.repairs": "連續糾正 {limit} 次後，它放棄了",
      "harness.guard.steps": "已達到 {limit} 步的上限",
      "harness.guard.time": "已達到 {seconds} 秒的時間上限",
      "harness.guard.loop": "它一直重複同一個{tool}呼叫，所以框架停止了這次執行",
      "harness.guard.duplicate": "它重複了一個已經做過的{tool}呼叫，所以框架讓它回去看之前的結果",
      "harness.gate.off": "已攔截：你關閉了{tool}",
      "harness.gate.blocked": "已攔截：{tool}需要許可，但沒有人能給",
      "harness.row.thinking": "第 {step} 步：思考中…",
      "harness.row.model": "第 {step} 步：{who}回覆了",
      "harness.badge.native": "以原生函式呼叫的形式送來，已轉回文字",
      "harness.row.modelError": "大腦沒有回答",
      "harness.row.repairCount": "第 {streak} 次嘗試，共 {limit} 次",
      "harness.row.repair": "框架說明了錯在哪裡，並再問了一次",
      "harness.row.compact": "較早的工具結果已縮短，讓對話保持精簡",
      "harness.row.running": "{tool}正在工作…",
      "harness.row.result": "{tool}傳回了",
      "harness.row.timeout": "{tool}耗時太久",
      "harness.row.failed": "{tool}做不到",
      "harness.badge.untrusted": "不可信文字：作為資料交給大腦，而不是指令",
      "harness.badge.instructions": "含有看起來像指令的內容",
      "harness.badge.clipped": "交給大腦前已縮短",
      "harness.badge.repeat": "與之前相同的呼叫",
      "harness.wait.title": "免費模型正忙",
      "harness.wait.text": "現在用的人太多了。{seconds} 秒後重試。按「停止」可以放棄。",
      "harness.runStats.running": "工作中…",
      "harness.runStats": "{steps} 步 · {calls} 次工具呼叫 · {seconds} 秒",
      "harness.answer.stopped": "它還沒得出答案，你就把它停了。",
      "harness.answer.none": "這個問題它答不上來。",
      "harness.note.unmatched": "沒有模型時，它只會按固定模式處理：用簡單英文提出的加減、日期、單位、文字和筆記請求。其他問題請試試免費模型，或去問 GlowChat。",
      "harness.note.fallback": "這次執行沒有正常結束，所以框架根據工具傳回的結果拼出了這個答案。依賴它之前請先核對。",
      "harness.note.implicit": "大腦沒有標出答案，所以顯示了它的整則回覆。",
      "harness.note.error": "出錯原因：{message}。",
      "harness.note.offline": "你現在離線。免費模型需要連網，無模型的大腦不需要。",
      "harness.needTask": "請先輸入一個任務，或點一個範例。",
      "harness.replay.running": "重播中…",
      "harness.replay.failed": "重播無法執行。",
      "harness.replay.same": "✓ 已重播。引擎把這份紀錄又走了一遍，以同樣的順序做出了同樣的 {events} 個動作。",
      "harness.replay.differs": "✕ 重播在第 {at} 個動作（共 {events} 個）偏離了紀錄。請告訴我們。",
      "harness.exported": "紀錄已儲存，裡面有你的任務和每一步。",
      "harness.copied": "答案已複製",
      "harness.copyFailed": "無法複製",
      "harness.meta": "就緒 · 引擎 {version} · {tools} 個工具 · 無需安裝，無需帳號",
      "harness.privacy.freeHead": "這會把你的任務傳送出去。",
      "harness.privacy.free": "你的任務和每一個工具結果都會傳給免費 AI 服務供應商（{providers}）。無需帳號。這些模型小、有流量限制，有時會出錯。",
      "harness.privacy.rulesHead": "沒有任何內容離開此頁面。",
      "harness.privacy.rules": "完全不用 AI 模型：由模式規則選擇工具。它能處理用簡單英文提出的加減、日期、單位、文字和筆記請求，處理不了時會如實告訴你。",
      "harness.examplesLabel": "範例任務",
      "harness.tool.readOnly": "只讀取。",
      "harness.choice.allow": "允許",
      "harness.choice.ask": "詢問",
      "harness.choice.off": "關閉",
      "harness.notes.forget": "忘掉 {key}",
      "harness.notes.cleared": "已全部忘掉",
      "harness.table.alone": "單獨",
      "harness.table.harness": "在框架中",
      "harness.table.tasks": "任務",
      "harness.table.noModel": "無模型",
      "harness.table.total": "全部任務",
      "harness.table.answerable": "不含需要今天日期或已存筆記的任務",
      "harness.m.sample": "這是一次小規模測試：{tasks} 個任務，每個模型在溫度 {temperature} 下各問 {passes} 次。相差一兩個任務只是雜訊，不是結論。",
      "harness.m.sampleNoModels": "這是一次小規模測試：{tasks} 個任務。這個版本沒有已完成的免費模型測試。",
      "harness.m.author": "這 {tasks} 個任務、{cases} 則出錯的工具呼叫和 {attacks} 次攻擊，都是框架作者自己寫的，還沒有獨立的第三方查核過。",
      "harness.m.rules": "無模型的大腦是一組針對這些任務調校過的模式，所以它的分數是最好情況，並不能預測它對你自己的措辭表現如何。{controls} 道對照題它全部答錯，這是設計使然：這些題需要知識，而它沒有。",
      "harness.m.alone": "「單獨」指同一個模型、同一個問題、不給工具。有 {count} 個任務（{ids}）問的是今天的日期或之前儲存的筆記，而單獨作答的模型這兩樣都沒有拿到。免費模型單獨作答時仍答對了其中一部分（{list}）。日期我們從未傳送。有一則回答引用了一行不是我們寫的日期，看來是服務供應商加進去的。只有 {memory} 個記憶任務（{memoryIds}）是單獨完全無法回答的。表格最後一列不計入這 {count} 個任務。",
      "harness.m.clock": "為什麼單獨作答的模型能答對日期任務：這些任務用的時鐘固定在與測試執行相同的日期（UTC），所以服務供應商加進去的日期剛好是對的。換一天日期就對不上，這一點我們沒有試過。其中有一次答對算得很寬：那個任務還要求儲存一則筆記，檢查器只看天數，而回答聲稱已經儲存了筆記，這是單獨作答的模型做不到的。",
      "harness.m.judge": "在框架中只評判最終答案。只要正確的數字作為完整的數出現在答案裡，不管還說了什麼，都算通過。",
      "harness.m.approve": "基準測試腳本核准了每一次許可請求，使用空的資料庫，也從未載入 GlowSpark，所以這兩個工具不在測量範圍內。",
      "harness.m.corpus": "出錯的工具呼叫：{cases} 則中有 {recovered} 則被正確讀出，涵蓋 {families} 類錯誤。漏掉的：{missed}。嚴格基線是把整則回覆直接當作 JSON 讀取，依其定義只能讀出 {strict} 則。這說明修復是必要的，但它不是與其他框架的比較。",
      "harness.m.controls": "{controls} 則不該被當作工具呼叫的普通回覆中，有 {held} 則被原樣保留。",
      "harness.m.injection": "提示注入：{attacks} 次攻擊中有 {delivered} 次以「資料」的標記到達大腦。隨後一個對注入指令言聽計從的模擬大腦試圖儲存或刪除。規則開啟時，{held} 次被攔在許可請求處，{ran} 次得以執行。規則關閉時，{loose} 次得以執行。這是由設計保證的。它攔住的是錯誤的操作，而不是錯誤的答案。",
      "harness.m.replay": "重播把記錄下來的回覆和工具結果重新送入引擎，並逐個動作比對：{traces} 份測試集紀錄中有 {identical} 份完全一致。這說明迴圈是確定性的，但並不說明答案正確。",
      "harness.m.wrapped": "有一處修復來自真實回覆。三則不屬於測試集的暖身提示顯示，有模型會給工具呼叫多包一層，於是解析器在任何測試任務執行之前學會了拆開它。",
      "harness.m.llm7": "第三個服務供應商 LLM7 已接入本頁，但沒有參加基準測試：它的每日免費額度在準備階段就用完了。",
      "harness.m.spark": "GlowSpark 在這裡是工具，不是大腦。它只會續寫故事，不會聽從指令。",
      "harness.m.run": "{provider}：整次測試只用這一個服務供應商，不切換。請求的模型是 {requested}，實際回應的是 {returned}。執行於 {date}（UTC），Node {node}。",
      "harness.m.pace": "{provider} 有流量限制，所以腳本每 {gap} 秒發一次呼叫，每次最多等 {wait} 秒，每個呼叫最多嘗試 {attempts} 次。測試中途續跑了 {resumes} 次。僅在基準測試中，框架自身的時間上限被提高到 {limit} 分鐘，以免排隊被算作失敗。",
      "harness.m.earlier": "{provider}：測試較早的一段在調整節奏之前，每次回覆最多等 {seconds} 秒。那部分答案予以保留。",
      "harness.m.work": "{provider} 在框架中：{runs} 個任務共 {steps} 步、{calls} 次工具呼叫。解析器修復了 {repaired} 次工具呼叫，{turns} 則回覆被退回糾正，核准了 {prompts} 次許可請求，另有 {fallback} 個答案是在觸及上限後拼出來的（其中 {right} 個正確）。",
      "harness.m.codes": "{provider}，按類型統計的修復：{list}。",
      "harness.m.native": "{provider} 有 {count} 次透過 API 的函式呼叫欄位作答，而本頁從不提供該欄位。工具包會把這類呼叫轉回純文字，所以每個模型都以同樣的方式被讀取。",
      "harness.m.empty": "{provider}：空回覆會重新提問，最多 {tries} 次，之後才計入結果。出現的空回覆：單獨 {bare} 次，在框架中 {harness} 次。",
      "harness.m.noReply": "{provider}：有些呼叫在所有重試之後仍無回覆，按失敗計：單獨 {bare} 個，在框架中 {harness} 個。",
      "harness.silent.lead": "{model}：有 {count} 次，服務供應商傳回的是錯誤而不是回答。每次都按失敗計。",
      "harness.silent.alone": "單獨 {count} 次：{why}。",
      "harness.silent.inside": "在框架中 {count} 次：{why}。",
      "harness.silent.why.provider_parse": "服務供應商讀不懂模型寫出的內容",
      "harness.silent.why.output_limit": "模型還沒作答就用完了輸出額度",
      "harness.silent.why.rate_limit": "服務供應商的免費額度用完了",
      "harness.silent.why.timeout": "服務供應商逾時",
      "harness.silent.why.other": "服務供應商的其他錯誤",
      "harness.paired.line": "{model}，逐個任務看：有 {gained} 個從單獨答錯變為在框架中答對，{lost} 個從答對變為答錯，{same} 個沒有變化。如果框架不起作用，僅憑偶然出現至少這樣懸殊的結果的機率是 {chance}（精確符號檢定）。",
      "harness.paired.clear": "這樣的結果不太可能只是偶然。",
      "harness.paired.unclear": "這樣的結果很容易由偶然造成，所以這次測試並不能說明框架對這個模型有幫助。",
      "harness.paired.gainedSilent": "這 {gained} 個改善中，有 {count} 個是單獨作答時服務供應商沒有回覆的任務。",
      "harness.paired.lostSilent": "這 {lost} 個退步中，有 {count} 個是在框架中服務供應商沒有回覆的任務。",
      "harness.m.replayModel": "{provider}：{traces} 份執行紀錄中有 {identical} 份重播完全一致。",
      "harness.benchMissing": "基準測試檔載入失敗，因此不顯示任何數字。",
      "harness.stat.checks": "項引擎檢查在建置時通過。可在下方重新執行",
      "harness.stat.parser": "則出錯的工具呼叫被正確讀出。嚴格讀取只能讀出 {strict} 則",
      "harness.stat.injection": "次腳本化注入攻擊被攔在許可請求處。規則關閉時有 {ran} 次得以執行",
      "harness.stat.replay": "份執行紀錄逐個動作重播一致",
      "harness.stat.size": "整個引擎，未壓縮，{dependencies} 個相依套件",
      "harness.stat.rules": "個測試任務在完全沒有模型時解出",
      "harness.bar.rules": "無模型，在框架中",
      "harness.bar.alone": "{model}，單獨",
      "harness.bar.harness": "{model}，在框架中",
      "harness.suiteLede": "{tasks} 個任務，分 {groups} 組。每個免費模型把每個任務各做兩遍：一遍單獨作答，一遍在框架中使用工具。長條越長越好。",
      "harness.suiteLedeNoModels": "{tasks} 個任務，分 {groups} 組。這個版本沒有已完成的免費模型測試，所以只顯示無模型這一列。",
      "harness.benchNote": "基準測試檔建置於 {built}，Node {node}。引擎版本 {version}。",
      "harness.selftest.running": "檢查中…",
      "harness.selftest.error": "這些檢查無法在此瀏覽器中執行。",
      "harness.selftest.pass": "✓ {total} 項檢查中有 {passed} 項在此瀏覽器中通過，用時 {seconds} 秒。涵蓋迴圈、解析器、閘門、工具和重播。",
      "harness.selftest.fail": "✕ {total} 項檢查中有 {failed} 項在這裡失敗。第一項：{name}。請告訴我們。",
      "harness.title": "GlowHarness",
      "harness.lede": "我們從零打造的 AI 代理框架：讓 AI 使用工具的迴圈、修復出錯工具呼叫的解析器、變更之前先徵求許可的閘門，以及每一步的紀錄。它就在這個頁面裡執行，甚至完全不用 AI 模型也能運作。",
      "harness.deskTitle": "給它一個任務",
      "harness.brainLabel": "大腦",
      "harness.brain.rules": "無模型",
      "harness.brain.free": "免費模型",
      "harness.taskLabel": "你的任務",
      "harness.placeholder": "用英文讓它做一道加法、算一個日期、換算單位，或記住點什麼。也可以點上方的範例。",
      "harness.run": "執行",
      "harness.stop": "停止",
      "harness.runTitle": "它一步一步做了什麼",
      "harness.copy": "複製答案",
      "harness.replay": "重播",
      "harness.export": "儲存紀錄",
      "harness.tryFree": "試試免費模型",
      "harness.chat": "改問 GlowChat",
      "harness.toolsTitle": "它的工具，以及每個工具能做什麼",
      "harness.toolsLede": "它只能做這些事。讀取是允許的。凡是儲存、刪除或下載，都會先問你，而且任何工具你都可以關掉。",
      "harness.notesTitle": "它記住了什麼",
      "harness.notesLede": "記事本是它唯一的記憶。內容只儲存在這台裝置的這個瀏覽器裡，不會存到別處。",
      "harness.notesEmpty": "還沒有儲存任何內容。試試「Remember that my locker code is …」。",
      "harness.forgetAll": "全部忘掉",
      "harness.numbersTitle": "實測數據",
      "harness.numbersLede": "這裡沒有任何估算。每個數字都讀自我們的腳本寫出的基準測試檔，頁面底部的按鈕還能在你自己的瀏覽器裡重新執行引擎的檢查。",
      "harness.suiteTitle": "同樣的任務，用與不用框架",
      "harness.methodTitle": "這些數據是怎麼測的，以及它們不能說明什麼",
      "harness.versusTitle": "它贏在哪裡，輸在哪裡",
      "harness.versusLede": "在真正的工作上，GlowHarness 不是 Claude Code、Codex 或 OpenCode 的對手。它們用最好的模型來操作你的電腦。這一個瞄準的是它們略過的地方：無需安裝、無需帳號、每一步都看得見，而且完全沒有模型時也有用。",
      "harness.v.community": "開源",
      "harness.v.r1": "在你的電腦上做真正的工作",
      "harness.v.r1.us": "不能。它無法接觸檔案、執行程式或瀏覽網頁。",
      "harness.v.r1.claude": "編輯檔案並執行 shell 指令",
      "harness.v.r1.codex": "編輯檔案並執行 shell 指令",
      "harness.v.r1.opencode": "編輯檔案並執行 shell 指令",
      "harness.v.r2": "背後的模型",
      "harness.v.r2.us": "小型免費模型：有流量限制，有時很慢，而且常常出錯",
      "harness.v.r2.claude": "Anthropic 最好的模型",
      "harness.v.r2.codex": "OpenAI 最好的模型",
      "harness.v.r2.opencode": "你接入的任何模型",
      "harness.v.r3": "新增自己的工具",
      "harness.v.r3.us": "只能透過修改程式碼",
      "harness.v.r3.claude": "可以，透過 MCP 伺服器",
      "harness.v.r3.codex": "可以，透過 MCP 伺服器",
      "harness.v.r3.opencode": "可以，透過 MCP 伺服器",
      "harness.v.r4": "開始第一個任務之前",
      "harness.v.r4.us": "打開這個頁面",
      "harness.v.r4.claude": "先安裝，再用付費的 Claude 方案或 API 金鑰登入",
      "harness.v.r4.codex": "先安裝，再用 ChatGPT 帳號或 API 金鑰登入",
      "harness.v.r4.opencode": "先安裝。內建免費模型，也可以用自己的金鑰",
      "harness.v.r5": "沒有 AI 模型也能用",
      "harness.v.r5.us": "可以，限於有關加減、日期、單位、文字和筆記的簡單請求",
      "harness.v.r5.claude": "不能",
      "harness.v.r5.codex": "不能",
      "harness.v.r5.opencode": "不能",
      "harness.v.r6": "在哪裡執行",
      "harness.v.r6.us": "瀏覽器分頁，手機也行",
      "harness.v.r6.claude": "終端機、程式碼編輯器、桌面應用程式和網頁",
      "harness.v.r6.codex": "終端機、程式碼編輯器和桌面應用程式",
      "harness.v.r6.opencode": "終端機、桌面應用程式和網頁",
      "harness.v.r7": "執行有風險的操作之前",
      "harness.v.r7.us": "會詢問。讀過不可信文字後會再問一次，即使是你設為一律允許的工具",
      "harness.v.r7.claude": "權限模式，另有可選的 shell 指令沙箱",
      "harness.v.r7.codex": "作業系統提供的沙箱，加上核准政策",
      "harness.v.r7.opencode": "每個工具都有允許、詢問或拒絕規則",
      "harness.v.r8": "原始碼",
      "harness.v.r8.us": "開放。純 JavaScript，沒有相依套件",
      "harness.v.r8.claude": "專有",
      "harness.v.r8.codex": "開源",
      "harness.v.r8.opencode": "開源",
      "harness.v.sources": "其他各欄的資料來源，透過網路搜尋查得，日期為",
      "harness.v.noBench": "我們沒有親自對這些工具做基準測試，所以不為它們給出任何數字。",
      "harness.limitsTitle": "它做不到的事",
      "harness.limit1": "它無法接觸你的檔案、執行程式或瀏覽網頁。它的工具只有上面列出的那些。要在電腦上做真正的工作，請用 Claude Code、Codex 或 OpenCode。",
      "harness.limit2": "沒有模型時，它只懂用簡單英文提出的加減、日期、單位、文字和筆記請求。其他問題它會說答不了，而它說的是實話。",
      "harness.limit3": "免費模型小、有流量限制，有時會出錯。服務供應商讓它排隊時，長任務可能會卡住。",
      "harness.limit4": "使用免費模型時，你的任務和每一個工具結果都會傳給免費 AI 服務供應商。沒有模型時，沒有任何內容離開此頁面。",
      "harness.limit5": "閘門會攔住你沒有核准的操作。它不能把錯誤的答案變對，也看不出模型是否被騙了。它只保證被騙的模型在沒有你同意時無法儲存或刪除。",
      "harness.limit6": "GlowSpark 在這裡是工具，不是大腦。它只會寫故事，不會聽從指令。",
      "harness.builtTitle": "從零打造",
      "harness.built1": "迴圈：向大腦要一步，讀懂它，執行工具，展示結果，再重複。遇到步數上限、時間上限、重複呼叫，或你按下停止時，它就會停下。",
      "harness.built2": "解析器：小模型寫工具呼叫時常常出錯。解析器會修復常見的錯法。修不了時，它會明確告訴模型哪裡錯了，然後再問一次。",
      "harness.built3": "閘門：讀取是允許的，而儲存、刪除和下載要先問。一旦某次執行讀過不可信文字，這類操作每一次都會再問。如果沒有人可以問，答案就是不行。",
      "harness.built4": "紀錄：每一步都連同時間記了下來。重播會讓引擎照著紀錄再跑一遍，並檢查它是否做出同樣的決定。",
      "harness.selftest": "在此瀏覽器中執行引擎檢查",
      "harness.apiTitle": "在其他 Glow 應用程式中使用",
      "harness.apiLede": "引擎和工具包是兩個沒有相依套件的普通腳本檔。任何 Glow 頁面都可以載入它們，給框架一個大腦、幾個工具和一種詢問使用者的方式，然後執行任務。",
      "harness.fine": "GlowHarness 可能出錯，背後是免費模型時尤其如此。沒有模型時，你輸入的任何內容都不會離開此頁面。使用免費模型時，你的任務和工具結果會傳給免費 AI 服務供應商，所以不要在那裡輸入任何私密內容。筆記只儲存在這個瀏覽器裡。",
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
