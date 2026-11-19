// Every page: the phone menu sheet, the "/" shortcut, and the lists (preview of N rows + "All N" in place, sort,
// kind tabs). The lists only hide, show and reorder rows that are already in the HTML; nothing is built from data.
import { initTabs, closePops } from './tabs.js';

const SORT_LABEL = { w: 'Most words', az: 'A–Z · Words' };

/** Re-applies a list's sort, kind filter and preview cap. */
export function relist(ul) {
  const cap = Number(ul.dataset.cap) || 0;
  const sort = ul.dataset.sort || 'w';
  const kind = ul.dataset.kind || '';
  let items = [...ul.children];
  if ((ul.dataset.sorted || 'w') !== sort) {
    const r = (li) => Number(li.dataset.r) || 0;
    items.sort(sort === 'az' ? (a, b) => r(a) - r(b) : (a, b) => Number(b.dataset.w) - Number(a.dataset.w) || r(a) - r(b));
    ul.append(...items);
    ul.dataset.sorted = sort;
  }
  const match = kind ? items.filter((li) => ` ${li.dataset.k || ''} `.includes(` ${kind} `)) : items;
  const on = new Set(match);
  // No "All" row when it would hide a single row.
  const show = ul.dataset.open === '1' || !cap || match.length <= cap + 1 ? match.length : cap;
  let i = 0;
  for (const li of items) {
    li.hidden = !on.has(li);
    li.classList.toggle('cut', on.has(li) && i++ >= show);
  }
  if (kind) ul.dataset.kindOn = '1';
  else delete ul.dataset.kindOn;
  const sec = ul.parentNode;
  const all = sec.querySelector(':scope > [data-expand]');
  const end = sec.querySelector(':scope > .end');
  if (all) {
    all.hidden = show >= match.length;
    const label = all.querySelector('.lbl');
    if (label) label.textContent = `All ${match.length} ${all.dataset.noun || 'docs'}`;
  }
  if (end) end.hidden = !!all && !all.hidden;
}

function initLists() {
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    let b;
    if ((b = t.closest('[data-expand]'))) {
      const ul = b.parentNode.querySelector(':scope > [data-list]');
      if (!ul) return;
      ev.preventDefault();
      const first = [...ul.children].find((li) => li.classList.contains('cut'));
      ul.dataset.open = '1';
      relist(ul);
      first?.querySelector('a, button, label')?.focus({ preventScroll: true });
      return;
    }
    if ((b = t.closest('[data-sort]'))) {
      const head = b.closest('.lh');
      const ul = head?.parentNode.querySelector(':scope > [data-list]');
      if (!ul) return;
      closePops();
      ul.dataset.sort = b.dataset.sort;
      head.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      const btn = head.querySelector('[data-sort-btn]');
      btn.querySelector('span').textContent = b.dataset.label || SORT_LABEL[b.dataset.sort];
      btn.focus();
      relist(ul);
      ul.dispatchEvent(new CustomEvent('listsort'));
    }
  });
  // Kind tabs over a list (character pages).
  document.querySelectorAll('.tabs[data-for]').forEach((strip) => {
    strip.addEventListener('tabpick', (ev) => {
      const ul = document.getElementById(strip.dataset.for);
      if (!ul) return;
      ul.dataset.kind = ev.detail === 'all' ? '' : ev.detail;
      delete ul.dataset.open;
      relist(ul);
    });
  });
}

function initMenu() {
  const btn = document.getElementById('menu-btn');
  const sheet = document.getElementById('menu-sheet');
  if (!btn || !sheet) return;
  const root = document.documentElement;
  btn.setAttribute('role', 'button');
  const set = (open) => {
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    root.classList.toggle('sheet-open', open);
  };
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    const open = sheet.hidden;
    set(open);
    if (open) sheet.querySelector('a')?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !sheet.hidden) {
      set(false);
      btn.focus();
    }
  });
  matchMedia('(min-width: 768px)').addEventListener('change', (m) => m.matches && !sheet.hidden && set(false));
}

function initSlash() {
  if (location.pathname === '/search/') return; // the search page focuses its own field
  addEventListener('keydown', (ev) => {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    ev.preventDefault();
    location.href = '/search/';
  });
}

export function initSite() {
  initTabs();
  initLists();
  initMenu();
  initSlash();
}
