# Performance Optimization Plan: Figma-like Performance for 5K+ Nodes

## Problem

Every mutation (drag, resize, text edit) triggers 3 full tree traversals + JSON deep clone:
```
updateNode(id, updates) ->
  1. saveHistory(state.nodes)      // JSON.parse(JSON.stringify(allNodes)) - deep clone
  2. updateNodeRecursive(nodes, id) // O(n) tree walk to find node
  3. withRebuiltIndex(nextNodes)    // O(n) tree walk to rebuild all indices
```
Plus `state.nodes` subscription in 10+ components causes ALL nodes to re-render on ANY change.

## Phase 1: Flat Node Map (biggest impact)

**Replace nested tree with flat `Map<string, Node>` + structural indices.**

### 1.1 New data model in `src/types/scene.ts`

Container nodes (`FrameNode`, `GroupNode`) get `childIds: string[]` instead of `children: SceneNode[]`. Leaf nodes unchanged. Add type alias `FlatSceneNode`.

### 1.2 Rewrite `src/store/sceneStore.ts`

**New state shape:**
```ts
nodesById: Map<string, FlatSceneNode>   // primary storage
parentById: Map<string, string | null>  // maintained incrementally
childrenById: Map<string, string[]>     // maintained incrementally
rootIds: string[]
_cachedTree: SceneNode[] | null         // lazy, for serialization
```

**Key: `updateNode` becomes O(1):**
```ts
updateNode: (id, updates) => {
  const next = new Map(state.nodesById);
  next.set(id, { ...next.get(id)!, ...updates });
  return { nodesById: next, _cachedTree: null };
  // parentById, childrenById UNCHANGED for property updates
}
```

**Eliminate these O(n) recursive functions:**
- `updateNodeRecursive` -> direct Map.set
- `deleteNodeRecursive` -> Map.delete + update parent's childIds
- `addChildToFrameRecursive` -> update parent's childIds + Map.set
- `extractNodeRecursive` -> Map.get + remove from parent's childIds
- `findNodeInTree` -> Map.get (O(1))
- `buildSceneIndex` / `withRebuiltIndex` -> eliminated entirely

**Tree reconstruction** (only for save/export):
```ts
function buildTree(rootIds, nodesById): SceneNode[] { /* recursive build */ }
```

**Backward compat**: `getNodes()` lazily builds and caches tree from flat map.

### 1.3 Migrate all `state.nodes` consumers (10+ files)

Files that subscribe to `state.nodes`:
- `src/components/Canvas.tsx:48` -> subscribe to `rootIds` + `nodesById`
- `src/components/nodes/RenderNode.tsx:65` -> remove; use `getState().nodesById` imperatively in event handlers
- `src/components/nodes/FrameRenderer.tsx:67` -> use `childrenById.get(node.id)` + `nodesById`
- `src/components/nodes/GroupRenderer.tsx:46` -> same
- `src/components/nodes/InstanceRenderer.tsx:59` -> same
- `src/components/LayersPanel.tsx:429` -> use `rootIds` + `childrenById` + `nodesById`
- `src/components/Toolbar.tsx:18`
- `src/components/ComponentsPanel.tsx:10`
- `src/hooks/useNodePlacement.ts:12`
- Various property panels in `src/components/properties/`

### 1.4 File load/save adaptation in `src/utils/fileUtils.ts`

- `deserializeDocument()`: flatten nested tree into Map on load
- `serializeDocument()`: call `buildTree()` to reconstruct nested tree for save

---

## Phase 2: Patch-based History

**Replace `JSON.parse(JSON.stringify(nodes))` with lightweight patches.**

### 2.1 Rewrite `src/store/historyStore.ts`

```ts
interface HistoryPatch {
  nodeChanges: Map<string, { before: FlatSceneNode | null; after: FlatSceneNode | null }>;
  childrenChanges: Map<string, { before: string[]; after: string[] }>;
  parentChanges: Map<string, { before: string | null; after: string | null }>;
  rootIdsBefore: string[];
  rootIdsAfter: string[];
}
```

- Property update on 1 node -> patch stores only that 1 node's before/after (~200 bytes vs ~1MB)
- Undo = apply patch in reverse; Redo = apply forward
- Memory: 50 patches * ~1KB = ~50KB vs 50 * ~1MB = ~50MB

### 2.2 Debounce history during drag in `src/components/nodes/RenderNode.tsx`

- `handleDragStart`: call `history.startBatch()`, capture initial state
- During drag: use `updateNodeWithoutHistory()`
- `handleDragEnd`: call `history.endBatch()`, commit single patch

