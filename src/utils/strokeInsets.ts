import type { BaseNode, Paint } from "@/types/scene";
import { getRenderableStrokes } from "./fillUtils";

/**
 * Per-side inside-stroke widths of a node, in px. This is the CSS `border`
 * analogue for layout: only `strokeAlign: 'inside'` strokes with a renderable
 * paint contribute; `center`/`outside` strokes behave like CSS `outline` and
 * never take layout space.
 */
export interface SideInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_INSETS: SideInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

type StrokeGeometrySource = Pick<
  BaseNode,
  | "stroke"
  | "strokeOpacity"
  | "strokeBinding"
  | "strokeWidth"
  | "strokeAlign"
  | "strokeWidthPerSide"
> & { strokes?: Paint[] };

/**
 * Hot-path ordering: the `strokeAlign` check comes first so the default
 * (`center`) case returns the shared zero constant without touching the
 * paint stack (getRenderableStrokes allocates).
 */
export function resolveStrokeInsets(node: StrokeGeometrySource): SideInsets {
  if ((node.strokeAlign ?? "center") !== "inside") return ZERO_INSETS;

  const per = node.strokeWidthPerSide;
  const hasPerSide =
    per != null &&
    ((per.top ?? 0) > 0 ||
      (per.right ?? 0) > 0 ||
      (per.bottom ?? 0) > 0 ||
      (per.left ?? 0) > 0);
  const uniform = node.strokeWidth ?? 0;
  if (!hasPerSide && uniform <= 0) return ZERO_INSETS;

  if (getRenderableStrokes(node).length === 0) return ZERO_INSETS;

  if (hasPerSide && per) {
    return {
      top: per.top ?? 0,
      right: per.right ?? 0,
      bottom: per.bottom ?? 0,
      left: per.left ?? 0,
    };
  }
  return { top: uniform, right: uniform, bottom: uniform, left: uniform };
}
