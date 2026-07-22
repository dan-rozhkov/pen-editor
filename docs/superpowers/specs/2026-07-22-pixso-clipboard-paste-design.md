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

- **The kiwi schema is a public, fetchable asset — no WASM needed to decode
  (confirmed end-to-end with our own `kiwi-schema` npm lib).** The clipboard codec uses
  **`https://cdn.pixso.net/app/pixso.binary`** (~32 KB, Pixso's OWN schema — 243 defs),
  NOT `/app/fs.binary` (that ~70 KB asset is the Figma-lineage *collab* schema; feeding
  it to the clipboard payload was the original dead end). `pixso.binary`'s root message
  is `PixsoMsg` (`1 type` NodeChangesType, `2 sessionID`, `3 pixsoNodes PixsoNode[]`,
  `4 blobs Blob[]`, `20 pasteFileKey`, …). `PixsoNode` (247 fields) is Figma-`NodeChange`
  shaped: `guid{sessionID,localID}`, `parentIndex`, `phase`, `transform{m00..m12}`,
  `type` NodeType (159 values: RECTANGLE/FRAME/TEXT/CANVAS/…), `name`, `size{x,y}`,
  `cornerRadius`, `fillPaints Paint[]`, `textData`, `lineHeight`, effects, stack
  (auto-layout) fields.

- **The one decode quirk — a +1 type-index remap.** Pixso's kiwi encoder has one extra
  builtin type, so `decodeBinarySchema(pixso.binary)` from our npm `kiwi-schema` resolves
  every user-defined field type off by +1 (e.g. `PixsoMsg.pixsoNodes` mis-reads as type
  `DynamicStrokeSettings` instead of `PixsoNode`). Fix, applied once at schema-compile:
  after `decodeBinarySchema`, for every message field whose `type` names a definition,
  replace it with the definition +1 further in the `definitions` array; then
  `compileSchema`. Derive the offset from the anchor `idx(PixsoNode) −
  idx(DynamicStrokeSettings)` so it self-corrects if Pixso bumps kiwi again. With the
  remap, `compiled.decodePixsoMsg(bytes)` decodes cleanly.

- **Confirmed decode output** (3 real captures, exact): rect → `type:"NODE_CHANGES"`,
  `pixsoNodes:[CANVAS,CANVAS,RECTANGLE]`, the RECTANGLE = name "Прямоугольник 3", size
  `{200,100}`, `fillPaints:[{type:"SOLID",color:{r:255,g:0,b:0,a:255},…}]`; frame → FRAME
  `{288,288}` with an IMAGE fill (`image.hash` + `dataBlob` index, Figma-style blob refs);
  text → TEXT with full `textData.characters`, `fontName:{family:"Inter",style:"Regular"}`,
  size `{304,154}`, 33 font-outline blobs.

- **Colors are 0–255 ints**, not Figma's 0–1 floats — the converter must scale
  (`/255`). This and Pixso-specific NodeType/enum names are why the converter is an
  *adaptation* of the Figma converter, not blind reuse (below).

- Not relevant to our importer: a `text/plain` secondary channel
  (`<!-- pixso json data -->…`) and an optional `data-bos-shape` base64 whiteboard
  sub-channel.

### Consequence for the design: adapt the Figma converter

Pixso's `pixsoNodes` are the same field *families* as Figma's `nodeChanges`
(guid/parentIndex/phase/transform/type/size/fillPaints/textData/…), so the
node→SceneNode conversion **borrows heavily from
`src/lib/figmaPaste/figmaToScene/`** — the tree-building (`buildFigTree` keyed on
`guid`/`parentIndex`), coordinate mapping (transform → x/y/rotation), and shape/text/
auto-layout builders are structurally reusable. But it is an **adaptation, not blind
reuse**: Pixso's NodeType enum names, 0–255 colors, and paint/style extras differ, so
`pixsoPaste` gets its own converter that reuses figmaToScene's pure helpers where the
shapes already match and maps the differences explicitly. Blob-referenced image fills
follow the exact same fate as the Figma branch (placeholder + toast when pixels aren't
in the buffer).

## Architecture

New module `src/lib/pixsoPaste/`, shaped like `src/lib/figmaPaste/`:

- `detect.ts` — `isPixsoClipboardHtml(html)`: cheap sentinel check for
  `<!--PixsoClipboardData-->` (tolerating HTML-escaped variants). No heavy imports, so
  it stays cheap on every paste; the decoder + schema load on demand.
- `extract.ts` — `extractPixsoDataFic(html)`: pull the `data-fic` base64 (and optional
  `data-fic-meta` JSON) out of `span#pixso-data`. Regex-based (the `handlePaste` path
  runs in happy-dom in tests and in the browser in prod; a regex avoids a DOMParser
  dependency and matches how `figmaPaste` extracts its section).
- `schema.ts` — the bundled Pixso kiwi schema. `pixso.binary` (~32 KB) is committed as
  `src/lib/pixsoPaste/pixso.kiwi.b64` (base64 text asset). Lazily, once, memoized:
  `decodeBinarySchema` → apply the **+1 type-index remap** (see format section; derive
  the offset from `idx(PixsoNode) − idx(DynamicStrokeSettings)`) → `compileSchema`.
  Bundling (vs. fetching `cdn.pixso.net` at paste time) keeps paste offline-capable and
  deterministic; a comment records the source URL + schema hash for refresh.
- `decode.ts` — `decodePixsoDataFic(base64): PixsoMessage`:
  1. base64 → bytes.
  2. Validate the `pixso-kw` magic; skip the header by parsing its
     `<len><pixso-kw>...<len>compress:zstd` structure (parse the `compress:<algo>` token
     rather than hard-coding 24 bytes, so a future algo still works).
  3. `fzstd`-decompress the remainder.
  4. `compiled.decodePixsoMsg(bytes)` → `{ type, sessionID, pixsoNodes, blobs,
     pasteFileKey, ... }`. Type: `PixsoMessage` (a small hand-written interface over the
     fields the converter reads).
- `adapt.ts` — `pixsoMessageToFigPasteData(msg): FigPasteData`. Because Pixso's
  `PixsoNode` matches Figma's `FigNodeChange` field-for-field on everything the converter
  reads (`guid`/`parentIndex`/`phase`/`transform`/`type`/`name`/`size`/`cornerRadius`/
  `fillPaints`/`strokePaints`/`effects`/`textData`/`lineHeight`/`fontName`/stack fields)
  and the NodeType/PaintType/etc. enum *values* are the same strings
  (RECTANGLE/FRAME/TEXT/CANVAS/SOLID/IMAGE/…), the conversion **reuses the tested
  `convertFigmaPasteToSceneNodes` unchanged** after one normalization pass: (1) rename
  `pixsoNodes` → `nodeChanges`; (2) **deep-scale colors 0–255 → 0–1** — walk the message
  and for every plain object with numeric `r`,`g`,`b`, divide `r`/`g`/`b`/`a` by 255
  (covers solid/gradient-stop/effect/text colors uniformly, since Figma's `colorToHex`
  expects [0,1]); (3) carry `blobs`/`blobBaseIndex` through so image-fill blob refs
  resolve exactly as in the Figma path. Returns `{ meta:{}, message:{nodeChanges, blobs,
  blobBaseIndex}, version }`.
- `index.ts` — `convertPixsoClipboardHtml(html): Promise<FigmaConversionResult | null>`:
  null when `isPixsoClipboardHtml` is false; otherwise dynamically imports
  `extract` + `decode` + `schema` + `adapt` + `figmaToScene`, chaining extract → decode →
  adapt → `convertFigmaPasteToSceneNodes`. Reuses `FigmaConversionResult` (nodes +
  warnings + unresolvedImageCount) directly.

Any Pixso-only node type or field the Figma converter doesn't recognize falls through
its existing default branch (warning + skip / vector salvage) — no crash. If a real
capture exposes a genuinely divergent shape, the fix is localized to `adapt.ts`, leaving
`figmaToScene` untouched.

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
