// Browser test suite for Rewind. Injected into a copy of index.html by run-ui-tests.ps1.
(async () => {
  const results = [];
  const resultsElement = document.getElementById("results");
  // Report progress after every check (to the page and to the test server),
  // so a stalled run still shows how far it got.
  const report = (status) => {
    const text = "RESULTS\n" + results.join("\n") + "\n" + status;
    resultsElement.textContent = text;
    fetch("/__results", { method: "POST", body: text }).catch(() => {});
  };
  const log = (name, ok, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
    report("RUNNING");
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.documentElement;
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  try {
    await window.rewindReady;
    localStorage.clear();
    await store.reset();
    await refreshShows();
    await wait(500);

    // --- Core features (carried over) ---
    log("local mode makes no CDN request", typeof window.supabase === "undefined" && !document.querySelector('script[src*="supabase"]'));
    log("local mode active", store.mode === "local");
    log("seed cards rendered", document.querySelectorAll(".card").length === 8, document.querySelectorAll(".card").length);
    log("no emoji in page", !/[\u{1F300}-\u{1FAFF}]/u.test(document.body.innerText));

    const showId = await store.addShow({ title: "Test Show", years: "1991–1993", network: "Fox", genre: "Sitcom", status: "unavailable", synopsis: "s", why: "w", theme: "t" });
    let duplicateBlocked = false;
    try {
      await store.addShow({ title: "test show" });
    } catch (error) {
      duplicateBlocked = Boolean(error.existingId);
    }
    log("duplicate title blocked", duplicateBlocked);

    await openShow(showId);
    await wait(200);
    log("drawer opens", modalBackground.classList.contains("open"));
    log("route is #/show/<id>", location.hash === `#/show/${showId}`, location.hash);

    const memoryForm = document.getElementById("memoryForm");
    memoryForm.author.value = "Ana";
    memoryForm.text.value = "Watched it every Friday <b>with</b> grandma";
    memoryForm.requestSubmit();
    await wait(300);
    document.getElementById("rememberBtn").click();
    await wait(300);
    document.getElementById("shelfBtn").click();
    await wait(300);
    const quoteForm = document.getElementById("quoteForm");
    quoteForm.quote.value = "Did I do that?";
    quoteForm.requestSubmit();
    await wait(300);
    const statusSelect = document.getElementById("statusEdit");
    statusSelect.value = "physical";
    statusSelect.dispatchEvent(new Event("change"));
    await wait(300);

    const detail = await store.getShow(showId);
    log("memory saved", detail.memories.length === 1 && detail.memories[0].author === "Ana");
    log("remember counted", detail.rememberCount === 1 && detail.remembered);
    log("on shelf", detail.onShelf);
    log("quote saved", detail.quotes.length === 1);
    log("status updated", detail.status === "physical");
    log("html escaped in drawer", !document.querySelector("#modal .memory b") && document.getElementById("modal").innerHTML.includes("&lt;b&gt;"));
    log("share button present", Boolean(document.getElementById("shareBtn")));

    // --- Routing ---
    history.back();
    await wait(400);
    log("back button closes drawer", !modalBackground.classList.contains("open") && location.hash === "#/browse", location.hash);

    history.replaceState(null, "", `#/show/${showId}`);
    await applyRoute();
    await wait(200);
    log("deep link opens series", modalBackground.classList.contains("open") && openShowId === showId);
    closeModal();
    await wait(400);
    log("close after deep link returns to view", !modalBackground.classList.contains("open") && location.hash === "#/browse", location.hash);

    document.querySelector('nav button[data-view="shelf"]').click();
    await wait(300);
    log("shelf view shows 1", document.querySelectorAll(".card").length === 1);
    log("shelf route", location.hash === "#/shelf");
    document.querySelector('nav button[data-view="feed"]').click();
    await wait(300);
    log("feed shows memory", document.querySelectorAll(".feed .memory").length === 1);
    document.querySelector('nav button[data-view="browse"]').click();
    await wait(300);
    const search = document.getElementById("search");
    search.value = "wonder";
    search.dispatchEvent(new Event("input"));
    await wait(300);
    log("search filters", document.querySelectorAll(".card").length === 1);
    log("result count text", document.querySelector(".result-count").textContent.trim() === "1 result");
    filters.query = "";
    document.getElementById("addShowBtn").click();
    await wait(200);
    log("add dialog opens", modalBackground.classList.contains("is-dialog") && Boolean(document.getElementById("addForm")));
    closeModal();
    await wait(200);

    // --- Settings page ---
    await setView("settings");
    await wait(200);
    log("settings page renders 5 groups", document.querySelectorAll(".settings-card").length === 5, document.querySelectorAll(".settings-card").length);
    log("settings route", location.hash === "#/settings");

    document.querySelector('.segmented[data-setting="theme"] button[data-value="dark"]').click();
    await wait(150);
    const darkBackground = cssVar("--bg");
    log("dark theme applied", root.dataset.theme === "dark" && darkBackground === "#0b0b0d", darkBackground);

    document.querySelector('.segmented[data-setting="theme"] button[data-value="light"]').click();
    await wait(150);
    const lightBackground = cssVar("--bg");
    log("light theme applied", root.dataset.theme === "light" && lightBackground === "#f6f4ef", lightBackground);
    log("theme persisted", JSON.parse(localStorage.getItem("rewind-settings-v1")).theme === "light");
    log("theme-color meta updated", document.querySelector('meta[name="theme-color"]').content === "#f6f4ef");

    document.getElementById("themeToggle").click();
    await wait(150);
    log("quick toggle switches to dark", root.dataset.theme === "dark" && settings.theme === "dark");

    document.querySelector('.swatch[data-accent="teal"]').click();
    await wait(150);
    log("accent applied", root.dataset.accent === "teal" && cssVar("--accent") === "#4fbfae", cssVar("--accent"));

    document.querySelector('.segmented[data-setting="density"] button[data-value="compact"]').click();
    document.querySelector('.segmented[data-setting="textSize"] button[data-value="large"]').click();
    await wait(150);
    log("density + text size applied", root.dataset.density === "compact" && root.dataset.textSize === "large");

    const motionSwitch = document.querySelector('input[data-setting="reduceMotion"]');
    motionSwitch.checked = true;
    motionSwitch.dispatchEvent(new Event("change"));
    await wait(150);
    log("reduce motion applied", root.dataset.motion === "reduced");

    const sortSelect = document.querySelector('select[data-setting="defaultSort"]');
    sortSelect.value = "newest";
    sortSelect.dispatchEvent(new Event("change"));
    await wait(150);
    log("default sort applied", filters.sort === "newest" && settings.defaultSort === "newest");

    const profileForm = document.getElementById("profileForm");
    profileForm.displayName.value = "Juwen";
    profileForm.requestSubmit();
    await wait(200);
    log("display name saved", store.user.name === "Juwen");

    // Hide-streaming filter
    const wonder = store.data.shows.find((show) => show.title === "The Wonder Years");
    await store.updateStatus(wonder.id, "streaming");
    const hideSwitch = document.querySelector('input[data-setting="hideStreaming"]');
    hideSwitch.checked = true;
    hideSwitch.dispatchEvent(new Event("change"));
    await setView("browse");
    await wait(300);
    log("hide-streaming filter", document.querySelectorAll(".card").length === 8, document.querySelectorAll(".card").length);

    // Keyboard shortcut
    await setView("settings");
    await wait(200);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    await wait(400);
    log("'/' jumps to search", currentView === "browse" && document.activeElement?.id === "search");

    // Reset settings
    resetSettings();
    await wait(150);
    log("reset settings", settings.theme === "system" && settings.accent === "gold" && !settings.hideStreaming && root.dataset.density === "comfortable");

    // Persistence & migration
    const reloaded = new LocalStore();
    log("persists in localStorage", reloaded.data.shows.length === 9);
    localStorage.setItem("rewind-data-v1", JSON.stringify({ shows: [{ id: "x", title: "Old", quotes: ["hi"], memories: [], remembers: 2 }], shelf: [], remembered: [] }));
    const legacy = new LocalStore();
    log("v1 data migrates", legacy.data.shows[0].quotes[0].text === "hi");

    // Online-mode fallback and guard rails (Supabase client stubbed; no network needed)
    const cloudConfig = { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "test-key" };
    log("falls back to local if Supabase is unreachable", createStore(cloudConfig).mode === "local");
    window.supabase = { createClient: () => ({ auth: {} }) };
    const cloud = new CloudStore(cloudConfig);
    log("cloud store constructs", cloud.mode === "cloud" && cloud.user === null);
    let blocked = false;
    try {
      await cloud.addMemory("x", "a", "b");
    } catch (error) {
      blocked = /sign in/i.test(error.message);
    }
    log("cloud writes need sign-in", blocked);
    delete window.supabase;
  } catch (error) {
    results.push("ERROR " + error.stack);
  }

  localStorage.clear();
  report("DONE");
})();
