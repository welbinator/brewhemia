import { defineConfig } from "astro/config";

// Production (Cloudflare workers.dev / root domain): leave PAGES_BASE unset → base "/"
// Staging (GitHub Pages project site): PAGES_BASE=/brewhemia/
// All internal links/assets use withBase() so both mounts work from one codebase.
export default defineConfig({
  site: "https://brewhemia.com",
  base: process.env.PAGES_BASE || "/",
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  devToolbar: { enabled: false },
});