Same for transform (resize/rotate): already uses `startBatch`/`endBatch` partially, make it complete.

---

## Phase 3: Granular Subscriptions & React Optimizations

### 3.1 Fix RenderNode subscriptions (`src/components/nodes/RenderNode.tsx`)

```ts
// BEFORE (causes ALL nodes to re-render on ANY change):
const nodes = useSceneStore((state) => state.nodes);

// AFTER (only re-render when this specific node changes):
// Remove the subscription. Use getState() imperatively in event handlers.
const nodesById = useSceneStore.getState().nodesById;
```

### 3.2 Memoize all child renderers

Wrap in `React.memo()`:
- `src/components/nodes/RectRenderer.tsx`
- `src/components/nodes/TextRenderer.tsx`
- `src/components/nodes/EllipseRenderer.tsx`
- `src/components/nodes/LineRenderer.tsx`
- `src/components/nodes/PolygonRenderer.tsx`
- `src/components/nodes/PathRenderer.tsx`

### 3.3 Stabilize callbacks in RenderNode

Wrap event handlers in `useCallback`. Use `useRef` for values that change frequently (node.x, node.y) to avoid callback invalidation.

### 3.4 Improve LayersPanel virtualization (`src/components/LayersPanel.tsx`)

- `flattenLayers()` currently walks entire nested tree. With flat map, iterate using `rootIds` + `childrenById` + `expandedFrameIds` - no recursive tree access.
- Fix `LayerItem` subscriptions: `useSelectionStore()` destructure -> granular `useSelectionStore(s => s.selectedIds.includes(id))`.

---

## Phase 4: PixiJS Migration (Konva -> WebGL)

**Status**: Phases 1, 3 complete. Phase 4 complete — PixiJS is now the default renderer. Konva files remain as dead code pending cleanup.

### Architecture Overview

Replace Konva (Canvas 2D + react-konva React reconciliation) with PixiJS v8 (WebGL/WebGPU).
React is removed from the rendering loop entirely — Zustand store subscriptions drive PixiJS updates directly.
React continues to render all UI panels (LayersPanel, PropertyEditor, Toolbar, InlineTextEditor, etc.).

### 4.1 Install PixiJS and create canvas wrapper with feature flag

**Install**: `npm install pixi.js`

**New file: `src/pixi/PixiCanvas.tsx`** — React component that:
- Creates a `<div>` ref, mounts `Application` inside it via `app.init({ resizeTo: container, antialias: true, backgroundAlpha: 0 })`
- Exposes feature flag: `const USE_PIXI = localStorage.getItem('use-pixi') === '1'` (toggle in App.tsx)
- Creates scene graph structure:
  ```
  app.stage
    └── viewport (Container) — pan/zoom transforms applied here
         └── sceneRoot (Container) — all node containers live here
  ```
- `viewport` uses `isRenderGroup = true` for GPU-level transform (PixiJS v8 Render Groups)
- On unmount, calls `app.destroy(true, { children: true })`

**Modify: `src/App.tsx`** — Toggle between `<Canvas />` and `<PixiCanvas />`

### 4.2 Implement viewport pan/zoom in PixiJS

**New file: `src/pixi/pixiViewport.ts`**

Subscribe to `useViewportStore` and apply transforms to the viewport container:
```ts
useViewportStore.subscribe((state) => {
  viewport.position.set(state.x, state.y);
  viewport.scale.set(state.scale);
});
```

Pointer handlers on the `<canvas>` element (NOT PixiJS events — want raw DOM events for panning):
- **Wheel**: Reuse existing `useViewportStore.startSmoothZoom()` — same math, just wire to canvas wheel event
- **Middle-click / Space+drag**: Set `isPanning`, update `setPosition(x, y)` — same as current Konva handler
- Background click → `clearSelection()`

### 4.3 Implement node renderers (all types)

**New file: `src/pixi/renderers.ts`** — Pure functions that create/update PixiJS display objects.

Each renderer returns a PixiJS `Container` with children. No React involved.

**Registry**: `Map<string, { container: Container; nodeVersion: FlatSceneNode }>` — maps node ID to its PixiJS object + last-seen node reference for dirty checking.

