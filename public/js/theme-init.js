// Runs before first paint so there's no flash of the wrong theme: pick a
// saved choice if the user has one, otherwise follow the OS/browser
// preference. The toggle in the header (public/js/theme.js) updates the
// saved choice from then on. A separate file (not an inline <script>) so
// it runs under CSP's script-src 'self' without needing 'unsafe-inline'.
(function () {
  var saved = localStorage.getItem('stoch-theme');
  var theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
})();
