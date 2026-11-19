// Used by the Cloudflare Pages build (npm run build:cloudflare): makes sure a copy of the archive
// repo exists at ARCHIVE_DIR before Astro builds. Locally, ../archive already exists, so this
// does nothing. Only works without credentials once the archive repo is public.
//
// Which archive branch: ARCHIVE_BRANCH if set; else, on Cloudflare, the archive branch with the same
// name as the website branch being built (CF_PAGES_BRANCH), so a preview of website branch `x` shows
// archive branch `x` when one exists; else `main`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), process.env.ARCHIVE_DIR || '../archive');
const repo = process.env.ARCHIVE_REPO || 'https://github.com/intelligencescaling-archive/archive.git';
const SAFE = /^[A-Za-z0-9._\/-]+$/;

if (fs.existsSync(path.join(dir, 'data', 'series.yaml'))) {
  console.log(`Archive found at ${dir}, not downloading.`);
  process.exit(0);
}

function pickBranch() {
  if (process.env.ARCHIVE_BRANCH) return process.env.ARCHIVE_BRANCH;
  const site = process.env.CF_PAGES_BRANCH || '';
  if (site && site !== 'main' && SAFE.test(site)) {
    const res = spawnSync('git', ['ls-remote', '--exit-code', '--heads', repo, `refs/heads/${site}`], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout.trim()) {
      console.log(`Archive branch "${site}" exists: using it for this preview.`);
      return site;
    }
    console.log(`No archive branch "${site}": using main.`);
  }
  return 'main';
}

const branch = pickBranch();
if (!SAFE.test(branch) || branch.startsWith('-')) throw new Error(`Bad archive branch: ${branch}`);

console.log(`Cloning ${repo} (${branch}) into ${dir} ...`);
const res = spawnSync('git', ['clone', '--depth', '1', '--single-branch', '--branch', branch, repo, dir], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error('Could not clone the archive repo. Is it public, and is ARCHIVE_REPO right?');
  process.exit(res.status ?? 1);
}
