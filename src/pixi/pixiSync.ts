import { Container } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useDragStore } from "@/store/dragStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatSceneNode, FlatFrameNode, RefNode, ConnectorNode } from "@/types/scene";
import { materializeLayoutRefs } from "@/utils/layoutRefUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { getViewportBounds } from "@/utils/viewportUtils";
import { updateNodeContainer, applyLayoutSize } from "./renderers";
import { getAnchorWorldPosition } from "@/utils/connectorUtils";
import {
  type RegistryEntry,
  type NodeLayoutOverride,
  type AutoLayoutFrameSet,
  ComponentIdIndex,
  collectAffectedInstanceIds,
  withAncestorThemes,
  flatToTreeFrame,
} from "./syncHelpers";
import { createResolutionManager } from "./syncResolution";
import { createNodeTreeManager } from "./syncNodeTree";

// Module-level registry accessor for the drag animator
let registryAccessor: ((id: string) => Container | null) | null = null;
let sceneRootAccessor: (() => Container) | null = null;

export function getNodeContainer(id: string): Container | null {
  return registryAccessor?.(id) ?? null;
}

export function getSceneRoot(): Container | null {
  return sceneRootAccessor?.() ?? null;
}

// Phase 1: Viewport culling — screen-space margin to avoid pop-in during fast panning
const CULL_MARGIN = 400;

/**
 * Sentinel "previous node" used to force all renderers to re-apply visual
 * properties (fill, stroke, shadow, etc.) without destroying containers.
 * Every property comparison with the real node will show "changed".
 */
const THEME_SENTINEL = Object.freeze({ type: "none" }) as unknown as FlatSceneNode;

/**
 * Core sync engine: subscribes to Zustand scene store and incrementally updates PixiJS containers.
 * Returns a cleanup function.
 */
