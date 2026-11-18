// GlowFounder studio inside its Glow page: take the host page's theme before first paint and follow it
// when it changes. Opened on its own, the studio keeps its light theme.
(function () {
  if (window.parent === window) return;
  var root = document.documentElement;
  root.classList.add("embedded");
  try {
    var host = window.parent.document.documentElement;
    var follow = function () { root.dataset.theme = host.dataset.theme === "dark" ? "dark" : "light"; };
    follow();
    new MutationObserver(follow).observe(host, { attributes: true, attributeFilter: ["data-theme"] });
  } catch (error) {
    // Another site's page: its document is out of reach, so the studio keeps its own light theme.
  }
})();
