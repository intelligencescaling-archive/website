// Cloudflare Pages Function: POST /api/submit (the Submit page's form).
// Checks the Turnstile token, checks the fields, and files an issue in the PRIVATE submissions repo.
// Nothing is downloaded here: the doc is fetched later, by the local import, only after a maintainer approves it.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets):
//   TURNSTILE_SECRET   secret: the Turnstile widget's secret key
//   GITHUB_TOKEN       secret: fine-grained token, Issues read+write on the submissions repo only
//   SUBMISSIONS_REPO   optional, default intelligencescaling-archive/submissions
//   SITE_HOSTNAMES     optional, comma-separated hostnames the Turnstile token may come from
//                      (default intelscaling.com,www.intelscaling.com)

const LIMITS = { url: 500, title: 200, series: 200, characters: 200, author: 60, by: 60, item: 200, value: 200, note: 2000 };
const KINDS = { add: 'new-doc', fix: 'correction', remove: 'removal' };
const WHAT = ['doc', 'story', 'other'];
const FIELDS = ['author', 'title', 'series', 'characters', 'tags', 'duplicate', 'other'];
const WISHES = ['remove', 'credit', 'add-name'];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (status, error) => json(status, { ok: false, error });

/** Trimmed single-line-ish text with a length cap; emails are removed (we don't keep contact details). */
export function clean(v, max, multiline = false) {
  let s = typeof v === 'string' ? v : '';
  s = s.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  if (!multiline) s = s.replace(/\s+/g, ' ');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]');
  return s.trim().slice(0, max);
}

/** Classifies a submitted link. Only Google Docs/Drive/Slides and Reddit posts on the sub are accepted. */
export function classifyUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'docs.google.com' || host === 'drive.google.com') {
    const m = /\/(?:document|presentation|file)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(u.pathname);
    const id = m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(u.searchParams.get('id') || '') ? u.searchParams.get('id') : null;
    return id ? { type: 'google', googleId: id, url: `https://drive.google.com/open?id=${id}` } : null;
  }
  if (/^((www|old|new|m|np)\.)?reddit\.com$/.test(host)) {
    const m = /^\/r\/([A-Za-z0-9_]+)\/(?:comments\/([a-z0-9]{5,10})|s\/([A-Za-z0-9]{5,20}))/i.exec(u.pathname);
    if (!m || m[1].toLowerCase() !== 'intelligencescaling') return null;
    const url = m[2] ? `https://www.reddit.com/r/IntelligenceScaling/comments/${m[2].toLowerCase()}/` : `https://www.reddit.com/r/IntelligenceScaling/s/${m[3]}`;
    return { type: 'reddit', postId: m[2] ? m[2].toLowerCase() : null, url };
  }
  if (host === 'redd.it') {
    const m = /^\/([a-z0-9]{5,10})$/i.exec(u.pathname);
    return m ? { type: 'reddit', postId: m[1].toLowerCase(), url: `https://www.reddit.com/comments/${m[1].toLowerCase()}/` } : null;
  }
  return null;
}

