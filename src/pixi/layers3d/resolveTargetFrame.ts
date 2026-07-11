import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { getAncestorIds } from "@/utils/nodeUtils";

/**
 * Resolve which frame should be exploded into the 3D layer view.
 *
 * Resolution order:
 * 1. If a selected node IS a frame, use it directly.
 * 2. If a selected node is inside a frame, use its nearest ancestor frame.
 * 3. Otherwise fall back to the first top-level frame in `rootIds`.
 * 4. If no frame exists at all, return null (disables the 3D toggle).
 */
export function resolveTargetFrame(): string | null {
  const { nodesById, parentById, rootIds } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();

  const selId = selectedIds[0];
  if (selId && nodesById[selId]) {
    if (nodesById[selId].type === "frame") return selId;

    const ancestorFrameId = getAncestorIds(parentById, selId).find(
      (ancestorId) => nodesById[ancestorId]?.type === "frame",
    );
    if (ancestorFrameId) return ancestorFrameId;
  }

  const firstFrame = rootIds.find((id) => nodesById[id]?.type === "frame");
  return firstFrame ?? null;
}
