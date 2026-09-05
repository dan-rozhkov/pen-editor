import type { Plugin } from "vite";
import { buildWebMcpManifest } from "../src/lib/webmcp/manifest";

/**
 * Serves/emits `/webmcp.json` — the static WebMCP surface manifest an agent
 * that only fetched the URL (no JS execution) can read, instead of finding
 * an empty SPA shell with no hint that `navigator.modelContext` exists once
 * the app has loaded. See `src/lib/webmcp/manifest.ts` for what it contains
 * and why; `index.html` links to it via `%BASE_URL%webmcp.json`.
 *
 * Deliberately excluded from `workbox.globPatterns` in vite.config.ts (which
 * lists no `json` extension): the manifest describes the *current* build's
 * tool surface, and this repo has already been burned once by a service
 * worker that pinned a stale asset for returning visitors (see the PWA
 * history in CLAUDE.md). Always-network for this one file is the desired
 * behavior, not an oversight — do not add `json` to globPatterns to "fix"
 * this.
 */
export function webmcpManifest(): Plugin {
  const fileName = "webmcp.json";

  // Resolved base ("/" locally, "/pen-editor/" for the Pages build). The
  // manifest spells its routes out under it, so the emitted file has to know
  // which build it belongs to. Defaults to "/" for the hooks that can run
  // before `configResolved` in a unit test.
  let base = "/";

  // Both the dev and preview servers apply Vite's configured `base` as a
  // path prefix ("/" locally, "/pen-editor/" on GitHub Pages) before the
  // request reaches any middleware, so the path this middleware must match
  // is `${base}webmcp.json`, not the bare file name.
  function serveManifest(serverBase: string) {
    const requestPath = `${serverBase}${fileName}`;
    return (
      req: { url?: string },
      res: { setHeader: (name: string, value: string) => void; end: (body: string) => void },
      next: () => void
    ) => {
      const url = req.url?.split("?")[0];
      if (url !== requestPath) {
        next();
        return;
      }
      const body = JSON.stringify(buildWebMcpManifest(serverBase), null, 2);
      res.setHeader("Content-Type", "application/json");
      res.end(body);
    };
  }

  return {
    name: "pen-editor:webmcp-manifest",
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(serveManifest(server.config.base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveManifest(server.config.base));
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName,
        source: JSON.stringify(buildWebMcpManifest(base), null, 2),
      });
    },
  };
}
