// Reads the archive repo (meta.yaml files + registries) at build time and turns it into plain
// objects for the pages and the search index. Read-only: never writes to the archive.
//
// Everything read here is untrusted text (anyone can submit an entry). Pages must render it with
// normal Astro expressions (which escape HTML) and never with set:html. URLs go through safeUrl().
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import { ARCHIVE_DIR, ARCHIVE_RAW_URL, FILES_URL_TEMPLATE } from './config.mjs';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REDDIT_NAME = /^[A-Za-z0-9_-]{3,20}$/;

export const LIBRARIES = {
  old: {
    name: 'The Ultimate Library of Docs',
    short: 'Old library',
    by: ['BudgetPosition6080'],
    url: 'https://docs.google.com/document/d/1C1_fA6s6AReEVY_vBcit6HD06TA45lDDfu-BuaxMugA/edit',
  },
  remastered: {
    name: 'The Ultimate SCD Library – Remastered',
    short: 'Remastered library',
    by: ['TheMcBaconX', 'BudgetPosition6080'],
    url: 'https://docs.google.com/document/d/1Eo1uBktSrI7FBLsxpQGIMjyRr855jjJpIsKmzuiGFIE/edit',
  },
  stories: {
    name: 'Library of original stories + fanfics',
    short: 'Stories library',
    by: ['ConversationSea1684'],
    url: 'https://docs.google.com/document/d/1aVjRKfk2f5t7N0WNj4-jJA54enu4nOzyzOtxVgYQXwY/edit',
  },
};

/**
 * Topics: a browse home for entries that aren't about one series. Decided from tags and category,
 * so no archive change is needed. Only entries with no series get a topic (a `game` doc in a series
 * is a game inside that story, not a community game). An entry can have more than one topic.
 * `help` topics are the leftovers, shown with a "help sort it" link.
 */
export const TOPICS = [
  {
    id: 'scd-theory',
    name: 'SCD theory & guides',
    desc: 'Category systems, scaling methods and how-to guides.',
    tags: ['scd-categories', 'scaling-system', 'scd-theory', 'guide', 'writing-categories', 'composite'],
    subs: [
      ['Categories', 'scd-categories'],
      ['Guides', 'guide'],
      ['Scaling systems', 'scaling-system'],
      ['Writing', 'writing-categories'],
    ],
  },
  {
    id: 'stories-and-ocs',
    name: 'Stories & original characters',
    desc: 'Original fiction, OC docs and crossover fights.',
    tags: ['oc', 'fanfiction'],
    stories: true,
  },
  { id: 'community-games', name: 'Community games & events', desc: 'Rulebooks and tournaments run on the sub.', tags: ['game'] },
  {
    id: 'libraries-and-history',
    name: 'Libraries & community history',
    desc: 'Doc collections and the story of SCD.',
    tags: ['library', 'history', 'list', 'collection'],
    title: /\blibrar(?:y|ies)\b/i,
  },
  {
    id: 'series-unknown',
    name: 'Series not known yet',
    desc: "Docs about characters whose series isn't in the archive yet.",
    help: true,
  },
  { id: 'needs-sorting', name: 'Needs sorting', desc: "We couldn't tell what these are about yet.", help: true },
];

/** Picks an entry's topic ids. `charSeries` maps character id → series id (or null). */
function topicsFor(e, charSeries) {
  if (e.series.length) return [];
  const out = TOPICS.filter((t) => !t.help && (e.tags.some((x) => t.tags.includes(x)) || (t.stories && e.category === 'story') || t.title?.test(e.title))).map((t) => t.id);
  if (out.length) return out;
  if (e.characters.length && e.characters.every((c) => !charSeries.get(c.id))) return ['series-unknown'];
  return ['needs-sorting'];
}

export const CATEGORY_NAMES = { doc: 'Doc', story: 'Story', misc: 'Misc' };
export const CATEGORY_PLURAL = { doc: 'Docs', story: 'Stories', misc: 'Misc' };

export const STATUS = {
  complete: { label: 'Saved', tone: 'ok' },
  partial: { label: 'Partly saved', tone: 'warn' },
  'export-blocked': { label: 'Not saved: downloads blocked', tone: 'warn' },
  dead: { label: 'Original deleted', tone: 'bad' },
  private: { label: 'Original made private', tone: 'bad' },
  'not-captured': { label: 'Not saved yet', tone: 'warn' },
};
const STATUS_TEXT_ONLY = { label: 'Text recovered', tone: 'warn' };
const STATUS_LINK_ONLY = { label: 'Linked, not copied', tone: 'warn' };

