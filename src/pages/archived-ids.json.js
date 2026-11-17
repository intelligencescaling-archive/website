// Google ids and Reddit post ids already in the archive, each mapped to its item id. The Submit page
// uses it to say "already archived, here it is" before anything is sent. Everything here is public anyway.
import { loadArchive } from '../lib/archive.mjs';

const REDDIT_POST = /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]{5,10})/i;

export function GET() {
  const g = {};
  const r = {};
  for (const e of loadArchive().entries) {
    for (const p of e.parts) {
      if (p.googleId) g[p.googleId] ??= e.id;
      const m = p.url && REDDIT_POST.exec(p.url);
      if (m) r[m[1].toLowerCase()] ??= e.id;
    }
    for (const l of e.links || []) {
      const m = l.url && REDDIT_POST.exec(l.url);
      if (m) r[m[1].toLowerCase()] ??= e.id;
    }
  }
  return new Response(JSON.stringify({ g, r }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
