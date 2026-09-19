# generate_vector — live vector drawing through QuiverAI

Status: implemented 2026-09-19.

## What this adds

A second vector authoring path for the design agent. The model describes artwork in
words; QuiverAI's `arrow-2` — a vector-native model that emits SVG — draws it, streaming
the document as it goes; the browser paints each finished element on the canvas as it
arrives and commits real editable path nodes at the end.

`draw_vector` is **not** replaced. The two tools differ in who computes the geometry:

| | `draw_vector` | `generate_vector` |
|---|---|---|
| Geometry author | the chat model, coordinate by coordinate | QuiverAI `arrow-2` |
| Input | an `M/L/C/FILL/STROKE` script | a prose description |
| Good at | diagrams, exact shapes, measured geometry | icons, logos, spot illustration |
| Latency | as fast as the chat turn | ~30–90 s |

A chat model asked to draw a fox by hand produces a poor fox; asked for a 40×40 arrow at
exact coordinates it produces exactly that, and Quiver cannot be steered to that precision.
Keeping both is not indecision — it is two different jobs.

## Why the key lives on the server

`QUIVER_API_KEY` is a paid live credential. The browser never sees it: the frontend calls
our own backend, which holds the key and proxies the upstream stream. This mirrors
`/api/generate-image`, the existing route with exactly this shape (paid external API,
server-side key, called from a client-executed tool handler).

## The upstream contract (verified live, 2026-09-19)

`POST https://api.quiver.ai/v1/svgs/generations`, `Authorization: Bearer <key>`.

Request: `{ model: "arrow-2", prompt, instructions?, n?, stream? }`. `arrow-2` reports
`supported_sampling_parameters: []` — temperature/top_p are silently ignored, so we do not
send them.

With `stream: true` the response is `text/event-stream`:

- `event: draft` → `{ id, index, svg, type: "draft", update_type: "delta" }`. `svg` is an
  **incremental delta** to concatenate — token-sized, ~270 events for a simple icon.
- `event: content` → `{ id, index, svg, type: "content", usage }`. Exactly one, at the end;
  here `svg` is the **complete document**, not a delta.
- Docs mention a `reasoning` phase; `arrow-2` was not observed to emit one. Unknown event
  types are ignored rather than treated as errors.

Errors are JSON: `{ code, message, request_id, status, param? }` — e.g. `invalid_api_key`
(401), `model_not_found` (404). Rate limit: 20/min on the `svg_generate` operation class,
reported in `x-ratelimit-*` headers.

Measured latency: ~26 s for a simple flat icon, ~90 s for a detailed illustration. Every
timeout in this feature is sized from those numbers, not from ordinary HTTP intuition.

Observed output vocabulary across three live generations: `path`, `rect` (with `rx`/`ry`),
`circle`, `ellipse`, `defs`, `linearGradient`, `radialGradient` (with `gradientTransform`),
`stop`, `fill`, `fill="url(#id)"`, `stroke`, `stroke-width`, `stroke-linecap`,
`stroke-linejoin`, `opacity`, `viewBox`. Path data is **relative** with implicit repeated
parameters and packed arc flags (`m69.64 30.53-1.81-25.86c…`).

**The model emits a flat document.** A generation deliberately prompted for "grouped
elements" and "repeated rotated pennant flags arranged in a ring" came back with 132
`<path>`s, 4 `<ellipse>`s, 3 `<circle>`s — and zero `<g>` elements, zero `transform`
attributes on shapes, no `style="…"` and no `stroke-dasharray`. Transform handling is
therefore needed for **gradients** (`gradientTransform` does appear) but not for shapes.
That is why the importer work prioritized shape primitives and radial gradients over
group/transform baking: the latter matters only for the file-drop path this importer also
serves, where hand-authored and Figma-exported SVGs do use groups.

## Measured: the stream is silence, then a burst

The feature was designed around "watch the agent draw." For `arrow-2` that premise
**does not hold**, and it was measured rather than assumed.

Timing a live generation frame by frame, straight from Quiver's own API:

```
first 'draft' event at +17.69s
first 'content' event at +18.99s
ANY byte first seen at +17.69s
event types: {'draft': 89, 'content': 1}
```

