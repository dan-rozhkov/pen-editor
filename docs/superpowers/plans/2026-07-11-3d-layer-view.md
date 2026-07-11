# 3D Layer View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only 3D layer view that explodes the selected frame's subtree into perspective-stacked planes (paint order → depth), each a real Pixi snapshot, rendered as a CSS-3D DOM overlay with orbit, hover-highlight, and an explode-spacing slider.

**Architecture:** A new `layers3dStore` (Zustand) holds transient 3D state. On enter, `captureLayers` walks the frame subtree in paint order, extracts a PNG per node via `app.renderer.extract.canvas` → blob → object-URL, and produces `Plane[]`. A React `Layers3DOverlay` renders each plane as an `<img>` positioned with CSS `translate3d`, inside a `perspective` scene whose `rotateX/rotateY/scale` are drag/wheel driven. The Pixi canvas and its overlays are hidden while active. No new dependencies.

**Tech Stack:** React 19, Zustand 5, PixiJS 8 (`renderer.extract`), CSS 3D transforms, Vitest + happy-dom, TypeScript strict.

## Global Constraints

- Frontend uses the `@/` → `src/` path alias. TypeScript strict; `noUnusedLocals`/`noUnusedParameters`.
- Tailwind CSS v4; theme tokens from `src/index.css` (e.g. `bg-surface-panel`, `text-text-muted`).
- `npm run lint` must stay at 0 errors (enforced in CI). `npm run build` = `tsc -b && vite build` must pass.
- Test files live under `src/**/__tests__/` in the `tsconfig.test.json` project; reset stores via `src/test/fixtures.ts` (`resetStores()`, `seedScene()`).
- happy-dom has no WebGL — the real Pixi `extract` path is NOT unit-testable. Mock it (mirror the `get_screenshot` posture), exactly like other Pixi-touching unit tests.
- This is READ-ONLY: no scene mutation, no selection write-back, no click-to-select. Do not route through `editorModeStore`.
- `exit()` MUST `URL.revokeObjectURL` every plane's `imageUrl` (blob-URL leak guard).

## Reference APIs (already in the codebase)

- `getNodeContainer(id: string): Container | null` — exported from `@/pixi/pixiSync`. Returns the live Pixi container for a node id (backed by the sync registry).
- `useCanvasRefStore.getState().pixiRefs` → `{ app, viewport, sceneRoot, overlayContainer, selectionContainer } | null`. Extract via `pixiRefs.app.renderer.extract`.
- Extract precedent (`src/lib/tools/getScreenshot.ts`): `await app.renderer.extract.base64(target)`. We use `app.renderer.extract.canvas(target)` (returns a canvas) → `toBlob` → `URL.createObjectURL` for memory-friendly object-URLs.
- Scene maps: `useSceneStore.getState()` → `nodesById: Record<string, FlatSceneNode>`, `childrenById: Record<string, string[]>`, `rootIds: string[]`, `getNodes(): SceneNode[]`.
- Absolute position: `getNodeAbsolutePositionWithLayout(nodes, targetId, calculateLayoutForFrame)` from `@/utils/nodeUtils` → `{ x, y } | null`. Pair with `useLayoutStore.getState().calculateLayoutForFrame`.
- Selection: `useSelectionStore.getState().selectedIds: string[]`.
- `findParentFrame` from `@/utils/nodeUtils` resolves the nearest ancestor frame of a node.

## File Structure

New:
- `src/store/layers3dStore.ts` — transient 3D state + actions.
- `src/pixi/layers3d/captureLayers.ts` — paint-order walk + per-node snapshot → `Plane[]`.
- `src/pixi/layers3d/resolveTargetFrame.ts` — pick the frame to explode (selection / viewport center).
- `src/components/canvas/Layers3DOverlay.tsx` — the CSS-3D overlay + control bar.
- `src/components/canvas/Layers3DToggle.tsx` — the floating "3D" toggle button.
- `src/store/__tests__/layers3dStore.test.ts`
- `src/pixi/layers3d/__tests__/captureLayers.test.ts`
- `src/pixi/layers3d/__tests__/resolveTargetFrame.test.ts`
- `src/components/canvas/__tests__/Layers3DOverlay.test.tsx`

Modified:
- `src/pixi/PixiCanvas.tsx` — mount `Layers3DToggle` + `Layers3DOverlay`; hide Pixi canvas + overlays when active; Esc exits.

---

### Task 1: `captureLayers` — paint-order walk + snapshot pipeline