/** Markdown-safe text for the issue body: no mentions, links, HTML or formatting from the submitter. */
export const md = (s) => (s ? s.replace(/[\\`*_{}[\]()<>#+\-.!|@~&]/g, (c) => '\\' + c) : '_(empty)_');

export function buildIssue(input) {
  const kind = KINDS[input.kind] ? input.kind : null;
  if (!kind) return { error: 'Pick what you want to do.' };
  const s = {};
  for (const [k, max] of Object.entries(LIMITS)) s[k] = clean(input[k], max, k === 'note');
  if (s.by && !/^[A-Za-z0-9_-]{3,20}$/.test(s.by.replace(/^\/?u\//i, ''))) return { error: 'That doesn\'t look like a Reddit username. Leave it empty if you like.' };
  s.by = s.by.replace(/^\/?u\//i, '');
  s.author = s.author.replace(/^\/?u\//i, '');

  const data = { v: 1, kind, by: s.by || null, note: s.note || null };
  const rows = [];
  let title;
  const labels = ['submission', KINDS[kind]];

  if (kind === 'add') {
    const link = classifyUrl(s.url);
    if (!link) return { error: 'That link isn\'t a Google Doc, a Google Drive file, or a post on r/IntelligenceScaling.' };
    if (link.type === 'reddit') labels[1] = 'reddit-post';
    const what = WHAT.includes(input.what) ? input.what : 'other';
    Object.assign(data, { link, what, title: s.title || null, series: s.series || null, characters: s.characters || null, author: s.author || null });
    title = `${link.type === 'reddit' ? 'Reddit post' : what === 'story' ? 'Story' : 'Doc'}: ${s.title || link.googleId || link.postId || link.url}`;
    rows.push(['Link', link.url, true], ['Kind', what], ['Title', s.title], ['Series', s.series], ['Characters', s.characters], ['Made by', s.author]);
  } else {
    if (!s.item) return { error: 'Say which entry: paste its link on this site, or its title.' };
    const m = /\/items\/([a-z0-9-]+)\/?/.exec(s.item);
    const item = m ? m[1] : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.item) ? s.item : null;
    data.item = item;
    data.itemText = item ? null : s.item;
    rows.push(['Entry', item ? `https://intelscaling.com/items/${item}/` : s.item, Boolean(item)]);
    if (kind === 'fix') {
      const field = FIELDS.includes(input.field) ? input.field : 'other';
      if (!s.value && !s.note) return { error: 'Say what it should be.' };
      Object.assign(data, { field, value: s.value || null });
      title = `Fix ${field}: ${item || s.item.slice(0, 60)}`;
      rows.push(['What\'s wrong', field], ['Should be', s.value]);
    } else {
      const wish = WISHES.includes(input.wish) ? input.wish : 'remove';
      data.wish = wish;
      title = `Removal (${wish}): ${item || s.item.slice(0, 60)}`;
      rows.push(['Request', wish]);
    }
  }
  rows.push(['Note', s.note], ['Sent by', s.by ? `u/${s.by}` : '']);

  const table = rows
    .filter(([, v]) => v)
    // `ours`: a link this function built from a checked id, shown as is; everything else is escaped.
    .map(([k, v, ours]) => (k === 'Note' ? `**${k}:**\n\n> ${md(v).replace(/\n/g, '\n> ')}` : `**${k}:** ${ours ? v : md(v)}`))
    .join('\n\n');
  // Machine-readable copy for import_submissions.py. "<" and ">" are escaped so the comment can't be closed early.
  const blob = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const body = `${table}\n\n---\nApprove: add the \`approved\` label. Reject: close with a short reason.\n\n<!-- submission ${blob} -->\n`;
  return { title: title.replace(/[@<>]/g, '').replace(/\s+/g, ' ').slice(0, 120), body, labels };
}

async function verifyTurnstile(token, ip, env) {
  if (!token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  const hosts = (env.SITE_HOSTNAMES || 'intelscaling.com,www.intelscaling.com').split(',').map((h) => h.trim());
  return j.success === true && hosts.includes(j.hostname);
}

export async function onRequestPost({ request, env }) {
  if (!env.TURNSTILE_SECRET || !env.GITHUB_TOKEN) return fail(503, 'Submissions aren\'t open yet. Please post the link on the subreddit for now.');
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return fail(415, 'Send the form from the Submit page.');
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > 16000) return fail(413, 'That\'s too long.');
  let input;
  try {
    input = JSON.parse((await request.text()).slice(0, 16000));
  } catch {
    return fail(400, 'Send the form from the Submit page.');
  }
  if (!input || typeof input !== 'object') return fail(400, 'Send the form from the Submit page.');

  if (!(await verifyTurnstile(input.token, request.headers.get('CF-Connecting-IP'), env)))
    return fail(403, 'The spam check didn\'t pass. Reload the page and try again.');

  const issue = buildIssue(input);
  if (issue.error) return fail(400, issue.error);

  const repo = env.SUBMISSIONS_REPO || 'intelligencescaling-archive/submissions';
  const gh = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'intelscaling-submit',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(issue),
  });
  if (!gh.ok) return fail(502, 'Something went wrong on our side. Please try again later, or post the link on the subreddit.');
  const created = await gh.json().catch(() => ({}));
  return json(200, { ok: true, number: created.number });
}

export function onRequest() {
  return fail(405, 'Use the form on the Submit page.');
}
