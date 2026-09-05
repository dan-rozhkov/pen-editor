// Serves `dist/` over HTTP with the production Content-Security-Policy applied
// as a real response header, plus the SPA rewrite Render does in production.
//
// Why this exists: `npm run preview` cannot set arbitrary response headers, and
// a `<meta http-equiv>` CSP behaves differently from a header (it cannot carry
// frame-ancestors, and it only applies from the point in the document where the
// browser parses it). The only honest way to find out what an *enforcing* policy
// breaks is to serve the real build with the real header, which is what this
// does. `scripts/csp-audit.mjs` drives a browser against it.
//
// Usage:
//   node scripts/csp-serve.mjs                 # enforcing policy, port 4180
//   node scripts/csp-serve.mjs --report-only   # the header we actually ship first
//   PORT=5000 node scripts/csp-serve.mjs
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { CONTENT_SECURITY_POLICY } from "./csp-policy.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT ?? 4180);
const REPORT_ONLY = process.argv.includes("--report-only");
const HEADER = REPORT_ONLY
  ? "Content-Security-Policy-Report-Only"
  : "Content-Security-Policy";
// CSP=... lets an experiment try a tighter/looser variant without editing the
// shipped policy — this is how the enforcing policy below was narrowed down.
const POLICY = process.env.CSP || CONTENT_SECURITY_POLICY;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function readIfFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // normalize() collapses `..` so a request can never escape dist/.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let body = await readIfFile(join(DIST, rel));
  let path = rel;

  if (body === null && !rel.startsWith("/api/")) {
    // Render's SPA rewrite: any unknown path serves the shell, so /app and
    // /c/:id load by direct URL.
    body = await readIfFile(join(DIST, "index.html"));
    path = "index.html";
  }

  res.setHeader(HEADER, POLICY);
  if (body === null) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(body);
});

server.listen(PORT, () => {
  console.log(`serving dist/ on http://localhost:${PORT} with ${HEADER}`);
  console.log(POLICY);
});
