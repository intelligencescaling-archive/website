// Reader view (src/pages/items/[id]/read.astro): text settings, the progress bar, the chapter list,
// "continue where you left off" and [ / ] for the previous / next chapter. The page works without
// this file (it is just the text). Settings and the reading position are stored only in this browser.
//
// Settings live in localStorage "reader" as { size, lh, w, sepia }; public/theme.js applies them
// before the page paints. Light/Dark use the site's own theme (window.siteTheme), Sepia is reader-only.

const KEY = 'reader';
const SIZES = { min: 15, max: 24, def: 18 };
const WPM = 230;

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: settings just aren't remembered */
  }
}
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const minutes = (words) => Math.max(0, Math.ceil(words / WPM));

export function initReader() {
  const reader = document.getElementById('reader');
  if (!reader) return;
  const root = document.documentElement;
  const id = reader.dataset.id;
  const unit = reader.dataset.unit || 'Chapter';
  const bar = reader.querySelector('.r-bar');
  const foot = document.getElementById('r-foot');
  const chapters = [...reader.querySelectorAll('.r-ch')];
  const words = chapters.map((c) => Number(c.dataset.words) || 0);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  const blocks = [...reader.querySelectorAll('.r-text > *')];
  const multi = chapters.length > 1;
  foot.hidden = false;

  // ---------- Settings ----------
  const raw = load(KEY) || {};
  const s = {
    size: Number.isInteger(raw.size) && raw.size >= SIZES.min && raw.size <= SIZES.max ? raw.size : SIZES.def,
    lh: ['tight', 'normal', 'loose'].includes(raw.lh) ? raw.lh : 'normal',
    w: ['narrow', 'medium', 'wide'].includes(raw.w) ? raw.w : 'medium',
    sepia: raw.sepia === true,
  };
  const settings = document.getElementById('r-settings');
  const sizeOut = document.getElementById('r-size');
  const themeMeta = [...document.querySelectorAll('meta[name="theme-color"]')];

  function siteTheme() {
    if (window.siteTheme) return window.siteTheme.current();
    return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function apply() {
    const set = (name, value, def) => (value === def ? root.removeAttribute(name) : root.setAttribute(name, String(value)));
    // Keep the reading place while the text reflows.
    const anchor = firstVisible();
    set('data-rsize', s.size, SIZES.def);
    set('data-rlh', s.lh, 'normal');
    set('data-rw', s.w, 'medium');
    if (s.sepia) root.setAttribute('data-reader', 'sepia');
    else root.removeAttribute('data-reader');
    if (anchor) anchor.el.scrollIntoView({ block: 'start' });
    if (anchor && anchor.offset) window.scrollBy(0, anchor.offset);
    syncControls();
    update();
  }
  function syncControls() {
    sizeOut.textContent = String(s.size);
    settings.querySelector('[data-size="-1"]').disabled = s.size <= SIZES.min;
    settings.querySelector('[data-size="1"]').disabled = s.size >= SIZES.max;
    const theme = s.sepia ? 'sepia' : siteTheme();
    for (const b of settings.querySelectorAll('[data-theme-pick]')) b.setAttribute('aria-pressed', String(b.dataset.themePick === theme));
    for (const b of settings.querySelectorAll('[data-lh]')) b.setAttribute('aria-pressed', String(b.dataset.lh === s.lh));
    for (const b of settings.querySelectorAll('[data-w]')) b.setAttribute('aria-pressed', String(b.dataset.w === s.w));
    if (s.sepia) for (const m of themeMeta) m.setAttribute('content', '#f6efe0');
  }
  function store() {
    const out = {};
    if (s.size !== SIZES.def) out.size = s.size;
    if (s.lh !== 'normal') out.lh = s.lh;
    if (s.w !== 'medium') out.w = s.w;
    if (s.sepia) out.sepia = true;
    save(KEY, Object.keys(out).length ? out : null);
  }
  settings.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.size) s.size = Math.min(SIZES.max, Math.max(SIZES.min, s.size + Number(b.dataset.size)));
    else if (b.dataset.lh) s.lh = b.dataset.lh;
    else if (b.dataset.w) s.w = b.dataset.w;
    else if (b.dataset.themePick) {
      const t = b.dataset.themePick;
      s.sepia = t === 'sepia';
      if (t !== 'sepia' && window.siteTheme) window.siteTheme.set(t);
    } else return;
    store();
    apply();
  });
  // The site's own light/dark toggle in the header still works here: it ends Sepia.
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    if (!s.sepia) return syncControls();
    s.sepia = false;
    store();
    apply();
  });

  // ---------- Sheets (settings, chapters) ----------
  const toc = document.getElementById('r-chapters');
  const aa = document.getElementById('r-aa');
  const tocBtn = document.getElementById('r-toc');
  function openSheet(dialog, opener) {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    dialog.showModal();
    opener.setAttribute('aria-expanded', 'true');
    dialog.addEventListener('close', () => opener.setAttribute('aria-expanded', 'false'), { once: true });
  }
  for (const d of [settings, toc]) {
    if (!d) continue;
    // A click on the backdrop (outside the panel) closes it.
    d.addEventListener('click', (ev) => {
      if (ev.target === d || ev.target.closest('[data-close]')) d.close();
    });
  }
  if (typeof settings.showModal === 'function') {
    aa.hidden = false;
    aa.addEventListener('click', () => openSheet(settings, aa));
    if (tocBtn && toc) {
      tocBtn.hidden = false;
      tocBtn.addEventListener('click', () => {
        markCurrent();
        openSheet(toc, tocBtn);
        toc.querySelector('[aria-current="true"]')?.focus();
      });
      toc.addEventListener('click', (ev) => {
        const a = ev.target.closest('a[data-ch]');
        if (!a) return;
        ev.preventDefault();
        toc.close();
        goTo(Number(a.dataset.ch) - 1);
      });
    }
  }
  function markCurrent() {
    if (!toc) return;
    const cur = state.ch;
    for (const a of toc.querySelectorAll('a[data-ch]')) {
      if (Number(a.dataset.ch) - 1 === cur) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }
  function goTo(i) {
    const c = chapters[i];
    if (!c) return;
    target = i; // a quick second [ or ] counts from here while the smooth scroll runs
    c.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    history.replaceState(null, '', `#ch-${i + 1}`);
    c.querySelector('h1, h2')?.setAttribute('tabindex', '-1');
    c.querySelector('h1, h2')?.focus({ preventScroll: true });
  }

  // ---------- Progress ----------
  const fill = document.getElementById('r-fill');
  const where = document.getElementById('r-where');
  const left = document.getElementById('r-left');
  const state = { ch: 0, pct: 0 };
  let target = null;
  const barH = () => (bar ? bar.getBoundingClientRect().height : 0);
  const footH = () => (foot ? foot.getBoundingClientRect().height : 0);

  function measure() {
    const top = barH() + 1;
    let ch = 0;
    for (let i = 0; i < chapters.length; i++) if (chapters[i].getBoundingClientRect().top <= top + 8) ch = i;
    // How far through the chapter the bottom of the visible text is.
    const r = chapters[ch].getBoundingClientRect();
    const seen = window.innerHeight - footH() - r.top;
    let frac = r.height > 0 ? Math.min(1, Math.max(0, seen / r.height)) : 0;
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
    if (atEnd && ch === chapters.length - 1) frac = 1;
    const before = words.slice(0, ch).reduce((a, b) => a + b, 0);
    const pct = Math.round(((before + frac * words[ch]) / total) * 100);
    return { ch, frac, pct, leftWords: (1 - frac) * words[ch] };
  }
  let ticking = false;
  function update() {
    ticking = false;
    const m = measure();
    state.ch = m.ch;
    if (target === m.ch) target = null;
    state.pct = m.pct;
    fill.style.transform = `scaleX(${m.pct / 100})`;
    where.textContent = multi ? `${unit} ${m.ch + 1} · ${m.pct}%` : `${m.pct}%`;
    const mins = minutes(m.leftWords);
    left.textContent = m.frac >= 1 || mins === 0 ? (multi ? `End of ${unit.toLowerCase()}` : 'The end') : `${mins} min left${multi ? ` in ${unit.toLowerCase()}` : ''}`;
    // Scrolled to (or past) the saved place by hand: the prompt has done its job.
    if (resumePending && saved && (firstVisible()?.i ?? 0) >= saved.i) hideResume();
    schedulePosSave();
  }
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  // ---------- Keyboard: [ and ] for the previous / next chapter ----------
  document.addEventListener('keydown', (ev) => {
    if (!multi || ev.altKey || ev.ctrlKey || ev.metaKey || document.querySelector('dialog[open]')) return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select, [contenteditable]')) return;
    const cur = target ?? state.ch;
    if (ev.key === ']') goTo(Math.min(chapters.length - 1, cur + 1));
    else if (ev.key === '[') {
      // Back to the start of this chapter first, unless already there.
      const atStart = target !== null || chapters[cur].getBoundingClientRect().top > -40;
      goTo(atStart ? Math.max(0, cur - 1) : cur);
    } else return;
    ev.preventDefault();
  });

  // ---------- Reading position ----------
  // Saved as the index of the first text block on screen (plus how far into it), so it survives a
  // change of text size or screen width. Never jumps on its own: a prompt offers it.
  const POS = `reader-pos:${id}`;
  function firstVisible() {
    if (!blocks.length) return null;
    const top = barH();
    let lo = 0;
    let hi = blocks.length - 1;
    // First block whose bottom is below the bar.
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    const el = blocks[lo];
    const offset = Math.max(0, top - el.getBoundingClientRect().top);
    return { el, i: lo, offset: Math.round(offset) };
  }
  let saveTimer = 0;
  function savePos() {
    saveTimer = 0;
    if (resumePending) return;
    const f = firstVisible();
    if (!f) return;
    if (state.pct < 1 && f.i === 0) return save(POS, null);
    const h = f.el.getBoundingClientRect().height || 1;
    save(POS, { i: f.i, f: Math.round((f.offset / h) * 1000) / 1000, ch: state.ch, pct: state.pct, t: Date.now() });
  }
  function schedulePosSave() {
    if (!saveTimer) saveTimer = setTimeout(savePos, 800);
  }
  window.addEventListener('pagehide', () => {
    if (saveTimer) clearTimeout(saveTimer);
    savePos();
  });

  const resume = document.getElementById('r-resume');
  const savedRaw = load(POS);
  const saved =
    savedRaw && Number.isInteger(savedRaw.i) && savedRaw.i > 0 && savedRaw.i < blocks.length && savedRaw.pct >= 1 ? savedRaw : null;
  let resumePending = false;
  function hideResume() {
    resumePending = false;
    resume.hidden = true;
    onScroll();
  }
  if (saved && !location.hash) {
    resumePending = true;
    document.getElementById('r-resume-where').textContent = multi ? `(${unit} ${(saved.ch || 0) + 1}, ${saved.pct}%)` : `(${saved.pct}%)`;
    resume.hidden = false;
    document.getElementById('r-resume-go').addEventListener('click', () => {
      const el = blocks[saved.i];
      hideResume();
      el.scrollIntoView({ block: 'start' });
      const f = Number(saved.f) || 0;
      if (f > 0 && f < 1) window.scrollBy(0, Math.round(f * el.getBoundingClientRect().height));
    });
    document.getElementById('r-resume-x').addEventListener('click', hideResume);
  }

  syncControls();
  update();
}
