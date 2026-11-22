// Library > Saved: the docs saved in this browser (public/theme.js keeps the list), newest first, as doc rows.
// Runs right after the empty list, before the first paint. All text goes in with textContent. When something is
// saved, the current id list (random-ids.json) and merged ids (moved-ids.json) are fetched once: merged docs follow
// their new id, removed docs are dropped quietly. Offline or a failed fetch: the list stays as it is.
(function () {
  var S = window.siteSaved;
  var sec = document.getElementById('saved');
  if (!S || !sec) return;
  var ul = sec.querySelector('[data-saved-list]');
  var tpl = sec.querySelector('template[data-saved-row]');
  var empty = sec.querySelector('.sv-emp');
  if (!ul || !tpl || !tpl.content) return;

  function num(n) {
    n = Number(n) || 0;
    if (n <= 0) return '';
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (n < 1e6) return Math.round(n / 1000) + 'k';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  function span(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function render(list) {
    ul.textContent = '';
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      var li = tpl.content.firstElementChild.cloneNode(true);
      li.setAttribute('data-id', x.id);
      var a = li.querySelector('a');
      a.href = '/items/' + encodeURIComponent(x.id) + '/';
      a.querySelector('.t').textContent = String(x.ti || x.id);
      var m = a.querySelector('.m');
      if (x.k) m.appendChild(span(String(x.k), 'k'));
      if (x.s) m.appendChild(span(String(x.s)));
      if (x.b) m.appendChild(span(String(x.b)));
      if (!m.firstChild) m.appendChild(span('\u00a0'));
      a.querySelector('.n').textContent = num(x.w);
      li.querySelector('.sv-x').setAttribute('aria-label', 'Remove ' + String(x.ti || x.id));
      ul.appendChild(li);
    }
    S.mark(list);
  }
  render(S.read());

  ul.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.sv-x') : null;
    if (!b) return;
    var li = b.closest('li');
    var id = li && li.getAttribute('data-id');
    var next = li && (li.nextElementSibling || li.previousElementSibling);
    var nextId = next && next.getAttribute('data-id');
    var list = S.read().filter(function (x) { return x.id !== id; });
    if (!S.write(list)) return;
    render(list);
    // Keep the keyboard place: the next row's remove button, else the empty line.
    var to = nextId && ul.querySelector('li[data-id="' + (window.CSS && CSS.escape ? CSS.escape(nextId) : nextId) + '"] .sv-x');
    (to || empty).focus();
  });
  window.addEventListener('storage', function (ev) {
    if (ev.key === S.key || ev.key === null) render(S.read());
  });

  if (!S.read().length || !window.fetch || !window.Promise) return;
  function json(u) {
    return fetch(u).then(function (r) {
      if (!r.ok) throw new Error(u);
      return r.json();
    });
  }
  Promise.all([json('/random-ids.json'), json('/moved-ids.json')]).then(function (r) {
    if (!Array.isArray(r[0]) || !r[0].length) return;
    var ids = {};
    for (var i = 0; i < r[0].length; i++) ids[r[0][i]] = 1;
    var moved = r[1] && typeof r[1] === 'object' ? r[1] : {};
    var list = S.read();
    var out = [];
    var seen = {};
    var changed = false;
    for (var j = 0; j < list.length; j++) {
      var x = list[j];
      var id = ids[x.id] === 1 ? x.id : typeof moved[x.id] === 'string' && ids[moved[x.id]] === 1 ? moved[x.id] : null;
      if (!id || seen[id]) { changed = true; continue; }
      seen[id] = 1;
      if (id !== x.id) {
        changed = true;
        x = { id: id, t: x.t, ti: x.ti, k: x.k, s: x.s, b: x.b, w: x.w };
      }
      out.push(x);
    }
    if (changed && S.write(out)) render(out);
  }).catch(function () {});
})();
