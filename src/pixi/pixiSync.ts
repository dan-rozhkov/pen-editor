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

interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

const TEXT_RESOLUTION_SHARPNESS_BOOST = 1.35;
const TEXT_RESOLUTION_MAX_MULTIPLIER = 3;

type NodeLayoutOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

function isDescendantOf(
  parentById: Record<string, string | null>,
  ancestorId: string,
  targetId: string,
): boolean {
  let current = parentById[targetId];
  while (current != null) {
    if (current === ancestorId) return true;
    current = parentById[current];
  }
  return false;
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
    const { editingNodeId, editingMode, instanceContext } = useSelectionStore.getState();
    const isTextEditing = editingMode === "text" && editingNodeId != null;

    for (const [id, entry] of registry) {
      const baseVisible = entry.node.visible !== false;
      const hideWhileEditing =
        isTextEditing && entry.node.type === "text" && editingNodeId === id;
      entry.container.visible = baseVisible && !hideWhileEditing;
    }

    // Reset descendant visibility for all instances before applying current edit hide rule.
    for (const entry of registry.values()) {
      if (entry.node.type !== "ref") continue;
      const refChildren = entry.container.getChildByLabel("ref-children") as Container | null;
      if (refChildren) {
        setDescendantVisibility(refChildren, true);
      }
    }

    // Hide descendant text inside instance during editing
    if (editingMode === "text" && instanceContext) {
      const { instanceId, descendantId } = instanceContext;
      const instanceEntry = registry.get(instanceId);
      if (instanceEntry) {
        const refChildren = instanceEntry.container.getChildByLabel("ref-children") as Container | null;
        if (refChildren) {
          // Search recursively for the labeled descendant container
          const descContainer = findDescendantContainer(refChildren, descendantId);
          if (descContainer) {
            descContainer.visible = false;
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

  function setDescendantVisibility(parent: Container, visible: boolean): void {
    for (const child of parent.children) {
      if (!(child instanceof Container)) continue;
      if (typeof child.label === "string" && child.label.startsWith("desc-")) {
        child.visible = visible;
      }
      setDescendantVisibility(child, visible);
    }
  }

  /**
   * Apply auto-layout positions to frame children
   */
  function applyAutoLayoutPositions(state: SceneState): void {
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutOverrides = new Map<string, NodeLayoutOverride>();

    const applyFrameLayoutRecursively = (frameId: string): void => {
      const frameNode = state.nodesById[frameId];
      if (!frameNode || frameNode.type !== "frame") return;

      const childIds = state.childrenById[frameId] ?? [];

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
          let frameWidth = frameNode.width;
          let frameHeight = frameNode.height;

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
            applyLayoutSize(frameEntry.container, frameEntry.node, frameWidth, frameHeight);
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
              applyLayoutSize(
                childEntry.container,
                childEntry.node,
                layoutChild.width,
                layoutChild.height,
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

    // Process from roots to guarantee parent overrides are known before children.
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

          updateNodeContainer(
            entry.container,
            node,
            entry.node,
            state.nodesById,
            state.childrenById,
            isInAutoLayout, // skipPosition for auto-layout children
          );
          entry.node = node;
        }
      }
    }

    // Rebuild instances whose source component/subtree changed even if ref node itself didn't.
    if (changedIds.size > 0) {
      for (const [id, node] of Object.entries(state.nodesById)) {
        if (node.type !== "ref") continue;
        const entry = registry.get(id);
        if (!entry) continue;

        const componentId = node.componentId;
        let shouldRebuild = changedIds.has(componentId);

        if (!shouldRebuild) {
          for (const changedId of changedIds) {
            if (
              isDescendantOf(state.parentById, componentId, changedId) ||
              isDescendantOf(prev.parentById, componentId, changedId)
            ) {
              shouldRebuild = true;
              break;
            }
          }
        }

        if (!shouldRebuild) continue;

        updateNodeContainer(
          entry.container,
          node,
          node,
          state.nodesById,
          state.childrenById,
          false,
          true,
        );
        entry.node = node;
      }
    }

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state, prev);
    }

    // Always reapply auto-layout positions after any update
    applyAutoLayoutPositions(state);
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

    const container = createNodeContainer(
      node,
      state.nodesById,
      state.childrenById,
    );
    registry.set(id, { container, node });

    // Find parent and attach
    if (parentId) {
      const parentEntry = registry.get(parentId);
      if (parentEntry) {
        const childrenHost =
          parentEntry.container.getChildByLabel("frame-children") ??
          parentEntry.container.getChildByLabel("group-children") ??
          parentEntry.container.getChildByLabel("ref-children");
        if (childrenHost) {
          (childrenHost as Container).addChild(container);
        }
      }
    } else {
      // Root node
      sceneRoot.addChild(container);
    }

    // Register any nested children
    registerChildrenRecursive(id, state.nodesById, state.childrenById, container);

    if (node.type === "text") {
      const textObj = container.getChildByLabel("text-content") as Text | undefined;
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
    for (let i = 0; i < expectedIds.length; i++) {
      const id = expectedIds[i];
      const entry = registry.get(id);
      if (!entry) continue;

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
  const unsubScene = useSceneStore.subscribe((state) => {
    incrementalUpdate(state, prevState);
    prevState = state;
  });

  const rebuildFromCurrentState = (): void => {
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
    removeFontsListener?.();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    sceneRoot.removeChildren();
  };
}
