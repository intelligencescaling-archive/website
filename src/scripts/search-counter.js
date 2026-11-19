// Anonymous search counter. Records (normalized query, 0 / 1-5 / 6+ results, active filter names)
// and nothing else: the server adds only the UTC date. One beacon per settled search, never per
// keystroke. Any failure is silent. See functions/api/q.js for what is stored.
//
// A search is "settled" when its results have stayed on screen for 2 seconds, or the visitor
// presses Enter / clicks a result / leaves the page, whichever comes first.
import { cleanQuery, bucketOf, cleanFilters } from './query-clean.js';

const SETTLE_MS = 2000;
const ENDPOINT = '/api/q';

export function createCounter() {
  const sent = new Set(); // "query|filters" already sent in this page view
  let pending = null; // the search whose results are on screen: { q, b, f }
  let timer = null;
  let eager = false; // the visitor pressed Enter: send the next search at once
  // Back button / reload: the page re-runs the search from its URL. That is the same search again, not a new one.
  let skipFirst = false;
  try {
    skipFirst =
      !!new URLSearchParams(location.search).get('q') &&
      ['back_forward', 'reload'].includes(performance.getEntriesByType('navigation')[0]?.type);
  } catch {
    /* ignore */
  }

  function send(p) {
    try {
      if (!p || sent.has(p.key)) return;
      sent.add(p.key);
      const body = JSON.stringify({ q: p.q, b: p.b, f: p.f });
      // sendBeacon is fire-and-forget and survives the page closing; fetch+keepalive is the fallback.
      if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body))) {
        fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => {});
      }
    } catch {
      /* counting must never break the page */
    }
  }

  function flush() {
    clearTimeout(timer);
    const p = pending;
    pending = null;
    send(p);
  }

  return {
    /** Results for `query` were just put on screen: `n` results, `filters` = ["Series=Naruto", ...]. */
    shown(query, n, filters) {
      try {
        clearTimeout(timer);
        pending = null;
        const now = eager;
        eager = false;
        if (skipFirst) {
          skipFirst = false;
          sent.add(`${cleanQuery(query)}|${cleanFilters(filters)}`);
          return;
        }
        const q = cleanQuery(query);
        if (!q) return;
        const f = cleanFilters(filters);
        pending = { key: `${q}|${f}`, q, b: bucketOf(n), f: f ? f.split('|') : [] };
        if (now) flush();
        else timer = setTimeout(flush, SETTLE_MS);
      } catch {
        /* ignore */
      }
    },
    /** The visitor is typing: whatever is on screen is not settled. */
    typing() {
      clearTimeout(timer);
      pending = null;
      eager = false;
    },
    /** The visitor pressed Enter / Search: count the next search without waiting. */
    submitted() {
      eager = true;
      clearTimeout(timer);
      pending = null;
    },
    /** A result was clicked or the page is going away. */
    flush,
  };
}
