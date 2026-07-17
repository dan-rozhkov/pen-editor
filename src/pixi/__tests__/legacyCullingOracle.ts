import type { FlatSceneNode } from "@/types/scene";
import type { ViewportBounds } from "@/utils/viewportUtils";

/**
 * Test-only oracle: the pre-`cullingIndex` full-tree viewport-renderability
 * walk. Production code no longer calls this (the grid-backed
 * `cullingIndex` replaced it — see `viewportCulling.ts`'s remaining live
 * exports, `applyOverviewEffectVisibility`/`isOverviewScale`), but it's kept
 * here, test-only, as an independent reference implementation that
 * `cullingIndex.test.ts` diffs `queryVisible` against.
 */
interface ViewportRenderabilityInput {
  rootIds: string[];
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  bounds: ViewportBounds;
  margin: number;
}

const intersects = (
  node: FlatSceneNode,
  offsetX: number,
  offsetY: number,
  bounds: ViewportBounds,
  margin: number,
): boolean => {
  const x = offsetX + node.x;
  const y = offsetY + node.y;
  return !(
    x + node.width < bounds.minX - margin ||
    x > bounds.maxX + margin ||
    y + node.height < bounds.minY - margin ||
    y > bounds.maxY + margin
  );
};

/**
 * Computes renderability top-down. Descendants of a culled node are omitted:
 * hiding the ancestor already skips the entire Pixi subtree.
 */
export function computeViewportRenderability({
  rootIds,
  nodesById,
  childrenById,
  bounds,
  margin,
}: ViewportRenderabilityInput): Map<string, boolean> {
  const result = new Map<string, boolean>();

  const visit = (
    id: string,
    offsetX: number,
    offsetY: number,
    hasRotatedAncestor = false,
  ): void => {
    const current = nodesById[id];
    if (!current) return;

    const hasRotation = hasRotatedAncestor || (current.rotation ?? 0) !== 0;
    const renderable =
      hasRotation || intersects(current, offsetX, offsetY, bounds, margin);
    result.set(id, renderable);
    if (!renderable) return;

    const childOffsetX = offsetX + current.x;
    const childOffsetY = offsetY + current.y;
    for (const childId of childrenById[id] ?? []) {
      visit(childId, childOffsetX, childOffsetY, hasRotation);
    }
  };

  for (const rootId of rootIds) visit(rootId, 0, 0);
  return result;
}
