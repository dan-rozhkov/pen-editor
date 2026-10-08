import type { FlatSceneNode } from "@/types/scene";
import { getRenderableStrokes } from "@/utils/fillUtils";

/** Largest OKLab distance at which an unbound color still reads as "meant to be that token". */
export const NEAR_COLOR_DISTANCE = 0.04;

/** `"Name"` for a named node, `type id` otherwise. */
export function nodeLabel(node: FlatSceneNode): string {
  return node.name ? `"${node.name}"` : `${node.type} ${node.id}`;
}

/**
 * Does the node actually draw a stroke? Needs a width (uniform, per side, or
 * the path stroke's thickness) and, except for path strokes, a stroke paint
 * that renders.
 */
export function strokeIsDrawn(node: FlatSceneNode): boolean {
  if (((node as { pathStroke?: { thickness?: number } }).pathStroke?.thickness ?? 0) > 0) return true;
  const sides = node.strokeWidthPerSide;
  const hasWidth =
    (node.strokeWidth ?? 0) > 0 ||
    (!!sides && [sides.top, sides.right, sides.bottom, sides.left].some((v) => (v ?? 0) > 0));
  return hasWidth && getRenderableStrokes(node).length > 0;
}
