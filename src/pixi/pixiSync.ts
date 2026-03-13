import { Container, Text } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatSceneNode, FlatFrameNode, FrameNode, SceneNode } from "@/types/scene";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { getViewportBounds } from "@/utils/viewportUtils";
import type { EmbedNode } from "@/types/scene";
import { createNodeContainer, updateNodeContainer, applyLayoutSize } from "./renderers";
import {
  pushRenderTheme,
  popRenderTheme,
  resetRenderThemeStack,
  getRenderThemeStackDepth,
} from "./renderers/colorHelpers";
import { updateEmbedResolution, setEmbedResolution } from "./renderers/embedRenderer";
import { setImageFillResolution, updateImageFillResolution } from "./renderers/imageFillHelpers";

interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

const TEXT_RESOLUTION_SHARPNESS_BOOST = 1.35;
const TEXT_RESOLUTION_MAX_MULTIPLIER = 16;
const EMBED_RESOLUTION_STEP = 0.25;
const MIN_EMBED_RESOLUTION = 0.25;

type NodeLayoutOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type AutoLayoutFrameSet = Set<string>;

function collectAffectedComponentIds(
  state: SceneState,
  prev: SceneState,
  changedIds: Set<string>,
): Set<string> {
  const affected = new Set<string>();

  const markFromChain = (
    startId: string,
    nodesById: Record<string, FlatSceneNode>,
    parentById: Record<string, string | null>,
  ): void => {
    let current: string | null = startId;
    while (current != null) {
      const node = nodesById[current];
      if (node?.type === "frame" && (node as FlatFrameNode).reusable) {
        affected.add(current);
      }
      current = parentById[current] ?? null;
    }
  };

  for (const id of changedIds) {
    if (state.nodesById[id]) {
      markFromChain(id, state.nodesById, state.parentById);
    }
    if (prev.nodesById[id]) {
      markFromChain(id, prev.nodesById, prev.parentById);
    }
  }

  return affected;
}

function collectAffectedInstanceIds(
  state: SceneState,
  prev: SceneState,
  changedIds: Set<string>,
): Set<string> {
  const affectedComponentIds = collectAffectedComponentIds(state, prev, changedIds);
  if (affectedComponentIds.size === 0) return new Set<string>();

  const affectedInstances = new Set<string>();
  for (const [id, node] of Object.entries(state.nodesById)) {
    if (node.type === "ref" && affectedComponentIds.has(node.componentId)) {
      affectedInstances.add(id);
    }
  }
  return affectedInstances;
}

/**
 * Push ancestor theme overrides onto the render theme stack (outermost first).
 * Returns the number of themes pushed so the caller can pop them.
 */
function pushAncestorThemes(
  nodeId: string,
  parentById: Record<string, string | null>,
  nodesById: Record<string, FlatSceneNode>,
): number {
  // Collect ancestor theme overrides from root to parent
  const overrides: string[] = [];
  let cur = parentById[nodeId] ?? null;
  while (cur != null) {
    const n = nodesById[cur];
    if (n?.type === "frame" && (n as FlatFrameNode).themeOverride) {
      overrides.push((n as FlatFrameNode).themeOverride!);
    }
    cur = parentById[cur] ?? null;
  }
  // Push from outermost ancestor to innermost (so innermost wins)
  for (let i = overrides.length - 1; i >= 0; i--) {
    pushRenderTheme(overrides[i] as "light" | "dark");
  }
  return overrides.length;
}

function withAncestorThemes(
  nodeId: string,
  parentById: Record<string, string | null>,
  nodesById: Record<string, FlatSceneNode>,
  fn: () => void,
): void {
  // Guard against leaked render theme context from previous operations.
  if (getRenderThemeStackDepth() !== 0) {
    resetRenderThemeStack();
  }
  const pushed = pushAncestorThemes(nodeId, parentById, nodesById);
  try {
    fn();
  } finally {
    for (let i = 0; i < pushed; i++) popRenderTheme();
    // Keep stack invariant strict between operations.
    if (getRenderThemeStackDepth() !== 0) {
      resetRenderThemeStack();
    }
  }
}

