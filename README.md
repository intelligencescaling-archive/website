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
| Environment variables | `ASTRO_TELEMETRY_DISABLED=1`; optional `ARCHIVE_REPO`, `ARCHIVE_BRANCH` |

The site also rebuilds once a day (`.github/workflows/rebuild.yml`) through a Cloudflare Pages **deploy hook**,
stored as the `CF_DEPLOY_HOOK` secret in this repo, so archive changes show up within a day. It can also be started by
hand from the Actions tab.

Downloads: R2 objects are named `<sha256>.<format>` and uploaded with a `Content-Disposition` header
that gives the readable file name, which matches the default `FILES_URL_TEMPLATE`.

## Pages

| Path | What |
|---|---|
| `/` | Home: search box, stats, top series and characters, stories |
| `/browse/` | Every entry, filterable by category, series, character, author, tag, language (state in the URL) |
| `/search/` | Pagefind full-text search over metadata + the plain text of every doc |
| `/items/<id>/` | One entry: titles, authors, series, characters, tags, parts with capture status, downloads, library info |
| `/series/`, `/characters/`, `/authors/`, `/tags/` | Index pages and one page per series/character/author/tag |
| `/about/`, `/acknowledgments/`, `/removal/` | About, credits, removal requests |

## Security

Archive metadata comes from public submissions, so it's treated as untrusted:

- Pages only render metadata through Astro expressions, which escape HTML. Never use `set:html` with archive data.
- Every link from metadata goes through `safeUrl()` (only `http`/`https`).
- Pagefind's default UI inserts **filter labels** as raw HTML, so filter values are HTML-escaped when the index is built
  (`src/integrations/search-index.mjs`).
- A strict Content-Security-Policy (no inline scripts or styles) is set both in a `<meta>` tag and in `public/_headers`.
- `npm run test:escaping` builds the site from `test/fixture-archive/` (one entry full of hostile metadata) and fails
  if any of it shows up as live HTML.
- Dependencies are few (`astro`, `pagefind`, `yaml`), pinned to exact versions, and installed with scripts off (`.npmrc`).

## License

Site code: [MIT](LICENSE). Archived content shown on the site is © its respective authors.
