# Paste from Pixso clipboard — design

2026-07-22. Status: approved for implementation (autonomous /goal session; user review async).

## Goal

Cmd+C on elements in the Pixso v2 web editor → Cmd+V into pen-editor inserts real scene
nodes, mirroring the existing paste-from-Figma mechanism (`src/lib/figmaPaste/` +
`clipboardActions.ts`).

## What Pixso actually writes to the clipboard (research summary)

Established by static analysis of pixso.net's public bundle
(`chunk-main.b40b66f4.js`, 5.6 MB) plus the official plugin-API docs
(`pixso.net/developer/en/plugin-api/api/pixso.html`):

- Copy writes **`text/html` + `text/plain`** via `navigator.clipboard.write(new
  ClipboardItem(...))`, with an `execCommand("copy")` fallback.
- The `text/html` flavor is:

  ```html
  <!--PixsoClipboardData--><meta charset='utf-8'>
  <span id="pixso-data"
        data-fic="…opaque…" data-fic-meta="{json}" data-fic-attribute="…"
        data-pix="…opaque…" pix-custom-data="{json}">plain-text fallback</span>
  <!-- optional: --><span id="bosyun-shape" data-bos-shape="<!--(bos-shape)…base64…(/bos-shape)-->"></span>
  ```

  Pixso's own paste path gates on the `<!--PixsoClipboardData-->` sentinel and re-reads
  those `data-*` attributes.
- The node payload (`data-fic`/`data-pix`) is binary, encoded by a **kiwi encoder inside
  a WASM core** (`kiwiCompiler.encodePixsoMsg`). Same encoding *concept* as Figma's
  fig-kiwi, but proprietary markers and — unknown until a live capture — possibly no
  embedded schema (Figma embeds its schema in every payload; Pixso's schema lives in WASM).
- A second **plain-JSON channel** exists in `text/plain`: payloads prefixed with
  `<!-- pixso json data -->{...}` (and `<!-- pixso binary data -->…`,
  `<!-- pixso json by sketchjson -->{...}`) are parsed as JSON and re-encoded internally.
- No Figma↔Pixso clipboard interop exists (file/URL import only), so the format is
  proprietary, not fig-kiwi byte-compatible.

**Open question (needs one real captured payload):** is `data-fic` decodable without
Pixso's WASM schema? The design below works either way: every decodable channel is
attempted in a cascade, and the undecodable case degrades to an actionable toast plus a
diagnostic dump we can use to finish the decoder.

## Architecture

New module `src/lib/pixsoPaste/`, shaped like `src/lib/figmaPaste/`:

- `detect.ts` — `isPixsoClipboardHtml(html)`: cheap sentinel check for
  `<!--PixsoClipboardData-->` (tolerating HTML-escaped variants, as
  `src/lib/clipboardPayload.ts` does for Figma). No heavy imports.
- `extract.ts` — `extractPixsoClipboard(html)`: DOMParser-based extraction of
  `span#pixso-data` attributes (`data-fic`, `data-fic-meta`, `data-fic-attribute`,
  `data-pix`, `pix-custom-data`, innerText fallback) into a typed
  `PixsoClipboardPayload`.
- `decode.ts` — the **decoder cascade**. Given `PixsoClipboardPayload` + the raw
  `text/plain` flavor, try in order, first success wins:
  1. `text/plain` starting with `<!-- pixso json data -->` → strip marker →
     `JSON.parse` → node-JSON converter (below).
  2. `data-fic` / `data-pix` parse directly as JSON (or base64→utf8→JSON).
  3. `data-fic` / `data-pix` base64→bytes → attempt fig-kiwi-style archive decode,
     reusing `figmaPaste`'s chunk/decompression helpers (covers the case Pixso embeds
     a schema after all; zstd/deflate/raw all attempted).
  4. Nothing decodable → return `{ nodes: null, diagnostic }` where `diagnostic`
     summarizes which attributes were present, payload sizes, magic bytes — logged via
     `console.warn` to make finishing the decoder from a real capture trivial.
- `convert.ts` — JSON → `SceneNode[]`. Reuse `parsePixsoNodes`/`convertPixsoNode` from
  `src/utils/pixsoImportUtils.ts` (Figma-plugin-API-shaped, uppercase types) when the
  decoded JSON matches that shape; a thin shape-sniffing adapter decides. Unknown JSON
  shapes are reported in warnings, not silently dropped.
- `index.ts` — `convertPixsoClipboardHtml(html, plainText): Promise<PixsoConversionResult | null>`
  with dynamic imports for the heavy parts, mirroring `convertFigmaClipboardHtml`.
  `PixsoConversionResult = { nodes: SceneNode[]; warnings: string[] }`.

### Wiring into the paste pipeline

In `src/components/canvas/clipboardActions.ts` `handlePaste`, add an
`else if (isPixsoClipboardHtml(htmlText))` branch after the Figma branch, same shape:
`e.preventDefault()` → `convertPixsoClipboardHtml(htmlText, syncText)` →
`applyExternalPasteNodes(...)` (history snapshot, batch, viewport-centering, selection —
already format-agnostic) → surface warnings as toast. Decode failure does **not**
early-return (matches the deliberate fall-through at the existing
`externalPasteHandled` check) and shows an actionable toast: paste recognized as Pixso
but undecodable → suggest Toolbar "Import from Pixso" as the workaround.

## Error handling

- Malformed HTML/attributes: extraction returns null → branch falls through silently.
- Recognized-but-undecodable: toast + `console.warn` diagnostic (no throw).
- Partially convertible JSON: convert what's possible, aggregate per-node warnings
  (same policy as `FigmaConversionResult.warnings`).

## Testing

- Unit (Vitest, happy-dom): `src/lib/pixsoPaste/__tests__/`.
  - Synthetic payload builders in `pixsoFixture.ts` constructing the wrapper exactly as
    the bundle does (sentinel, span, attributes) — analogous to `figFixture.ts`.
  - Detection (positive/negative/escaped), extraction, each cascade branch (json-data
    channel → nodes; JSON-in-data-fic; undecodable → diagnostic), converter reuse
    (mock `getPathBBox` per pixsoImportUtils tests), handlePaste routing (Pixso branch
    chosen over h2d/image fallbacks; internal-clipboard priority still wins).
- A real captured payload, once obtained, is added as a regression fixture (like
  `ZSTD_REGRESSION_BYTES` in figmaPaste tests) and drives any decoder tightening.

## Out of scope

- Reverse-engineering the WASM kiwi schema (only if the cascade + real capture prove
  everything else undecodable — separate follow-up).
- `data-bos-shape` whiteboard objects, images-by-reference fetching from Pixso servers,
  paste **into** Pixso.
- Backend/AI-tool changes: this is frontend-only; no tool-contract impact.
