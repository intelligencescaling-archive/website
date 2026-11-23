// Reddit posts (parts whose source is a Reddit text post): their text is the post's selftext in Reddit markdown.
// Rendered at build time with markdown-it (raw HTML off, so any HTML in a post is shown as text) plus small Reddit
// rules: superscript (^word, ^(a few words)), spoilers (>!text!<), u/name and r/sub links, and the post's own images
// in place of the image links Reddit puts in the text (https://preview.redd.it/<id>.png?…, ![img](<id>)).
//
// Pages, URLs and positions stay those of the plain-text reader (readerChapters / readerPages in archive.mjs): the
// text's blocks are rendered in runs (a run = the paragraphs between two headings on one page), and every top-level
// element gets data-w, the word offset of its first source line counted exactly like readerChapters, so the reader
// script (src/scripts/reader.js) places positions as for rich parts. Headings stay the text's own blocks with their
// #s-N ids.
//
// The text is untrusted: markdown-it escapes all text, links are only https/http/mailto (and Reddit's /r/ and /u/
// paths, made absolute), images are only the post's own saved files. No inline styles (CSP): table alignment
// becomes a class.
import MarkdownIt from 'markdown-it';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const words = (s) => (s.match(/\S+/g) || []).length;

/** A Reddit media id (the key of an image in the post's media_metadata). */
const MEDIA_ID = /^[A-Za-z0-9]{6,20}$/;
/** An image hosted by Reddit: i.redd.it/<id>.<ext> or preview.redd.it/<id>.<ext>?… (also "title-v0-<id>"). */
const MEDIA_URL = /^https?:\/\/(?:i|preview)\.redd\.it\/(?:[A-Za-z0-9_-]*-v0-)?([A-Za-z0-9]{6,20})\.(?:png|jpe?g|gif|webp)(?:[?#]\S*)?$/i;
const MEDIA_ANY = /(?:\/\/(?:i|preview)\.redd\.it\/(?:[A-Za-z0-9_-]*-v0-)?([A-Za-z0-9]{6,20})\.(?:png|jpe?g|gif|webp)|!\[[^\]\n]*\]\(\s*([A-Za-z0-9]{6,20})[\s)])/gi;
const SAFE_LINK = /^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i;
const REDDIT_PATH = /^\/(?:r|u|user)\/[A-Za-z0-9_-]{2,21}(?:\/[^\s]*)?$/i;
const EMPTY_TEXT = /^[\s​‌‍⁠﻿ ]*$/;

/** Media id of a Reddit image link or image source, else null. */
export function mediaIdOf(url) {
  if (typeof url !== 'string') return null;
  const m = MEDIA_URL.exec(url.trim());
  if (m) return m[1];
  return MEDIA_ID.test(url) ? url : null;
}

/** Every media id the text refers to (image links and ![…](id) images). */
export function mediaIdsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(MEDIA_ANY)) out.add(m[1] || m[2]);
  return out;
}

// ---------------------------------------------------------------- markdown-it setup
function blockSpoilerGuard(md) {
  // Reddit: a line starting with ">!" is a spoiler, not a quote. Let the paragraph rule have it.
  const rules = md.block.ruler.__rules__;
  const quote = rules.find((r) => r.name === 'blockquote');
  const orig = quote.fn;
  md.block.ruler.at('blockquote', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    if (state.src.charCodeAt(pos) === 0x3e && state.src.charCodeAt(pos + 1) === 0x21) {
      const line = state.src.slice(pos, state.eMarks[startLine]);
      if (line.includes('!<')) return false;
    }
    return orig(state, startLine, endLine, silent);
  }, { alt: quote.alt });
}

/** Parses src[from, to) as inline content between an open and a close token. */
function nested(state, from, to, open, close, tag, attrs) {
  const oldMax = state.posMax;
  state.pos = from;
  state.posMax = to;
  const t = state.push(open, tag, 1);
  if (attrs) for (const [k, v] of attrs) t.attrSet(k, v);
  state.md.inline.tokenize(state);
  state.push(close, tag, -1);
  state.posMax = oldMax;
}

