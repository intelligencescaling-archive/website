// The Search page: one place to find things.
// - Empty search box: the full list from the HTML, filtered, counted and sorted here (this only
//   hides, shows and reorders rows; it never builds HTML from data).
// - Words typed: full-text search with Pagefind, using the same filters.
// Everything from the index is inserted as text (textContent); the only markup kept from an excerpt
// is the <mark> around matched words, rebuilt node by node.
import { initSheet } from './sheet.js';

const PAGE = 10;
const SORTS = { title: { title: 'asc' }, long: { words: 'desc' }, short: { words: 'asc' } };

// Long rules in docs ("— — — —", "-----", "=====") collapse to one dash in excerpts.
const isRule = (w) => /^[\p{Pd}_=~*•·─━.]{3,}$/u.test(w) || /^[\p{Pd}_=~*•·─━]$/u.test(w);

/**
 * Adds a short excerpt that starts at the first match inside the doc text (not the metadata
 * appended after it). Returns false when the words only match the title, author or other metadata:
 * then no excerpt is shown, since it would only repeat the title and author.
 */
function appendDocExcerpt(target, d, query) {
  const words = (d.content || '').split(/\s+/);
  const limit = words.length - Number(d.meta?.hw || 0) - 2;
  const loc = (d.locations || []).find((l) => l < limit);
  if (loc === undefined || limit < 1) return false;
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const end = Math.min(limit, loc + 28);
  if (loc > 0) target.append('… ');
  let lastRule = false;
  for (let i = loc; i < end; i++) {
    const w = words[i];
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

// ---------- Top result: characters, series, topics and authors whose name matches ----------
const KINDS = [
  ['c', 'Characters', 'Character', '/characters/'],
  ['s', 'Series', 'Series', '/series/'],
  ['t', 'Topics', 'Topic', '/topics/'],
  ['a', 'Authors', 'Author', '/authors/'],
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
    for (const [name, id, count, sub, aliases] of names[k] || []) {
      let best = 0;
      for (const n of [name, ...aliases]) best = Math.max(best, scoreName(n, q, terms));
      if (best) out.push({ k, name, href: `${base}${id}/`, count, sub, score: best });
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
  const doneBtn = document.getElementById('sheet-done');
  const sheet = initSheet({
    form: filtersForm,
    toggle: document.getElementById('filter-toggle'),
    backdrop: document.getElementById('sheet-backdrop'),
    done: doneBtn,
  });

  // Rows of the full list, for filtering without a search.
  const facetKeys = selects.map((s) => s.dataset.facet);
  const rows = [...list.children].map((li, i) => {
    const sets = {};
    for (const k of facetKeys) sets[k] = new Set((li.dataset[k] || '').split(' ').filter(Boolean));
    return { li, i, sets, words: Number(li.dataset.words) || 0, rank: Number(li.dataset.rank) || 0 };
  });

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
  function loadNames() {
    if (names !== null) return;
    names = false;
    fetch('/names.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        names = j;
        if (names && input.value.trim()) renderMatches(input.value.trim());
      })
      .catch(() => {});
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

  function setCounts(countOf) {
    for (const s of selects) {
      for (const o of s.options) {
        if (!o.value) continue;
        const n = countOf(s, o);
        o.textContent = `${o.dataset.label} (${n})`;
        o.disabled = n === 0 && o.value !== s.value;
      }
    }
  }

  function showCount(n, one, many) {
    const label = plural(n, one, many);
    status.textContent = label;
    doneBtn.textContent = `Show ${label}`;
  }

  // ----- Without a search: filter and sort the full list -----
  let lastSort = 'long'; // the HTML list comes longest first
  function browse() {
    const chosen = Object.fromEntries(selects.map((s) => [s.dataset.facet, s.value]));
    const facetOk = (r, k) => !chosen[k] || r.sets[k].has(chosen[k]);
    const counts = Object.fromEntries(facetKeys.map((k) => [k, new Map()]));
    let shown = 0;
    for (const r of rows) {
      const fails = facetKeys.filter((k) => !facetOk(r, k));
      r.li.hidden = fails.length > 0;
      if (!r.li.hidden) shown++;
      for (const k of facetKeys) {
        if (fails.length === 0 || (fails.length === 1 && fails[0] === k)) {
          for (const v of r.sets[k]) counts[k].set(v, (counts[k].get(v) || 0) + 1);
        }
      }
    }
    setCounts((s, o) => counts[s.dataset.facet].get(o.value) || 0);
    const sort = setSortChoices(false);
    if (sort !== lastSort) {
      lastSort = sort;
      const sorted = [...rows].sort((a, b) =>
        sort === 'title' ? a.rank - b.rank : sort === 'short' ? a.words - b.words || a.rank - b.rank : a.i - b.i,
      );
      list.append(...sorted.map((r) => r.li));
    }
    list.classList.toggle('one-category', !!chosen.cat);
    showCount(shown, 'entry', 'entries');
    empty.hidden = shown > 0;
    list.hidden = false;
    results.hidden = true;
    moreBtn.hidden = true;
    matchesBox.hidden = true;
  }

  // ----- With a search: Pagefind -----
  let current = null;
  let shown = 0;

  async function renderMore() {
    const q = input.value.trim();
    const batch = current.results.slice(shown, shown + PAGE);
    shown += batch.length;
    const data = await Promise.all(batch.map((r) => r.data()));
    for (const d of data) {
      const meta = d.meta || {};
      const excerpt = el('p', { className: 'excerpt' });
      const hasExcerpt = appendDocExcerpt(excerpt, d, q);
      const known = meta.by && meta.by !== 'Unknown author';
      results.append(
        el(
          'li',
          { className: 'result' },
          el('h3', {}, el('a', { href: d.url, textContent: meta.title || d.url })),
          el(
            'div',
            { className: 'meta' },
            known ? el('span', { className: 'by', textContent: meta.by }) : null,
            meta.series ? el('span', { textContent: meta.series }) : null,
            meta.words && meta.words !== '0' ? el('span', { className: 'num', textContent: `${Number(meta.words).toLocaleString('en-US')} words` }) : null,
          ),
          hasExcerpt ? excerpt : null,
        ),
      );
    }
    moreBtn.hidden = shown >= current.results.length;
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
    const subLine = (m) => [kindOf(m.k)[2], m.sub, plural(m.count, 'entry', 'entries')].filter(Boolean).join(' · ');
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
    parts.push(el('h2', { className: 'match-h docs-h', textContent: 'Docs and stories' }));
    matchesBox.replaceChildren(...parts);
    matchesBox.hidden = false;
  }

  async function search(q) {
    list.hidden = true;
    empty.hidden = true;
    const sort = setSortChoices(true);
    loadNames();
    if (names) renderMatches(q);
    const pf = await loadPagefind();
    if (!pf) return;
    const res = await pf.debouncedSearch(q, { filters: pfFilters(), sort: SORTS[sort] }, 180);
    if (res === null || input.value.trim() !== q) return; // a newer search replaced this one
    current = res;
    shown = 0;
    results.replaceChildren();
    results.hidden = false;
    const n = res.results.length;
    if (n) showCount(n, 'result', 'results');
    else {
      status.textContent = 'No results. Try other words, another spelling, or fewer filters.';
      doneBtn.textContent = 'Show results';
    }
    const counts = res.filters || {};
    setCounts((s, o) => (counts[s.dataset.group] || {})[o.dataset.pf] || 0);
    if (n) await renderMore();
    else moreBtn.hidden = true;
  }

  function updateUrl() {
    const out = new URLSearchParams();
    const q = input.value.trim();
    if (q) out.set('q', q);
    for (const s of activeSelects()) out.set(s.name, s.value);
    if (chosenSort && chosenSort !== (q ? 'best' : 'long')) out.set('sort', chosenSort);
    history.replaceState(null, '', out.toString() ? `?${out}` : location.pathname);
  }

  async function run() {
    updateUrl();
    renderActive();
    const q = input.value.trim();
    if (q) await search(q);
    else browse();
    document.documentElement.classList.remove('search-pending');
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    input.blur(); // closes the phone keyboard so the results are visible
    run();
  });
  let typing;
  input.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(run, 150);
  });
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
  moreBtn.addEventListener('click', renderMore);
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
