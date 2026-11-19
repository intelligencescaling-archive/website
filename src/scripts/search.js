// The Search page: one place to find things.
// - Empty search box: the full list from the HTML, filtered, counted and sorted here (this only
//   hides, shows and reorders rows; it never builds HTML from data).
// - Words typed: full-text search with Pagefind, using the same filters.
// Everything from the index is inserted as text (textContent); the only markup kept from an excerpt
// is the <mark> around matched words, rebuilt node by node.
import { initSheet } from './sheet.js';
import { createCounter } from './search-counter.js';

const PAGE = 10;
const SORTS = { title: { title: 'asc' }, long: { words: 'desc' }, short: { words: 'asc' } };

// Long rules in docs ("— — — —", "-----", "=====") collapse to one dash in excerpts.
const isRule = (w) => /^[\p{Pd}_=~*•·─━.]{3,}$/u.test(w) || /^[\p{Pd}_=~*•·─━]$/u.test(w);

/**
 * Adds a short excerpt that starts at the first match inside the doc text (not the metadata
 * appended after it). Returns false when the words only match the title, author or other metadata:
 * then no excerpt is shown, since it would only repeat the title and author.
 */
// Links in doc text ("https://youtu.be/…", "{https://ibb.co/…}") are noise in an excerpt: shown as "(link)".
const isUrl = (w) => /https?:\/\/|www\.|\.(?:com|org|net|io|gg|be|ly|co)\/|\.(?:com|org|net)\b/i.test(w);

/**
 * True when a result really contains the searched words. Pagefind also returns loose matches (for "qxjvbzqk" it
 * finds "Qx4" and bits of URLs); a matched word counts only when it is not part of a link and shares most of its
 * start with a search word ("gamble" for "gambling" and "Ayanokoji" for "ayanokouji" count, "Qx4" doesn't).
 * Search words shorter than 4 letters are trusted as they are.
 */
function strongMatch(d, query) {
  const terms = norm(query).split(' ').filter((t) => t.length >= 4);
  if (!terms.length) return true;
  const words = (d.content || '').split(/\s+/);
  for (const l of d.locations || []) {
    const w = words[l] || '';
    if (isUrl(w)) continue;
    const nw = norm(w).replace(/ /g, '');
    for (const t of terms) {
      if (nw.includes(t)) return true;
      const need = Math.min(t.length, Math.max(4, Math.ceil(t.length * 0.6)));
      let k = 0;
      while (k < t.length && k < nw.length && t[k] === nw[k]) k++;
      if (k >= need) return true;
    }
  }
  return false;
}

function appendDocExcerpt(target, d, query) {
  const words = (d.content || '').split(/\s+/);
  const limit = words.length - Number(d.meta?.hw || 0) - 2;
  const loc = (d.locations || []).find((l) => l < limit && !isUrl(words[l]));
  if (loc === undefined || limit < 1) return false;
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const end = Math.min(limit, loc + 28);
  if (loc > 0) target.append('… ');
  let lastRule = false;
  for (let i = loc; i < end; i++) {
    const w = words[i];
    if (isUrl(w)) {
      if (!lastRule) target.append('(link) ');
      lastRule = true;
      continue;
    }
    if (isRule(w)) {
      if (!lastRule) target.append('— ');
      lastRule = true;
      continue;
    }
    lastRule = false;
    const lw = w.toLowerCase();
    if (terms.some((t) => lw.includes(t))) {
      const m = document.createElement('mark');
      m.textContent = w;
      target.append(m, ' ');
    } else target.append(w + ' ');
  }
  if (end < limit) target.append('…');
  return true;
}

// ---------- Top result: characters, series, authors and tags whose name matches ----------
const KINDS = [
  ['c', 'Characters', 'Character', '/characters/'],
  ['s', 'Series', 'Series', '/series/'],
  ['a', 'Authors', 'Author', '/authors/'],
  ['g', 'Tags', 'Tag', '/tags/'],
];
const norm = (x) => x.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function scoreName(name, q, terms) {
  const n = norm(name);
  if (!n) return 0;
  if (n === q) return 100;
  if (q.length >= 3 && n.startsWith(q)) return 70;
  if (q.length >= 3) {
    const words = n.split(' ');
    if (terms.every((t) => words.some((w) => w.startsWith(t)))) return 50;
  }
  return 0;
}