| SceneNode | PixiJS Objects | Notes |
|-----------|---------------|-------|
| `FrameNode` | `Container` + `Graphics` bg + optional `Graphics` mask for clip | `container.mask = clipGraphics` for `node.clip` |
| `GroupNode` | `Container` | Children rendered inside |
| `RectNode` | `Graphics` `.roundRect()` | cornerRadius, fill, stroke |
| `EllipseNode` | `Graphics` `.ellipse()` | |
| `TextNode` | `Text` (PixiJS built-in) | `style: { fontFamily, fontSize, fill, wordWrap, wordWrapWidth }` |
| `LineNode` | `Graphics` `.moveTo().lineTo()` | From `node.points` array |
| `PolygonNode` | `Graphics` `.poly()` | From `node.points`, closed |
| `PathNode` | `Graphics` `.svg(node.geometry)` | PixiJS v8 `svg()` parses SVG path data |
| `RefNode` | Resolve component + render children with overrides | Reuse same renderer functions |

**Renderer function signature**:
```ts
function createNodeContainer(node: FlatSceneNode, nodesById: Record<string, FlatSceneNode>): Container
function updateNodeContainer(container: Container, node: FlatSceneNode, prev: FlatSceneNode): void
```

**Gradient fills**: Use `FillGradient` from PixiJS v8 for `node.gradientFill`.
**Image fills**: Use `Sprite` with `Assets.load(url)` for `node.imageFill`.
**Shadows**: Use `DropShadowFilter` from `@pixi/filter-drop-shadow` or PixiJS v8 built-in filter.
**Opacity**: Set `container.alpha = node.opacity`.
**Visibility**: Set `container.visible = node.visible !== false`.
**Rotation/flip**: Set `container.rotation` (radians!), `container.scale.x = flipX ? -1 : 1`.

### 4.4 Implement container renderers (Frame, Group) with clipping

**Frames with clip**:
```ts
const mask = new Graphics();
if (node.cornerRadius) {
  mask.roundRect(0, 0, width, height, node.cornerRadius);
} else {
  mask.rect(0, 0, width, height);
}
mask.fill(0xffffff);
container.mask = mask;
container.addChild(mask);
```

**Child rendering**: Iterate `childrenById[node.id]` → for each childId, look up or create child container, add as child of frame container. Order matters — children added in array order.

**Frame caching**: For frames with 30+ children, use `container.cacheAsTexture(true)` (PixiJS v8 API). Clear during drag: `container.cacheAsTexture(false)`.

**Group**: Same as Frame but no background, no clip, no auto-layout.

### 4.5 Direct store subscription — bypass React for rendering

**New file: `src/pixi/pixiSync.ts`** — The core sync engine.

```ts
export function createPixiSync(sceneRoot: Container) {
  const registry = new Map<string, { container: Container; node: FlatSceneNode }>();

  // Full rebuild on initial load
  function fullRebuild(state: SceneState) { ... }

  // Incremental update — only changed nodes
  function incrementalUpdate(state: SceneState, prev: SceneState) {
    if (state.nodesById === prev.nodesById) return; // no changes

    // Check each node for changes (reference equality via flat map)
    for (const id of Object.keys(state.nodesById)) {
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      if (node !== prevNode) {
        const entry = registry.get(id);
        if (entry) {
          updateNodeContainer(entry.container, node, entry.node);
          entry.node = node;
        }
      }
    }

    // Handle added/removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        // Node removed
        const entry = registry.get(id);
        if (entry) {
          entry.container.parent?.removeChild(entry.container);
          entry.container.destroy({ children: true });
          registry.delete(id);
        }
      }
    }
    for (const id of Object.keys(state.nodesById)) {
      if (!prev.nodesById[id]) {
        // Node added — create and attach to parent
        createAndAttachNode(id, state);
      }
    }

    // Handle structural changes (parent/children order)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state);
    }
  }

  // Subscribe to Zustand store
  const unsubScene = useSceneStore.subscribe(
    (state, prev) => incrementalUpdate(state, prev)
  );

  return { destroy: () => unsubScene() };
}
```

**Also subscribe to**:
- `useSelectionStore` → update selection outlines (highlight selected nodes)
- `useHoverStore` → update hover outlines
- `useViewportStore` → update viewport container transforms (done in 4.2)
- `useDragStore` → show/hide drop indicator
- `useSmartGuideStore` → render smart guide lines
- `useThemeStore` / `useVariableStore` → re-resolve colors on theme change

### 4.6 Implement selection/transformer UI

**PixiJS has no built-in Transformer.** Implement a lightweight custom one.

**New file: `src/pixi/SelectionOverlay.ts`** — Renders on a separate Container above sceneRoot.

```
app.stage
  └── viewport
       ├── sceneRoot (all nodes)
       ├── overlayContainer (guides, drop indicators, marquee)
       └── selectionContainer (selection outlines + transform handles)
```

**Selection outlines**: For each selected node, draw a `Graphics` rect at the node's absolute position. Blue stroke (#0d99ff), 1px / scale.

