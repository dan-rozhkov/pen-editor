import { isContainerNode, type SceneNode, type RefNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { findNodeById } from "@/utils/nodeUtils";
import { resolveRefToTree, findNodeByPath } from "@/utils/instanceRuntime";

export const INTERNAL_CLIPBOARD_PRIORITY_MS = 5000;

export function isTypingTarget(event: KeyboardEvent | ClipboardEvent): boolean {
  const isEditable = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );
  };

  if (isEditable(event.target)) return true;

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const target of path) {
    if (isEditable(target)) return true;
  }

  return false;
}

export function getViewportCenter(dimensions: { width: number; height: number }): {
  x: number;
  y: number;
} {
  const { x, y, scale } = useViewportStore.getState();
  return {
    x: (-x + dimensions.width / 2) / scale,
    y: (-y + dimensions.height / 2) / scale,
  };
}

export function resolvePasteTargetContainerId(
  nodes: SceneNode[],
  selectionState: Pick<
    ReturnType<typeof useSelectionStore.getState>,
    "enteredContainerId" | "selectedIds"
  >,
): string | null {
  if (selectionState.enteredContainerId) {
    const enteredNode = findNodeById(nodes, selectionState.enteredContainerId);
    if (enteredNode && isContainerNode(enteredNode)) {
      return enteredNode.id;
    }
  }

  if (selectionState.selectedIds.length === 1) {
    const selectedNode = findNodeById(nodes, selectionState.selectedIds[0]);
    if (selectedNode && isContainerNode(selectedNode)) {
      return selectedNode.id;
    }
  }

  return null;
}

/**
 * Select-all target ids for the current scope: the entered container's
 * visible children if one is entered, otherwise every visible top-level
 * node. Shared by the Cmd/Ctrl+A keyboard shortcut and the "Select All"
 * command palette entry so the two stay in lockstep.
 *
 * Returns `null` when a container is entered but no longer resolves (stale
 * id after an undo/delete): the caller should leave the selection untouched
 * rather than escaping the container scope by selecting every root node.
 */
export function selectAllInScope(
  nodes: SceneNode[],
  selectionState: Pick<ReturnType<typeof useSelectionStore.getState>, "enteredContainerId">,
): string[] | null {
  const { enteredContainerId } = selectionState;

  if (enteredContainerId) {
    const container = findNodeById(nodes, enteredContainerId);
    if (container && isContainerNode(container)) {
      return container.children
        .filter((n) => n.visible !== false)
        .map((n) => n.id);
    }
    return null;
  }

  return nodes.filter((n) => n.visible !== false).map((n) => n.id);
}

/**
 * Resolve which nodes should be copied based on current selection state.
 * If a descendant inside an instance is selected (instanceContext),
 * resolve the actual descendant node instead of copying the whole instance.
 */
export function resolveNodesToCopy(
  selState: ReturnType<typeof useSelectionStore.getState>,
  nodes: SceneNode[],
): SceneNode[] {
  if (selState.instanceContext) {
    const { instanceId, descendantPath } = selState.instanceContext;
    const state = useSceneStore.getState();
    const instance = state.nodesById[instanceId];
    if (instance?.type === "ref") {
      const resolved = resolveRefToTree(
        instance as RefNode,
        state.nodesById,
        state.childrenById,
      );
      if (resolved) {
        const descendant = findNodeByPath(
          resolved.children,
          descendantPath,
          state.nodesById,
          state.childrenById,
        );
        if (descendant) return [descendant];
      }
    }
    // Fallback: nothing resolvable
    return [];
  }

  return selState.selectedIds
    .map((id) => findNodeById(nodes, id))
    .filter((n): n is SceneNode => n != null);
}
