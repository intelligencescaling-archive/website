// Rich reader: renders a part's blocks.json (the DOCX as reader blocks: text runs with bold/italic/links/colours,
// headings, lists, tables, images; block format v1, written by the archive's converter) into the reader page.
// Pages, URLs and positions stay those of the plain-text reader: every top-level block carries `w`, the offset of
// its first word counted exactly like readerChapters (src/lib/archive.mjs), so it goes on the page whose word range
// holds it, and old #s-N heading targets stay where they were.
//
// The data is untrusted (submissions): every value is checked, every string is escaped here (the reader inserts
// this HTML with set:html), links are only https/http/mailto/#bookmark, colours only 6-digit hex or a text token,
// image files only plain names under IMAGES_URL. No inline styles (the CSP has style-src 'self'): per-image sizes and
// the doc's colours go into /items/<id>/read/doc.css (src/pages/items/[id]/read/doc.css.js), with class names that
// are a hash of the values, so the page and the stylesheet always agree.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { IMAGES_URL } from './config.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const HEX = /^[0-9a-f]{6}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9]{0,15}$/;
const IMG_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\.webp$/;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
const rnd = (x, d = 5) => String(Number(x.toFixed(d)));
const arr = (v) => (Array.isArray(v) ? v : []);
const THEMES = ['l', 'd', 's'];
/** Phone text column at 375 px (rows of images narrower than 120 px tall there are shown one by one instead). */
const PHONE_COL = 343;
/** Widest reader column in CSS px (65ch at 18 px); for `sizes`. */
const DESK_COL = 680;

/** A part's blocks, or null when missing, not v1, or out of step with the text (its word count differs). */
export function readBlocks(file, words) {
  if (!file) return null;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!d || d.v !== 1 || !Array.isArray(d.b)) return null;
    if (words !== undefined && d.words !== words) return null;
    // bw: the blocks' own word count when they hold far more than the text file (text boxes); header only.
    d.bw = Number.isInteger(d.bw) && d.bw > d.words ? d.bw : null;
    if (!d.pal || typeof d.pal !== 'object') d.pal = {};
    if (!d.img || typeof d.img !== 'object') d.img = {};
    return d;
  } catch {
    return null;
  }
}

const runText = (rs) => arr(rs).map((r) => (r && typeof r.t === 'string' ? r.t : '')).join('');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const anchorId = (name) => `a-${String(name).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100)}`;
const anchorNames = (an) => arr(an).filter((x) => typeof x === 'string' && x).slice(0, 20);
const isObj = (b) => b && typeof b === 'object' && typeof b.k === 'string';

/** Every bookmark name in a block and the blocks inside it. */
function eachAnchor(b, fn) {
  if (!isObj(b)) return;
  for (const a of anchorNames(b.an)) fn(a);
  for (const row of arr(b.rows)) for (const c of arr(row?.c)) for (const x of arr(c?.b)) eachAnchor(x, fn);
  for (const x of arr(b.b)) eachAnchor(x, fn);
  for (const n of arr(b.notes)) for (const x of arr(n?.b)) eachAnchor(x, fn);
}

/**
 * Lays the rich parts of an entry out over the reader's pages (readerPages). Returns null when no part has usable
 * blocks. `data[i]` = blocks of chapter i (null: that part uses the plain text), `items(i, k)` = its top-level blocks
 * on page k, `heads[i]` = its top-level headings `{ id, sid?, w, level, text, page }` (doc-wide word offset `w`).
 * A heading at the same word offset as a plain-text heading keeps that one's id `s-<sid>`; other plain-text headings
 * get an empty anchor (`pre`) so old links still land in the right place.
 */
