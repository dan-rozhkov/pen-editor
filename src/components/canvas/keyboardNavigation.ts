import {
  type SceneNode,
  type HistorySnapshot,
  type RefNode,
} from "@/types/scene";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findNodeById, findParentFrame } from "@/utils/nodeUtils";
import { resolveRefToTree, findNodeByPath } from "@/utils/instanceRuntime";

const ARROW_CODES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/**
 * Handle the Enter key (without Shift) for entering text/embed editing on the
 * single selected node — including descendants inside component instances.
 * Returns `true` if the event was consumed.
 */
export function handleEnterEditing(
  e: KeyboardEvent,
  nodes: SceneNode[],
): boolean {
  const { selectedIds, editingNodeId, editingMode, instanceContext } =
    useSelectionStore.getState();

  if (editingNodeId || editingMode || selectedIds.length !== 1) return false;

  // Handle instance descendant text editing
  if (instanceContext) {
    const scState = useSceneStore.getState();
    const refNode = scState.nodesById[instanceContext.instanceId];
    if (refNode?.type === "ref") {
      const resolved = resolveRefToTree(refNode as RefNode, scState.nodesById, scState.childrenById);
      if (resolved) {
        const descNode = findNodeByPath(resolved.children, instanceContext.descendantPath);
        if (descNode?.type === "text") {
          e.preventDefault();
          useSelectionStore.getState().startEditing(instanceContext.descendantPath);
          return true;
        } else if (descNode?.type === "embed") {
          e.preventDefault();
          useSelectionStore.getState().startEditing(instanceContext.descendantPath, "embed");
          return true;
        }
      }
    }
  }

  const selectedNode = findNodeById(nodes, selectedIds[0]);
  if (selectedNode?.type === "text") {
    e.preventDefault();
    useSelectionStore.getState().startEditing(selectedNode.id);
    return true;
  }

  return false;
}

/**
 * Handle the Tab key to move the selection to the next sibling node (Shift+Tab
 * for the previous one). Selection wraps around within the current parent's
 * children (or the root nodes for a top-level selection). Hidden nodes are
 * skipped. No-op unless exactly one node is selected. Returns `true` if the
 * event was consumed.
 */
export function handleTabNavigation(e: KeyboardEvent): boolean {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length !== 1) return false;

  const currentId = selectedIds[0];
  const scene = useSceneStore.getState();
  const parentId = scene.parentById[currentId] ?? null;
  const siblingIds = parentId
    ? scene.childrenById[parentId] ?? []
    : scene.rootIds;

  // Only navigate among visible siblings so Tab doesn't land on hidden nodes.
  const visibleSiblings = siblingIds.filter(
    (id) => scene.nodesById[id]?.visible !== false,
  );
  if (visibleSiblings.length === 0) return false;

  const currentIndex = visibleSiblings.indexOf(currentId);
  if (currentIndex === -1) return false;

  const delta = e.shiftKey ? -1 : 1;
  const nextIndex =
    (currentIndex + delta + visibleSiblings.length) % visibleSiblings.length;
  const nextId = visibleSiblings[nextIndex];

  if (nextId && nextId !== currentId) {
    useSelectionStore.getState().select(nextId);
  }
  return true;
}

interface ArrowKeyDeps {
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  moveNode: (nodeId: string, targetParentId: string, index: number) => void;
  saveHistory: (snapshot: HistorySnapshot) => void;
}

/**
 * Handle arrow keys: nudge nodes outside auto-layout, or reorder a single node
 * inside an auto-layout frame. Returns `true` if the event was an arrow key
 * (regardless of whether a mutation occurred), so the caller can stop.
 */
export function handleArrowKeys(e: KeyboardEvent, deps: ArrowKeyDeps): boolean {
  if (!ARROW_CODES.includes(e.code)) return false;

  const { updateNode, moveNode, saveHistory } = deps;

  const ids = useSelectionStore.getState().selectedIds;
  if (ids.length === 0) return true;

  const currentNodes = useSceneStore.getState().getNodes();

  const nodesOutsideAutoLayout: string[] = [];
  const nodesInsideAutoLayout: string[] = [];

  for (const id of ids) {
    const parentContext = findParentFrame(currentNodes, id);
    if (parentContext.isInsideAutoLayout) {
      nodesInsideAutoLayout.push(id);
    } else {
      nodesOutsideAutoLayout.push(id);
    }
  }

  if (nodesOutsideAutoLayout.length > 0) {
    e.preventDefault();

    const step = e.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;

    if (e.code === "ArrowLeft") dx = -step;
    else if (e.code === "ArrowRight") dx = step;
    else if (e.code === "ArrowUp") dy = -step;
    else if (e.code === "ArrowDown") dy = step;

    saveHistory(createSnapshot(useSceneStore.getState()));

    for (const id of nodesOutsideAutoLayout) {
      const node = findNodeById(currentNodes, id);
      if (node) {
        updateNode(id, { x: node.x + dx, y: node.y + dy });
      }
    }
    return true;
  }

  if (nodesInsideAutoLayout.length === 1) {
    const nodeId = nodesInsideAutoLayout[0];

    const parentContext = findParentFrame(currentNodes, nodeId);
    if (!parentContext.parent || parentContext.parent.type !== "frame")
      return true;

    const parentFrame = parentContext.parent;
    const layout = parentFrame.layout;
    const isHorizontal =
      layout?.flexDirection === "row" ||
      layout?.flexDirection === undefined;

    let direction: "prev" | "next" | null = null;

    if (isHorizontal) {
      if (e.code === "ArrowLeft") direction = "prev";
      else if (e.code === "ArrowRight") direction = "next";
    } else {
      if (e.code === "ArrowUp") direction = "prev";
      else if (e.code === "ArrowDown") direction = "next";
    }

    if (!direction) return true;

    e.preventDefault();

    const currentIndex = parentFrame.children.findIndex(
      (c) => c.id === nodeId,
    );
    if (currentIndex === -1) return true;

    const newIndex =
      direction === "prev"
        ? Math.max(0, currentIndex - 1)
        : Math.min(parentFrame.children.length - 1, currentIndex + 1);

    if (newIndex === currentIndex) return true;

    saveHistory(createSnapshot(useSceneStore.getState()));
    moveNode(nodeId, parentFrame.id, newIndex);
    return true;
  }

  return true;
}