/** All name matches for a query, best first: [{k, name, href, count, sub, score}]. */
function matchNames(names, query) {
  const q = norm(query);
  if (!names || !q) return [];
  const terms = q.split(' ').filter((t) => t.length >= 2);
  if (!terms.length && q.length < 2) return [];
  const out = [];
  for (const [k, , , base] of KINDS) {
    for (const [name, id, count, sub, aliases, role] of names[k] || []) {
      let best = 0;
      for (const n of [name, ...aliases]) best = Math.max(best, scoreName(n, q, terms));
      if (best) out.push({ k, name, href: `${base}${id}/`, count, sub, role, score: best });
    }
  }
  return out.sort((a, b) => b.score - a.score || b.count - a.count);
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}

/** Tags of a result row from the index's "group:Name|group:Name" (text only, group kept to a-z): `meta` tags as
 *  small dashed labels after the title, the others as coloured words at the end of the meta line. */
function tagParts(tg) {
  const all = (tg || '').split('|').filter(Boolean).map((x) => {
    const i = x.indexOf(':');
    return { group: x.slice(0, i).replace(/[^a-z-]/g, '') || 'type', name: x.slice(i + 1) };
  });
  return {
    labels: all.filter((t) => t.group === 'meta').map((t) => el('span', { className: 'stat-l', textContent: t.name })),
    words: all.filter((t) => t.group !== 'meta').map((t) => el('span', { className: `tgt k-${t.group}`, textContent: t.name })),
  };
}