export function richLayout(chapters, pages) {
  const data = chapters.map((c) => readBlocks(c.blocksPath, c.words));
  if (!data.some(Boolean)) return null;
  const starts = chapters.map(() => []);
  pages.forEach((p, k) => p.chapters.forEach((part) => starts[part.i].push({ k, w: part.blocks.length ? part.blocks[0].w : chapters[part.i].w })));
  const onPage = new Map();
  const anchors = new Map();
  const heads = chapters.map(() => []);
  let hid = 0;
  data.forEach((d, i) => {
    if (!d) return;
    const c = chapters[i];
    const st = starts[i].length ? starts[i] : [{ k: 0, w: c.w }];
    const pageOf = (w) => {
      let k = st[0].k;
      for (const s of st) if (s.w <= w) k = s.k;
      return k;
    };
    const items = d.b.filter(isObj).map((b) => {
      const w = c.w + (Number.isInteger(b.w) && b.w >= 0 ? Math.min(b.w, c.words) : 0);
      return { b, w, k: pageOf(w), pre: [] };
    });
    const textHeads = c.blocks.filter((b) => b.level > 0);
    const atWord = new Map();
    for (const t of textHeads) if (!atWord.has(t.w)) atWord.set(t.w, t);
    const used = new Set();
    for (const it of items) {
      if (it.b.k !== 'h') continue;
      const text = clean(runText(it.b.r));
      if (!text) continue;
      const t = atWord.get(it.w);
      if (t && !used.has(t.sid)) {
        used.add(t.sid);
        it.id = `s-${t.sid}`;
        it.sid = t.sid;
      } else it.id = `h-${++hid}`;
      const level = Math.min(3, Math.max(1, Number.isInteger(it.b.l) ? it.b.l : 1));
      heads[i].push({ id: it.id, sid: it.sid, w: it.w, level, text, page: it.k });
    }
    for (const t of textHeads) {
      if (used.has(t.sid)) continue;
      const it = items.find((x) => x.w >= t.w) || items[items.length - 1];
      if (it) it.pre.push({ id: `s-${t.sid}`, text: t.text });
    }
    for (const it of items) {
      eachAnchor(it.b, (a) => anchors.has(a) || anchors.set(a, it.k));
      const key = `${it.k}:${i}`;
      if (!onPage.has(key)) onPage.set(key, []);
      onPage.get(key).push(it);
    }
  });
  return { data, heads, anchors, items: (i, k) => onPage.get(`${k}:${i}`) || [] };
}

/**
 * Per-page render state: image and table numbers, how many images still load eagerly (R5: the first 2), and the
 * CSS rules the HTML needs (`styles`, class -> declarations; doc.css.js collects them).
 */
export function pageContext({ layout, page, pageHref, missHref }) {
  return { layout, page, pageHref, missHref, imgN: 0, eager: 2, tables: 0, chars: 0, styles: new Map() };
}

/** HTML of chapter i's blocks on page k (ctx.page). `multi`: the entry has several parts (headings one level lower). */
export function renderPart(ctx, i, { multi = false, missHref = '' } = {}) {
  const d = ctx.layout.data[i];
  const c = { ...ctx, d, sfx: i ? `_${i + 1}` : '', base: multi ? 3 : 2, miss: missHref };
  const html = renderList(ctx.layout.items(i, ctx.page), c, true);
  for (const key of COUNTERS) ctx[key] = c[key];
  return html;
}

// ---------------------------------------------------------------- blocks
const COUNTERS = ['imgN', 'eager', 'tables', 'chars'];
const nested = (list) => arr(list).filter(isObj).map((b) => ({ b }));
function trimGaps(list) {
  let a = 0;
  let z = list.length;
  while (a < z && list[a].b.k === 'gap') a++;
  while (z > a && list[z - 1].b.k === 'gap') z--;
  return list.slice(a, z);
}

/** Adds the gap class and data-w to an element that starts with `<tag class="...">`. */
function finish(html, extra, w) {
  const m = /^<([a-z0-9]+) class="([^"]*)"/.exec(html);
  if (!m) return html;
  const cls = [extra, m[2]].filter(Boolean).join(' ');
  return `<${m[1]}${cls ? ` class="${cls}"` : ''}${w !== undefined ? ` data-w="${w}"` : ''}${html.slice(m[0].length)}`;
}