Nothing at all arrives for the first ~18 seconds — no keepalive, no `reasoning`
event, not one byte. Then every delta lands inside ~1.3 s and the document is done.
Our backend adds ~0.7 s of proxy overhead and nothing else: measured through
`/api/vector/generate`, the first frame arrived at +18.93 s and all 108 frames
within 1.50 s.

What the user actually sees, therefore: roughly 18 seconds of empty canvas (the chat
panel does show "Generate Vector Running…"), then the artwork revealing itself element
by element over about a second and a half, then the commit.

Streaming still earns its place — the reveal is real, partial output survives a
failure, and it costs nothing — but the throttled preview is a short flourish at the
end, not a drawing you watch being made. Anything that depends on a long visible
drawing phase (a progress affordance on the canvas, say) has to be built separately,
because the model does not provide one.

## Shape of the implementation

### Backend

- `QUIVER_API_KEY` (optional), `QUIVER_MODEL` (`arrow-2`), `QUIVER_BASE_URL`,
  `QUIVER_TIMEOUT_MS`. Optional key: absent simply means the feature is off, never a boot
  failure.
- `src/services/quiver.ts` — SSE client yielding `{type:"delta"}` / `{type:"done"}`.
- `src/routes/vector.ts` — `POST /api/vector/generate`, re-emits the stream to the browser,
  503 when unconfigured, capped at 10/min per IP.
- `src/ai/tools.ts` — `generate_vector`, client-executed (no `execute`), dropped from the
  per-request tool set when the key is unset.

### Frontend

Geometry conversion **reuses the existing importer**, `parseSvgToNodes`
(`src/utils/svgUtils.ts`), which already turns an SVG document into `PathNode`s and a
wrapping group and until now was reachable only by dropping a file on the canvas. It is
extended rather than duplicated. This is load-bearing: `PathNode.geometry` *is* an SVG `d`
string, so a Quiver `<path>` becomes a node with its curves intact — nothing is flattened
to polylines.

### Live preview: raster, then vector

The preview overlay rasterizes the **partial SVG** rather than converting it incrementally.

Reasons: an SVG prefix is a faithful picture of what the model is drawing, gradients and
fill rules included, and it costs no incremental-conversion machinery; the converter then
has to be correct exactly once, at commit, instead of on every frame.

Two constraints fall out of that choice:

- **SVG is XML, so a truncated element makes the whole document unrenderable.** Each frame
  renders `header + complete elements so far + </svg>` — the same "only whole statements"
  discipline `draw_vector` applies to whole command lines and `batch_design` to whole
  operations.
- **Re-rasterizing on all ~270 deltas would be absurd.** A frame is emitted only when the
  count of complete elements grows. That is also the honest visual unit: one finished
  `<path>` is one brush stroke appearing. ~36 frames for a detailed illustration — and
  since the deltas all land inside ~1.5 s (see the measurement above), this throttle is
  what keeps that burst from becoming hundreds of rasterizations in a single second.

The existing `aiVectorPreviewStore` is not reused: it holds one `ParsedVectorDraft` —
a single shape with a single fill and an anchor list — and a Quiver illustration is dozens
of independently painted paths. Bending it to fit would damage `draw_vector`'s preview.

## Invariants that are easy to break back

- The preview store is a **transient** store. Like `aiVectorPreviewStore` it must be
  registered in `src/pixi/renderScheduler.ts`'s subscription list, or the canvas will not
  repaint as the drawing arrives, and the layer must be created and destroyed in
  `OverlayRenderer.ts`.
- Preview frames never touch scene state. The committed nodes come from the final complete
  SVG only — one history entry, one undo.
- A texture must not be swapped in before the image has decoded, or the overlay flashes
  blank (the same race that produced empty `get_screenshot` images).
- The tool name must appear in **four** lists: backend `penTools`, backend
  `test/tools-contract.test.ts`, frontend `toolRegistry.ts`, frontend
  `toolContract.test.ts`'s `EXPECTED_CLIENT_TOOLS`. Backend lands first; the cross-repo
  contract job is red in both directions until both halves are on `main`.
- Like `draw_vector`, `generate_vector` is deliberately absent from the MCP and WebMCP tool
  surfaces.

## What the existing importer already did, measured