function spoiler(state, silent) {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3e || src.charCodeAt(start + 1) !== 0x21) return false;
  const end = src.indexOf('!<', start + 2);
  if (end < 0 || end + 2 > state.posMax || end === start + 2) return false;
  if (!silent) nested(state, start + 2, end, 'spoiler_open', 'spoiler_close', 'span', [['class', 'sp'], ['tabindex', '0']]);
  state.pos = end + 2;
  return true;
}

function superscript(state, silent) {
  const src = state.src;
  const start = state.pos;
  const max = state.posMax;
  if (src.charCodeAt(start) !== 0x5e) return false;
  let from = start + 1;
  let to;
  let after;
  if (src.charCodeAt(from) === 0x28) {
    // ^(a few words): up to the matching ")".
    let depth = 0;
    let k = from;
    for (; k < max; k++) {
      const c = src.charCodeAt(k);
      if (c === 0x5c) k++;
      else if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) break;
      else if (c === 0x0a) return false;
    }
    if (k >= max || k === from + 1) return false;
    from += 1;
    to = k;
    after = k + 1;
  } else {
    // ^word: up to the next space (or a bold/strike mark, so "**2^10**" stays bold).
    let k = from;
    while (k < max && !/[\s*~]/.test(src[k])) k++;
    if (k === from) return false;
    to = k;
    after = k;
  }
  if (!silent) nested(state, from, to, 'sup_open', 'sup_close', 'sup');
  state.pos = after;
  return true;
}

const NAME = /(^|[^A-Za-z0-9_/])(\/?)((?:u|r)\/[A-Za-z0-9_-]{2,21})(?![A-Za-z0-9_/-])/g;

/** u/name and r/sub in plain text become links to reddit.com (not inside links or code). */
function redditNames(state) {
  for (const blk of state.tokens) {
    if (blk.type !== 'inline' || !blk.children) continue;
    const out = [];
    let inLink = 0;
    for (const t of blk.children) {
      if (t.type === 'link_open') inLink++;
      if (t.type === 'link_close') inLink--;
      if (t.type !== 'text' || inLink || !/[ur]\//.test(t.content)) {
        out.push(t);
        continue;
      }
      let last = 0;
      const s = t.content;
      for (const m of s.matchAll(NAME)) {
        const at = m.index + m[1].length;
        if (at > last) out.push(textTok(state, s.slice(last, at)));
        const name = m[2] + m[3];
        const open = new state.Token('link_open', 'a', 1);
        open.attrs = [['href', `https://www.reddit.com/${m[3]}/`]];
        open.markup = 'reddit';
        out.push(open, textTok(state, name), new state.Token('link_close', 'a', -1));
        last = at + name.length;
      }
      if (last === 0) out.push(t);
      else if (last < s.length) out.push(textTok(state, s.slice(last)));
    }
    blk.children = out;
  }
}
function textTok(state, content) {
  const t = new state.Token('text', '', 0);
  t.content = content;
  return t;
}

const hrefOf = (t) => (t.attrs || []).find((a) => a[0] === 'href')?.[1] || '';
const textOf = (children) => children.map((c) => (c.type === 'text' || c.type === 'code_inline' ? c.content : c.type === 'image' ? textOf(c.children || []) : '')).join('');

/**
 * Reddit images: a bare image link, an image link with a caption, or ![alt](id) becomes one `reddit_media` token.
 * Links that aren't https/http/mailto/Reddit paths lose their link (the text stays). A paragraph of only images
 * becomes a figure; one that is left empty (images not saved) is dropped.
 */