function renderList(items, ctx, top) {
  let out = '';
  let gap = false;
  for (let j = 0; j < items.length; ) {
    const it = items[j];
    const b = it.b;
    const w = top ? it.w : undefined;
    if (top && !ctx.inBox && Number.isInteger(b.tb)) {
      // Blocks from one single-column "box" table: one thin frame around them. Their blocks stay reader blocks
      // (data-w, headings), so positions and Go to work inside the frame too (src/scripts/reader.js).
      let n = 1;
      while (j + n < items.length && items[j + n].b.tb === b.tb) n++;
      const sub = { ...ctx, inBox: true };
      const inner = renderList(trimGaps(items.slice(j, j + n)), sub, true);
      for (const key of COUNTERS) ctx[key] = sub[key];
      j += n;
      if (inner) out += `<div class="${gap ? 'gp ' : ''}tbx">${inner}</div>`;
      gap = false;
      continue;
    }
    for (const p of arr(it.pre)) out += `<span class="r-an" id="${esc(p.id)}"${w !== undefined ? ` data-w="${w}"` : ''}></span>`;
    let html = '';
    let n = 1;
    if (b.k === 'gap') {
      gap = out !== '';
      j++;
      continue;
    } else if (b.k === 'li') {
      while (j + n < items.length && items[j + n].b.k === 'li' && items[j + n].b.n === b.n && !arr(items[j + n].pre).length) n++;
      html = list(items.slice(j, j + n).map((x) => x.b), ctx);
    } else if (b.k === 'img') {
      if (b.g !== undefined && b.g !== null)
        while (j + n < items.length && items[j + n].b.k === 'img' && items[j + n].b.g === b.g && !arr(items[j + n].pre).length) n++;
      html = images(items.slice(j, j + n).map((x) => x.b), ctx, top, w);
    } else html = block(it, ctx, top);
    j += n;
    if (!html) continue;
    out += b.k === 'img' ? html.replace(/^<figure class="/, gap ? '<figure class="gp ' : '<figure class="') : finish(html, gap ? 'gp' : '', w);
    gap = false;
  }
  return out;
}

function anchorSpan(ids) {
  return `<span class="r-an" id="${ids[0]}">${ids.slice(1).map((x) => `<span id="${x}"></span>`).join('')}</span>`;
}

function align(b, text) {
  // Centre/right only for short lines (titles, captions, credit lines); long centred prose reads badly on a phone.
  if ((b.al === 'c' || b.al === 'r') && text.length <= 60) return `al-${b.al}`;
  return '';
}

function block(it, ctx, top) {
  const b = it.b;
  switch (b.k) {
    case 'p':
      return para(b, ctx);
    case 'h':
      return heading(b, ctx, top ? it.id : undefined);
    case 'table':
      return table(b, ctx);
    case 'hr':
      return '<hr class="">';
    case 'sep':
      return '<hr class="sep">';
    case 'box': {
      const inner = renderList(trimGaps(nested(b.b)), ctx, false);
      return inner ? `<div class="bx">${inner}</div>` : '';
    }
    case 'notes': {
      const lis = arr(b.notes)
        .map((nt) => {
          const inner = renderList(trimGaps(nested(nt?.b)), ctx, false);
          const n = Number.isInteger(nt?.n) ? nt.n : '';
          return inner ? `<li><span class="mk">${n}</span><div>${inner}</div></li>` : '';
        })
        .join('');
      return lis ? `<ol class="notes">${lis}</ol>` : '';
    }
    case 'anchor': {
      const ids = anchorNames(b.an).map(anchorId);
      return ids.length ? anchorSpan(ids) : '';
    }
    default:
      return ''; // 'break' (a DOCX page break) and anything unknown
  }
}

function para(b, ctx) {
  const text = runText(b.r);
  const ids = anchorNames(b.an).map(anchorId);
  if (!text.trim() && !arr(b.r).some((r) => r && r.img)) return ids.length ? anchorSpan(ids) : '';
  const cls = [align(b, text), palClass(b.bg, ctx)].filter(Boolean).join(' ');
  const extra = ids.slice(1).map((x) => `<span id="${x}"></span>`).join('');
  return `<p class="${cls}"${ids.length ? ` id="${ids[0]}"` : ''}>${extra}${runs(b.r, ctx)}</p>`;
}

function heading(b, ctx, id) {
  const text = runText(b.r);
  const ids = anchorNames(b.an).map(anchorId);
  if (!text.trim()) return ids.length ? anchorSpan(ids) : '';
  const l = Math.min(3, Math.max(1, Number.isInteger(b.l) ? b.l : 1));
  const tag = `h${Math.min(ctx.base + l - 1, 6)}`;
  const own = id ? esc(id) : ids.shift();
  const cls = [align(b, text), palClass(b.bg, ctx)].filter(Boolean).join(' ');
  const extra = ids.map((x) => `<span id="${x}"></span>`).join('');
  return `<${tag} class="${cls}"${own ? ` id="${own}"` : ''}>${extra}${runs(b.r, ctx)}</${tag}>`;
}

function list(items, ctx) {
  const lis = items
    .map((it) => {
      let m = typeof it.m === 'string' ? it.m.trim().slice(0, 12) : '';
      // Word's symbol-font bullets are private-use characters: show a plain bullet.
      if (!m || /^[-]$/.test(m)) m = it.list === 'ol' ? '' : '•';
      const l = Number.isInteger(it.l) ? Math.min(8, Math.max(0, it.l)) : 0;
      const ids = anchorNames(it.an).map(anchorId);
      const cls = [l ? `lv${l}` : '', palClass(it.bg, ctx)].filter(Boolean).join(' ');
      const extra = ids.slice(1).map((x) => `<span id="${x}"></span>`).join('');
      return `<li${cls ? ` class="${cls}"` : ''}${ids.length ? ` id="${ids[0]}"` : ''}><span class="mk">${esc(m)}</span><span>${extra}${runs(it.r, ctx)}</span></li>`;
    })
    .join('');
  const tag = items[0].list === 'ol' ? 'ol' : 'ul';
  return `<${tag} class="l">${lis}</${tag}>`;
}

function table(b, ctx) {
  const n = ++ctx.tables;
  const rows = arr(b.rows)
    .map((row) => {
      const head = row?.h === 1;
      const cells = arr(row?.c)
        .map((c) => {
          const tag = head ? 'th' : 'td';
          const cs = Number.isInteger(c?.cs) && c.cs > 1 ? ` colspan="${Math.min(c.cs, 100)}"` : '';
          const rs = Number.isInteger(c?.rs) && c.rs > 1 ? ` rowspan="${Math.min(c.rs, 1000)}"` : '';
          const bg = palClass(c?.bg, ctx);
          const inner = renderList(trimGaps(nested(c?.b)), ctx, false);
          return `<${tag}${cs}${rs}${bg ? ` class="${bg}"` : ''}${head ? ' scope="col"' : ''}>${inner}</${tag}>`;
        })
        .join('');
      // An empty row is still a row: a cell above may span into it (rowspan).
      return `<tr>${cells}</tr>`;
    })
    .join('');
  if (!rows.replace(/<\/?tr>/g, '')) return '';
  // Only a table wider than the column becomes a focusable "Table N" scroll region (src/scripts/reader.js).
  return `<div class="tw" data-n="${n}"><table>${rows}</table></div>`;
}

// ---------------------------------------------------------------- runs
function linkHref(a, ctx) {
  if (typeof a !== 'string') return null;
  if (a.startsWith('#') && a.length > 1) {
    const page = ctx.layout.anchors.get(a.slice(1));
    const id = anchorId(a.slice(1));
    return page === undefined || page === ctx.page ? `#${id}` : `${ctx.pageHref(page)}#${id}`;
  }
  if (/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(a) && a.length <= 2000) return a;
  return null;
}

function runs(rs, ctx) {
  let out = '';
  for (const r of arr(rs)) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.img === 'string') {
      out += inlineImg(r, ctx);
      continue;
    }
    const t = typeof r.t === 'string' ? r.t : '';
    if (!t) continue;
    ctx.chars += t.length;
    let s = esc(t.replace(/\t/g, ' ')).replace(/\n/g, '<br>');
    if (r.sup) s = `<sup>${s}</sup>`;
    else if (r.sub) s = `<sub>${s}</sub>`;
    if (r.s) s = `<s>${s}</s>`;
    if (r.i) s = `<em>${s}</em>`;
    if (r.b) s = `<strong>${s}</strong>`;
    const href = linkHref(r.a, ctx);
    if (href) {
      // Links keep the site's link look, not the author's colour (A12).
      const ext = href.startsWith('#') || href.startsWith('/') ? '' : ' rel="noopener nofollow ugc"';
      s = `<a href="${esc(href)}"${ext}>${s}</a>`;
    } else {
      const cls = [palClass(r.c, ctx), r.u ? 'u' : ''].filter(Boolean).join(' ');
      if (cls) s = `<span class="${cls}">${s}</span>`;
    }
    out += s;
  }
  return out;
}

