// Cloudflare Pages Function: POST /api/q, the anonymous search counter.
// The Search page sends one small beacon per settled search: { q, b, f } = the normalized query, a
// result-count bucket ('0' | '1-5' | '6+') and the active filter names. This stores daily
// aggregate counts and nothing else: no IP, no user agent, no cookies, no IDs, no referrer, and no
// time finer than the UTC day. Nothing from the request other than the three fields is read.
//
// Storage: Cloudflare D1 (free tier), binding name SEARCH_DB (Pages > Settings > Bindings, for
// both Production and Preview). Schema: migrations/0001_search_counter.sql.
// If the binding is missing the function does nothing, so the site works without it.
// Rows older than 180 days are deleted (on about 1 request in 50).

import { cleanQuery, cleanFilters, BUCKETS } from '../../src/scripts/query-clean.js';

const MAX_BODY = 1024; // bytes; a real beacon is under 300
const MAX_ROWS_PER_DAY = 4000; // distinct (query, bucket, filters) rows a day; more is flooding
const KEEP_DAYS = 180;

/** Always the same empty answer: the page never reads it and failures must not be loud. */
const done = (status = 204) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const db = env.SEARCH_DB;
    if (!db) return done();

    // Same-origin only: a browser sends Origin on POST, and a cross-site page can't forge it.
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return done(403);

    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) return done(413);
    const text = await request.text();
    if (text.length > MAX_BODY) return done(413);

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return done(400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return done(400);
    const q = cleanQuery(body.q); // the same privacy rules as the browser, applied again here
    const bucket = typeof body.b === 'string' && BUCKETS.includes(body.b) ? body.b : null;
    if (!q || !bucket) return done(400);
    const filters = cleanFilters(body.f);

    const day = new Date().toISOString().slice(0, 10);
    const row = await db.prepare('SELECT rows FROM search_days WHERE day = ?').bind(day).first();
    if (row && row.rows >= MAX_ROWS_PER_DAY) return done();

    // One transaction: make sure the row exists, count a new row against the day's cap, add one.
    // changes() is the number of rows the statement before it inserted (0 if the row existed).
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO search_counts (day, query, bucket, filters, n) VALUES (?1, ?2, ?3, ?4, 0)').bind(day, q, bucket, filters),
      db.prepare('INSERT INTO search_days (day, rows) VALUES (?1, changes()) ON CONFLICT(day) DO UPDATE SET rows = rows + changes()').bind(day),
      db.prepare('UPDATE search_counts SET n = n + 1 WHERE day = ?1 AND query = ?2 AND bucket = ?3 AND filters = ?4').bind(day, q, bucket, filters),
    ]);

    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
      const prune = db.batch([
        db.prepare('DELETE FROM search_counts WHERE day < ?').bind(cutoff),
        db.prepare('DELETE FROM search_days WHERE day < ?').bind(cutoff),
      ]);
      context.waitUntil?.(prune.catch(() => {}));
    }
    return done();
  } catch {
    return done(); // never an error page, never a stack trace
  }
}

// Anything but POST: nothing here.
export const onRequest = () => done(405);
