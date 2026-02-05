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

### 4.1 Create PixiJS canvas wrapper

New file: `src/components/PixiCanvas.tsx`
- Initialize `Application` with WebGL renderer
- Create viewport `Container` for pan/zoom transforms
- Feature flag to switch between Konva and PixiJS canvases

### 4.2 Scene graph mapping

| SceneNode | PixiJS |
|-----------|--------|
| FrameNode | `Container` + `Graphics` background + mask for clip |
| GroupNode | `Container` |
| RectNode | `Graphics` (rounded rect) |
| EllipseNode | `Graphics` (ellipse) |
| TextNode | `Text` / `HTMLText` |
| LineNode | `Graphics` |
| PolygonNode | `Graphics` |
| PathNode | `Graphics` (SVG path) |
| RefNode | Cloned container with overrides |

### 4.3 Direct store subscription (bypass React for rendering)

```ts
useSceneStore.subscribe((state, prevState) => {
  for (const [id, node] of state.nodesById) {
    if (node !== prevState.nodesById.get(id)) {
      updatePixiObject(id, node);  // direct PixiJS update, no React
    }
  }
});
```

### 4.4 Interaction system

Replace Konva event handlers with PixiJS `eventMode: 'static'`:
- Click, drag, hover, transform
- Custom selection handles (PixiJS has no built-in Transformer)
- Viewport pan/zoom via container transform

### 4.5 Keep React for UI panels

React renders: LayersPanel, PropertyEditor, Toolbar, ComponentsPanel, InlineTextEditor.
PixiJS renders: only the `<canvas>` element. Communication via Zustand stores.

### 4.6 Migration strategy

1. Build PixiCanvas alongside Canvas, toggle via feature flag
2. Implement one node type at a time (Rect -> Frame -> Text -> etc.)
3. Test each type independently
4. Once all types work, default to PixiJS
5. Remove Konva dependency

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

## Critical Files

| File | Changes |
|------|---------|
| `src/types/scene.ts` | Add `FlatSceneNode` type, `childIds` for containers |
| `src/store/sceneStore.ts` | Complete rewrite: flat Map, O(1) mutations, no recursive walks |
| `src/store/historyStore.ts` | Rewrite: patch-based diffs instead of JSON deep clone |
| `src/components/Canvas.tsx` | Subscribe to `rootIds`+`nodesById`, eventually replace with PixiCanvas |
| `src/components/nodes/RenderNode.tsx` | Remove `state.nodes` sub, use imperative getState(), useCallback |
| `src/components/nodes/FrameRenderer.tsx` | Use `childrenById`, imperative lookups |
| `src/components/nodes/GroupRenderer.tsx` | Same |
| `src/components/nodes/InstanceRenderer.tsx` | Same |
| `src/components/nodes/Rect/Text/Ellipse/Line/Polygon/PathRenderer.tsx` | Wrap in memo() |
| `src/components/LayersPanel.tsx` | Flat map iteration, granular selection sub |
| `src/utils/fileUtils.ts` | Flatten on load, build tree on save |
| `src/components/PixiCanvas.tsx` | NEW: PixiJS canvas (Phase 4) |

## Expected Impact

| Metric | Current (5K nodes) | After Phase 1-3 | After Phase 4 |
|--------|-------------------|-----------------|---------------|
| `updateNode()` | ~50-100ms | ~0.1ms | ~0.1ms |
| History save | ~20-50ms | ~0.01ms | ~0.01ms |
| Re-renders per mutation | ~5000 components | ~1-5 | ~0 (bypasses React) |
| Canvas draw | ~16-33ms | ~16-33ms | ~1-5ms (WebGL) |
| File open | ~500ms-2s | ~100ms | ~100ms |
