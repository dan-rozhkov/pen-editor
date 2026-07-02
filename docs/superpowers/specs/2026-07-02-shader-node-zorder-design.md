# Design: Shader nodes that respect scene z-order (render shaders inside Pixi)

Date: 2026-07-02
Status: Approved (design), pending implementation plan
Scope: Frontend only (`pen-editor/`). No backend/AI-tool changes.

## Problem

A node with a shader (`node.shader: ShaderConfig`) currently always paints **on top of
everything**, regardless of its position in the scene graph. Users cannot place a
shader-enabled node **under** other nodes or **between** them.

### Root cause

Shaders are not rendered by PixiJS. They are rendered by a flat DOM overlay,
`src/components/canvas/ShaderLayer.tsx`, an absolutely-positioned container at
`zIndex: 9` that sits **above the single PixiJS `<canvas>`**. Inside it, one
`ShaderHost` div per shader-node is positioned via `useOverlayHostRect`, but hosts
carry no per-node `zIndex` and the layer iterates `Object.keys(nodesById)` order —
so scene-graph order (`rootIds` / `childrenById`) is ignored entirely.

Because PixiJS is one canvas element, DOM content cannot be interleaved between Pixi
nodes without splitting into multiple canvases/DOM tiers (fragile). The industry-standard
answer is to render the effect **inside the single WebGL scene** so z-order is inherent.
`EmbedLayer.tsx` (`zIndex: 10`) has the same limitation but is out of scope here.

## Decision

**Render shader output inside the node's PixiJS container as a sprite-texture**, replacing
the DOM overlay. Once the shader is a texture on the node's container, the node is an
ordinary participant in the scene tree and z-order ("under" / "between") works
automatically for all node types and all shader kinds — no special z-order code.

Animation is dropped in v1: shaders are baked as a **static frame** using the
`@paper-design/shaders-react` `speed: 0` prop (which stops the rAF loop entirely).
This removes the only expensive constraint (per-frame texture re-upload).

### Rejected alternatives

- **Hybrid opt-in** (keep DOM overlay for animated "top", bake only when covered): two
  code paths, "is-this-node-covered" detection, extra state. Its only benefit is
  preserving animation, which the user chose to drop. Not worth the complexity.
- **Multiple stacked canvases / DOM z-tiers**: brittle with a single Pixi canvas; the
  industry trend is away from this toward a single WebGL layer.

## Architecture

### Component 1 — `shaderRaster` service
File: `src/lib/shaders/shaderRaster.ts`

- Input: `ShaderConfig`, `width`, `height`, optional `baseImage` (data URL, for
  image-filter shaders).
- Renders the shader offscreen at `width × height × devicePixelRatio`, forcing
  `speed: 0`, captures **one frame**, returns a PixiJS `Texture` (async;
  `Texture.from({ resource: canvas, resolution: dpr })`).
- Render mechanism, in preference order:
  1. **Core imperative API** — if `@paper-design/shaders` (the non-React core the
     `-react` package wraps) exposes an imperative mount that renders params into a
     supplied canvas, use it (no React). Confirm availability in the plan's spike.
  2. **Fallback: offscreen React mount** — mount the registry `Component` with
     `buildShaderProps(cfg)` + `speed: 0` into a detached/hidden root, wait a couple of
     `requestAnimationFrame`s for the WebGL draw, then capture its `<canvas>`. Mirrors
     the `renderers/htmlTexture/` offscreen-render approach.
- Capture must be robust against WebGL buffer clearing: capture inside a rAF callback,
  and if needed draw the WebGL canvas onto a 2D canvas before `Texture.from`.
- Caches results keyed by `(kind, JSON(params), width, height, baseImageHash)`.

### Component 2 — `shaderFillHelpers`
File: `src/pixi/renderers/shaderFillHelpers.ts` (mirror of `imageFillHelpers.ts`)

