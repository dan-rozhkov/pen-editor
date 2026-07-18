import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { getAncestorIds } from "@/utils/nodeUtils";
import type { FlatSceneNode } from "@/types/scene";

/**
 * Resolve which frame should be exploded into the 3D layer view.
 *
 * Resolution order:
 * 1. If a selected node IS a frame, use it directly.
 * 2. If a selected node is inside a frame, use its nearest ancestor frame.
 * 3. Otherwise fall back to the first top-level frame in `rootIds`.
 * 4. If no frame exists at all, return null (disables the 3D toggle).
 *
 * Pure function of its explicit inputs so callers can subscribe to it via a
 * selector (e.g. `useSceneStore((s) => resolveTargetFrame(s.nodesById, ...))`)
 * instead of reading store state untracked during render.
 */
export function resolveTargetFrame(
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  rootIds: string[],
  selectedIds: string[],
): string | null {
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

/**
 * Zero-arg convenience wrapper reading current store state imperatively.
 * Only for use outside render (e.g. click handlers) — components that need
 * to re-render on changes should call `resolveTargetFrame` via a selector.
 */
export function resolveTargetFrameFromState(): string | null {
  const { nodesById, parentById, rootIds } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  return resolveTargetFrame(nodesById, parentById, rootIds, selectedIds);
}
