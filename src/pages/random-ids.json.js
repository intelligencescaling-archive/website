// Every entry id, for the "Random doc" button (fetched only when someone clicks it) and the Library's Saved list
// (public/saved.js: drops saved docs that are gone; fetched only when something is saved).
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const ids = loadArchive().entries.map((e) => e.id);
  return new Response(JSON.stringify(ids), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