- `applyShaderFill(container, node)`: starts the async raster; on resolve, creates a
  `Sprite`, inserts it **above the background graphic and any image-fill sprite, below
  child nodes** (reuse the insertion logic from `imageFillHelpers.addImageSprite`), and
  applies a mask matching the node shape (corner radius / ellipse — reuse
  `drawRoundedShape`).
- `destroyShaderFill(container)`: removes sprite + mask, destroys the texture with
  `.destroy(false)`.
- Tracks applied state per container (like `appliedImageFillByContainer`) to avoid
  redundant rebakes.
- **Race guard**: a generation token per container; a resolved raster is discarded if the
  node changed or the container was destroyed while it was in flight.

### Component 3 — Single call site
File: `src/pixi/renderers/index.ts` (`createNodeContainer` / `updateNodeContainer`)

Call `applyShaderFill` for any node type, adjacent to the existing `applyImageFills`
call, so all node types gain shader-in-Pixi uniformly without editing each renderer.

### Component 4 — Invalidation
File: `src/pixi/pixiSync.ts` (existing reference-equality change detection)

Re-bake when `node.shader !== prev.shader` or `width`/`height` changed. For image-filter
shaders (`category === "image"`), the base image is obtained via existing
`extractNodeImage` (`nodeRaster.ts`) — extract the base render **before** the shader
sprite is added (avoid feedback). A `shouldRebake(node, prev)` pure helper encapsulates
the decision.

### Component 5 — Remove the DOM overlay
- Delete `src/components/canvas/ShaderLayer.tsx` and its mount in `PixiCanvas.tsx`.
- Keep `src/lib/shaders/registry.ts`, `buildShaderProps.ts`, and `nodeRaster.ts`.

## Data flow

```
edit → new node object in sceneStore
     → pixiSync.incrementalUpdate detects node !== prev
     → updateNodeContainer → applyShaderFill(container, node)
     → shaderRaster.rasterize(config, w, h, baseImage?)   [offscreen → capture → Texture]
     → on resolve (if generation still current):
         create/replace Sprite in container at fill index + apply shape mask
     → node renders in Pixi at its natural scene-tree z-order
```

## Error handling

- Raster failure (WebGL context lost, capture returns null): no sprite added; node renders
  without the shader (graceful degradation), matching today's behavior when a shader can't
  render.
- Node changed/deleted mid-raster: generation guard discards the stale result; texture is
  destroyed to avoid a GPU leak.
- Container destroyed: `destroyShaderFill` cleans up sprite, mask, and texture.

## Testing

- **Unit (Vitest + happy-dom; no WebGL):** pure logic only —
  - `shaderFillHelpers`: sprite insertion index (above bg/image-fill, below children),
    mask creation for corner-radius vs ellipse, `destroyShaderFill` cleanup. Model on the
    existing `imageFillHelpers` tests, using a stub `Texture`.
  - `shouldRebake`: rebakes on shader change and size change; no rebake otherwise.
- **Not unit-testable:** `shaderRaster` (needs WebGL, like `get_screenshot`). Covered by
  manual verification and, if practical, a light e2e assertion.
- **E2E (Playwright):** place a rect with a fill shader plus a rect above it in z-order;
  assert the shader renders as a Pixi sprite inside the node container and that no
  `ShaderLayer` DOM host exists. Visual stacking is verified manually.
- **Contract test:** `toolContract.test.ts` is unaffected — no backend tool names change.

## Scope

**In scope (v1):** static bake of all shader kinds into Pixi; z-order "under"/"between"
for all node types; removal of the DOM `ShaderLayer`.

**Out of scope (v2):** live animation in-layer (a throttled ticker on top of this same
architecture); image-filter rebake when the node's own *content* changes (v1 rebakes on
size + shader-config change only — a known limitation); AI tool + shader export (already
deferred).

## Primary risk

Reliably capturing a frame from the `@paper-design/shaders` WebGL canvas into a Pixi
texture (`preserveDrawingBuffer` / rAF timing). The **first step of the implementation
plan is a spike**: confirm whether the core package offers imperative rendering, and
validate capture on a single shader before building the rest.
