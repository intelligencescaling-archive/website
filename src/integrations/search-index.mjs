// Builds the Pagefind full-text index after Astro writes the site.
// One custom record per entry: its metadata plus the full plain text of every part, so search
// finds words inside documents while item pages stay small.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pagefind from 'pagefind';
import { loadArchive, entryText, sortTitle, sharerName, CATEGORY_PLURAL } from '../lib/archive.mjs';
import { lengthBucket } from '../lib/length.mjs';

// Filter values are stored as plain text. The site's own search page (src/scripts/search.js) shows
// them with textContent. Don't switch to Pagefind's default UI without escaping them: it inserts
// filter labels as raw HTML.
const uniq = (filters) => Object.fromEntries(Object.entries(filters).map(([k, values]) => [k, [...new Set(values)]]));

export default function searchIndex() {
  return {
    name: 'archive-search-index',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const out = path.join(fileURLToPath(dir), 'pagefind');
        const { entries, warnings, series, characters, people, tags } = loadArchive();
        // Old tag names ("strategy", "q-and-a") stay hidden search words, so old searches still find these entries.
        const tagWords = new Map(tags.map((t) => [t.id, [t.name, ...t.aliases.map((a) => a.replaceAll('-', ' '))]]));
        const personNames = new Map(people.map((p) => [p.key, p.match]));
        // Other spellings ("Ayanokouji" for "Ayanokoji") so a search finds the entry either way.
        const aliasesOf = new Map([...series, ...characters].map((x) => [x.id, x.aliases || []]));
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
            // Every other name and handle of the people involved, so any alias finds their docs.
            [...e.authors, ...e.sharedBy].flatMap((a) => personNames.get(a.key) || []).join(', '),
            e.sharedBy.length ? `Shared by ${e.sharedBy.map((s) => s.name + (s.reddit ? ` u/${s.reddit}` : '')).join(', ')}` : '',
            e.series.map((s) => s.name).join(', '),
            e.characters.map((c) => c.name).join(', '),
            [...e.series, ...e.characters].flatMap((x) => aliasesOf.get(x.id) || []).join(', '),
            e.variant,
            e.tags.flatMap((t) => tagWords.get(t) || [t]).join(', '),
          ].filter(Boolean);
          const text = entryText(e);
          chars += text.length;
          const res = await index.addCustomRecord({
            url: `/items/${e.id}/`,
            // Plain text. The doc text comes first so excerpts usually show the doc itself; the
            // metadata at the end keeps titles, authors and characters searchable.
            content: text + '\n\n' + head.join('. '),
            language: 'en',
            meta: {
              title: e.title,
              by: e.authors.length ? e.authors.map((a) => a.name).join(', ') : 'Unknown author',
              ...(e.sharedBy.length ? { sh: e.sharedBy.map(sharerName).join(', ') } : {}),
              series: e.series.map((s) => s.name).join(', '),
              // Characters for the result row's subject ("Horikita +2"), as plain text.
              ...(e.characters.length ? { ch: e.characters.slice(0, 3).map((c) => c.name).join('|') + (e.characters.length > 3 ? `|+${e.characters.length - 3}` : '') } : {}),
              // A maker known only by an app handle: its platform, shown as "(Discord)".
              ...(e.authors[0] && !e.authors[0].reddit && e.authors[0].contacts?.length ? { hint: e.authors[0].contacts[0].platformName } : {}),
              words: String(e.words),
              // Tag badges for the result row: "group:Name|group:Name" (shown with textContent).
              ...(e.tagList.length ? { tg: e.tagList.map((t) => `${t.group}:${t.name}`).join('|') } : {}),
              // How many words of metadata follow the doc text, so the search page can show an
              // excerpt from the doc itself rather than from this list.
              hw: String(head.join('. ').split(/\s+/).length),
            },
            filters: uniq({
              Category: [CATEGORY_PLURAL[e.category]],
              Series: e.series.length ? e.series.map((s) => s.name) : ['(No series)'],
              Topic: e.topics.map((t) => t.name),
              Character: e.characters.map((c) => c.name),
              Author: e.authors.length ? e.authors.map((a) => a.name) : ['Unknown author'],
              Tag: e.tags,
              Language: [e.languageName],
              'Source language': e.origins.map((o) => o.name),
              Length: [lengthBucket(e.words)],
            }),
            sort: { title: (/^\p{N}/u.test(sortTitle(e.title)) ? '~' : '') + sortTitle(e.title).toLowerCase(), words: String(e.words).padStart(9, '0') },
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
