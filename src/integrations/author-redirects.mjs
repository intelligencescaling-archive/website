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
        fs.writeFileSync(file, `${current.replace(/\s*$/, '\n')}${head}\n${lines.join('\n')}\n`);
        logger.info(`Added ${lines.length} author redirects to _redirects`);
      },
    },
  };
}
