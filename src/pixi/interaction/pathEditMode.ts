import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { usePenToolStore } from "@/store/penToolStore";
import { svgPathToAnchors } from "@/utils/pathAnchors";
import type { PathNode } from "@/types/scene";

/**
 * Enter anchor-edit mode on a text-on-path node's curve (the "Edit path"
 * button in the Typography panel's Path section, or Enter while it's the
 * sole selection — mirrors `enterPathEditMode` below). Unlike a plain
 * `PathNode`, a text-on-path node is entered into edit mode explicitly
 * rather than via double-click, because double-click on a text node already
 * means "start inline text editing" (see `pixiInteractionCore.ts`'s
 * `handleDblClick`) — the two gestures would otherwise collide.
 *
 * Returns false (no-op) for non-text nodes and text nodes without a
 * `textPath` (nothing to anchor-edit).
 */
export function enterTextPathEditMode(nodeId: string): boolean {
  const scene = useSceneStore.getState();
  const node = scene.nodesById[nodeId];
  if (!node || node.type !== "text" || !node.textPath) return false;

  useSelectionStore.getState().select(nodeId);
  useSelectionStore.getState().startEditing(nodeId, "text-path");
  return true;
}

/**
 * Enter point-edit mode on a path node (double-click on the node, or Enter
 * while it's the sole selection). Legacy paths (pencil-drawn strokes, loaded
 * .pen files, imported SVGs) don't carry a structured `points` array yet —
 * this lazily derives one from `geometry` the first time, via the same
 * parser used everywhere else, so pencil-drawn paths are editable through
 * the exact same mode as pen-tool-drawn ones.
 *
 * Returns false (no-op) for non-path nodes, for paths whose geometry is
 * structurally out of scope for point-editing (compound paths with multiple
 * subpaths, or arcs) — a known, documented limitation — and while a pen-tool
 * draft is in progress: a draft and edit mode are mutually exclusive
 * interaction states, so a double-click on an existing path mid-draft is
 * simply ignored (the draft keeps its anchors; the user finishes or cancels
 * it explicitly with a close-click/Enter/Esc).
 */
export function enterPathEditMode(nodeId: string): boolean {
  if (usePenToolStore.getState().isDrafting) return false;

  const scene = useSceneStore.getState();
  const node = scene.nodesById[nodeId];
  if (!node || node.type !== "path") return false;

  const pathNode = node as PathNode;
  if (!pathNode.points || pathNode.points.length === 0) {
    const parsed = svgPathToAnchors(pathNode.geometry);
    if (!parsed) return false;
    // Purely additive metadata (geometry itself is unchanged) — no history
    // entry for this passive migration step.
    scene.updateNodeWithoutHistory(nodeId, { points: parsed.points, closed: parsed.closed });
  }

  useSelectionStore.getState().select(nodeId);
  useSelectionStore.getState().startEditing(nodeId, "path");
  return true;
}