**Transform handles**: 4 corner handles (8×8 white squares with blue border). On drag:
- Calculate new width/height from handle movement
- Call `updateNode(id, { x, y, width, height })` — same store API as before
- Constrain minimum size to 5px

**Size labels**: HTML overlay (React) positioned absolutely — already exists as `NodeSizeLabel`, reuse via DOM positioning based on PixiJS world-to-screen coords.

**Frame name labels**: Same approach — React DOM elements positioned using PixiJS coordinates.

### 4.7 Implement interaction (click, drag, hover, transform)

**Hit testing**: Use PixiJS built-in `eventMode: 'static'` on node containers.

**Click handler** (on each node container):
```ts
container.on('pointerdown', (e) => {
  // Same logic as current handleClick in RenderNode.tsx
  // Respect selectOverrideId for nested selection
  // Shift+click → addToSelection, else → select
});
```

**Drag handler**:
- `pointerdown` → record start position, call `select(id)`, compute snap targets
- `globalpointermove` → compute delta, apply smart guide snapping, move container visually
- `pointerup` → commit position via `updateNode(id, { x, y })`, clear guides

**Hover handler**: Listen at viewport level, use `renderer.events.rootBoundary` for hit testing, or listen to `pointerover`/`pointerout` on each node container → update `useHoverStore`.

**Double-click**: `dblclick` event on frame containers → `enterContainer(id)`, find child at position.

**Auto-layout drag**: Same reordering logic as current — calculate drop position, show drop indicator, commit via `moveNode`.

**Keyboard shortcuts**: Reuse existing `useCanvasKeyboardShortcuts` hook — it's React-based and doesn't depend on Konva.

**Drawing mode** (rect/frame/text tool): Listen for pointer events on canvas background → draw preview rect in overlay → create node on release.

**Marquee selection**: Track pointer from background → draw rect in overlay → on release, find all nodes intersecting the rect → `setSelectedIds(...)`.

### 4.8 Overlay rendering

**Smart guides**: Subscribe to `useSmartGuideStore` → draw lines in overlayContainer using `Graphics`.
**Drop indicator**: Subscribe to `useDragStore.dropIndicator` → draw in overlayContainer.
**Measure overlay**: Subscribe to `useMeasureStore` → draw distance lines.
**Marquee rect**: Draw during pointer drag on background.

All overlays use `Graphics` in a separate container. Scale-compensated: `strokeWidth = 1 / viewport.scale.x`.

### 4.9 Inline text editing

Reuse existing `InlineTextEditor` React component. Position it as an absolute-positioned HTML `<div>` over the canvas:
- On text node double-click: get node's screen position from PixiJS world-to-screen transform
- Show `<InlineTextEditor>` at that position (same as current behavior)
- Hide the PixiJS text object while editing (`container.visible = false`)

Similarly for `InlineNameEditor` (frame name editing).

### 4.10 Migration path and feature flag

**Feature flag**: `USE_PIXI` in App.tsx, toggled via localStorage.

**Implementation order**:
1. Install pixi.js, create PixiCanvas shell (4.1)
2. Viewport pan/zoom working (4.2)
3. Basic renderers: Rect, Ellipse, Text (4.3 partial)
4. Store sync engine (4.5)
5. Frame + Group with clipping (4.4)
6. Path, Line, Polygon renderers (4.3 complete)
7. Selection overlay + transform handles (4.6)
8. Click, drag, hover interactions (4.7)
9. Smart guides, drop indicator, marquee (4.8)
10. Inline text editing (4.9)
11. Instance (RefNode) rendering (4.3 complete)
12. Image fills, gradient fills, shadows
13. Test with large document, fix visual regressions
14. Default to PixiJS, remove Konva

### Critical files (Phase 4)

| File | Action |
|------|--------|
| `src/pixi/PixiCanvas.tsx` | NEW — React wrapper mounting PixiJS Application |
| `src/pixi/renderers.ts` | NEW — Node renderer functions (create/update PixiJS objects) |
| `src/pixi/pixiSync.ts` | NEW — Store subscription engine, syncs Zustand → PixiJS |
| `src/pixi/pixiViewport.ts` | NEW — Viewport pan/zoom subscription |
| `src/pixi/SelectionOverlay.ts` | NEW — Selection outlines + transform handles |
| `src/pixi/OverlayRenderer.ts` | NEW — Smart guides, drop indicator, marquee, measure |
| `src/pixi/pixiInteraction.ts` | NEW — Click/drag/hover/double-click handlers |
| `src/App.tsx` | MODIFY — Feature flag toggle between Canvas and PixiCanvas |
| `package.json` | MODIFY — Add `pixi.js` dependency |

