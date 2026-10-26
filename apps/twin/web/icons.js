/* Twin icon system: one consistent line-icon set (24px grid, currentColor strokes).
 *
 * TwinIcons.svg(name) returns an <svg class="ico"> element for new UI code.
 * Older screens still write emoji into labels; a MutationObserver swaps each decorative
 * emoji for the matching line icon (or removes it when there is no sensible match), so the
 * whole app shares one visual language without rewriting every screen. Country flags,
 * check marks and arrows are typographic and stay as text. Inputs and code are untouched.
 */
"use strict";

const TwinIcons = (() => {
  const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  const P = (d) => `<path d="${d}"/>`;
  const R = (x, y, w, hgt, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${rx}"/>`;
  const SHAPES = {
    home: P("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"),
    trend: P("M3 17l6-6 4 4 8-8") + P("M14 7h7v7"),
    zap: P("M13 2 4 14h7l-1 8 9-12h-7z"),
    cap: P("M2 9l10-5 10 5-10 5z") + P("M6 11v5c3 2 9 2 12 0v-5") + P("M22 9v5"),
    news: P("M4 5h13v14H6a2 2 0 0 1-2-2z") + P("M17 8h3v9a2 2 0 0 1-2 2") + P("M7 9h7M7 13h7M7 16h4"),
    user: C(12, 8, 4) + P("M4 21c1-4 4-6 8-6s7 2 8 6"),
    bot: R(4, 8, 16, 12, 3) + P("M12 4v4M9 13v1.5M15 13v1.5M9.5 17.5h5M2 13v3M22 13v3") + C(12, 3.5, 0.6),
    rewind: P("M11 6 4 12l7 6z") + P("M20 6l-7 6 7 6z"),
    target: C(12, 12, 9) + C(12, 12, 5) + C(12, 12, 1),
    globe: C(12, 12, 9) + P("M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"),
    sparkles: P("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z") + P("M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"),
    bell: P("M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z") + P("M10 20a2 2 0 0 0 4 0"),
    compass: C(12, 12, 9) + P("M15.5 8.5l-2 5-5 2 2-5z"),
    flask: P("M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10"),
    briefcase: R(3, 7, 18, 13) + P("M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"),
    award: C(12, 9, 6) + P("M8.5 14 7 21l5-3 5 3-1.5-7"),
    search: C(11, 11, 7) + P("M20 20l-4-4"),
    phone: R(7, 2, 10, 20) + P("M11 18h2"),
    shield: P("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"),
    alert: P("M12 3 2 20h20z") + P("M12 9v5M12 17h.01"),
    save: P("M5 3h11l3 3v15H5z") + P("M8 3v5h7V3M8 21v-7h8v7"),
    flame: P("M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 1.5 2 1.5 3 0-4 .5-5 1.5-7z"),
    bars: P("M4 20h16M7 16v-5M12 16V6M17 16v-8"),
    sprout: P("M12 21V11M12 11C12 7 9 5 5 5c0 4 3 6 7 6zM12 13c0-3 2-5 6-5 0 3-2 5-6 5z"),
    tree: P("M12 21v-5M12 3l6 8h-3l4 5H5l4-5H6z"),
    scale: P("M12 3v18M6 21h12M4 8h16M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z"),
    book: P("M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10"),
    rocket: P("M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3c1-4 5-8 12-9-1 7-5 11-9 12z") + C(14.5, 9.5, 1),
    bank: P("M3 9l9-6 9 6zM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18"),
    close: P("M6 6l12 12M18 6 6 18"),
    ticket: P("M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10"),
    ban: C(12, 12, 9) + P("M6 6l12 12"),
    lock: R(5, 11, 14, 10) + P("M8 11V8a4 4 0 0 1 8 0v3"),
    skip: P("M5 5l10 7-10 7zM19 5v14"),
    up: P("M7 17 17 7M8 7h9v9"),
    down: P("M7 7l10 10M17 8v9H8"),
    chevron: P("M9 6l6 6-6 6"),
    check: P("M5 12l5 5 9-10"),
    info: C(12, 12, 9) + P("M12 11v5M12 8h.01"),
    layers: P("M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"),
    pulse: P("M3 12h4l2-6 4 12 2-6h6"),
    clock: C(12, 12, 9) + P("M12 7v5l3 2"),
    gift: R(3, 8, 18, 4, 1) + P("M5 12v9h14v-9M12 8v13M12 8C9 8 7 6 8.5 4.5S12 6 12 8zM12 8c3 0 5-2 3.5-3.5S12 6 12 8z"),
    share: C(18, 5, 2.5) + C(6, 12, 2.5) + C(18, 19, 2.5) + P("M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6"),
    settings: C(12, 12, 3) + P("M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"),
  };
  // Decorative emoji in legacy labels → line icon (null removes the emoji).
  const EMOJI = {
    "🏠": "home", "📈": "trend", "⚡": "zap", "🎓": "cap", "📰": "news", "👤": "user", "🤖": "bot",
    "⏪": "rewind", "🎯": "target", "🌍": "globe", "🌎": "globe", "🌏": "globe", "🌐": "globe",
    "🔮": "sparkles", "🎉": "sparkles", "✨": "sparkles", "🔔": "bell", "🧭": "compass", "🧪": "flask",
    "🧑‍💼": "briefcase", "💼": "briefcase", "🧑": "user", "🏅": "award", "🏆": "award", "🔍": "search", "🔎": "search",
    "📱": "phone", "🛡": "shield", "⚠": "alert", "💾": "save", "🔥": "flame", "📊": "bars", "📉": "bars",
    "🌱": "sprout", "🌳": "tree", "⚖": "scale", "📒": "book", "📚": "book", "📖": "book", "🚀": "rocket",
    "🏦": "bank", "🎫": "ticket", "⛔": "ban", "🔒": "lock", "⏭": "skip", "🐂": "up", "🐻": "down",
    "🦊": "compass", "👋": null, "💡": "info", "⏱": "clock", "⏰": "clock", "🎁": "gift", "🔗": "share",
    "⚙": "settings", "🧠": "layers", "📅": "clock", "💰": "bank", "💵": "bank", "🪙": "bank",
  };
  const PICTO = /\p{Extended_Pictographic}[\uFE0F\u20E3]?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
  const KEEP = new Set(["✓", "✗", "✕", "✔", "★", "☆", "→", "←", "↑", "↓", "↳", "↻", "↺", "©", "®", "™", "‼", "↔"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "CANVAS", "svg", "SVG"]);
  const NS = "http://www.w3.org/2000/svg";

  function svg(name, label) {
    const node = document.createElementNS(NS, "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("class", `ico ico-${name}`);
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", "1.8");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    if (label) {
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", label);
    } else {
      node.setAttribute("aria-hidden", "true");
    }
    node.innerHTML = SHAPES[name] || SHAPES.info;
    return node;
  }

  function lookup(match) {
    const bare = match.replace(/[\uFE0F\u20E3]/g, "");
    if (bare in EMOJI) {
      return EMOJI[bare];
    }
    return bare.includes("\u200D") && bare.split("\u200D").some((part) => EMOJI[part]) ?
      EMOJI[bare.split("\u200D").find((part) => EMOJI[part])] : null;
  }

  function convert(textNode) {
    const parent = textNode.parentNode;
    const value = textNode.nodeValue;
    if (!parent || !value || SKIP.has(parent.nodeName) || !PICTO.test(value)) {
      PICTO.lastIndex = 0;
      return;
    }
    PICTO.lastIndex = 0;
    if (parent.closest && parent.closest("[data-emoji]")) {
      return;
    }
    const plainOnly = parent.nodeName === "OPTION" || parent.nodeName === "TITLE";
    const fragment = document.createDocumentFragment();
    let last = 0;
    let changed = false;
    for (const found of value.matchAll(PICTO)) {
      if (KEEP.has(found[0].replace(/\uFE0F/g, ""))) {
        continue;
      }
      changed = true;
      fragment.append(value.slice(last, found.index));
      const name = lookup(found[0]);
      if (name && !plainOnly) {
        fragment.append(svg(name));
      }
      last = found.index + found[0].length;
      if (value[last] === " ") {
        last += 1; // the icon carries its own spacing
      }
    }
    if (!changed) {
      return;
    }
    fragment.append(value.slice(last));
    parent.replaceChild(fragment, textNode);
  }

  function upgrade(root) {
    if (!root) {
      return;
    }
    if (root.nodeType === Node.TEXT_NODE) {
      convert(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName)) {
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pending = [];
    while (walker.nextNode()) {
      pending.push(walker.currentNode);
    }
    pending.forEach(convert);
  }

  function watch() {
    upgrade(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(upgrade);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (typeof document !== "undefined") {
    if (document.body) {
      watch();
    } else {
      document.addEventListener("DOMContentLoaded", watch);
    }
  }
  return Object.freeze({ svg, upgrade, names: Object.keys(SHAPES) });
})();
