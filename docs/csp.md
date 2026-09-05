# Content-Security-Policy

The app had no CSP at all until now. This documents the one it should have,
where it has to be configured, and — the part that actually matters — what an
*enforcing* policy was measured to break.

CSP does not prevent injection. It limits what injected code can do once it is
in the page. That matters more here since `src/lib/webmcp/` began publishing a
documented, machine-readable API that can read and rewrite the user's entire
document from page context: the payoff of any future XSS went up, so the second
line of defence became worth building.

## Where the header lives — NOT in this repo

The frontend is a **Render static site** (`https://pen-editor.onrender.com`,
auto-deploy from `main`). There is no `render.yaml`, no `public/_headers`, and
no deploy step in `.github/workflows/ci.yml` — the service is configured
entirely in Render's dashboard, which is also where the SPA rewrite (`/*` →
`/index.html`) lives. `wrangler.jsonc` at the repo root is a leftover from a
Cloudflare experiment; nothing builds or deploys through it.

**So the header cannot be shipped from this repository.** It has to be added by
hand:

> Render dashboard → the `pen-editor` static site → **Settings → Headers** →
> Add Header
> - **Path**: `/*`
> - **Name**: `Content-Security-Policy-Report-Only`
> - **Value**: the report-only string below

A `<meta http-equiv="Content-Security-Policy">` in `index.html` was rejected as
the delivery mechanism: it cannot express `frame-ancestors` (the clickjacking
half of the policy), it cannot be Report-Only, and it only applies from the
point the parser reaches it. The header path exists, so it should be used.

`scripts/csp-policy.mjs` is the single source of truth for the string.
`src/lib/__tests__/cspPolicy.test.ts` guards its invariants in CI. Regenerate
the value with:

```bash
node -e "import('./scripts/csp-policy.mjs').then(m=>console.log(m.CONTENT_SECURITY_POLICY))"
```

## Roll-out

1. **Now**: add it as `Content-Security-Policy-Report-Only`. Nothing breaks; the
   browser only reports. Note that Report-Only with no `report-uri`/`report-to`
   endpoint surfaces violations *only in each visitor's devtools console* — to
   collect them centrally, add a `report-to` group, or read the local evidence
   in "What enforcing breaks" below, which is what this exercise produced
   instead of waiting for traffic.
2. **Then**: once the plugin sandbox finding below is resolved, rename the
   header to `Content-Security-Policy`. The value does not change.

## The policy

Report-Only and enforcing carry the identical value; only the header name
differs.