/** Repo-relative file path, URL-encoded per segment (for raw.githubusercontent.com links). */
function encodeRepoPath(p) {
  return p.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
}

const SOURCE_TYPES = {
  'google-doc': 'Google Doc',
  'google-doc-published': 'Google Doc (published page)',
  'google-drive-file': 'Google Drive file',
  'google-slides': 'Google Slides',
  'reddit-post': 'Reddit post',
  'web-page': 'Web page',
  other: 'Link',
};

const LINK_TYPES = { 'reddit-post': 'Reddit post', wayback: 'Wayback Machine snapshot', discussion: 'Discussion', other: 'Link' };
const FORMAT_NAMES = { pdf: 'PDF', docx: 'DOCX', html: 'HTML', pptx: 'PPTX', epub: 'EPUB', png: 'PNG', jpg: 'JPG', txt: 'TXT' };

/**
 * Source language: the language the original work (the series) was first made in, from
 * `origin_language` in the archive's data/series.yaml. The Search filter groups the codes into a
 * few choices; the rarely used languages share "Other languages".
 */
export const ORIGIN_GROUPS = [
  { id: 'ja', name: 'Japanese' },
  { id: 'ko', name: 'Korean' },
  { id: 'zh', name: 'Chinese' },
  { id: 'en', name: 'English' },
  { id: 'other', name: 'Other languages' },
  { id: 'real', name: 'Real life' },
];
const originGroup = (code) => (!code ? null : ORIGIN_GROUPS.some((g) => g.id === code) ? code : 'other');
const MEDIUM_NAMES = {
  anime: 'anime', comic: 'comic', film: 'film', game: 'game', 'light-novel': 'light novel', manga: 'manga',
  manhua: 'manhua', manhwa: 'manhwa', novel: 'novel', poem: 'poem', tv: 'TV series', 'visual-novel': 'visual novel',
  web: 'web series', 'web-novel': 'web novel', webtoon: 'webtoon',
};
/** "Japanese light novel", "Korean webtoon", "Real life". Empty when the source language isn't known. */
export function originLabel(code, medium) {
  if (!code) return '';
  if (code === 'real') return 'Real life';
  const lang = languageName(code);
  const m = MEDIUM_NAMES[medium] || (medium ? medium.replaceAll('-', ' ') : '');
  return m ? `${lang} ${m}` : lang;
}

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
export function languageName(code) {
  if (!code) return 'Unknown';
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

/** Returns the URL if it's a plain http(s) URL, otherwise null (blocks javascript:, data:, etc.). */
export function safeUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function slugify(text) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'a-' + createHash('sha256').update(String(text)).digest('hex').slice(0, 8);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Newest entries first (by `added`, then longest), at most `n`. */
export function newestEntries(entries, n) {
  return entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.added))
    .sort((a, b) => b.added.localeCompare(a.added) || b.words - a.words)
    .slice(0, n);
}

/** Entries added after the archive's first import (launch day), newest first. Empty until new docs arrive. */
export function recentlyAdded(entries, n) {
  const dates = entries.map((e) => e.added).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const first = dates[0];
  return newestEntries(entries.filter((e) => e.added > first), n);
}

export function formatNumber(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '';
}

