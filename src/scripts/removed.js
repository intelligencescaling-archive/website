// Shared by the 404 page and the Submit form: the hash used in removed.json (data/removals.yaml in the archive).
/** First 24 hex digits of SHA-256("<kind>:<value>"); null where Web Crypto isn't available. */
export async function removedHash(kind, value) {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${value}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

let data = null;
/** removed.json, fetched once; null when it can't be read. */
export async function removedData() {
  data ??= fetch('/removed.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const d = await data;
  if (!d) data = null;
  return d;
}

/** The item id in a path like /items/<id>/ or /items/<id>/read/2/, else null. */
export function itemInPath(path) {
  const m = /^\/items\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(path);
  return m && m[1].length <= 100 ? m[1] : null;
}
