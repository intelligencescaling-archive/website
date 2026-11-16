// Light/dark mode. Loaded in <head> before the page paints, so a saved choice never flashes.
// No choice saved = follow the device setting. A choice that matches the device setting is not
// saved, so the site goes back to following the device. Stored only in this browser.
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
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
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', dark ? '#121212' : '#ffffff');
    var b = document.getElementById('theme-toggle');
    if (b) {
      var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  }
  function apply(t) {
    if (t) root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    sync();
  }

  apply(saved());
  if (media && media.addEventListener) media.addEventListener('change', sync);

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('theme-toggle');
    if (!b) return;
    b.hidden = false;
    sync();
    b.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      var keep = next === system() ? null : next;
      try {
        if (keep) localStorage.setItem(KEY, keep);
        else localStorage.removeItem(KEY);
      } catch (e) {}
      apply(keep);
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
