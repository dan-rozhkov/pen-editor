# Pixi rendering performance for large documents

**Date:** 2026-07-17
**Status:** Draft — awaiting user review
**Repo:** `pen-editor` (frontend only — no backend, no AI tool)
**Related:** `2026-07-17-properties-panel-render-optimization-design.md` (React
panel side of the same symptom; this spec covers the canvas/Pixi side)

## Problem

Documents with many layers lag during drag, pan/zoom, and selection. Profiling
the code (not speculation) shows the per-node rendering layer is already
well-gated — Graphics re-tessellate only on prop change, render-on-demand
replaces the free-running ticker, the viewport is a render group, culling and
text-resolution scaling exist. The lag comes from **O(N)-in-document-size work
on hot paths**, paid per frame or per interaction regardless of how little
changed:

1. **O(N) scene diff per store change.** `pixiSync.ts` `incrementalUpdate`
   iterates every key of `nodesById` (and of the previous map) several times
   per flush (`pixiSync.ts:209,227,234,246,270,299`) to find what changed.
   Reference-equality gates the real work, but the scan itself is linear.
2. **O(N) node-map copy per drag frame.** `dragController.ts:187` spreads the
   entire `nodesById` into a new object on every pointermove. Combined with
   (1), dragging one node costs two O(N) passes per frame.
3. **O(N) per selection change.** `applyTextEditingVisibility`
   (`syncNodeTree.ts:69`) walks the entire container registry on every
   selection/editor-mode change (`pixiSync.ts:632,643`).
4. **Culling recomputes from scratch on every pan/zoom frame.**
   `computeViewportRenderability` (`viewportCulling.ts:82`) allocates a fresh
   `Map` and re-walks the whole tree per call; rotated nodes are never culled
   (`viewportCulling.ts:100`).
5. **`PixiCanvas` React re-renders on every scene mutation** — it subscribes
   to `nodesById` wholesale (`PixiCanvas.tsx:59`), so every drag frame runs
   React reconciliation plus several `useMemo`s.
6. **No raster caching of static content.** `cacheAsTexture` is globally
   disabled (`frameRenderer.ts:215`, disabled after stale-visual bugs on
   reparent/move), so the GPU re-renders every visible node on every paint.
7. **Display-object explosion for text**: text-on-path and per-line rendering
   create one canvas-rasterized `Text` object per glyph/line
   (`textRenderer.ts:322,465-487`).

## What Figma does (research summary)

Confirmed by Figma's own engineering posts (sources at the end):

- A custom C++/WASM retained-mode, GPU-only, **tile-based renderer**: stable
  regions are rasterized and re-composited from tiles; pan/zoom does not
  re-tessellate vectors. Tile mechanics are not public; the principle —
  *raster-cache stable regions, invalidate at known granularity* — is.
- **Time-slicing with priority for local interactive edits** over remote /
  batch changes ("Keeping Figma fast").
- **Incremental document loading**: only the current screen + reachable frames
  are instantiated; the rest stays data-only ("Incremental frame loading").
- **Perf regression CI**: stress documents with thousands of layers, frame-time
  benchmarks on every commit.
- Their custom WASM core, GPU glyph rendering, and WebGPU plumbing are *not*
  worth porting — PixiJS v8 already provides retained mode, batching, and a
  WebGPU backend. Comparable web editors get their scaling wins from culling +
  raster caching: tldraw renders ~50 of 10,000 shapes via an R-tree index;
  Excalidraw splits a cached static canvas from the interactive one.

The mapping is direct: our hot paths are exactly the places where Figma-style
principles (touch only what changed; index space instead of walking the tree;
cache raster output with disciplined invalidation) apply.

## Goals

- Smooth drag / pan / zoom / selection on documents with thousands of nodes.
- **No loss of functionality or visual correctness.** Any caching must have
  explicit invalidation rules and a kill switch; anything that risks stale
  visuals ships behind a flag and a test.
- Keep responsiveness: no added input latency, no deferred visual feedback for
  the node being manipulated.

