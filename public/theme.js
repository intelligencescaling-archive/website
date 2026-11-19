// Light/dark mode. Loaded in <head> before the page paints, so a saved choice never flashes.
// No choice saved = follow the device setting. A choice that matches the device setting is not
// saved, so the site goes back to following the device. Stored only in this browser.
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
  // Lets the CSS hide script-only controls (sort, "All N" buttons) when JavaScript is off.
  root.classList.add('js');
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      var t = localStorage.getItem(KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) {
      return null;
    }
  }
  function system() {
    return media && media.matches ? 'dark' : 'light';
  }
  function current() {
    return root.getAttribute('data-theme') || system();
  }
  function sync() {
    var dark = current() === 'dark';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', dark ? '#0e0e10' : '#fcfcfc');
    var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    var bs = document.querySelectorAll('[data-toggle-theme]');
    for (var j = 0; j < bs.length; j++) { bs[j].setAttribute('aria-label', label); bs[j].title = label; }
    // The phone menu's Dark / Light tabs.
    var ts = document.querySelectorAll('[data-theme-set]');
    for (var k = 0; k < ts.length; k++) ts[k].setAttribute('aria-pressed', String(ts[k].getAttribute('data-theme-set') === current()));
  }
  function apply(t) {
    if (t) root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    sync();
  }

  apply(saved());
  if (media && media.addEventListener) media.addEventListener('change', sync);
  // For the reader view's theme picker (src/scripts/reader.js): same rules as the toggle.
  window.siteTheme = {
    current: current,
    set: function (t) { choose(t); },
  };

  function choose(next) {
    var keep = next === system() ? null : next;
    try {
      if (keep) localStorage.setItem(KEY, keep);
      else localStorage.removeItem(KEY);
    } catch (e) {}
    apply(keep);
  }
  document.addEventListener('DOMContentLoaded', function () {
    sync();
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-toggle-theme], [data-theme-set]') : null;
      if (!t) return;
      choose(t.hasAttribute('data-theme-set') ? t.getAttribute('data-theme-set') : current() === 'dark' ? 'light' : 'dark');
    });
  });
})();

// Search page opened with words or filters in the URL: hide the full list until the search script
// has applied them, so the page doesn't show 1,215 entries and then jump. Shown again after 4 s
// in case the script fails.
(function () {
  var root = document.documentElement;
  if (location.pathname !== '/search/' || !location.search) return;
  root.classList.add('search-pending');
  setTimeout(function () {
    root.classList.remove('search-pending');
  }, 4000);
})();

// Reader view (/items/<id>/read/): apply the saved text settings before the page paints, so the
// text doesn't jump or flash when src/scripts/reader.js loads. Keys and values are checked there too.
(function () {
  if (!/^\/items\/[^/]+\/read\/$/.test(location.pathname)) return;
  var root = document.documentElement;
  var s = null;
  try {
    s = JSON.parse(localStorage.getItem('reader') || 'null');
  } catch (e) {}
  if (!s || typeof s !== 'object') return;
  if (s.size >= 15 && s.size <= 24) root.setAttribute('data-rsize', String(Math.round(s.size)));
  if (s.lh === 'tight' || s.lh === 'loose') root.setAttribute('data-rlh', s.lh);
  if (s.w === 'narrow' || s.w === 'wide') root.setAttribute('data-rw', s.w);
  if (s.sepia === true) root.setAttribute('data-reader', 'sepia');
})();
