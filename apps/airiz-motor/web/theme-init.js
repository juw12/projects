// Applies the saved theme before first paint (moved out of index.html for CSP).
(function() {
  try {
    var theme = localStorage.getItem('airiz.theme');
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (error) {
    // Keep the default theme if storage is unavailable.
  }
})();
