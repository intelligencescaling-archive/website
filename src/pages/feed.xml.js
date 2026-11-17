// RSS feed of the newest entries (by the date they were added to the archive), for feed readers and bots.
import { loadArchive, newestEntries } from '../lib/archive.mjs';

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const rfc822 = (d) => new Date(`${d}T12:00:00Z`).toUTCString();

export function GET({ site }) {
  const items = newestEntries(loadArchive().entries, 50);
  const lastBuild = items[0]?.added || '2026-11-15';
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Intelligence Scaling Archive: new docs</title>
<link>${xml(site.href)}</link>
<atom:link href="${xml(new URL('/feed.xml', site).href)}" rel="self" type="application/rss+xml" />
<description>Docs and stories newly added to the archive of r/IntelligenceScaling.</description>
<language>en</language>
<lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>
${items
  .map((e) => {
    const url = new URL(`/items/${e.id}/`, site).href;
    const by = e.authors.length ? e.authors.map((a) => a.name).join(', ') : 'Unknown author';
    const about = [...e.series.map((s) => s.name), ...e.characters.slice(0, 4).map((c) => c.name)].join(', ');
    return `<item>
<title>${xml(e.title)}</title>
<link>${xml(url)}</link>
<guid isPermaLink="true">${xml(url)}</guid>
<pubDate>${rfc822(e.added)}</pubDate>
<description>${xml(`${e.categoryName} by ${by}${about ? `. ${about}` : ''}${e.words ? `. ${e.words.toLocaleString('en-US')} words` : ''}.`)}</description>
</item>`;
  })
  .join('\n')}
</channel>
</rss>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
