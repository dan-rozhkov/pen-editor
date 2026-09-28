# Streaming embed preview ("magic design")

## Problem
A `batch_design` screen is one operation `I(document, {type:"embed", name, x, y, width, height, htmlContent:"<tens of KB>"})`.
Progressive application (2026-09-13) only creates the node once the whole statement has streamed, and the
dashed placeholder (2026-09-19, `aiPendingScreenLayer`) is an empty outline for 70–120 s. The user watches an
empty box, then the whole screen pops in at once.

## Goal
While `htmlContent` streams, render the partial markup live inside the placeholder box, so the screen
materializes top-to-bottom on the canvas as the model types it — each newly-arrived element fades/slides in.
When the real embed node lands (same x/y/width/height), the preview disappears and the real `EmbedHost`
takes over in place: no jump.

## Design
1. **Partial htmlContent extraction** (`pendingScreenHeaders.ts`): for each embed header, after the
   `htmlContent:` key, read the string literal (delimiter `"`, `'` or `` ` ``) up to its closing quote or the
   end of the streamed text, decoding JS/JSON escapes best-effort (`\n \t \" \' \\ \/ \uXXXX`); an incomplete
   escape at the tail is dropped. Closing-quote detection must tolerate unescaped inner quotes the same way
   the real parser does (`isLikelyStringEnd` in `batchDesign/parser.ts` — reuse/export it rather than copy).
   Exposed as `html: string` on `PendingScreenHeader` (`""` until the key/quote arrives). Never throws.
2. **Partial-HTML repair** (new pure module `src/lib/streamingTools/partialHtml.ts`):
   `repairPartialHtml(html)` — drop a trailing incomplete tag (`<div cla…` without `>`), an incomplete
   entity (`&amp` without `;`), close an open `<!--` comment, and close an unclosed `<style>` (the CSS parser
   already drops an incomplete final rule). Browsers auto-close everything else.
3. **Store** (`aiPendingScreenStore`): geometry and html are separate slots. `drafts[key].screens` holds
   geometry only (`index,name,x,y,width,height`); streamed html sits in a top-level `html` record keyed
   `${draftKey}:${index}` (`pendingHtmlKey`). `upsert` keeps `state.drafts` identity on html-only frames and
   replaces `html` only when a string actually changed. clearDraft/clearSession/finalizeCall/reset (and an
   empty upsert) also drop the matching html entries. The Pixi dashed layer and `renderScheduler` therefore
   just compare `drafts` identity (`state.drafts !== prev.drafts`); there are no geometry-key strings.
   The adapter decides "already applied" **by position, not count**: headers carry their source offset
   (`start`), and `CachedOperationsParser.parseWithBoundary` (same scanner as `parseCompleteOperationsPrefix`,
   offsets mapped back through leading wrapper-noise lines) returns the offset where the syntactically-complete
   prefix ends. A header is applied iff `start < boundary` (only when streaming mutations are on). `index` stays
   the source-order index among parsed headers. A completed `I(frame1, {type:"embed"})` or a malformed header
   therefore can no longer shift which placeholder is dropped.
   Decode cost: the parser reports `htmlComplete` (closing quote confirmed by a following character). The adapter
   keeps a per-call cache (`${sessionId}:${toolCallId}` -> parser + index -> completed html), passes it as
   `completedHtml` so closed strings are never re-decoded, never decodes applied headers
   (`decodeFromOffset = boundary`), and drops the entry on abandon, session clear, or once the store reports the
   call finalized (the handler finalizes directly).
4. **DOM layer** (new `src/components/canvas/StreamingEmbedPreviewLayer.tsx`, rendered next to
   `EmbedLayer`'s hosts inside the same `data-embed-layer` container so it shares z-order and pan/zoom
   math; hidden in outline render mode and in present mode; no per-node gating because streaming roots
   have no ancestors): one host per pending screen with html, positioned via `embedScreenRect` + viewport
   store. The first update mounts into a shadow root with the SAME pipeline as `EmbedHost`
   (`applyEmbedInheritedDefaults` + `mountHtmlWithBodyStyles` — sanitization included, the html is untrusted)
   plus editor variables. Later updates (throttled ~120 ms trailing, skipped when html/size are unchanged)
   build the new tree off-DOM with the same pipeline (variables applied to it too, so the synthetic
   `<body>` root's style attribute matches) and **morph** the live tree toward it (`morphDom.ts`): same
   node type+tag keeps the live node and syncs only differing attributes (an unchanged `src` is never
   rewritten, so img/iframe/video never reload), text/comment `data` and `<style>` text update in place,
   otherwise the node is replaced; extra new children are appended, surplus live ones removed. The morph
   returns the outermost inserted elements; only those get the reveal — a Web Animations call
   (`el.animate` opacity 0 -> 1, translateY 6px -> 0, blur 4px -> 0, 420 ms; no attribute, stylesheet rule
   or inline delay, so design CSS neither conflicts with nor cancels it). Nodes persist, so no resume
   bookkeeping exists. Skipped under `prefers-reduced-motion` and when `el.animate` is missing.
   The "writing head" (thin accent shimmer at the bottom edge of the frontier) is a light-DOM sibling of the
   shadow host, inline-styled and scaled like the content, shimmer via WAAPI — untrusted design CSS in the
   shadow root cannot restyle it; the shadow root holds design content only.
   The frontier (`measureFrontier.ts`) is the bottom of the last visible leaf whose whole ancestor chain up to
   the mount root is in flow (a leaf inside an absolute/fixed/sticky ancestor is skipped); computed-style
   verdicts are cached per ancestor within one measurement. `pointer-events: none`.
   Not a scene node: nothing enters history, the `.pen`, or selection.
5. Lifecycle is inherited from the existing store: finalize on handler `finally`, abandon, session clear.

## Out of scope
`U(id, {htmlContent})` on an existing embed (edit_embed_html already streams real mutations).
