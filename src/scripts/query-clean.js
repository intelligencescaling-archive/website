// Shared by the browser (search-counter.js) and the Pages Function (functions/api/q.js), so both
// apply the same privacy rules to a search query before it is counted.
// Plain JS with no imports: it runs in the browser and in the Workers runtime.

export const MAX_QUERY = 60;
export const BUCKETS = ['0', '1-5', '6+'];

const URLISH = /https?:|www\.|:\/\/|\b[a-z0-9-]+\.(?:com|net|org|io|co|me|ly|gg|tv|app|dev|edu|gov|info|xyz|ru|de|uk|ca|to|cc)\b/i;

/**
 * Normalizes a query (trim, lowercase, collapse spaces, max 60 chars) and returns it, or null if it
 * must not be counted: under 2 characters, or it looks personal (an email address or @name, 6+
 * digits in a row, a link).
 */
export function cleanQuery(raw) {
  if (typeof raw !== 'string') return null;
  const q = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY)
    .trim();
  if ([...q].length < 2) return null;
  if (q.includes('@')) return null;
  if (/\d{6,}/.test(q) || /\d{6,}/.test(q.replace(/[\s.\-()]/g, ''))) return null; // also "555 123 4567"
  if (URLISH.test(q)) return null;
  return q;
}

export const bucketOf = (n) => (n === 0 ? '0' : n <= 5 ? '1-5' : '6+');

/** Active filters as a sorted "Group=Value|Group=Value" string ('' for none), each part length-capped. */
export function cleanFilters(list) {
  if (!Array.isArray(list)) return '';
  const parts = list
    .filter((f) => typeof f === 'string')
    .map((f) => f.replace(/[\u0000-\u001f\u007f|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);
  return [...new Set(parts)].sort().join('|');
}
