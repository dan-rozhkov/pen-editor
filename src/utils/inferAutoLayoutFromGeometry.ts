// Turning on auto-layout for a frame that already has manually-positioned
// children must be appearance-preserving (this is what Figma does): the
// direction, gap, padding, alignment and child ORDER are all derived from
// the current geometry rather than reset to hardcoded defaults. Before this
// module existed, enabling auto-layout on an existing frame silently
// collapsed the layout to `row` + `gap: 0` + zero padding + tree/z-order,
// which is almost never what the geometry actually looked like.
//
// Pure — no store imports — so it can be unit-tested directly and reused by
// both `enableAutoLayoutOnFrame` (sceneStore) and `wrapInAutoLayoutFrame`
// (complexOperations.ts) without either depending on the other.
import type {
  AlignItems,
  FlexDirection,
  JustifyContent,
  LayoutProperties,
} from "@/types/scene";
import { resolveStrokeInsets, type StrokeGeometrySource } from "@/utils/strokeInsets";

/** A child's rect in the SAME coordinate space as `frame` (frame origin = 0,0). */
export interface InferChildRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The frame's stroke fields are optional here: callers that don't have a real
 * frame node yet (`wrapInAutoLayoutFrame`, which creates a strokeless frame)
 * can pass a bare `{ width, height }` and get zero insets back from
 * `resolveStrokeInsets` — the same "no strokeAlign" default it already uses.
 */
export interface InferAutoLayoutInput {
  frame: { width: number; height: number } & Partial<StrokeGeometrySource>;
  children: InferChildRect[];
}

export type InferredLayout = Pick<
  LayoutProperties,
  | "flexDirection"
  | "gap"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "alignItems"
  | "justifyContent"
>;

export interface InferAutoLayoutResult {
  layout: InferredLayout;
  /** Visual order of children along the inferred main axis. */
  orderedIds: string[];
}

// Sub-pixel geometry noise (float rounding, historical drag jitter, etc.)
// shouldn't flip a decision that's otherwise unambiguous — every "are these
// equal" comparison in this module uses this tolerance rather than exact
// equality.
const TOLERANCE_PX = 1;

function approxEqual(a: number, b: number, tolerance = TOLERANCE_PX): boolean {
  return Math.abs(a - b) <= tolerance;
}

function clampRound(n: number): number {
  return Math.round(Math.max(0, n));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Do the two [start, start+size] intervals actually intersect (not just touch)? */
function intervalsOverlap(
  aStart: number,
  aSize: number,
  bStart: number,
  bSize: number,
): boolean {
  const overlap = Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart);
  return overlap > TOLERANCE_PX;
}

/**
 * Direction is inferred from how children's projections overlap: children
 * stacked in a column don't overlap on Y but do overlap on X (they share a
 * horizontal band); a row is the mirror image. When neither overlap pattern
 * is clean (e.g. a grid, or a single child where "overlap" is undefined),
 * fall back to whichever axis has the smaller spread of start coordinates —
 * a tight column of start-x values reads as "these are stacked vertically".
 */
function inferDirection(children: InferChildRect[]): FlexDirection {
  if (children.length < 2) return "column";

  let anyYOverlap = false;
  let anyXOverlap = false;
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i];
      const b = children[j];
      if (intervalsOverlap(a.y, a.height, b.y, b.height)) anyYOverlap = true;
      if (intervalsOverlap(a.x, a.width, b.x, b.width)) anyXOverlap = true;
    }
  }

  if (!anyYOverlap && anyXOverlap) return "column";
  if (!anyXOverlap && anyYOverlap) return "row";

  // Ambiguous (both or neither pattern present) — fall back to spread.
  const xs = children.map((c) => c.x);
  const ys = children.map((c) => c.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  return spreadX <= spreadY ? "column" : "row";
}

