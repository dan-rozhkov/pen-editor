# Paste from Pixso clipboard — design

2026-07-22. Status: approved for implementation (autonomous /goal session; user review async).

## Goal

Cmd+C on elements in the Pixso v2 web editor → Cmd+V into pen-editor inserts real scene
nodes, mirroring the existing paste-from-Figma mechanism (`src/lib/figmaPaste/` +
`clipboardActions.ts`).

## What Pixso actually writes to the clipboard (confirmed against real captures)

Verified by static analysis of pixso.net's public bundle plus three **real captured
payloads** (a red 96×40 rectangle, a text node, a frame — captured 2026-07-22 via
`osascript … the clipboard as «class HTML»`, decoded offline):

- Copy writes `text/html` (and a `text/plain` fallback) via
  `navigator.clipboard.write(new ClipboardItem(...))`, with an `execCommand("copy")`
  fallback path.
- The `text/html` flavor (real capture, whitespace added):

  ```html
  <meta charset='utf-8'><!--PixsoClipboardData--><meta charset='utf-8'>
  <span id="pixso-data"
        data-fic="cGl4c28ta3cAAg1jb21wcmVzczp6c3Rk…(base64)…"
        data-fic-meta="&quot;{\"fileKey\":\"…\",\"pageID\":\"0:1\",
             \"selections\":[{\"parent\":\"0:1\",\"nodes\":[\"167:675\"]}],
             \"copyStyle\":false}&quot;"></span>
  </span>
  ```

  Pixso's own paste path gates on the `<!--PixsoClipboardData-->` sentinel and re-reads
  the `data-*` attributes. `data-fic-meta` is a double-JSON-encoded string carrying
  `fileKey` / `pageID` / `selections` (source node ids) — informational, not needed to
  reconstruct geometry.

- **`data-fic` payload structure (decoded, confirmed):**
  1. base64-decode → bytes.
  2. First 24 bytes are a header: ASCII `pixso-kw`, `00 02`, `0x0d`, ASCII
     `compress:zstd`.
  3. Bytes 24+ are a single **zstd frame** (`28 b5 2f fd …`). `fzstd`-decompress it.
  4. The decompressed bytes are a **kiwi message using Figma's fig-kiwi schema**.

- **The kiwi schema is a public, fetchable asset — no WASM needed to decode.**
  `https://cdn.pixso.net/app/fs.binary` (~70 KB) is a standard kiwi *binary schema*
  (`decodeBinarySchema()` → 619 definitions): `Message` (field 1 `type` MessageType,
  2 `sessionID`, 3 `ackID`, 4 `nodeChanges NodeChange[]`, 6 `blobs Blob[]`,
  30 `blobBaseIndex`), `NodeChange` (600 fields: `type`/`name`/`size`/`guid`/
  `parentIndex`/`fillPaints`/…), `Paint`, `TextData`, `Effect`, etc. This is
  byte-for-byte the same schema family our `figmaPaste` decoder already consumes.

- **Container framing** (still being pinned to the byte by a native-decode task at
  design time): the decompressed buffer begins with a `Message` header
  (`type`/`sessionID`/`ackID`), followed by the node data as `nodeChanges`. The exact
  framing (single `Message` vs. a short stream / length-prefixed chunks — a naive
  `decodeMessage` surfaces only the 3 header fields, and node data clearly begins ~byte
  7) is being resolved by decoding a sample with Pixso's own WASM core
  (`FusionCore.f893a380.wasm`, downloaded) as ground truth. **This does not change the
  architecture below** — once framing is known, the decoder produces a
  `{ nodeChanges, blobs, blobBaseIndex }` object identical in shape to
  `figmaPaste`'s `FigMessage`.

- Not relevant to our importer: a `text/plain` secondary channel
  (`<!-- pixso json data -->…`, `<!-- pixso binary data -->…`) and an optional
  `data-bos-shape` base64 sub-channel for whiteboard objects.

### Consequence for the design: reuse the Figma converter

Because Pixso's decoded message is the same `nodeChanges`/`blobs`/`blobBaseIndex` shape
as Figma's, the node→SceneNode conversion **reuses the existing, tested
`convertFigmaPasteToSceneNodes(data: FigPasteData)`** from
`src/lib/figmaPaste/figmaToScene.ts` unchanged. `pixsoPaste`'s job is only: detect →
extract `data-fic` → strip the `pixso-kw`/zstd header → decompress → decode with the
bundled Pixso schema → wrap as a `FigPasteData` (`{ meta, message, version }`) → hand to
`convertFigmaPasteToSceneNodes`. Any Pixso-specific field/enum-id drift surfaced during
testing is handled by a thin adapter, not a fork of the converter.

## Architecture

New module `src/lib/pixsoPaste/`, shaped like `src/lib/figmaPaste/`:

- `detect.ts` — `isPixsoClipboardHtml(html)`: cheap sentinel check for
  `<!--PixsoClipboardData-->` (tolerating HTML-escaped variants). No heavy imports, so
  it stays cheap on every paste; the decoder + schema load on demand.
- `extract.ts` — `extractPixsoDataFic(html)`: pull the `data-fic` base64 (and optional
  `data-fic-meta` JSON) out of `span#pixso-data`. Regex-based (the `handlePaste` path
  runs in happy-dom in tests and in the browser in prod; a regex avoids a DOMParser
  dependency and matches how `figmaPaste` extracts its section).
