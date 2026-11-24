// Names of characters, series, tags and people (authors and sharers), for the search page's "top result" and grouped
// matches. Fetched by src/scripts/search.js; inserted there with textContent only.
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const { characters, series, people, removedAuthors, tags } = loadArchive();
  const out = {
    c: characters.map((c) => [c.name, c.id, c.entries.length, c.seriesName || '', c.aliases || []]),
    s: series.map((s) => [s.name, s.id, s.entries.length, s.originLabel ? s.originLabel.replace(/^./, (x) => x.toUpperCase()) : '', s.aliases || []]),
    // People: every name, alias and Reddit handle finds them. Someone who only shared docs gets a 6th field, the
    // label shown instead of "Author".
    a: [
      ...people.map((a) =>
        a.entries.length
          ? [a.name, a.key, a.entries.length, a.reddit ? `u/${a.reddit}` : '', a.match]
          : [a.name, a.key, a.shared.length, a.reddit ? `u/${a.reddit}` : '', a.match, 'Shared docs'],
      ),
      // Authors whose work was removed at their request: still found, with the reason in place of "Author".
      ...removedAuthors.map((a) => [a.name, a.key, 0, '', [], 'Removed at the author’s request']),
    ],
    // Tags: old tag names (aliases) find the new tag too.
    g: tags.filter((t) => t.entries.length).map((t) => [t.name, t.id, t.entries.length, '', [t.id, ...t.aliases.map((x) => x.replaceAll('-', ' '))]]),
  };
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
