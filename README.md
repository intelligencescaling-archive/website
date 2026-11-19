# intelscaling.com

The website for the **[Intelligence Scaling Archive](https://github.com/intelligencescaling-archive/archive)**:
**https://intelscaling.com**. It lets you browse and search the r/IntelligenceScaling community's analysis docs,
original stories and tier lists, and download each one as PDF or DOCX.

> Live since 2026-11-15 and still being improved. Ideas and bug reports are welcome as
> [issues](https://github.com/intelligencescaling-archive/website/issues).

A static site: [Astro](https://astro.build) builds plain HTML from the archive's `meta.yaml` files, and
[Pagefind](https://pagefind.app) builds a full-text search index at the same time. There is no server and
no database. Hosting: Cloudflare Pages. PDF/DOCX files are served from Cloudflare R2 at `files.intelscaling.com`.

## Build it locally

Needs Node.js 22.23+ and a checkout of the archive repo next to this one (`../archive`).

```sh
npm ci
npm run build      # site + search index into dist/ (about 30 seconds)
npm run preview    # serves dist/ at http://localhost:4321
```

`npm run dev` works for editing pages, but search only works after a build.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `ARCHIVE_DIR` | `../archive` | Path to a checkout of the archive repo. |
| `FILES_URL_TEMPLATE` | `https://files.intelscaling.com/{sha256}.{format}` | Where PDF/DOCX downloads live (the R2 bucket). Placeholders: `{sha256}`, `{format}`, `{id}`, `{name}`. Set to an empty string to show "coming soon" buttons instead. A `url` on a file in `meta.yaml` always wins. |
| `ASTRO_TELEMETRY_DISABLED` | | Set to `1` to turn off Astro's anonymous usage data. |

## How it's deployed

Cloudflare Pages builds the site itself from this repo's `main` branch on every push, and downloads the public
archive repo during the build (`scripts/fetch-archive.mjs`, a shallow clone). Pushes to other branches get their own
preview URL on `intelscaling.pages.dev`. Domains: `intelscaling.com` and `www.intelscaling.com`.

| Setting | Value |
|---|---|
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist` |
| Node version | from `.node-version` |
| Environment variables | `ASTRO_TELEMETRY_DISABLED=1`; optional `ARCHIVE_REPO`, `ARCHIVE_BRANCH`; `TURNSTILE_SITE_KEY` (Submit form, public) |
| Secrets (Functions) | `TURNSTILE_SECRET`, `GITHUB_TOKEN` (fine-grained, Issues read+write on the private `submissions` repo only) |

Which archive branch the build uses: `ARCHIVE_BRANCH` if set, else the archive branch with the same name as the
website branch (`CF_PAGES_BRANCH`) when it exists, else `main`. So a preview of website branch `x` shows archive
branch `x`: push both to test data changes before they merge.

Authors are people: `data/authors.yaml` in the archive (one record per person, with aliases and Reddit handles)
decides the author pages (`/authors/<person id>/`). Credits in `shared_by` show as "Shared by u/X", and a person
who only shared docs gets a page with a "Shared" list (not in the Authors index). Old author URLs (any other
name or handle of a person) are redirected by lines added to `_redirects` at build time
(`src/integrations/author-redirects.mjs`); hand-written lines in `public/_redirects` come first.

### Submit form

`/submit/` posts to a Pages Function, `functions/api/submit.js`. It checks the Turnstile token (and its hostname),
accepts only Google Docs/Drive/Slides links and posts on r/IntelligenceScaling, removes email addresses, escapes
everything for Markdown, and files an issue in the **private** `intelligencescaling-archive/submissions` repo. It
downloads nothing. `public/_routes.json` limits Functions to `/api/*`, so the static site doesn't count against the
Functions quota. Without `TURNSTILE_SITE_KEY` at build time the page says the form isn't open yet; without the two
secrets the function answers 503. `/archived-ids.json` (built from the archive) lets the form say "already
archived" before sending. Approved issues are imported by the maintainer's local script.

### Search counter

The Search page counts what visitors search for, anonymously, so we can see what is missing (zero-result
searches) and what needs an alias. After a search has stayed on screen for about 2 seconds (or the visitor
presses Enter, clicks a result or leaves), `src/scripts/search-counter.js` sends one `sendBeacon` to
`functions/api/q.js` with `{ q, b, f }`: the normalized query, a result bucket (`0`, `1-5`, `6+`) and the active
filter names. Queries under 2 characters, or containing `@`, 6+ digits in a row or a link, are never sent (and are
dropped again on the server by the shared `src/scripts/query-clean.js`). The function stores **daily counts**
`(day, query, bucket, filters, n)` in a Cloudflare D1 database, with no IP, user agent, cookie, ID, referrer or time
finer than the UTC day, caps a day at 4,000 distinct rows, and deletes rows older than 180 days. Without the D1
binding the function does nothing.

Setup (once): create D1 database `intelscaling-search`, run `migrations/0001_search_counter.sql` in its Console,
and bind it to the Pages project as `SEARCH_DB` for Production and Preview (Settings > Bindings). Read it with
`npm run search-report -- --days 30` (needs `npx wrangler login` once). `npm run test:counter` checks the privacy
rules. There is no `wrangler.toml` on purpose: a config file would make it the source of truth for the project's
variables and bindings.

The site also rebuilds once a day (`.github/workflows/rebuild.yml`) through a Cloudflare Pages **deploy hook**,
stored as the `CF_DEPLOY_HOOK` secret in this repo, so archive changes show up within a day. It can also be started by
hand from the Actions tab.

Downloads: R2 objects are named `<sha256>.<format>` and uploaded with a `Content-Disposition` header
that gives the readable file name, which matches the default `FILES_URL_TEMPLATE`.

## Pages

| Path | What |
|---|---|
| `/` | Home: search, random doc, most-documented characters, longest docs, lost docs, series, stories |
| `/browse/` | Every entry, filterable by category, series, topic, character, author, tag, language (state in the URL) |
| `/search/` | Full-text search (Pagefind) over the plain text of every doc + its metadata, with filters and doc-text excerpts |
| `/items/<id>/` | One entry: titles, authors, series, characters, tags, parts with capture status, downloads, library info |
| `/items/<id>/read/` | Reader view of the entry's plain text, for every entry with words (image-only docs have none). Docs with a PDF/DOCX get a short "text version" note linking to the original. Long docs are split into pages of about 600 KB (`/read/2/`, `/read/3/`, …; `readerPages` in `src/lib/archive.mjs`), so no page is much over 600 KB of HTML. `noindex`, not in the sitemap |
| `/series/`, `/characters/`, `/authors/`, `/tags/` | Index pages and one page per series/character/author/tag |
| `/topics/` | Browse home for entries with no series: SCD theory & guides, stories & OCs, community games, libraries; plus "Series not known yet" and "Needs sorting". Rules in `TOPICS` in `src/lib/archive.mjs` (from tags and category, no archive change) |
| `/about/`, `/acknowledgments/`, `/removal/` | About, credits, removal requests |
| `/submit/` | Submit a doc or Reddit post, suggest a fix (`?fix=<id>`), or ask for removal (`?remove=<id>`) |

## Security

Archive metadata comes from public submissions, so it's treated as untrusted:

- Pages only render metadata through Astro expressions, which escape HTML. Never use `set:html` with archive data.
- Every link from metadata goes through `safeUrl()` (only `http`/`https`).
- The search page (`src/scripts/search.js`) uses Pagefind's JS API, not its default UI, and puts everything from the
  index on the page with `textContent`; only Pagefind's `<mark>` tags are copied, node by node. Don't switch to the
  default UI without escaping filter values first: it inserts filter labels as raw HTML.
- A strict Content-Security-Policy (no inline scripts or styles) is set both in a `<meta>` tag and in `public/_headers`.
- Fonts (Archivo, Public Sans; SIL Open Font License, see `public/fonts/`) are self-hosted. The only outside script is Cloudflare Web Analytics (cookie-free visit counts), allowed by name in the CSP.
- The link preview image is `public/og.png` (1200 × 630). Its numbers are fixed; redraw it when the counts change a lot.
- `npm run test:escaping` builds the site from `test/fixture-archive/` (one entry full of hostile metadata) and fails
  if any of it shows up as live HTML.
- Dependencies are few (`astro`, `pagefind`, `yaml`), pinned to exact versions, and installed with scripts off (`.npmrc`).

## License

Site code: [MIT](LICENSE). Archived content shown on the site is © its respective authors.