```
default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://unpkg.com; connect-src 'self' https://pen-editor-backend.onrender.com https://eu.i.posthog.com https://eu-assets.i.posthog.com https://unpkg.com data: blob:; media-src 'self' data: blob: https:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://pub-a11973ffbe064230b5fe6d7351ffaaef.r2.dev; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

| Directive | Why |
|---|---|
| `default-src 'self'` | Deny by default; every relaxation below is deliberate. |
| `script-src 'self'` | The built `dist/index.html` contains **no** inline `<script>` (the only one in the source is behind `import.meta.env.DEV`), and no app code calls `eval`/`new Function`. No `'unsafe-inline'`, no `'unsafe-eval'`, no `blob:`/`data:`. |
| `worker-src 'self' blob:` | PixiJS builds its image-decode workers from an object URL (`pixi.js/lib/_virtual/{checkImageBitmap,loadImageBitmap}.worker.mjs`). Without `blob:` the renderer cannot start. The blob content is shipped vendor code, not attacker input. |
| `style-src 'self' 'unsafe-inline' fonts.googleapis.com unpkg.com` | Runtime-injected `<style>` in the embed pipeline, the Pixi `foreignObject` rasteriser, the pseudo-element materialiser and the inline embed editor, plus `style=""` on pasted/AI-authored embed markup. The two hosts are the stylesheet `<link>`s appended by `src/utils/fontUtils.ts` and `src/utils/fontStylesheets.ts` (which has its own hostname allowlist). Inline *style* cannot execute script. |
| `img-src 'self' data: blob: https:` | `data:`/`blob:` are load-bearing for the canvas (`extract.base64` screenshots, SVG rasterisation via object URLs, showcase LQIP placeholders, exports). `https:` is a real wildcard: a document may reference any image host the user pasted, and agent-authored embeds pull from picsum/unsplash/placehold/R2 — there is no enumerable list. Pinning the *scheme* still blocks http downgrades. |
| `font-src 'self' data: fonts.gstatic.com unpkg.com` | Uploaded custom fonts go through `new FontFace(family, ArrayBuffer)`, which CSP does not police at all. The hosts serve the `.woff2` behind the two stylesheets above. |
| `connect-src …` | Backend API (chat, models, image proxy, showcase, sharing, skills), PostHog ingest, PostHog's assets host (remote *config*, fetched as data even with script loading disabled), unpkg for the Phosphor icon SVGs `src/lib/h2dCapture/phosphorIcons.ts` fetches, and `blob:`/`data:` which the image pipeline reads back. Deliberately **not** `https:` — see the finding below. |
| `media-src 'self' data: blob: https:` | Video fills accept `data:`, `blob:` and arbitrary remote URLs (`src/pixi/renderers/videoFillHelpers.ts`). |
| `frame-src 'self' youtube… r2.dev` | `'self'` covers the two `srcdoc` iframes (plugin sandbox, h2d capture). YouTube is the only remote host `src/utils/sanitizeEmbedHtml.ts` lets an embed iframe survive with. The r2.dev host is the showcase lightbox, which frames stored screen HTML straight from the bucket. |
| `manifest-src 'self'` | The PWA manifest is same-origin. |
| `object-src 'none'` | No `<object>`/`<embed>` anywhere; plugin content is a classic injection sink. |
| `base-uri 'self'` | Stops injected markup repointing every relative URL in the document. |
| `form-action 'self'` | The app never posts a form cross-origin. |
| `frame-ancestors 'none'` | Nothing embeds the editor. The Electron shell uses `WebContentsView.loadURL` (a top-level navigation), which is not framing. |

### The r2.dev coupling

`frame-src` names the Cloudflare R2 public host. Object storage has already
moved once (timeweb → R2). **The next migration silently empties every showcase
lightbox until this line moves too** — the iframe just renders blank, with the
violation only in the visitor's console.

## What enforcing breaks — measured, not guessed

Method: `npm run build` with production env vars, then `dist/` served by
`scripts/csp-serve.mjs` with the policy as a real response header (`npm run
preview` cannot set headers), driven by headless Chromium. Both routes were
exercised: `/` (gallery, scrolling, image loading) and `/app` (boot, canvas,
tool drag, chat panel, WebMCP `batch_design`).

### Fixed by a code change, not by weakening the policy

1. **PixiJS refused to start — the editor rendered nothing.**
   `AbstractRenderer._unsafeEvalCheck` does not degrade; it *throws*
   `"Current environment does not allow unsafe-eval, please use
   pixi.js/unsafe-eval module to enable support"`, and no canvas is created.
   The tempting fix — `script-src 'unsafe-eval'` — would let any injected
   string be compiled into code and would gut the policy.
   **Fix:** `import "pixi.js/unsafe-eval"` in `src/pixi/PixiCanvas.tsx` (the
   sole renderer entry point), which swaps the code-generating uniform/UBO
   paths for interpreted ones. Verified: canvas boots, zero page errors.
   **Cost:** the polyfilled uniform sync is interpreted. If
   `e2e/pixi-large-document-performance.spec.ts` starts failing its frame-time
   budgets, that is the trade-off to re-measure — not a reason to relax
   `script-src`.

2. **PostHog injected a third-party `<script>`.** It loaded
   `https://eu-assets.i.posthog.com/array/<key>/config.js`, which would have
   required a third-party origin in `script-src` — the one directive that must
   stay `'self'`.
   **Fix:** `disable_external_dependency_loading: true` in
   `src/lib/analytics/index.ts`. Nothing we use needs those bundles (session
   recording, autocapture, surveys and the toolbar are all off). Verified: the
   `script-src` violation is gone. PostHog still *fetches* its remote config as
   data, which is why the assets host remains in `connect-src` only.

