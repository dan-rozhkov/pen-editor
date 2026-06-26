# Code Layers as a DOM Overlay (instead of Pixi textures)

**Date:** 2026-06-27
**Status:** Approved (brainstorming)

## Problem

Embed nodes (`type: "embed"`, "code layers") are currently rendered on the
canvas by rasterizing their `htmlContent` into a PixiJS texture
(`src/pixi/renderers/embedRenderer.ts` → `renderHtmlToTexture`). This path goes
through SVG `foreignObject`, which is heavyweight, blurs fonts/subpixels, needs
resolution upgrades on zoom, and is far from "what the browser actually renders".

We want to render code layers with **real browser DOM**, in an isolated sandbox,
positioned and zoomed in lockstep with the canvas, and **always drawn on top** of
the other canvas elements.

## Scope

**In scope (v1):** move on-screen rendering of existing `htmlContent` embeds from
Pixi textures to a per-embed DOM overlay (Shadow DOM), synced to viewport, always
on top, with a click-to-interact model.

**Out of scope (designed for, not built now):**
- Live React/TSX code layers (transpile + render TSX source). The layer is
  designed so a TSX renderer can be plugged into the same per-embed host later.
- Embeds rendered inside component instances (`ref` nodes).
- `get_screenshot` / export including embeds.
- Clipping embeds by an ancestor frame's `overflow: hidden`.

## Decisions (from brainstorming)

1. **Isolation:** per-embed **Shadow DOM** (not iframe, not a single shared
   iframe). Reuses `mountHtmlWithBodyStyles`, `buildVariableStyleBlock` (theme CSS
   vars), and `fontLoading`. Lighter than iframe and TSX-ready (React renders into
   a shadow root). A true JS sandbox (iframe) remains a per-embed extension point
   for the future.
2. **Always on top:** the DOM layer sits above the Pixi `<canvas>` via z-index, so
   embeds visually cover overlapping canvas nodes regardless of scene z-order.
   This is an accepted, explicit requirement.
3. **Interaction model:** click-to-interact.
   - Default: embed host `pointer-events: none` → all selection/drag/marquee/pan
     pass through to the Pixi canvas; the embed node selects and moves exactly as
     today (the scene node still exists for hit-testing).
   - Double-click → embed becomes **active**: `pointer-events: auto`, so native
     interactivity (scroll, links, forms, `:hover`) works. `Esc`, click-outside,
     or selecting another node exits the active state.
4. **Gesture reconciliation:** double-click currently triggers
   `editingMode="embed"` (contenteditable text editing via `InlineEmbedEditor`).
   Going forward, **double-click = enter interactive/active state**, and
   **contenteditable text editing moves to a button in `EmbedActionBar`**. Both
   capabilities remain; they stop sharing the double-click gesture.
5. **Screenshots:** `get_screenshot`/export omit code layers for now (separate
   task). The texture pipeline (`renderHtmlToTexture`) stays in the repo for that
   future use but is removed from the live render path.

## Architecture

### Layer mounting

A new React component `EmbedLayer` is mounted inside the `PixiCanvas` container
(`<div data-canvas>` is already `position: relative`), as a sibling of the Pixi
`<canvas>` with a higher `z-index`. It is a single overlay that renders one host
element per embed node.

The existing DOM overlays inside that container (`EmbedActionBar`,
`InlineTextEditor`, `InlineEmbedEditor`, `InlineNameEditor`) already establish the
pattern of absolutely-positioned, viewport-synced DOM over the canvas;
`EmbedLayer` generalizes `InlineEmbedEditor`'s shadow-DOM mounting to *all*
embeds, *all the time*.

### Per-embed host

For each embed node, `EmbedLayer` maintains a host `<div>` with an attached
shadow root. Content is mounted via the existing helpers:

- `mountHtmlWithBodyStyles(container, htmlContent, width, height)` — carries body
  styles, returns the mount root.
- `buildVariableStyleBlock(undefined, effectiveTheme)` — injects theme CSS
  variables. Effective theme is resolved by walking ancestor frames
  (`getEffectiveThemeForNode`, already implemented in `embedRenderer.ts`; extract
  to a shared util).
- Font loading reuses `fontLoading.ts`.

Inner content renders at natural size; the host applies
`transform: scale(viewportScale); transform-origin: top left` (mirrors
`InlineEmbedEditor`).

### Positioning & zoom sync

Per embed, world rect comes from `layoutStore` (absolute rect) /
`getNodeAbsolutePositionWithLayout`. Screen position:

