// Build-time settings. All come from environment variables so the same code works locally,
// in CI, and on Cloudflare Pages. Nothing here is secret.
import path from 'node:path';

// npm scripts run from the website folder, so paths are relative to it.
const websiteRoot = process.cwd();

/** Folder holding a checkout of the archive repo (read-only). Default: ../archive next to website/. */
export const ARCHIVE_DIR = path.resolve(websiteRoot, process.env.ARCHIVE_DIR || '../archive');

/**
 * Where PDF/DOCX files are downloaded from. Placeholders: {sha256} {format} {id} {name}.
 * Example: https://files.intelscaling.com/{sha256}.{format}
 * Empty = files aren't hosted yet, so the site shows "not available yet".
 * A `url` on a file in meta.yaml always wins over the template.
 */
export const FILES_URL_TEMPLATE = (process.env.FILES_URL_TEMPLATE || '').trim();

/** Public repos, used for "suggest a correction" and "source" links. */
export const ARCHIVE_REPO_URL = 'https://github.com/intelligencescaling-archive/archive';
export const WEBSITE_REPO_URL = 'https://github.com/intelligencescaling-archive/website';
export const CONTACT_EMAIL = 'intelligencescaling.archive@gmail.com';
export const SUBREDDIT_URL = 'https://www.reddit.com/r/IntelligenceScaling/';
