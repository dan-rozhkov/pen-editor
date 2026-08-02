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

export type StrokeGeometrySource = Pick<
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

type LayoutSource = StrokeGeometrySource & {
  type?: BaseNode["type"];
  layout?: {
    autoLayout?: boolean;
    paddingTop?: number;
    paddingRight?: number;
    paddingBottom?: number;
    paddingLeft?: number;
  };
};

/**
 * The border-box floor of an auto-layout frame: padding + inside stroke per
 * axis. Interactive resize must not drag a frame below this (Figma updated
 * auto layout: "padding always gets the room it needs"). Zero for anything
 * that is not an auto-layout frame.
 */
export function autoLayoutMinSize(node: LayoutSource): {
  minWidth: number;
  minHeight: number;
} {
  if (node.type !== "frame" || !node.layout?.autoLayout) {
    return { minWidth: 0, minHeight: 0 };
  }
  const insets = resolveStrokeInsets(node);
  const l = node.layout;
  return {
    minWidth: (l.paddingLeft ?? 0) + (l.paddingRight ?? 0) + insets.left + insets.right,
    minHeight: (l.paddingTop ?? 0) + (l.paddingBottom ?? 0) + insets.top + insets.bottom,
  };
}
