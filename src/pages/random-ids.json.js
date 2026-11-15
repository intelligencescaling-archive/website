// Every entry id, for the "Random doc" button. Fetched only when someone clicks it.
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const ids = loadArchive().entries.map((e) => e.id);
  return new Response(JSON.stringify(ids), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
