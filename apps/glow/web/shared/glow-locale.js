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
    if (["ollama", "custom", "demo", "local"].includes(provider)) return { allowed: true, family, caution: "" };
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
