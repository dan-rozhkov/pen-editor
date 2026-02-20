import { Container, Text } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatSceneNode, FlatFrameNode, FrameNode, SceneNode } from "@/types/scene";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { createNodeContainer, updateNodeContainer, applyLayoutSize } from "./renderers";
import {
  pushRenderTheme,
  popRenderTheme,
  resetRenderThemeStack,
  getRenderThemeStackDepth,
} from "./renderers/colorHelpers";

interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

const TEXT_RESOLUTION_SHARPNESS_BOOST = 1.35;
const TEXT_RESOLUTION_MAX_MULTIPLIER = 16;

type NodeLayoutOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type AutoLayoutFrameSet = Set<string>;

function isReusableFrame(node: FlatSceneNode | undefined): node is FlatFrameNode {
  return node?.type === "frame" && (node as FlatFrameNode).reusable === true;
}

function collectChangedComponentIds(
  changedIds: Set<string>,
  state: SceneState,
  prev: SceneState,
): Set<string> {
  const affected = new Set<string>();

  const markAncestors = (
    startId: string,
    nodesById: Record<string, FlatSceneNode>,
    parentById: Record<string, string | null>,
  ): void => {
    let current: string | null = startId;
    while (current != null) {
      const currentNode = nodesById[current];
      if (isReusableFrame(currentNode)) {
        affected.add(current);
      }
      current = parentById[current] ?? null;
    }
  };

  for (const changedId of changedIds) {
    markAncestors(changedId, state.nodesById, state.parentById);
    markAncestors(changedId, prev.nodesById, prev.parentById);
  }

  return affected;
}

function findContainerByLabelRecursive(
  root: Container,
  label: string,
): Container | null {
  for (const child of root.children) {
    if (child instanceof Container) {
      if (child.label === label) return child;
      const found = findContainerByLabelRecursive(child, label);
      if (found) return found;
    }
  }
  return null;
}