3. **HTML paste / "convert embed to design" would have broken.**
   `src/lib/h2dCapture/captureEmbed.ts` inlined the vendored capture bundle as
   an inline `<script>` inside a `srcdoc` iframe — and **a `srcdoc` iframe
   inherits the embedder's CSP**, so `script-src 'self'` blocks it.
   **Fix:** import the bundle with `?url` instead of `?raw` and reference it as
   a same-origin `<script src>`. Verified: the bundle installs
   (`__h2d_clone` present) under the enforcing policy.

### Outstanding — must be resolved before switching to enforcing

4. **Plugins break. All of them.** `src/lib/plugins/pluginHost.ts` runs each
   plugin in a `sandbox="allow-scripts"` `srcdoc` iframe whose document is two
   inline `<script>` blocks (`src/lib/plugins/bootstrap.ts`: the bootstrap
   shim, and the plugin's own code). Sandboxing does not change CSP
   inheritance, so `script-src 'self'` blocks both. Measured: the inline script
   never runs.
   None of the usual escapes apply — a hash cannot cover arbitrary
   user-authored plugin code, a nonce cannot be threaded into an inherited
   policy, and `script-src blob:` would reopen the bypass the policy exists to
   close.
   **Recommended fix:** give the sandbox its own document instead of a
   `srcdoc` one — serve `/plugin-sandbox.html` as a real same-origin URL, still
   `sandbox="allow-scripts"` (opaque origin), and pass the plugin code in over
   `postMessage`. A document loaded from a URL gets its CSP from *its own*
   response, so Render can carry a second, narrower header rule for that one
   path. That is a design change with its own review, which is why this policy
   ships Report-Only first.

### Accepted, with the reasoning

5. **`connect-src` has no `https:`, and PixiJS's fast image path pays for it.**
   Pixi loads textures by having its blob worker `fetch()` the image URL —
   which `connect-src` governs, not `img-src`. Measured: that fetch is blocked
   for an arbitrary remote host. It is **not fatal**: `imageFillHelpers.ts`
   has a documented fallback chain (`Assets.load` → `<img crossOrigin>` →
   `/api/image-proxy`), and an `<img crossOrigin>` to an arbitrary https host
   was measured to load fine under this policy. So remote images still appear,
   one fallback step later.
   Adding `https:` would remove the wasted request. It was left out because
   `connect-src https:` is what turns a script injection into bulk
   exfiltration (arbitrary `POST` of document contents), whereas `img-src
   https:` — which is unavoidable — only permits slow GET-encoded leakage.
   **If the Report-Only reports fill with `connect-src` violations naming
   image hosts, the clean fix is `Assets.setPreferences({ preferWorkers: false })`
   rather than opening the directive.**

6. **One benign `script-src eval` report at editor boot.** A dependency (zod's
   `allowsEval` feature probe) calls `Function("")` inside a `try/catch` to
   decide whether it can build fast validators. CSP throws, the probe catches
   it and takes the slow path. Nothing breaks; it costs one violation report
   per page load, which is worth knowing before reading Report-Only output.

## What could not be verified locally

- **Real plugins.** Finding 4 was proven with a `srcdoc` iframe built to match
  `buildSrcdoc`'s shape exactly, not by installing a plugin — no plugins are
  installed by default.
- **An image fill rendering end-to-end.** The headless harness failed to
  render the created frame *with the policy entirely disabled* too, so it
  could not distinguish CSP from harness. Finding 5 rests on the isolated
  mechanism probes instead.
- **The showcase lightbox in situ** — the card click did not open it headlessly.
  Verified indirectly: an iframe to the r2.dev host loads under this policy.
- **The Electron shell.** `frame-ancestors 'none'` is judged safe from reading
  `pen-editor-desktop`'s `WebContentsView.loadURL` usage, not from running it.
  Worth a smoke test on the desktop build before enforcing.
- **PostHog against a real key.** The audit used a fake key, so ingest was
  never exercised end-to-end; only the request origins were.
- **Anything behind the backend** — canvas sharing, uploads, generated images
  — was not driven, since those need live backend state. All of them use the
  same backend origin already allowlisted in `connect-src`.

## Reproducing

```bash
npm run build
node scripts/csp-serve.mjs                # enforcing, port 4180
node scripts/csp-serve.mjs --report-only  # the header shipped first
CSP="…" node scripts/csp-serve.mjs        # try a variant
```
