// The Search page (rules.md 3.3): one place to find things.
// - Empty box: the full list from the HTML, filtered, counted and sorted here (rows are only hidden, shown and
//   reordered; no HTML is built from data).
// - Words typed: name matches (characters, series, authors, tags) in groups, then full-text doc results from
//   Pagefind, with scope tabs. Everything from the index or names.json is inserted as text (textContent); the only
//   markup is the <mark> around matched words, built node by node.
import { createCounter } from './search-counter.js';
import { fitStrip, closePops } from './tabs.js';
import { shortNum } from '../lib/ui.mjs';
import { lengthBucket } from '../lib/length.mjs';

const PAGE = 10;
const BROWSE_PAGE = 50;
const SORTS = { title: { title: 'asc' }, long: { words: 'desc' } };
const SORT_NAMES = { best: 'Best match', long: 'Most words', title: 'A–Z · Words' };
// Name groups: [kind, label, singular, base URL, preview cap, glyph]
const KINDS = [
  ['c', 'Characters', 'character', '/characters/', 3, 'char'],
  ['s', 'Series', 'series', '/series/', 2, 'series'],
  ['a', 'Authors', 'author', '/authors/', 2, 'author'],
  ['g', 'Tags', 'tag', '/tags/', 2, 'tag'],
];
// Filters set only by links: URL param -> [row data key, Pagefind group, names.json kind or inline list].
const LINK_FACETS = {
  series: ['series', 'Series', 's'],
  character: ['chars', 'Character', 'c'],
  author: ['authors', 'Author', 'a'],
  topic: ['topics', 'Topic', 'topic'],
  category: ['cat', 'Category', 'category'],
};
const SPECIAL = { series: { _none: '(No series)' }, author: { _unknown: 'Unknown author' } };

// ---------- Text helpers ----------
const norm = (x) => x.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// Long rules in docs ("— — — —", "-----", "=====") and links are noise in an excerpt.
const isRule = (w) => /^[\p{Pd}_=~*•·─━.]{3,}$/u.test(w) || /^[\p{Pd}_=~*•·─━]$/u.test(w);
const isUrl = (w) => /https?:\/\/|www\.|\.(?:com|org|net|io|gg|be|ly|co)\/|\.(?:com|org|net)\b/i.test(w);
const terms = (q) => norm(q).split(' ').filter((t) => t.length >= 2);

/** True when a word matches a search word: contains it, or shares most of its start ("Ayanokouji" for "ayanokoji"). */
function wordHit(word, ts) {
  const nw = norm(word).replace(/ /g, '');
  if (nw.length < 2) return false;
  for (const t of ts) {
    if (nw.includes(t)) return true;
    if (t.length < 4) continue;
    const need = Math.min(t.length, Math.max(4, Math.ceil(t.length * 0.6)));
    let k = 0;
    while (k < t.length && k < nw.length && t[k] === nw[k]) k++;
    if (k >= need) return true;
  }
  return false;
}

/**
 * True when a result really contains the searched words. Pagefind also returns loose matches (for "qxjvbzqk" it
 * finds "Qx4" and bits of URLs); a matched word counts only when it is not part of a link and shares most of its
 * start with a search word. Search words shorter than 4 letters are trusted as they are.
 */
function strongMatch(d, query) {
  const ts = terms(query).filter((t) => t.length >= 4);
  if (!ts.length) return true;
  const words = (d.content || '').split(/\s+/);
  return (d.locations || []).some((l) => !isUrl(words[l] || '') && wordHit(words[l] || '', ts));
}

/** Appends `text` to `target`, with every word that matches the query in a <mark> (the highlighter band). */
function appendMarked(target, text, ts) {
  for (const part of String(text).split(/(\s+)/)) {
    if (part && !/^\s+$/.test(part) && wordHit(part, ts)) {
      const m = document.createElement('mark');
      m.textContent = part;
      target.append(m);
    } else if (part) target.append(part);
  }
}

