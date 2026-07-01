# Shader Nodes & Applied Shaders — Design Spec

**Date:** 2026-07-01
**Status:** Approved for implementation
**Scope (frontend only):** `pen-editor/`

## Goal

Let users (a) add a "shader node" whose content is a live GLSL shader, and
(b) apply a shader to an existing node — both driven by the
[`@paper-design/shaders`](https://shaders.paper.design) library. Manual UI only
in v1 (no AI-agent tool).

## Decisions

- **Integration:** DOM overlay, reusing the existing embed Shadow-DOM pattern.
- **Apply scope:** both *fill shaders* (attached as a node background) **and**
  *image-filter shaders* (run over the node's rasterized content).
- **Shader set:** a curated ~12, each with presets + a few key editable params.
- **AI agent:** none in v1.

## Background (why DOM overlay)

Each `@paper-design/shaders-react` component renders a `<div>` that internally
creates **its own `<canvas>` + WebGL2 context and its own `requestAnimationFrame`
loop**. It cannot be injected into an existing WebGL context. The editor already
renders **embed nodes** as a Shadow-DOM/DOM overlay positioned over the Pixi
canvas (`src/components/canvas/EmbedLayer.tsx`), leaving the Pixi container empty
while hit-testing/selection/drag continue to operate on the real scene node. Paper
shaders fit this exact pattern, and their self-contained RAF loop means Pixi's
on-demand `renderScheduler` needs no change to support animation.

## Dependency

Add `@paper-design/shaders-react@0.0.76` (pinned — the library warns of breaking
changes across `0.0.x`). Peer-compatible with React 19 (editor uses React 19).

## Data model — one unified field

Add an optional field to `BaseNode` in `src/types/scene.ts`:

```ts
export type ShaderKind =
  | 'meshGradient' | 'waves' | 'warp' | 'spiral'
  | 'metaballs' | 'godRays' | 'voronoi' | 'dithering'   // fill shaders
  | 'water' | 'flutedGlass' | 'halftoneDots' | 'imageDithering' // image filters

export interface ShaderConfig {
  kind: ShaderKind
  preset?: string                                   // preset name from the library
  params: Record<string, number | string | string[]> // overridden props (colors, speed, scale, …)
}

// on BaseNode:
//   /** Live shader overlay (paper-design/shaders). Rendered by ShaderLayer. */
//   shader?: ShaderConfig
```

This single field powers both goals:

- **"Add a shader node"** — the toolbar creates a plain `rect` (default
  480×320, no fill/stroke) pre-loaded with a default *fill* shader. No new node
  type is added to the `SceneNode` union, which avoids touching the renderer
  dispatch, `drawController` union, the tool-name contract test, and `.pen`
  schema plumbing. It is "a node with a shader," satisfying the goal wording.
- **"Apply shader to existing node"** — set `.shader` on any existing
  rect / frame / ellipse / text / path node.

The **source image** for image-filter shaders is **not stored**; it is derived at
render time (see Rendering).

## Curated shader registry — `src/lib/shaders/registry.ts`

The single isolated unit that drives both the UI and the renderer. Maps each
curated `ShaderKind` to a descriptor:

```ts
interface ParamSchema {
  key: string                                  // React prop name on the component
  type: 'color' | 'colors' | 'number' | 'select'
  label: string
  min?: number; max?: number; step?: number    // for 'number'
  options?: string[]                            // for 'select'
  default: number | string | string[]
}

interface ShaderDescriptor {
  kind: ShaderKind
  label: string
  category: 'fill' | 'image'
  Component: React.FC<any>                      // e.g. MeshGradient
  presets: { name: string; params: Record<string, unknown> }[]
  params: ParamSchema[]                         // curated editable subset
}

export const SHADER_REGISTRY: Record<ShaderKind, ShaderDescriptor>
```

Curated set and their key params (verified against the v0.0.76 `.d.ts`/`.js`):

| kind | category | key params |
|------|----------|-----------|
| meshGradient | fill | colors[], speed, distortion, swirl |
| waves | fill | colorFront, colorBack, frequency, amplitude, softness, scale |
| warp | fill | colors[], speed, rotation, scale, distortion, swirl, softness |
| spiral | fill | colorFront, colorBack, density, distortion, speed, scale |
| metaballs | fill | colors[], colorBack, speed, scale (count via size) |
| godRays | fill | colors[], colorBack, speed, density, intensity |
| voronoi | fill | colors[], speed, scale, distortion |
| dithering | fill | colorFront, colorBack, speed, scale, type |
| water | image | (image), speed, scale, highlights |
| flutedGlass | image | (image), distortion, scale, speed |
| halftoneDots | image | (image), colorFront, colorBack, type, speed |
| imageDithering | image | (image), colorFront, colorBack, type, scale |

Colors are stored as hex strings; `colors` is a string array. Presets are taken
from the library's exported `*Presets`. `Component` references the library's React
component. The default preset for a kind resolves to `presets[0]`.

## Rendering — `src/components/canvas/ShaderLayer.tsx`

Mirrors `EmbedLayer.tsx`. `ShaderLayer` subscribes to the scene store and renders
a `ShaderHost` for each node whose `.shader` is set. Each `ShaderHost`:

- positions/scales a `position:absolute` div over the node's screen rect using the
  existing `getNodeAbsolutePositionWithLayout` + `embedScreenRect` helpers, and
  subscribes to viewport / layout / scene stores for live sync (same imperative
  approach as `EmbedHost` — no React re-render on pan/zoom);
- sets `pointerEvents: 'none'` so canvas select/drag still hit the Pixi node
  beneath;
- clips to the node's shape: `border-radius` from rect `cornerRadius`, `50%` for
  ellipse, `clip-path: path(geometry)` for path nodes;
- renders the registry descriptor's `Component` at `width:'100%' height:'100%'`
  with props built from `ShaderConfig` (preset params merged with overrides).
  Paper's own RAF loop animates it.

**Image-filter shaders (`category:'image'`):** obtain the node's Pixi container
from pixiSync's registry and produce a data URL via
`app.renderer.extract.base64(container)`; pass it as the component's `image` prop.
Re-extract when the node's size or visual content changes. The opaque shader
canvas covers the original node. A small module `src/lib/shaders/nodeRaster.ts`
encapsulates the extract call and exposes the Pixi app/registry access needed
(added to the pixiSync surface).

## UI

**Properties panel** — new `src/components/properties/ShaderSection.tsx`, added to
`PropertyEditor` (`src/components/PropertiesPanel.tsx`). Contents:

- enable/disable toggle (adds/removes `.shader`);
- shader picker (dropdown over `SHADER_REGISTRY`, grouped by category);
- preset picker (the selected kind's presets);
- auto-generated controls from the descriptor's `params` (color pickers for
  `color`/`colors`, sliders for `number`, dropdowns for `select`).

Store mutations in `sceneStore` (history-tracked): `setNodeShader(id, config)`
and `clearNodeShader(id)`.

**Toolbar** — add a `"shader"` tool to `src/store/drawModeStore.ts` and a button
to `src/components/PrimitivesPanel.tsx`. `src/pixi/interaction/drawController.ts`
creates a rect-with-default-shader on drag-to-size (like the rect tool), using the
default fill shader (meshGradient, first preset).

## Serialization & export

`.pen` JSON carries `.shader` automatically. **Out of scope for v1:** HTML export
(`designToHtml`) rendering shaders, and Pixi screenshot/export capturing them —
exactly the current limitation for embed nodes. Tracked as a follow-up.

## Testing

- **Unit (Vitest + happy-dom):**
  - registry integrity — every `ShaderKind` has a `Component`, ≥1 preset, a
    resolvable default preset, and a valid `params` schema;
  - param→props mapping — merging preset + overrides yields the expected prop
    object;
  - store mutations — `setNodeShader` / `clearNodeShader` against a real store
    (via `resetStores()` / `seedScene()`), including history.
- **Not unit-testable (no WebGL in happy-dom):** `ShaderLayer` rendering and
  node→image extraction — covered manually / e2e, the same exclusion documented
  for `get_screenshot`.

## Isolation summary

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `ShaderConfig` type | serializable shader description | — |
| `shaders/registry.ts` | curated kinds → component + presets + param schema | library |
| `shaders/nodeRaster.ts` | node → data-URL for image filters | pixiSync/Pixi |
| `ShaderLayer.tsx` | DOM overlay lifecycle + positioning | registry, stores |
| `ShaderSection.tsx` | properties UI generated from registry | registry, store |
| `sceneStore` mutations | set/clear `.shader` with history | — |
| toolbar / drawController | create shader node | drawModeStore |

## Out of scope (v1)

- AI-agent shader tool (backend `penTools` + frontend handler).
- HTML export and Pixi screenshot capture of shaders.
- Per-uniform full control surface (only curated params).
- Shaders on group/connector/line nodes.
