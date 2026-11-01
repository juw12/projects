/**
 * Vertex embed mode — runtime guard + theme postMessage listener.
 * Inert unless ?embed=1 is present in the URL.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (params.get('embed') !== '1') return;

  // Ensure class + initial theme are set (inline guard in <head> handles this
  // before paint; this is a safety net in case the guard was missed).
  document.documentElement.classList.add('merd-embed');
  var t = params.get('theme') || 'light';
  document.documentElement.dataset.merdTheme = t;

  // Listen for theme updates from the ME R&D Toolkit parent frame.
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== 'merd:theme') return;
    if (d.theme === 'light' || d.theme === 'dark') {
      document.documentElement.dataset.merdTheme = d.theme;
      // Best-effort: re-render 3D canvases with the new palette.
      if (window.VertexView && typeof window.VertexView.updateTheme === 'function') {
        window.VertexView.updateTheme();
      }
    }
  });
})();
