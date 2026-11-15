// Used by the Cloudflare Pages build (npm run build:cloudflare): makes sure a copy of the archive
// repo exists at ARCHIVE_DIR before Astro builds. Locally, ../archive already exists, so this
// does nothing. Only works without credentials once the archive repo is public.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), process.env.ARCHIVE_DIR || '../archive');
const repo = process.env.ARCHIVE_REPO || 'https://github.com/intelligencescaling-archive/archive.git';
const branch = process.env.ARCHIVE_BRANCH || 'main';

if (fs.existsSync(path.join(dir, 'data', 'series.yaml'))) {
  console.log(`Archive found at ${dir}, not downloading.`);
  process.exit(0);
}
if (!/^[A-Za-z0-9._\/-]+$/.test(branch)) throw new Error(`Bad ARCHIVE_BRANCH: ${branch}`);

console.log(`Cloning ${repo} (${branch}) into ${dir} ...`);
const res = spawnSync('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, repo, dir], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('Could not clone the archive repo. Is it public, and is ARCHIVE_REPO right?');
  process.exit(res.status ?? 1);
}
