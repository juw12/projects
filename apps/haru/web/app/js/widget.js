// Optional iPhone home-screen widget feed: PocketDex, Haru and Cozy Island share one widget.
//
// Nothing here runs until a widget code is paired. The shared relay script is only fetched when a
// code is already saved in this browser, arrives in the address (?widget=...), or is typed into
// Settings. A snapshot holds counts, today's weather and the scene name, and never diary text,
// photos or place names.

export const SETUP_URL = "https://juw12.github.io/pocketdex/widget/";
const SYNC_URL = "https://juw12.github.io/pocketdex/widget/sync.js";
const CODE_KEY = "juw12.widget.code";
const CODE_PATTERN = /^jw-[0-9a-f]{32}$/;

let loading = null;

function relay() {
  return window.Juw12Widget || null;
}

function stored() {
  try {
    const value = localStorage.getItem(CODE_KEY) || "";
    return CODE_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

/** The paired code, or "" when this browser is not paired. Works before the relay script has loaded. */
export function code() {
  const shared = relay();
  return shared ? shared.code() : stored();
}

/** True when a code is waiting in storage or in the address, so the relay script is worth fetching. */
export function wanted() {
  try {
    return Boolean(localStorage.getItem(CODE_KEY)) || new URLSearchParams(location.search).has("widget");
  } catch {
    return false;
  }
}

/** Fetch the shared relay script once. Resolves to null when it cannot be reached. */
export function load() {
  if (relay()) return Promise.resolve(relay());
  if (!loading) {
    loading = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = SYNC_URL;
      script.async = true;
      script.onload = () => resolve(relay());
      script.onerror = () => {
        loading = null;
        script.remove();
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/** Pair ("jw-...") or unpair (""). Returns "ok", "invalid" or "offline". */
export async function setCode(value) {
  const shared = await load();
  if (!shared) {
    if (value) return "offline";
    // unpairing must work even when the relay script cannot be reached
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {
      // storage unavailable: there is nothing to remove
    }
    return "ok";
  }
  return shared.setCode(value) ? "ok" : "invalid";
}

/** Queue a snapshot. Does nothing while unpaired; unchanged snapshots are dropped by the relay script. */
export function publish(snapshot) {
  const shared = relay();
  if (!shared || !shared.code()) return false;
  return shared.publish("haru", snapshot);
}
