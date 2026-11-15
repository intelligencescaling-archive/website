// Builds the Pagefind full-text index after Astro writes the site.
// One custom record per entry: its metadata plus the full plain text of every part, so search
// finds words inside documents while item pages stay small.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pagefind from 'pagefind';
import { loadArchive, entryText, CATEGORY_PLURAL } from '../lib/archive.mjs';

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const escapeFilters = (filters) =>
  Object.fromEntries(Object.entries(filters).map(([k, values]) => [k, [...new Set(values)].map(escapeHtml)]));

export default function searchIndex() {
  return {
    name: 'archive-search-index',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = path.join(fileURLToPath(dir), 'pagefind');
        const { entries, warnings } = loadArchive();
        for (const w of warnings.slice(0, 20)) logger.warn(w);
        if (warnings.length > 20) logger.warn(`...and ${warnings.length - 20} more warnings`);
        const { errors, index } = await pagefind.createIndex({ forceLanguage: 'en' });
        if (!index) throw new Error(`Pagefind: ${errors.join('; ')}`);
        let chars = 0;
        for (const e of entries) {
          const head = [
            e.title,
            ...e.altTitles,
            e.authors.length ? e.authors.map((a) => a.name + (a.reddit ? ` u/${a.reddit}` : '')).join(', ') : 'Unknown author',
            e.series.map((s) => s.name).join(', '),
            e.characters.map((c) => c.name).join(', '),
            e.variant,
            e.tags.join(' '),
          ].filter(Boolean);
          const text = entryText(e);
          chars += text.length;
          const res = await index.addCustomRecord({
            url: `/items/${e.id}/`,
            // Pagefind treats content as plain text, so no HTML escaping is needed here.
            content: head.join('. ') + '\n\n' + text,
            language: 'en',
            meta: {
              title: e.title,
              by: e.authors.length ? e.authors.map((a) => a.name).join(', ') : 'Unknown author',
              series: e.series.map((s) => s.name).join(', '),
            },
            // Pagefind's default UI inserts filter values as raw HTML (titles, meta and excerpts
            // are escaped, filter labels are not), so every filter value is escaped here.
            filters: escapeFilters({
              Category: [CATEGORY_PLURAL[e.category]],
              Series: e.series.length ? e.series.map((s) => s.name) : ['(No series)'],
              Character: e.characters.map((c) => c.name),
              Author: e.authors.length ? e.authors.map((a) => a.name) : ['Unknown author'],
              Tag: e.tags,
              Language: [e.languageName],
            }),
            sort: { title: e.title.toLowerCase(), words: String(e.words).padStart(9, '0') },
          });
          if (res.errors?.length) logger.warn(`${e.id}: ${res.errors.join('; ')}`);
        }
        const written = await index.writeFiles({ outputPath: out });
        if (written.errors?.length) throw new Error(`Pagefind: ${written.errors.join('; ')}`);
        await pagefind.close();
        logger.info(`Indexed ${entries.length} entries (${(chars / 1e6).toFixed(1)} M characters of text)`);
      },
    },
  };
}
