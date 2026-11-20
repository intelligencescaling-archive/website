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
    desc: 'Category systems, scaling methods, how-to guides and templates.',
    tags: ['guide', 'template', 'composite'],
    subs: [
      ['Guides', 'guide'],
      ['Templates', 'template'],
    ],
  },
  {
    id: 'stories-and-ocs',
    name: 'Stories & original characters',
    desc: 'Original fiction, OC docs and crossover fights.',
    tags: ['oc', 'fanfiction', 'story'],
    stories: true,
  },
  { id: 'community-games', name: 'Community games & events', desc: 'Rulebooks and tournaments run on the sub.', tags: ['game'] },
  {
    id: 'libraries-and-history',
    name: 'Libraries & community history',
    desc: 'Doc collections and the story of SCD.',
    tags: ['community'],
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

/**
 * Tag groups, in the order chips are shown. Tags come from the archive's data/tags.yaml (the registry);
 * a group the website doesn't know yet is shown like `type`.
 */
export const TAG_GROUPS = [
  { id: 'type', name: 'Doc type', desc: 'What the doc is.' },
  { id: 'fiction', name: 'Fiction', desc: 'Stories and fanfiction.' },
  { id: 'subject', name: 'Subject', desc: 'Who the doc is about.' },
  { id: 'meta', name: 'About the file', desc: 'Notes about the saved copy itself.' },
];
const groupRank = (g) => {
  const i = TAG_GROUPS.findIndex((x) => x.id === g);
  return i < 0 ? 0 : i;
};

/**
 * Meta tags the website works out from the data (they are not stored in meta.yaml).
 * `test` gets the normalized entry.
 */
const DERIVED_TAGS = [
  {
    id: 'in-progress',
    name: 'In progress',
    definition: 'The author marked it as not finished yet (more parts or chapters may come).',
    test: (e) => e.completion === 'in-progress',
  },
  {
    id: 'text-only',
    name: 'Text only',
    definition: 'Only the plain text was saved, with no PDF (the owner blocked downloads, or the text came from a Wayback snapshot or a Reddit post).',
    test: (e) => e.words > 0 && e.parts.some((p) => p.textPath) && !e.parts.some((p) => p.files.some((f) => f.format === 'pdf')),
  },
  {
    id: 'original-gone',
    name: 'Original gone',
    definition: 'The original doc was deleted or made private. The copy here may be the only one left.',
    // capture.status dead/private, or the text was recovered from a Wayback snapshot because the original was gone.
    test: (e) => e.parts.some((p) => p.status === 'dead' || p.status === 'private' || p.fromSnapshot),
  },
  {
    id: 'multi-part',
    name: 'Multi-part',
    definition: 'The entry has more than one part (chapters, volumes or several docs).',
    test: (e) => e.parts.length > 1,
  },
];

/** The tag registry (data/tags.yaml): id -> { id, name, group, definition, aliases, implies, order }. */
function readTags(file) {
  const tags = new Map();
  if (!fs.existsSync(file)) return tags;
  arr(readYaml(file)).forEach((t, i) => {
    if (!t || !SLUG.test(str(t.id))) return;
    tags.set(t.id, {
      id: t.id,
      name: str(t.name).trim() || t.id,
      group: SLUG.test(str(t.group)) ? t.group : 'type',
      definition: str(t.definition).trim(),
      aliases: arr(t.aliases).map(str).filter(Boolean),
      order: i,
      derived: false,
    });
  });
  // Derived meta tags come after the registry's own tags (a registry tag with the same id wins).
  DERIVED_TAGS.forEach((d, i) => {
    if (!tags.has(d.id)) tags.set(d.id, { id: d.id, name: d.name, group: 'meta', definition: d.definition, aliases: [], order: 1000 + i, derived: true });
  });
  return tags;
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

/** "1 doc", "1,274 docs": the one noun for archive entries (stories included). */
export function docsLabel(n) {
  return `${formatNumber(n)} ${n === 1 ? 'doc' : 'docs'}`;
}

/** Aliases to show: without the name itself and without copies that differ only in case or spacing. */
export function distinctAliases(name, aliases) {
  // Same words in another order ("Ayanokoji Kiyotaka" vs "Kiyotaka Ayanokoji") is not a new name.
  const key = (x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const seen = new Set([key(name)]);
  return aliases.map((a) => String(a).replace(/:\s*$/, '').trim()).filter((a) => a && !seen.has(key(a)) && seen.add(key(a)));
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

/** One credit per person: two credits can be the same person (e.g. a display name and a Reddit handle). */
function dedupeCredits(list) {
  const seen = new Set();
  return list.filter((c) => !seen.has(c.key) && seen.add(c.key));
}

/**
 * Reddit accounts that no longer work (data/reddit-accounts.yaml: `{handle, status, checked}`, matched without case).
 * Filled by loadArchive(). Only `gone` and `suspended` change what pages show: the handle is no longer a link and gets
 * a small label. `active`, `unknown` or no row: shown as before.
 */
const redditAccounts = new Map();
const ACCOUNT_FLAGS = {
  gone: { flag: 'deleted', note: 'This Reddit account was deleted or no longer exists', line: 'no longer exists' },
  suspended: { flag: 'suspended', note: 'This Reddit account is suspended', line: 'is suspended' },
};
function readRedditAccounts(file) {
  redditAccounts.clear();
  if (!fs.existsSync(file)) return;
  for (const r of arr(readYaml(file))) {
    const handle = str(r?.handle).trim().replace(/^u\//i, '');
    if (!REDDIT_NAME.test(handle) || !ACCOUNT_FLAGS[r?.status]) continue;
    // `checked` is an unquoted date: a string with this YAML parser, a Date with others. Both work.
    const day = r.checked instanceof Date && !isNaN(r.checked) ? r.checked.toISOString().slice(0, 10) : str(r.checked);
    const checked = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
    const f = ACCOUNT_FLAGS[r.status];
    const when = checked ? ` (checked ${formatDate(checked)})` : '';
    redditAccounts.set(handle.toLowerCase(), { status: r.status, checked, flag: f.flag, note: f.note + when, tail: `${f.line}${when}.` });
  }
}
/** `{status, checked, flag, note, tail}` when the Reddit account is gone or suspended, else null. */
export function redditAccount(handle) {
  return (handle && redditAccounts.get(String(handle).toLowerCase())) || null;
}

/** "u/Name" for a Reddit handle, else the name. */
export function sharerName(s) {
  return s.reddit ? `u/${s.reddit}` : s.name;
}

/**
 * Contact handles of a person (data/authors.yaml `contacts: [{platform, handle}]`), so readers know which name to
 * use to reach the maker. `url` is set only for platforms with profile pages and only when the handle looks valid
 * for that platform; `copy` marks handles people type into an app (Discord, Telegram, other).
 */
export const CONTACT_PLATFORMS = {
  discord: { name: 'Discord', copy: true },
  telegram: { name: 'Telegram', copy: true, re: /^[A-Za-z0-9_]{5,32}$/, url: (h) => `https://t.me/${h}` },
  reddit: { name: 'Reddit', prefix: 'u/', re: REDDIT_NAME, url: (h) => `https://www.reddit.com/user/${h}/` },
  twitter: { name: 'X (Twitter)', prefix: '@', re: /^[A-Za-z0-9_]{1,15}$/, url: (h) => `https://x.com/${h}` },
  youtube: { name: 'YouTube', prefix: '@', re: /^[A-Za-z0-9._-]{3,30}$/, url: (h) => `https://www.youtube.com/@${h}` },
  tiktok: { name: 'TikTok', prefix: '@', re: /^[A-Za-z0-9._]{2,24}$/, url: (h) => `https://www.tiktok.com/@${h}` },
  other: { name: 'Other', copy: true },
};
function readContacts(list) {
  const out = [];
  for (const c of arr(list)) {
    const platform = str(c?.platform).toLowerCase();
    const def = CONTACT_PLATFORMS[platform];
    // Handles are shown as text; strip a leading @ or u/ (the page adds the platform's own prefix).
    const handle = str(c?.handle).trim().replace(/^(@|u\/)/, '');
    // Channel names can have spaces ("Hour Reach"): kept, shown without a link.
    if (!def || !handle || handle.length > 64 || /[<>\p{Cc}]/u.test(handle)) continue;
    if (out.some((x) => x.platform === platform && x.handle.toLowerCase() === handle.toLowerCase())) continue;
    const url = def.url && def.re.test(handle) ? safeUrl(def.url(handle)) : null;
    // A name with no profile link gets a Copy button, so it can be pasted into the app's search.
    out.push({ platform, platformName: def.name, handle, label: (url ? def.prefix || '' : '') + handle, url, copy: !!def.copy || !url });
  }
  return out;
}

/** Person registry (data/authors.yaml): id -> { id, name, aliases, reddit[] }. Empty for archives made before it. */
function readPeople(file) {
  const people = new Map();
  if (!fs.existsSync(file)) return people;
  for (const p of arr(readYaml(file))) {
    if (!p || !SLUG.test(str(p.id)) || !str(p.name).trim()) continue;
    people.set(p.id, {
      id: p.id,
      name: str(p.name).trim(),
      aliases: arr(p.aliases).map(str).filter(Boolean),
      reddit: arr(p.reddit).map(str).filter((r) => REDDIT_NAME.test(r)),
      contacts: readContacts(p.contacts),
    });
  }
  return people;
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

  // A credit (an author, or the person who shared it). With the archive's person registry
  // (data/authors.yaml), `key` is the person id and `name` their main name; `credited` keeps the name as written.
  const credits = (list, field) =>
    dedupeCredits(
      arr(list)
        .filter((a) => a && str(a.name).trim())
        .map((a) => {
          const credited = str(a.name).trim();
          const ownReddit = REDDIT_NAME.test(str(a.reddit)) ? a.reddit : null;
          const pid = SLUG.test(str(a.id)) ? a.id : null;
          const p = pid ? reg.people.get(pid) : null;
          if (pid && !p && reg.people.size) reg.warnings.push(`${where}: unknown person "${pid}" in ${field}`);
          if (p) return { name: p.name, credited, reddit: ownReddit || p.reddit[0] || null, source: str(a.source), key: p.id, contacts: p.contacts };
          return { name: credited, credited, reddit: ownReddit, source: str(a.source), key: slugify(ownReddit || credited) };
        }),
    );
  const authors = credits(raw.authors, 'authors');
  // A person is never both maker and sharer of one entry; if the data says so anyway, the author credit wins.
  const sharedBy = credits(raw.shared_by, 'shared_by').filter((s) => !authors.some((a) => a.key === s.key));

  const series = arr(raw.series).map((sid) => {
    const s = reg.series.get(sid);
    if (!s) reg.warnings.push(`${where}: unknown series "${sid}"`);
    return { id: str(sid), name: s ? s.name : str(sid), known: !!s };
  });
  const characters = arr(raw.characters).map((cid) => {
    const c = reg.characters.get(cid);
    if (!c) reg.warnings.push(`${where}: unknown character "${cid}"`);
    return { id: str(cid), name: c ? c.name : str(cid), known: !!c, real: !!c?.real };
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
      // Rich reader blocks (DOCX text + images + colours, format v1, launch/images/converter/block-format.md),
      // next to the text file. Null when absent; the reader then shows the plain text.
      blocksPath: hasText && capture.blocks?.v === 1 && /^blocks(?:-\d+)?\.json$/.test(str(capture.blocks?.file)) &&
        fs.existsSync(path.join(dir, capture.blocks.file)) ? path.join(dir, capture.blocks.file) : null,
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
    sharedBy,
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
  const reg = { series: new Map(), characters: new Map(), people: readPeople(path.join(ARCHIVE_DIR, 'data', 'authors.yaml')), warnings: [] };
  const tagReg = readTags(path.join(ARCHIVE_DIR, 'data', 'tags.yaml'));
  readRedditAccounts(path.join(ARCHIVE_DIR, 'data', 'reddit-accounts.yaml'));
  for (const s of arr(readYaml(path.join(ARCHIVE_DIR, 'data', 'series.yaml')))) {
    if (s && SLUG.test(str(s.id))) {
      const origin = /^([a-z]{2}|real)$/.test(str(s.origin_language)) ? s.origin_language : null;
      const medium = origin && SLUG.test(str(s.origin_medium)) ? s.origin_medium : null;
      reg.series.set(s.id, { id: s.id, name: str(s.name) || s.id, aliases: arr(s.aliases).map(str), origin, originLabel: originLabel(origin, medium) });
    }
  }
  for (const c of arr(readYaml(path.join(ARCHIVE_DIR, 'data', 'characters.yaml')))) {
    if (c && SLUG.test(str(c.id)))
      reg.characters.set(c.id, { id: c.id, name: str(c.name) || c.id, seriesId: c.series ? str(c.series) : null, aliases: arr(c.aliases).map(str), real: c.real === true });
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
      return { id, name: c.name, aliases: r?.aliases || [], seriesId: sid, seriesName: sid ? reg.series.get(sid)?.name || sid : null, real: !!r?.real };
    },
  );
  // People: one page per person, with the entries they made (`entries`) and the ones they only shared (`shared`).
  // `authors` (the Authors index, search filter) has only the people credited as makers.
  const peopleMap = new Map();
  const personOf = (c) => {
    if (!peopleMap.has(c.key)) {
      const r = reg.people.get(c.key);
      peopleMap.set(c.key, { key: c.key, name: c.name, names: [...(r?.aliases || [])], handles: [...(r?.reddit || [])], contacts: r?.contacts || [], entries: [], shared: [] });
    }
    return peopleMap.get(c.key);
  };
  for (const e of entries) {
    for (const [list, field] of [[e.authors, 'entries'], [e.sharedBy, 'shared']]) {
      for (const c of list) {
        const p = personOf(c);
        if (p[field].at(-1) !== e) p[field].push(e);
        p.names.push(c.credited);
        if (c.reddit) p.handles.push(c.reddit);
      }
    }
  }
  const lc = (s) => s.toLowerCase();
  const people = [...peopleMap.values()].sort(byName);
  for (const p of people) {
    p.handles = [...new Map(p.handles.map((h) => [lc(h), h])).values()];
    p.reddit = p.handles[0] || null;
    // Other names the person is credited under, without the main name or a plain copy of a handle.
    const skip = new Set([lc(p.name), ...p.handles.map(lc)]);
    p.aliases = [...new Map(p.names.filter((n) => n && !skip.has(lc(n))).map((n) => [lc(n), n])).values()];
    // Everything that should find this person in search.
    p.match = [...new Set([...p.aliases, ...p.handles])];
    delete p.names;
  }
  const authors = people.filter((p) => p.entries.length);
  // Each entry's tags as chips: stored tags (from the registry) plus the derived meta tags, in group order.
  // A stored tag the registry doesn't know (an archive made before the registry) shows its id as the name.
  const unknownTag = (id) => ({ id, name: id, group: 'type', definition: '', aliases: [], order: 999, derived: false });
  for (const e of entries) {
    const list = e.tags.map((t) => {
      if (!tagReg.has(t)) {
        if (tagReg.size > DERIVED_TAGS.length) reg.warnings.push(`${e.repoPath}: tag "${t}" is not in data/tags.yaml`);
        tagReg.set(t, unknownTag(t));
      }
      return tagReg.get(t);
    });
    for (const d of DERIVED_TAGS) if (d.test(e) && !list.some((t) => t.id === d.id)) list.push(tagReg.get(d.id));
    e.tagList = [...new Set(list)].sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.order - b.order);
    e.tags = e.tagList.map((t) => t.id);
  }
  // Tag pages: every registry tag (even one no entry uses yet), in group order, with its entries.
  const tags = [...tagReg.values()]
    .map((t) => ({ ...t, entries: entries.filter((e) => e.tags.includes(t.id)) }))
    .filter((t) => t.entries.length || !t.derived)
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.order - b.order);
  const languages = group(
    (e) => [[e.language || 'unknown', e.language]],
    (code, lang) => ({ id: code, name: languageName(lang) }),
  );

  const charSeries = new Map([...reg.characters.values()].map((c) => [c.id, c.seriesId]));
  const topicName = new Map(TOPICS.map((t) => [t.id, t.name]));
  for (const e of entries) e.topics = topicsFor(e, charSeries).map((id) => ({ id, name: topicName.get(id) }));
  const topics = TOPICS.map((t) => ({ ...t, entries: entries.filter((e) => e.topics.some((x) => x.id === t.id)) }));

  cache = { entries, byId, series, characters, authors, people, tags, languages, origins, topics, warnings: reg.warnings };
  return cache;
}

/**
 * Redirects for author page URLs that changed when credits were grouped into people: every name, alias and
 * Reddit handle of a person, as a slug, points to the person's page. Skips slugs that are a page themselves
 * or that two people share. Returns `[from, to]` paths.
 */
export function authorRedirects() {
  const { people } = loadArchive();
  const pages = new Set(people.map((p) => p.key));
  const target = new Map();
  for (const p of people) {
    for (const n of [p.name, ...p.match]) {
      const s = slugify(n);
      if (pages.has(s)) continue;
      target.set(s, target.has(s) && target.get(s) !== p.key ? null : p.key);
    }
  }
  return [...target].filter(([, to]) => to).sort().map(([from, to]) => [`/authors/${from}/`, `/authors/${to}/`]);
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

// Formats that mean the doc has its own layout (images, colours, tables). The reader shows only the plain text of
// these, with a note that points to the original file.
const LAID_OUT = ['pdf', 'docx', 'pptx', 'epub', 'html'];

/** True when the entry has saved text with words in it: it gets the reader view. Image-only docs (0 words) don't. */
export function hasReader(entry) {
  return entry.words > 0 && entry.parts.some((p) => p.textPath);
}

/** True when the entry has no PDF/DOCX/EPUB/… in any part: the reader view is the main way to read it. */
export function textOnly(entry) {
  return entry.parts.every((p) => !p.files.some((f) => LAID_OUT.includes(f.format)));
}

/**
 * The best original file to open instead of the plain text: the first PDF, else the first DOCX/PPTX/EPUB/HTML
 * that is online. `multi` is true when more than one part has one (then the item page lists them all).
 */
export function originalFile(entry) {
  const withFiles = entry.parts.filter((p) => p.files.some((f) => LAID_OUT.includes(f.format) && f.href));
  for (const fmt of LAID_OUT) {
    for (const p of withFiles) {
      const f = p.files.find((x) => x.format === fmt && x.href);
      if (f) return { href: f.href, format: f.format, formatName: f.formatName, multi: withFiles.length > 1 };
    }
  }
  return null;
}

// Paragraphs longer than this are cut at line breaks into pieces (shown as one paragraph), so a reading position
// and a page break can fall inside them. A single line longer than PAGE_BYTES is cut at a space.
const PIECE_CHARS = 3000;
// About this much text (UTF-8 bytes, escaped) per reader page, so no page gets much over ~700 KB of HTML.
export const PAGE_BYTES = 600_000;

function pieces(text) {
  if (text.length <= PIECE_CHARS) return [text];
  const out = [];
  let cur = '';
  for (let line of text.split('\n')) {
    // A huge line with no breaks (rare): cut at spaces, about every PIECE_CHARS * 10 characters.
    while (line.length > PIECE_CHARS * 10) {
      let cut = line.lastIndexOf(' ', PIECE_CHARS * 10);
      if (cut < PIECE_CHARS) cut = PIECE_CHARS * 10;
      if (cur) out.push(cur), (cur = '');
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ /, '');
    }
    if (cur && cur.length + line.length + 1 > PIECE_CHARS) out.push(cur), (cur = line);
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The reader view's chapters: one per part with text. Each chapter is a list of blocks, `{ level, text, cont }`:
 * level 0 is a paragraph (blank-line separated; single line breaks are kept by CSS), 1–3 a heading
 * (a line starting with #, ## or ###). `cont` marks a piece of a long paragraph that the next block continues.
 * Plain strings only: pages render them with Astro expressions.
 * A first line that only repeats the part title is dropped, since the chapter heading shows it.
 */
export function readerChapters(entry) {
  const same = (a, b) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const chapters = entry.parts
    .filter((p) => p.textPath)
    .map((p) => {
      const text = fs.readFileSync(p.textPath, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      const blocks = [];
      let para = [];
      const flush = () => {
        const t = para.join('\n').trim();
        if (t) {
          const ps = pieces(t);
          ps.forEach((x, i) => blocks.push({ level: 0, text: x, cont: i < ps.length - 1 }));
        }
        para = [];
      };
      for (const line of text.split('\n')) {
        const h = /^(#{1,6})\s*(.*\S)\s*$/.exec(line);
        if (h) {
          flush();
          blocks.push({ level: Math.min(h[1].length, 3), text: h[2], cont: false });
        } else if (!line.trim()) flush();
        else para.push(line.replace(/\s+$/, ''));
      }
      flush();
      if (blocks.length > 1 && p.title && same(blocks[0].text, p.title)) blocks.shift();
      chapterLines(blocks);
      const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g) || []).length, 0);
      return { n: p.n, title: p.title, blocks, words, blocksPath: p.blocksPath || null };
    });
  // Word offset of every block in the whole doc (`w`), and a doc-wide number for every heading (`sid`):
  // the reader's "Go to" sheet links to `#s-<sid>` and jumps to a position by word offset across pages.
  let w = 0;
  let sid = 0;
  for (const c of chapters) {
    c.w = w;
    for (const b of c.blocks) {
      b.w = w;
      if (b.level > 0) b.sid = ++sid;
      w += (b.text.match(/\S+/g) || []).length;
    }
  }
  return chapters;
}

// Plain-text chapter lines ("Chapter 4: The Bet", "PROLOGUE", "Part II") on a line of their own become headings,
// so long stories without "#" headings still get a chapter list. Only when a part has at least two of them.
const NUM = String.raw`(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;
const CHAPTER_LINE = new RegExp(String.raw`^(?:(chapter|ch\.|episode)\s*${NUM}\b|(prologue|epilogue|interlude|afterword|foreword)\b|(part|book|volume|vol\.|act|arc)\s+${NUM}\b)`, 'i');
function chapterLines(blocks) {
  const found = [];
  blocks.forEach((b, k) => {
    if (b.level !== 0 || (k > 0 && blocks[k - 1].cont)) return;
    // The chapter line is the paragraph, or its first line when the text follows without a blank line.
    const nl = b.text.indexOf('\n');
    const t = (nl < 0 ? b.text : b.text.slice(0, nl)).trim();
    if (t.length > 90) return;
    const m = CHAPTER_LINE.exec(t);
    if (!m) return;
    const rest = t.slice(m[0].length).trim();
    // "Part 2 of the plan failed, so…" is prose, not a heading.
    if ((rest.match(/\S+/g) || []).length > 10 || /[,;]$/.test(t) || /^(of|was|is|and|in)\b/i.test(rest)) return;
    found.push({ k, t, after: nl < 0 ? '' : b.text.slice(nl + 1).trim(), big: Boolean(m[3]) });
  });
  if (found.length < 2) return;
  const nested = found.some((f) => f.big) && found.some((f) => !f.big);
  for (const f of found.reverse()) {
    const head = { level: nested && !f.big ? 2 : 1, text: f.t, cont: false };
    if (f.after) blocks.splice(f.k, 1, head, { ...blocks[f.k], text: f.after });
    else blocks[f.k] = head;
  }
}

/** What the reader calls the parts of a multi-part entry: "Volume" when the part titles say so, else Chapter/Part. */
export function readerUnit(entry) {
  if (entry.parts.filter((p) => p.textPath).some((p) => /\bvol(?:ume)?\.?\s*\d/i.test(p.title || ''))) return 'Volume';
  return entry.category === 'story' ? 'Chapter' : 'Part';
}

const htmlBytes = (s) => Buffer.byteLength(s) + (s.match(/[&<>"]/g)?.length || 0) * 4 + 12;

/**
 * Splits the reader text into pages of about PAGE_BYTES each (most docs are one page). Pages break between
 * chapters where they can, else before a heading, else between paragraphs. Returns
 * `[{ chapters: [{ i, title, words, blocks, cont, first }], wordsBefore, words }]`: `i` is the chapter's index in the
 * whole doc, `first` is true on the page where the chapter starts, `cont` when it goes on to the next page.
 */
export function readerPages(chapters) {
  const sizes = chapters.map((c) => c.blocks.map((b) => htmlBytes(b.text)));
  const total = sizes.flat().reduce((a, b) => a + b, 0);
  const n = Math.max(1, Math.ceil(total / PAGE_BYTES));
  const target = total / n;
  const wordsOf = (b) => (b.text.match(/\S+/g) || []).length;
  const pages = [];
  let page = null;
  let size = 0;
  let wordsSoFar = 0;
  const newPage = () => {
    page = { chapters: [], wordsBefore: wordsSoFar, words: 0 };
    pages.push(page);
    size = 0;
  };
  newPage();
  chapters.forEach((c, i) => {
    // A new chapter starts a new page when this page is already well filled.
    if (page.chapters.length && size >= target * 0.6 && pages.length < n) newPage();
    let part = { i, title: c.title, words: 0, blocks: [], cont: false, first: true };
    page.chapters.push(part);
    c.blocks.forEach((b, k) => {
      const s = sizes[i][k];
      const prev = c.blocks[k - 1];
      const breakable = k > 0 && !prev.cont;
      const full = size + s > target && size >= target * 0.5;
      const headingBreak = b.level > 0 && size >= target * 0.85;
      if (breakable && pages.length < n && (full || headingBreak)) {
        part.cont = true;
        newPage();
        part = { i, title: c.title, words: 0, blocks: [], cont: false, first: false };
        page.chapters.push(part);
      }
      const w = wordsOf(b);
      part.blocks.push(b);
      part.words += w;
      page.words += w;
      wordsSoFar += w;
      size += s;
    });
  });
  return pages;
}

export function authorLabel(entry) {
  return entry.authors.length ? entry.authors.map((a) => a.name).join(', ') : 'Unknown author';
}

/** One short line for bylines and descriptions: "by A, B", else "shared by u/X", else "by Unknown author". */
export function bylineText(entry) {
  if (entry.authors.length || !entry.sharedBy.length) return `by ${authorLabel(entry)}`;
  return `shared by ${entry.sharedBy.map(sharerName).join(', ')}`;
}