function getRenderedRefSize(
  refContainer: Container,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const refBg = findContainerByLabelRecursive(refContainer, "ref-bg");
  const target = refBg ?? findContainerByLabelRecursive(refContainer, "ref-children");
  if (!target) return fallback;

  const bounds = target.getLocalBounds();
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return fallback;
  }
  if (bounds.width <= 0 || bounds.height <= 0) return fallback;

  return {
    width: bounds.width,
    height: bounds.height,
  };
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
  let hiddenEditingDescContainer: Container | null = null;

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
    const { editingNodeId, editingMode, instanceContext } = useSelectionStore.getState();
    const isTextEditing = editingMode === "text" && editingNodeId != null;

    for (const [id, entry] of registry) {
      const baseVisible = entry.node.visible !== false && entry.node.enabled !== false;
      const hideWhileEditing =
        isTextEditing && entry.node.type === "text" && editingNodeId === id;
      entry.container.visible = baseVisible && !hideWhileEditing;
    }

    // Restore only the descendant container that was hidden for text editing previously.
    // Do not force-show all descendants: that breaks true hidden state from node props.
    if (hiddenEditingDescContainer) {
      hiddenEditingDescContainer.visible = true;
      hiddenEditingDescContainer = null;
    }

    // Hide descendant text inside instance during editing
    if (editingMode === "text" && instanceContext) {
      const { instanceId, descendantId, descendantPath } = instanceContext;
      const instanceEntry = registry.get(instanceId);
      if (instanceEntry) {
        const refChildren = instanceEntry.container.getChildByLabel("ref-children") as Container | null;
        if (refChildren) {
          const descContainer = descendantPath
            ? findDescendantContainerByPath(refChildren, descendantPath)
            : findDescendantContainer(refChildren, descendantId);
          if (descContainer) {
            // Hide only text descendants (to avoid accidentally hiding full frame/group trees
            // when instanceContext points to a non-text node).
            const textNode = descContainer.getChildByLabel("text-content");
            if (textNode) {
              descContainer.visible = false;
              hiddenEditingDescContainer = descContainer;
            }
          }
        }
      }
    }
  }

  function findDescendantContainer(parent: Container, descendantId: string): Container | null {
    const label = `desc-${descendantId}`;
    for (const child of parent.children) {
      if (child.label === label) return child as Container;
      if (child instanceof Container) {
        const found = findDescendantContainer(child, descendantId);
        if (found) return found;
      }
    }
    return null;
  }

  function findDescendantContainerByPath(
    refChildren: Container,
    path: string,
  ): Container | null {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) return null;

    let currentHost: Container | null = refChildren;
    let currentNode: Container | null = null;

    for (const segment of segments) {
      if (!currentHost) return null;
      const descendantChildren = currentHost.children.filter(
        (child) =>
          child instanceof Container &&
          typeof child.label === "string" &&
          child.label.startsWith("desc-"),
      ) as Container[];
      const nextNode = descendantChildren.find(
        (child) => child.label === `desc-${segment}`,
      );
      if (!nextNode) {
        return null;
      }
      currentNode = nextNode;
      if (!(currentNode instanceof Container)) return null;
      const nextHost = currentNode.getChildByLabel("frame-children")
        ?? currentNode.getChildByLabel("group-children");
      currentHost = (nextHost as Container | null) ?? null;
    }

    return currentNode;
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

      // For ref children, prefer the currently rendered size (it already reflects
      // component updates). Store size overrides so parent auto-layout positions
      // are computed from up-to-date instance bounds.
      for (const childId of childIds) {
        const childNode = state.nodesById[childId];
        if (!childNode || childNode.type !== "ref") continue;
        const childEntry = registry.get(childId);
        if (!childEntry) continue;
        const renderedSize = getRenderedRefSize(childEntry.container, {
          width: childNode.width,
          height: childNode.height,
        });
        layoutOverrides.set(childId, {
          ...(layoutOverrides.get(childId) ?? {}),
          width: renderedSize.width,
          height: renderedSize.height,
        });
      }

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
    applyTextResolution(getTargetTextResolution(useViewportStore.getState().scale));
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
      parentContainer.getChildByLabel("group-children") ??
      parentContainer.getChildByLabel("ref-children");

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

    // Handle removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        removeNode(id, prev.childrenById);
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
            );
          });
          entry.node = node;
        }
      }
    }

    // Rebuild instances whose source component/subtree changed even if ref node itself didn't.
    const rebuiltInstanceIds = new Set<string>();
    if (changedIds.size > 0) {
      const affectedComponentIds = collectChangedComponentIds(
        changedIds,
        state,
        prev,
      );
      if (affectedComponentIds.size === 0) {
        // Continue with structural/layout/text updates below.
      } else {
      for (const [id, node] of Object.entries(state.nodesById)) {
        if (node.type !== "ref") continue;
        const entry = registry.get(id);
        if (!entry) continue;

        if (!affectedComponentIds.has(node.componentId)) continue;

        withAncestorThemes(id, state.parentById, state.nodesById, () => {
          updateNodeContainer(
            entry.container,
            node,
            node,
            state.nodesById,
            state.childrenById,
            false,
            true,
          );
        });
        entry.node = node;
        rebuiltInstanceIds.add(id);
      }
      }
    }

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state, prev);
    }

    // Reapply only affected auto-layout frame chains.
    // When component changes rebuild instances, their auto-layout parents must be
    // reflowed too (even if the ref node object itself didn't change in store).
    const autoLayoutChangedIds =
      rebuiltInstanceIds.size > 0
        ? new Set<string>([...changedIds, ...rebuiltInstanceIds])
        : changedIds;
    const dirtyAutoLayoutFrames = collectDirtyAutoLayoutFrames(
      state,
      autoLayoutChangedIds,
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
          parentEntry.container.getChildByLabel("group-children") ??
          parentEntry.container.getChildByLabel("ref-children");
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
  ): void {
    const childIds = prevChildrenById[id] ?? [];
    for (const childId of childIds) {
      removeNode(childId, prevChildrenById);
    }

    const entry = registry.get(id);
    if (!entry) return;

    if (!entry.container.destroyed) {
      entry.container.parent?.removeChild(entry.container);
      entry.container.destroy({ children: true });
    }
    registry.delete(id);
  }

  /**
   * Reconcile children order after structural changes.
   */
  function reconcileChildren(state: SceneState, prev: SceneState): void {
    // Reconcile root level
    if (state.rootIds !== prev.rootIds) {
      reconcileChildList(state.rootIds, sceneRoot, "root");
    }

    // Reconcile changed parent containers
    for (const id of Object.keys(state.childrenById)) {
      if (state.childrenById[id] !== prev.childrenById[id]) {
        const entry = registry.get(id);
        if (entry) {
          const childrenHost =
            entry.container.getChildByLabel("frame-children") ??
            entry.container.getChildByLabel("group-children") ??
            entry.container.getChildByLabel("ref-children");
          if (childrenHost) {
            reconcileChildList(
              state.childrenById[id],
              childrenHost as Container,
              id,
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
    _debugLabel: string,
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
  let textResolutionUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleTextResolutionUpdate(scale: number): void {
    if (textResolutionUpdateTimer) {
      clearTimeout(textResolutionUpdateTimer);
    }
    textResolutionUpdateTimer = setTimeout(() => {
      textResolutionUpdateTimer = null;
      applyTextResolution(getTargetTextResolution(scale));
    }, 120);
  }

  // Initial text resolution
  applyTextResolution(getTargetTextResolution(lastScale));

  const unsubViewport = useViewportStore.subscribe((state) => {
    if (state.scale !== lastScale) {
      lastScale = state.scale;
      scheduleTextResolutionUpdate(state.scale);
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
