import { Container, Text } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import type { FlatSceneNode } from "@/types/scene";
import type { SceneState } from "@/store/sceneStore";
import { createNodeContainer } from "./renderers";
import { withAncestorThemes, type SyncContext } from "./syncHelpers";

export function createNodeTreeManager(
  ctx: SyncContext,
  getAppliedTextResolution: () => number,
  onNodeRemoved?: (id: string) => void,
) {
  const { sceneRoot, registry } = ctx;
  let hiddenInstanceContainer: Container | null = null;

  function findContainerByLabel(parent: Container, label: string): Container | null {
    for (const child of parent.children) {
      if (child instanceof Container) {
        if (child.label === label) return child;
        const found = findContainerByLabel(child, label);
        if (found) return found;
      }
    }
    return null;
  }

  function applyTextEditingVisibility(): void {
    const { editingNodeId, editingMode, instanceContext } = useSelectionStore.getState();
    const isTextEditing = editingMode === "text" && editingNodeId != null;
    const isEmbedEditing = editingMode === "embed" && editingNodeId != null;

    // Restore previously hidden instance container
    if (hiddenInstanceContainer) {
      hiddenInstanceContainer.visible = true;
      hiddenInstanceContainer = null;
    }

    // Handle instance descendant editing (ref children aren't in the registry)
    if ((isTextEditing || isEmbedEditing) && instanceContext) {
      const refEntry = registry.get(instanceContext.instanceId);
      if (refEntry) {
        const segments = editingNodeId!.split("/");
        const targetId = segments[segments.length - 1];
        const found = findContainerByLabel(refEntry.container, targetId);
        if (found) {
          found.visible = false;
          hiddenInstanceContainer = found;
        }
      }
    }

    // Existing logic for registered (non-instance) nodes
    for (const [id, entry] of registry) {
      const baseVisible = entry.node.visible !== false && entry.node.enabled !== false;
      const hideWhileEditing = (
        (isTextEditing && entry.node.type === "text" && editingNodeId === id) ||
        (isEmbedEditing && entry.node.type === "embed" && editingNodeId === id)
      );
      entry.container.visible = baseVisible && !hideWhileEditing;
    }
  }

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
      const appliedTextResolution = getAppliedTextResolution();
      const textObj = createdContainer.getChildByLabel("text-content") as Text | undefined;
      if (textObj && textObj.resolution !== appliedTextResolution) {
        textObj.resolution = appliedTextResolution;
      }
    }
  }

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
    onNodeRemoved?.(id);
  }

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

  return {
    buildNodeTree,
    registerChildrenRecursive,
    createAndAttachNode,
    removeNode,
    reconcileChildren,
    applyTextEditingVisibility,
  };
}
