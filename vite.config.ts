import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { homedir } from "node:os";
import { deriveMcpWsUrl, resolveDevMcpHandshake, resolveExistingMcpToken } from "./vite/mcpDevToken";

// GitHub Pages serves this app from a subpath (e.g. /pen-editor/), while
// local dev/preview/e2e need it to stay at "/". The deploy workflow sets
// VITE_BASE=/pen-editor/; everything base-dependent below derives from it
// instead of hardcoding "/".
const base = process.env.VITE_BASE ?? "/";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Zero-config MCP bridge for local dev: if VITE_MCP_WS_TOKEN isn't already
  // set (resolved the same way Vite itself resolves it — see
  // resolveExistingMcpToken), read the handshake entry the backend wrote to
  // ~/.pen-editor/mcp.json at startup and expose its token (and the WS
  // endpoint derived from its own url/port) via `define`, so src/main.tsx's
  // existing `import.meta.env.VITE_MCP_WS_TOKEN` check picks it up
  // unchanged. Deliberately NOT written into `process.env`: Vite re-runs
  // this factory in the same process on dev-server restart, and a
  // process.env write here would leak into the *next* run's "existing
  // token" resolution, masking a rotated handshake token behind the one
  // this code injected last time.
  //
  // Gated on `command === "serve"` — never "build" — because VITE_* values
  // are inlined into the bundle at build time; resolveDevMcpHandshake()
  // itself re-checks `command` too, so a call-site mistake here still can't
  // leak a token into a production build. `vite preview` also uses "serve"
  // internal handling separately (it serves the already-built dist/, which
  // by this point has nothing left to inject into), so this is
  // dev-server-only in practice.
  //
  // Also disabled under the Playwright e2e suite (PEN_EDITOR_E2E=1, set by
  // playwright.config.ts's webServer) so `npm run test:e2e` behaves
  // identically whether or not the machine running it has a live backend
  // handshake file — see resolveDevMcpHandshake's `disabled` doc comment and
  // playwright.config.ts's webServer.env for why that matters.
  const mcpHandshake = resolveDevMcpHandshake({
    command,
    existingToken: resolveExistingMcpToken(mode, process.cwd()),
    homeDir: homedir(),
    disabled: process.env.PEN_EDITOR_E2E === "1",
  });

  return {
    base,
    define: mcpHandshake
      ? {
          "import.meta.env.VITE_MCP_WS_TOKEN": JSON.stringify(mcpHandshake.token),
          "import.meta.env.VITE_MCP_WS_URL": JSON.stringify(deriveMcpWsUrl(mcpHandshake)),
        }
      : undefined,
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
          // The service worker activates itself instead of parking in
          // `waiting` until a page asks it to. This is the iOS fix: in prompt
          // mode a waiting worker only ever activates when the *current*
          // (stale) bundle sends SKIP_WAITING, or when every client of the
          // origin goes away. On iOS Safari a tab is practically never
          // released — reloading keeps the same client — so if the stale
          // bundle's own prompt never appears (an old build, a dismissed
          // toast, a crashed render), the update waits forever and the only
          // escape is force-quitting Safari. Whatever is wrong with a shipped
          // client can only be fixed by a build that client can't reach, so
          // activation must not depend on it: the *new* worker's own script
          // is the one piece of code we can still change for an already-stuck
          // device.
          //
          // `registerType` stays "prompt": the page is still never reloaded
          // out from under an unsaved document. What changes is that the new
          // build is installed and controlling by then, so the prompt (and
          // any later navigation) applies it — see registerServiceWorker.ts's
          // controllerchange handler.
          skipWaiting: true,
          clientsClaim: true,
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
  };
});