/** One line of doc text around the first match (a few words before it), or null when only the metadata matched. */
function excerptOf(d, ts) {
  const words = (d.content || '').split(/\s+/);
  const limit = words.length - Number(d.meta?.hw || 0) - 2;
  const loc = (d.locations || []).find((l) => l < limit && !isUrl(words[l]));
  if (loc === undefined || limit < 1) return null;
  const from = Math.max(0, loc - 3);
  const out = [];
  for (let i = from; i < Math.min(limit, loc + 24); i++) {
    const w = words[i];
    if (isUrl(w)) out.push('(link)');
    else if (isRule(w)) out.push('—');
    else out.push(w);
  }
  return (from > 0 ? '… ' : '') + out.join(' ');
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const SVG = {
  char: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 19.5c.9-3.4 3.4-5 6.5-5s5.6 1.6 6.5 5"/>',
  series: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2 2 0 0 1 2-2h10.5"/>',
  author: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="m12.5 7.5 4 4"/>',
  doc: '<path d="M6.5 3.5h7.5l4 4v13h-11.5z"/><path d="M14 3.5v4h4"/>',
  tag: '<path d="M9 4.5 7.5 19.5M16.5 4.5 15 19.5M5 9h14.5M4.5 15H19"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
};
/** A glyph from the constant set above (never data). */
function glyph(name, size = 20, cls = 'g') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ class: cls, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': size === 20 ? 1.5 : 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, String(v));
  s.innerHTML = SVG[name];
  return s;
}

