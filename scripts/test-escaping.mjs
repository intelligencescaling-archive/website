// Builds the site from test/fixture-archive (one entry full of hostile metadata) into a temp
// folder and checks that none of it ends up as live HTML. Run: npm run test:escaping
//
// It strips quoted attribute values first: text like <img ...> inside data-label="..." is inert.
// Pagefind's filter labels are checked separately in the browser (see README).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-escaping-'));
// One command string (outDir comes from mkdtemp, so it's safe to quote this way).
const res = spawnSync(`npx astro build --outDir "${outDir}"`, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ARCHIVE_DIR: 'test/fixture-archive', ASTRO_TELEMETRY_DISABLED: '1' },
});
if (res.status !== 0) process.exit(res.status ?? 1);

const forbidden = [
  /<script>alert/i, /<img src=x/i, /<svg onload/i, /<b onmouseover/i, /<marquee/i, /<u>part/i, /<i>variant/i,
  /<em>note/i, /<h1>x<\/h1>/i, /href="javascript:/i, /href="https:\/\/example\.com\/"onmouseover/i, /onmouseover="alert/i,
];
const problems = [];
const walk = (dir) => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name.endsWith('.html') || d.name.endsWith('.xml')) {
      const html = fs.readFileSync(p, 'utf8').replace(/="[^"]*"/g, '=""');
      for (const re of forbidden) if (re.test(html)) problems.push(`${path.relative(outDir, p)}: ${re}`);
    }
  }
};
walk(outDir);
const item = fs.readFileSync(path.join(outDir, 'items', 'evil-entry', 'index.html'), 'utf8');
// The rich reader (blocks.json with hostile runs, links, colours, image names): it must render, escaped.
const read = fs.readFileSync(path.join(outDir, 'items', 'evil-entry', 'read', 'index.html'), 'utf8');
if (!read.includes('class="r-text r-rich"')) problems.push('items/evil-entry/read: expected the rich reader (blocks.json)');
if (!read.includes('&lt;img src=x onerror')) problems.push('items/evil-entry/read: expected the escaped heading text');
const docCss = fs.readFileSync(path.join(outDir, 'items', 'evil-entry', 'read', 'doc.css'), 'utf8');
if (/zzinject|<|url\(|@import/i.test(docCss)) problems.push('items/evil-entry/read/doc.css: hostile value in the stylesheet');
if (!item.includes('&lt;script&gt;alert')) problems.push('items/evil-entry: expected the escaped title text');
// A Reddit post with hostile markdown (src/lib/reddit-md.mjs): rendered as markdown, its HTML and links escaped.
const rp = fs.readFileSync(path.join(outDir, 'items', 'evil-reddit-post', 'read', 'index.html'), 'utf8');
const rpItem = fs.readFileSync(path.join(outDir, 'items', 'evil-reddit-post', 'index.html'), 'utf8');
if (!rp.includes('class="r-text r-rich r-md"')) problems.push('items/evil-reddit-post/read: expected the markdown reader');
if (!rp.includes('<strong>CONTEXT:</strong>')) problems.push('items/evil-reddit-post/read: expected bold markdown');
if (!rp.includes('&lt;script&gt;alert(&quot;md-script&quot;)')) problems.push('items/evil-reddit-post/read: expected the escaped <script>');
if (/md-(link|image)/.test(rp.replace(/="[^"]*"/g, '=""').replace(/>[^<]*</g, '><'))) problems.push('items/evil-reddit-post/read: javascript: link or image kept');
if (/href="(?:javascript|data):/i.test(rp + rpItem)) problems.push('items/evil-reddit-post: javascript:/data: link');
if (/redd\.it/.test(rp.replace(/<[^>]+>/g, ''))) problems.push('items/evil-reddit-post/read: an image link shows as text');
if (!rpItem.includes('class="pvt md')) problems.push('items/evil-reddit-post: expected the markdown preview');
if (!rp.includes('id="r-lb"')) problems.push('items/evil-reddit-post/read: expected the image viewer');
fs.rmSync(outDir, { recursive: true, force: true });

if (problems.length) {
  console.error(`\nEscaping test FAILED:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('\nEscaping test passed: no hostile metadata rendered as HTML.');
