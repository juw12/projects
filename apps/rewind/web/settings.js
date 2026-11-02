// User preferences for Rewind: appearance and browsing defaults.
// Stored per device in localStorage and applied as data-* attributes on <html>,
// which styles.css uses to switch theme, accent, text size, density and motion.

const SETTINGS_KEY = "rewind-settings-v1";

const DEFAULT_SETTINGS = {
  theme: "system", // "system" | "light" | "dark"
  accent: "gold", // key of ACCENTS
  textSize: "default", // "default" | "large"
  density: "comfortable", // "comfortable" | "compact"
  reduceMotion: false,
  startView: "browse", // "browse" | "shelf" | "feed"
  defaultSort: "title", // "title" | "oldest" | "newest" | "loved"
  hideStreaming: false, // hide series already marked "Streaming somewhere"
};

// Each accent is tuned separately for contrast on dark and light backgrounds.
const ACCENTS = {
  gold: { label: "Gold", dark: "#d6a75c", light: "#9c6b1e" },
  rose: { label: "Rose", dark: "#e27d86", light: "#b4434f" },
  teal: { label: "Teal", dark: "#4fbfae", light: "#17806f" },
  blue: { label: "Blue", dark: "#7aa2f7", light: "#2f5fc4" },
};

const THEME_COLORS = {
  dark: "#0b0b0d",
  light: "#f6f4ef",
};

const systemLightQuery = window.matchMedia("(prefers-color-scheme: light)");

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    if (!ACCENTS[merged.accent]) {
      merged.accent = DEFAULT_SETTINGS.accent;
    }
    return merged;
  } catch (error) {
    console.warn("Could not read settings, using defaults", error);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function resolveTheme(theme) {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return systemLightQuery.matches ? "light" : "dark";
}

function applySettings(settings) {
  const root = document.documentElement;
  const theme = resolveTheme(settings.theme);
  root.dataset.theme = theme;
  root.dataset.accent = settings.accent;
  root.dataset.textSize = settings.textSize;
  root.dataset.density = settings.density;
  root.dataset.motion = settings.reduceMotion ? "reduced" : "full";

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", THEME_COLORS[theme]);
  }
  return theme;
}

// Calls onChange when the device switches between light and dark.
function watchSystemTheme(onChange) {
  systemLightQuery.addEventListener("change", onChange);
}
