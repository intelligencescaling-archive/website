// Build-time settings. All come from environment variables so the same code works locally,
// in CI, and on Cloudflare Pages. Nothing here is secret.
import path from 'node:path';

// npm scripts run from the website folder, so paths are relative to it.
const websiteRoot = process.cwd();

/** Folder holding a checkout of the archive repo (read-only). Default: ../archive next to website/. */
export const ARCHIVE_DIR = path.resolve(websiteRoot, process.env.ARCHIVE_DIR || '../archive');

/**
 * Where PDF/DOCX files are downloaded from. Placeholders: {sha256} {format} {id} {name}.
 * Default: the R2 bucket at files.intelscaling.com (objects are named <sha256>.<format>).
 * Set it to an empty string to turn downloads off ("not available yet" buttons).
 * A `url` on a file in meta.yaml always wins over the template.
 */
export const FILES_URL_TEMPLATE = (process.env.FILES_URL_TEMPLATE ?? 'https://files.intelscaling.com/{sha256}.{format}').trim();

/** Public repos, used for "suggest a correction" and "source" links. */
export const ARCHIVE_REPO_URL = 'https://github.com/intelligencescaling-archive/archive';
export const WEBSITE_REPO_URL = 'https://github.com/intelligencescaling-archive/website';
/** Plain files of the archive repo's main branch (text-only entries link their text.txt here). */
export const ARCHIVE_RAW_URL = 'https://raw.githubusercontent.com/intelligencescaling-archive/archive/main';
export const CONTACT_EMAIL = 'intelligencescaling.archive@gmail.com';

/**
 * Cloudflare Turnstile site key for the Submit form (public, not a secret). Set TURNSTILE_SITE_KEY in the
 * Cloudflare Pages build settings. Empty: the Submit page says submissions aren't open yet.
 * For local testing, Cloudflare's always-pass test key is 1x00000000000000000000AA.
 */
export const TURNSTILE_SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
export const SUBREDDIT_URL = 'https://www.reddit.com/r/IntelligenceScaling/';

/**
 * Links in the community libraries that were already dead or private when the archive started
 * (Phase 0 link check, 2026-11-14), and how many came back as text from the Wayback Machine.
 * Not in the archive data, because those docs aren't entries (yet). Update by hand.
 */
export const LOST_AT_START = { deleted: 78, private: 40, recoveredText: 23 };
