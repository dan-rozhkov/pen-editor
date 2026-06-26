# Code Layers DOM Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render embed nodes ("code layers") as a per-embed Shadow-DOM overlay above the Pixi canvas, synced to pan/zoom and always on top, replacing the Pixi texture render path.

**Architecture:** A new React `EmbedLayer` is mounted inside the `PixiCanvas` container (a sibling of the `<canvas>` with a higher z-index). It renders one Shadow-DOM host per embed node, positioned in screen coordinates (`world*scale + pan`) and zoom-scaled via CSS transform, updated imperatively from `viewportStore`. The embed node stays in the Pixi scene (invisible) so hit-testing/selection/drag keep working. Embeds are `pointer-events: none` by default; double-click makes one "active" (`pointer-events: auto`) for live scroll/links/forms.

**Tech Stack:** React 19, Zustand, PixiJS, TypeScript (strict), Vitest + happy-dom + @testing-library/react, Playwright.

## Global Constraints

- TypeScript strict, `noUnusedLocals`, `noUnusedParameters` — no unused imports/vars.
- Path alias `@/` → `src/`. Import order: React → third-party → `@/` → relative.
- `npm run lint` must stay at 0 errors; `npm run build` (tsc -b) must pass.
- Unit tests live in `src/**/__tests__/`, reset stores via `resetStores()`/`seedScene()` from `@/test/fixtures`. **PixiJS must never be initialized in unit tests.**
- Embed `htmlContent` is untrusted; it is already sanitized by `mountHtmlWithBodyStyles` (strips scripts) — reuse it, do not re-implement sanitization.
- Commit after each task with the shown message.

---

### Task 1: Active-embed state in `selectionStore`

Adds a single "active embed" id (the embed currently entered for live interaction) plus a setter, and clears it on any selection change.

**Files:**
- Modify: `src/store/selectionStore.ts`
- Test: `src/store/__tests__/selectionStore.activeEmbed.test.ts` (create)

**Interfaces:**
- Produces: `useSelectionStore` state gains `activeEmbedId: string | null` and `setActiveEmbed(id: string | null): void`. `select`, `setSelectedIds`, and `clearSelection` reset `activeEmbedId` to `null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/store/__tests__/selectionStore.activeEmbed.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";

describe("selectionStore activeEmbedId", () => {
  beforeEach(() => resetStores());

  it("defaults to null", () => {
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("setActiveEmbed sets and clears the active embed", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    expect(useSelectionStore.getState().activeEmbedId).toBe("embed1");
    useSelectionStore.getState().setActiveEmbed(null);
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId when selection changes", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().select("rect1");
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });

  it("clears activeEmbedId on clearSelection", () => {
    useSelectionStore.getState().setActiveEmbed("embed1");
    useSelectionStore.getState().clearSelection();
    expect(useSelectionStore.getState().activeEmbedId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- selectionStore.activeEmbed`
Expected: FAIL — `setActiveEmbed is not a function` / `activeEmbedId` undefined.

- [ ] **Step 3: Implement minimal changes**

In `src/store/selectionStore.ts`:

Add to the `SelectionState` interface (near `lastSelectedId`):

```ts
  // The embed currently "entered" for live interaction (pointer-events: auto)
  activeEmbedId: string | null
  setActiveEmbed: (id: string | null) => void
```

Add to the store initial state (near `lastSelectedId: null,` at the top of `create`):

```ts
  activeEmbedId: null,
```

Add the setter (anywhere among the action definitions, e.g. after `clearSelection`):

```ts
  setActiveEmbed: (id: string | null) => set({ activeEmbedId: id }),
```

Add `activeEmbedId: null,` to the `set({...})` object inside **`select`**, **`setSelectedIds`**, and **`clearSelection`** (alongside the existing `editingMode: null,` lines).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- selectionStore.activeEmbed`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/selectionStore.ts src/store/__tests__/selectionStore.activeEmbed.test.ts
git commit -m "feat(selection): add activeEmbedId state for live embed interaction"
```

---

### Task 2: Extract `getEffectiveThemeForNode` to a shared util

The theme-resolution helper currently lives privately in `embedRenderer.ts`. `EmbedLayer` needs it too, and `embedRenderer` is about to be gutted (Task 5), so move it to a shared util first.

**Files:**
- Create: `src/utils/nodeThemeUtils.ts`
- Modify: `src/pixi/renderers/embedRenderer.ts` (remove local copy, import from util)
- Test: `src/utils/__tests__/nodeThemeUtils.test.ts` (create)

