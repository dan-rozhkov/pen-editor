# 3D Layer View — Design

**Date:** 2026-07-11
**Status:** Approved, ready for implementation plan
**Repo:** `pen-editor/` (frontend)

## Summary

Add a read-only **3D layer view** to the canvas: a toggle that "explodes" the
currently-selected frame's subtree along the Z-axis so each node floats on its
own plane in perspective, letting the user inspect layer stacking and nesting —
and looking genuinely good doing it. Inspection-first, but polished.

Reference: the DevTools/Cursor-style "3D layers" inspector — a wireframe-ish
exploded stack of layers in perspective, some planes showing real content.

## Goals

- Explode a frame's descendants into perspective-stacked planes (paint order → depth).
- Each plane shows a **real pixel snapshot** of that node for high fidelity.
- **Orbit** (drag-rotate) + **zoom** the stack.
- **Hover-highlight** individual planes.
- **Adjust explode spacing** via a slider.
- Zero new dependencies — CSS 3D transforms + Pixi `extract`.

## Non-Goals (YAGNI)

- No click-to-select / editing from the 3D view (read-only visualization).
- No breadcrumb or per-plane property panel sync.
- No persistence of 3D state across reload.
- No three.js / WebGL 3D scene.
- Not driven through `editorModeStore` — it's a transient overlay, not an edit mode.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Purpose | Both — inspection-first, but must look good |
| Per-plane rendering | Real pixel snapshots via Pixi `renderer.extract` |
| Scope | Selected frame's subtree (fallback: frame under viewport center) |
| Depth mapping | Paint order — each node gets a unique Z slot |
| Interactions | Orbit/rotate, hover-highlight, spacing slider (NO click-to-select) |
| Rendering tech | CSS 3D DOM overlay (Approach 1) |

## Architecture

### State — `src/store/layers3dStore.ts` (new)

Separate Zustand store; kept out of `editorModeStore` because it's a transient
visualization overlay, not an editing mode.

```ts
interface Plane {
  nodeId: string;
  depthIndex: number;          // paint-order index → Z depth
  rect: { x: number; y: number; width: number; height: number }; // absolute
  imageUrl: string;            // object-URL of the snapshot PNG
  opacity: number;
  cornerRadius: number;
}

interface Layers3DState {
  active: boolean;
  rotateX: number;             // deg, drag-driven, clamped ±60
  rotateY: number;             // deg, drag-driven, clamped ±60
  spacing: number;             // px Z-gap per depth step, slider-driven
  zoom: number;                // scene scale, wheel-driven
  hoveredPlaneId: string | null;
  planes: Plane[];
  targetFrameId: string | null;

  enter: (frameId: string) => Promise<void>;  // captures + populates planes
  exit: () => void;                            // revokes object-URLs, clears
  setRotation: (x: number, y: number) => void;
  setSpacing: (px: number) => void;
  setZoom: (z: number) => void;
  setHovered: (id: string | null) => void;
}
```

- **Default view angle** on enter: `rotateX 8`, `rotateY -24`, so it reads 3D
  immediately.
- **Default spacing:** ~40px; slider range ~[8, 160].
- `exit()` MUST `URL.revokeObjectURL` every `imageUrl` to avoid blob leaks.

### Entry logic

- Target frame = the selected top-level/nearest frame; else the frame under
  viewport center (reuse existing viewport→node helpers). If no frame resolvable,
  the "3D" toggle is **disabled** with a tooltip ("Select a frame to view in 3D").
- While `active`: hide the Pixi canvas and its DOM overlays (embeds, selection,
  measurement); the 3D overlay fills the canvas area.
- Exit on toggle click or **Esc**.

### Snapshot pipeline — `src/pixi/layers3d/captureLayers.ts` (new)

1. Walk the target frame's subtree in **paint order**, assigning a monotonic
   `depthIndex`. Skip non-independently-paintable nodes (pure layout refs) and
   zero-size / invisible nodes.
2. For each node, resolve its Pixi display object from the `pixiSync`
   `nodeId → Container` map. Call `renderer.extract.image()` / `.canvas()` →
   `toBlob` to get a PNG at device-pixel resolution, **capped at 2048px** on the
   long edge.
3. Read the node's absolute rect from `layoutStore` /
   `getNodeAbsolutePositionWithLayout`, plus `opacity` and `cornerRadius`.
