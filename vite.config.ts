import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// GitHub Pages serves this app from a subpath (e.g. /pen-editor/), while
// local dev/preview/e2e need it to stay at "/". The deploy workflow sets
// VITE_BASE=/pen-editor/; everything base-dependent below derives from it
// instead of hardcoding "/".
const base = process.env.VITE_BASE ?? "/";

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      // Service worker registration + update UI is added in a later task via
      // `virtual:pwa-register` in React. Disable the auto-injected
      // registerSW.js script so the two registration paths don't conflict.
      injectRegister: false,
      // includeAssets globs match files under publicDir (physical paths),
      // not URLs — they must stay base-independent even though the
      // manifest/workbox URL fields below are base-prefixed.
      includeAssets: ["icons/*.png", "icons/*.svg", "favicon.ico"],
      manifest: {
        name: "Pen Editor",
        short_name: "Pen",
        description: "AI-first canvas design editor.",
        // The showcase now lives at `base` ("/"); an installed PWA should
        // still open straight into the editor at "/app", not the showcase.
        start_url: `${base}app`,
        scope: base,
        display: "standalone",
        background_color: "#111111",
        theme_color: "#111111",
        orientation: "any",
        icons: [
          {
            src: `${base}icons/icon-192.png`,
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: `${base}icons/icon-512.png`,
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: `${base}icons/maskable-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        // Matches API navigations regardless of base: "/pen-editor/api/..."
        // under the Pages subpath, "/api/..." locally. Anchoring on "/api/"
        // (no leading `^`) keeps the same intent — never serve index.html
        // for an API path — under any base.
        navigateFallbackDenylist: [/\/api\//],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  build: {
    modulePreload: {
      // The showcase route ("/") never touches the editor, but Rolldown's
      // chunk graph leaves a stray cross-chunk import edge into pixi-vendor
      // from the entry chunk (confirmed via sourcemap: no first- or
      // third-party module actually reachable from main.tsx/AppRouter
      // references pixi.js — the edge carries no real code, just an inert
      // binding) which otherwise earns pixi-vendor a <link rel=modulepreload>
      // in index.html, eagerly fetching 500+kB of PixiJS for every showcase
      // visit. Strip it from the entry HTML's preload list specifically;
      // the editor's own "/app" chunk (App-*.js) still gets its legitimate
      // modulepreload of pixi-vendor when that dynamic import actually fires.
      resolveDependencies: (_filename, deps, { hostId }) =>
        hostId === "index.html" ? deps.filter((d) => !d.includes("pixi-vendor")) : deps,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }
          if (id.includes("node_modules/pixi.js")) {
            return "pixi-vendor";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
});
