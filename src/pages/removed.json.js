// Work removed at its author's request: hashes of old item ids (-> author page key, or "" for no mention) and of the
// removed links, plus the named authors. Used by the 404 page and the Submit form. No titles and no plain ids.
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const { removals, removedAuthors } = loadArchive();
  const gone = new Set(removedAuthors.map((a) => a.key));
  const names = Object.fromEntries(removals.authors.filter((a) => gone.has(a.key)).map((a) => [a.key, a.name]));
  // An author page exists for every named author (removed or with some work kept).
  const all = Object.fromEntries(removals.authors.map((a) => [a.key, a.name]));
  const out = { items: removals.items, links: removals.links, authors: all, blocked: Object.values(names).map((n) => n.toLowerCase()) };
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