/** "2026-11-15" -> "Nov 15, 2026". Anything that is not an ISO date is returned as it is. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Rewrites ISO dates inside free text ("Snapshot from 2025-08-20") as readable dates. */
export function readableDates(text) {
  return String(text || '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => formatDate(d));
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

function readYaml(file) {
  return parseYaml(fs.readFileSync(file, 'utf8'), { maxAliasCount: 50 });
}

function fileHref(entryId, file) {
  const own = safeUrl(file.url);
  if (own) return own;
  if (!FILES_URL_TEMPLATE || !SHA256.test(file.sha256)) return null;
  const url = FILES_URL_TEMPLATE.replace(/\{(sha256|format|id|name)\}/g, (_, key) =>
    encodeURIComponent(key === 'sha256' ? file.sha256 : key === 'format' ? file.format : key === 'id' ? entryId : file.name),
  );
  return safeUrl(url);
}

/** Turns a capture error ("HTTP 401") into words a reader understands. */
function missingReason(value) {
  const v = str(value);
  if (/HTTP 40[13]|disabled by owner/i.test(v)) return 'the owner turned off downloads';
  if (/HTTP (5\d\d|413)/.test(v)) return "Google couldn't export it, usually because the doc is very large";
  return v;
}

/**
 * Key for A–Z sorting: ignores leading quotes, emoji and other symbols, and a leading bracketed
 * note like "(COPIA)" or "(Upgrade WIP)", so the list starts with real titles.
 */
export function sortTitle(title) {
  const t = str(title)
    .replace(/^[^\p{L}\p{N}(\[]+/u, '')
    .replace(/^[(\[][^)\]]{1,24}[)\]]\s*/, '')
    .replace(/^[^\p{L}\p{N}]+/u, '');
  return t || str(title);
}

/** A–Z by sortTitle(), with titles that start with a number after the letters. */
export function compareTitles(a, b) {
  const ka = sortTitle(a);
  const kb = sortTitle(b);
  const na = /^\p{N}/u.test(ka);
  const nb = /^\p{N}/u.test(kb);
  if (na !== nb) return na ? 1 : -1;
  return ka.localeCompare(kb, 'en', { sensitivity: 'base', numeric: true });
}

function findMetaFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !fs.existsSync(dir)) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      const sub = path.join(dir, d.name);
      const meta = path.join(sub, 'meta.yaml');
      if (fs.existsSync(meta)) out.push(meta);
      else walk(sub, depth + 1);
    }
  };
  for (const top of ['docs', 'stories', 'misc']) walk(path.join(root, top), 0);
  return out;
}

