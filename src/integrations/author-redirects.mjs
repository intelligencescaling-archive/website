// Adds redirects for old author page URLs to the built _redirects file (Cloudflare Pages).
// Author pages are one per person (data/authors.yaml in the archive). An author page used to be keyed by the
// credit's Reddit handle or name, so every other name, alias and handle of a person points to their page.
// Lines already in public/_redirects win (Cloudflare uses the first match), so hand-written ones stay in charge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorRedirects } from '../lib/archive.mjs';

export default function authorRedirectsIntegration() {
  return {
    name: 'archive-author-redirects',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const file = path.join(fileURLToPath(dir), '_redirects');
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const have = new Set(current.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((x) => x && !x.startsWith('#')));
        const lines = authorRedirects()
          .filter(([from]) => !have.has(from))
          .map(([from, to]) => `${from} ${to} 301`);
        const head = '# Generated at build time (src/integrations/author-redirects.mjs): other names of a person -> their page.';
        const rows = `${current.replace(/\s*$/, '\n')}${head}\n${lines.join('\n')}`.split('\n');
        // Cloudflare counts every rule after the first dynamic one (a splat `*` or a `:placeholder` in the source) as
        // dynamic, and only 100 dynamic rules work: on 2026-11-19 every rule past that point was silently ignored on the
        // preview. So dynamic rules go last, in their order (no static rule here overlaps a dynamic one).
        const isDynamic = (l) => !l.startsWith('#') && /\*|\/:[A-Za-z]/.test(l.trim().split(/\s+/)[0] || '');
        const isRule = (l) => l.trim() && !l.startsWith('#');
        const dynamic = rows.filter(isDynamic);
        const staticRows = rows.filter((l) => !isDynamic(l));
        const nStatic = staticRows.filter(isRule).length;
        if (dynamic.length > 100 || nStatic > 2000) {
          throw new Error(`_redirects: ${nStatic} static / ${dynamic.length} dynamic rules is over Cloudflare's limit (2000 / 100)`);
        }
        const tail = dynamic.length ? `\n# Dynamic rules (splats) last: Cloudflare treats every rule after the first one as dynamic (max 100).\n${dynamic.join('\n')}` : '';
        fs.writeFileSync(file, `${staticRows.join('\n').replace(/\s*$/, '')}\n${tail}\n`);
        logger.info(`Added ${lines.length} author redirects to _redirects (${nStatic} static rules, ${dynamic.length} dynamic rules last)`);
      },
    },
  };
}
