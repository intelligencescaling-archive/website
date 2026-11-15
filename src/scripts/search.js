// Search page, built on Pagefind's JS API. Everything from the index is inserted as text
// (textContent); the only markup kept is Pagefind's <mark> highlighting, copied node by node.
import { initSheet } from './sheet.js';

const PAGE = 10;
const QUICK_GROUPS = ['Series', 'Character', 'Tag'];
const QUICK_MAX = 5;

/** Appends Pagefind's excerpt (escaped text + <mark> tags) to `el` without using innerHTML on the page. */
function appendExcerpt(el, html) {
  const tpl = document.createElement('template'); // inert: nothing in it runs or loads
  tpl.innerHTML = html;
  const walk = (node, into) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) into.append(child.textContent);
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
  for (let i = start; i < end; i++) {
    const w = words[i];
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
      for (const o of options.slice(0, QUICK_MAX)) {
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
      updateCounts(null);
      renderQuick(null, 0);
      return;
    }
    idle.hidden = true;
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
