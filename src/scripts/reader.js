// Reader view (src/components/Reader.astro): text settings, the progress bar, the "Go to" sheet (volume switch,
// position slider, list of parts and sections, Back to start; opened from the bottom bar, the ☰ button or g),
// "continue where you left off" and [ / ] for the previous / next part or section. Long docs are split into pages
// (/read/, /read/2/, …): progress counts the whole doc, and [ / ] and "continue" cross pages. The page works without
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
  const nums = chapters.map((c) => Number(c.dataset.n) || 1);
  const words = chapters.map((c) => Number(c.dataset.words) || 0);
  const after = chapters.map((c) => Number(c.dataset.after) || 0); // the chapter's words on later pages
  const pageWords = words.reduce((a, b) => a + b, 0);
  const before = Number(reader.dataset.before) || 0;
  const total = Number(reader.dataset.total) || pageWords || 1;
  const page = Number(reader.dataset.page) || 1;
  const pageCount = Number(reader.dataset.pages) || 1;
  const pageHref = (p) => (p <= 1 ? reader.dataset.base : `${reader.dataset.base}${p}/`);
  const blocks = [...reader.querySelectorAll('.r-text > *')];
  const multi = Boolean(reader.querySelector('.r-chap')); // an entry with several parts (chapters, volumes)
  const short = reader.dataset.short || unit;
  const heads = [...reader.querySelectorAll('.r-text > [id^="s-"]')]; // headings listed in the Go to sheet
  const starts = (reader.dataset.starts || '0').split(',').map(Number); // first word of each page
  const lastPage = page >= pageCount;
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

  // ---------- Sheets (settings, Go to) ----------
  const nav = document.getElementById('r-nav');
  const aa = document.getElementById('r-aa');
  const tocBtn = document.getElementById('r-toc');
  const gotoBtn = document.getElementById('r-goto');
  function openSheet(dialog, opener) {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    dialog.showModal();
    opener?.setAttribute('aria-expanded', 'true');
    dialog.addEventListener('close', () => opener?.setAttribute('aria-expanded', 'false'), { once: true });
  }
  for (const d of [settings, nav]) {
    if (!d) continue;
    // A click on the backdrop (outside the panel) closes it.
    d.addEventListener('click', (ev) => {
      if (ev.target === d || ev.target.closest('[data-close]')) d.close();
    });
  }
  // Word offset (in the whole doc) of every text block on this page, counted the same way as the build does.
  let blockW = null;
  function offsets() {
    if (blockW) return blockW;
    let w = before;
    blockW = blocks.map((el) => {
      const at = w;
      w += (el.textContent.match(/\S+/g) || []).length;
      return at;
    });
    return blockW;
  }
  // Word offset of the top of the screen.
  function currentWord() {
    const f = firstVisible();
    if (!f) return before;
    const w = offsets();
    const next = f.i + 1 < blocks.length ? w[f.i + 1] : before + pageWords;
    const h = f.el.getBoundingClientRect().height || 1;
    return Math.round(w[f.i] + (next - w[f.i]) * Math.min(1, f.offset / h));
  }
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    history.replaceState(null, '', location.pathname);
  }
  // Scrolls to a word offset on this page, or opens the page that has it (#w<offset> there).
  function jumpToWord(word) {
    const p = starts.reduce((k, s0, i) => (word >= s0 ? i + 1 : k), 1);
    if (p !== page) {
      location.href = `${pageHref(p)}#w${word}`;
      return;
    }
    if (resumePending) hideResume();
    const w = offsets();
    let i = 0;
    while (i + 1 < blocks.length && w[i + 1] <= word) i++;
    const el = blocks[i];
    if (!el || (page === 1 && word <= w[0])) return scrollToTop();
    const next = i + 1 < blocks.length ? w[i + 1] : before + pageWords;
    el.scrollIntoView({ block: 'start' });
    const frac = next > w[i] ? (word - w[i]) / (next - w[i]) : 0;
    if (frac > 0) window.scrollBy(0, Math.round(frac * el.getBoundingClientRect().height));
  }

  // The Go to sheet: a volume switch (volumes only), a slider over that volume (else the whole doc), the list of
  // parts and sections, and Back to start. A bottom sheet on phones, a side panel on wide screens (CSS).
  let navVol = 0;
  let range = null;
  const vols = nav?.querySelector('.r-vols');
  const lists = nav ? [...nav.querySelectorAll('.r-toc')] : [];
  const listStart = (l) => Number(l.querySelector('a[data-w]')?.dataset.w) || 0;
  function scope() {
    if (!vols) return { from: 0, to: total };
    const i = lists.findIndex((l) => Number(l.dataset.vol) === navVol);
    const from = listStart(lists[i]);
    const to = lists[i + 1] ? listStart(lists[i + 1]) : total;
    return { from, to: Math.max(from + 1, to) };
  }
  const rowsInScope = () => lists.filter((l) => !vols || Number(l.dataset.vol) === navVol).flatMap((l) => [...l.querySelectorAll('a[data-w]')]);
  function rowAt(word, rows = rowsInScope()) {
    let row = null;
    for (const a of rows) if (Number(a.dataset.w) <= word) row = a;
    return row;
  }
  function showVol(v) {
    navVol = v;
    for (const b of vols.querySelectorAll('button[data-vol]')) b.setAttribute('aria-pressed', String(Number(b.dataset.vol) === v));
    for (const l of lists) l.hidden = Number(l.dataset.vol) !== v;
  }
  function drawTicks() {
    const box = document.getElementById('r-ticks');
    const { from, to } = scope();
    const rows = rowsInScope().filter((a) => !a.classList.contains('r-toc-sub'));
    box.replaceChildren();
    if (rows.length > 80) return;
    for (const a of rows) {
      const x = (Number(a.dataset.w) - from) / (to - from);
      if (x <= 0.003 || x >= 1) continue;
      const t = document.createElement('i');
      t.style.left = `${(x * 100).toFixed(2)}%`;
      box.append(t);
    }
  }
  function rangeLabel() {
    const { from, to } = scope();
    const word = from + (Number(range.value) / 1000) * (to - from);
    const row = rowAt(word);
    const pct = Math.round(Number(range.value) / 10);
    const name = row ? row.querySelector('.r-toc-t').textContent.trim() : '';
    document.getElementById('r-jump-at').textContent = name ? `${pct}% · ${name}` : `${pct}%`;
    range.setAttribute('aria-valuetext', name ? `${pct}%, ${name}` : `${pct}%`);
    return Math.round(word);
  }
  function setRangeTo(word) {
    const { from, to } = scope();
    range.value = String(Math.round(Math.min(1, Math.max(0, (word - from) / (to - from))) * 1000));
    rangeLabel();
  }
  function markRow(cur) {
    const all = lists.flatMap((l) => [...l.querySelectorAll('a[data-w]')]);
    const row = rowAt(cur, all);
    for (const a of all) {
      if (a === row) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    return row;
  }
  function initNav() {
    range = document.getElementById('r-range');
    nav.querySelector('.r-jump').hidden = false;
    vols?.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-vol]');
      if (!b) return;
      showVol(Number(b.dataset.vol));
      drawTicks();
      const cur = currentWord();
      const { from, to } = scope();
      setRangeTo(cur >= from && cur < to ? cur : from);
    });
    range.addEventListener('input', rangeLabel);
    // Jumps when the slider is let go (or changed with the keyboard); the sheet stays open to fine-tune.
    range.addEventListener('change', () => {
      jumpToWord(rangeLabel());
      markRow(currentWord())?.scrollIntoView({ block: 'nearest' });
    });
    nav.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[data-w], #r-start');
      if (!a) return;
      if (a.id === 'r-start') {
        if (page !== 1) return; // the link opens page 1
        ev.preventDefault();
        nav.close();
        if (resumePending) hideResume();
        scrollToTop();
        return;
      }
      // A part or section on another page: the link goes there.
      const el = document.getElementById(a.dataset.s ? `s-${a.dataset.s}` : `ch-${a.dataset.ch}`);
      if (!el) return;
      ev.preventDefault();
      nav.close();
      goTo(el);
    });
  }
  function openNav(opener) {
    const cur = currentWord();
    if (vols) {
      let v = 0;
      for (const l of lists) if (listStart(l) <= cur) v = Number(l.dataset.vol);
      showVol(v);
    }
    drawTicks();
    setRangeTo(cur);
    const row = markRow(cur);
    openSheet(nav, opener);
    row?.scrollIntoView({ block: 'nearest' });
    range.focus();
  }
  function goTo(el) {
    if (!el) return;
    if (resumePending) hideResume();
    target = el; // a quick second [ or ] counts from here while the smooth scroll runs
    el.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    history.replaceState(null, '', `#${el.id}`);
    const h = el.matches('h1, h2, h3, h4, h5, h6') ? el : el.querySelector('h1, h2');
    h?.setAttribute('tabindex', '-1');
    h?.focus({ preventScroll: true });
  }
  if (typeof settings.showModal === 'function') {
    aa.hidden = false;
    aa.addEventListener('click', () => openSheet(settings, aa));
    if (nav) {
      tocBtn.hidden = false;
      tocBtn.addEventListener('click', () => openNav(tocBtn));
      gotoBtn?.addEventListener('click', () => openNav(gotoBtn));
      initNav();
    }
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
    const done = before + words.slice(0, ch).reduce((a, b) => a + b, 0);
    const pct = Math.min(100, Math.round(((done + frac * words[ch]) / total) * 100));
    let head = null;
    for (const h of heads) {
      if (h.getBoundingClientRect().top > top + 8) break;
      head = h;
    }
    if (head && !chapters[ch].contains(head)) head = null;
    return { ch, frac, pct, head, leftWords: (1 - frac) * words[ch] + after[ch] };
  }
  let ticking = false;
  function update() {
    ticking = false;
    const m = measure();
    state.ch = m.ch;
    if (target && (target === chapters[m.ch] || target === m.head)) target = null;
    state.pct = m.pct;
    fill.style.transform = `scaleX(${m.pct / 100})`;
    // "Vol 1 · Chapter 5: The Bet · 42%"; the section name is cut with … by CSS when long.
    where.replaceChildren();
    const parts = [multi && `${short} ${nums[m.ch]}`, m.head?.textContent.trim(), `${m.pct}%`].filter(Boolean);
    parts.forEach((t, k) => {
      const span = document.createElement('span');
      span.textContent = k < parts.length - 1 ? `${t} · ` : t;
      if (m.head && t === parts[parts.length - 2]) span.className = 'r-sec';
      where.append(span);
    });
    const mins = minutes(m.leftWords);
    const endText = !lastPage && m.ch === chapters.length - 1 ? 'End of page' : multi ? `End of ${unit.toLowerCase()}` : 'The end';
    left.textContent =
      m.frac >= 1 || mins === 0 ? endText : `${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} left${multi ? ` in ${unit.toLowerCase()}` : pageCount > 1 ? ' on this page' : ''}`;
    // Scrolled to (or past) the saved place by hand: the prompt has done its job.
    if (resumePending && saved && saved.p === page && (firstVisible()?.i ?? 0) >= saved.i) hideResume();
    // Reading on here instead of going to the saved page: stop offering it.
    else if (resumePending && saved && saved.p !== page && window.scrollY > window.innerHeight) hideResume();
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

  // ---------- Keyboard: [ and ] for the previous / next part or section (or page), g for Go to ----------
  // Stops: the start of every part on this page and every listed heading, in page order.
  const stops = [...chapters, ...heads].sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || document.querySelector('dialog[open]')) return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select, [contenteditable]')) return;
    if (ev.key === 'g' && nav && !tocBtn.hidden) {
      ev.preventDefault();
      openNav(tocBtn);
      return;
    }
    if ((ev.key !== '[' && ev.key !== ']') || (stops.length < 2 && pageCount < 2)) return;
    let cur = target ? stops.indexOf(target) : 0;
    if (!target) for (let i = 0; i < stops.length; i++) if (stops[i].getBoundingClientRect().top <= barH() + 8) cur = i;
    if (ev.key === ']') {
      if (cur < stops.length - 1) goTo(stops[cur + 1]);
      else if (reader.dataset.next) location.href = reader.dataset.next;
      else return;
    } else {
      // Back to the start of this part or section first, unless already there.
      const atStart = target !== null || stops[cur].getBoundingClientRect().top > -40;
      if (atStart && cur === 0 && reader.dataset.prev) location.href = reader.dataset.prev;
      else goTo(stops[atStart ? Math.max(0, cur - 1) : cur]);
    }
    ev.preventDefault();
  });

  // ---------- Reading position ----------
  // Saved as the index of the first text block on screen (plus how far into it), so it survives a
  // change of text size or screen width. Never jumps on its own: a prompt offers it. One position per doc, with
  // its page number (p); on another page the prompt goes to that page (#resume there jumps to the place).
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
    if (state.pct < 1 && f.i === 0 && page === 1) return save(POS, null);
    const h = f.el.getBoundingClientRect().height || 1;
    save(POS, { p: page, i: f.i, f: Math.round((f.offset / h) * 1000) / 1000, ch: nums[state.ch] - 1, pct: state.pct, t: Date.now() });
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
  const savedPage = Number.isInteger(savedRaw?.p) ? savedRaw.p : 1;
  // Saved at the end of the page before this one: that's just where the reader left it to come here.
  const startPct = Math.floor((before / total) * 100);
  const saved =
    savedRaw && Number.isInteger(savedRaw.i) && savedRaw.i >= 0 && savedRaw.pct >= 1 && savedPage >= 1 && savedPage <= pageCount &&
    (savedPage === page ? savedRaw.i > 0 && savedRaw.i < blocks.length : !(savedPage === page - 1 && savedRaw.pct >= startPct - 1))
      ? { ...savedRaw, p: savedPage }
      : null;
  let resumePending = false;
  function hideResume() {
    resumePending = false;
    resume.hidden = true;
    onScroll();
  }
  function jumpToSaved() {
    const el = blocks[saved.i];
    hideResume();
    el.scrollIntoView({ block: 'start' });
    const f = Number(saved.f) || 0;
    if (f > 0 && f < 1) window.scrollBy(0, Math.round(f * el.getBoundingClientRect().height));
  }
  if (saved && saved.p === page && location.hash === '#resume') {
    // Came here from the "continue" prompt on another page.
    history.replaceState(null, '', location.pathname);
    requestAnimationFrame(jumpToSaved);
  } else if (saved && !location.hash) {
    resumePending = true;
    const pg = pageCount > 1 && saved.p !== page ? `page ${saved.p}, ` : '';
    document.getElementById('r-resume-where').textContent = multi ? `(${unit} ${(saved.ch || 0) + 1}, ${saved.pct}%)` : `(${pg}${saved.pct}%)`;
    resume.hidden = false;
    document.getElementById('r-resume-go').addEventListener('click', () => {
      if (saved.p !== page) location.href = `${pageHref(saved.p)}#resume`;
      else jumpToSaved();
    });
    document.getElementById('r-resume-x').addEventListener('click', hideResume);
  }

  // #w<offset>: a slider jump from another page. #ch-n / #s-n for a part or section on another page (an item page
  // links to /read/#ch-2 without knowing the page): follow the Go to sheet's link for it.
  const hw = /^#w(\d+)$/.exec(location.hash);
  if (hw) {
    history.replaceState(null, '', location.pathname);
    requestAnimationFrame(() => jumpToWord(Number(hw[1])));
  } else if (nav && /^#(ch|s)-\d+$/.test(location.hash) && !document.getElementById(location.hash.slice(1))) {
    const [kind, n] = location.hash.slice(1).split('-');
    const a = nav.querySelector(kind === 'ch' ? `a[data-ch="${n}"]` : `a[data-s="${n}"]`);
    if (a && !a.getAttribute('href').startsWith('#')) location.replace(a.href);
  }

  syncControls();
  update();
}
