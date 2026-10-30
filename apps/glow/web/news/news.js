// Glow AI News: the day's AI stories, grouped by story with every source, a 5-point briefing,
// topics, search, "new since your last visit", saved stories, and one tap to discuss any story
// with GlowChat. The edition (news.json) is built twice a day by apps/glow/tools/ai_news.py.
(function () {
  "use strict";

  const NEWS_URL = "./news.json";
  const STORE_KEY = "glow.news.v1";
  const CHAT_STORE_KEY = "mufakat.v1";
  const HOME_THEME_KEY = "glow.home.theme";
  const onPhone = window.matchMedia("(max-width: 720px)").matches;
  const CHAT_PAGE = onPhone ? "../chat/mobile.html" : "../chat/";
  const ASK_MAX = 3800; // GlowChat accepts up to 4000 characters in ?q=
  const $ = (id) => document.getElementById(id);
  const tr = (key, fallback) => {
    if (!window.GlowLocale) return fallback;
    const value = window.GlowLocale.t(key);
    return value && value !== key ? value : fallback;
  };

  let edition = null;
  let lastFetch = 0;
  const view = { topic: "all", query: "", onlyNew: false, onlySaved: false };

  // ---- saved state: last visit, saved stories (kept even after they leave the edition) ----
  function readStore() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      return {};
    }
  }
  const store = Object.assign({ lastVisit: "", saved: {} }, readStore());
  if (!store.saved || typeof store.saved !== "object") store.saved = {};
  // "New for you": stories that arrived after your last visit. On a first visit, the last 6 hours' news.
  const firstVisit = !Date.parse(store.lastVisit || "");
  const previousVisit = firstVisit ? Date.now() - 6 * 3600 * 1000 : Date.parse(store.lastVisit);
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (error) {
      // Storage full or blocked: saving just doesn't persist this time.
    }
  }
  function markVisited() {
    store.lastVisit = new Date().toISOString();
    saveStore();
  }

  // ---- theme: same choice as Glow home ----
  function chatTheme() {
    try {
      return ((JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || "null") || {}).settings || {}).theme;
    } catch (error) {
      return "";
    }
  }
  function preferredTheme() {
    const choice = localStorage.getItem(HOME_THEME_KEY) || chatTheme() || "system";
    if (choice === "light" || choice === "dark") return choice;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("theme-btn").textContent = theme === "dark" ? "☀" : "☾";
    $("theme-btn").title = theme === "dark" ? "Switch to light" : "Switch to dark";
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#262624" : "#faf9f5";
  }
  applyTheme(preferredTheme());
  $("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(HOME_THEME_KEY, next);
    applyTheme(next);
  });

  // ---- helpers ----
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch (error) {
      return "";
    }
  }
  function ago(iso) {
    const time = Date.parse(iso || "");
    if (!time) return "";
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }
  function untilText(iso) {
    const time = Date.parse(iso || "");
    if (!time) return "";
    const minutes = Math.round((time - Date.now()) / 60000);
    if (minutes <= 0) return "any minute now";
    if (minutes < 60) return `in ${minutes} min`;
    return `in ${Math.round(minutes / 60)} h`;
  }
  function localTime(iso) {
    const time = Date.parse(iso || "");
    return time ? new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  }
  let toastTimer = 0;
  function toast(message) {
    const box = $("news-toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.hidden = true;
    }, 2600);
  }
  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand && document.execCommand("copy");
      area.remove();
      return !!ok;
    }
  }
  function chatUrl(question) {
    const url = new URL(CHAT_PAGE, location.href);
    url.searchParams.set("q", question.slice(0, ASK_MAX));
    url.searchParams.set("send", "1");
    return url.href;
  }
  function isNew(story) {
    const arrived = firstVisit ? Date.parse(story.published || "") : Date.parse(story.first_seen || "");
    return (arrived || 0) > previousVisit;
  }
  function topicLabel(id) {
    const topic = ((edition && edition.topics) || []).find((t) => t.id === id);
    return topic ? topic.label : id;
  }

  // ---- questions handed to GlowChat (it can search, compare and go deeper than a news card) ----
  function storyQuestion(story) {
    const sources = (story.sources || []).map((s) => `${s.name}: ${s.url}`).join("\n");
    return `Help me understand this AI news story.\n\nHeadline: ${story.title}\nPublished: ${(story.published || "").slice(0, 10)}\n`
      + (story.summary ? `Summary: ${story.summary}\n` : "")
      + `Sources:\n${sources}\n\n`
      + "Explain in plain words what happened, why it matters for people who use or build with AI, what is still unclear, and what to watch next. Say clearly if you can't verify a detail.";
  }
  function briefingQuestion() {
    const top = (edition.stories || []).slice(0, 8);
    const lines = top.map((s, index) => `${index + 1}. ${s.title} (${(s.sources || []).map((x) => x.name).join(", ")})${s.summary ? " — " + s.summary : ""}`);
    const date = new Date(Date.parse(edition.generated_at) || Date.now()).toDateString();
    return `Here are today's top AI news stories (${date}):\n\n${lines.join("\n")}\n\n`
      + "Give me a short, honest take: the 3 things that matter most and why, any connection between the stories, and what I should watch this week. Keep it concise.";
  }

  // ---- rendering ----
  function renderMeta() {
    const meta = $("news-meta");
    if (!edition) return;
    const next = Date.parse(edition.next_update || "");
    const stale = next && Date.now() > next + 2 * 3600 * 1000;
    const sources = (edition.sources || []).filter((s) => s.ok).length;
    meta.innerHTML = `<span class="dot${stale ? " stale" : ""}" aria-hidden="true"></span>`
      + `Updated <b>${escapeHtml(ago(edition.generated_at))}</b> (${escapeHtml(localTime(edition.generated_at))})`
      + (stale ? " · the next edition is a little late" : ` · next edition ${escapeHtml(untilText(edition.next_update))}`)
      + ` · ${(edition.stories || []).length} stories from ${sources} sources`;
  }

  function renderBriefing() {
    const brief = edition.briefing || {};
    const points = (brief.points || []).filter((p) => p && p.text);
    $("brief").hidden = !points.length;
    if (!points.length) return;
    $("brief-headline").textContent = brief.headline || tr("news.brief", "The briefing");
    $("brief-tag").textContent = brief.ai ? "✦ AI briefing from today's top stories" : "Today's top headlines";
    $("brief-points").innerHTML = points
      .map((point) => `<li><a href="#story-${escapeHtml(point.id)}" data-jump="${escapeHtml(point.id)}">${escapeHtml(point.text)}</a></li>`)
      .join("");
  }

  function renderChips() {
    const stories = edition.stories || [];
    const counts = stories.reduce((acc, story) => {
      acc[story.topic] = (acc[story.topic] || 0) + 1;
      return acc;
    }, {});
    const chips = [{ id: "all", label: "All", count: stories.length }]
      .concat((edition.topics || []).map((t) => ({ id: t.id, label: t.label, count: counts[t.id] || 0 })).filter((t) => t.count));
    if (!chips.some((c) => c.id === view.topic)) view.topic = "all";
    $("topic-chips").innerHTML = chips
      .map((chip) => `<button type="button" class="chip" role="tab" data-topic="${escapeHtml(chip.id)}" aria-selected="${chip.id === view.topic}">${escapeHtml(chip.label)}<small>${chip.count}</small></button>`)
      .join("");
    const fresh = stories.filter(isNew).length;
    $("new-count").textContent = fresh ? String(fresh) : "";
    const saved = Object.keys(store.saved).length;
    $("saved-count").textContent = saved ? String(saved) : "";
  }

  function storyCard(story, index) {
    const url = safeUrl(story.url);
    const saved = !!store.saved[story.id];
    const sources = (story.sources || [])
      .map((s) => {
        const link = safeUrl(s.url);
        return link ? `<a class="source ${escapeHtml(s.kind || "")}" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"><i></i>${escapeHtml(s.name)}</a>` : "";
      })
      .join("");
    const count = (story.sources || []).length;
    const discussion = safeUrl(story.discussion);
    return `<article class="story${index === 0 && view.topic === "all" && !view.query && !view.onlySaved ? " lead-story" : ""}" id="story-${escapeHtml(story.id)}" data-id="${escapeHtml(story.id)}">
      <div class="story-meta">
        <span class="topic ${escapeHtml(story.topic)}">${escapeHtml(topicLabel(story.topic))}</span>
        ${isNew(story) ? '<span class="new-badge">NEW</span>' : ""}
        <span>${escapeHtml(ago(story.published))}</span>
        <span>· ${count} ${count === 1 ? "source" : "sources"}</span>
        ${story.votes ? `<span title="Community votes (Hacker News, Hugging Face)">· ▲ ${story.votes}</span>` : ""}
      </div>
      <h3>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.title)}</a>` : escapeHtml(story.title)}</h3>
      ${story.summary ? `<p>${escapeHtml(story.summary)}${story.summary_ai ? '<span class="ai-mark" title="Written by free AI from the publishers\' text">✦ AI</span>' : ""}</p>` : ""}
      ${story.why ? `<p class="why"><b>Why it matters:</b> ${escapeHtml(story.why)}</p>` : ""}
      <div class="sources">${sources}</div>
      <div class="story-actions">
        <a class="act ask" href="${escapeHtml(chatUrl(storyQuestion(story)))}" data-ask="${escapeHtml(story.id)}">💬 Ask Glow</a>
        <button type="button" class="act" data-save="${escapeHtml(story.id)}" aria-pressed="${saved}">🔖 ${saved ? "Saved" : "Save"}</button>
        <button type="button" class="act" data-share="${escapeHtml(story.id)}">↗ Share</button>
        ${discussion ? `<a class="act" href="${escapeHtml(discussion)}" target="_blank" rel="noopener noreferrer">🗨 ${story.comments || 0} comments</a>` : ""}
      </div>
    </article>`;
  }

  function visibleStories() {
    const query = view.query.trim().toLowerCase();
    const pool = view.onlySaved ? Object.values(store.saved).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)) : edition.stories || [];
    return pool.filter((story) => {
      if (view.topic !== "all" && story.topic !== view.topic) return false;
      if (view.onlyNew && !isNew(story)) return false;
      if (!query) return true;
      const haystack = [story.title, story.summary, story.why, (story.sources || []).map((s) => s.name).join(" ")].join(" ").toLowerCase();
      return query.split(/\s+/).every((word) => haystack.includes(word));
    });
  }

  function renderStories() {
    const list = visibleStories();
    $("stories").innerHTML = list.map(storyCard).join("");
    const empty = $("empty-note");
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = view.onlySaved
        ? "Nothing saved yet. Tap 🔖 Save on a story to keep it here."
        : view.onlyNew
          ? "You're all caught up: nothing new since your last visit."
          : "No stories match. Try another topic or search.";
    }
  }

  function renderSources() {
    const ok = (edition.sources || []).filter((s) => s.ok).map((s) => s.name);
    $("sources-line").textContent = ok.length ? `Sources in this edition: ${ok.join(", ")}.` : "";
  }

  function renderAll() {
    renderMeta();
    renderBriefing();
    renderChips();
    renderStories();
    renderSources();
  }

  function showSkeleton() {
    $("stories").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  // ---- loading ----
  async function load(quiet) {
    if (!quiet) showSkeleton();
    try {
      const response = await fetch(NEWS_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.stories)) throw new Error("bad edition");
      const changed = !edition || edition.generated_at !== data.generated_at;
      edition = data;
      lastFetch = Date.now();
      if (changed) renderAll();
      else renderMeta();
      if (!quiet && /^#story-/.test(location.hash)) {
        const card = document.getElementById(location.hash.slice(1));
        if (card) setTimeout(() => card.scrollIntoView({ block: "center" }), 60);
      }
      if (quiet && changed) toast("✨ A new AI News edition is here");
      return true;
    } catch (error) {
      if (!edition) {
        $("news-meta").textContent = navigator.onLine === false
          ? "You're offline and no edition is saved on this device yet."
          : "The news couldn't load. Check your connection and try again.";
        $("stories").innerHTML = "";
      }
      return false;
    }
  }

  // ---- events ----
  $("topic-chips").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-topic]");
    if (!chip) return;
    view.topic = chip.dataset.topic;
    renderChips();
    renderStories();
  });
  let searchTimer = 0;
  $("news-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.query = event.target.value;
      renderStories();
    }, 120);
  });
  $("only-new").addEventListener("click", () => {
    view.onlyNew = !view.onlyNew;
    $("only-new").setAttribute("aria-pressed", String(view.onlyNew));
    renderStories();
  });
  $("only-saved").addEventListener("click", () => {
    view.onlySaved = !view.onlySaved;
    $("only-saved").setAttribute("aria-pressed", String(view.onlySaved));
    renderStories();
  });

  function findStory(id) {
    return ((edition && edition.stories) || []).find((s) => s.id === id) || store.saved[id] || null;
  }

  $("stories").addEventListener("click", async (event) => {
    const saveBtn = event.target.closest("[data-save]");
    if (saveBtn) {
      const story = findStory(saveBtn.dataset.save);
      if (!story) return;
      if (store.saved[story.id]) delete store.saved[story.id];
      else store.saved[story.id] = Object.assign({}, story, { savedAt: Date.now() });
      saveStore();
      renderChips();
      renderStories();
      return;
    }
    const shareBtn = event.target.closest("[data-share]");
    if (shareBtn) {
      const story = findStory(shareBtn.dataset.share);
      const url = story && safeUrl(story.url);
      if (!url) return;
      if (navigator.share) {
        navigator.share({ title: story.title, text: story.summary || story.title, url }).catch(() => {});
      } else if (await copyText(`${story.title}\n${url}`)) {
        toast("Link copied");
      }
    }
  });

  $("brief-points").addEventListener("click", (event) => {
    const link = event.target.closest("[data-jump]");
    if (!link) return;
    event.preventDefault();
    view.topic = "all";
    view.query = "";
    view.onlyNew = false;
    view.onlySaved = false;
    $("news-search").value = "";
    $("only-new").setAttribute("aria-pressed", "false");
    $("only-saved").setAttribute("aria-pressed", "false");
    renderChips();
    renderStories();
    const card = document.getElementById(`story-${link.dataset.jump}`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.animate([{ borderColor: "var(--accent)" }, { borderColor: "var(--border)" }], { duration: 1600 });
    }
  });

  $("brief-ask").addEventListener("click", () => {
    if (edition) location.assign(chatUrl(briefingQuestion()));
  });
  $("brief-copy").addEventListener("click", async () => {
    if (!edition) return;
    const brief = edition.briefing || {};
    const byId = Object.fromEntries((edition.stories || []).map((s) => [s.id, s]));
    const lines = (brief.points || []).map((p, index) => `${index + 1}. ${p.text}${byId[p.id] ? " " + safeUrl(byId[p.id].url) : ""}`);
    const title = brief.headline || "Today in AI";
    if (await copyText(`${title}\n\n${lines.join("\n")}\n\nvia Glow AI News: ${location.origin}${location.pathname}`)) toast("Briefing copied");
  });

  // A new edition arrives twice a day: check again when the page comes back into view.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !edition) return;
    const next = Date.parse(edition.next_update || "") || 0;
    if (Date.now() > next && Date.now() - lastFetch > 10 * 60 * 1000) load(true);
    else renderMeta();
  });
  window.addEventListener("pagehide", markVisited);
  setInterval(() => {
    if (document.visibilityState === "visible") renderMeta();
  }, 60 * 1000);

  if (window.GlowLocale) {
    window.GlowLocale.apply();
    window.GlowLocale.onChange(() => {
      window.GlowLocale.apply();
      if (edition) renderAll();
    });
  }
  load(false).then(() => {
    // Seen once: next visit, only stories that arrive after now count as new.
    setTimeout(markVisited, 4000);
  });
})();
