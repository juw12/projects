/* Apply appearance before the first paint. No account or network access is needed. */
(function () {
  "use strict";
  const KEY = "trade-twin-theme"; // legacy key kept so the saved theme survives the rename
  const choices = ["system", "light", "dark"];
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "dark"; // 1.9 Premium is dark-first; System/Light stay one tap away
  try {
    const saved = localStorage.getItem(KEY);
    if (choices.includes(saved)) {
      preference = saved;
    }
  } catch (error) {
    // Themes still work for this page if browser storage is blocked.
  }

  function apply() {
    const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = resolved === "dark" ? "#0b0f14" : "#f4f7fb";
    }
    const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (statusBar) {
      statusBar.content = resolved === "dark" ? "black-translucent" : "default";
    }
    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      const selected = button.dataset.themeChoice === preference;
      button.classList.toggle("on", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    window.dispatchEvent(new CustomEvent("tt-theme-change", { detail: { preference, resolved } }));
  }

  window.TwinTheme = {
    preference: () => preference,
    resolved: () => document.documentElement.dataset.theme,
    set(value) {
      if (!choices.includes(value)) {
        return;
      }
      preference = value;
      try {
        localStorage.setItem(KEY, value);
      } catch (error) {
        // Current-page preference remains usable.
      }
      apply();
    },
  };
  const deviceThemeChanged = () => {
    if (preference === "system") {
      apply();
    }
  };
  if (media.addEventListener) {
    media.addEventListener("change", deviceThemeChanged);
  } else if (media.addListener) {
    media.addListener(deviceThemeChanged);
  }
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      preference = choices.includes(event.newValue) ? event.newValue : "dark";
      apply();
    }
  });
  apply();
})();