---

## Phase 5: Advanced (optional, after Phases 1-4)

- **Spatial indexing** (`rbush` R-tree) for O(log n) viewport queries
- **Level-of-detail**: skip children / simplify shapes when < 4px on screen
- **Offscreen text measurement** via Web Worker + OffscreenCanvas
- **Smart guide optimization**: spatial query instead of full tree walk for snap targets

---

## Implementation Order

```
Phase 1 (Flat Map) -- FIRST, foundation for everything
    |
    +---> Phase 2 (Patch History) -- can overlap with Phase 1 tail
    |
    +---> Phase 3 (Subscriptions & Memo) -- can overlap with Phase 2
              |
              +---> Phase 4 (PixiJS) -- after Phases 1-3 are stable
                        |
                        +---> Phase 5 (Advanced) -- additive, any time after Phase 1
```

## Progress Tracker

- [x] Phase 1: Flat Node Map — COMPLETE
- [ ] Phase 2: Patch-based History — SKIPPED for now
- [x] Phase 3: Granular Subscriptions & React Optimizations — COMPLETE
- [ ] **Phase 4: PixiJS Migration — IN PROGRESS**
  - [x] 4.1 Install PixiJS + PixiCanvas wrapper + feature flag (`src/pixi/PixiCanvas.tsx`, `src/App.tsx`)
  - [x] 4.2 Viewport pan/zoom subscription (`src/pixi/pixiViewport.ts`)
  - [x] 4.3 Node renderers: Rect, Ellipse, Text, Line, Polygon, Path, Ref (`src/pixi/renderers.ts`)
  - [x] 4.4 Container renderers: Frame (bg + clip mask + children), Group (`src/pixi/renderers.ts`)
  - [x] 4.5 Store sync engine: full rebuild + incremental updates + child reconciliation (`src/pixi/pixiSync.ts`)
  - [x] 4.6 Selection overlay: outlines, hover, corner transform handles (`src/pixi/SelectionOverlay.ts`)
  - [x] 4.7 Interactions: click/select, drag+snap, pan, zoom, draw mode, marquee, dblclick (`src/pixi/pixiInteraction.ts`)
  - [x] 4.8 Overlay rendering: smart guides, drop indicator, measure lines (`src/pixi/OverlayRenderer.ts`)
  - [x] 4.9 Inline text/name editing: reuses React overlays positioned via world-to-screen coords
  - [x] 4.10 Feature flag: `localStorage.setItem('use-pixi', '1')` toggles renderer
  - [x] Image fills: `Sprite` + `Assets.load` with cover/fit/stretch modes, elliptical/rounded clipping
  - [x] Shadow effects: `BlurFilter` on offset shadow Graphics layer, applied via `applyShadow()` in renderers
  - [x] Transform handle dragging: resize via corner handles in `pixiInteraction.ts`, commits with history
  - [x] Auto-layout drag reordering: detects auto-layout parent, shows drop indicator via `dragStore`, reorders via `moveNode()` or extracts to root
  - [x] Frame name labels: rendered in `SelectionOverlay.ts` for top-level frames and selected frames
  - [x] Node size labels: rendered below selection bounding box with blue/purple background pill
  - [x] Drawing preview rect: drawn in `OverlayRenderer.ts` via `useDrawModeStore` subscription
  - [x] Marquee selection visual: blue rect during drag via `pixiOverlayState.ts` shared state
  - [x] Theme/variable change re-render: `pixiSync.ts` subscribes to theme/variable stores, triggers full rebuild
  - [x] Frame caching: `cacheAsTexture(true)` for frames with 30+ children
  - [x] Make PixiJS default: removed Konva `Canvas` conditional, `App.tsx` always renders `PixiCanvas`
  - [ ] **TODO: Visual regression testing** against Konva renderer
  - [ ] **TODO: Remove Konva files** — delete old Konva components + remove `konva`/`react-konva` deps
- [ ] Phase 5: Advanced optimizations

## Expected Impact

| Metric | Before Phases 1-3 (5K nodes) | After Phase 1+3 (current) | After Phase 4 |
|--------|------------------------------|--------------------------|---------------|
| `updateNode()` | ~50-100ms | ~0.1ms | ~0.1ms |
| History save | ~20-50ms | ~20-50ms (Phase 2 pending) | ~20-50ms |
| Re-renders per mutation | ~5000 components | ~1-5 | ~0 (bypasses React) |
| Canvas draw | ~16-33ms (Canvas 2D) | ~16-33ms | ~1-5ms (WebGL) |
| File open | ~500ms-2s | ~100ms | ~100ms |
