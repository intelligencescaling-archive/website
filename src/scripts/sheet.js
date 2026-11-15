// On narrow screens a filter form becomes a panel that slides up from the bottom ("sheet").
// On wide screens the same form is a normal sidebar and none of this is visible.
export function initSheet({ form, toggle, backdrop, done }) {
  if (!form || !toggle || !backdrop) return { refresh() {} };
  const wide = window.matchMedia('(min-width: 900px)');
  let lastFocus = null;

  const isOpen = () => form.classList.contains('open');
  function open() {
    lastFocus = document.activeElement;
    form.classList.add('open');
    backdrop.classList.add('open');
    document.body.classList.add('sheet-open');
    toggle.setAttribute('aria-expanded', 'true');
    const first = form.querySelector('select, input, button');
    setTimeout(() => first?.focus({ preventScroll: true }), 50);
  }
  function close() {
    if (!isOpen()) return;
    form.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.classList.remove('sheet-open');
    toggle.setAttribute('aria-expanded', 'false');
    (lastFocus instanceof HTMLElement ? lastFocus : toggle).focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  backdrop.addEventListener('click', close);
  done?.addEventListener('click', close);
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });
  wide.addEventListener('change', () => wide.matches && close());

  // Keeps the "Filters (n)" badge in sync with how many filters are set.
  const badge = toggle.querySelector('.n');
  return {
    refresh(n) {
      if (!badge) return;
      badge.textContent = String(n);
      badge.hidden = n === 0;
      toggle.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
    },
  };
}
