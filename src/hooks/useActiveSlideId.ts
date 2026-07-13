import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { topLevelAncestorId } from "@/utils/topLevelAncestor";

/**
 * The "active slide" is the top-level frame ancestor of the current
 * selection (matching `SlidesPanel`/present-mode's notion of a slide).
 * Returns `null` when nothing is selected, or when the top-level ancestor
 * isn't a frame (e.g. a floating non-frame root node is selected).
 */
export function useActiveSlideId(): string | null {
  const selectedId = useSelectionStore((s) => s.selectedIds[0] ?? null);
  const parentById = useSceneStore((s) => s.parentById);
  const nodesById = useSceneStore((s) => s.nodesById);

  if (!selectedId) return null;
  const topId = topLevelAncestorId(parentById, selectedId);
  const topNode = nodesById[topId];
  if (!topNode || topNode.type !== "frame") return null;
  return topId;
}
