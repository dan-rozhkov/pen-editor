import type { BaseNode, Paint } from "@/types/scene";
import { getRenderableStrokes } from "./fillUtils";
import { hasPerSideStroke } from "./renderUtils";

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

  // Per-side mode is a MODE switch, not a magnitude check: the renderer
  // (hasPerSideStroke in renderUtils.ts, shared with fillStrokeHelpers.ts)
  // takes the per-side branch whenever any side is explicitly set, even to
  // 0 — an all-zero override paints nothing, and layout must agree it
  // reserves nothing, rather than falling through to the uniform width.
  const per = node.strokeWidthPerSide;
  const hasPerSide = hasPerSideStroke(per);
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
 * Where a frame's content starts on each side: layout padding + its own
 * inside-stroke width (the CSS border-box analogue). This is the single
 * source of truth for "where do children actually land inside this frame" —
 * every consumer that needs that answer (the yoga layout engine, drag-drop
 * geometry, hover/spacing overlays) must route through this rather than
 * reading `layout.padding*` alone, or it drifts from the engine the moment a
 * frame has an inside stroke.
 */
export function resolveContentInsets(frame: LayoutSource): SideInsets {
  const strokeInsets = resolveStrokeInsets(frame);
  const l = frame.layout;
  return {
    top: (l?.paddingTop ?? 0) + strokeInsets.top,
    right: (l?.paddingRight ?? 0) + strokeInsets.right,
    bottom: (l?.paddingBottom ?? 0) + strokeInsets.bottom,
    left: (l?.paddingLeft ?? 0) + strokeInsets.left,
  };
}

/** Node types whose renderer honors `strokeAlign` at all (see per-node files
 * under `src/pixi/renderers/`). Layout must not reserve border-box space for
 * an inside stroke on a node type that never paints one — `text` and `line`
 * notably ignore strokeAlign entirely. */
const STROKE_AWARE_TYPES = new Set<BaseNode["type"]>([
  "rect",
  "ellipse",
  "polygon",
  "path",
  "frame",
]);

/**
 * Inside-stroke insets that actually affect this node's rendered size —
 * zero for node types whose renderer never honors `strokeAlign` (text,
 * line, ...), even if the node has stroke data set. Used by the yoga engine
 * (border-box fill_container distribution, main- and cross-axis) so it never
 * reserves layout space for an invisible border.
 */
export function nodeStrokeAffectsLayout(node: LayoutSource): SideInsets {
  if (!node.type || !STROKE_AWARE_TYPES.has(node.type)) return ZERO_INSETS;
  return resolveStrokeInsets(node);
}

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
