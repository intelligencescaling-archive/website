// Client-side filtering for /browse/. The full list is already in the HTML; this only hides,
// shows and reorders rows, and never builds HTML from data (textContent only).
export function initBrowse() {
  const form = document.getElementById('filters');
  const list = document.getElementById('list');
  if (!form || !list) return;
  const countEl = document.getElementById('count');
  const emptyEl = document.getElementById('empty');
  const sortEl = document.getElementById('sort');
  const qEl = document.getElementById('f-q');
  const selects = [...form.querySelectorAll('select[data-facet]')];
  const facetKeys = selects.map((s) => s.dataset.facet);

  const rows = [...list.children].map((el, i) => {
    const sets = {};
    for (const k of facetKeys) sets[k] = new Set((el.dataset[k] || '').split(' ').filter(Boolean));
    return { el, i, sets, text: el.dataset.text || '', words: Number(el.dataset.words) || 0 };
  });

  // Restore state from the URL (?series=death-note&tag=feats ...).
  const params = new URLSearchParams(location.search);
  for (const s of selects) {
    const v = params.get(s.name);
    if (v && [...s.options].some((o) => o.value === v)) s.value = v;
  }
  if (params.get('q')) qEl.value = params.get('q');
  if (['title', 'long', 'short'].includes(params.get('sort'))) sortEl.value = params.get('sort');

  let lastSort = '';
  function apply() {
    const chosen = Object.fromEntries(selects.map((s) => [s.dataset.facet, s.value]));
    const q = qEl.value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const textOk = (r) => terms.every((t) => r.text.includes(t));
    const facetOk = (r, k) => !chosen[k] || r.sets[k].has(chosen[k]);

    // Counts per option: rows matching every *other* active filter.
    const counts = Object.fromEntries(facetKeys.map((k) => [k, new Map()]));
    let shown = 0;
    for (const r of rows) {
      if (!textOk(r)) {
        r.el.hidden = true;
        continue;
      }
      const fails = facetKeys.filter((k) => !facetOk(r, k));
      r.el.hidden = fails.length > 0;
      if (!r.el.hidden) shown++;
      for (const k of facetKeys) {
        if (fails.length === 0 || (fails.length === 1 && fails[0] === k)) {
          for (const v of r.sets[k]) counts[k].set(v, (counts[k].get(v) || 0) + 1);
        }
      }
    }
    for (const s of selects) {
      const m = counts[s.dataset.facet];
      for (const o of s.options) {
        if (!o.value) continue;
        const n = m.get(o.value) || 0;
        o.textContent = `${o.dataset.label} (${n})`;
        o.disabled = n === 0 && o.value !== s.value;
      }
    }

    if (sortEl.value !== lastSort) {
      lastSort = sortEl.value;
      const sorted = [...rows].sort((a, b) =>
        lastSort === 'long' ? b.words - a.words || a.i - b.i : lastSort === 'short' ? a.words - b.words || a.i - b.i : a.i - b.i,
      );
      list.append(...sorted.map((r) => r.el));
    }

    countEl.textContent = `${shown.toLocaleString('en-US')} ${shown === 1 ? 'entry' : 'entries'}`;
    emptyEl.hidden = shown > 0;

    const out = new URLSearchParams();
    if (q) out.set('q', qEl.value.trim());
    for (const s of selects) if (s.value) out.set(s.name, s.value);
    if (sortEl.value !== 'title') out.set('sort', sortEl.value);
    const qs = out.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  form.addEventListener('change', apply);
  form.addEventListener('submit', (ev) => ev.preventDefault());
  sortEl.addEventListener('change', apply);
  let t;
  qEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(apply, 120);
  });
  form.addEventListener('reset', () => setTimeout(() => {
    sortEl.value = 'title';
    apply();
  }));

  form.hidden = false;
  document.getElementById('sort-wrap').hidden = false;
  apply();
}
