// Language modes for the web prototypes — mirrors ios/Shared/Language.swift.
// duo = 日本語 · 한국어 side by side (signature look); en / ja / ko = single language.

export const MODES = [
  { id: "duo", label: "日·한" },
  { id: "en", label: "EN" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
];

const STORAGE_KEY = "haru.lang";

export function currentMode() {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (MODES.some((mode) => mode.id === fromUrl)) {
    return fromUrl;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  if (MODES.some((mode) => mode.id === stored)) {
    return stored;
  }
  const system = (navigator.language || "en").toLowerCase();
  return system.startsWith("ja") || system.startsWith("ko") ? "duo" : "en";
}

/** phrase = { ja, ko, en } → text for the mode ("はれ · 맑음", "clear", ...). */
export function t(phrase, mode = currentMode()) {
  if (typeof phrase === "string") {
    return phrase;
  }
  switch (mode) {
    case "en":
      return phrase.en;
    case "ja":
      return phrase.ja;
    case "ko":
      return phrase.ko;
    default:
      return `${phrase.ja} · ${phrase.ko}`;
  }
}

/** Compact form for tight spots: duo shows only Japanese. */
export function short(phrase, mode = currentMode()) {
  return mode === "duo" ? phrase.ja : t(phrase, mode);
}

/** Font class for a piece of text in a given language. */
export function scriptClass(lang) {
  return lang === "ko" ? "ko" : lang === "en" ? "en" : "ja";
}

/** Small pill switcher; changing mode reloads with ?lang= so every string re-renders. */
export function mountLanguageSwitch(container) {
  const mode = currentMode();
  container.classList.add("lang-switch");
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Language");
  for (const option of MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(option.id === mode));
    button.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEY, option.id);
      const url = new URL(location.href);
      url.searchParams.set("lang", option.id);
      location.href = url.toString();
    });
    container.appendChild(button);
  }
  document.documentElement.lang = mode === "duo" ? "ja" : mode;
}

export const LANG_SWITCH_CSS = `
  .lang-switch { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px;
    background: rgba(255, 250, 241, 0.85); border: 1px solid rgba(176, 122, 90, 0.2); }
  .lang-switch button { font: inherit; font-size: 11px; color: #9a8f93; background: none; border: 0;
    padding: 4px 9px; border-radius: 999px; cursor: pointer; }
  .lang-switch button[aria-pressed="true"] { background: #e8875a; color: #fff; }
`;
