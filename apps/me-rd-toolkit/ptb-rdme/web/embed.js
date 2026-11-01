/* PTB RDME — ME R&D Toolkit embed mode */
(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get("embed") !== "1") return;

  var theme = params.get("theme") || "light";
  document.documentElement.classList.add("merd-embed");
  document.documentElement.dataset.merdTheme = theme;

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== "merd:theme") return;
    if (e.data.theme === "light" || e.data.theme === "dark") {
      document.documentElement.dataset.merdTheme = e.data.theme;
    }
  });
})();
