/* global document, location, localStorage, window */
// Runs before the page paints, so a dark-theme user never sees a white flash. Must match
// src/lib/theme.ts (key "dp-theme": "light" | "dark", absent = follow the device). Staff pages
// (/admin) stay light. External file, not inline, so the strict Content-Security-Policy allows it.
(function () {
  try {
    if (location.pathname.indexOf('/admin') === 0) return;
    var pref = localStorage.getItem('dp-theme');
    var dark =
      pref === 'dark' ||
      (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      // Until the stylesheet loads, system colours (Canvas) already render dark.
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch {
    // Storage blocked: start light, the app corrects it once it loads.
  }
})();
