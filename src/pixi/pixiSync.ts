import { Container } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatSceneNode, FlatFrameNode, FrameNode, SceneNode } from "@/types/scene";
import { createNodeContainer, updateNodeContainer, applyLayoutSize } from "./renderers";

interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

type NodeLayoutOverride = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

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

  function applyTextEditingVisibility(): void {
    const { editingNodeId, editingMode } = useSelectionStore.getState();
    const isTextEditing = editingMode === "text" && editingNodeId != null;

    for (const [id, entry] of registry) {
      const baseVisible = entry.node.visible !== false;
      const hideWhileEditing =
        isTextEditing && entry.node.type === "text" && editingNodeId === id;
      entry.container.visible = baseVisible && !hideWhileEditing;
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
    updateTextResolution(useViewportStore.getState().scale);
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

    // Handle added nodes
    for (const id of Object.keys(state.nodesById)) {
      if (!prev.nodesById[id]) {
        createAndAttachNode(id, state);
      }
    }

    // Handle removed nodes
    for (const id of Object.keys(prev.nodesById)) {
      if (!state.nodesById[id]) {
        removeNode(id);
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

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state, prev);
    }

    // Always reapply auto-layout positions after any update
    applyAutoLayoutPositions(state);
    updateTextResolution(useViewportStore.getState().scale);
    applyTextEditingVisibility();
  }

  /**
   * Create a new node and attach it to its parent.
   */
  function createAndAttachNode(id: string, state: SceneState): void {
    const node = state.nodesById[id];
    if (!node) return;

    const container = createNodeContainer(
      node,
      state.nodesById,
      state.childrenById,
    );
    registry.set(id, { container, node });

    // Find parent and attach
    const parentId = state.parentById[id];
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
  }

  /**
   * Remove a node from the scene.
   */
  function removeNode(id: string): void {
    const entry = registry.get(id);
    if (entry) {
      entry.container.parent?.removeChild(entry.container);
      entry.container.destroy({ children: true });
      registry.delete(id);
    }
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

  // Update text resolution when viewport scale changes for crisp rendering
  let lastScale = useViewportStore.getState().scale;
  const devicePixelRatio = window.devicePixelRatio || 1;

  function updateTextResolution(scale: number): void {
    // Keep at least DPR even when zoomed out, otherwise text gets blurry on initial fit.
    const targetResolution = Math.max(
      devicePixelRatio,
      Math.ceil(scale * devicePixelRatio),
    );

    function updateContainerTexts(container: Container): void {
      for (const child of container.children) {
        if (child.label === "text-content" && "resolution" in child) {
          const text = child as unknown as { resolution: number };
          if (text.resolution !== targetResolution) {
            text.resolution = targetResolution;
          }
        } else if (child instanceof Container) {
          updateContainerTexts(child);
        }
      }
    }

    updateContainerTexts(sceneRoot);
  }

  // Initial text resolution
  updateTextResolution(lastScale);

  const unsubViewport = useViewportStore.subscribe((state) => {
    if (state.scale !== lastScale) {
      lastScale = state.scale;
      updateTextResolution(state.scale);
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

  return () => {
    unsubScene();
    unsubTheme();
    unsubVariables();
    unsubSelection();
    unsubViewport();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    sceneRoot.removeChildren();
  };
}
