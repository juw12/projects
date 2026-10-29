/* Hazel home: offer "Continue in …" for the Hazel app you used last (set by hazel-switch.js). */
(function () {
  "use strict";

  var NAMES = { shorts: "Hazel Shorts", sped: "Hazel Sped", long: "Hazel Long" };
  var box = document.getElementById("continue");
  if (!box) {
    return;
  }
  var last = null;
  try {
    last = JSON.parse(localStorage.getItem("hazel.lastBranch") || "null");
  } catch (err) {
    last = null;
  }
  if (!last || !NAMES[last.branch]) {
    return;
  }
  var page = String(last.page || "").replace(/[^a-z0-9._-]/gi, "");
  if (!/^[a-z0-9_-]*(\.html)?$/i.test(page)) {
    page = "";
  }
  var link = document.getElementById("continue-link");
  link.href = last.branch + "/" + page;
  link.textContent = "Continue in " + NAMES[last.branch] + " →";
  document.getElementById("continue-text").textContent =
    "You were last in " + NAMES[last.branch] + ". Your work there is saved in this browser.";
  box.hidden = false;
})();