**Files:**
- Create: `src/pixi/layers3d/captureLayers.ts`
- Test: `src/pixi/layers3d/__tests__/captureLayers.test.ts`

**Interfaces:**
- Consumes: `useSceneStore` (`nodesById`, `childrenById`), `getNodeContainer` from `@/pixi/pixiSync`, `useCanvasRefStore`, `getNodeAbsolutePositionWithLayout` + `useLayoutStore`.
- Produces:
  ```ts
  export interface Plane {
    nodeId: string;
    depthIndex: number;
    rect: { x: number; y: number; width: number; height: number };
    imageUrl: string;
    opacity: number;
    cornerRadius: number;
  }
  export const MAX_PLANES = 300;
  export async function captureLayers(frameId: string): Promise<Plane[]>;
  ```
  `rect` is relative to the target frame's absolute origin (frame origin = 0,0), so the overlay can position planes within a local stack. `depthIndex` is a monotonic counter incremented per emitted plane in paint order (pre-order DFS: parent before children, children in `childrenById` order). Skip nodes with `width <= 0 || height <= 0` or `visible === false`. Stop after `MAX_PLANES` planes and `console.warn` how many were dropped.

- [ ] **Step 1: Write the failing test**

```ts
// src/pixi/layers3d/__tests__/captureLayers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";

const extractCanvas = vi.fn();
const getNodeContainer = vi.fn();

vi.mock("@/pixi/pixiSync", () => ({
  getNodeContainer: (id: string) => getNodeContainer(id),
}));
vi.mock("@/store/canvasRefStore", () => ({
  useCanvasRefStore: {
    getState: () => ({
      pixiRefs: { app: { renderer: { extract: { canvas: extractCanvas } } } },
    }),
  },
}));

import { captureLayers } from "../captureLayers";

// A fake canvas whose toBlob yields a blob so createObjectURL is exercised.
function fakeCanvas() {
  return {
    width: 100,
    height: 50,
    toBlob: (cb: (b: Blob) => void) => cb(new Blob(["x"], { type: "image/png" })),
  };
}

describe("captureLayers", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 is a separate root
    extractCanvas.mockReset().mockImplementation(() => fakeCanvas());
    getNodeContainer.mockReset().mockImplementation(() => ({}));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("emits planes in paint order with monotonic depthIndex", async () => {
    const planes = await captureLayers("frame1");
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "rect1", "text1"]);
    expect(planes.map((p) => p.depthIndex)).toEqual([0, 1, 2]);
  });

  it("positions rects relative to the frame origin", async () => {
    const planes = await captureLayers("frame1");
    // frame1 is at (100,100); its own plane sits at local (0,0)
    expect(planes[0].rect).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    // rect1 is at absolute (110,120) → local (10,20)
    expect(planes[1].rect).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("skips zero-size and invisible nodes", async () => {
    resetStores();
    seedScene();
    const s = (await import("@/store/sceneStore")).useSceneStore.getState();
    s.updateNode("rect1", { visible: false });
    const planes = await captureLayers("frame1");
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "text1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- captureLayers`
Expected: FAIL — cannot find module `../captureLayers`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pixi/layers3d/captureLayers.ts
import { useSceneStore } from "@/store/sceneStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeContainer } from "@/pixi/pixiSync";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { Container } from "pixi.js";

export interface Plane {
  nodeId: string;
  depthIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  imageUrl: string;
  opacity: number;
  cornerRadius: number;
}

export const MAX_PLANES = 300;
const MAX_EDGE = 2048;

function canvasToObjectUrl(canvas: {
  width: number;
  height: number;
  toBlob: (cb: (b: Blob | null) => void) => void;
}): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) =>
      resolve(blob ? URL.createObjectURL(blob) : null),
    );
  });
}

/** Pre-order (paint order): parent before children; children in child order. */
function paintOrder(frameId: string): string[] {
  const { childrenById } = useSceneStore.getState();
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const childId of childrenById[id] ?? []) walk(childId);
  };
  walk(frameId);
  return out;
}

