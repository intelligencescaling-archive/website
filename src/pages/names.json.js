// Names of characters, series, topics and people (authors and sharers), for the search page's "top result" and grouped
// matches. Fetched by src/scripts/search.js; inserted there with textContent only.
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const { characters, series, topics, people } = loadArchive();
  const out = {
    c: characters.map((c) => [c.name, c.id, c.entries.length, c.seriesName || '', c.aliases || []]),
    s: series.map((s) => [s.name, s.id, s.entries.length, '', s.aliases || []]),
    t: topics.filter((t) => !t.help && t.entries.length).map((t) => [t.name, t.id, t.entries.length, '', []]),
    // People: every name, alias and Reddit handle finds them. Someone who only shared docs gets a 6th field, the
    // label shown instead of "Author".
    a: people.map((a) =>
      a.entries.length
        ? [a.name, a.key, a.entries.length, a.reddit ? `u/${a.reddit}` : '', a.match]
        : [a.name, a.key, a.shared.length, a.reddit ? `u/${a.reddit}` : '', a.match, 'Shared docs'],
    ),
  };
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
