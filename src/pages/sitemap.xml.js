// Plain sitemap, built from the same data as the pages (no extra dependency).
import { loadArchive } from '../lib/archive.mjs';

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function GET({ site }) {
  const { entries, series, characters, authors, tags } = loadArchive();
  const paths = [
    '/', '/browse/', '/search/', '/series/', '/characters/', '/authors/', '/tags/', '/about/', '/acknowledgments/', '/removal/',
    ...entries.map((e) => `/items/${e.id}/`),
    ...series.map((s) => `/series/${s.id}/`),
    ...characters.map((c) => `/characters/${c.id}/`),
    ...authors.map((a) => `/authors/${a.key}/`),
    ...tags.map((t) => `/tags/${t.id}/`),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => `  <url><loc>${xmlEscape(new URL(p, site).href)}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