- `schema.ts` — the bundled Pixso kiwi schema. `fs.binary` (~70 KB) is committed as
  `src/lib/pixsoPaste/pixso.kiwi.b64` (base64 text asset) and compiled lazily once via
  `kiwi-schema`'s `decodeBinarySchema` + `compileSchema`, memoized. Bundling (vs.
  fetching from `cdn.pixso.net` at paste time) keeps paste offline-capable and
  deterministic; a version note records the source URL + `fs.binary` hash for refresh.
- `decode.ts` — `decodePixsoDataFic(base64): FigPasteData`:
  1. base64 → bytes.
  2. Validate the `pixso-kw` magic; read past the 24-byte
     `pixso-kw…compress:zstd` header (parse the `compress:<algo>` token rather than
     hard-coding 24, so a future `compress:deflate` still works — fall back to the
     shared `decompressFigmaChunk` for deflate).
  3. `fzstd`-decompress the remainder.
  4. Decode the kiwi `Message` with the bundled schema using the framing confirmed by
     the native-decode task (single `Message`, or the short header+stream it turns out
     to be — encapsulated entirely here), yielding
     `{ nodeChanges, blobs, blobBaseIndex }`.
  5. Return `{ meta, message, version }` shaped as `figmaPaste`'s `FigPasteData`.
- `index.ts` — `convertPixsoClipboardHtml(html): Promise<FigmaConversionResult | null>`:
  returns null when `isPixsoClipboardHtml` is false; otherwise dynamically imports
  `decode` + the schema + `figmaPaste`'s `convertFigmaPasteToSceneNodes`, chaining
  decode → convert. Reuses `FigmaConversionResult` (nodes + warnings +
  unresolvedImageCount) — no new result type, since the converter is shared.

If a real Pixso capture exposes a field/enum-id that our Figma converter mishandles
(possible: 600-field `NodeChange`, Pixso enum drift), the fix is a small pre-convert
normalizer in `decode.ts`, keeping `figmaToScene` untouched.

### Wiring into the paste pipeline

In `src/components/canvas/clipboardActions.ts` `handlePaste`, add an
`else if (isPixsoClipboardHtml(htmlText))` branch after the Figma branch and before the
h2d branch, same shape: `e.preventDefault()` → `convertPixsoClipboardHtml(htmlText)` →
`applyExternalPasteNodes(...)` (history snapshot, batch, viewport-centering, selection —
already format-agnostic) → surface `result.warnings` via `console.warn`, and the same
image-fill toast as the Figma branch when `unresolvedImageCount > 0` (Pixso, like Figma,
references image fills by hash — pixels aren't in the buffer). Decode failure/empty
result does **not** early-return (matches the deliberate fall-through at the existing
`externalPasteHandled` check): `console.warn` the error and fall through so image/SVG/
internal-clipboard fallbacks still run.

## Error handling

- Malformed HTML / missing `data-fic`: extraction returns null → `convertPixsoClipboardHtml`
  returns null → branch falls through silently.
- Bad magic / decompress / decode error: `decode.ts` throws; `index.ts` lets it
  propagate; `handlePaste` catches, `console.warn`s, and falls through (no user-facing
  crash, other paste paths still run).
- Partial conversion: convert what's possible, aggregate `FigmaConversionResult.warnings`
  (same policy the Figma branch already uses).

## Testing

- Unit (Vitest, happy-dom): `src/lib/pixsoPaste/__tests__/`.
  - **Real captured payloads as fixtures** (the lesson from the Figma image-fill and
    layer-blur bugs — never trust synthetic fixtures for a clipboard format's crux): the
    three captures (`pixso-rect`, `pixso-frame`, `pixso-text`) are committed as small
    base64 `.html` fixtures under `__tests__/fixtures/`. Tests assert
    `convertPixsoClipboardHtml` on the rect fixture yields one node with the known size
    (~96×40) and a red fill; the frame yields a frame node; the text yields a text node.
  - `detect` (positive on the real sentinel, negative on Figma/h2d/plain HTML,
    escaped-marker variant), `extract` (pull `data-fic` from the real fixture),
    `decode` (header parse, zstd, kiwi decode → nodeChanges length > 0).
  - `handlePaste` routing: Pixso fixture routes to the Pixso branch (not h2d/image),
    internal-clipboard priority still wins within the priority window.
- A `pixsoFixture.ts` builder (wrapper + kiwi-encode via the bundled schema) is added
  only if synthetic edge cases are needed beyond the three real captures.

## Out of scope

- `data-bos-shape` whiteboard objects; images-by-reference fetching from Pixso servers
  (image fills come back as placeholders + toast, exactly as the Figma branch does);
  paste **into** Pixso; the `text/plain` json/binary secondary channel.
- Backend/AI-tool changes: frontend-only; no tool-contract impact.

## Verification

Ship-gate before release: `npm run lint`, `npm test`, `npm run build` all green, plus a
live browser check — copy a rect/text/frame in the real Pixso editor, Cmd+V into
pen-editor, confirm nodes land with correct geometry/fill/selection and one undo removes
them.