function redditMedia(state) {
  const env = state.env || {};
  for (const blk of state.tokens) {
    if (blk.type !== 'inline' || !blk.children) continue;
    const ch = blk.children;
    const out = [];
    for (let k = 0; k < ch.length; k++) {
      const t = ch[k];
      if (t.type === 'link_open') {
        const close = ch.findIndex((x, j) => j > k && x.type === 'link_close');
        // Reddit's editor escapes "_" and "*" in bare links (utm\_source): the link means the plain URL.
        const lt = ch[k + 1];
        if (t.markup === 'linkify' && lt?.type === 'text' && lt.content.includes('\\')) {
          lt.content = lt.content.replace(/\\([!-/:-@[-`{-~])/g, '$1');
          t.attrs = [['href', state.md.normalizeLink(lt.content)]];
        }
        const href = hrefOf(t);
        const id = mediaIdOf(href);
        if (id && close > k && (SAFE_LINK.test(href) || MEDIA_ID.test(href))) {
          const inner = ch.slice(k + 1, close);
          const bare = t.markup === 'linkify' || t.markup === 'autolink' || textOf(inner).trim() === href;
          out.push(media(state, id, bare ? '' : textOf(inner).trim(), SAFE_LINK.test(href) ? href : ''));
          k = close;
          continue;
        }
        if (!SAFE_LINK.test(href) && !REDDIT_PATH.test(href)) {
          // Not a web link (a bare word in the parentheses): keep the text only.
          const depthClose = close > k ? close : ch.length;
          out.push(...ch.slice(k + 1, depthClose));
          k = depthClose;
          continue;
        }
        if (REDDIT_PATH.test(href)) t.attrs = [['href', `https://www.reddit.com${href}`]];
        out.push(t);
        continue;
      }
      if (t.type === 'image') {
        const src = (t.attrs || []).find((a) => a[0] === 'src')?.[1] || '';
        const title = (t.attrs || []).find((a) => a[0] === 'title')?.[1] || '';
        const alt = textOf(t.children || []).trim();
        const id = mediaIdOf(src);
        const cap = title || (alt && alt.toLowerCase() !== 'img' && alt.toLowerCase() !== 'image' ? alt : '');
        if (id) out.push(media(state, id, cap, SAFE_LINK.test(src) ? src : '', true));
        else if (SAFE_LINK.test(src)) {
          // Someone else's image: a link to it, never loaded here.
          const open = new state.Token('link_open', 'a', 1);
          open.attrs = [['href', src]];
          out.push(open, textTok(state, alt || 'Image'), new state.Token('link_close', 'a', -1));
        } else if (alt) out.push(textTok(state, alt));
        continue;
      }
      out.push(t);
    }
    blk.children = out;
  }
  // Paragraphs of only images (and line breaks) -> a figure; nothing left -> dropped.
  const toks = state.tokens;
  for (let k = 0; k + 2 < toks.length; k++) {
    if (toks[k].type !== 'paragraph_open' || toks[k + 1].type !== 'inline') continue;
    const kids = toks[k + 1].children || [];
    const isGap = (c) => c.type === 'softbreak' || c.type === 'hardbreak' || (c.type === 'text' && EMPTY_TEXT.test(c.content));
    const allMedia = kids.length > 0 && kids.every((c) => c.type === 'reddit_media' || isGap(c)) && kids.some((c) => c.type === 'reddit_media');
    const empty = kids.every(isGap);
    if (empty || (allMedia && kids.every((c) => c.type !== 'reddit_media' || !c.meta.rec && !c.meta.caption))) {
      toks[k].hidden = toks[k + 2].hidden = true;
      toks[k + 1].children = [];
    } else if (allMedia && env.media) {
      toks[k + 1].children = kids.filter((c) => c.type === 'reddit_media');
      if (toks[k + 1].children.every((c) => c.meta.rec)) {
        toks[k].tag = toks[k + 2].tag = 'figure';
        toks[k].attrSet('class', 'im md-im');
      }
    }
  }
}

function media(state, id, caption, href, isImage = false) {
  const t = new state.Token('reddit_media', '', 0);
  const rec = state.env?.media?.get(id) || null;
  t.meta = { id, rec, caption, href, isImage };
  return t;
}

/** Table alignment as a class, header cells with scope, headings at the reader's levels, no empty paragraphs. */
function cleanup(state) {
  const env = state.env || {};
  let inHead = false;
  for (const t of state.tokens) {
    if (t.type === 'thead_open') inHead = true;
    if (t.type === 'thead_close') inHead = false;
    if (t.type === 'th_open' || t.type === 'td_open') {
      const st = t.attrGet('style') || '';
      t.attrs = (t.attrs || []).filter((a) => a[0] !== 'style');
      if (/center/.test(st)) t.attrSet('class', 'al-c');
      else if (/right/.test(st)) t.attrSet('class', 'al-r');
      if (t.type === 'th_open' && inHead) t.attrSet('scope', 'col');
    }
    if (t.type === 'heading_open' || t.type === 'heading_close') {
      const l = Math.min(3, Number(t.tag.slice(1)) || 1);
      t.tag = env.headTag || `h${Math.min((env.base || 2) + l - 1, 6)}`;
    }
  }
}

/** Code, ASCII art or an aligned table (keywords, braces or semicolons at line ends, box lines, nested indents). */
export function looksLikeCode(s) {
  const code = [
    /^\s*(?:def|class)\s+\w+.*:\s*$/m, // Python
    /^\s*(?:import\s+[\w.]+|from\s+[\w.]+\s+import\b)/m,
    /^\s*(?:for|while|if|elif|else|try|except|with)\b[^\n]*:\s*$/m,
    /^\s*(?:const|let|var)\s+\w+\s*=/m,
    /^\s*(?:print|console\.log)\(/m,
    /^\s*#include\b/m,
    /[│┃┌┐└┘├┤─━]|\+-{3,}|-{3,}\+|\|\s*-{3,}/, // boxes and ASCII tables
  ];
  const lines = (re) => (s.match(re) || []).length;
  return code.some((re) => re.test(s)) || lines(/[{};]\s*$/gm) >= 2 || lines(/^ {2,}\S/gm) >= 2;
}

function setup() {
  const md = new MarkdownIt('default', { html: false, linkify: true, breaks: true, typographer: false });
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  // Every link is parsed, so its text shows without the brackets; redditMedia then keeps only web and mail links
  // and Reddit paths (javascript:, data:, bare words… lose the link and keep the text), and the renderer checks again.
  md.validateLink = () => true;
  blockSpoilerGuard(md);
  md.inline.ruler.after('escape', 'reddit_spoiler', spoiler);
  md.inline.ruler.after('reddit_spoiler', 'reddit_sup', superscript);
  md.core.ruler.after('text_join', 'reddit_names', redditNames);
  md.core.ruler.after('reddit_names', 'reddit_media', redditMedia);
  md.core.ruler.after('reddit_media', 'reddit_cleanup', cleanup);

  const r = md.renderer.rules;
  const attrs = (t, slf) => slf.renderAttrs(t);
  r.softbreak = () => '<br>';
  r.hardbreak = () => '<br>';
  r.fence = (tokens, i, _o, _e, slf) => `<pre${attrs(tokens[i], slf)}><code>${esc(tokens[i].content.replace(/\n$/, ''))}</code></pre>`;
  // A 4-space (or tab) indented block: code on Reddit, but in these posts it is mostly prose or a list pasted with
  // tabs. Only what looks like code stays a code block; the rest is read as markdown again, without the indent.
  r.code_block = (tokens, i, o, env, slf) =>
    looksLikeCode(tokens[i].content) ? r.fence(tokens, i, o, env, slf) : `<div class="ind"${attrs(tokens[i], slf)}>${md.render(tokens[i].content, env)}</div>`;
  r.table_open = (tokens, i, _o, env, slf) => {
    env.tables = (env.tables || 0) + 1;
    // Only a table wider than the column becomes a focusable "Table N" scroll region (src/scripts/reader.js).
    return `<div class="tw"${attrs(tokens[i], slf)} data-n="${env.tables}"><table>`;
  };
  r.table_close = () => '</table></div>';
  r.link_open = (tokens, i) => {
    const href = hrefOf(tokens[i]);
    return SAFE_LINK.test(href) ? `<a href="${esc(href)}" rel="nofollow ugc noopener">` : '<a>';
  };
  r.image = (tokens, i) => esc(textOf(tokens[i].children || []));
  r.reddit_media = (tokens, i, _o, env) => mediaHtml(tokens[i].meta, env);
  return md;
}

let MD = null;
const md = () => (MD ||= setup());

// ---------------------------------------------------------------- images
/**
 * The post's saved image: the reader's image button (src/scripts/reader.js opens it in the image viewer). `nat`:
 * sized from the file itself; width/height (when the capture records them) reserve the box before it loads.
 */
export function imageButton(rec, env, alt = '') {
  env.imgs = (env.imgs || 0) + 1;
  let load = ' loading="lazy" decoding="async"';
  if (env.eager > 0) {
    env.eager--;
    load = env.imgs === 1 ? ' fetchpriority="high"' : '';
  }
  const size = rec.px ? ` width="${rec.px[0]}" height="${rec.px[1]}"` : '';
  return `<button type="button" class="zb nat" data-full="${esc(rec.href)}" aria-label="Open image ${env.imgs}"><img src="${esc(rec.href)}"${size} alt="${esc(alt)}"${load}></button>`;
}

function mediaHtml(m, env) {
  if (m.rec && env.media) {
    env.used?.add(m.id);
    return imageButton(m.rec, env, m.caption);
  }
  // Not saved (or a preview): never the raw link. A caption stays, as a link to the image when there is one.
  if (!m.caption) return '';
  return m.href ? `<a href="${esc(m.href)}" rel="nofollow ugc noopener">${esc(m.caption)}</a>` : esc(m.caption);
}

// ---------------------------------------------------------------- rendering
/**
 * Quirks of Reddit's rich-text editor, fixed line by line (the line count stays, so word offsets do too):
 * - markdown typed into it is saved escaped (\*\*bold\*\*, \## Heading): pairs of \*\* and a leading \# + space
 *   are what the author meant as marks;
 * - two bold runs side by side are saved as **one****two**: one bold run;
 * - bold punctuation glued to a word (curses**.**, ***:***) can't be bold in CommonMark: plain punctuation.
 */
export function editorFix(src) {
  return String(src)
    .split('\n')
    .map((l) => {
      const esc2 = /(?<![*\\])\\\*\\\*(?![*\\])/g;
      if (l.includes('\\*\\*') && (l.match(esc2) || []).length % 2 === 0) l = l.replace(esc2, '**');
      return l
        .replace(/^(\s{0,3})\\(#{1,6} )/, '$1$2')
        .replace(/\*\*([^*\s][^*]*?)\*{4}([^*\s][^*]*?)\*\*/g, '**$1$2**')
        .replace(/(\*{2,3})([^\w\s*|]{1,3})\1/g, '$2');
    })
    .join('\n');
}

/**
 * HTML of a markdown run whose first word is at doc-wide offset `w0`; every top-level element gets data-w.
 * `env`: { base, media, used, imgs, eager, tables } (shared across a page).
 */
export function renderRun(src, w0, env) {
  // Offsets count the text's own words (as readerChapters does), so lines are measured before the fixes.
  const lines = src.split('\n');
  const tokens = md().parse(editorFix(src), env);
  const before = [0];
  for (const l of lines) before.push(before[before.length - 1] + words(l));
  for (const t of tokens) {
    if (t.level !== 0 || t.nesting === -1 || !t.block || !t.map) continue;
    t.attrSet('data-w', String(w0 + before[Math.min(t.map[0], lines.length)]));
  }
  return md().renderer.render(tokens, md().options, env);
}

/** Inline HTML (headings). */
export function renderInline(src, env = {}) {
  return md().renderInline(editorFix(src).replace(/\s+#+\s*$/, ''), env);
}

/** The visible text of markdown (search index, "Go to" titles): no marks, no image links. */
export function mdPlain(src, inline = false) {
  const env = {};
  const tokens = inline ? md().parseInline(editorFix(src).replace(/\s+#+\s*$/, ''), env) : md().parse(editorFix(src), env);
  let out = '';
  const kids = (list) => {
    for (const c of list) {
      if (c.type === 'text' || c.type === 'code_inline') out += c.content;
      else if (c.type === 'softbreak' || c.type === 'hardbreak') out += '\n';
      else if (c.type === 'sup_open') out += ' ';
      else if (c.type === 'reddit_media') out += c.meta.caption ? ` ${c.meta.caption} ` : '';
    }
  };
  for (const t of tokens) {
    if (t.type === 'inline') kids(t.children || []);
    else if (t.type === 'code_block' || t.type === 'fence') out += t.content;
    else if (t.type === 'table_close') out += '\n';
    else if (t.nesting === -1 && /^(paragraph|heading|th|td|list_item|blockquote)_close$/.test(t.type)) out += t.type.startsWith('t') ? ' ' : '\n';
  }
  return inline ? out.trim() : out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * HTML of chapter `c`'s blocks on one page (`part`: readerPages' { i, blocks, cont }). `page`: shared per-page state
 * { imgs, eager, tables }. `images`: the part's saved image files ({ href, mediaId, px }). Headings keep #s-N; an
 * image goes where the text links to it (by media id), the others after the part's last words.
 */
export function renderMdPart(c, part, page, { multi = false, images = [] } = {}) {
  const base = multi ? 3 : 2;
  images = images.filter((f) => f.href).map((f) => ({ href: f.href, id: f.mediaId || null, px: f.px || null }));
  const byId = new Map(images.filter((x) => x.id).map((x) => [x.id, x]));
  const placed = new Set([...mediaIdsIn(c.blocks.map((b) => b.src ?? b.text).join('\n'))].filter((id) => byId.has(id)));
  const env = { base, media: byId, used: new Set(), imgs: page.imgs || 0, eager: page.eager ?? 1, tables: page.tables || 0 };
  let out = '';
  let run = [];
  let runW = 0;
  const flush = () => {
    if (run.length) out += renderRun(run.join('\n\n'), runW, env);
    run = [];
  };
  for (const b of part.blocks) {
    if (b.level > 0) {
      flush();
      const tag = `h${Math.min(base + b.level - 1, 6)}`;
      const inner = b.title ? esc(b.text) : renderInline(b.text, env);
      out += `<${tag} id="s-${b.sid}" data-w="${b.w}">${inner}</${tag}>`;
    } else if (b.title) {
      flush();
      out += `<p data-w="${b.w}">${esc(b.text)}</p>`;
    } else {
      if (!run.length) {
      runW = b.w;
      // Only an image near the top of the page loads at once (R5); later ones are lazy.
      if (b.w - (part.blocks[0]?.w ?? b.w) > 300) env.eager = 0;
    }
      if (b.src !== '') run.push(b.src ?? b.text);
    }
  }
  flush();
  if (!part.cont) {
    const rest = images.filter((x) => !(x.id && placed.has(x.id)));
    if (rest.length) {
      const end = c.w + c.words;
      env.eager = 0;
      out += `<figure class="im md-im" data-w="${end}">${rest.map((x) => imageButton(x, env)).join('')}</figure>`;
    }
  }
  page.imgs = env.imgs;
  page.eager = env.eager;
  page.tables = env.tables;
  return out;
}

/**
 * The item page preview of a Reddit post: { html, cut }. `first`: what previewBlocks made of the first line (the post
 * title): [] when it repeats the entry title, else one block. The rest is cut at a paragraph, then rendered.
 */
export function mdPreview(text, first, maxChars = 3000) {
  const nl = text.indexOf('\n');
  let body = (nl < 0 ? '' : text.slice(nl + 1)).replace(/^\s*\n/, '');
  let cut = false;
  if (body.length > maxChars) {
    cut = true;
    let at = body.lastIndexOf('\n\n', maxChars);
    if (at < maxChars * 0.4) at = body.lastIndexOf('\n', maxChars);
    if (at < maxChars * 0.4) at = body.lastIndexOf(' ', maxChars);
    body = body.slice(0, at > 0 ? at : maxChars).trimEnd() + (at > 0 && body[at] === ' ' ? ' …' : '');
  }
  const head = first.map((b) => (b.h ? `<h3>${esc(b.text)}</h3>` : `<p>${esc(b.text)}</p>`)).join('');
  const env = { headTag: 'h3', media: null };
  const html = head + md().render(editorFix(body), env);
  return { html: html.trim(), cut };
}
