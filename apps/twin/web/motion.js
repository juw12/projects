/* Twin 1.8 motion layer: small, optional interactions on top of the existing UI.
 * - sliding tab indicator under the active tab
 * - header turns to frosted glass once the page scrolls
 * - swipe a sheet down (from its handle or when scrolled to top) to close it
 * - count-up animation for [data-countup] numbers (final text is always exact)
 * - light haptics on supporting phones
 * Everything respects prefers-reduced-motion and never changes ids, text or state. */
(function () {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------------------------------------------- header on scroll */
  function updateHeader() {
    const header = document.querySelector("header.top");
    if (header) {
      header.classList.toggle("scrolled", window.scrollY > 6);
    }
  }
  window.addEventListener("scroll", updateHeader, { passive: true });

  /* ------------------------------------------------ sliding tab indicator */
  function placeInk() {
    const nav = document.querySelector("nav.tabs");
    if (!nav) {
      return;
    }
    let ink = nav.querySelector(".tab-ink");
    if (!ink) {
      ink = document.createElement("span");
      ink.className = "tab-ink";
      ink.setAttribute("aria-hidden", "true");
      nav.prepend(ink);
    }
    const active = nav.querySelector("button.on");
    if (!active) {
      ink.style.width = "0";
      return;
    }
    ink.style.width = active.offsetWidth + "px";
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  /* ------------------------------------------------------------ count-up */
  const counted = new WeakSet();
  function countUp(element) {
    if (counted.has(element)) {
      return;
    }
    counted.add(element);
    const finalText = element.textContent;
    const match = finalText.match(/-?[\d,]+(\.\d+)?/);
    if (!match || reduceMotion.matches) {
      return;
    }
    const target = Number(match[0].replace(/,/g, ""));
    const decimals = (match[1] || "").length - 1;
    if (!Number.isFinite(target) || target === 0) {
      return;
    }
    const prefix = finalText.slice(0, match.index);
    const suffix = finalText.slice(match.index + match[0].length);
    const format = (value) => value.toLocaleString("en-US", {
      minimumFractionDigits: Math.max(decimals, 0),
      maximumFractionDigits: Math.max(decimals, 0),
    });
    const start = performance.now();
    const duration = 650;
    const from = target * 0.92;
    const step = (now) => {
      if (!element.isConnected) {
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        element.textContent = finalText;
        return;
      }
      element.textContent = prefix + format(from + (target - from) * eased) + suffix;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* -------------------------------------------------------------- haptics */
  function buzz(ms) {
    if (navigator.vibrate && !reduceMotion.matches) {
      try {
        navigator.vibrate(ms);
      } catch (error) {
        // Some browsers throw when vibration is blocked; it's only a nicety.
      }
    }
  }
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest(".btn.green, .btn.red, .btn.primary, nav.tabs button, .seg button, .chip");
    if (target) {
      buzz(target.matches(".btn.green, .btn.red") ? 12 : 6);
    }
  }, { passive: true });

  /* ---------------------------------------------------- sheet swipe down */
  let drag = null;
  document.addEventListener("pointerdown", (event) => {
    const sheet = document.getElementById("sheet");
    if (!sheet || !sheet.classList.contains("show") || !sheet.contains(event.target)) {
      return;
    }
    if (event.target.closest("canvas, input, select, textarea, button, a")) {
      return;
    }
    const fromHandle = event.target.closest(".grab") || event.clientY - sheet.getBoundingClientRect().top < 56;
    if (!fromHandle && sheet.scrollTop > 0) {
      return;
    }
    drag = { sheet, startY: event.clientY, dy: 0, started: false, time: performance.now() };
  }, { passive: true });
  document.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }
    drag.dy = Math.max(0, event.clientY - drag.startY);
    if (!drag.started && drag.dy > 8) {
      drag.started = true;
      drag.sheet.classList.add("dragging");
    }
    if (drag.started) {
      drag.sheet.style.transform = `translateY(${drag.dy}px)`;
    }
  }, { passive: true });
  const endDrag = () => {
    if (!drag) {
      return;
    }
    const { sheet, dy, started, time } = drag;
    drag = null;
    sheet.classList.remove("dragging");
    sheet.style.transform = "";
    if (!started) {
      return;
    }
    const velocity = dy / Math.max(1, performance.now() - time);
    if ((dy > 120 || velocity > 0.6) && typeof window.closeSheet === "function") {
      buzz(8);
      window.closeSheet();
    }
  };
  document.addEventListener("pointerup", endDrag, { passive: true });
  document.addEventListener("pointercancel", endDrag, { passive: true });

  /* ------------------------------------------------------------- watchers */
  const observer = new MutationObserver((mutations) => {
    let tabsChanged = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        tabsChanged = tabsChanged || mutation.target.matches("nav.tabs button");
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) {
          continue;
        }
        if (node.matches("nav.tabs") || node.querySelector("nav.tabs")) {
          tabsChanged = true;
        }
        if (node.matches("[data-countup]")) {
          countUp(node);
        }
        node.querySelectorAll("[data-countup]").forEach(countUp);
      }
    }
    if (tabsChanged) {
      requestAnimationFrame(placeInk);
    }
    updateHeader();
  });
  function start() {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    placeInk();
    updateHeader();
  }
  window.addEventListener("resize", () => requestAnimationFrame(placeInk));
  if (document.body) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start);
  }
  window.TwinMotion = { placeInk, countUp, buzz };
})();
