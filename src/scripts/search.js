// Search page, built on Pagefind's JS API. Everything from the index is inserted as text
// (textContent); the only markup kept is Pagefind's <mark> highlighting, copied node by node.
import { initSheet } from './sheet.js';

const PAGE = 10;
const QUICK_GROUPS = ['Series', 'Character', 'Tag'];
const QUICK_MAX = 5;

// Long rules in docs ("— — — —", "-----", "=====") collapse to one dash, so excerpts can't stretch the page.
const RULE_RUN = /([-‐-―_=~*─-╿•·])(\s*\1){3,}/g;
const squeeze = (t) => t.replace(RULE_RUN, '—');
const isRule = (w) => /^[-‐-―_=~*─-╿•·.]{3,}$/.test(w);

/** Appends Pagefind's excerpt (escaped text + <mark> tags) to `el` without using innerHTML on the page. */
function appendExcerpt(el, html) {
  const tpl = document.createElement('template'); // inert: nothing in it runs or loads
  tpl.innerHTML = html;
  const walk = (node, into) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) into.append(squeeze(child.textContent));
      else if (child.nodeName === 'MARK') {
        const m = document.createElement('mark');
        m.textContent = child.textContent;
        into.append(m);
      } else walk(child, into);
    }
  };
  walk(tpl.content, el);
}

/**
 * Builds an excerpt around the first match inside the doc text (not the metadata appended after
 * it). Returns false when the only matches are in the metadata, so Pagefind's excerpt is used.
 */