/**
 * Convert flat frame to tree frame for layout calculation
 */
function flatToTreeFrame(
  frameId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  layoutOverrides?: Map<string, NodeLayoutOverride>,
): FrameNode | null {
  const node = nodesById[frameId];
  if (!node || node.type !== "frame") return null;

  const frameOverride = layoutOverrides?.get(frameId);
  const flatFrame = {
    ...(node as FlatFrameNode),
    ...(frameOverride ?? {}),
  } as FlatFrameNode;
  const childIds = childrenById[frameId] ?? [];
  const children: SceneNode[] = [];

  for (const childId of childIds) {
    const childNode = nodesById[childId];
    if (!childNode) continue;

    const childOverride = layoutOverrides?.get(childId);

    if (childNode.type === "frame") {
      const childFrame = flatToTreeFrame(
        childId,
        nodesById,
        childrenById,
        layoutOverrides,
      );
      if (childFrame) children.push(childFrame);
    } else {
      children.push({
        ...(childNode as SceneNode),
        ...(childOverride ?? {}),
      });
    }
  }

  return {
    ...flatFrame,
    children,
  } as FrameNode;
}

/**
 * Core sync engine: subscribes to Zustand scene store and incrementally updates PixiJS containers.
 * Returns a cleanup function.
 */
export function createPixiSync(sceneRoot: Container): () => void {
  const registry = new Map<string, RegistryEntry>();
  let appliedTextResolution = 0;
  let rebuildScheduled = false;

  function applyTextResolutionRecursive(container: Container, resolution: number): void {
    for (const child of container.children) {
      if (child instanceof Text) {
        if (child.resolution !== resolution) {
          child.resolution = resolution;
        }
      } else if (child instanceof Container) {
        applyTextResolutionRecursive(child, resolution);
      }
    }
  }

  function applyTextEditingVisibility(): void {
    const { editingNodeId, editingMode } = useSelectionStore.getState();
    const isTextEditing = editingMode === "text" && editingNodeId != null;
    const isEmbedEditing = editingMode === "embed" && editingNodeId != null;

    for (const [id, entry] of registry) {
      const baseVisible = entry.node.visible !== false && entry.node.enabled !== false;
      const hideWhileEditing = (
        (isTextEditing && entry.node.type === "text" && editingNodeId === id) ||
        (isEmbedEditing && entry.node.type === "embed" && editingNodeId === id)
      );
      entry.container.visible = baseVisible && !hideWhileEditing;
    }

  }

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
          // Keep frame background/mask in sync for fit_content frames even when
          // only descendants changed (e.g. text metrics after font load).
          const fitWidth = frameNode.sizing?.widthMode === "fit_content";
          const fitHeight = frameNode.sizing?.heightMode === "fit_content";
          // Respect size computed by parent auto-layout when this frame is a child
          // (e.g. fill_container). Fallback to stored node size for roots/standalone.
          let frameWidth = frameOverride?.width ?? frameNode.width;
          let frameHeight = frameOverride?.height ?? frameNode.height;

          if (fitWidth || fitHeight) {
            const intrinsicSize = calculateFrameIntrinsicSize(treeFrame as FrameNode, {
              fitWidth,
              fitHeight,
            });
            if (fitWidth) frameWidth = intrinsicSize.width;
            if (fitHeight) frameHeight = intrinsicSize.height;
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
          const layoutChildren = calculateLayoutForFrame(treeFrame);

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

  function getTargetTextResolution(scale: number): number {
    const devicePixelRatio = window.devicePixelRatio || 1;
    // Match text texture resolution to current zoom for crisp rendering.
    // Keep minimum at 1x to avoid blur when zoomed out.
    const effectiveScale = Math.max(1, scale);
    const maxResolution = Math.ceil(
      devicePixelRatio * TEXT_RESOLUTION_MAX_MULTIPLIER,
    );
    const boostedResolution =
      effectiveScale * devicePixelRatio * TEXT_RESOLUTION_SHARPNESS_BOOST;
    return Math.min(maxResolution, boostedResolution);
  }

  function applyTextResolution(resolution: number): void {
    if (appliedTextResolution === resolution) return;
    appliedTextResolution = resolution;
    applyTextResolutionRecursive(sceneRoot, resolution);
  }

  function refreshTextResolution(): void {
    const resolution =
      appliedTextResolution ||
      getTargetTextResolution(useViewportStore.getState().scale);
    applyTextResolutionRecursive(sceneRoot, resolution);
  }

  let appliedEmbedResolution = 0;
  let appliedImageFillResolution = 0;
  const embedsAtTargetRes = new Set<string>(); // embeds already at appliedEmbedResolution
  const EMBED_VIEWPORT_MARGIN = 300; // world-space margin to avoid pop-in

  function getTargetEmbedResolution(scale: number): number {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const effectiveScale = Math.max(1, scale);
    // Allow high zoom levels — per-node getSafeEmbedResolution() handles texture size limits
    const maxResolution = Math.ceil(devicePixelRatio * 32);
    return Math.min(maxResolution, effectiveScale * devicePixelRatio);
  }

  function getCurrentViewportBounds() {
    const vp = useViewportStore.getState();
    const w = window.innerWidth;
    const h = window.innerHeight;
    return getViewportBounds(vp.scale, vp.x, vp.y, w, h);
  }

  /**
   * Get world-space position of a container by walking the PixiJS parent chain.
   * Unlike store-based position, this reflects auto-layout computed positions.
   */
  function getContainerWorldPos(container: Container): { x: number; y: number } {
    let x = 0, y = 0;
    let cur: Container | null = container;
    while (cur && cur !== sceneRoot) {
      x += cur.position.x;
      y += cur.position.y;
      cur = cur.parent;
    }
    return { x, y };
  }

  function isContainerInViewport(
    container: Container,
    node: FlatSceneNode,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): boolean {
    const pos = getContainerWorldPos(container);
    return !(
      pos.x + node.width < bounds.minX - EMBED_VIEWPORT_MARGIN ||
      pos.x > bounds.maxX + EMBED_VIEWPORT_MARGIN ||
      pos.y + node.height < bounds.minY - EMBED_VIEWPORT_MARGIN ||
      pos.y > bounds.maxY + EMBED_VIEWPORT_MARGIN
    );
  }

  /**
   * Sequentially upgrade visible embed nodes to the target resolution.
   * Processing one at a time avoids overwhelming the browser with concurrent
   * HTML-to-canvas renders. A generation counter cancels stale runs.
   */
  let embedUpgradeGeneration = 0;

  async function upgradeVisibleEmbeds(onlyNew: boolean): Promise<void> {
    const generation = ++embedUpgradeGeneration;
    if (appliedEmbedResolution <= 0) return;

    const bounds = getCurrentViewportBounds();
    const toUpgrade: Array<{ id: string; entry: RegistryEntry }> = [];

    for (const [id, entry] of registry) {
      if (entry.node.type !== "embed") continue;
      if (onlyNew && embedsAtTargetRes.has(id)) continue;
      if (!isContainerInViewport(entry.container, entry.node, bounds)) continue;
      toUpgrade.push({ id, entry });
    }

    for (const { id, entry } of toUpgrade) {
      if (embedUpgradeGeneration !== generation) return; // newer run supersedes
      if (entry.container.destroyed) continue;

      await updateEmbedResolution(
        entry.container,
        entry.node as EmbedNode,
        appliedEmbedResolution,
      );
      embedsAtTargetRes.add(id);
    }
  }

  function applyEmbedResolution(resolution: number): void {
    const normalizedResolution = Math.max(
      MIN_EMBED_RESOLUTION,
      Math.round(resolution / EMBED_RESOLUTION_STEP) * EMBED_RESOLUTION_STEP,
    );
    if (appliedEmbedResolution === normalizedResolution) return;
    appliedEmbedResolution = normalizedResolution;
    setEmbedResolution(normalizedResolution);
    embedsAtTargetRes.clear(); // new target — all embeds need upgrading
    upgradeVisibleEmbeds(false);
  }

  // Image fill resolution uses the same formula as embed resolution.
  const getTargetImageFillResolution = getTargetEmbedResolution;

  function applyImageFillTextureResolution(resolution: number): void {
    if (appliedImageFillResolution === resolution) return;
    appliedImageFillResolution = resolution;
    setImageFillResolution(resolution);
    for (const [, entry] of registry) {
      if (entry.node.imageFill) {
        updateImageFillResolution(entry.container, entry.node);
      }
    }
  }

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
    buildNodeTree(state.rootIds, state.nodesById, state.childrenById, sceneRoot);

    // Apply auto-layout positions
    applyAutoLayoutPositions(state);
    appliedTextResolution = 0;
    appliedEmbedResolution = 0;
    appliedImageFillResolution = 0;
    embedsAtTargetRes.clear();
    applyTextResolution(getTargetTextResolution(useViewportStore.getState().scale));
    applyEmbedResolution(getTargetEmbedResolution(useViewportStore.getState().scale));
    applyImageFillTextureResolution(getTargetImageFillResolution(useViewportStore.getState().scale));
    applyTextEditingVisibility();
  }

  /**
   * Recursively build node containers and add them to parent.
   */
  function buildNodeTree(
    ids: string[],
    nodesById: Record<string, FlatSceneNode>,
    childrenById: Record<string, string[]>,
    parent: Container,
  ): void {
    for (const id of ids) {
      const node = nodesById[id];
      if (!node) continue;

      const container = createNodeContainer(node, nodesById, childrenById);
      registry.set(id, { container, node });
      parent.addChild(container);

      // Note: children are already created inside createNodeContainer for frames/groups
      // We still need to register them in our registry
      registerChildrenRecursive(id, nodesById, childrenById, container);
    }
  }

  /**
   * Register children containers that were created inside createNodeContainer
   */
  function registerChildrenRecursive(
    nodeId: string,
    nodesById: Record<string, FlatSceneNode>,
    childrenById: Record<string, string[]>,
    parentContainer: Container,
  ): void {
    const childIds = childrenById[nodeId] ?? [];
    const childrenHost =
      parentContainer.getChildByLabel("frame-children") ??
      parentContainer.getChildByLabel("group-children");

    if (!childrenHost || childIds.length === 0) return;

    for (let i = 0; i < childIds.length; i++) {
      const childId = childIds[i];
      const childNode = nodesById[childId];
      if (!childNode) continue;

      const childContainer = (childrenHost as Container).children[i] as Container | undefined;
      if (childContainer) {
        registry.set(childId, { container: childContainer, node: childNode });
        // Recurse for nested containers
        registerChildrenRecursive(childId, nodesById, childrenById, childContainer);
      }
    }
  }

  /**
   * Incremental update - only process changed nodes.
   */
  function incrementalUpdate(state: SceneState, prev: SceneState): void {
    if (state.nodesById === prev.nodesById && state.rootIds === prev.rootIds && state.childrenById === prev.childrenById) {
      return; // No scene changes
    }

    // If any frame's themeOverride changed, fall back to full rebuild
    // because all descendants need their colors re-resolved.
    for (const id of Object.keys(state.nodesById)) {
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      if (
        node && prevNode && node !== prevNode &&
        node.type === "frame" &&
        (node as FlatFrameNode).themeOverride !== (prevNode as FlatFrameNode).themeOverride
      ) {
        fullRebuild(state);
        return;
      }
    }

    const changedIds = new Set<string>();

    for (const id of Object.keys(state.nodesById)) {
      if (state.nodesById[id] !== prev.nodesById[id]) {
        changedIds.add(id);
      }
    }
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        changedIds.add(id);
      }
    }
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
        createAndAttachNode(id, state);
      }
    }

    const affectedInstanceIds = collectAffectedInstanceIds(state, prev, changedIds);

    // Handle removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        removeNode(id, prev.childrenById, state.nodesById);
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

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state, prev);
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
    refreshTextResolution();
    applyTextEditingVisibility();
  }

  /**
   * Create a new node and attach it to its parent.
   */
  function createAndAttachNode(id: string, state: SceneState): void {
    if (registry.has(id)) return;

    const node = state.nodesById[id];
    if (!node) return;

    const parentId = state.parentById[id];
    // Parent containers create/register their subtree in one go.
    // If parent isn't ready yet, avoid creating a duplicate detached child container.
    if (parentId && !registry.has(parentId)) return;

    // Push ancestor theme overrides so colors resolve correctly
    let container: Container;
    withAncestorThemes(id, state.parentById, state.nodesById, () => {
      container = createNodeContainer(
        node,
        state.nodesById,
        state.childrenById,
      );
    });
    // createNodeContainer is always assigned inside withAncestorThemes callback
    const createdContainer = container!;

    registry.set(id, { container: createdContainer, node });

    // Find parent and attach
    if (parentId) {
      const parentEntry = registry.get(parentId);
      if (parentEntry) {
        const childrenHost =
          parentEntry.container.getChildByLabel("frame-children") ??
          parentEntry.container.getChildByLabel("group-children");
        if (childrenHost) {
          (childrenHost as Container).addChild(createdContainer);
        }
      }
    } else {
      // Root node
      sceneRoot.addChild(createdContainer);
    }

    // Register any nested children
    registerChildrenRecursive(id, state.nodesById, state.childrenById, createdContainer);

    if (node.type === "text") {
      const textObj = createdContainer.getChildByLabel("text-content") as Text | undefined;
      if (textObj && textObj.resolution !== appliedTextResolution) {
        textObj.resolution = appliedTextResolution;
      }
    }
  }

  /**
   * Remove a node from the scene.
   */
  function removeNode(
    id: string,
    prevChildrenById: Record<string, string[]>,
    nextNodesById: Record<string, FlatSceneNode>,
  ): void {
    const entry = registry.get(id);
    if (!entry) return;

    const childIds = prevChildrenById[id] ?? [];
    for (const childId of childIds) {
      // If a child still exists in the next state, it was reparented.
      // Keep its container and let reconcileChildren attach it to the new host.
      if (nextNodesById[childId]) {
        const childEntry = registry.get(childId);
        if (childEntry?.container.parent) {
          childEntry.container.parent.removeChild(childEntry.container);
        }
        continue;
      }
      removeNode(childId, prevChildrenById, nextNodesById);
    }

    if (!entry.container.destroyed) {
      entry.container.parent?.removeChild(entry.container);
      entry.container.destroy({ children: true });
    }
    registry.delete(id);
    embedsAtTargetRes.delete(id);
  }

  /**
   * Reconcile children order after structural changes.
   */
  function reconcileChildren(state: SceneState, prev: SceneState): void {
    // Reconcile root level
    if (state.rootIds !== prev.rootIds) {
      reconcileChildList(state.rootIds, sceneRoot);
    }

    // Reconcile changed parent containers
    for (const id of Object.keys(state.childrenById)) {
      if (state.childrenById[id] !== prev.childrenById[id]) {
        const entry = registry.get(id);
        if (entry) {
          const childrenHost =
            entry.container.getChildByLabel("frame-children") ??
            entry.container.getChildByLabel("group-children");
          if (childrenHost) {
            reconcileChildList(
              state.childrenById[id],
              childrenHost as Container,
            );
          }
        }
      }
    }
  }

  /**
   * Reorder children in a container to match the expected ID order.
   */
  function reconcileChildList(
    expectedIds: string[],
    parent: Container,
  ): void {
    const expectedContainers = new Set<Container>();
    for (let i = 0; i < expectedIds.length; i++) {
      const id = expectedIds[i];
      const entry = registry.get(id);
      if (!entry) continue;
      expectedContainers.add(entry.container);

      const currentParent = entry.container.parent;
      if (currentParent !== parent) {
        // Reparent
        currentParent?.removeChild(entry.container);
        parent.addChildAt(entry.container, Math.min(i, parent.children.length));
      } else {
        // Reorder within same parent
        const currentIndex = parent.getChildIndex(entry.container);
        if (currentIndex !== i && i < parent.children.length) {
          parent.setChildIndex(entry.container, Math.min(i, parent.children.length - 1));
        }
      }
    }

    // Remove stale/duplicate children that are not expected in this host.
    // This prevents ghost copies after move/reparent operations.
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const child = parent.children[i] as Container;
      if (!expectedContainers.has(child)) {
        parent.removeChild(child);
      }
    }
  }

  let lastScale = useViewportStore.getState().scale;
  let lastX = useViewportStore.getState().x;
  let lastY = useViewportStore.getState().y;
  let textResolutionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let embedResolutionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let imageFillResolutionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let panUpgradeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTextResolutionUpdate(scale: number): void {
    if (textResolutionUpdateTimer) {
      clearTimeout(textResolutionUpdateTimer);
    }
    textResolutionUpdateTimer = setTimeout(() => {
      textResolutionUpdateTimer = null;
      applyTextResolution(getTargetTextResolution(scale));
    }, 120);
  }

  function scheduleEmbedResolutionUpdate(scale: number): void {
    if (embedResolutionUpdateTimer) {
      clearTimeout(embedResolutionUpdateTimer);
    }
    // Slightly longer debounce for embeds since re-rendering is heavier
    embedResolutionUpdateTimer = setTimeout(() => {
      embedResolutionUpdateTimer = null;
      applyEmbedResolution(getTargetEmbedResolution(scale));
    }, 200);
  }

  function scheduleImageFillResolutionUpdate(scale: number): void {
    if (imageFillResolutionUpdateTimer) {
      clearTimeout(imageFillResolutionUpdateTimer);
    }
    imageFillResolutionUpdateTimer = setTimeout(() => {
      imageFillResolutionUpdateTimer = null;
      applyImageFillTextureResolution(getTargetImageFillResolution(scale));
    }, 200);
  }

  // Initial resolutions
  applyTextResolution(getTargetTextResolution(lastScale));
  applyEmbedResolution(getTargetEmbedResolution(lastScale));
  applyImageFillTextureResolution(getTargetImageFillResolution(lastScale));

  function schedulePanUpgrade(): void {
    if (panUpgradeTimer) clearTimeout(panUpgradeTimer);
    panUpgradeTimer = setTimeout(() => {
      panUpgradeTimer = null;
      upgradeVisibleEmbeds(true);
    }, 200);
  }

  const unsubViewport = useViewportStore.subscribe((state) => {
    if (state.scale !== lastScale) {
      lastScale = state.scale;
      lastX = state.x;
      lastY = state.y;
      scheduleTextResolutionUpdate(state.scale);
      scheduleEmbedResolutionUpdate(state.scale);
      scheduleImageFillResolutionUpdate(state.scale);
    } else if (state.x !== lastX || state.y !== lastY) {
      lastX = state.x;
      lastY = state.y;
      schedulePanUpgrade();
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

  // Re-render all nodes when theme or variables change (colors need re-resolution)
  const unsubTheme = useThemeStore.subscribe(() => {
    fullRebuild(useSceneStore.getState());
    prevState = useSceneStore.getState();
  });

  const unsubVariables = useVariableStore.subscribe(() => {
    fullRebuild(useSceneStore.getState());
    prevState = useSceneStore.getState();
  });

  const unsubSelection = useSelectionStore.subscribe(() => {
    applyTextEditingVisibility();
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
    unsubTheme();
    unsubVariables();
    unsubSelection();
    unsubViewport();
    if (textResolutionUpdateTimer) {
      clearTimeout(textResolutionUpdateTimer);
      textResolutionUpdateTimer = null;
    }
    if (embedResolutionUpdateTimer) {
      clearTimeout(embedResolutionUpdateTimer);
      embedResolutionUpdateTimer = null;
    }
    if (imageFillResolutionUpdateTimer) {
      clearTimeout(imageFillResolutionUpdateTimer);
      imageFillResolutionUpdateTimer = null;
    }
    if (panUpgradeTimer) {
      clearTimeout(panUpgradeTimer);
      panUpgradeTimer = null;
    }
    clearPendingSceneUpdate();
    removeFontsListener?.();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    sceneRoot.removeChildren();
  };
}
