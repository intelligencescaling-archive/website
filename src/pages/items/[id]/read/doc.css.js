// /items/<id>/read/doc.css: the colours (per theme) and image boxes of an entry's rich reader pages
// (src/lib/blocks.mjs). A file of its own because the CSP allows no inline styles. Only for entries with blocks.
import { loadArchive, hasReader, readerChapters, readerPages } from '../../../../lib/archive.mjs';
import { entryDocCss } from '../../../../lib/blocks.mjs';

export function getStaticPaths() {
  return loadArchive()
    .entries.filter((e) => hasReader(e) && e.parts.some((p) => p.textPath && p.blocksPath))
    .map((entry) => ({ params: { id: entry.id }, props: { entry } }));
}

export function GET({ props }) {
  const chapters = readerChapters(props.entry);
  const css = entryDocCss(chapters, readerPages(chapters), chapters.length > 1) || '\n';
  return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
}
