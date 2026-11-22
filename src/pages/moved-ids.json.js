// Merged or renamed docs, old item id -> current item id (from the /items/ lines in public/_redirects). The Library's
// Saved list (public/saved.js) uses it, with random-ids.json, to follow merged docs and drop removed ones.
// Fetched only when someone has saved docs.
import fs from 'node:fs';
import path from 'node:path';
import { loadArchive } from '../lib/archive.mjs';

export function GET() {
  const ids = new Set(loadArchive().entries.map((e) => e.id));
  const file = path.join(process.cwd(), 'public', '_redirects');
  const hop = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\/items\/([^/\s]+)\/?\s+\/items\/([^/\s#?]+)\/?\s/.exec(`${line.trim()} `);
      if (m && m[1] !== m[2]) hop[m[1]] = m[2];
    }
  }
  const out = {};
  for (const from of Object.keys(hop)) {
    let to = hop[from];
    for (let i = 0; i < 5 && !ids.has(to) && hop[to]; i++) to = hop[to];
    if (ids.has(to) && !ids.has(from)) out[from] = to;
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
