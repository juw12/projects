/* Hazel Shorts Channel Kit — turn a one-line prompt into a ready-to-create channel:
 * names, handles, bios (EN/ID), content pillars, a posting calendar, avatar + banner.
 * Offline and rule-based (no AI service): it gives a strong starting point to edit.
 */
(function () {
  "use strict";

  // Words that carry no topic at all.
  var STOP = ("a an the and or of for to in on with about how why what is are my your our this that " +
    "channel videos video content shorts short explain explained explainer explaining faceless make create " +
    "behind inside daily every everyday simple quick fast real world things stuff day per new " +
    "work works working made built function functions operate operates actually really " +
    "yang dan atau untuk dengan tentang bagaimana kenapa apa adalah ini itu saya kamu kita konten " +
    "sehari hari harian setiap tiap di ke dari").split(" ");

  // Words that describe the channel's angle (theme), not a thing you can show on screen.
  var ENGINEERING = { en: "Engineering", id: "Teknik", angle: "The engineering behind" };
  var GADGETS = { en: "Gadgets", id: "Gadget", angle: "Inside" };
  var SCIENCE = { en: "Science", id: "Sains", angle: "The science behind" };
  var TECH = { en: "Tech", id: "Tekno", angle: "The tech behind" };
  var THEMES = {
    engineering: ENGINEERING,
    engineer: ENGINEERING,
    engineers: ENGINEERING,
    teknik: ENGINEERING,
    teardown: GADGETS,
    teardowns: GADGETS,
    bongkar: GADGETS,
    bedah: GADGETS,
    science: SCIENCE,
    sains: SCIENCE,
    physics: { en: "Physics", id: "Fisika", angle: "The physics behind" },
    tech: TECH,
    technology: TECH,
    teknologi: TECH,
    design: { en: "Design", id: "Desain", angle: "The design behind" },
    manufacturing: { en: "Factory", id: "Pabrik", angle: "How they make" },
    factory: { en: "Factory", id: "Pabrik", angle: "How they make" },
    history: { en: "History", id: "Sejarah", angle: "The history of" },
    sejarah: { en: "History", id: "Sejarah", angle: "The history of" }
  };

  // Acronyms keep their capitals; the value says whether the spoken form takes "an".
  var ACRONYMS = { cctv: false, led: false, pcb: false, usb: false, ip: false, ev: false, iot: false,
    ai: false, gps: false, ssd: false, cpu: false, gpu: false, lcd: false, oled: false, hdd: false,
    nfc: false, rfid: false, hp: false, tv: false, ac: false, cnc: false };
  // spoken with a vowel sound → "an": an LED, an SSD, an HDD, an NFC, an RFID, an HP, an AC
  ["led", "ssd", "hdd", "nfc", "rfid", "hp", "ac", "ip", "ev", "iot", "ai", "lcd", "oled"].forEach(function (k) {
    ACRONYMS[k] = true;
  });

  // Fallback subjects when the prompt names fewer than three concrete things.
  var FALLBACK_SUBJECTS = ["smartphone", "power bank", "wireless earbud", "LED bulb", "Wi-Fi router", "smartwatch"];

  var PALETTES = [
    { bg: "#14161B", fg: "#FFFFFF", accent: "#FFB224" },
    { bg: "#F6F3EC", fg: "#18181C", accent: "#E44A2A" },
    { bg: "#0E1F2E", fg: "#FFFFFF", accent: "#38E1FF" },
    { bg: "#1B1430", fg: "#FFFFFF", accent: "#B48CFF" }
  ];

  // {a} = subject with article ("a CCTV camera"), {x} = bare singular, {xs} = plural.
  var PILLARS = {
    en: [
      { name: "What's inside", hook: "What's inside {a}?" },
      { name: "How it's made", hook: "How is {a} actually made?" },
      { name: "Why it works", hook: "Why does {a} work like this?" },
      { name: "Myth vs fact", hook: "{XS}: the biggest myth, checked." },
      { name: "By the numbers", hook: "One number that explains every {x}." }
    ],
    id: [
      { name: "Bedah isi", hook: "Apa sih isi {x}?" },
      { name: "Cara dibuat", hook: "Gimana {x} dibuat di pabrik?" },
      { name: "Kok bisa?", hook: "Kok bisa {x} bekerja seperti ini?" },
      { name: "Mitos vs fakta", hook: "Mitos soal {x} — benar atau salah?" },
      { name: "Angka penting", hook: "Satu angka yang menjelaskan {x}." }
    ]
  };

  function $(id) {
    return document.getElementById(id);
  }

  function titleCase(text) {
    return text.split(" ").map(function (w) {
      return w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  function singular(word) {
    if (ACRONYMS.hasOwnProperty(word) || word.length < 4 || /(ss|us|is)$/.test(word)) {
      return word;
    }
    if (/ies$/.test(word)) {
      return word.slice(0, -3) + "y";
    }
    if (/(ches|shes|xes|sses)$/.test(word)) {
      return word.slice(0, -2);
    }
    if (/s$/.test(word)) {
      return word.slice(0, -1);
    }
    return word;
  }

  function plural(phrase) {
    var parts = phrase.split(" ");
    var last = parts.pop();
    var out;
    if (ACRONYMS.hasOwnProperty(last.toLowerCase()) && parts.length) {
      return phrase;  // "kamera CCTV" (Indonesian word order) stays as-is
    } else if (ACRONYMS.hasOwnProperty(last.toLowerCase())) {
      out = last + "s";
    } else if (/[^aeiou]y$/.test(last)) {
      out = last.slice(0, -1) + "ies";
    } else if (/(s|x|ch|sh)$/.test(last)) {
      out = last + "es";
    } else {
      out = last + "s";
    }
    parts.push(out);
    return parts.join(" ");
  }

  function display(word) {
    return ACRONYMS.hasOwnProperty(word) ? word.toUpperCase() : word;
  }

  function withArticle(phrase) {
    var first = phrase.split(" ")[0];
    var key = first.toLowerCase();
    var an;
    if (ACRONYMS.hasOwnProperty(key)) {
      an = ACRONYMS[key];
    } else {
      an = /^[aeiou]/i.test(first) && !/^(uni|use|usu|eu|one)/i.test(first);
    }
    return (an ? "an " : "a ") + phrase;
  }

  function makeSubject(phrase) {
    var last = phrase.split(" ").pop();
    var mass = /ing$/.test(last);  // "cooking", "welding": no article, no plural
    return { one: phrase, many: mass ? phrase : plural(phrase), mass: mass };
  }

  // Split a prompt into a theme ("Engineering") and concrete subjects ("CCTV camera", "phone").
  // Phrases are separated by commas, "and", "of", "&", "dan"; each phrase keeps up to 3 content words.
  function analyse(prompt) {
    var phrases = prompt.toLowerCase()
      .replace(/[^a-z0-9\u00C0-\u024F\s,&/-]/g, " ")
      .split(/\s*(?:,|&|\/|\band\b|\bor\b|\bof\b|\bdan\b|\batau\b|\bvs\b)\s*/);
    var theme = null;
    var subjects = [];
    var seen = {};
    var gadgets = false;
    phrases.forEach(function (raw) {
      var words = raw.split(/\s+/).filter(Boolean).filter(function (w) {
        if (THEMES.hasOwnProperty(w)) {
          theme = theme || THEMES[w];
          return false;
        }
        if (/^gadgets?$/.test(w)) {
          gadgets = true;  // too vague for a hook; used as the catch-all in bios
          return false;
        }
        return STOP.indexOf(w) < 0 && (w.length >= 3 || ACRONYMS.hasOwnProperty(w));
      }).slice(-3);
      if (!words.length) {
        return;
      }
      words[words.length - 1] = singular(words[words.length - 1]);
      var phrase = words.map(display).join(" ");
      if (!seen[phrase.toLowerCase()]) {
        seen[phrase.toLowerCase()] = true;
        subjects.push(phrase);
      }
    });
    var named = subjects.length;
    FALLBACK_SUBJECTS.forEach(function (s) {
      if (subjects.length < 4 && !seen[s.toLowerCase()]) {
        subjects.push(s);
      }
    });
    return {
      theme: theme || (gadgets ? GADGETS : TECH),
      named: named,
      gadgets: gadgets,
      subjects: subjects.slice(0, 6).map(makeSubject)
    };
  }

  function topicList(info, count) {
    var list = info.subjects.slice(0, Math.max(1, Math.min(count, info.named || count))).map(function (s) {
      return s.many;
    });
    if (info.gadgets) {
      list.push("gadgets");
    }
    if (list.length === 1) {
      return list[0];
    }
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }

  function nameIdeas(info, lang) {
    var t = info.theme[lang] || info.theme.en;
    var s = titleCase(info.subjects[0].one);
    var sMany = titleCase(info.subjects[0].many);
    var en = ["Inside " + t, t + " Unboxed", "How " + sMany + (info.subjects[0].many === info.subjects[0].one ? " Works" : " Work"), t + " Decoded",
      "The " + t + " Lab", s + " in 60s", "Unseen " + t, t + " in a Minute"];
    var id = ["Bedah " + (lang === "id" ? t : info.theme.id), "Isi " + s, s + " Dibongkar", "Kok Bisa Gitu?",
      "Dapur " + t, t + " 60 Detik", "Rahasia " + s, "Ngulik " + t];
    return lang === "id" ? id : en;
  }

  function handle(name, suffix) {
    var base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
    return (base + suffix).slice(0, 24);
  }

  function tagline(info, lang) {
    if (lang === "id") {
      return "Bedah " + info.theme.id.toLowerCase() + " dalam 60 detik";
    }
    return info.theme.en + " in 60 seconds";
  }

  function bios(name, info, lang) {
    var topic = topicList(info, 3);
    if (lang === "id") {
      return {
        tiktok: ("Bedah " + topic + " dalam 60 detik.").slice(0, 80),
        instagram: (name + " — " + topic + " dibedah singkat & jelas.\nVideo baru tiap hari.\nKomen: mau dibedah apa berikutnya?").slice(0, 150),
        youtube: name + " membedah " + topic + " dalam video pendek yang jelas: apa isinya, bagaimana dibuat, dan kenapa bisa bekerja. " +
          "Dibuat oleh seorang engineer R&D. Tulis di komentar produk apa yang harus kami bedah berikutnya."
      };
    }
    var angle = info.theme.angle;
    return {
      tiktok: (angle + " " + topic + " — in 60 seconds.").slice(0, 80),
      instagram: (name + " — " + angle.charAt(0).toLowerCase() + angle.slice(1) + " " + topic +
        ".\nNew short every day.\nComment what we should open next.").slice(0, 150),
      youtube: name + ": " + angle.charAt(0).toLowerCase() + angle.slice(1) + " " + topic +
        ", in short, clear videos — what's inside, how it's made and why it works. " +
        "Made by an R&D engineer. Tell us in the comments what to take apart next."
    };
  }

  function fillHook(template, subject) {
    if (subject.mass) {
      template = template.replace("every {x}", "{x}");
    }
    return template
      .replace("{a}", subject.mass ? subject.one : withArticle(subject.one))
      .replace("{XS}", titleCase(subject.many).charAt(0).toUpperCase() + titleCase(subject.many).slice(1))
      .replace("{xs}", subject.many)
      .replace("{x}", subject.one);
  }

  function calendar(info, lang, perDay, days) {
    var pillars = PILLARS[lang] || PILLARS.en;
    var subjects = info.subjects;
    var rows = [];
    var n = 0;
    for (var d = 1; d <= days; d++) {
      for (var s = 0; s < perDay; s++) {
        // rotate pillars every slot and subjects every slot, offset so pairs don't repeat for a long time
        var pillar = pillars[n % pillars.length];
        var subject = subjects[(n + Math.floor(n / pillars.length)) % subjects.length];
        rows.push({ day: d, slot: s + 1, pillar: pillar.name, hook: fillHook(pillar.hook, subject) });
        n++;
      }
    }
    return rows;
  }

  // ---------------- images ----------------
  function initials(name) {
    var parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    return ((parts[0] || "S").charAt(0) + (parts[1] ? parts[1].charAt(0) : "")).toUpperCase();
  }

  function drawAvatar(canvas, name, palette) {
    var ctx = canvas.getContext("2d");
    var s = canvas.width;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = palette.fg;
    ctx.font = "900 " + Math.round(s * 0.3) + "px 'Arial Black', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(name), s / 2, s / 2 + s * 0.02);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(s * 0.38, s * 0.72, s * 0.24, s * 0.03);
  }

  function drawBanner(canvas, name, tagline, palette) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = palette.accent + "22";
    ctx.lineWidth = 2;
    for (var x = 0; x < w; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var y = 0; y < h; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // YouTube safe area (all devices): 1546 x 423 centred
    var cx = w / 2;
    var cy = h / 2;
    ctx.fillStyle = palette.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var size = 150;
    ctx.font = "900 " + size + "px 'Arial Black', Arial, sans-serif";
    while (ctx.measureText(name).width > 1440 && size > 60) {
      size -= 6;
      ctx.font = "900 " + size + "px 'Arial Black', Arial, sans-serif";
    }
    ctx.fillText(name, cx, cy - 50);
    ctx.fillStyle = palette.accent;
    ctx.font = "bold 56px Arial, sans-serif";
    ctx.fillText(tagline, cx, cy + 90);
    ctx.fillRect(cx - 120, cy + 150, 240, 8);
  }

  function download(canvas, filename) {
    var a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
  }

  // ---------------- render ----------------
  var current = null;

  function generate() {
    var prompt = $("k-prompt").value.trim() || "engineering teardowns of everyday gadgets";
    var langs = [];
    if ($("k-en").checked) {
      langs.push("en");
    }
    if ($("k-id").checked) {
      langs.push("id");
    }
    if (!langs.length) {
      langs = ["en"];
    }
    var perDay = Math.max(1, Math.min(5, Number($("k-perday").value) || 1));
    var info = analyse(prompt);
    var palette = PALETTES[Math.abs(hash(prompt)) % PALETTES.length];
    current = { prompt: prompt, info: info, palette: palette, channels: [] };

    var host = $("kit-out");
    host.innerHTML = "";
    langs.forEach(function (lang) {
      var names = nameIdeas(info, lang);
      var chosen = names[0];
      var suffix = langs.length > 1 ? (lang === "id" ? ".id" : ".en") : "";
      var channel = {
        lang: lang,
        names: names,
        name: chosen,
        handle: handle(chosen, suffix),
        bios: bios(chosen, info, lang),
        plan: calendar(info, lang, perDay, 30)
      };
      current.channels.push(channel);
      host.appendChild(renderChannel(channel, palette));
    });
    $("kit-actions").hidden = false;
  }

  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function renderChannel(channel, palette) {
    var box = el("section", "panel kit-channel");
    box.appendChild(el("h2", "", (channel.lang === "id" ? "Bahasa Indonesia" : "English") + " channel"));

    var nameRow = el("div", "kit-names");
    channel.names.forEach(function (n) {
      var b = el("button", "btn small" + (n === channel.name ? " primary-lite" : " ghost"), n);
      b.type = "button";
      b.addEventListener("click", function () {
        channel.name = n;
        channel.handle = handle(n, channel.handle.indexOf(".") > 0 ? channel.handle.slice(channel.handle.lastIndexOf(".")) : "");
        channel.bios = bios(n, current.info, channel.lang);
        var fresh = renderChannel(channel, palette);
        box.replaceWith(fresh);
      });
      nameRow.appendChild(b);
    });
    box.appendChild(nameRow);

    var grid = el("div", "kit-grid");
    var avatar = document.createElement("canvas");
    avatar.width = 800;
    avatar.height = 800;
    avatar.className = "kit-avatar";
    drawAvatar(avatar, channel.name, palette);
    var banner = document.createElement("canvas");
    banner.width = 2560;
    banner.height = 1440;
    banner.className = "kit-banner";
    drawBanner(banner, channel.name, tagline(current.info, channel.lang), palette);
    grid.appendChild(avatar);
    grid.appendChild(banner);
    box.appendChild(grid);

    var dl = el("div", "voice-row");
    var b1 = el("button", "btn small", "⬇ Avatar 800×800");
    b1.type = "button";
    b1.addEventListener("click", function () { download(avatar, channel.handle + "-avatar.png"); });
    var b2 = el("button", "btn small", "⬇ YouTube banner 2560×1440");
    b2.type = "button";
    b2.addEventListener("click", function () { download(banner, channel.handle + "-banner.png"); });
    dl.appendChild(b1);
    dl.appendChild(b2);
    box.appendChild(dl);

    var info = el("dl", "kit-info");
    [["Handle (check availability)", "@" + channel.handle],
      ["TikTok bio (" + channel.bios.tiktok.length + " / 80)", channel.bios.tiktok],
      ["Instagram bio (" + channel.bios.instagram.length + " / 150)", channel.bios.instagram],
      ["YouTube description", channel.bios.youtube]].forEach(function (pair) {
      var dt = el("dt", "", pair[0]);
      var copy = el("button", "btn small ghost kit-copy", "Copy");
      copy.type = "button";
      copy.dataset.copy = pair[1];
      copy.setAttribute("aria-label", "Copy " + pair[0]);
      dt.appendChild(copy);
      info.appendChild(dt);
      info.appendChild(el("dd", "", pair[1]));
    });
    box.appendChild(info);

    var shown = 15;
    var heading = el("h3", "");
    var table = el("table", "kit-plan");
    var more = el("button", "btn small ghost", "");
    more.type = "button";
    function renderPlan() {
      table.innerHTML = "";
      var head = el("tr");
      ["Day", "Slot", "Pillar", "Hook idea", ""].forEach(function (h) { head.appendChild(el("th", "", h)); });
      table.appendChild(head);
      channel.plan.slice(0, shown).forEach(function (row) {
        var tr = el("tr");
        [row.day, row.slot, row.pillar, row.hook].forEach(function (c) { tr.appendChild(el("td", "", String(c))); });
        var cell = el("td");
        var link = el("a", "", "Make it →");
        link.href = studioLink(row.hook, channel.lang);
        link.title = "Open this hook as a draft in the studio";
        cell.appendChild(link);
        tr.appendChild(cell);
        table.appendChild(tr);
      });
      heading.textContent = "Posting plan (" + (shown >= channel.plan.length ? "all" : "first " + shown + " of") + " " + channel.plan.length + " slots)";
      more.textContent = shown >= channel.plan.length ? "Show fewer" : "Show all " + channel.plan.length;
    }
    more.addEventListener("click", function () {
      shown = shown >= channel.plan.length ? 15 : channel.plan.length;
      renderPlan();
    });
    renderPlan();
    box.appendChild(heading);
    var scroller = el("div", "kit-plan-wrap");
    scroller.appendChild(table);
    box.appendChild(scroller);
    if (channel.plan.length > 15) {
      box.appendChild(more);
    }
    return box;
  }

  function studioLink(hook, lang) {
    return "app.html?hook=" + encodeURIComponent(hook) + "&lang=" + encodeURIComponent(lang);
  }

  function copyText(text, button) {
    var done = function () {
      var label = button.textContent;
      button.textContent = "Copied ✓";
      setTimeout(function () { button.textContent = label; }, 1400);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { /* ignore */ });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      if (document.execCommand("copy")) {
        done();
      }
    } catch (err) {
      /* ignore */
    }
    document.body.removeChild(area);
  }

  function cell(text) {
    return String(text).replace(/\|/g, "\\|");
  }

  function kitMarkdown() {
    if (!current) {
      return "";
    }
    var out = ["# Channel kit", "", "Prompt: " + current.prompt, ""];
    current.channels.forEach(function (c) {
      out.push("## " + c.name + " (" + c.lang.toUpperCase() + ")", "");
      out.push("- Handle: @" + c.handle + "  (check availability on each platform)");
      out.push("- Name ideas: " + c.names.join(" · "));
      out.push("- TikTok bio: " + c.bios.tiktok);
      out.push("- Instagram bio: " + c.bios.instagram.replace(/\n/g, " / "));
      out.push("- YouTube description: " + c.bios.youtube, "");
      out.push("| Day | Slot | Pillar | Hook |", "| --- | --- | --- | --- |");
      c.plan.forEach(function (r) {
        out.push("| " + r.day + " | " + r.slot + " | " + cell(r.pillar) + " | " + cell(r.hook) + " |");
      });
      out.push("");
    });
    out.push("## Create the accounts (you, ~5 min each)", "",
      "1. YouTube: youtube.com → profile → Create a channel (use a Brand Account to add managers later); verify phone to unlock custom thumbnails & longer uploads.",
      "2. Instagram: sign up → Settings → Account type → switch to Creator or Business (required for API publishing).",
      "3. TikTok: sign up → add bio/avatar; optional Business account for analytics.",
      "4. Upload avatar + banner, paste bios, then connect the channel in Hazel Shorts → Publish.");
    return out.join("\n");
  }

  var PREFS_KEY = "shortcraft.channelKit.v1";

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        prompt: $("k-prompt").value,
        en: $("k-en").checked,
        id: $("k-id").checked,
        perDay: $("k-perday").value
      }));
    } catch (err) {
      /* storage blocked: nothing to remember */
    }
  }

  function restorePrefs() {
    try {
      var prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (prefs) {
        $("k-prompt").value = prefs.prompt || "";
        $("k-en").checked = prefs.en !== false;
        $("k-id").checked = prefs.id !== false;
        if (prefs.perDay) {
          $("k-perday").value = prefs.perDay;
        }
        return true;
      }
    } catch (err) {
      /* corrupt prefs: ignore */
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("btn-generate").addEventListener("click", function () {
      savePrefs();
      generate();
    });
    $("k-prompt").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        savePrefs();
        generate();
      }
    });
    $("kit-out").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-copy]");
      if (btn) {
        copyText(btn.dataset.copy, btn);
      }
    });
    $("btn-kit-md").addEventListener("click", function () {
      var blob = new Blob([kitMarkdown()], { type: "text/markdown" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "channel-kit.md";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    var params = new URLSearchParams(window.location.search);
    if (params.get("prompt")) {
      $("k-prompt").value = params.get("prompt");
      generate();
    } else if (restorePrefs() && $("k-prompt").value.trim()) {
      generate();
    }
  });

  window.ShortcraftKit = { generate: generate, markdown: kitMarkdown };
})();
