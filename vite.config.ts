import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { homedir } from "node:os";
import { deriveMcpWsUrl, resolveDevMcpHandshake, resolveExistingMcpToken } from "./vite/mcpDevToken";
import { webmcpManifest } from "./vite/webmcpManifest";

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
    plugins: [tailwindcss(), react(), webmcpManifest()],
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