function palClass(key, ctx) {
  if (typeof key !== 'string' || !KEY.test(key) || !ctx.d.pal[key]) return '';
  return key + ctx.sfx;
}

function imgUrl(name) {
  return typeof name === 'string' && IMG_FILE.test(name) ? IMAGES_URL + name : null;
}

function inlineImg(r, ctx) {
  const rec = ctx.d.img[r.img];
  const src = imgUrl(rec?.src?.p);
  const w = pos(r.wh?.[0]);
  const h = pos(r.wh?.[1]);
  if (!src || !w || !h || w > 400 || h > 64) return '';
  return `<img class="emo" src="${esc(src)}" width="${Math.round(w)}" height="${Math.round(h)}" alt="" loading="lazy" decoding="async">`;
}

// ---------------------------------------------------------------- images (R1-R9, R15)
/**
 * Box and crop of one image use. `a` = visible aspect (after crop and rotation, from the real pixels so nothing is
 * stretched), `W` = DOCX display width, `n` = 2x the visible natural width (never shown bigger than that).
 * Crop and rotation are CSS on the uncropped WebP: the custom properties go into doc.css under a hashed class.
 */
function geometry(b, rec) {
  let dw = pos(b.wh?.[0]);
  let dh = pos(b.wh?.[1]);
  const crop = arr(b.crop).length === 4 && b.crop.every((x) => num(x) !== null) ? b.crop.map((x) => Math.max(0, Math.min(0.95, x))) : [0, 0, 0, 0];
  let [l, t, r, bm] = crop;
  if (l + r > 0.95) l = r = 0;
  if (t + bm > 0.95) t = bm = 0;
  const cropped = l > 0 || t > 0 || r > 0 || bm > 0;
  let vw = pos(rec?.px?.[0]);
  let vh = pos(rec?.px?.[1]);
  if (vw && vh) {
    vw *= 1 - l - r;
    vh *= 1 - t - bm;
  } else {
    vw = dw;
    vh = dh;
  }
  if (!vw || !vh) return null;
  const rot = (((Math.round(num(b.rot) || 0) % 360) + 360) % 360);
  const swap = rot === 90 || rot === 270;
  if (swap) {
    [vw, vh] = [vh, vw];
    if (dw && dh) [dw, dh] = [dh, dw];
  }
  const a = vw / vh;
  const W = Math.max(1, Math.round(dw || vw));
  const flip = b.flip === 'h' ? 'scale(-1,1)' : b.flip === 'v' ? 'scale(1,-1)' : b.flip === 'hv' ? 'scale(-1,-1)' : '';
  const kx = 1 / (1 - l - r);
  const ky = 1 / (1 - t - bm);
  let css = `--a:${rnd(a)};--w:${W}px;--n:${Math.round(vw * 2)}px`;
  if (cropped) css += `;--iw:${rnd(kx * 100, 3)}%;--ih:${rnd(ky * 100, 3)}%;--il:${rnd(-l * kx * 100, 3)}%;--it:${rnd(-t * ky * 100, 3)}%`;
  if (rot) css += `;--rt:${rot}deg;--rw0:${rnd(swap ? 100 / a : 100, 3)}%;--rh0:${rnd(swap ? 100 * a : 100, 3)}%`;
  if (flip) css += `;--fx:${flip}`;
  // How much wider the <img> element is than the visible box (for `sizes`).
  const k = (swap ? 1 / a : 1) * kx;
  return { a, W, full: W >= 240, cropped, rot, flip, css, k };
}