export function createPixiSync(sceneRoot: Container): () => void {
  const registry = new Map<string, RegistryEntry>();
  let rebuildScheduled = false;

  // Expose registry and sceneRoot to the drag animator
  registryAccessor = (id) => registry.get(id)?.container ?? null;
  sceneRootAccessor = () => sceneRoot;

  const ctx = { sceneRoot, registry };
  const resolutionMgr = createResolutionManager(ctx);
  const nodeTreeMgr = createNodeTreeManager(
    ctx,
    () => resolutionMgr.getAppliedTextResolution(),
    (id) => resolutionMgr.clearEmbedCache(id),
  );

  // Phase 3: Index for fast componentId → refNodeId lookups
  const componentIndex = new ComponentIdIndex();

  // Connector index: targetNodeId → set of connectorIds that reference it
  const connectorIndex = new Map<string, Set<string>>();

  function addToConnectorIndex(connectorId: string, node: ConnectorNode): void {
    for (const targetId of [node.startConnection.nodeId, node.endConnection.nodeId]) {
      let set = connectorIndex.get(targetId);
      if (!set) {
        set = new Set();
        connectorIndex.set(targetId, set);
      }
      set.add(connectorId);
    }
  }

  function removeFromConnectorIndex(connectorId: string, node: ConnectorNode): void {
    for (const targetId of [node.startConnection.nodeId, node.endConnection.nodeId]) {
      const set = connectorIndex.get(targetId);
      if (set) {
        set.delete(connectorId);
        if (set.size === 0) connectorIndex.delete(targetId);
      }
    }
  }

  function buildConnectorIndex(nodesById: Record<string, FlatSceneNode>): void {
    connectorIndex.clear();
    for (const id of Object.keys(nodesById)) {
      const node = nodesById[id];
      if (node?.type === "connector") {
        addToConnectorIndex(id, node as ConnectorNode);
      }
    }
  }

  function updateConnectorsForNode(nodeId: string): void {
    const connectorIds = connectorIndex.get(nodeId);
    if (!connectorIds || connectorIds.size === 0) return;

    const currentState = useSceneStore.getState();
    for (const connId of connectorIds) {
      const connNode = currentState.nodesById[connId];
      if (!connNode || connNode.type !== "connector") continue;

      const conn = connNode as ConnectorNode;
      const nodes = useSceneStore.getState().getNodes();
      const calcLayout = useLayoutStore.getState().calculateLayoutForFrame;
      const startPos = getAnchorWorldPosition(conn.startConnection.nodeId, conn.startConnection.anchor, nodes, calcLayout);
      const endPos = getAnchorWorldPosition(conn.endConnection.nodeId, conn.endConnection.anchor, nodes, calcLayout);
      if (!startPos || !endPos) continue;

      const minX = Math.min(startPos.x, endPos.x);
      const minY = Math.min(startPos.y, endPos.y);
      const maxX = Math.max(startPos.x, endPos.x);
      const maxY = Math.max(startPos.y, endPos.y);
      const nodeWidth = Math.max(maxX - minX, 1);
      const nodeHeight = Math.max(maxY - minY, 1);

      useSceneStore.getState().updateNodeWithoutHistory(connId, {
        x: minX,
        y: minY,
        width: nodeWidth,
        height: nodeHeight,
        points: [
          startPos.x - minX,
          startPos.y - minY,
          endPos.x - minX,
          endPos.y - minY,
        ],
      });
    }
  }

  // ─── Phase 1: Viewport Culling ───────────────────────────────────────

  function updateCulling(): void {
    const { scale, x, y } = useViewportStore.getState();
    const bounds = getViewportBounds(scale, x, y, window.innerWidth, window.innerHeight);
    const margin = CULL_MARGIN / scale;
    const minX = bounds.minX - margin;
    const maxX = bounds.maxX + margin;
    const minY = bounds.minY - margin;
    const maxY = bounds.maxY + margin;

    const state = useSceneStore.getState();
    for (const rootId of state.rootIds) {
      const entry = registry.get(rootId);
      if (!entry) continue;
      const node = entry.node;

      entry.container.renderable = !(
        node.x + node.width < minX ||
        node.x > maxX ||
        node.y + node.height < minY ||
        node.y > maxY
      );
    }
  }

  // ─── Auto-Layout ─────────────────────────────────────────────────────

  /**
   * Apply auto-layout positions to frame children
   */
  function collectDirtyAutoLayoutFrames(
    state: SceneState,
    changedIds: Set<string>,
  ): AutoLayoutFrameSet {
    const dirty = new Set<string>();

    const markAutoLayoutAncestors = (startId: string): void => {
      let current: string | null = startId;
      while (current != null) {
        const n = state.nodesById[current];
        if (n?.type === "frame" && (n as FlatFrameNode).layout?.autoLayout) {
          dirty.add(current);
        }
        current = state.parentById[current] ?? null;
      }
    };

    for (const id of changedIds) {
      markAutoLayoutAncestors(id);
    }

    // Keep only top-most dirty auto-layout frames.
    const minimal = new Set<string>();
    for (const frameId of dirty) {
      let hasDirtyAncestor = false;
      let cur = state.parentById[frameId] ?? null;
      while (cur != null) {
        if (dirty.has(cur)) {
          hasDirtyAncestor = true;
          break;
        }
        cur = state.parentById[cur] ?? null;
      }
      if (!hasDirtyAncestor) minimal.add(frameId);
    }

    return minimal;
  }

  function applyAutoLayoutPositions(
    state: SceneState,
    dirtyFrames?: AutoLayoutFrameSet,
  ): void {
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutOverrides = new Map<string, NodeLayoutOverride>();

    const applyFrameLayoutRecursively = (frameId: string): void => {
      const frameNode = state.nodesById[frameId];
      if (!frameNode || frameNode.type !== "frame") return;

      // Skip frames being animated during auto-layout drag
      const dragState = useDragStore.getState();
      if (dragState.isDragging && dragState.animationPhase && dragState.insertInfo?.parentId === frameId) return;

      const childIds = state.childrenById[frameId] ?? [];
      const frameOverride = layoutOverrides.get(frameId);

      if ((frameNode as FlatFrameNode).layout?.autoLayout) {
        // Convert to tree structure for layout calculation, including overrides
        // inherited from parent auto-layout.
        const treeFrame = flatToTreeFrame(
          frameId,
          state.nodesById,
          state.childrenById,
          layoutOverrides,
        );

        if (treeFrame) {
          const layoutFrame = materializeLayoutRefs(
            treeFrame,
            state.nodesById,
            state.childrenById,
          );
          // Keep frame background/mask in sync for fit_content frames even when
          // only descendants changed (e.g. text metrics after font load).
          const fitWidth = frameNode.sizing?.widthMode === "fit_content";
          const fitHeight = frameNode.sizing?.heightMode === "fit_content";
          // Respect size computed by parent auto-layout when this frame is a child
          // (e.g. fill_container). Fallback to stored node size for roots/standalone.
          let frameWidth = frameOverride?.width ?? frameNode.width;
          let frameHeight = frameOverride?.height ?? frameNode.height;

          if (fitWidth || fitHeight) {
            const intrinsicSize = calculateFrameIntrinsicSize(layoutFrame, {
              fitWidth,
              fitHeight,
            });
            if (fitWidth) {
              frameWidth = frameNode.clip
                ? Math.min(intrinsicSize.width, frameNode.width)
                : intrinsicSize.width;
            }
            if (fitHeight) {
              frameHeight = frameNode.clip
                ? Math.min(intrinsicSize.height, frameNode.height)
                : intrinsicSize.height;
            }
          }

          const frameEntry = registry.get(frameId);
          if (frameEntry) {
            withAncestorThemes(
              frameId,
              state.parentById,
              state.nodesById,
              () => {
                applyLayoutSize(
                  frameEntry.container,
                  frameEntry.node,
                  frameWidth,
                  frameHeight,
                  state.nodesById,
                  state.childrenById,
                );
              },
            );
          }

          // Calculate layout
          const layoutChildren = calculateLayoutForFrame(layoutFrame);

          // Apply positions/sizes to child containers and cache overrides for nested frames.
          for (const layoutChild of layoutChildren) {
            layoutOverrides.set(layoutChild.id, {
              x: layoutChild.x,
              y: layoutChild.y,
              width: layoutChild.width,
              height: layoutChild.height,
            });

            const childEntry = registry.get(layoutChild.id);
            if (childEntry) {
              childEntry.container.position.set(layoutChild.x, layoutChild.y);
              withAncestorThemes(
                layoutChild.id,
                state.parentById,
                state.nodesById,
                () => {
                  applyLayoutSize(
                    childEntry.container,
                    childEntry.node,
                    layoutChild.width,
                    layoutChild.height,
                    state.nodesById,
                    state.childrenById,
                  );
                },
              );
            }
          }
        }
      }

      // Continue traversal so nested auto-layout frames also get processed.
      for (const childId of childIds) {
        const childNode = state.nodesById[childId];
        if (childNode?.type === "frame") {
          applyFrameLayoutRecursively(childId);
        }
      }
    };

    if (dirtyFrames && dirtyFrames.size > 0) {
      for (const frameId of dirtyFrames) {
        applyFrameLayoutRecursively(frameId);
      }
      return;
    }

    // Full pass from roots.
    for (const rootId of state.rootIds) {
      const rootNode = state.nodesById[rootId];
      if (rootNode?.type === "frame") {
        applyFrameLayoutRecursively(rootId);
      }
    }
  }

  // ─── Full Rebuild ────────────────────────────────────────────────────

  /**
   * Full rebuild - used on initial load.
   */
  function fullRebuild(state: SceneState): void {
    // Clear existing
    sceneRoot.removeChildren();
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();

    // Build all nodes
    nodeTreeMgr.buildNodeTree(state.rootIds, state.nodesById, state.childrenById, sceneRoot);

    // Phase 3: Rebuild componentId index
    componentIndex.buildFrom(state.nodesById);

    // Rebuild connector index
    buildConnectorIndex(state.nodesById);

    // Phase 6: Rebuild text/ref node tracking
    resolutionMgr.rebuildTracking();

    // Apply auto-layout positions
    applyAutoLayoutPositions(state);
    resolutionMgr.resetResolutions();
    resolutionMgr.applyTextResolution(resolutionMgr.getTargetTextResolution(useViewportStore.getState().scale));
    resolutionMgr.applyEmbedResolution(resolutionMgr.getTargetEmbedResolution(useViewportStore.getState().scale));
    resolutionMgr.applyImageFillTextureResolution(resolutionMgr.getTargetImageFillResolution(useViewportStore.getState().scale));
    nodeTreeMgr.applyTextEditingVisibility();

    // Phase 1: Apply culling after build
    updateCulling();
  }

  // ─── Phase 7: Incremental Theme/Variable Update ──────────────────────

  /**
   * Re-apply colors to all containers without destroying/recreating the tree.
   * Uses THEME_SENTINEL as a fake "previous" node so all property comparisons
   * evaluate as "changed", causing renderers to re-resolve fills/strokes.
   */
  function incrementalThemeUpdate(): void {
    const state = useSceneStore.getState();
    for (const [id, entry] of registry) {
      withAncestorThemes(id, state.parentById, state.nodesById, () => {
        updateNodeContainer(
          entry.container,
          entry.node,
          THEME_SENTINEL,
          state.nodesById,
          state.childrenById,
          true, // skipPosition — positions haven't changed
          entry.node.type === "ref", // forceRebuild only for refs (re-resolve internal colors)
        );
      });
    }
    nodeTreeMgr.applyTextEditingVisibility();
  }

  // ─── Incremental Update (Phases 3 + 4) ──────────────────────────────

  /**
   * Incremental update - only process changed nodes.
   */
  function incrementalUpdate(state: SceneState, prev: SceneState): void {
    if (state.nodesById === prev.nodesById && state.rootIds === prev.rootIds && state.childrenById === prev.childrenById) {
      return; // No scene changes
    }

    // Phase 4: Combined change detection + theme override check in a single pass
    const changedIds = new Set<string>();
    let needsThemeRebuild = false;

    for (const id of Object.keys(state.nodesById)) {
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      if (node !== prevNode) {
        changedIds.add(id);
        // Check theme override only on changed frame nodes
        if (
          node && prevNode &&
          node.type === "frame" &&
          (node as FlatFrameNode).themeOverride !== (prevNode as FlatFrameNode).themeOverride
        ) {
          needsThemeRebuild = true;
        }
      }
    }

    if (needsThemeRebuild) {
      fullRebuild(state);
      return;
    }

    // Removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        changedIds.add(id);
      }
    }

    // Children changes
    for (const id of Object.keys(state.childrenById)) {
      if (state.childrenById[id] !== prev.childrenById[id]) {
        changedIds.add(id);
      }
    }
    for (const id of Object.keys(prev.childrenById)) {
      if (!state.childrenById[id]) {
        changedIds.add(id);
      }
    }

    // Handle added nodes
    for (const id of Object.keys(state.nodesById)) {
      if (!prev.nodesById[id]) {
        nodeTreeMgr.createAndAttachNode(id, state);
        // Phase 3 + 6: Update indexes for new nodes
        const node = state.nodesById[id];
        if (node) {
          if (node.type === "ref") {
            componentIndex.add(id, (node as RefNode).componentId);
          }
          if (node.type === "connector") {
            addToConnectorIndex(id, node as ConnectorNode);
          }
          resolutionMgr.trackNodeAdded(id, node);
        }
      }
    }

    // Phase 3: Use componentId index for fast instance lookup
    const affectedInstanceIds = collectAffectedInstanceIds(state, prev, changedIds, componentIndex);

    // Handle removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        // Phase 3 + 6: Update indexes for removed nodes
        const prevNode = prev.nodesById[id];
        if (prevNode) {
          if (prevNode.type === "ref") {
            componentIndex.remove(id, (prevNode as RefNode).componentId);
          }
          if (prevNode.type === "connector") {
            removeFromConnectorIndex(id, prevNode as ConnectorNode);
          }
          resolutionMgr.trackNodeRemoved(id);
        }
        nodeTreeMgr.removeNode(id, prev.childrenById, state.nodesById);
      }
    }

    // Handle updated nodes (reference equality check)
    for (const id of Object.keys(state.nodesById)) {
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      if (node && prevNode && node !== prevNode) {
        const entry = registry.get(id);
        if (entry) {
          // Check if node is inside auto-layout frame
          const parentId = state.parentById[id];
          const parentNode = parentId ? state.nodesById[parentId] : null;
          const isInAutoLayout = parentNode?.type === "frame" &&
            (parentNode as FlatFrameNode).layout?.autoLayout;

          withAncestorThemes(id, state.parentById, state.nodesById, () => {
            updateNodeContainer(
              entry.container,
              node,
              entry.node,
              state.nodesById,
              state.childrenById,
              isInAutoLayout, // skipPosition for auto-layout children
              false,
            );
          });
          entry.node = node;

          // Phase 3: Update componentId index if ref's componentId changed
          if (node.type === "ref" && prevNode.type === "ref") {
            const prevCompId = (prevNode as RefNode).componentId;
            const newCompId = (node as RefNode).componentId;
            if (prevCompId !== newCompId) {
              componentIndex.remove(id, prevCompId);
              componentIndex.add(id, newCompId);
            }
          }
        }
      }
    }

    // Rebuild instance render trees when their source component changed,
    // even if the ref node itself is unchanged.
    for (const id of affectedInstanceIds) {
      if (changedIds.has(id)) continue;
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      const entry = registry.get(id);
      if (!node || !prevNode || !entry || node.type !== "ref" || prevNode.type !== "ref") {
        continue;
      }
      withAncestorThemes(id, state.parentById, state.nodesById, () => {
        updateNodeContainer(
          entry.container,
          node,
          prevNode,
          state.nodesById,
          state.childrenById,
          false,
          true,
        );
      });
      entry.node = node;
      changedIds.add(id);
    }

    // Update connectors when connected nodes move/resize
    for (const id of changedIds) {
      const node = state.nodesById[id];
      if (node && node.type !== "connector") {
        updateConnectorsForNode(id);
      }
    }

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      nodeTreeMgr.reconcileChildren(state, prev);
    }

    // Reapply only affected auto-layout frame chains.
    const dirtyAutoLayoutFrames = collectDirtyAutoLayoutFrames(
      state,
      changedIds,
    );
    if (dirtyAutoLayoutFrames.size > 0) {
      applyAutoLayoutPositions(state, dirtyAutoLayoutFrames);
    }
    // New text nodes can appear during incremental subtree rebuilds (e.g. instance edits).
    // Re-apply current resolution so they don't stay at the default and look blurry.
    resolutionMgr.refreshTextResolution();
    nodeTreeMgr.applyTextEditingVisibility();

    // Phase 1: Re-apply culling after tree changes
    updateCulling();
  }

  // ─── Subscriptions ───────────────────────────────────────────────────

  let lastScale = useViewportStore.getState().scale;
  let lastX = useViewportStore.getState().x;
  let lastY = useViewportStore.getState().y;

  // Initial resolutions
  resolutionMgr.applyTextResolution(resolutionMgr.getTargetTextResolution(lastScale));
  resolutionMgr.applyEmbedResolution(resolutionMgr.getTargetEmbedResolution(lastScale));
  resolutionMgr.applyImageFillTextureResolution(resolutionMgr.getTargetImageFillResolution(lastScale));

  const unsubViewport = useViewportStore.subscribe((state) => {
    if (state.scale !== lastScale) {
      lastScale = state.scale;
      lastX = state.x;
      lastY = state.y;
      resolutionMgr.scheduleTextResolutionUpdate(state.scale);
      resolutionMgr.scheduleEmbedResolutionUpdate(state.scale);
      resolutionMgr.scheduleImageFillResolutionUpdate(state.scale);
      // Phase 1: Update culling on zoom
      updateCulling();
    } else if (state.x !== lastX || state.y !== lastY) {
      lastX = state.x;
      lastY = state.y;
      resolutionMgr.schedulePanUpgrade();
      // Phase 1: Update culling on pan
      updateCulling();
    }
  });

  // Subscribe to Zustand store
  const initialState = useSceneStore.getState();
  fullRebuild(initialState);

  let prevState = initialState;
  let pendingSceneState: SceneState | null = null;
  let sceneUpdateFrameId: number | null = null;

  const flushSceneUpdate = (): void => {
    sceneUpdateFrameId = null;
    if (!pendingSceneState) return;
    const nextState = pendingSceneState;
    pendingSceneState = null;
    incrementalUpdate(nextState, prevState);
    prevState = nextState;
  };

  const scheduleSceneUpdate = (state: SceneState): void => {
    pendingSceneState = state;
    if (sceneUpdateFrameId != null) return;
    sceneUpdateFrameId = requestAnimationFrame(flushSceneUpdate);
  };

  const clearPendingSceneUpdate = (): void => {
    pendingSceneState = null;
    if (sceneUpdateFrameId != null) {
      cancelAnimationFrame(sceneUpdateFrameId);
      sceneUpdateFrameId = null;
    }
  };

  const unsubScene = useSceneStore.subscribe((state) => {
    scheduleSceneUpdate(state);
  });

  const rebuildFromCurrentState = (): void => {
    clearPendingSceneUpdate();
    fullRebuild(useSceneStore.getState());
    prevState = useSceneStore.getState();
  };

  const scheduleRebuildFromFonts = (): void => {
    if (rebuildScheduled) return;
    rebuildScheduled = true;
    requestAnimationFrame(() => {
      rebuildScheduled = false;
      rebuildFromCurrentState();
    });
  };

  const unsubVariables = useVariableStore.subscribe(() => {
    incrementalThemeUpdate();
  });

  const unsubSelection = useSelectionStore.subscribe(() => {
    nodeTreeMgr.applyTextEditingVisibility();
  });

  let removeFontsListener: (() => void) | null = null;
  if (typeof document !== "undefined" && "fonts" in document) {
    const fonts = document.fonts;
    fonts.ready.then(() => {
      scheduleRebuildFromFonts();
    });
    const onLoadingDone = () => {
      scheduleRebuildFromFonts();
    };
    fonts.addEventListener("loadingdone", onLoadingDone);
    removeFontsListener = () => {
      fonts.removeEventListener("loadingdone", onLoadingDone);
    };
  }

  return () => {
    unsubScene();
    unsubVariables();
    unsubSelection();
    unsubViewport();
    resolutionMgr.cleanup();
    clearPendingSceneUpdate();
    removeFontsListener?.();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    componentIndex.clear();
    connectorIndex.clear();
    sceneRoot.removeChildren();
    registryAccessor = null;
    sceneRootAccessor = null;
  };
}
