import type { FlatSceneNode } from "@/types/scene";

/**
 * Resolve the slide (presentation) order for top-level frames.
 *
 * `slideOrder` is a persisted list of ids that is independent of canvas
 * layout (x/y) and independent of `rootIds` (tree/z-order). This helper is
 * the single place that reconciles it against the current scene:
 *
 *  - ids from `slideOrder` that still exist and are top-level frames are
 *    kept, in `slideOrder`'s order;
 *  - top-level frames not (yet) present in `slideOrder` — e.g. newly added
 *    slides — are appended at the end, in their "natural" `rootIds` order;
 *  - ids in `slideOrder` that no longer exist (deleted) or are no longer
 *    top-level frames are dropped.
 *
 * Pure — reads no stores, mutates nothing.
 */
export function resolveSlideOrder(
  nodesById: Record<string, FlatSceneNode>,
  rootIds: string[],
  slideOrder: string[],
): string[] {
  const topLevelFrameIds = new Set(
    rootIds.filter((id) => nodesById[id]?.type === "frame"),
  );

  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const id of slideOrder) {
    if (topLevelFrameIds.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  for (const id of rootIds) {
    if (topLevelFrameIds.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered;
}
