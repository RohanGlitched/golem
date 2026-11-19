/* Sets the saved theme before first paint. Dark is the default. Same storage key as the studio. */
(function () {
  try {
    var t = localStorage.getItem('golem:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: stay dark */ }
})();
