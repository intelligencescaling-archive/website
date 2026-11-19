// Plain sitemap, built from the same data as the pages (no extra dependency).
import { loadArchive } from '../lib/archive.mjs';

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function GET({ site }) {
  const { entries, series, characters, people, tags } = loadArchive();
  const paths = [
    '/', '/search/', '/library/', '/series/', '/characters/', '/authors/', '/tags/', '/about/', '/acknowledgments/', '/removal/', '/submit/',
    ...entries.map((e) => [`/items/${e.id}/`, e.added]),
    ...series.map((s) => `/series/${s.id}/`),
    ...characters.map((c) => `/characters/${c.id}/`),
    ...people.map((a) => `/authors/${a.key}/`),
    ...tags.map((t) => `/tags/${t.id}/`),
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths
      .map((p) => {
        // Item pages carry the date they were added (lastmod), so search engines pick up new docs first.
        const [path, added] = Array.isArray(p) ? p : [p, null];
        const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(added || '') ? `<lastmod>${added}</lastmod>` : '';
        return `  <url><loc>${xmlEscape(new URL(path, site).href)}</loc>${lastmod}</url>`;
      })
      .join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
