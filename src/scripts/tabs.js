// Text-tab strips (character kinds, search scope). When a strip doesn't fit: first the counts of the inactive tabs
// go; if it still doesn't fit, tabs from the end (never the first or the selected one) hide behind "+N ⌄", whose menu
// lists them. Picking a tab (or a menu item) selects it, re-fits, and fires a "tabpick" event on the strip
// (detail = the tab's data-kind). Also: small popup menus (sort, "+N"): one open at a time, Escape closes.
const DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function fitStrip(strip) {
  const tabs = [...strip.querySelectorAll('.tb:not([data-more-tabs])')];
  tabs.forEach((t) => (t.hidden = false));
  strip.classList.remove('lean');
  strip.querySelector('[data-more-tabs]')?.remove();
  strip.parentNode.querySelector('[data-tab-pop]')?.remove();
  const fits = () => strip.scrollWidth <= strip.clientWidth + 1;
  if (!strip.clientWidth || fits()) return;
  strip.classList.add('lean');
  if (fits()) return;
  strip.classList.remove('lean');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'tb';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.dataset.moreTabs = '1';
  strip.appendChild(more);
  const hidden = [];
  for (let i = tabs.length - 1; i > 0 && !fits(); i--) {
    if (tabs[i].getAttribute('aria-selected') === 'true') continue;
    tabs[i].hidden = true;
    hidden.unshift(tabs[i]);
    more.innerHTML = `+${hidden.length}${DOWN}`;
    more.setAttribute('aria-label', `${hidden.length} more`);
  }
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'menu');
  pop.hidden = true;
  pop.dataset.tabPop = '1';
  for (const t of hidden) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.pick = t.dataset.kind;
    b.textContent = t.dataset.label || t.firstChild?.textContent || t.dataset.kind;
    const n = t.querySelector('.n');
    if (n) {
      const s = document.createElement('span');
      s.className = 'n';
      s.textContent = n.textContent;
      b.append(s);
    }
    pop.append(b);
  }
  strip.parentNode.appendChild(pop);
}

export function fitAll(root = document) {
  root.querySelectorAll('.tabs[data-fit]').forEach(fitStrip);
}

let opener = null;
export function closePops(except) {
  document.querySelectorAll('.pop').forEach((p) => {
    if (p !== except) p.hidden = true;
  });
  document.querySelectorAll('[data-sort-btn][aria-expanded="true"], [data-more-tabs][aria-expanded="true"]').forEach((b) => {
    if (!except || !b.parentNode.contains(except)) b.setAttribute('aria-expanded', 'false');
  });
}
export function togglePop(pop, btn) {
  const open = pop.hidden;
  closePops(pop);
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  opener = open ? btn : null;
  if (open) pop.querySelector('[aria-checked="true"]') ? pop.querySelector('[aria-checked="true"]').focus() : pop.querySelector('button')?.focus();
}

export function selectTab(strip, kind) {
  strip.querySelectorAll('.tb[data-kind]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kind === kind)));
  fitStrip(strip);
  strip.dispatchEvent(new CustomEvent('tabpick', { detail: kind }));
}

let wired = false;
export function initTabs() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    let b;
    if ((b = t.closest('[data-more-tabs]'))) {
      const pop = b.closest('.tabw').querySelector('[data-tab-pop]');
      if (pop) togglePop(pop, b);
      return;
    }
    if ((b = t.closest('[data-pick]'))) {
      const strip = b.closest('.tabw').querySelector('.tabs');
      closePops();
      selectTab(strip, b.dataset.pick);
      strip.querySelector('.tb[aria-selected="true"]')?.focus();
      return;
    }
    if ((b = t.closest('.tabs[data-fit] .tb[data-kind]'))) {
      closePops();
      selectTab(b.closest('.tabs'), b.dataset.kind);
      return;
    }
    if ((b = t.closest('[data-sort-btn]'))) {
      const pop = b.parentNode.querySelector('[data-sort-pop]');
      if (pop) togglePop(pop, b);
      return;
    }
    if (!t.closest('.pop')) closePops();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const open = document.querySelector('.pop:not([hidden])');
    if (!open) return;
    closePops();
    opener?.focus();
    opener = null;
    ev.stopPropagation();
  });
  // Arrow keys inside an open menu.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const pop = ev.target.closest?.('.pop');
    if (!pop) return;
    ev.preventDefault();
    const items = [...pop.querySelectorAll('button')];
    const i = items.indexOf(ev.target);
    items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  });
  let w = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === w) return;
    w = innerWidth;
    fitAll();
  });
  fitAll();
  document.fonts?.ready.then(() => fitAll());
}