```
screenX = absX * scale + panX
screenY = absY * scale + panY
```

(rounded to device pixels, as in `InlineEmbedEditor.tsx:108-110`).

**Performance:** pan/zoom changes are applied **imperatively** — `EmbedLayer`
subscribes to `viewportStore` (like `setupPixiViewport`) and mutates each host's
`transform`/position directly via refs, *without* a React re-render. React
re-renders only when the *set* of embeds, their `htmlContent`, size, or theme
changes (driven by `sceneStore`/`layoutStore` subscriptions). This keeps
panning/zooming smooth with many embeds.

### Removing the texture path

- `syncNodeTree`/`embedRenderer`: embed nodes no longer create or update a sprite
  texture for live rendering. The embed keeps a minimal (empty/transparent) Pixi
  container so hit-testing, selection outlines/handles, drag, and smart guides
  keep working against the real scene node.
- The "hide embed texture while editing" branch in `syncNodeTree.ts` (the
  `isEmbedEditing` visibility logic) becomes unconditional for embeds (there is no
  texture to show/hide anymore).
- `renderHtmlToTexture` and `htmlTexture/*` remain in the tree for the future
  screenshot path but are no longer called from the live render loop.

### Active (interactive) state

Introduce an `activeEmbedId` concept (single active embed at a time). Source of
truth: a small piece of state (e.g. in `selectionStore` or a dedicated store).

- Double-click on an embed (in `pixiInteractionCore` dblclick handling, replacing
  the current `startEditing(id, "embed")`) sets `activeEmbedId`.
- `EmbedLayer` sets `pointer-events: auto` only on the active host; all others
  stay `none`.
- Exit on `Esc`, click-outside, or selecting a different node.
- `EmbedActionBar` gains an explicit "Edit text" button that triggers the old
  `startEditing(id, "embed")` contenteditable flow.

## Components & responsibilities

| Unit | Responsibility | Depends on |
|---|---|---|
| `EmbedLayer` (new) | Render/maintain one shadow-DOM host per embed; impose z-order on top; toggle `pointer-events` for the active embed | `sceneStore`, `layoutStore`, `viewportStore`, active-embed state, embed mount utils |
| embed mount util (extracted) | Mount `htmlContent` into a shadow root with theme vars + body styles + fonts | `embedHtmlUtils`, `variableCssUtils`, `fontLoading` |
| `syncNodeTree`/`embedRenderer` (changed) | Stop producing live embed textures; keep an invisible hit-test container | Pixi |
| `pixiInteractionCore` (changed) | Double-click sets `activeEmbedId` instead of `startEditing(embed)` | active-embed state |
| `EmbedActionBar` (changed) | Add "Edit text" button → `startEditing(id,"embed")` | selectionStore |

## Data flow

1. `sceneStore`/`layoutStore` change → `EmbedLayer` reconciles its host set and
   (re)mounts content for added/changed embeds.
2. `viewportStore` change → `EmbedLayer` imperatively updates each host's screen
   position and `scale` (no React render).
3. Pointer events: by default pass through to Pixi (`pointer-events: none`) →
   existing selection/drag. Double-click → `activeEmbedId` set → that host becomes
   interactive.
4. Pixi still renders selection outline/handles for the embed node (it remains in
   the scene); the action bar and handles render above via their own overlays.

## Error handling

- Invalid/zero-size embeds: skip host rendering (guard like
  `renderAndApply`'s finite/size checks).
- Strict-mode double mount: reuse an existing shadow root if present (as
  `InlineEmbedEditor` does).
- Host cleanup on node removal/unmount: detach shadow content, drop refs.

## Testing

- **Unit (Vitest + happy-dom, no Pixi):**
  - screen-coordinate math from `world + pan + scale`.
  - host set stays in sync with the embed nodes in `sceneStore` (add/remove).
  - `pointer-events` toggles to `auto` only for `activeEmbedId`.
  - content re-mounts when `htmlContent`/size/theme changes.
- **E2E (Playwright):** add an embed → its DOM host appears over the canvas;
  select & drag moves the node; double-click makes it active and scrollable;
  `Esc`/click-outside deactivates.

## Open follow-ups (tracked, not built)

- TSX/React live code layers reusing the per-embed host.
- Embeds inside component instances (`ref`).
- `get_screenshot`/export including embeds (reuse retained texture path).
- Ancestor-frame clipping for embeds.