// ---------- Name matches ----------
function scoreName(name, q, ts) {
  const n = norm(name);
  if (!n) return 0;
  if (n === q) return 100;
  if (q.length >= 3 && n.startsWith(q)) return 70;
  if (q.length >= 3) {
    const words = n.split(' ');
    if (ts.every((t) => words.some((w) => w.startsWith(t)))) return 50;
  }
  return 0;
}
/** All name matches for a query, best first: [{k, name, href, count, sub}]. */
function matchNames(names, query) {
  const q = norm(query);
  if (!names || !q) return [];
  const ts = q.split(' ').filter((t) => t.length >= 2);
  if (!ts.length && q.length < 2) return [];
  const out = [];
  for (const [k, , , base] of KINDS) {
    for (const [name, id, count, sub, aliases, role] of names[k] || []) {
      let best = 0;
      for (const n of [name, ...(aliases || [])]) best = Math.max(best, scoreName(n, q, ts));
      if (best) out.push({ k, name, href: `${base}${id}/`, count, sub: role || sub, score: best });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.count - a.count);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** Up to 3 spellings close to the query, from the names of characters, series and authors (and their words). */
function didYouMean(names, query) {
  const q = norm(query);
  if (!names || q.length < 3) return [];
  const max = Math.max(1, Math.floor(q.length / 4));
  const best = new Map();
  for (const k of ['c', 's', 'a']) {
    for (const [name, , count, , aliases] of names[k] || []) {
      for (const full of [name, ...(aliases || [])]) {
        const n = norm(full);
        const cands = q.includes(' ') ? [n] : [n, ...n.split(' ').filter((w) => w.length >= 4)];
        for (const c of cands) {
          if (c === q) continue;
          const d = lev(q, c, max);
          if (d > max) continue;
          const old = best.get(c);
          if (!old || d < old.d || (d === old.d && count > old.count)) best.set(c, { text: c, d, count: Math.max(count, old?.count || 0) });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => a.d - b.d || b.count - a.count).slice(0, 3);
}
/** The suggestion with the letters that differ from the query marked. */
function markDiff(target, s, q) {
  let a = 0;
  while (a < s.length && a < q.length && s[a] === q[a]) a++;
  let b = 0;
  while (b < s.length - a && b < q.length - a && s[s.length - 1 - b] === q[q.length - 1 - b]) b++;
  const mid = s.slice(a, s.length - b);
  target.append(s.slice(0, a));
  if (mid) target.append(el('mark', { textContent: mid }));
  target.append(s.slice(s.length - b));
}

export async function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('q');
  const clearQ = document.getElementById('clear-q');
  const filtersForm = document.getElementById('filters');
  const boxes = [...filtersForm.querySelectorAll('input[type="checkbox"][data-facet]')];
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const list = document.getElementById('list');
  const moreBtn = document.getElementById('more');
  const docsEnd = document.getElementById('docs-end');
  const active = document.getElementById('active');
  const empty = document.getElementById('empty');
  const groupsBox = document.getElementById('groups');
  const scopeW = document.getElementById('scope-w');
  const scope = document.getElementById('scope');
  const docsSec = document.getElementById('docs-sec');
  const noResults = document.getElementById('no-results');
  const noResultsQ = document.getElementById('no-results-q');
  const dym = document.getElementById('dym');
  const dymList = document.getElementById('dym-list');
  const toggle = document.getElementById('filter-toggle');
  const fcount = document.getElementById('fcount');
  const doneBtn = document.getElementById('sheet-done');
  const clearTop = document.getElementById('clear-filters');
  const sortBtn = document.getElementById('sort-btn');
  const sortPop = document.getElementById('sort-pop');
  const sortItems = [...sortPop.querySelectorAll('[data-ssort]')];
  const facetData = JSON.parse(document.getElementById('facet-data').textContent || '{}');
  const root = document.documentElement;

  // ----- Rows of the full list (browse mode) -----
  const total = Number(list.dataset.total) || list.children.length;
  const keys = ['tags', 'lang', 'origin', 'series', 'chars', 'authors', 'topics', 'cat'];
  const toRows = (lis) =>
    lis.map((li, i) => {
      const sets = {};
      for (const k of keys) sets[k] = new Set((li.dataset[k] || '').split(' ').filter(Boolean));
      const words = Number(li.dataset.w) || 0;
      sets.len = new Set([lengthBucket(words)]);
      return { li, i, sets, words, rank: Number(li.dataset.r) || 0 };
    });
  let rows = toRows([...list.children]);
  let allLoaded = rows.length >= total;
  let allPromise = null;
  function loadAll() {
    if (allLoaded) return Promise.resolve(true);
    if (!allPromise) {
      allPromise = fetch('/search/all/')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((html) => {
          // Our own build output (Astro escapes all archive text); only the list's rows are taken over.
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const all = doc.getElementById('list');
          if (!all) throw new Error('no list');
          const lis = [...all.children].map((li) => document.adoptNode(li));
          list.replaceChildren(...lis);
          rows = toRows(lis);
          allLoaded = true;
          lastSort = 'long';
          return true;
        })
        .catch(() => {
          allPromise = null;
          return false;
        });
    }
    return allPromise;
  }

  // ----- Names (characters, series, authors, tags) and link-only filters -----
  let names = null;
  let namesPromise = null;
  function loadNames() {
    namesPromise ??= fetch('/names.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => (names = j));
    return namesPromise;
  }
  /** link facet -> { v: id, label, pf } (label = pf = the name, from names.json or the inline lists). */
  const links = {};
  function resolveLink(param, raw) {
    const [, , src] = LINK_FACETS[param];
    const v = raw.toLowerCase();
    const special = SPECIAL[param] && Object.entries(SPECIAL[param]).find(([id, n]) => id === v || n.toLowerCase() === v);
    if (special) return { v: special[0], label: special[1], pf: special[1] };
    const list = src.length === 1 ? (names?.[src] || []).map((x) => [x[1], x[0]]) : facetData[src] || [];
    const hit = list.find(([id, n]) => id.toLowerCase() === v || n.toLowerCase() === v);
    return hit ? { v: hit[0], label: hit[1], pf: hit[1] } : null;
  }

  // ----- State from the URL -----
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  for (const b of boxes) {
    const vals = params.getAll(b.name).map((x) => x.toLowerCase());
    const alias = (b.dataset.alias || '').toLowerCase().split('|').filter(Boolean);
    if (vals.some((x) => x === b.value.toLowerCase() || x === b.dataset.label.toLowerCase() || x === b.dataset.pf.toLowerCase() || alias.includes(x))) b.checked = true;
  }
  const linkParams = Object.keys(LINK_FACETS).filter((p) => params.get(p));
  let chosenSort = params.get('sort') === 'short' ? 'long' : ['best', 'title', 'long'].includes(params.get('sort')) ? params.get('sort') : '';
  let scopeKind = 'all';

  // ----- Pagefind -----
  let pagefind = null;
  async function loadPagefind() {
    if (pagefind) return pagefind;
    try {
      const path = '/pagefind/pagefind.js';
      pagefind = await import(/* @vite-ignore */ path);
      await pagefind.options({ excerptLength: 30 });
      pagefind.init();
    } catch {
      document.getElementById('dev-note').hidden = false;
      pagefind = null;
    }
    return pagefind;
  }

  const checked = () => boxes.filter((b) => b.checked);
  const activeCount = () => checked().length + Object.keys(links).length;
  function pfFilters() {
    const f = {};
    for (const b of checked()) (f[b.dataset.group] ??= { any: [] }).any.push(b.dataset.pf);
    for (const [p, l] of Object.entries(links)) f[LINK_FACETS[p][1]] = l.pf;
    return f;
  }
  function currentSort(searching) {
    const s = chosenSort && (searching || chosenSort !== 'best') ? chosenSort : searching ? 'best' : 'long';
    sortItems.forEach((b) => {
      b.hidden = b.dataset.ssort === 'best' && !searching;
      b.setAttribute('aria-checked', String(b.dataset.ssort === s));
    });
    sortBtn.querySelector('span').textContent = SORT_NAMES[s];
    return s;
  }

  // Active filters as removable chips (one scrolling row) and the count on the Filters button.
  function renderActive() {
    const chip = (label, remove) => {
      const b = el('button', { type: 'button', className: 'chip' }, el('span', {}, label, ' ×'));
      b.setAttribute('aria-label', `Remove filter: ${label}`);
      b.addEventListener('click', () => {
        remove();
        run();
      });
      return el('li', {}, b);
    };
    const chips = [
      ...Object.entries(links).map(([p, l]) => chip(l.label, () => delete links[p])),
      ...checked().map((b) => chip(b.dataset.label, () => (b.checked = false))),
    ];
    active.replaceChildren(...chips);
    active.hidden = chips.length === 0;
    const n = activeCount();
    fcount.textContent = n ? String(n) : '';
    toggle.setAttribute('aria-label', n ? `Filters, ${n} on` : 'Filters');
    clearTop.hidden = n === 0;
  }

  // Option counts: the number of docs each box would give with the other groups as they are.
  function setCounts(countOf) {
    for (const b of boxes) {
      const n = countOf(b);
      const c = b.closest('label');
      const span = c.querySelector('[data-count]');
      if (n === null) continue;
      span.textContent = n.toLocaleString('en-US');
      c.classList.toggle('off', n === 0 && !b.checked);
    }
  }

  function showCount(n) {
    status.textContent = plural(n, 'doc', 'docs');
    doneBtn.textContent = `Show ${plural(n, 'doc', 'docs')}`;
  }

  // ----- Without a search: filter and sort the full list -----
  let lastSort = 'long';
  let browseLimit = BROWSE_PAGE;
  const isDefaultView = () => !activeCount() && currentSort(false) === 'long';
  function browse() {
    const want = {};
    for (const b of checked()) (want[b.dataset.facet] ??= new Set()).add(b.value);
    for (const [p, l] of Object.entries(links)) want[LINK_FACETS[p][0]] = new Set([l.v]);
    const groups = Object.keys(want);
    const ok = (r, k) => [...want[k]].some((v) => r.sets[k].has(v));
    const counts = {};
    let shown = 0;
    const sort = currentSort(false);
    if (sort !== lastSort && allLoaded) {
      lastSort = sort;
      rows = [...rows].sort(sort === 'title' ? (a, b) => a.rank - b.rank : (a, b) => a.i - b.i);
      list.append(...rows.map((r) => r.li));
    }
    for (const r of rows) {
      const fails = groups.filter((k) => !ok(r, k));
      r.li.hidden = fails.length > 0 || shown >= browseLimit;
      if (!fails.length) shown++;
      for (const b of boxes) {
        const k = b.dataset.facet;
        if (fails.length === 0 || (fails.length === 1 && fails[0] === k)) {
          if (r.sets[k].has(b.value)) counts[k + ':' + b.value] = (counts[k + ':' + b.value] || 0) + 1;
        }
      }
    }
    if (allLoaded) setCounts((b) => counts[b.dataset.facet + ':' + b.value] || 0);
    if (!allLoaded) shown = total;
    showCount(shown);
    empty.hidden = shown > 0;
    noResults.hidden = true;
    docsSec.hidden = shown === 0;
    list.hidden = false;
    results.hidden = true;
    moreBtn.hidden = shown <= browseLimit;
    moreBtn.disabled = false;
    docsEnd.hidden = !moreBtn.hidden;
    groupsBox.replaceChildren();
    scopeW.hidden = true;
    sortBtn.hidden = false;
  }

  // ----- With a search -----
  let current = null; // { res, q, data }: the search on screen
  let shownDocs = 0;
  let found = [];

  async function strongData(batch, q) {
    const data = await Promise.all(batch.map((r) => r.data()));
    return data.filter((d) => strongMatch(d, q));
  }

  function docRow(d, ts, q) {
    const meta = d.meta || {};
    const title = el('span', { className: 't' });
    const titleText = meta.title || d.url;
    appendMarked(title, titleText, ts);
    const m = el('span', { className: 'm' });
    const titleHit = String(titleText).split(/\s+/).some((w) => wordHit(w, ts));
    const ex = titleHit ? null : excerptOf(d, ts);
    if (ex) appendMarked(m, ex, ts);
    else {
      const chars = (meta.ch || '').split('|').filter(Boolean);
      const more = chars.find((c) => c.startsWith('+'));
      const named = chars.filter((c) => !c.startsWith('+'));
      const subj = named.length
        ? named[0] + (named.length > 1 || more ? ` +${named.length - 1 + (more ? Number(more.slice(1)) : 0)}` : '')
        : (meta.series || '').split(', ')[0];
      const known = subj && norm(subj).split(' ').some((w) => ts.some((t) => w.startsWith(t)));
      const makers = meta.by && meta.by !== 'Unknown author' ? meta.by.split(', ') : [];
      const by = makers.length
        ? makers[0] + (meta.hint ? ` (${meta.hint})` : '') + (makers.length > 1 ? ` +${makers.length - 1}` : '')
        : meta.sh ? `shared by ${meta.sh.split(', ')[0]}` : 'Unknown author';
      m.textContent = [known ? '' : subj, by].filter(Boolean).join(' · ');
    }
    return el(
      'li',
      {},
      el('a', { className: 'rs', href: d.url }, glyph('doc'), el('span', { className: 'tx' }, title, el('span', { className: 'ml' }, m, el('span', { className: 'n', textContent: shortNum(meta.words) })))),
    );
  }

  function nameRow(f, ts) {
    const t = el('span', { className: 't' });
    appendMarked(t, f.name, ts);
    const kind = KINDS.find((k) => k[0] === f.k);
    return el(
      'li',
      {},
      el('a', { className: 'rs', href: f.href }, glyph(kind[5]), el('span', { className: 'tx' }, t, el('span', { className: 'm', textContent: f.sub || ' ' })), el('span', { className: 'n', textContent: f.count.toLocaleString('en-US') })),
    );
  }

  function moreRow(label, onClick) {
    const b = el('button', { type: 'button', className: 'more' }, el('span', { className: 'lbl', textContent: label }), glyph('down', 16, 'chev'));
    b.addEventListener('click', onClick);
    return b;
  }

  /** Name groups and scope tabs for the matches in `found`, for the current scope. */
  function renderGroups(q, nDocs) {
    const ts = terms(q);
    const kinds = KINDS.filter(([k]) => found.some((f) => f.k === k));
    const totalNames = found.length;
    // Scope tabs, in the order of the groups. Only when there is something besides docs.
    if (kinds.length) {
      const tabs = [['all', 'All', totalNames + nDocs], ...kinds.map(([k, label]) => [k, label, found.filter((f) => f.k === k).length]), ...(nDocs ? [['docs', 'Docs', nDocs]] : [])];
      if (!tabs.some((t) => t[0] === scopeKind)) scopeKind = 'all';
      scope.replaceChildren(
        ...tabs.map(([k, label, n]) => {
          const b = el('button', { type: 'button', className: 'tb' }, label, el('span', { className: 'n', textContent: n.toLocaleString('en-US') }));
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(k === scopeKind));
          b.dataset.kind = k;
          b.dataset.label = label;
          return b;
        }),
      );
      scopeW.hidden = false;
      fitStrip(scope);
    } else {
      scopeKind = 'all';
      scopeW.hidden = true;
    }
    const sections = [];
    for (const [k, label, , , cap] of kinds) {
      if (scopeKind !== 'all' && scopeKind !== k) continue;
      const all = found.filter((f) => f.k === k);
      const show = scopeKind === k || all.length <= cap + 1 ? all : all.slice(0, cap);
      sections.push(
        el(
          'section',
          { className: 'grp' },
          el('div', { className: 'sh' }, el('h2', { className: 'sl', textContent: label }), el('span', { className: 'sl', textContent: 'Docs' })),
          el('ul', {}, ...show.slice(0, 50).map((f) => nameRow(f, ts))),
          show.length < all.length ? moreRow(`All ${all.length} ${label.toLowerCase()}`, () => pickScope(k)) : null,
        ),
      );
    }
    groupsBox.replaceChildren(...sections);
    docsSec.hidden = !(scopeKind === 'all' || scopeKind === 'docs') || !nDocs;
  }

  function pickScope(k) {
    scopeKind = k;
    if (current) renderGroups(current.q, current.n);
    const tab = scope.querySelector(`.tb[data-kind="${k}"]`);
    tab?.focus({ preventScroll: true });
  }
  scope.addEventListener('tabpick', (ev) => pickScope(ev.detail));

  async function renderMore() {
    if (!current) return;
    const { res, q } = current;
    const batch = res.results.slice(shownDocs, shownDocs + PAGE);
    shownDocs += batch.length;
    moreBtn.disabled = true;
    const data = await strongData(batch, q);
    if (current?.res !== res) return;
    const ts = terms(q);
    results.append(...data.map((d) => docRow(d, ts, q)));
    moreBtn.disabled = false;
    moreBtn.hidden = shownDocs >= res.results.length;
    docsEnd.hidden = !moreBtn.hidden;
  }

  /** Runs one search and shows it in a single DOM update. Returns false if a newer run replaced it. */
  async function search(q, isStale) {
    const sort = currentSort(true);
    const filters = pfFilters();
    const [pf] = await Promise.all([loadPagefind(), loadNames()]);
    if (isStale()) return false;
    if (!pf) return true;
    const res = await pf.search(q, { filters, sort: SORTS[sort] });
    if (isStale()) return false;
    const first = res.results.length ? await strongData(res.results.slice(0, PAGE), q) : [];
    if (isStale()) return false;
    const n = !first.length ? 0 : res.results.length <= PAGE ? first.length : res.results.length;
    found = activeCount() ? [] : matchNames(names, q);
    const ts = terms(q);
    // Commit: everything below changes together, so the page only shifts once.
    current = { res, q, n };
    shownDocs = n ? Math.min(PAGE, res.results.length) : 0;
    list.hidden = true;
    empty.hidden = true;
    results.replaceChildren(...first.map((d) => docRow(d, ts, q)));
    results.hidden = false;
    renderGroups(q, n);
    moreBtn.disabled = false;
    moreBtn.hidden = !n || shownDocs >= res.results.length;
    docsEnd.hidden = !moreBtn.hidden;
    sortBtn.hidden = n < 2;
    const none = !n && !found.length;
    noResults.hidden = !none;
    noResultsQ.textContent = q;
    const sugg = none && !activeCount() ? didYouMean(names, q) : [];
    dymList.replaceChildren(
      ...sugg.map((s) => {
        const t = el('span', { className: 't' });
        markDiff(t, s.text, norm(q));
        return el('li', {}, el('a', { className: 'rs short', href: `/search/?q=${encodeURIComponent(s.text)}` }, glyph('search'), el('span', { className: 'tx' }, t), el('span', { className: 'n', textContent: s.count.toLocaleString('en-US') })));
      }),
    );
    dym.hidden = sugg.length === 0;
    if (n) showCount(n);
    else {
      status.textContent = '0 docs';
      doneBtn.textContent = 'Show results';
    }
    const counts = res.filters || {};
    setCounts((b) => (counts[b.dataset.group] || {})[b.dataset.pf] || 0);
    counter.shown(q, n, [...checked().map((b) => `${b.dataset.group}=${b.dataset.label}`), ...Object.entries(links).map(([p, l]) => `${LINK_FACETS[p][1]}=${l.label}`)]);
    return true;
  }

  function updateUrl() {
    const out = new URLSearchParams();
    const q = input.value.trim();
    if (q) out.set('q', q);
    for (const b of checked()) out.append(b.name, b.value);
    for (const [p, l] of Object.entries(links)) out.set(p, l.v);
    if (chosenSort && chosenSort !== (q ? 'best' : 'long')) out.set('sort', chosenSort);
    history.replaceState(null, '', out.toString() ? `?${out}` : location.pathname);
  }

  // Only the newest run may draw (Pagefind searches can't be cancelled, only ignored).
  let runId = 0;
  async function run() {
    const id = ++runId;
    updateUrl();
    renderActive();
    clearQ.hidden = !input.value;
    const q = input.value.trim();
    selected = -1;
    if (q) {
      if ((await search(q, () => id !== runId)) === false) return;
    } else {
      current = null;
      found = [];
      browseLimit = BROWSE_PAGE;
      if (!isDefaultView() && !allLoaded) {
        status.textContent = 'Loading…';
        await loadAll();
        if (id !== runId) return;
      }
      browse();
    }
    root.classList.remove('search-pending');
  }

  // ----- Filters sheet (phones and tablets; a side column from 1024px) -----
  const wide = matchMedia('(min-width: 1024px)');
  let lastFocus = null;
  const sheetOpen = () => filtersForm.classList.contains('open');
  function openSheet() {
    lastFocus = document.activeElement;
    filtersForm.classList.add('open');
    root.classList.add('sheet-open', 'filters-open');
    toggle.setAttribute('aria-expanded', 'true');
    filtersForm.querySelector('input, button')?.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (!sheetOpen()) return;
    filtersForm.classList.remove('open');
    root.classList.remove('sheet-open', 'filters-open');
    toggle.setAttribute('aria-expanded', 'false');
    (lastFocus instanceof HTMLElement ? lastFocus : toggle).focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => (sheetOpen() ? closeSheet() : openSheet()));
  doneBtn.addEventListener('click', closeSheet);
  document.getElementById('filters-done').addEventListener('click', closeSheet);
  filtersForm.addEventListener('keydown', (ev) => ev.key === 'Escape' && closeSheet());
  wide.addEventListener('change', () => wide.matches && closeSheet());

  // ----- Keyboard: ↑/↓ move through the result rows, Enter opens the selected one -----
  let selected = -1;
  const resultRows = () => [...document.querySelectorAll('#groups .rs, #results:not([hidden]) .rs, #dym:not([hidden]) .rs')].filter((r) => r.offsetParent);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const rs = resultRows();
      if (!rs.length) return;
      ev.preventDefault();
      rs.forEach((r) => r.classList.remove('sel'));
      selected = Math.max(0, Math.min(rs.length - 1, selected + (ev.key === 'ArrowDown' ? 1 : -1)));
      rs[selected].classList.add('sel');
      rs[selected].scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && selected >= 0) {
      const r = resultRows()[selected];
      if (r) {
        ev.preventDefault();
        counter.flush();
        location.href = r.href;
      }
    }
  });

  // ----- Wiring -----
  const counter = createCounter();
  let typing;
  const runSoon = (ms) => {
    clearTimeout(typing);
    typing = setTimeout(run, ms);
  };
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    clearTimeout(typing);
    counter.submitted();
    input.blur(); // closes the phone keyboard so the results are visible
    run();
  });
  // Search about 200 ms after the last keystroke, so typing never waits on a search.
  input.addEventListener('input', (ev) => {
    counter.typing();
    clearQ.hidden = !input.value;
    if (!ev.isComposing) runSoon(200);
  });
  input.addEventListener('compositionend', () => runSoon(200));
  clearQ.addEventListener('click', () => {
    input.value = '';
    input.focus();
    run();
  });
  filtersForm.addEventListener('change', run);
  filtersForm.addEventListener('submit', (ev) => ev.preventDefault());
  sortPop.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ssort]');
    if (!b) return;
    closePops();
    chosenSort = b.dataset.ssort;
    sortBtn.focus();
    run();
  });
  const clearAll = () => {
    boxes.forEach((b) => (b.checked = false));
    for (const k of Object.keys(links)) delete links[k];
    run();
  };
  clearTop.addEventListener('click', clearAll);
  document.getElementById('clear-2').addEventListener('click', clearAll);
  // "Show more": the next page of search results, or (no search) the next rows of the list.
  moreBtn.addEventListener('click', async () => {
    if (current) return renderMore();
    moreBtn.disabled = true;
    const ok = await loadAll();
    if (!ok) {
      location.href = '/search/all/';
      return;
    }
    browseLimit += BROWSE_PAGE;
    browse();
  });
  // Clicking a result or leaving the page counts the search on screen now.
  for (const box of [results, groupsBox]) box.addEventListener('click', (ev) => ev.target.closest?.('a') && counter.flush());
  addEventListener('pagehide', counter.flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && counter.flush());
  addEventListener('keydown', (ev) => {
    const a = document.activeElement;
    if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !(a instanceof HTMLInputElement) && !(a instanceof HTMLSelectElement) && !(a instanceof HTMLTextAreaElement)) {
      ev.preventDefault();
      input.focus();
    }
  });

  filtersForm.hidden = false;
  if (wide.matches) input.focus({ preventScroll: true });
  // Link-only filters need the names list to know what the id means.
  if (linkParams.length) {
    await loadNames();
    for (const p of linkParams) {
      const l = resolveLink(p, params.get(p));
      if (l) links[p] = l;
    }
  }
  run();
}
