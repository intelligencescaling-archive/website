-- Anonymous search counter (functions/api/q.js). Run once in the D1 database (see README).
-- Daily aggregate counts only: no IP, no user agent, no cookies, no IDs, no time finer than a day.
CREATE TABLE IF NOT EXISTS search_counts (
  day     TEXT NOT NULL,            -- UTC date, 2026-11-18
  query   TEXT NOT NULL,            -- normalized: trimmed, lowercase, spaces collapsed, max 60 chars
  bucket  TEXT NOT NULL,            -- '0', '1-5' or '6+' results
  filters TEXT NOT NULL DEFAULT '', -- active filters, "Group=Value|Group=Value", or ''
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, query, bucket, filters)
) WITHOUT ROWID;

-- How many distinct rows a day already has (a cap against someone flooding the table with junk).
CREATE TABLE IF NOT EXISTS search_days (
  day  TEXT PRIMARY KEY,
  rows INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
