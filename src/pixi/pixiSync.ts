import { Container } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import type { FlatSceneNode } from "@/types/scene";
import { createNodeContainer, updateNodeContainer } from "./renderers";

interface RegistryEntry {
  container: Container;
  node: FlatSceneNode;
}

/**
 * Core sync engine: subscribes to Zustand scene store and incrementally updates PixiJS containers.
 * Returns a cleanup function.
 */
export function createPixiSync(sceneRoot: Container): () => void {
  const registry = new Map<string, RegistryEntry>();

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
          updateNodeContainer(
            entry.container,
            node,
            entry.node,
            state.nodesById,
            state.childrenById,
          );
          entry.node = node;
        }
      }
    }

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      reconcileChildren(state, prev);
    }
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

  return () => {
    unsubScene();
    unsubTheme();
    unsubVariables();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    sceneRoot.removeChildren();
  };
}
