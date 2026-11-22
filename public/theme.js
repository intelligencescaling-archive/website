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
  if (!/^\/items\/[^/]+\/read\/(?:\d+\/)?$/.test(location.pathname)) return;
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

// Save for later. A list in this browser only (localStorage "saved", newest first): doc id, time saved and the row
// text the Library shows ({ id, t, ti, k, s, b, w }). No account, nothing is sent anywhere. Runs before the first
// paint, so the Save buttons already show the right state and the Library keeps room for its rows (no jump).
// Storage blocked (private mode, site data off): html.nostore hides the buttons and the Saved list.
(function () {
  var KEY = 'saved';
  var MAX = 500;
  var root = document.documentElement;
  var ok = true;
  try {
    localStorage.getItem(KEY);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    root.classList.add('nostore');
    return;
  }
  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(v)) return [];
      var out = [];
      for (var i = 0; i < v.length; i++) if (v[i] && typeof v[i].id === 'string' && v[i].id) out.push(v[i]);
      return out;
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    try {
      if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
      else localStorage.removeItem(KEY);
      return true;
    } catch (e) {
      return false;
    }
  }
  var m = /^\/items\/([^/]+)\/(?:read\/(?:\d+\/)?)?$/.exec(location.pathname);
  var here = m ? m[1] : null;
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }
  // State on <html>: data-saved (this doc is saved), data-has-saved (the list isn't empty), --svn (its length).
  function mark(list) {
    list = list || read();
    if (here && find(list, here) >= 0) root.setAttribute('data-saved', '');
    else root.removeAttribute('data-saved');
    if (list.length) root.setAttribute('data-has-saved', '');
    else root.removeAttribute('data-has-saved');
    root.style.setProperty('--svn', String(list.length));
    var bs = document.querySelectorAll('[data-save]');
    for (var j = 0; j < bs.length; j++) bs[j].setAttribute('aria-pressed', String(find(list, bs[j].getAttribute('data-save')) >= 0));
  }
  function row(b, t) {
    var d = b.dataset;
    return { id: d.save, t: t, ti: d.ti || d.save, k: d.k || '', s: d.s || '', b: d.b || '', w: Number(d.w) || 0 };
  }
  mark();
  window.siteSaved = { key: KEY, read: read, write: write, mark: mark };
  document.addEventListener('DOMContentLoaded', function () {
    var list = read();
    mark(list);
    // A saved doc's row text follows the doc page (titles and bylines get corrected).
    var b = document.querySelector('[data-save][data-ti]');
    var i = b ? find(list, b.getAttribute('data-save')) : -1;
    if (i >= 0) {
      var fresh = row(b, list[i].t);
      if (JSON.stringify(fresh) !== JSON.stringify(list[i])) {
        list[i] = fresh;
        write(list);
      }
    }
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-save]') : null;
      if (!t) return;
      var cur = read();
      var k = find(cur, t.getAttribute('data-save'));
      if (k >= 0) cur.splice(k, 1);
      else cur.unshift(row(t, Date.now()));
      if (write(cur)) mark(cur);
    });
  });
  // Saved or removed in another tab.
  window.addEventListener('storage', function (ev) {
    if (ev.key === KEY || ev.key === null) mark();
  });
})();