function styleClass(ctx, css) {
  const cls = `q${crypto.createHash('sha1').update(css).digest('hex').slice(0, 8)}`;
  ctx.styles.set(cls, css);
  return cls;
}

function imgButton(b, rec, g, ctx, sizes) {
  const cls = ['zb', g.full ? 'f' : 's', g.cropped && 'crop', g.rot && 'rot', g.flip && 'flip'].filter(Boolean).join(' ');
  const p = imgUrl(rec?.src?.p);
  if (!p) {
    // No processed image (a broken file in the DOCX): the same box, with a quiet way to the original.
    const link = ctx.miss ? `<a href="${esc(ctx.miss)}" rel="noopener">Image missing here. Open the original</a>` : '<span>Image missing here</span>';
    return `<span class="${cls} miss">${link}</span>`;
  }
  const src = rec.src;
  const ps = arr(src.ps).length === 2 && pos(src.ps[0]) && pos(src.ps[1]) ? src.ps : rec.px;
  const fw = pos(src.fs?.[0]);
  const f = fw ? imgUrl(src.f) : null;
  const n = ++ctx.imgN;
  let load = ' loading="lazy" decoding="async"';
  if (ctx.eager > 0) {
    ctx.eager--;
    load = n === 1 && ctx.chars < 1500 ? ' fetchpriority="high"' : '';
  }
  const w = Math.round(pos(ps?.[0]) || g.W);
  const h = Math.round(pos(ps?.[1]) || g.W / g.a);
  const set = f ? ` srcset="${esc(p)} ${w}w, ${esc(f)} ${Math.round(fw)}w" sizes="${sizes}"` : '';
  const alt = typeof b.alt === 'string' ? clean(b.alt).slice(0, 300) : '';
  const img = `<img src="${esc(p)}"${set} width="${w}" height="${h}" alt="${esc(alt)}"${load}>`;
  return `<button type="button" class="${cls}" data-full="${esc(f || p)}" aria-label="Open image ${n}">${g.rot ? `<span class="rr">${img}</span>` : img}</button>`;
}

