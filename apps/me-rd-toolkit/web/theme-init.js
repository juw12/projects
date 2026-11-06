// Applies the saved light/dark theme before first paint (moved out of index.html for CSP).
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem("meRd.v2") || "{}").theme;
    var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
})();
