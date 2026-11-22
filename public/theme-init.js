// Runs before first paint (external file so a strict CSP can forbid inline scripts).
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('zipora:v1:prefs') || '{}').theme;
    if (t !== 'light' && t !== 'dark') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches && t === 'system' ? 'light' : t === 'system' ? 'dark' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* default dark */ }
})();