/** Sort children along the main axis (ties broken by cross axis, then original index). */
function orderChildren(
  children: InferChildRect[],
  direction: FlexDirection,
): InferChildRect[] {
  const mainKey = direction === "column" ? "y" : "x";
  const crossKey = direction === "column" ? "x" : "y";
  return children
    .map((child, index) => ({ child, index }))
    .sort((a, b) => {
      const mainDiff = a.child[mainKey] - b.child[mainKey];
      if (mainDiff !== 0) return mainDiff;
      const crossDiff = a.child[crossKey] - b.child[crossKey];
      if (crossDiff !== 0) return crossDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.child);
}

/** Gap between consecutive (already main-axis-sorted) children. */
function inferGap(ordered: InferChildRect[], direction: FlexDirection): number {
  if (ordered.length < 2) return 0;
  const sizeKey = direction === "column" ? "height" : "width";
  const startKey = direction === "column" ? "y" : "x";

  const gaps: number[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const prev = ordered[i];
    const next = ordered[i + 1];
    const rawGap = next[startKey] - (prev[startKey] + prev[sizeKey]);
    gaps.push(Math.max(0, rawGap));
  }

  const allEqual = gaps.every((g) => approxEqual(g, gaps[0]));
  return clampRound(allEqual ? gaps[0] : median(gaps));
}

function inferPadding(
  frame: InferAutoLayoutInput["frame"],
  children: InferChildRect[],
): Pick<InferredLayout, "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft"> {
  if (children.length === 0) {
    return { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 };
  }
  const minX = Math.min(...children.map((c) => c.x));
  const minY = Math.min(...children.map((c) => c.y));
  const maxX = Math.max(...children.map((c) => c.x + c.width));
  const maxY = Math.max(...children.map((c) => c.y + c.height));

  // The yoga engine folds a visible inside-stroke into padding on top of
  // whatever's stored (`buildContainer` in yogaLayout.ts), so the child
  // offset we're inferring padding FROM already includes that stroke width.
  // Subtract it back out here or `enableAutoLayoutOnFrame` would double it,
  // shifting every child outward by the stroke width the moment auto-layout
  // turns on.
  const insets = resolveStrokeInsets(frame);

  return {
    paddingTop: clampRound(clampRound(minY) - insets.top),
    paddingLeft: clampRound(clampRound(minX) - insets.left),
    paddingBottom: clampRound(clampRound(frame.height - maxY) - insets.bottom),
    paddingRight: clampRound(clampRound(frame.width - maxX) - insets.right),
  };
}

/**
 * Cross-axis alignment, judged against the children's own bounding box (not
 * the frame) — "content area" per the task spec — since padding already
 * absorbs any offset between that bbox and the frame edges.
 */
function inferAlignItems(
  children: InferChildRect[],
  direction: FlexDirection,
): AlignItems {
  if (children.length < 2) return "flex-start";

  const startKey = direction === "column" ? "x" : "y";
  const sizeKey = direction === "column" ? "width" : "height";

  const starts = children.map((c) => c[startKey]);
  const ends = children.map((c) => c[startKey] + c[sizeKey]);
  const centers = children.map((c) => c[startKey] + c[sizeKey] / 2);

  const contentMin = Math.min(...starts);
  const contentMax = Math.max(...ends);

  const allStartAtContentMin = starts.every((s) => approxEqual(s, contentMin));
  const allEndAtContentMax = ends.every((e) => approxEqual(e, contentMax));
  if (allStartAtContentMin && allEndAtContentMax) return "stretch";

  const allCentersEqual = centers.every((c) => approxEqual(c, centers[0]));
  if (allCentersEqual) return "center";

  if (allStartAtContentMin) return "flex-start";

  const allEndsEqual = ends.every((e) => approxEqual(e, ends[0]));
  if (allEndsEqual) return "flex-end";

  return "flex-start";
}

// `space-between` and an explicit `gap` conflict in flex layout — the two
// can't be reconciled without either dropping the gap or making it
// approximate. Always emitting `flex-start` + an explicit `gap` reproduces
// the captured geometry exactly (bar the edge case where the design was
// deliberately laid out to fill the container responsively, which auto-layout
// can't detect from a single static snapshot anyway) and matches what Figma
// itself does when you turn on auto-layout. So: no `space-between` inference,
// ever, by design — do not add that branch back.
const JUSTIFY_CONTENT: JustifyContent = "flex-start";

export function inferAutoLayoutFromGeometry(
  input: InferAutoLayoutInput,
): InferAutoLayoutResult {
  const { frame, children } = input;

  const direction = inferDirection(children);
  const ordered = orderChildren(children, direction);
  const gap = inferGap(ordered, direction);
  const padding = inferPadding(frame, children);
  const alignItems = inferAlignItems(children, direction);

  return {
    layout: {
      flexDirection: direction,
      gap,
      ...padding,
      alignItems,
      justifyContent: JUSTIFY_CONTENT,
    },
    orderedIds: ordered.map((c) => c.id),
  };
}