4. Return `Plane[]`.

**Caps & policy:**
- Max **300 planes**; if the subtree exceeds it, take the first 300 in paint
  order and `log`/toast what was dropped (no silent truncation).
- Effects/blur are baked into the snapshot (we extract the rendered object).
- Clipped nodes are still captured on their own — floating free is the point.
- Capture runs once on `enter` (async, brief loading state); cached in the store.

### Overlay — `src/components/canvas/Layers3DOverlay.tsx` (new)

Mounted in `PixiCanvas.tsx`, rendered only when `active`.

```
<div class="scene" style="perspective: 1600px">           // fixed camera
  <div class="stack" style="transform: scale(zoom) rotateX(rx) rotateY(ry);
                            transform-style: preserve-3d">
    {planes.map(p =>
      <img class="plane" src={p.imageUrl} style="
        transform: translate3d(p.rect.x, p.rect.y, -p.depthIndex*spacing);
        width; height; border-radius; opacity" />)}
  </div>
</div>
```

- **Orbit:** pointer-drag on the scene updates `rotateY` (horizontal delta) /
  `rotateX` (vertical delta), clamped ±60°. Wheel adjusts `zoom`.
- **Hover:** `onPointerEnter` per plane → `hoveredPlaneId`; that plane gets a
  highlight outline + slight forward `translateZ` nudge + full opacity; others
  dim slightly.
- **Control bar** (bottom-center, existing UI tokens): spacing slider + "reset
  view" button. The **3D toggle** lives top-center in the canvas header area
  (like the reference).
- **Polish:** faint per-plane border + soft drop-shadow; subtle graduated
  background so depth reads. `prefers-reduced-motion` disables the enter
  transition.

## Data Flow

```
click "3D" toggle
  → resolve targetFrameId (selection / viewport center)
  → layers3dStore.enter(frameId)
      → captureLayers(frame): walk paint order → extract PNG per node → Plane[]
      → store { active:true, planes, default angle/spacing/zoom }
  → PixiCanvas hides Pixi + overlays, mounts Layers3DOverlay
  → user drags (rotate) / wheels (zoom) / hovers (highlight) / slides (spacing)
  → Esc / toggle → exit(): revoke object-URLs, clear planes, show Pixi again
```

## Error Handling

- `renderer.extract` failure on a node → skip that plane, keep going; if *all*
  fail, toast "Couldn't capture layers" and stay in 2D.
- Empty/childless frame → enter with just the frame plane (or disable toggle).
- Object-URL leaks prevented by `exit()` revocation and an unmount cleanup.

## Testing

Frontend Vitest (`src/**/__tests__/`, happy-dom):

- **`layers3dStore`** — `enter` populates planes with monotonic `depthIndex` in
  paint order; `exit` clears planes and calls `revokeObjectURL`; rotation clamps
  to ±60°; spacing/zoom setters clamp to range. Extraction is mocked (happy-dom
  has no WebGL — mirror the `get_screenshot` pattern; real extract is not
  unit-testable).
- **`captureLayers`** — paint-order walk + `depthIndex` assignment + skip rules
  + 300-plane cap, against a seeded scene (`resetStores`/`seedScene`), with
  `renderer.extract` mocked.
- **`Layers3DOverlay`** — renders one `<img>` per plane with the expected
  `translate3d` transform; hover sets `hoveredPlaneId`; disabled-toggle path.
- The real extract + WebGL path is **not** unit-testable — cover the
  enter→overlay→exit smoke path in Playwright e2e if feasible, else leave to
  manual verification (same posture as `get_screenshot`).

## Files

New:
- `src/store/layers3dStore.ts`
- `src/pixi/layers3d/captureLayers.ts`
- `src/components/canvas/Layers3DOverlay.tsx`
- control-bar / toggle-button component(s) as needed
- `__tests__` for the store, capture, and overlay

Modified:
- `src/pixi/PixiCanvas.tsx` — mount overlay, hide Pixi + overlays when active,
  Esc handling
- canvas header — add the "3D" toggle
- possibly `pixiSync` — expose the `nodeId → Container` map for capture if not
  already accessible

## Open follow-ups (post-v1)

- Optional click-to-select write-back into selection/breadcrumb.
- Snapshot re-capture on scene edit (v1 is a one-shot snapshot; edits require
  re-entering).
- Export the 3D view as an image/GIF for portfolio use.