Before extending `parseSvgToNodes` its real behaviour was measured element by
element (one-shape documents, `stubSvgGetBBox()` installed), rather than inferred
from an aggregate node count — an aggregate first suggested shape primitives were
unsupported, and that was wrong.

Already working, untouched by this change: `rect` (plain and with `rx`), `circle`,
`ellipse`, `line`, `polygon`, `linearGradient` through `fill="url(#id)"`,
presentation properties in a `style="…"` attribute, and `<g transform="translate(…)">`.

Confirmed gaps:

- **`radialGradient` dropped the shape entirely** — not merely its paint. A
  `<circle fill="url(#paint0_radial_…)"/>` made `parseSvgToNodes` return `null`,
  because only `linearGradient` was collected from `<defs>` and an unresolvable
  gradient id skips the element. This is the one gap the live model output hits:
  its emblem generations put a radial glow behind the subject.
- **`<g transform>` honours only `translate`** — `scale`, `rotate` and `matrix` are
  silently ignored. Quiver emits no `<g>` at all, so this is file-drop robustness
  rather than a blocker for this feature.

### The test stub is a poor oracle for curves

`stubSvgGetBBox()` derives bounds by pairing consecutive numbers in the `d`
attribute, and `collectPaths` silently drops any shape measuring 0×0. Shapes can
therefore disappear **under test** while rendering correctly in a browser.

This was measured rather than assumed. The full live document holds 140 shapes and
yielded 133 nodes; the shortfall is exactly 7, and those 7 are precisely the paths
built from `h`/`v` commands — `m38.43 65.13v1.76` and six siblings. Those commands
take a single parameter, which breaks the stub's pair-the-numbers assumption: it
reads x as `[38.43, 1.76]` and y as `[65.13]`, and reports 0×0. A real `getBBox()`
returns width 0 but height 1.76, and since only a doubly-zero box is dropped, all
seven survive in the browser.

Confirmed in a real Chromium via Playwright rather than left as an argument:
measuring every shape in that document with the browser's own `getBBox()` gives
140 shapes, **zero** with a doubly-zero box, exactly 7 with one zero axis, and 133
fully sized. 133 + 7 = 140 — the importer loses nothing outside the test harness.

The rule that follows: never tune importer behaviour to make that count reach 140
under happy-dom, and do not assert exact bounds for shapes whose path data uses
curves or single-parameter commands. Assert what the stub cannot distort — node
counts for straight-line fixtures, fill/stroke/gradient resolution, `geometry`
passthrough, warnings.

## Stop cancels the generation, not just the preview

`generate_vector` is registered in the streaming-adapter registry purely for
cleanup. It draws nothing from streamed tool input — the input is only a prompt,
and the artwork arrives later, from Quiver's own stream inside the handler. The
registration exists because `useDesignChat` clears per-session adapter state on
every terminal path, and a preview owned solely by the handler would otherwise
stay painted until a generation the user already stopped finally returned, up to
~90 seconds later.

Corrected 2026-09-19: an earlier version of this document claimed pressing Stop
could not cancel the upstream call because `ToolExecutionContext` carries no
`AbortSignal`. That was wrong — `ToolExecutionContext` doesn't need one, because
the signal already exists elsewhere: `useChatStore.getState().abortControllers[sessionId]`
holds the exact `AbortController` `useDesignChat` creates per session and aborts
on Stop (`useDesignChat.ts`'s `onAbort` calls `chat.stop()` on that same
controller's signal). The handler reads `.signal` off it directly and passes it
into `streamQuiverVector`, which already accepted a `signal` option that,
before this fix, no caller ever passed — dead code wired up rather than new
plumbing. `readSseFrames`'s abort check also had to change from `return` to
`throw`: returning ended the async generator normally, so `streamQuiverVector`
fell through to `final ?? accumulated` and *resolved* with whatever truncated
SVG prefix had arrived — a stopped generation would silently succeed and commit
a half-drawn document. It now throws an abort-shaped `DOMException`, which the
handler recognizes (`isAbortError`) and reports as `{ success: false, cancelled: true }`
rather than an ordinary error, so nothing downstream mistakes a deliberate stop
for a failure worth retrying.

`generate_image` still has no such wiring and behaves the way this document
used to describe — that remains a real gap there, just not here anymore.
