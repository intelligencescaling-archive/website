// Small display helpers shared by the list rows, pages and the search script (rules.md: one muted meta line per row,
// sizes as "137k" with the unit shown once in the list head).

/** Word count as a short number: 850, 8.2k, 137k, 1.2M. 0 or unknown -> ''. */
export function shortNum(n) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

/** A maker known only by an app handle (no Reddit account): the platform name, shown as "(Discord)" after the name. */
export function contactHint(a) {
  return !a.reddit && a.contacts?.length ? a.contacts[0].platformName : null;
}

/** The doc's kind: its first non-meta tag (Feats, Analysis, Story…), skipping `skip` (the page's own tag). */
export function kindOf(e, skip) {
  const t = e.tagList.find((x) => x.group !== 'meta' && x.id !== skip);
  return t ? t.name : '';
}

/**
 * What the doc is about, unless the page already says it: its first character other than `known` (+N for more);
 * nothing when all its characters are the known one; else its first series other than `known`.
 */
export function subjectOf(e, known) {
  const cs = e.characters.filter((c) => c.id !== known);
  if (cs.length) return cs[0].name + (cs.length > 1 ? ` +${cs.length - 1}` : '');
  if (e.characters.length) return '';
  const s = e.series.find((x) => x.id !== known);
  return s ? s.name : '';
}

/**
 * Who made it, for a row: first maker (with the platform hint) and "+N"; else "shared by u/X"; else "Unknown author".
 * `person`: on that person's page they are left out (an empty byline when they are the only maker).
 * Returns { name, hint, more } or { text }.
 */
export function bylineOf(e, person) {
  const makers = e.authors.filter((a) => a.key !== person);
  if (makers.length) return { name: makers[0].name, hint: contactHint(makers[0]), more: makers.length - 1 };
  if (e.authors.length) return { text: '' };
  const sharers = e.sharedBy.filter((a) => a.key !== person);
  if (sharers.length) return { text: `shared by ${sharers[0].reddit ? `u/${sharers[0].reddit}` : sharers[0].name}` };
  if (e.sharedBy.length) return { text: '' };
  return { text: 'Unknown author' };
}

/** A short name for the meta line ("COTE", "18LOH"): the first alias without spaces, up to 8 letters. */
export function shortAlias(name, aliases) {
  const a = (aliases || []).find((x) => /^[A-Za-z0-9]{2,8}$/.test(x) && x.toLowerCase() !== name.toLowerCase());
  return a || '';
}

/** "1 doc" / "12 docs" style labels. */
export const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

const toks = (x) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((t) => t.length > 1);
const keyOf = (x) => x.toLowerCase().replace(/['’]s(?![a-z])/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The doc page preview as blocks [{h, text}] (rules.md 3.4.5): a first line that repeats the title and a short byline
 * near the top (both are in the header already) are dropped; a short first line, or a short line ending in ":",
 * reads as a heading.
 */
export function previewBlocks(raw, title, makerNames) {
  const makers = makerNames.map((m) => m.toLowerCase());
  const isBy = (l) => /^(feat doc by|doc by|made by|written by|by|par|fait par)\b/i.test(l) || makers.some((m) => m.length > 2 && l.toLowerCase().includes(m));
  let lines = String(raw || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length) {
    const tt = toks(title);
    const first = toks(lines[0].replace(/^[ru]\/\S+\s*[-–:]\s*/i, ''));
    const shared = tt.filter((t) => first.includes(t)).length;
    if (keyOf(lines[0]) === keyOf(title) || (tt.length && shared / tt.length >= 0.7 && lines[0].length <= 2 * title.length)) lines.shift();
  }
  lines = lines.filter((l, i) => !(i < 3 && l.length < 60 && isBy(l) && makers.length));
  return lines.map((l, i) => ({ h: !isBy(l) && ((i === 0 && l.length < 70) || (l.length < 40 && /:$/.test(l))), text: l }));
}
