import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Production (Cloudflare workers.dev / root domain): leave PAGES_BASE unset → base "/"
// Staging (GitHub Pages project site): PAGES_BASE=/brewhemia/
// All internal links/assets use withBase() so both mounts work from one codebase.
const isStaging = Boolean(process.env.PAGES_BASE);

export default defineConfig({
  site: "https://brewhemia.com",
  base: process.env.PAGES_BASE || "/",
  // Sitemap only on the production (root) build — the staging Pages build is noindex.
  integrations: isStaging ? [] : [sitemap()],
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  devToolbar: { enabled: false },
});