const pct = (k) => (Math.abs(k - 1) < 0.001 ? '' : ` * ${rnd(k, 4)}`);

function images(group, ctx, top, w) {
  const recs = group.map((b) => ({ b, rec: ctx.d.img[b.i], g: null }));
  for (const r of recs) r.g = geometry(r.b, r.rec);
  const ok = recs.filter((r) => r.g);
  if (!ok.length) return '';
  const dw = w !== undefined ? ` data-w="${w}"` : '';
  const cv = top ? ' cv' : '';
  if (ok.length > 1) {
    // R7: images from one DOCX paragraph sit in one row, equal height, 4px apart, if each stays >= 120 px tall.
    const sum = ok.reduce((s, r) => s + r.g.a, 0);
    const gaps = 4 * (ok.length - 1);
    if ((PHONE_COL - gaps) / sum >= 120) {
      const rw = ok.reduce((s, r) => s + r.g.W, 0) + gaps;
      const rowCls = styleClass(ctx, `--rw:${rw}px;--rs:${rnd(sum)};--g:${gaps}px`);
      const cells = ok
        .map((r) => {
          const share = r.g.a / sum;
          const k = share * r.g.k;
          const sizes = `(min-width: 768px) ${Math.round(Math.min(rw, DESK_COL) * k)}px, calc((100vw - 32px)${pct(k)})`;
          return `<div class="ri ${styleClass(ctx, r.g.css)}">${imgButton(r.b, r.rec, r.g, ctx, sizes)}</div>`;
        })
        .join('');
      return `<figure class="im row${cv} ${rowCls}"${dw}>${cells}</figure>`;
    }
  }
  return ok
    .map((r) => {
      const g = r.g;
      const sizes = g.full ? `(min-width: 768px) ${Math.round(Math.min(g.W, DESK_COL) * g.k)}px, calc((100vw - 32px)${pct(g.k)})` : `${Math.round(g.W * g.k)}px`;
      return `<figure class="im one ${g.full ? 'f' : 's'}${cv} ${styleClass(ctx, g.css)}"${dw}>${imgButton(r.b, r.rec, g, ctx, sizes)}</figure>`;
    })
    .join('');
}