export async function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('q');
  const filtersForm = document.getElementById('filters');
  const selects = [...filtersForm.querySelectorAll('select[data-facet]')];
  const sortEl = document.getElementById('sort');
  const bestOpt = sortEl.querySelector('option[value="best"]');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  const list = document.getElementById('list');
  const moreBtn = document.getElementById('more');
  const active = document.getElementById('active');
  const empty = document.getElementById('empty');
  const matchesBox = document.getElementById('matches');
  const noResults = document.getElementById('no-results');
  const noResultsQ = document.getElementById('no-results-q');
  const doneBtn = document.getElementById('sheet-done');
  const sheet = initSheet({
    form: filtersForm,
    toggle: document.getElementById('filter-toggle'),
    backdrop: document.getElementById('sheet-backdrop'),
    done: doneBtn,
  });

  // Rows of the full list, for filtering without a search.
  const facetKeys = selects.map((s) => s.dataset.facet);
  // The page ships only the first rows of the list (longest first). The rest, with the same filter data, is on
  // /search/all/ and is fetched once, the first time someone filters, sorts or asks for more.
  const total = Number(list.dataset.total) || list.children.length;
  const toRows = (lis) => lis.map((li, i) => {
    const sets = {};
    for (const k of facetKeys) sets[k] = new Set((li.dataset[k] || '').split(' ').filter(Boolean));
    return { li, i, sets, words: Number(li.dataset.words) || 0, rank: Number(li.dataset.rank) || 0 };
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

  // Restore state from the URL. Values can be ids (?series=death-note, as old /browse/ links) or
  // names (?series=Death Note, as old /search/ links).
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  for (const s of selects) {
    const v = (params.get(s.name) || '').toLowerCase();
    if (!v) continue;
    const o = [...s.options].find((o) => o.value && (o.value.toLowerCase() === v || o.dataset.label.toLowerCase() === v || o.dataset.pf.toLowerCase() === v));
    if (o) s.value = o.value;
  }
  let chosenSort = ['best', 'title', 'long', 'short'].includes(params.get('sort')) ? params.get('sort') : '';

  let pagefind = null;
  let names = null;
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
  // Resolves to the names index (or null if it can't be loaded). Fetched once.
  let namesPromise = null;
  function loadNames() {
    if (!namesPromise) {
      namesPromise = fetch('/names.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => (names = j));
    }
    return namesPromise;
  }

  const activeSelects = () => selects.filter((s) => s.value);
  const pfFilters = () => Object.fromEntries(activeSelects().map((s) => [s.dataset.group, s.selectedOptions[0].dataset.pf]));

  function setSortChoices(searching) {
    bestOpt.hidden = !searching;
    bestOpt.disabled = !searching;
    const def = searching ? 'best' : 'long';
    sortEl.value = chosenSort && (searching || chosenSort !== 'best') ? chosenSort : def;
    return sortEl.value;
  }

  // Active filters as removable chips (the only place they're shown outside the panel).
  function renderActive() {
    const chips = activeSelects().map((s) => {
      const name = s.selectedOptions[0].dataset.label;
      const b = el('button', { type: 'button', className: 'chip on', textContent: `${name} ✕` });
      b.setAttribute('aria-label', `Remove filter: ${name}`);
      b.addEventListener('click', () => {
        s.value = '';
        run();
      });
      return el('li', {}, b);
    });
    active.replaceChildren(...chips);
    active.hidden = chips.length === 0;
    sheet.refresh(0);
  }

  // Option counts ("Series: Naruto (12)") only matter when a dropdown opens, so they are written
  // when the browser is idle, and only for options whose number changed (1,100+ options).
  let countsTimer = null;
  const idle = window.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 600 }) : (f) => setTimeout(f, 30);
  const cancelIdle = window.cancelIdleCallback ? (h) => cancelIdleCallback(h) : (h) => clearTimeout(h);
  function setCounts(countOf) {
    if (countsTimer !== null) cancelIdle(countsTimer);
    countsTimer = idle(() => {
      countsTimer = null;
      for (const s of selects) {
        for (const o of s.options) {
          if (!o.value) continue;
          const n = countOf(s, o);
          if (o._n !== n) {
            o._n = n;
            o.textContent = `${o.dataset.label} (${n})`;
          }
          const off = n === 0 && o.value !== s.value;
          if (o.disabled !== off) o.disabled = off;
        }
      }
    });
  }

  function showCount(n, one, many) {
    const label = plural(n, one, many);
    status.textContent = label;
    doneBtn.textContent = `Show ${label}`;
  }

  // ----- Without a search: filter and sort the full list -----
  let lastSort = 'long'; // the HTML list comes longest first
  const BROWSE_PAGE = 50;
  let browseLimit = BROWSE_PAGE; // rows shown; "Show more" adds BROWSE_PAGE
  /** True when nothing is chosen: the rows in the HTML are already the right ones. */
  const isDefaultView = () => !activeSelects().length && setSortChoices(false) === 'long';
  function browse() {
    const chosen = Object.fromEntries(selects.map((s) => [s.dataset.facet, s.value]));
    const facetOk = (r, k) => !chosen[k] || r.sets[k].has(chosen[k]);
    const counts = Object.fromEntries(facetKeys.map((k) => [k, new Map()]));
    let shown = 0;
    const sort = setSortChoices(false);
    if (sort !== lastSort && allLoaded) {
      lastSort = sort;
      const sorted = [...rows].sort((a, b) =>
        sort === 'title' ? a.rank - b.rank : sort === 'short' ? a.words - b.words || a.rank - b.rank : a.i - b.i,
      );
      list.append(...sorted.map((r) => r.li));
      rows = sorted;
    }
    for (const r of rows) {
      const fails = facetKeys.filter((k) => !facetOk(r, k));
      // Matching rows past the limit stay hidden until "Show more".
      r.li.hidden = fails.length > 0 || shown >= browseLimit;
      if (fails.length === 0) shown++;
      for (const k of facetKeys) {
        if (fails.length === 0 || (fails.length === 1 && fails[0] === k)) {
          for (const v of r.sets[k]) counts[k].set(v, (counts[k].get(v) || 0) + 1);
        }
      }
    }
    // Option counts need every row; with only the first rows on the page they wait until the rest is loaded.
    if (allLoaded) setCounts((s, o) => counts[s.dataset.facet].get(o.value) || 0);
    if (!allLoaded) shown = total;
    list.classList.toggle('one-category', !!chosen.cat);
    showCount(shown, 'doc', 'docs');
    empty.hidden = shown > 0;
    noResults.hidden = true;
    list.hidden = false;
    results.hidden = true;
    moreBtn.disabled = false;
    moreBtn.hidden = shown <= browseLimit;
    matchesBox.hidden = true;
  }

  // ----- With a search: Pagefind -----
  let current = null; // { res, q }: the search whose results are on screen
  let shown = 0;

  /** Loads a batch of Pagefind results and keeps the real matches (see strongMatch). */
  async function strongData(batch, q) {
    const data = await Promise.all(batch.map((r) => r.data()));
    return data.filter((d) => strongMatch(d, q));
  }

  /** Result rows for loaded results, as one fragment (nothing touches the page yet). */
  function buildRows(data, q) {
    const frag = document.createDocumentFragment();
    for (const d of data) {
      const meta = d.meta || {};
      const excerpt = el('p', { className: 'excerpt' });
      const hasExcerpt = appendDocExcerpt(excerpt, d, q);
      const known = meta.by && meta.by !== 'Unknown author';
      const tags = tagParts(meta.tg);
      frag.append(
        el(
          'li',
          { className: 'result' },
          el('h3', {}, el('a', { href: d.url, textContent: meta.title || d.url }), ...tags.labels.flatMap((x) => [' ', x])),
          el(
            'div',
            { className: 'meta' },
            known ? el('span', { className: 'by', textContent: meta.by }) : null,
            !known && meta.sh ? el('span', { className: 'sharer', textContent: `shared by ${meta.sh}` }) : null,
            meta.series ? el('span', { textContent: meta.series }) : null,
            meta.words && meta.words !== '0' ? el('span', { className: 'num', textContent: `${Number(meta.words).toLocaleString('en-US')} words` }) : null,
            ...tags.words,
          ),
          hasExcerpt ? excerpt : null,
        ),
      );
    }
    return frag;
  }

  async function renderMore() {
    if (!current) return;
    const { res, q } = current;
    const batch = res.results.slice(shown, shown + PAGE);
    shown += batch.length;
    moreBtn.disabled = true;
    const frag = buildRows(await strongData(batch, q), q);
    if (current?.res !== res) return; // a newer search replaced these results meanwhile
    results.append(frag);
    moreBtn.disabled = false;
    moreBtn.hidden = shown >= res.results.length;
  }

  // The best-matching character/series/topic/author as a "top result", then up to three more of
  // each kind. Only for a plain search (no filters set).
  function renderMatches(q) {
    const found = q && !activeSelects().length ? matchNames(names, q) : [];
    if (!found.length) {
      matchesBox.replaceChildren();
      matchesBox.hidden = true;
      return;
    }
    const [top, ...rest] = found;
    const kindOf = (k) => KINDS.find((x) => x[0] === k);
    const subLine = (m) => [m.role || kindOf(m.k)[2], m.sub, plural(m.count, 'doc', 'docs')].filter(Boolean).join(' · ');
    const parts = [
      el('h2', { className: 'match-h', textContent: 'Top result' }),
      el('a', { className: 'top-result', href: top.href }, el('span', { className: 'top-name', textContent: top.name }), el('span', { className: 'top-sub', textContent: subLine(top) })),
    ];
    for (const [k, label] of KINDS) {
      const group = rest.filter((m) => m.k === k).slice(0, 3);
      if (!group.length) continue;
      parts.push(
        el('h2', { className: 'match-h', textContent: label }),
        el(
          'ul',
          { className: 'match-list' },
          ...group.map((m) =>
            el(
              'li',
              {},
              el('a', { href: m.href }, el('span', { className: 'm-name', textContent: m.name }), el('span', { className: 'count', textContent: String(m.count) })),
              m.sub ? el('span', { className: 'm-sub', textContent: m.sub }) : null,
            ),
          ),
        ),
      );
    }
    parts.push(el('h2', { className: 'match-h docs-h', textContent: 'Docs' }));
    matchesBox.replaceChildren(...parts);
    matchesBox.hidden = false;
  }

  /** Runs one search and shows it in a single DOM update. Returns false if a newer run replaced it. */
  async function search(q, isStale) {
    const sort = setSortChoices(true);
    const filters = pfFilters();
    const [pf] = await Promise.all([loadPagefind(), loadNames()]);
    if (isStale()) return false;
    if (!pf) return true; // no index (dev): leave the list as it is
    const res = await pf.search(q, { filters, sort: SORTS[sort] });
    if (isStale()) return false;
    const first = res.results.length ? await strongData(res.results.slice(0, PAGE), q) : [];
    if (isStale()) return false;
    // No real match on the first page: Pagefind only found loose bits (see strongMatch), so it's "nothing found".
    // When every result fits on the first page, the count is the real matches.
    const n = !first.length ? 0 : res.results.length <= PAGE ? first.length : res.results.length;
    const frag = n ? buildRows(first, q) : null;
    // Commit: everything below changes together, so the page only shifts once.
    current = { res, q };
    shown = frag ? Math.min(PAGE, res.results.length) : 0;
    list.hidden = true;
    empty.hidden = true;
    noResults.hidden = n > 0;
    noResultsQ.textContent = q;
    renderMatches(q);
    results.replaceChildren(...(frag ? [frag] : []));
    results.hidden = false;
    moreBtn.disabled = false;
    moreBtn.hidden = !n || shown >= res.results.length;
    if (n) showCount(n, 'doc', 'docs');
    else {
      status.textContent = activeSelects().length ? 'No docs. Try fewer filters.' : 'No docs';
      doneBtn.textContent = 'Show results';
    }
    const counts = res.filters || {};
    setCounts((s, o) => (counts[s.dataset.group] || {})[o.dataset.pf] || 0);
    counter.shown(q, n, activeSelects().map((s) => `${s.dataset.group}=${s.selectedOptions[0].dataset.label}`));
    return true;
  }

  function updateUrl() {
    const out = new URLSearchParams();
    const q = input.value.trim();
    if (q) out.set('q', q);
    for (const s of activeSelects()) out.set(s.name, s.value);
    if (chosenSort && chosenSort !== (q ? 'best' : 'long')) out.set('sort', chosenSort);
    history.replaceState(null, '', out.toString() ? `?${out}` : location.pathname);
  }

  // Only the newest run may draw: each run takes a number, and a run that finds a higher number
  // already issued drops its results (Pagefind searches can't be cancelled, only ignored).
  let runId = 0;
  async function run() {
    const id = ++runId;
    updateUrl();
    renderActive();
    const q = input.value.trim();
    if (q) {
      if ((await search(q, () => id !== runId)) === false) return;
    } else {
      current = null;
      browseLimit = BROWSE_PAGE; // a new filter or sort starts from the top again
      if (!isDefaultView() && !allLoaded) {
        status.textContent = 'Loading…';
        await loadAll();
        if (id !== runId) return;
      }
      browse();
    }
    document.documentElement.classList.remove('search-pending');
  }

  // Anonymous search counter: one beacon per settled search (see search-counter.js).
  const counter = createCounter();
  let typing;
  function runSoon(ms) {
    clearTimeout(typing);
    typing = setTimeout(run, ms);
  }
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
    if (!ev.isComposing) runSoon(200);
  });
  input.addEventListener('compositionend', () => runSoon(200));
  filtersForm.addEventListener('change', run);
  filtersForm.addEventListener('submit', (ev) => ev.preventDefault());
  sortEl.addEventListener('change', () => {
    chosenSort = sortEl.value;
    run();
  });
  const clearAll = () => {
    for (const s of selects) s.value = '';
    run();
  };
  document.getElementById('clear-filters').addEventListener('click', clearAll);
  document.getElementById('clear-2').addEventListener('click', clearAll);
  // "Show more": the next page of search results, or (no search) the next rows of the list.
  moreBtn.addEventListener('click', async () => {
    if (current) return renderMore();
    moreBtn.disabled = true;
    moreBtn.textContent = 'Loading…';
    const ok = await loadAll();
    moreBtn.textContent = 'Show more';
    if (!ok) {
      location.href = '/search/all/';
      return;
    }
    browseLimit += BROWSE_PAGE;
    browse();
  });
  // Clicking a result (or a top-result link) or leaving the page counts the search on screen now.
  for (const box of [results, matchesBox]) box.addEventListener('click', (ev) => ev.target.closest?.('a') && counter.flush());
  addEventListener('pagehide', counter.flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && counter.flush());
  addEventListener('keydown', (ev) => {
    const a = document.activeElement;
    if (ev.key === '/' && !(a instanceof HTMLInputElement) && !(a instanceof HTMLSelectElement)) {
      ev.preventDefault();
      input.focus();
    }
  });

  filtersForm.hidden = false;
  document.getElementById('tools').hidden = false;
  if (!input.value && matchMedia('(min-width: 900px)').matches) input.focus({ preventScroll: true });
  run();
}
