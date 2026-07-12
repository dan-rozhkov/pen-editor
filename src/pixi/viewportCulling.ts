import type { Container, Filter } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import type { ViewportBounds } from "@/utils/viewportUtils";

interface ViewportRenderabilityInput {
  rootIds: string[];
  nodesById: Record<string, FlatSceneNode>;
  childrenById: Record<string, string[]>;
  bounds: ViewportBounds;
  scale: number;
  margin: number;
}

const OVERVIEW_SCALE = 0.2;
const MIN_TEXT_SCREEN_HEIGHT = 3;
const EFFECT_LABELS = new Set([
  "shadow-layer",
  "inner-shadow-layer",
  "background-blur-fill",
]);
const previousEffectRenderability = new WeakMap<Container, boolean>();
const previousFilterEnabled = new WeakMap<Filter, boolean>();

type LayerBlurFilter = Filter & { __layerBlur?: true };

export const isOverviewScale = (scale: number): boolean => scale <= OVERVIEW_SCALE;

/** Toggle only renderer-owned effect objects, retaining their previous state. */
export function applyOverviewEffectVisibility(
  container: Container,
  overview: boolean,
): void {
  for (const child of container.children) {
    if (!EFFECT_LABELS.has(child.label)) continue;
    if (overview) {
      if (!previousEffectRenderability.has(child)) {
        previousEffectRenderability.set(child, child.renderable);
      }
      child.renderable = false;
    } else {
      const previous = previousEffectRenderability.get(child);
      if (previous !== undefined) child.renderable = previous;
      previousEffectRenderability.delete(child);
    }
  }

  for (const filter of (container.filters ?? []) as Filter[]) {
    const layerBlur = filter as LayerBlurFilter;
    if (!layerBlur.__layerBlur) continue;
    if (overview) {
      if (!previousFilterEnabled.has(filter)) {
        previousFilterEnabled.set(filter, filter.enabled);
      }
      filter.enabled = false;
    } else {
      const previous = previousFilterEnabled.get(filter);
      if (previous !== undefined) filter.enabled = previous;
      previousFilterEnabled.delete(filter);
    }
  }
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
  scale,
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
    const isTinyOverviewText =
      isOverviewScale(scale) &&
      current.type === "text" &&
      !current.isMask &&
      current.height * scale < MIN_TEXT_SCREEN_HEIGHT;
    const renderable =
      hasRotation ||
      (!isTinyOverviewText && intersects(current, offsetX, offsetY, bounds, margin));
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