// ---------------------------------------------------------------- doc.css
/**
 * The doc's colours (per theme, R23: precomputed by the converter) and the image boxes used on its pages.
 * `styles`: class -> custom properties, collected while rendering every page.
 */
export function docCss(layout, styles) {
  const th = { l: [], d: [], s: [] };
  const rules = [];
  layout.data.forEach((d, i) => {
    if (!d) return;
    const sfx = i ? `_${i + 1}` : '';
    for (const [k, v] of Object.entries(d.pal)) {
      if (!KEY.test(k) || !v || typeof v !== 'object') continue;
      const name = k + sfx;
      const fg = (x) =>
        typeof x?.fg === 'string' && HEX.test(x.fg) ? `#${x.fg.toLowerCase()}` : /^text-[123]$/.test(x?.fg || '') ? `var(--${x.fg})` : 'currentColor';
      const hasBg = THEMES.some((t) => HEX.test(v[t]?.bg || ''));
      // R22d: text colour + highlight = the text in its own colour with the highlight as a thick band under it.
      const hasBand = THEMES.some((t) => HEX.test(v[t]?.band || ''));
      for (const t of THEMES) {
        const x = v[t] || {};
        th[t].push(`--${name}:${fg(x)}`);
        if (hasBg) th[t].push(`--${name}b:${HEX.test(x.bg || '') ? `#${x.bg.toLowerCase()}` : 'transparent'}`, `--${name}p:${x.chip ? '4px' : '0px'}`);
        if (hasBand) th[t].push(`--${name}d:${HEX.test(x.band || '') ? `#${x.band.toLowerCase()}` : 'transparent'}`);
      }
      let rule = `color:var(--${name})`;
      if (hasBg) rule += `;background:var(--${name}b);padding:0 var(--${name}p);border-radius:var(--${name}p);-webkit-box-decoration-break:clone;box-decoration-break:clone`;
      if (hasBand) rule += `;text-decoration:underline var(--${name}d) 0.3em;text-underline-offset:0.1em;text-decoration-skip-ink:none`;
      rules.push(`.${name}{${rule}}`);
    }
  });
  const out = [];
  if (th.l.length) {
    out.push(`:root{${th.l.join(';')}}`);
    out.push(`@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${th.d.join(';')}}}`);
    out.push(`:root[data-theme='dark']{${th.d.join(';')}}`);
    out.push(`html:root[data-reader='sepia']{${th.s.join(';')}}`);
  }
  out.push(...rules);
  for (const [cls, css] of [...styles].sort()) out.push(`.${cls}{${css}}`);
  return `${out.join('\n')}\n`;
}

/** Renders every page of a rich entry once and returns its doc.css (colours + the image boxes the pages use). */
export function entryDocCss(chapters, pages, multi) {
  const layout = richLayout(chapters, pages);
  if (!layout) return null;
  const styles = new Map();
  pages.forEach((p, k) => {
    const ctx = pageContext({ layout, page: k, pageHref: () => '' });
    ctx.styles = styles;
    for (const part of p.chapters) if (layout.data[part.i]) renderPart(ctx, part.i, { multi });
  });
  return docCss(layout, styles);
}

/** Where the original of part `n` (1-based) can be opened: its PDF, else DOCX, else null. */
export function originalOf(entry, n) {
  const part = entry.parts.find((p) => p.n === n);
  const f = part && (part.files.find((x) => x.format === 'pdf' && x.href) || part.files.find((x) => x.format === 'docx' && x.href));
  return f ? f.href : null;
}