function normalizeEntry(raw, metaFile, reg) {
  const where = path.relative(ARCHIVE_DIR, metaFile).replaceAll('\\', '/');
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: not a YAML mapping`);
  const id = str(raw.id);
  if (!SLUG.test(id)) throw new Error(`${where}: bad id "${id}"`);
  if (path.basename(path.dirname(metaFile)) !== id) throw new Error(`${where}: id does not match folder name`);
  if (!str(raw.title).trim()) throw new Error(`${where}: missing title`);
  if (!arr(raw.parts).length) throw new Error(`${where}: no parts`);
  const category = CATEGORY_NAMES[raw.category] ? raw.category : 'doc';

  const authors = arr(raw.authors)
    .filter((a) => a && str(a.name).trim())
    .map((a) => {
      const reddit = REDDIT_NAME.test(str(a.reddit)) ? a.reddit : null;
      return { name: str(a.name).trim(), reddit, source: str(a.source), key: slugify(reddit || a.name) };
    });

  const series = arr(raw.series).map((sid) => {
    const s = reg.series.get(sid);
    if (!s) reg.warnings.push(`${where}: unknown series "${sid}"`);
    return { id: str(sid), name: s ? s.name : str(sid), known: !!s };
  });
  const characters = arr(raw.characters).map((cid) => {
    const c = reg.characters.get(cid);
    if (!c) reg.warnings.push(`${where}: unknown character "${cid}"`);
    return { id: str(cid), name: c ? c.name : str(cid), known: !!c };
  });

  const dir = path.dirname(metaFile);
  const parts = arr(raw.parts).map((p, i) => {
    const source = p?.source || {};
    const capture = p?.capture || {};
    const status = STATUS[capture.status] ? capture.status : 'not-captured';
    const textFile = /^text(?:-\d+)?\.txt$/.test(str(capture.text?.file)) ? capture.text.file : null;
    const files = arr(capture.files)
      .filter((f) => f && FORMAT_NAMES[f.format])
      .map((f) => ({
        format: f.format,
        formatName: FORMAT_NAMES[f.format],
        name: str(f.name),
        bytes: Number(f.bytes) || 0,
        sha256: SHA256.test(str(f.sha256)) ? f.sha256 : '',
        href: fileHref(id, f),
      }));
    const hasText = Boolean(textFile && fs.existsSync(path.join(dir, textFile)));
    // Only the plain text survives (a deleted doc recovered from a Wayback snapshot, or a doc whose owner blocked
    // downloads): offer the text itself as the download.
    const textOnly = hasText && !files.some((f) => ['pdf', 'docx', 'pptx', 'epub', 'html'].includes(f.format));
    const recovered = status === 'partial' && textOnly && files.length === 0;
    const fromSnapshot = recovered && arr(raw.links).some((l) => l?.type === 'wayback');
    const linkOnly = status === 'not-captured' && arr(raw.links).some((l) => l?.type === 'wayback');
    const label = recovered ? STATUS_TEXT_ONLY : linkOnly ? STATUS_LINK_ONLY : STATUS[status];
    return {
      n: i + 1,
      title: str(p?.title),
      sourceType: str(source.type),
      googleId: /^[A-Za-z0-9_-]{10,}$/.test(str(source.google_id)) ? source.google_id : null,
      sourceLabel: SOURCE_TYPES[source.type] || 'Link',
      url: safeUrl(source.url),
      status,
      statusLabel: label.label,
      tone: label.tone,
      recovered,
      fromSnapshot,
      linkOnly,
      images: files.filter((f) => (f.format === 'png' || f.format === 'jpg') && f.href),
      textHref: textOnly ? `${ARCHIVE_RAW_URL}/${encodeRepoPath(path.relative(ARCHIVE_DIR, path.join(dir, textFile)))}` : null,
      date: str(capture.date),
      pages: Number.isInteger(capture.pages) ? capture.pages : null,
      words: Number.isInteger(capture.words) ? capture.words : null,
      files,
      textPath: hasText ? path.join(dir, textFile) : null,
      textFile,
      missing: Object.entries(capture.missing && typeof capture.missing === 'object' ? capture.missing : {}).map(
        ([k, v]) => [FORMAT_NAMES[k] || str(k), missingReason(v)],
      ),
    };
  });

  const links = arr(raw.links)
    .map((l) => ({ type: str(l?.type), label: LINK_TYPES[l?.type] || 'Link', url: safeUrl(l?.url), note: str(l?.note) }))
    .filter((l) => l.url);

  const foundIn = arr(raw.found_in)
    .filter((f) => f && LIBRARIES[f.library])
    .map((f) => ({
      library: f.library,
      libraryName: LIBRARIES[f.library].name,
      libraryUrl: LIBRARIES[f.library].url,
      section: str(f.section).replace(/:\s*$/, ''),
      character: str(f.character),
      linkText: str(f.link_text),
      note: str(f.note),
    }));

  const sum = (key) => parts.reduce((n, p) => n + (p[key] || 0), 0);
  const redditPost = links.find((l) => l.type === 'reddit-post');

  return {
    id,
    category,
    categoryName: CATEGORY_NAMES[category],
    title: str(raw.title).trim(),
    altTitles: arr(raw.alt_titles).map(str).filter((t) => t && t !== raw.title),
    authors,
    series,
    characters,
    variant: str(raw.variant),
    tags: arr(raw.tags).map(str).filter((t) => SLUG.test(t)),
    language: /^[a-z]{2}$/.test(str(raw.language)) ? raw.language : null,
    languageName: languageName(raw.language),
    completion: ['finished', 'in-progress'].includes(raw.completion) ? raw.completion : 'unknown',
    parts,
    words: sum('words'),
    pages: sum('pages'),
    status: parts.every((p) => p.status === 'complete') ? 'complete' : parts[0].status,
    statusLabel: parts.every((p) => p.status === 'complete') ? STATUS.complete.label : parts[0].statusLabel,
    tone: parts.every((p) => p.status === 'complete') ? STATUS.complete.tone : parts[0].tone,
    hasRedditSource: parts.some((p) => p.sourceType === 'reddit-post'),
    foundIn,
    links,
    originalUrl: redditPost?.url || parts.find((p) => p.url)?.url || null,
    added: str(raw.added),
    review: { status: raw.review?.status === 'reviewed' ? 'reviewed' : 'auto', check: arr(raw.review?.check).map(str) },
    notes: str(raw.notes),
    repoPath: path.relative(ARCHIVE_DIR, dir).replaceAll('\\', '/'),
  };
}

let cache = null;

/** Loads everything once per build. */
export function loadArchive() {
  if (cache) return cache;
  if (!fs.existsSync(path.join(ARCHIVE_DIR, 'data', 'series.yaml'))) {
    throw new Error(`Archive not found at ${ARCHIVE_DIR}. Set ARCHIVE_DIR to a checkout of the archive repo.`);
  }
  const reg = { series: new Map(), characters: new Map(), warnings: [] };
  for (const s of arr(readYaml(path.join(ARCHIVE_DIR, 'data', 'series.yaml')))) {
    if (s && SLUG.test(str(s.id))) {
      const origin = /^([a-z]{2}|real)$/.test(str(s.origin_language)) ? s.origin_language : null;
      const medium = origin && SLUG.test(str(s.origin_medium)) ? s.origin_medium : null;
      reg.series.set(s.id, { id: s.id, name: str(s.name) || s.id, aliases: arr(s.aliases).map(str), origin, originLabel: originLabel(origin, medium) });
    }
  }
  for (const c of arr(readYaml(path.join(ARCHIVE_DIR, 'data', 'characters.yaml')))) {
    if (c && SLUG.test(str(c.id)))
      reg.characters.set(c.id, { id: c.id, name: str(c.name) || c.id, seriesId: c.series ? str(c.series) : null, aliases: arr(c.aliases).map(str) });
  }

  const entries = [];
  const seen = new Map();
  for (const file of findMetaFiles(ARCHIVE_DIR)) {
    const e = normalizeEntry(readYaml(file), file, reg);
    if (seen.has(e.id)) throw new Error(`Duplicate id "${e.id}" in ${e.repoPath} and ${seen.get(e.id)}`);
    seen.set(e.id, e.repoPath);
    entries.push(e);
  }
  entries.sort((a, b) => compareTitles(a.title, b.title));
  const byId = new Map(entries.map((e) => [e.id, e]));

  const group = (keyFn, makeFn) => {
    const m = new Map();
    for (const e of entries) {
      for (const [key, seed] of keyFn(e)) {
        if (!m.has(key)) m.set(key, { ...makeFn(key, seed), entries: [] });
        const g = m.get(key);
        if (g.entries.at(-1) !== e) g.entries.push(e);
      }
    }
    return [...m.values()].sort(byName);
  };

  const series = group(
    (e) => e.series.map((s) => [s.id, s]),
    (id, s) => ({ id, name: s.name, aliases: reg.series.get(id)?.aliases || [], originLabel: reg.series.get(id)?.originLabel || '' }),
  );
  // Source-language groups of each entry, through its series (a crossover can have two).
  for (const e of entries) {
    e.origins = [...new Set(e.series.map((s) => originGroup(reg.series.get(s.id)?.origin)).filter(Boolean))].map(
      (id) => ORIGIN_GROUPS.find((g) => g.id === id),
    );
  }
  const origins = ORIGIN_GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => e.origins.some((o) => o.id === g.id)) }));
  const characters = group(
    (e) => e.characters.map((c) => [c.id, c]),
    (id, c) => {
      const r = reg.characters.get(id);
      const sid = r?.seriesId || null;
      return { id, name: c.name, aliases: r?.aliases || [], seriesId: sid, seriesName: sid ? reg.series.get(sid)?.name || sid : null };
    },
  );
  const authors = group(
    (e) => e.authors.map((a) => [a.key, a]),
    (key, a) => ({ key, name: a.name, reddit: a.reddit }),
  );
  for (const a of authors) a.reddit ||= a.entries.flatMap((e) => e.authors).find((x) => x.key === a.key && x.reddit)?.reddit || null;
  const tags = group(
    (e) => e.tags.map((t) => [t, t]),
    (id) => ({ id, name: id }),
  );
  const languages = group(
    (e) => [[e.language || 'unknown', e.language]],
    (code, lang) => ({ id: code, name: languageName(lang) }),
  );

  const charSeries = new Map([...reg.characters.values()].map((c) => [c.id, c.seriesId]));
  const topicName = new Map(TOPICS.map((t) => [t.id, t.name]));
  for (const e of entries) e.topics = topicsFor(e, charSeries).map((id) => ({ id, name: topicName.get(id) }));
  const topics = TOPICS.map((t) => ({ ...t, entries: entries.filter((e) => e.topics.some((x) => x.id === t.id)) }));

  cache = { entries, byId, series, characters, authors, tags, languages, origins, topics, warnings: reg.warnings };
  return cache;
}

/** Plain text of all parts, joined. Read on demand (46 MB in total, so it isn't kept in memory). */
export function entryText(entry) {
  return entry.parts
    .filter((p) => p.textPath)
    .map((p) => fs.readFileSync(p.textPath, 'utf8'))
    .join('\n\n');
}

/** First ~N words of the text, cut on a word boundary. */
export function textPreview(entry, maxChars = 1200) {
  const p = entry.parts.find((x) => x.textPath);
  if (!p) return '';
  const fd = fs.openSync(p.textPath, 'r');
  try {
    const buf = Buffer.alloc(maxChars * 4);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    let text = buf.subarray(0, n).toString('utf8').replace(/^﻿/, '').replace(/�+$/, '');
    text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > maxChars) text = text.slice(0, maxChars).replace(/\s+\S*$/, '') + ' …';
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

export function authorLabel(entry) {
  return entry.authors.length ? entry.authors.map((a) => a.name).join(', ') : 'Unknown author';
}