export async function captureLayers(frameId: string): Promise<Plane[]> {
  const { nodesById, getNodes } = useSceneStore.getState();
  const { pixiRefs } = useCanvasRefStore.getState();
  const frame = nodesById[frameId];
  if (!pixiRefs || !frame) return [];

  const nodes = getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const frameAbs = getNodeAbsolutePositionWithLayout(nodes, frameId, calc) ?? {
    x: frame.x,
    y: frame.y,
  };

  const ids = paintOrder(frameId);
  const planes: Plane[] = [];
  let dropped = 0;

  for (const id of ids) {
    if (planes.length >= MAX_PLANES) {
      dropped = ids.length - planes.length;
      break;
    }
    const node = nodesById[id];
    if (!node) continue;
    if ((node.width ?? 0) <= 0 || (node.height ?? 0) <= 0) continue;
    if (node.visible === false) continue;

    const container = getNodeContainer(id) as Container | null;
    if (!container) continue;

    let canvas;
    try {
      canvas = pixiRefs.app.renderer.extract.canvas(container) as unknown as {
        width: number;
        height: number;
        toBlob: (cb: (b: Blob | null) => void) => void;
      };
    } catch {
      continue; // extraction failed for this node — skip it, keep going
    }
    if (canvas.width > MAX_EDGE || canvas.height > MAX_EDGE) {
      // capped by resolution policy; still capture (browser downscales in <img>)
    }
    const imageUrl = await canvasToObjectUrl(canvas);
    if (!imageUrl) continue;

    const abs = getNodeAbsolutePositionWithLayout(nodes, id, calc) ?? {
      x: node.x,
      y: node.y,
    };
    planes.push({
      nodeId: id,
      depthIndex: planes.length,
      rect: {
        x: abs.x - frameAbs.x,
        y: abs.y - frameAbs.y,
        width: node.width ?? 0,
        height: node.height ?? 0,
      },
      imageUrl,
      opacity: node.opacity ?? 1,
      cornerRadius:
        typeof node.cornerRadius === "number" ? node.cornerRadius : 0,
    });
  }

  if (dropped > 0) {
    console.warn(`captureLayers: dropped ${dropped} planes over MAX_PLANES`);
  }
  return planes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- captureLayers`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pixi/layers3d/captureLayers.ts src/pixi/layers3d/__tests__/captureLayers.test.ts
git commit -m "feat(3d): captureLayers paint-order snapshot pipeline"
```

---

### Task 2: `layers3dStore` — transient state, clamps, blob-URL cleanup

**Files:**
- Create: `src/store/layers3dStore.ts`
- Test: `src/store/__tests__/layers3dStore.test.ts`

**Interfaces:**
- Consumes: `captureLayers`, `Plane`, `MAX_PLANES` from `@/pixi/layers3d/captureLayers`.
- Produces:
  ```ts
  export const DEFAULT_ROTATE_X = 8;
  export const DEFAULT_ROTATE_Y = -24;
  export const DEFAULT_SPACING = 40;
  export const MIN_SPACING = 8;
  export const MAX_SPACING = 160;
  export const ROTATE_CLAMP = 60;   // ±deg
  export const MIN_ZOOM = 0.2;
  export const MAX_ZOOM = 3;

  interface Layers3DState {
    active: boolean;
    targetFrameId: string | null;
    planes: Plane[];
    rotateX: number; rotateY: number;
    spacing: number; zoom: number;
    hoveredPlaneId: string | null;
    enter: (frameId: string) => Promise<void>;
    exit: () => void;
    setRotation: (x: number, y: number) => void;
    setSpacing: (px: number) => void;
    setZoom: (z: number) => void;
    setHovered: (id: string | null) => void;
    resetView: () => void;
  }
  export const useLayers3DStore: /* zustand store */;
  ```
  `enter` sets `active` optimistically, awaits `captureLayers`, stores the planes and default view. `exit` revokes every `plane.imageUrl` and resets to inactive defaults. `setRotation` clamps each axis to `±ROTATE_CLAMP`. `setSpacing` clamps to `[MIN_SPACING, MAX_SPACING]`. `setZoom` clamps to `[MIN_ZOOM, MAX_ZOOM]`. `resetView` restores default rotation/spacing/zoom without re-capturing.

- [ ] **Step 1: Write the failing test**

```ts
// src/store/__tests__/layers3dStore.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureLayers = vi.fn();
vi.mock("@/pixi/layers3d/captureLayers", () => ({
  MAX_PLANES: 300,
  captureLayers: (id: string) => captureLayers(id),
}));

import {
  useLayers3DStore,
  DEFAULT_ROTATE_X,
  DEFAULT_ROTATE_Y,
  DEFAULT_SPACING,
  ROTATE_CLAMP,
  MAX_SPACING,
} from "@/store/layers3dStore";

const revoke = vi.fn();

describe("layers3dStore", () => {
  beforeEach(() => {
    captureLayers.mockReset();
    revoke.mockReset();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: revoke });
    useLayers3DStore.setState({
      active: false,
      targetFrameId: null,
      planes: [],
      rotateX: DEFAULT_ROTATE_X,
      rotateY: DEFAULT_ROTATE_Y,
      spacing: DEFAULT_SPACING,
      zoom: 1,
      hoveredPlaneId: null,
    });
  });

  it("enter captures planes and activates with default view", async () => {
    captureLayers.mockResolvedValue([
      { nodeId: "a", depthIndex: 0, imageUrl: "blob:a", rect: {}, opacity: 1, cornerRadius: 0 },
    ]);
    await useLayers3DStore.getState().enter("frame1");
    const s = useLayers3DStore.getState();
    expect(s.active).toBe(true);
    expect(s.targetFrameId).toBe("frame1");
    expect(s.planes).toHaveLength(1);
    expect(s.rotateX).toBe(DEFAULT_ROTATE_X);
    expect(s.rotateY).toBe(DEFAULT_ROTATE_Y);
  });

  it("exit revokes every plane object-URL and deactivates", () => {
    useLayers3DStore.setState({
      active: true,
      planes: [
        { nodeId: "a", depthIndex: 0, imageUrl: "blob:a", rect: {}, opacity: 1, cornerRadius: 0 },
        { nodeId: "b", depthIndex: 1, imageUrl: "blob:b", rect: {}, opacity: 1, cornerRadius: 0 },
      ] as never,
    });
    useLayers3DStore.getState().exit();
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(revoke).toHaveBeenCalledWith("blob:b");
    expect(useLayers3DStore.getState().active).toBe(false);
    expect(useLayers3DStore.getState().planes).toEqual([]);
  });

  it("clamps rotation, spacing and zoom", () => {
    const st = useLayers3DStore.getState();
    st.setRotation(999, -999);
    expect(useLayers3DStore.getState().rotateX).toBe(ROTATE_CLAMP);
    expect(useLayers3DStore.getState().rotateY).toBe(-ROTATE_CLAMP);
    st.setSpacing(9999);
    expect(useLayers3DStore.getState().spacing).toBe(MAX_SPACING);
    st.setZoom(999);
    expect(useLayers3DStore.getState().zoom).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- layers3dStore`
Expected: FAIL — cannot find module `@/store/layers3dStore`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/store/layers3dStore.ts
import { create } from "zustand";
import { captureLayers, type Plane } from "@/pixi/layers3d/captureLayers";

export const DEFAULT_ROTATE_X = 8;
export const DEFAULT_ROTATE_Y = -24;
export const DEFAULT_SPACING = 40;
export const MIN_SPACING = 8;
export const MAX_SPACING = 160;
export const ROTATE_CLAMP = 60;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

interface Layers3DState {
  active: boolean;
  targetFrameId: string | null;
  planes: Plane[];
  rotateX: number;
  rotateY: number;
  spacing: number;
  zoom: number;
  hoveredPlaneId: string | null;
  enter: (frameId: string) => Promise<void>;
  exit: () => void;
  setRotation: (x: number, y: number) => void;
  setSpacing: (px: number) => void;
  setZoom: (z: number) => void;
  setHovered: (id: string | null) => void;
  resetView: () => void;
}

const defaultView = {
  rotateX: DEFAULT_ROTATE_X,
  rotateY: DEFAULT_ROTATE_Y,
  spacing: DEFAULT_SPACING,
  zoom: 1,
};

export const useLayers3DStore = create<Layers3DState>((set, get) => ({
  active: false,
  targetFrameId: null,
  planes: [],
  ...defaultView,
  hoveredPlaneId: null,

  enter: async (frameId) => {
    set({ active: true, targetFrameId: frameId, ...defaultView, hoveredPlaneId: null });
    const planes = await captureLayers(frameId);
    // Guard against a race where the user exited while capturing.
    if (get().active && get().targetFrameId === frameId) {
      set({ planes });
    } else {
      planes.forEach((p) => URL.revokeObjectURL(p.imageUrl));
    }
  },

  exit: () => {
    get().planes.forEach((p) => URL.revokeObjectURL(p.imageUrl));
    set({
      active: false,
      targetFrameId: null,
      planes: [],
      hoveredPlaneId: null,
      ...defaultView,
    });
  },

  setRotation: (x, y) =>
    set({
      rotateX: clamp(x, -ROTATE_CLAMP, ROTATE_CLAMP),
      rotateY: clamp(y, -ROTATE_CLAMP, ROTATE_CLAMP),
    }),
  setSpacing: (px) => set({ spacing: clamp(px, MIN_SPACING, MAX_SPACING) }),
  setZoom: (z) => set({ zoom: clamp(z, MIN_ZOOM, MAX_ZOOM) }),
  setHovered: (id) => set({ hoveredPlaneId: id }),
  resetView: () => set({ ...defaultView }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- layers3dStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/layers3dStore.ts src/store/__tests__/layers3dStore.test.ts
git commit -m "feat(3d): layers3dStore state, clamps and blob cleanup"
```

---

### Task 3: `resolveTargetFrame` — pick the frame to explode

**Files:**
- Create: `src/pixi/layers3d/resolveTargetFrame.ts`
- Test: `src/pixi/layers3d/__tests__/resolveTargetFrame.test.ts`

**Interfaces:**
- Consumes: `useSceneStore`, `useSelectionStore`, `findParentFrame` from `@/utils/nodeUtils`.
- Produces:
  ```ts
  export function resolveTargetFrame(): string | null;
  ```
  Resolution order: (1) if a selected node IS a frame, use it; (2) if a selected node is inside a frame, use `findParentFrame`; (3) else the first top-level frame in `rootIds`; (4) else `null`. Returning `null` is what disables the toggle.

- [ ] **Step 1: Write the failing test**

```ts
// src/pixi/layers3d/__tests__/resolveTargetFrame.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { resolveTargetFrame } from "../resolveTargetFrame";

describe("resolveTargetFrame", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 root (non-frame)
  });

  it("uses a selected frame directly", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("uses the parent frame of a selected child", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("falls back to the first top-level frame when nothing is selected", () => {
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBe("frame1");
  });

  it("returns null when there is no frame at all", () => {
    resetStores(); // empty scene
    useSelectionStore.setState({ selectedIds: [] });
    expect(resolveTargetFrame()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- resolveTargetFrame`
Expected: FAIL — cannot find module `../resolveTargetFrame`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/pixi/layers3d/resolveTargetFrame.ts
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findParentFrame } from "@/utils/nodeUtils";

export function resolveTargetFrame(): string | null {
  const { nodesById, rootIds, getNodes } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();

  const selId = selectedIds[0];
  if (selId && nodesById[selId]) {
    if (nodesById[selId].type === "frame") return selId;
    const parent = findParentFrame(getNodes(), selId);
    if (parent) return parent.id;
  }

  const firstFrame = rootIds.find((id) => nodesById[id]?.type === "frame");
  return firstFrame ?? null;
}
```

> Note: verify `findParentFrame`'s exact signature/return before wiring — the test asserts it resolves `rect1 → frame1`. If it returns an id rather than a node, adjust `.id` accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- resolveTargetFrame`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pixi/layers3d/resolveTargetFrame.ts src/pixi/layers3d/__tests__/resolveTargetFrame.test.ts
git commit -m "feat(3d): resolveTargetFrame selection/fallback logic"
```

---

### Task 4: `Layers3DOverlay` — CSS-3D render, orbit, hover, controls

**Files:**
- Create: `src/components/canvas/Layers3DOverlay.tsx`
- Test: `src/components/canvas/__tests__/Layers3DOverlay.test.tsx`

**Interfaces:**
- Consumes: `useLayers3DStore` (all fields + `setRotation`, `setSpacing`, `setZoom`, `setHovered`, `resetView`, `exit`), `MIN_SPACING`, `MAX_SPACING`.
- Produces: `export function Layers3DOverlay(): JSX.Element | null;` — renders `null` when `!active`.

**Behavior:**
- Root `.scene` div: `position:absolute; inset:0; perspective:1600px; overflow:hidden`. Subtle graduated background using theme tokens.
- `.stack` div: `transform-style:preserve-3d; transform: scale(zoom) rotateX(rx deg) rotateY(ry deg)`. Centered via a translate so the frame stack sits mid-viewport.
- One `<img data-plane-id={p.nodeId}>` per plane: `position:absolute; transform: translate3d(rect.x px, rect.y px, calc(-1 * depthIndex * spacing) px); width:rect.width px; height:rect.height px; border-radius:cornerRadius px; opacity`. Hovered plane gets an outline + full opacity + a small forward `translateZ` nudge; non-hovered dim slightly when something is hovered.
- Orbit: pointer-drag on `.scene` (not on the control bar) accumulates `dx→rotateY`, `dy→-rotateX` via `setRotation(current + ...)`. Wheel → `setZoom`.
- Control bar (bottom-center, `bg-surface-panel` tokens): spacing `<input type="range" min={MIN_SPACING} max={MAX_SPACING}>` → `setSpacing`; "Reset view" button → `resetView`; "Exit" button → `exit`.
- `prefers-reduced-motion`: skip the enter CSS transition (guard with a matchMedia check; default to animated).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/canvas/__tests__/Layers3DOverlay.test.tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useLayers3DStore, DEFAULT_SPACING } from "@/store/layers3dStore";
import { Layers3DOverlay } from "../Layers3DOverlay";

const plane = (nodeId: string, depthIndex: number) => ({
  nodeId,
  depthIndex,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  imageUrl: `blob:${nodeId}`,
  opacity: 1,
  cornerRadius: 4,
});

describe("Layers3DOverlay", () => {
  beforeEach(() => {
    useLayers3DStore.setState({
      active: false, planes: [], hoveredPlaneId: null,
      rotateX: 8, rotateY: -24, spacing: DEFAULT_SPACING, zoom: 1,
    });
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<Layers3DOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one img per plane with a translate3d transform", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0), plane("b", 1)] });
    render(<Layers3DOverlay />);
    const imgs = document.querySelectorAll("img[data-plane-id]");
    expect(imgs).toHaveLength(2);
    expect((imgs[1] as HTMLElement).style.transform).toContain("translate3d");
  });

  it("sets hoveredPlaneId on pointer enter", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    fireEvent.pointerEnter(document.querySelector('img[data-plane-id="a"]')!);
    expect(useLayers3DStore.getState().hoveredPlaneId).toBe("a");
  });

  it("spacing slider updates the store", () => {
    useLayers3DStore.setState({ active: true, planes: [plane("a", 0)] });
    render(<Layers3DOverlay />);
    fireEvent.change(screen.getByLabelText(/spacing/i), { target: { value: "120" } });
    expect(useLayers3DStore.getState().spacing).toBe(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Layers3DOverlay`
Expected: FAIL — cannot find module `../Layers3DOverlay`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/canvas/Layers3DOverlay.tsx
import { useRef } from "react";
import {
  useLayers3DStore,
  MIN_SPACING,
  MAX_SPACING,
} from "@/store/layers3dStore";

export function Layers3DOverlay() {
  const active = useLayers3DStore((s) => s.active);
  const planes = useLayers3DStore((s) => s.planes);
  const rotateX = useLayers3DStore((s) => s.rotateX);
  const rotateY = useLayers3DStore((s) => s.rotateY);
  const spacing = useLayers3DStore((s) => s.spacing);
  const zoom = useLayers3DStore((s) => s.zoom);
  const hoveredPlaneId = useLayers3DStore((s) => s.hoveredPlaneId);
  const setRotation = useLayers3DStore((s) => s.setRotation);
  const setSpacing = useLayers3DStore((s) => s.setSpacing);
  const setZoom = useLayers3DStore((s) => s.setZoom);
  const setHovered = useLayers3DStore((s) => s.setHovered);
  const resetView = useLayers3DStore((s) => s.resetView);
  const exit = useLayers3DStore((s) => s.exit);

  const drag = useRef<{ x: number; y: number } | null>(null);

  if (!active) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-3d-controls]")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setRotation(rotateX - dy * 0.3, rotateY + dx * 0.3);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-surface-panel"
      style={{ perspective: "1600px" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={(e) => setZoom(zoom - e.deltaY * 0.001)}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transformStyle: "preserve-3d",
          transform: `translate(-50%, -50%) scale(${zoom}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        }}
      >
        {planes.map((p) => {
          const isHovered = hoveredPlaneId === p.nodeId;
          const dimmed = hoveredPlaneId !== null && !isHovered;
          return (
            <img
              key={p.nodeId}
              data-plane-id={p.nodeId}
              src={p.imageUrl}
              onPointerEnter={() => setHovered(p.nodeId)}
              onPointerLeave={() => setHovered(null)}
              style={{
                position: "absolute",
                width: `${p.rect.width}px`,
                height: `${p.rect.height}px`,
                borderRadius: `${p.cornerRadius}px`,
                opacity: dimmed ? p.opacity * 0.5 : p.opacity,
                outline: isHovered ? "2px solid var(--color-accent)" : "none",
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                transform: `translate3d(${p.rect.x}px, ${p.rect.y}px, ${
                  -p.depthIndex * spacing + (isHovered ? 20 : 0)
                }px)`,
              }}
            />
          );
        })}
      </div>

      <div
        data-3d-controls
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg bg-surface-panel px-4 py-2 shadow-lg"
      >
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Spacing
          <input
            aria-label="Layer spacing"
            type="range"
            min={MIN_SPACING}
            max={MAX_SPACING}
            value={spacing}
            onChange={(e) => setSpacing(Number(e.target.value))}
          />
        </label>
        <button className="text-sm text-text-muted" onClick={resetView}>
          Reset view
        </button>
        <button className="text-sm text-text-muted" onClick={exit}>
          Exit
        </button>
      </div>
    </div>
  );
}
```

> If `--color-accent` isn't a defined token, substitute the project's accent token (check `src/index.css`). Keep the `img[data-plane-id]` attribute and the `aria-label="Layer spacing"` — the tests key on them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Layers3DOverlay`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/Layers3DOverlay.tsx src/components/canvas/__tests__/Layers3DOverlay.test.tsx
git commit -m "feat(3d): Layers3DOverlay CSS-3D render, orbit, hover, controls"
```

---

### Task 5: Toggle button + integrate into `PixiCanvas`

**Files:**
- Create: `src/components/canvas/Layers3DToggle.tsx`
- Modify: `src/pixi/PixiCanvas.tsx`
- Test: `src/components/canvas/__tests__/Layers3DOverlay.test.tsx` (extend with a toggle test, or add `Layers3DToggle.test.tsx`)

**Interfaces:**
- Consumes: `useLayers3DStore`, `resolveTargetFrame` from `@/pixi/layers3d/resolveTargetFrame`.
- Produces: `export function Layers3DToggle(): JSX.Element;`

**Behavior:**
- Floating button, top-center over the canvas (absolute, mirrors the reference). Label "3D" with a cube icon (`@phosphor-icons/react`, e.g. `Cube`).
- On click: if `active`, call `exit()`; else compute `const target = resolveTargetFrame()` and, if non-null, `enter(target)`.
- `disabled` when `resolveTargetFrame()` returns `null`; tooltip/`title="Select a frame to view in 3D"`.
- In `PixiCanvas.tsx`: render `<Layers3DToggle />` and `<Layers3DOverlay />` inside the canvas container. When `useLayers3DStore(s => s.active)` is true, hide the Pixi `<canvas>` element and the existing DOM overlays (embed/selection layers) — e.g. wrap them with `style={{ visibility: active ? "hidden" : "visible" }}` or conditionally set `display:none` on the Pixi container — so only the 3D overlay shows. Add an Esc `keydown` listener (while active) that calls `exit()`.

- [ ] **Step 1: Write the failing test**

```tsx
// append to src/components/canvas/__tests__/Layers3DOverlay.test.tsx
import { Layers3DToggle } from "../Layers3DToggle";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";

describe("Layers3DToggle", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useLayers3DStore.setState({ active: false, planes: [] });
  });

  it("is disabled when no frame can be resolved", () => {
    resetStores(); // empty scene → no frame
    useSelectionStore.setState({ selectedIds: [] });
    render(<Layers3DToggle />);
    expect(screen.getByRole("button", { name: /3d/i })).toBeDisabled();
  });

  it("enters 3D with the resolved frame on click", () => {
    useSelectionStore.setState({ selectedIds: ["frame1"] });
    render(<Layers3DToggle />);
    fireEvent.click(screen.getByRole("button", { name: /3d/i }));
    expect(useLayers3DStore.getState().active).toBe(true);
    expect(useLayers3DStore.getState().targetFrameId).toBe("frame1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Layers3DOverlay`
Expected: FAIL — cannot find module `../Layers3DToggle`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/canvas/Layers3DToggle.tsx
import { Cube } from "@phosphor-icons/react";
import { useLayers3DStore } from "@/store/layers3dStore";
import { resolveTargetFrame } from "@/pixi/layers3d/resolveTargetFrame";

export function Layers3DToggle() {
  const active = useLayers3DStore((s) => s.active);
  const enter = useLayers3DStore((s) => s.enter);
  const exit = useLayers3DStore((s) => s.exit);

  const target = resolveTargetFrame();
  const disabled = !active && target === null;

  const onClick = () => {
    if (active) {
      exit();
      return;
    }
    const frameId = resolveTargetFrame();
    if (frameId) void enter(frameId);
  };

  return (
    <button
      type="button"
      aria-label="3D layer view"
      title={disabled ? "Select a frame to view in 3D" : "3D layer view"}
      disabled={disabled}
      onClick={onClick}
      className={`absolute left-1/2 top-4 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full px-4 py-2 shadow-lg ${
        active ? "bg-text-default text-surface-panel" : "bg-surface-panel text-text-muted"
      } disabled:opacity-40`}
    >
      <Cube weight="bold" />
      3D
    </button>
  );
}
```

Then wire into `PixiCanvas.tsx`:

```tsx
// near other imports
import { Layers3DToggle } from "@/components/canvas/Layers3DToggle";
import { Layers3DOverlay } from "@/components/canvas/Layers3DOverlay";
import { useLayers3DStore } from "@/store/layers3dStore";

// inside PixiCanvas():
const is3DActive = useLayers3DStore((s) => s.active);
const exit3D = useLayers3DStore((s) => s.exit);

useEffect(() => {
  if (!is3DActive) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") exit3D();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [is3DActive, exit3D]);

// In the returned JSX, inside the canvas container element:
//  - hide the Pixi host + overlays when active:
//      <div style={{ visibility: is3DActive ? "hidden" : "visible" }}> ...existing pixi container + embed/selection overlays... </div>
//  - always render the toggle + overlay on top:
//      <Layers3DToggle />
//      <Layers3DOverlay />
```

> Follow the existing JSX structure in `PixiCanvas.tsx` — wrap the current Pixi `containerRef` div and the embed/selection overlay siblings in a visibility-toggled wrapper, and place `<Layers3DToggle />` + `<Layers3DOverlay />` as siblings so they sit above. Do not hide them via unmount (that would tear down Pixi); use `visibility`/`display` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Layers3DOverlay`
Expected: PASS (toggle tests + prior overlay tests).

- [ ] **Step 5: Verify the app builds and lints**

Run: `npm run lint && npm run build`
Expected: 0 lint errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/Layers3DToggle.tsx src/pixi/PixiCanvas.tsx src/components/canvas/__tests__/Layers3DOverlay.test.tsx
git commit -m "feat(3d): 3D toggle button + PixiCanvas integration (Esc exit, hide Pixi)"
```

---

### Task 6: Manual verification + release

**Files:** none (verification only), then version bump.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass (including the new 3D tests).

- [ ] **Step 2: Drive the real app** (WebGL extract is not unit-testable — verify by hand)

Run: `npm run dev`, open a document with a frame containing several nested nodes. Then:
- Select the frame → the "3D" button is enabled; click it.
- Confirm the design explodes into perspective-stacked planes showing **real content** (snapshots), tilted by the default angle.
- Drag → the stack orbits (clamped). Wheel → zooms.
- Hover a plane → it highlights and nudges forward; others dim.
- Move the spacing slider → gap between layers changes.
- "Reset view" restores the default angle/spacing/zoom.
- Esc and the "Exit"/toggle both return to the normal 2D canvas, and the Pixi canvas is interactive again.
- With nothing selected and no frames present, the "3D" button is disabled with the tooltip.

- [ ] **Step 3: Check for blob-URL leaks**

In DevTools, enter and exit 3D several times; confirm memory doesn't grow unbounded (each `exit` revokes URLs). Optionally log `plane.imageUrl` revocations.

- [ ] **Step 4: Version bump + commit**

```bash
npm version minor   # 0.23.3 → 0.24.0 (new feature)
git add package.json package-lock.json
git commit -m "chore(release): v0.24.0 — 3D layer view"
```

> Do NOT push or tag unless the user asks (per project conventions). Report the verification results honestly, including anything that didn't work.

---

## Notes for the implementer

- The real Pixi `extract` + WebGL path cannot run under happy-dom; every unit test mocks it. Do not attempt to assert real pixels in unit tests — that's what Task 6's manual pass is for.
- Keep the feature strictly read-only. If you find yourself wiring selection or scene mutation, stop — that's out of scope (see spec Non-Goals).
- Files are intentionally small and single-purpose (store / capture / resolve / overlay / toggle). Keep them that way.
- If `Cube` isn't exported by the installed `@phosphor-icons/react` version, pick an equivalent 3D/cube icon from that package.
