# Brewhemia — plain static Astro site

This is a **plain static Astro** site (no CMS). EmDash was removed Sep 2026 — do NOT re-add it.

## Commands
```bash
npm run dev          # static dev server (http://localhost:4321/)
npm run build        # static output -> dist/
npm run typecheck    # astro check (must be 0 errors)
npx wrangler dev --port 8789   # run worker.js + static assets (tests /api/* forms)
```

## Structure
- `src/pages/*.astro` — hardcoded content pages (index, about-us, menu, catering, contact-us, events, 404)
- `src/layouts/Base.astro` — shared header/footer, static meta tags
- `src/styles/tokens.css`, `theme.css` — design tokens (DM Serif Display / Inclusive Sans / JetBrains Mono, loaded via CSS @import)
- `worker.js` — minimal Cloudflare Worker: `POST /api/contact` + `/api/catering` → Brevo, everything else → static assets
- `wrangler.jsonc` — `main: worker.js`, `assets: dist/ (binding ASSETS)`. No D1/R2/KV/cron.

## Forms
Contact + catering send via Brevo (`BREVO_API_KEY` secret). Sender info@brewhemia.com,
notify james.welbes@gmail.com, auto-reply to submitter. See the `brewhemia` project skill.

## Rules
- No CMS, no admin UI, no server rendering. Pages are static HTML.
- Secrets via `wrangler secret put`, never hardcoded. `.dev.vars` is gitignored.
