// Single source of truth for the app's Content-Security-Policy.
//
// The policy is not applied by any code in this repo — the frontend is a static
// site on Render and the header is set by the host (see docs/csp.md). This
// module exists so the string lives in version control next to the code that
// determines it, and so `scripts/csp-serve.mjs` can serve the real build with
// the real header to prove what the enforcing version breaks.
//
// Every source below was derived by reading the code, not copied from a
// template. Justifications are in docs/csp.md; keep the two in sync.

export const BACKEND_ORIGIN = "https://pen-editor-backend.onrender.com";
export const POSTHOG_ORIGIN = "https://eu.i.posthog.com";
export const POSTHOG_ASSETS_ORIGIN = "https://eu-assets.i.posthog.com";
/** Cloudflare R2 public host serving showcase screenshots and screen HTML. */
export const ASSET_ORIGIN = "https://pub-a11973ffbe064230b5fe6d7351ffaaef.r2.dev";

export const DIRECTIVES = {
  // Nothing may load from anywhere by default; every relaxation below is
  // deliberate and justified.
  "default-src": ["'self'"],

  // No inline script anywhere: dist/index.html ships zero inline <script>
  // (the only one in the source index.html is behind import.meta.env.DEV and
  // is stripped from the production build), and no first-party or vendored
  // code calls eval/new Function. This is the directive the whole exercise is
  // about, so it stays free of 'unsafe-inline'/'unsafe-eval'.
  "script-src": ["'self'"],

  // PixiJS creates its texture-decode workers from a Blob object URL
  // (node_modules/pixi.js/lib/_virtual/{loadImageBitmap,checkImageBitmap}.worker.mjs
  // -> URL.createObjectURL(new Blob([...])) -> new Worker(url)). Without
  // blob: the canvas cannot decode a single remote image. The blob's contents
  // are shipped vendor code, not attacker-reachable input.
  "worker-src": ["'self'", "blob:"],

  // Runtime-injected <style> elements: embed rendering
  // (src/utils/embedHtmlUtils.ts), the Pixi foreignObject HTML rasteriser
  // (src/pixi/renderers/htmlTexture/foreignObject.ts), the pseudo-element
  // materialiser, the h2d Phosphor inliner, the inline embed editor and the
  // plugin sandbox's theme block. Embeds and pasted HTML also carry style=""
  // attributes. Inline *style* cannot execute script, so this is a far cheaper
  // concession than inline script would be. The two remote hosts are the
  // stylesheet <link>s appended at runtime by src/utils/fontUtils.ts and
  // src/utils/fontStylesheets.ts, the latter with its own hostname allowlist
  // ("fonts.googleapis.com", and "unpkg.com" under /@phosphor-icons/).
  "style-src": [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com",
    "https://unpkg.com",
  ],

  // data:/blob: are load-bearing for the canvas itself: extract.base64
  // screenshots, SVG rasterisation via object URLs
  // (htmlTexture/svgAssets.ts, htmlTexture/foreignObject.ts), 3D layer
  // capture, and every export preview. https: is a genuine wildcard: a design
  // document may reference any image host the user pasted, and agent-authored
  // embeds pull from picsum/unsplash/placehold/R2 among others, so no
  // enumerable allowlist exists. Restricting the *scheme* to https still
  // buys the http->https downgrade protection.
  "img-src": ["'self'", "data:", "blob:", "https:"],

  // Uploaded custom fonts are registered through the FontFace(family,
  // ArrayBuffer) constructor (src/utils/customFontRegistration.ts), which CSP
  // does not police at all — no directive is needed for uploads. 'self'
  // covers bundled faces, data: covers faces embedded in pasted/imported CSS,
  // and the two hosts are where the runtime-injected stylesheets above pull
  // their .woff2 from (Google Fonts serves fonts from gstatic; the Phosphor
  // web CSS from unpkg).
  "font-src": [
    "'self'",
    "data:",
    "https://fonts.gstatic.com",
    "https://unpkg.com",
  ],

  // Backend (chat, /api/models, /api/image-proxy, /api/showcase, canvas
  // sharing, user skills). PostHog ingest is eu.i.posthog.com; the assets
  // host is contacted for remote *config* even with external script loading
  // disabled, so it needs a connect-src entry (but not a script-src one).
  // unpkg is the Phosphor icon SVGs fetched by src/lib/h2dCapture/phosphorIcons.ts.
  // blob:/data: are fetched back by the image pipeline
  // (src/lib/imageOps/resolveSourceUrl.ts).
  //
  // Deliberately NOT `https:`. Remote images reach the canvas through
  // <img crossOrigin> and Pixi's Assets loader, with /api/image-proxy as the
  // fallback — none of which needed a wildcard here in testing. The one known
  // casualty is src/lib/downloadFile.ts's direct fetch of an arbitrary remote
  // image URL, which already has a CORS-failure fallback path; see docs/csp.md.
  "connect-src": [
    "'self'",
    BACKEND_ORIGIN,
    POSTHOG_ORIGIN,
    POSTHOG_ASSETS_ORIGIN,
    "https://unpkg.com",
    "data:",
    "blob:",
  ],

  // Video fills and exports use object URLs; embeds may reference remote media.
  "media-src": ["'self'", "data:", "blob:", "https:"],

  // 'self' covers the two srcdoc iframes (plugin sandbox, h2d capture).
  // YouTube is the one remote host src/utils/sanitizeEmbedHtml.ts lets an
  // embed iframe point at. The r2.dev host is the showcase lightbox, which
  // frames the screen's stored HTML straight from the bucket
  // (src/components/showcase/ShowcaseLightbox.tsx, `src={screen.htmlUrl}`).
  //
  // WARNING: that last entry is coupled to the storage bucket. This project
  // has already migrated object storage once (timeweb -> R2); the next move
  // silently empties every lightbox until this line is updated too.
  "frame-src": [
    "'self'",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    ASSET_ORIGIN,
  ],

  // The PWA manifest is same-origin.
  "manifest-src": ["'self'"],

  // No <object>/<embed>/<applet> anywhere in the app.
  "object-src": ["'none'"],

  // Injected script cannot repoint every relative URL in the document.
  "base-uri": ["'self'"],

  // The app never posts a form cross-origin.
  "form-action": ["'self'"],

  // Nothing embeds the editor in a frame. The Electron shell loads it in a
  // WebContentsView via loadURL (a top-level navigation), which is not framing.
  "frame-ancestors": ["'none'"],
};

export const CONTENT_SECURITY_POLICY = Object.entries(DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(" ")}`)
  .join("; ");