## Non-goals

- No renderer rewrite (no custom WASM/WebGPU work, no custom glyph shaders).
- No changes to the `.pen` format or the tool contract with the backend.
- Properties-panel React work — covered by the sibling spec.
- Incremental *network* loading (documents load fully today; lazy display-object
  instantiation is a later phase here, data loading is untouched).

## Approaches considered

**A. Algorithmic only (dirty-sets + spatial index), no raster caching.**
Fixes all O(N) hot paths and culling; zero risk of stale visuals. Likely
sufficient up to mid-size documents, but every visible node is still GPU-drawn
each paint — very large static scenes keep a high per-frame draw cost.

**B. A + disciplined raster caching of stable frames (recommended).**
Everything in A, then `cacheAsTexture` on top-level frames that are not being
edited, with explicit invalidation rules — the portable version of Figma's
tiles. Addresses the remaining per-paint cost. The stale-artifact history is an
invalidation-discipline problem, not a reason to avoid caching; it gets a flag,
tests, and staged rollout.

**C. Full tile renderer (viewport-aligned tile cache like Figma's).**
Maximum ceiling, but a rendering-architecture project of its own, high risk to
correctness, and unjustified before A+B are exhausted.

**Chosen: B, executed in phases where A ships first and stands alone.** Each
phase is independently landable and measurable; later phases only start if the
perf harness says they're still needed.

## Design

### Phase 0 — Measure first (prerequisite, small)

- A dev-only synthetic document generator (e.g. `?perf=5000` in dev mode):
  N frames × M children with mixed node types, text, and a few effects.
- Frame-time instrumentation around the render scheduler and `incrementalUpdate`
  (dev-mode `performance.mark`/`measure`; a simple on-screen ms/frame readout).
- A Playwright perf smoke (non-blocking job initially): load the synthetic doc,
  script drag/pan/zoom via CDP, assert frame-time budgets. This is Figma's
  "Keeping Figma fast" practice scaled to our CI.

Every later phase must show its win on this harness before merging.

### Phase 1 — Remove O(N) from hot paths (algorithmic, no caching, no visual risk)

**1.1 Dirty-set diffing in `pixiSync`.** Scene-store mutators already know
which ids they touch. Add a transient `dirtyNodeIds: Set<string>` channel
(populated by `updateNode`/`setState` helpers, cleared per flush).
`incrementalUpdate` consumes the set and falls back to the current full scan
only when the set is absent (external/unknown mutations), so correctness never
regresses. Adds/removes come from diffing only `rootIds`/`childrenById` entries
whose references changed.

**1.2 Drag fast-path.** Stop spreading `nodesById` per pointermove. Two-tier:
- During drag, write positions through a transient path — the same pattern
  `autoLayoutDragAnimator` already uses: set `container.position` directly,
  `requestCanvasRender()`, keep a small `draggedPositions` map.
- Commit to the store once per rAF (coalesced) or on pointerup, whichever
  testing shows is needed for dependent features (guides, auto-layout preview,
  panel readouts). History already writes only on pointerup.

**1.3 Targeted `applyTextEditingVisibility`.** Track which node ids the
previous call affected; on selection change, visit only
`previouslyAffected ∪ newlyAffected` instead of the whole registry.

**1.4 `PixiCanvas` narrow subscriptions.** Replace the wholesale `nodesById`
subscription with selectors for exactly what its memos need (selected/editing
node lookups), mirroring the approach of the properties-panel spec.

### Phase 2 — Spatial-index culling

- Maintain a spatial index (uniform grid first — simpler and likely enough;
  R-tree only if the harness shows grid hotspots) over the absolute rects the
  layout engine already computes. Update entries incrementally from the same
  dirty-set as 1.1.
- Pan/zoom culling becomes a viewport query against the index instead of a
  full-tree walk with a fresh `Map` per frame (`viewportCulling.ts:82`).
- Rotated nodes get culled by the AABB of their rotated bounds (fixes the
  "never culled" hole at `viewportCulling.ts:100`).
- The same query gates hit-testing (`hitTesting.ts` currently walks the whole
  tree back-to-front) — point queries return candidates only.
- Keep the existing `CULL_MARGIN` and overview-scale effect suppression; only
  the *computation* changes, not the policy.

### Phase 3 — Disciplined raster caching of stable frames

The portable analogue of Figma's tiles, and the direct answer to "не
кэшировать бездумно": caching is **opt-in per subtree, rule-driven, flagged,
and tested** — not a global toggle.

- Unit of caching: top-level frames (bounded, semantically stable regions).
- A frame is *cacheable* when: no node in its subtree changed for K frames
  (use the dirty-set from 1.1 — we now know this cheaply), it is not part of
  the current selection/drag/text-edit, its pixel size at current zoom is
  under the texture limit (4096px), and it has no live embed overlay quirks.
- Explicit invalidation (this is what was missing when `cacheAsTexture` was
  disabled at `frameRenderer.ts:215`): any dirty id inside the subtree, any
  reparent into/out of it, selection entering it, and zoom crossing a
  resolution breakpoint (re-cache at ~2× steps so cached frames never look
  blurry — the LOD flavor of tiling). Invalidation = drop cache immediately
  and render live; re-cache only after the frame is quiet again.
- Feature flag + dev toggle; a visual-correctness test suite (mutate inside a
  cached frame, reparent, undo, zoom) guards the exact bugs that got it
  disabled before.

### Phase 4 — Batching hygiene and text (cumulative small wins)

- Shared `GraphicsContext` for repeated identical shapes (component `ref`
  instances are the natural candidates).
- Collapse text-on-path / per-line `Text`-per-glyph into fewer objects (single
  `Text` per line where styling allows; `BitmapText` only where typography
  fidelity is provably unaffected — text quality is a functional requirement).
- Rect (scissor) masks over filter masks where equivalent; `filters = null`
  instead of `[]`; group blend modes to avoid batch breaks.

### Phase 5 — Only if the harness still shows gaps at extreme sizes

- **Time-slicing non-interactive mutations**: chunk AI `batch_design` bursts
  and initial document instantiation across frames/idle callbacks, pointer
  work always first (Figma's local-vs-remote prioritization).
- **Lazy display-object instantiation**: far-off-screen top-level frames stay
  data-only (no Pixi containers) until the viewport approaches — Figma's
  incremental-frame-loading analogue, built on the Phase 2 index.

## Error handling & correctness safety net

- Dirty-set path always has the full-scan fallback (1.1); a dev-mode assertion
  can diff both paths on demand to catch missed invalidations early.
- Raster caching ships behind a flag with a one-line kill switch and a visual
  regression test suite; any stale-visual report → flag off, no functional
  loss.
- Drag fast-path must keep guides/snapping/auto-layout preview working — the
  commit cadence (per-rAF vs pointerup) is decided by testing those features,
  not assumed.

## Testing

- Phase 0 harness is the acceptance gate for every phase (frame-time budgets
  on the synthetic doc for drag, pan, zoom, select).
- Existing unit tests for tool handlers/stores must stay green (behavioral
  invariance).
- New unit tests: dirty-set diff equivalence vs full scan; spatial-index
  query vs brute-force culling on randomized scenes; cache invalidation
  matrix (Phase 3).
- E2E smoke unchanged; add one perf smoke as non-blocking CI initially.

## Sources

- https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/
- https://www.figma.com/blog/keeping-figma-fast/
- https://medium.com/figma-design/figma-faster-d1947f9c26ca
- https://www.figma.com/blog/incremental-frame-loading/
- https://www.figma.com/blog/figma-rendering-powered-by-webgpu/
- https://medium.com/@evanwallace/easy-scalable-text-rendering-on-the-gpu-c3f4d782c5ac
- https://pixijs.com/8.x/guides/concepts/performance-tips
- https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture
- https://tldraw.dev/sdk-features/performance
- https://github.com/excalidraw/excalidraw/issues/10063
