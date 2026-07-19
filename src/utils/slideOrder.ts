import type { EmbedNode, FlatFrameNode, FlatSceneNode } from "@/types/scene";

export type SlideNode = FlatFrameNode | EmbedNode;

export function isSlideNode(
  node: FlatSceneNode | undefined,
): node is SlideNode {
  return node?.type === "frame" || node?.type === "embed";
}

/**
 * Resolve the slide (presentation) order for top-level frames and embeds.
 *
 * `slideOrder` is a persisted list of ids that is independent of canvas
 * layout (x/y) and independent of `rootIds` (tree/z-order). This helper is
 * the single place that reconciles it against the current scene:
 *
 *  - ids from `slideOrder` that still exist and are top-level slide nodes are
 *    kept, in `slideOrder`'s order;
 *  - top-level frames/embeds not (yet) present in `slideOrder` — e.g. newly added
 *    slides — are appended at the end, in their "natural" `rootIds` order;
 *  - ids in `slideOrder` that no longer exist (deleted) or are no longer
 *    top-level slide nodes are dropped.
 *
 * Pure — reads no stores, mutates nothing.
 */
export function resolveSlideOrder(
  nodesById: Record<string, FlatSceneNode>,
  rootIds: string[],
  slideOrder: string[],
): string[] {
  const topLevelSlideIds = new Set(
    rootIds.filter((id) => isSlideNode(nodesById[id])),
  );

  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const id of slideOrder) {
    if (topLevelSlideIds.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  for (const id of rootIds) {
    if (topLevelSlideIds.has(id) && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered;
}
