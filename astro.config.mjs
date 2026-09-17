import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://brewhemia.com",
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  devToolbar: { enabled: false },
});
