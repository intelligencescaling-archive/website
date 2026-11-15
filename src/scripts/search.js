// Starts Pagefind's search UI and keeps ?q= in the address bar, so searches can be linked.
export function initSearch() {
  const PagefindUI = window.PagefindUI;
  if (!PagefindUI) {
    document.getElementById('search-missing').hidden = false;
    return;
  }
  const ui = new PagefindUI({
    element: '#search',
    showSubResults: false,
    showImages: false,
    excerptLength: 28,
    pageSize: 10,
    resetStyles: false,
    autofocus: !new URLSearchParams(location.search).get('q'),
    translations: { placeholder: 'Search titles, authors, characters and document text' },
  });
  const q = new URLSearchParams(location.search).get('q');
  if (q) ui.triggerSearch(q);

  let t;
  document.getElementById('search').addEventListener('input', (ev) => {
    if (!(ev.target instanceof HTMLInputElement) || ev.target.type === 'checkbox') return;
    clearTimeout(t);
    t = setTimeout(() => {
      const v = ev.target.value.trim();
      history.replaceState(null, '', v ? `?q=${encodeURIComponent(v)}` : location.pathname);
    }, 300);
  });
}