**Interfaces:**
- Produces: `getEffectiveThemeForNode(nodeId: string): ThemeName` — walks ancestor frames via `useSceneStore` `parentById`/`nodesById`; returns the innermost ancestor frame's `themeOverride`, else `useThemeStore.getState().activeTheme`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/nodeThemeUtils.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

describe("getEffectiveThemeForNode", () => {
  beforeEach(() => resetStores());

  it("returns the global active theme when no ancestor frame overrides it", () => {
    useThemeStore.setState({ activeTheme: "light" });
    useSceneStore.setState({
      nodesById: { e1: { id: "e1", type: "embed", htmlContent: "", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    expect(getEffectiveThemeForNode("e1")).toBe("light");
  });

  it("returns an ancestor frame's themeOverride", () => {
    useThemeStore.setState({ activeTheme: "light" });
    useSceneStore.setState({
      nodesById: {
        f1: { id: "f1", type: "frame", themeOverride: "dark", x: 0, y: 0, width: 100, height: 100 } as unknown as FlatSceneNode,
        e1: { id: "e1", type: "embed", htmlContent: "", x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      parentById: { f1: null, e1: "f1" },
      childrenById: { f1: ["e1"] },
      rootIds: ["f1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    expect(getEffectiveThemeForNode("e1")).toBe("dark");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- nodeThemeUtils`
Expected: FAIL — module `@/utils/nodeThemeUtils` not found.

- [ ] **Step 3: Create the util**

```ts
// src/utils/nodeThemeUtils.ts
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import type { FlatFrameNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";

/**
 * Compute the effective theme for a node by walking up its ancestor chain.
 * Returns the innermost ancestor frame's themeOverride, or the global active theme.
 */
export function getEffectiveThemeForNode(nodeId: string): ThemeName {
  const { parentById, nodesById } = useSceneStore.getState();
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const n = nodesById[cur];
    if (n?.type === "frame" && (n as FlatFrameNode).themeOverride) {
      return (n as FlatFrameNode).themeOverride as ThemeName;
    }
    cur = parentById[cur] ?? null;
  }
  return useThemeStore.getState().activeTheme;
}
```

- [ ] **Step 4: Update `embedRenderer.ts` to use the util**

In `src/pixi/renderers/embedRenderer.ts`: delete the local `getEffectiveThemeForNode` function (lines ~27-38) and its now-unused imports (`FlatFrameNode`, `useThemeStore`, `ThemeName` if unused elsewhere), and add:

```ts
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
```

- [ ] **Step 5: Run tests + lint to verify**

Run: `npm test -- nodeThemeUtils && npm run lint`
Expected: PASS (2 tests); lint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/nodeThemeUtils.ts src/utils/__tests__/nodeThemeUtils.test.ts src/pixi/renderers/embedRenderer.ts
git commit -m "refactor(embed): extract getEffectiveThemeForNode to shared util"
```

---

### Task 3: Screen-rect geometry helper

Pure function mapping a world rect + viewport to a device-pixel-snapped screen rect. Unit-testable without DOM.

**Files:**
- Create: `src/components/canvas/embedLayerGeometry.ts`
- Test: `src/components/canvas/__tests__/embedLayerGeometry.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  interface ScreenRect { left: number; top: number; width: number; height: number }
  function embedScreenRect(
    absX: number, absY: number, width: number, height: number,
    scale: number, panX: number, panY: number, dpr: number,
  ): ScreenRect
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/components/canvas/__tests__/embedLayerGeometry.test.ts
import { describe, it, expect } from "vitest";
import { embedScreenRect } from "../embedLayerGeometry";

describe("embedScreenRect", () => {
  it("maps world rect through scale + pan", () => {
    expect(embedScreenRect(100, 100, 200, 150, 2, 50, 50, 1)).toEqual({
      left: 250,
      top: 250,
      width: 400,
      height: 300,
    });
  });

  it("snaps to device pixels", () => {
    // absX*scale+panX = 10*1.5+0 = 15; with dpr=2 → round(30)/2 = 15
    const r = embedScreenRect(10, 10, 33, 33, 1.5, 0, 0, 2);
    expect(r.left).toBe(15);
    expect(r.width).toBe(Math.round(33 * 1.5 * 2) / 2); // 49.5
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- embedLayerGeometry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/components/canvas/embedLayerGeometry.ts
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Round a CSS px value to the nearest device pixel. */
function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

/**
 * Map a world-space rect to a device-pixel-snapped screen rect, given the
 * viewport pan/zoom. Mirrors the math used by InlineEmbedEditor.
 */
export function embedScreenRect(
  absX: number,
  absY: number,
  width: number,
  height: number,
  scale: number,
  panX: number,
  panY: number,
  dpr: number,
): ScreenRect {
  return {
    left: snap(absX * scale + panX, dpr),
    top: snap(absY * scale + panY, dpr),
    width: snap(width * scale, dpr),
    height: snap(height * scale, dpr),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- embedLayerGeometry`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/embedLayerGeometry.ts src/components/canvas/__tests__/embedLayerGeometry.test.ts
git commit -m "feat(embed): add screen-rect geometry helper for the DOM overlay"
```

---

### Task 4: `EmbedLayer` component and mount in `PixiCanvas`

The DOM overlay itself: one Shadow-DOM host per embed, positioned imperatively, with `pointer-events: auto` only for the active embed.

**Files:**
- Create: `src/components/canvas/EmbedLayer.tsx`
- Modify: `src/pixi/PixiCanvas.tsx` (render `<EmbedLayer />` inside the container)
- Test: `src/components/canvas/__tests__/EmbedLayer.test.tsx` (create)

**Interfaces:**
- Consumes: `embedScreenRect` (Task 3), `getEffectiveThemeForNode` (Task 2), `activeEmbedId` (Task 1), `mountHtmlWithBodyStyles` (`@/utils/embedHtmlUtils`), `buildVariableStyleBlock` (`@/utils/variableCssUtils`), `getNodeAbsolutePositionWithLayout` (`@/utils/nodeUtils`).
- Produces: `export function EmbedLayer(): JSX.Element`. Each embed host carries `data-embed-id={nodeId}` and an attached open shadow root.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/canvas/__tests__/EmbedLayer.test.tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function seedEmbed(): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1", type: "embed", name: "Code", x: 0, y: 0,
        width: 100, height: 80, htmlContent: "<p id='hello'>hi</p>",
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<EmbedLayer />", () => {
  beforeEach(() => { resetStores(); seedEmbed(); });
  afterEach(() => cleanup());

  it("renders a shadow-DOM host per embed with mounted content", () => {
    const { container } = render(<EmbedLayer />);
    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    expect(host!.shadowRoot!.querySelector("#hello")?.textContent).toBe("hi");
  });

  it("is pointer-events:none by default and auto when active", () => {
    const { container } = render(<EmbedLayer />);
    const host = () => container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    expect(host().style.pointerEvents).toBe("none");
    act(() => { useSelectionStore.getState().setActiveEmbed("e1"); });
    expect(host().style.pointerEvents).toBe("auto");
  });

  it("removes the host when the embed node is deleted", () => {
    const { container } = render(<EmbedLayer />);
    expect(container.querySelector('[data-embed-id="e1"]')).not.toBeNull();
    act(() => {
      useSceneStore.setState({
        nodesById: {}, parentById: {}, childrenById: {}, rootIds: [],
        componentArtifactsById: {}, _cachedTree: null,
      });
    });
    expect(container.querySelector('[data-embed-id="e1"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- EmbedLayer`
Expected: FAIL — module `../EmbedLayer` not found.

- [ ] **Step 3: Implement `EmbedLayer.tsx`**

```tsx
// src/components/canvas/EmbedLayer.tsx
import { useEffect, useMemo, useRef } from "react";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { mountHtmlWithBodyStyles } from "@/utils/embedHtmlUtils";
import { buildVariableStyleBlock } from "@/utils/variableCssUtils";
import { getEffectiveThemeForNode } from "@/utils/nodeThemeUtils";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { EmbedNode } from "@/types/scene";
import { embedScreenRect } from "./embedLayerGeometry";

/** One Shadow-DOM host for a single embed node, synced to the viewport. */
function EmbedHost({ nodeId }: { nodeId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const node = useSceneStore((s) => s.nodesById[nodeId]) as EmbedNode | undefined;
  const isActive = useSelectionStore((s) => s.activeEmbedId === nodeId);

  const htmlContent = node?.htmlContent;
  const width = node?.width;
  const height = node?.height;

  // Position/scale the host imperatively from the viewport (no React re-render).
  useEffect(() => {
    const position = () => {
      const host = hostRef.current;
      const content = contentRef.current;
      if (!host || !content) return;
      const scene = useSceneStore.getState();
      const n = scene.nodesById[nodeId] as EmbedNode | undefined;
      if (!n) return;
      const calc = useLayoutStore.getState().calculateLayoutForFrame;
      const abs = getNodeAbsolutePositionWithLayout(scene.getNodes(), nodeId, calc);
      if (!abs) return;
      const { scale, x: panX, y: panY } = useViewportStore.getState();
      const dpr = window.devicePixelRatio || 1;
      const rect = embedScreenRect(abs.x, abs.y, n.width, n.height, scale, panX, panY, dpr);
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      host.style.width = `${rect.width}px`;
      host.style.height = `${rect.height}px`;
      content.style.transform = `scale(${scale})`;
    };
    position();
    const unsubViewport = useViewportStore.subscribe(position);
    const unsubLayout = useLayoutStore.subscribe(position);
    return () => { unsubViewport(); unsubLayout(); };
  }, [nodeId]);

  // (Re)mount embed content into the shadow root on html/size/theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || htmlContent == null || width == null || height == null) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const content = document.createElement("div");
    content.style.transformOrigin = "top left";
    content.style.width = `${width}px`;
    content.style.height = `${height}px`;
    content.style.overflow = "auto";
    const themeBlock = buildVariableStyleBlock(undefined, getEffectiveThemeForNode(nodeId));
    const html = themeBlock ? htmlContent + themeBlock : htmlContent;
    mountHtmlWithBodyStyles(content, html, width, height);
    shadow.appendChild(content);
    contentRef.current = content;

    // Re-apply current scale to the freshly mounted content.
    content.style.transform = `scale(${useViewportStore.getState().scale})`;

    return () => { contentRef.current = null; };
  }, [nodeId, htmlContent, width, height]);

  if (!node) return null;

  return (
    <div
      ref={hostRef}
      data-embed-id={nodeId}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "hidden",
        pointerEvents: isActive ? "auto" : "none",
      }}
    />
  );
}

/**
 * DOM overlay that renders every embed node as live browser DOM above the Pixi
 * canvas. Always on top; transparent to pointer events except for the active
 * (double-click-entered) embed.
 */
export function EmbedLayer() {
  const nodesById = useSceneStore((s) => s.nodesById);
  const embedIds = useMemo(
    () => Object.keys(nodesById).filter((id) => nodesById[id]?.type === "embed"),
    [nodesById],
  );

  return (
    <div
      data-embed-layer
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {embedIds.map((id) => (
        <EmbedHost key={id} nodeId={id} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- EmbedLayer`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount `EmbedLayer` in `PixiCanvas`**

In `src/pixi/PixiCanvas.tsx`: add the import near the other component imports:

```tsx
import { EmbedLayer } from "@/components/canvas/EmbedLayer";
```

Inside the returned container `<div ref={containerRef} data-canvas ...>`, add `<EmbedLayer />` as the first child (before the `selectedEmbedNode && ...` block), so it stacks above the Pixi `<canvas>` (which is appended imperatively) but below the action bar (`z-20`) and inline editors (`zIndex: 100`):

```tsx
      <EmbedLayer />
      {selectedEmbedNode && selectedEmbedPosition && editingMode !== "embed" && (
```

- [ ] **Step 6: Verify build + full test run**

Run: `npm run build && npm test -- EmbedLayer`
Expected: build passes; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/canvas/EmbedLayer.tsx src/components/canvas/__tests__/EmbedLayer.test.tsx src/pixi/PixiCanvas.tsx
git commit -m "feat(embed): render code layers as a Shadow-DOM overlay above the canvas"
```

---

### Task 5: Remove the embed texture from the live Pixi render

Embeds now render in the DOM, so the Pixi side keeps only an empty (invisible) container for hit-testing/selection. The texture helpers (`htmlTexture/*`) stay in the repo for the future screenshot path but are no longer called.

**Files:**
- Modify: `src/pixi/renderers/embedRenderer.ts` (stub out live texture rendering)
- Test: `src/pixi/renderers/__tests__/embedRenderer.test.ts` (create)

**Interfaces:**
- Consumes: `EmbedNode`.
- Produces (signatures preserved so callers in `renderers/index.ts` and `syncResolution.ts` keep compiling): `createEmbedContainer(node): Container`, `updateEmbedContainer(container, node, prev): void`, `updateEmbedResolution(container, node, resolution): Promise<void>`, `setEmbedResolution(resolution): void`. All texture work removed; `createEmbedContainer` returns an empty `Container`; the resolution functions become no-ops.

- [ ] **Step 1: Write the failing test**

```ts
// src/pixi/renderers/__tests__/embedRenderer.test.ts
import { describe, it, expect } from "vitest";
import { Sprite } from "pixi.js";
import { createEmbedContainer, updateEmbedContainer } from "../embedRenderer";
import type { EmbedNode } from "@/types/scene";

const embed = (html: string): EmbedNode =>
  ({ id: "e1", type: "embed", name: "Code", x: 0, y: 0, width: 100, height: 80, htmlContent: html } as unknown as EmbedNode);

describe("embedRenderer (DOM-overlay era)", () => {
  it("creates an empty container with no texture sprite", () => {
    const c = createEmbedContainer(embed("<p>hi</p>"));
    expect(c.children.some((ch) => ch instanceof Sprite)).toBe(false);
  });

  it("update does not add a texture sprite", () => {
    const c = createEmbedContainer(embed("<p>a</p>"));
    updateEmbedContainer(c, embed("<p>b</p>"), embed("<p>a</p>"));
    expect(c.children.some((ch) => ch instanceof Sprite)).toBe(false);
  });
});
```

Note: this test uses Pixi `Container`/`Sprite` classes (pure objects, no `Application`) — it does **not** initialize a renderer, so it stays within the "no PixiJS init in unit tests" rule.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- embedRenderer`
Expected: FAIL — current `createEmbedContainer` triggers async texture rendering / sprite creation paths.

- [ ] **Step 3: Replace `embedRenderer.ts` with the DOM-era stub**

Replace the entire contents of `src/pixi/renderers/embedRenderer.ts` with:

```ts
import { Container } from "pixi.js";
import type { EmbedNode } from "@/types/scene";

/**
 * Embeds ("code layers") now render as a Shadow-DOM overlay above the canvas
 * (see EmbedLayer). The Pixi side keeps only an empty, invisible container so
 * hit-testing, selection, drag and smart guides keep operating on the real
 * scene node. The HTML→texture pipeline (renderers/htmlTexture/*) is retained
 * for a future screenshot/export path but is intentionally not called here.
 */
export function createEmbedContainer(_node: EmbedNode): Container {
  return new Container();
}

export function updateEmbedContainer(
  _container: Container,
  _node: EmbedNode,
  _prev: EmbedNode,
): void {
  // No-op: content lives in the DOM overlay.
}

/** Retained for syncResolution callers; embeds no longer use textures. */
export function updateEmbedResolution(
  _container: Container,
  _node: EmbedNode,
  _resolution: number,
): Promise<void> {
  return Promise.resolve();
}

/** Retained for syncResolution callers; embeds no longer use textures. */
export function setEmbedResolution(_resolution: number): void {
  // No-op.
}
```

(Parameters are prefixed `_` to satisfy `noUnusedParameters`.)

- [ ] **Step 4: Run test + build + lint**

Run: `npm test -- embedRenderer && npm run build && npm run lint`
Expected: tests PASS; build passes (callers in `renderers/index.ts` and `syncResolution.ts` still type-check); lint 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pixi/renderers/embedRenderer.ts src/pixi/renderers/__tests__/embedRenderer.test.ts
git commit -m "refactor(embed): stop rendering embed textures in Pixi (DOM overlay takes over)"
```

---

### Task 6: Double-click enters the active (interactive) state

Replace the two `startEditing(id, "embed")` calls on double-click with `setActiveEmbed(id)`. Text editing stays available via the existing `EmbedActionBar` pencil button (`handleInlineEdit` → `startEditing(node.id, "embed")`), which is unchanged.

**Files:**
- Modify: `src/pixi/interaction/pixiInteractionCore.ts` (two embed branches in the dblclick handler)

**Interfaces:**
- Consumes: `setActiveEmbed` (Task 1).

- [ ] **Step 1: Update the deepest-child embed branch**

In `src/pixi/interaction/pixiInteractionCore.ts`, in the dblclick handler, find:

```ts
          } else if (childNode?.type === "embed") {
            useSelectionStore.getState().startEditing(childId, "embed");
          }
```

Replace the embed line with:

```ts
          } else if (childNode?.type === "embed") {
            useSelectionStore.getState().setActiveEmbed(childId);
          }
```

- [ ] **Step 2: Update the direct-hit embed branch**

Find:

```ts
    } else if (node.type === "embed") {
      useSelectionStore.getState().startEditing(hitId, 'embed');
    } else if (node.type === "frame" || node.type === "group") {
```

Replace the embed line with:

```ts
    } else if (node.type === "embed") {
      useSelectionStore.getState().setActiveEmbed(hitId);
    } else if (node.type === "frame" || node.type === "group") {
```

(There may also be ref-instance embed branches around `pixiInteractionCore.ts:468/495` that call `startEditing(..., "embed")`. Leave those as-is — instance embeds are out of scope for v1, per the spec.)

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build passes; lint 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/pixi/interaction/pixiInteractionCore.ts
git commit -m "feat(embed): double-click enters live interactive state instead of text edit"
```

---

### Task 7: E2E smoke — embed renders, selects, and goes interactive

Verify the full loop in a real browser: an embed renders as a DOM host over the canvas, selection/drag still work, and double-click makes it interactive.

**Files:**
- Create: `e2e/embed-dom-layer.spec.ts`

**Interfaces:**
- Consumes: `window.__sceneStore` (exposed in dev mode, per `pen-editor/CLAUDE.md`), `window.__selectionStore` if exposed; otherwise drive via UI. Confirm exposed globals in `src/main.tsx` before writing assertions.

- [ ] **Step 1: Confirm exposed dev globals**

Run: `grep -n "window.__" src/main.tsx`
Expected: shows `__sceneStore` (and possibly `__selectionStore`, `__viewportStore`). Use whichever are present; if only `__sceneStore` is exposed, add `__selectionStore` exposure in `src/main.tsx` (dev-only block) the same way and include it in this commit.

- [ ] **Step 2: Write the e2e test**

```ts
// e2e/embed-dom-layer.spec.ts
import { test, expect } from "@playwright/test";

test("embed renders as a DOM overlay and enters interactive state", async ({ page }) => {
  await page.goto("/");

  // Seed an embed node directly into the scene store (dev-only global).
  await page.evaluate(() => {
    const scene = (window as unknown as { __sceneStore: { setState: (s: unknown) => void } }).__sceneStore;
    scene.setState({
      nodesById: {
        e1: { id: "e1", type: "embed", name: "Code", x: 40, y: 40, width: 200, height: 120,
              htmlContent: "<div id='content' style='height:400px'>scroll me</div>" },
      },
      parentById: { e1: null },
      childrenById: {},
      rootIds: ["e1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
  });

  // The DOM host exists over the canvas with mounted shadow content.
  const host = page.locator('[data-embed-id="e1"]');
  await expect(host).toBeVisible();
  expect(await host.evaluate((el) => !!(el as HTMLElement).shadowRoot)).toBe(true);

  // Default: not interactive (pointer-events: none).
  expect(await host.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

  // Double-click enters interactive state → pointer-events: auto.
  await host.dblclick({ force: true });
  await expect
    .poll(async () => host.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe("auto");
});
```

- [ ] **Step 3: Run the e2e test**

Run: `npm run test:e2e -- embed-dom-layer`
Expected: PASS. (Playwright starts the Vite dev server itself.)

If `dblclick` does not land because the host is `pointer-events: none`, the click passes through to the Pixi canvas at the embed's screen position — that is the intended path (Pixi's dblclick handler resolves the embed and calls `setActiveEmbed`). The `{ force: true }` plus screen-position click reproduces a real user double-click on the embed area.

- [ ] **Step 4: Commit**

```bash
git add e2e/embed-dom-layer.spec.ts src/main.tsx
git commit -m "test(e2e): embed DOM overlay renders, selects, and goes interactive"
```

---

## Self-Review Notes

- **Spec coverage:** §Architecture/layer mounting → Task 4; positioning/zoom → Tasks 3+4; remove texture path → Task 5; active/interactive state → Tasks 1+6; gesture reconciliation (text-edit on button) → Task 6 (button already exists in `EmbedActionBar`); theme vars/fonts reuse → Tasks 2+4; testing → unit Tasks 1-5 + e2e Task 7. Screenshots (omit embeds) need no code — automatic once embeds leave the Pixi render (Task 5). Out-of-scope items (TSX, instance embeds, frame clipping) intentionally have no task.
- **Type consistency:** `activeEmbedId` / `setActiveEmbed` used identically across Tasks 1, 4, 6. `embedScreenRect` signature identical in Tasks 3 and 4. `getEffectiveThemeForNode` signature identical in Tasks 2 and 4.
- **Known v1 limitation (documented in spec):** per-viewport-tick `getNodeAbsolutePositionWithLayout` is O(tree) per embed; acceptable for v1, optimization deferred.
