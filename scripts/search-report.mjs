// Prints what visitors searched for, from the anonymous search counter (D1 database `intelscaling-search`).
//
//   node scripts/search-report.mjs               last 30 days, from the live database
//   node scripts/search-report.mjs --days 7 --top 40
//   node scripts/search-report.mjs --local       the local test database (wrangler pages dev)
//
// The live database needs a one-time `npx wrangler login` with the project's Cloudflare account
// (README, "Search counter"). Nothing here is public: the numbers only print in your terminal.
process.noDeprecation = true;
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const days = Math.max(1, Math.min(180, Number(opt('days', 30)) || 30));
const top = Math.max(1, Math.min(200, Number(opt('top', 25)) || 25));
const db = opt('db', 'intelscaling-search');
const where = args.includes('--local') ? '--local' : '--remote';
const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

// Extra wrangler options for the local test database: --config <file> --persist-to <dir>
const extra = [];
for (const flag of ['config', 'persist-to']) if (opt(flag, '')) extra.push(flag === 'config' ? '-c' : '--persist-to', opt(flag, ''));

function sql(command) {
  // The query goes through a temp file: passing it as an argument breaks on Windows shells.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-report-'));
  const file = path.join(dir, 'q.sql');
  fs.writeFileSync(file, command);
  const r = spawnSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', db, where, '--json', '--file', file, ...extra], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 20 * 1024 * 1024,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) {
    console.error((r.stderr || r.stdout || 'wrangler failed').trim());
    process.exit(1);
  }
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].results;
}

const table = (title, rows, cols) => {
  console.log(`\n${title}`);
  if (!rows.length) return console.log('  (nothing yet)');
  const w = cols.map(([k, h]) => Math.max(h.length, ...rows.map((r) => String(r[k] ?? '').length)));
  console.log('  ' + cols.map(([, h], i) => h.padEnd(w[i])).join('  '));
  for (const r of rows) console.log('  ' + cols.map(([k], i) => String(r[k] ?? '').padEnd(w[i])).join('  '));
};

const total = sql(`SELECT SUM(n) AS searches, COUNT(DISTINCT query) AS distinct_queries, SUM(CASE WHEN bucket='0' THEN n ELSE 0 END) AS zero FROM search_counts WHERE day >= '${since}'`)[0] || {};
console.log(`Searches since ${since} (${days} days): ${total.searches ?? 0}, distinct queries: ${total.distinct_queries ?? 0}, with 0 results: ${total.zero ?? 0}`);

table(
  `Top ${top} queries`,
  sql(`SELECT query, SUM(n) AS searches, SUM(CASE WHEN bucket='0' THEN n ELSE 0 END) AS zero FROM search_counts WHERE day >= '${since}' GROUP BY query ORDER BY searches DESC, query LIMIT ${top}`),
  [['query', 'query'], ['searches', 'searches'], ['zero', 'with 0 results']],
);
table(
  `Top ${top} queries with no results (what is missing, or needs an alias)`,
  sql(`SELECT query, SUM(n) AS searches, GROUP_CONCAT(DISTINCT NULLIF(filters,'')) AS with_filters FROM search_counts WHERE day >= '${since}' AND bucket='0' GROUP BY query ORDER BY searches DESC, query LIMIT ${top}`),
  [['query', 'query'], ['searches', 'searches'], ['with_filters', 'with filters']],
);
