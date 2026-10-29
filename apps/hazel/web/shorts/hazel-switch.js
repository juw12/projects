/* Hazel switcher behaviour: close the menu on outside click / Escape, and remember the last
 * Hazel app so Hazel home can offer "Continue in …". Source: apps/hazel/web/hazel-switch.js
 * (byte-identical copies ship with every branch; tests/test_hazel.py keeps them in sync). */
(function () {
  "use strict";

  var LAST_KEY = "hazel.lastBranch";

  function openSwitches() {
    return Array.prototype.slice.call(document.querySelectorAll("details.hz-switch[open]"));
  }

  document.addEventListener("click", function (event) {
    openSwitches().forEach(function (box) {
      if (!box.contains(event.target)) {
        box.open = false;
      }
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") {
      return;
    }
    openSwitches().forEach(function (box) {
      box.open = false;
      var summary = box.querySelector("summary");
      if (summary) {
        summary.focus();
      }
    });
  });

  var branch = document.documentElement.getAttribute("data-hazel-branch");
  if (branch && branch !== "home") {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ branch: branch, page: location.pathname.split("/").pop() || "", at: Date.now() }));
    } catch (err) {
      /* storage blocked: nothing to remember */
    }
  }
})();