function appendDocExcerpt(target, d, query) {
  const words = (d.content || '').split(/\s+/);
  const limit = words.length - Number(d.meta?.hw || 0) - 2;
  const loc = (d.locations || []).find((l) => l < limit);
  if (loc === undefined || limit < 1) return false;
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const start = Math.max(0, loc - 12);
  const end = Math.min(limit, start + 32);
  if (start > 0) target.append('… ');
  let lastRule = false;
  for (let i = start; i < end; i++) {
    const w = words[i];
    // Long "— — — —" or "-----" rules in docs become one dash, so they can't stretch the page.
    if (isRule(w) || (w.length === 1 && isRule(w.repeat(3)))) {
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
const norm = (x) => x.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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

/** All name matches for a query, best first: [{kind, name, href, count, sub, score}]. */
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

const entriesLabel = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'entry' : 'entries'}`;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}

export async function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('q');
  const filtersForm = document.getElementById('search-filters');
  const selects = [...filtersForm.querySelectorAll('select[data-group]')];
  const sortEl = document.getElementById('sf-sort');
  const status = document.getElementById('status');
  const list = document.getElementById('results');
  const moreBtn = document.getElementById('more');
  const quick = document.getElementById('quick');
  const idle = document.getElementById('idle');
  const toggle = document.getElementById('filter-toggle');
  const matchesBox = document.getElementById('matches');
  const narrow = matchMedia('(max-width: 767.98px)');
  let names = null;
  fetch('/names.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      names = j;
      if (names && input.value.trim()) renderMatches(input.value.trim(), activeFilters());
    })
    .catch(() => {});
  const sheet = initSheet({
    form: filtersForm,
    toggle,
    backdrop: document.getElementById('sheet-backdrop'),
    done: document.getElementById('sheet-done'),
  });

  let pagefind;
  try {
    const path = '/pagefind/pagefind.js';
    pagefind = await import(/* @vite-ignore */ path);
    await pagefind.options({ excerptLength: 30 });
    pagefind.init();
  } catch {
    document.getElementById('dev-note').hidden = false;
    return;
  }

  // Fill the filter dropdowns with every value (sorted by name).
  const all = await pagefind.filters();
  for (const s of selects) {
    const values = Object.keys(all[s.dataset.group] || {}).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    for (const v of values) s.append(el('option', { value: v, textContent: v }));
  }
  filtersForm.hidden = false;
  toggle.hidden = false;

  // Restore state from the URL.
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') || '';
  for (const s of selects) {
    const v = params.get(s.dataset.group.toLowerCase());
    if (v && [...s.options].some((o) => o.value === v)) s.value = v;
  }
  if (params.get('sort') === 'long') sortEl.value = 'long';

  let current = null;
  let shown = 0;
  const activeFilters = () => Object.fromEntries(selects.filter((s) => s.value).map((s) => [s.dataset.group, s.value]));

  async function renderMore() {
    const batch = current.results.slice(shown, shown + PAGE);
    shown += batch.length;
    const data = await Promise.all(batch.map((r) => r.data()));
    for (const d of data) {
      const meta = d.meta || {};
      const excerpt = el('p', { className: 'excerpt' });
      if (!appendDocExcerpt(excerpt, d, input.value.trim())) appendExcerpt(excerpt, d.excerpt || '');
      const by = meta.by || 'Unknown author';
      list.append(
        el(
          'li',
          { className: 'result' },
          el('h3', {}, el('a', { href: d.url, textContent: meta.title || d.url })),
          el(
            'div',
            { className: 'meta' },
            el('span', { className: by === 'Unknown author' ? 'unknown' : 'by', textContent: by }),
            meta.series ? el('span', { textContent: meta.series }) : null,
            meta.words && meta.words !== '0' ? el('span', { className: 'num', textContent: `${Number(meta.words).toLocaleString('en-US')} words` }) : null,
          ),
          excerpt,
        ),
      );
    }
    moreBtn.hidden = shown >= current.results.length;
  }

  function renderQuick(counts, total) {
    const active = activeFilters();
    const chips = [];
    for (const [group, value] of Object.entries(active)) {
      const b = el('button', { type: 'button', className: 'chip on', textContent: `${value} ✕` });
      b.setAttribute('aria-label', `Remove filter: ${value}`);
      b.addEventListener('click', () => {
        selects.find((s) => s.dataset.group === group).value = '';
        run();
      });
      chips.push(b);
    }
    if (counts && total > 1) {
      const options = [];
      for (const g of QUICK_GROUPS) {
        if (active[g]) continue;
        for (const [value, n] of Object.entries(counts[g] || {})) {
          if (n > 0 && n < total && value !== '(No series)') options.push({ g, value, n });
        }
      }
      options.sort((a, b) => b.n - a.n);
      for (const o of options.slice(0, narrow.matches ? 3 : QUICK_MAX)) {
        const b = el('button', { type: 'button', className: 'chip' }, o.value, ' ', el('span', { className: 'count', textContent: String(o.n) }));
        b.addEventListener('click', () => {
          selects.find((s) => s.dataset.group === o.g).value = o.value;
          run();
        });
        chips.push(b);
      }
    }
    quick.replaceChildren(...chips.map((c) => el('li', {}, c)));
    quick.hidden = chips.length === 0;
    sheet.refresh(Object.keys(active).length);
  }

  function updateCounts(counts) {
    for (const s of selects) {
      const c = counts ? counts[s.dataset.group] || {} : all[s.dataset.group] || {};
      for (const o of s.options) {
        if (!o.value) continue;
        const n = c[o.value] || 0;
        o.textContent = `${o.value} (${n})`;
        o.disabled = n === 0 && o.value !== s.value;
      }
    }
  }

  // Shows the best-matching character/series/topic/author as a "top result", then up to three
  // more of each kind. Only for a plain query (no filters set).
  function renderMatches(q, filters) {
    const found = q && !Object.keys(filters).length ? matchNames(names, q) : [];
    if (!found.length) {
      matchesBox.replaceChildren();
      matchesBox.hidden = true;
      return;
    }
    const [top, ...rest] = found;
    const kindOf = (k) => KINDS.find((x) => x[0] === k);
    const subLine = (m) => [kindOf(m.k)[2], m.sub, entriesLabel(m.count)].filter(Boolean).join(' · ');
    const parts = [
      el('h2', { className: 'match-h', textContent: 'Top result' }),
      el(
        'a',
        { className: 'top-result', href: top.href },
        el('span', { className: 'top-name', textContent: top.name }),
        el('span', { className: 'top-sub', textContent: subLine(top) }),
      ),
    ];
    for (const [k, plural] of KINDS) {
      const group = rest.filter((m) => m.k === k).slice(0, 3);
      if (!group.length) continue;
      parts.push(
        el('h2', { className: 'match-h', textContent: plural }),
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

  async function run() {
    const q = input.value.trim();
    const filters = activeFilters();
    const sort = sortEl.value === 'long' ? { words: 'desc' } : undefined;

    const out = new URLSearchParams();
    if (q) out.set('q', q);
    for (const [g, v] of Object.entries(filters)) out.set(g.toLowerCase(), v);
    if (sortEl.value) out.set('sort', sortEl.value);
    history.replaceState(null, '', out.toString() ? `?${out}` : location.pathname);

    if (!q && !Object.keys(filters).length) {
      current = null;
      list.replaceChildren();
      moreBtn.hidden = true;
      status.textContent = '';
      idle.hidden = false;
      renderMatches('', filters);
      updateCounts(null);
      renderQuick(null, 0);
      return;
    }
    idle.hidden = true;
    renderMatches(q, filters);
    const search = await pagefind.debouncedSearch(q || null, { filters, sort }, 180);
    if (search === null) return; // a newer search replaced this one
    current = search;
    shown = 0;
    list.replaceChildren();
    const n = search.results.length;
    status.textContent = n
      ? `${n.toLocaleString('en-US')} ${n === 1 ? 'result' : 'results'}`
      : 'No results. Try other words, another spelling, or fewer filters.';
    updateCounts(search.filters);
    renderQuick(search.filters, n);
    if (n) await renderMore();
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    input.blur(); // closes the phone keyboard so the results are visible
    run();
  });
  input.addEventListener('input', run);
  filtersForm.addEventListener('change', run);
  document.getElementById('clear-filters').addEventListener('click', () => {
    for (const s of selects) s.value = '';
    sortEl.value = '';
    run();
  });
  moreBtn.addEventListener('click', renderMore);
  addEventListener('keydown', (ev) => {
    const a = document.activeElement;
    if (ev.key === '/' && !(a instanceof HTMLInputElement) && !(a instanceof HTMLSelectElement)) {
      ev.preventDefault();
      input.focus();
    }
  });

  updateCounts(null);
  if (!input.value && matchMedia('(min-width: 900px)').matches) input.focus();
  run();
}
