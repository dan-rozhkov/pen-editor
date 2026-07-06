/**
 * Corner-smoothing ("squircle") path math, shared by the Pixi renderer
 * (`@/pixi/renderers/fillStrokeHelpers`) and the SVG exporter
 * (`@/lib/designToSvg/shapeStyles`). Both call `buildSquircleRectPath` and
 * translate the returned segment list into their own drawing API — this
 * module holds all the actual geometry so the two stay pixel-consistent.
 *
 * The math (per-corner `a`/`b`/`c`/`d`/`p`/`arcSectionLength` parameters and
 * the independent-per-corner-radius budget distribution) is ported from the
 * `figma-squircle` npm package (MIT, © 2021 Tien Pham,
 * https://github.com/phamfoo/figma-squircle), which itself credits the
 * derivation to Figma's "Desperately seeking squircles" blog post and
 * MartinRGB's original approximation. We port the formulas directly instead
 * of depending on the package at runtime because its public API
 * (`getSvgPath`) only returns an SVG path string — we need the intermediate
 * per-corner curve description (bezier control points + arc parameters) in a
 * shape/API-agnostic form so both a Pixi `Graphics` and an SVG path builder
 * can consume the exact same numbers.
 *
 * `cornerSmoothing` is a 0–1 fraction (matches figma-squircle's convention;
 * the UI displays it as 0–100%). At `cornerSmoothing <= 0` callers should NOT
 * use this module — the existing plain-arc code path is kept bit-identical
 * for that case (see call sites), so this module is only ever invoked for a
 * strictly-positive smoothing value.
 */

export interface PerCornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/** One rounded-rect corner, matching `PerCornerRadii` keys. */
export type CornerName = keyof PerCornerRadii;

/** A single path segment in absolute rect-local coordinates (origin at the rect's top-left, y down). */
export type PathSegment =
  | { type: "line"; x: number; y: number }
  | {
      type: "cubic";
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  | {
      type: "arc";
      cx: number;
      cy: number;
      radius: number;
      /** Radians, standard atan2 convention (0 = +x axis, y-down screen space). */
      startAngle: number;
      endAngle: number;
      /** Matches the `anticlockwise` param of Canvas2D/Pixi `Graphics.arc`. */
      anticlockwise: boolean;
    };

export interface SquircleRectPath {
  /** Starting point (top edge, `x + effectiveRadii.topLeft`, `y`). */
  start: { x: number; y: number };
  /** Ordered segments that trace the rect clockwise back to `start`. */
  segments: PathSegment[];
}

/** Per-corner curve parameters (ported from figma-squircle's `getPathParamsForCorner`). */
interface CornerPathParams {
  a: number;
  b: number;
  c: number;
  d: number;
  p: number;
  arcSectionLength: number;
  cornerRadius: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Ported from figma-squircle's `getPathParamsForCorner` (src/draw.ts). Computes
 * the bezier/arc parameters for one corner given its (already budget-clamped)
 * radius and the smoothing fraction. `preserveSmoothing` is intentionally not
 * exposed — we always clamp smoothing to fit the available budget (figma's
 * default behavior), matching the simpler, more predictable option described
 * in the feature brief.
 */
function getCornerPathParams(
  cornerRadius: number,
  cornerSmoothing: number,
  roundingAndSmoothingBudget: number,
): CornerPathParams {
  let p = (1 + cornerSmoothing) * cornerRadius;

  if (cornerRadius > 0) {
    const maxCornerSmoothing = roundingAndSmoothingBudget / cornerRadius - 1;
    cornerSmoothing = Math.min(cornerSmoothing, Math.max(0, maxCornerSmoothing));
    p = Math.min(p, roundingAndSmoothingBudget);
  } else {
    p = 0;
  }

  const arcMeasure = 90 * (1 - cornerSmoothing);
  const arcSectionLength =
    Math.sin(toRadians(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);

  const angleAlpha = (90 - arcMeasure) / 2;
  const p3ToP4Distance = cornerRadius * Math.tan(toRadians(angleAlpha / 2));

  const angleBeta = 45 * cornerSmoothing;
  const c = p3ToP4Distance * Math.cos(toRadians(angleBeta));
  const d = c * Math.tan(toRadians(angleBeta));

  const b = (p - arcSectionLength - c - d) / 3;
  const a = 2 * b;

  return { a, b, c, d, p, arcSectionLength, cornerRadius };
}

/**
 * Distribute/clamp per-corner radii against the rect's actual size, ported
 * from figma-squircle's `distributeAndNormalize` (src/distribute.ts). Bigger
 * corners are clamped first; each corner's "rounding and smoothing budget" is
 * the space available along its two adjacent edges after accounting for the
 * neighboring corner's own radius, so two large adjacent radii share the edge
 * proportionally instead of overlapping.
 */
function distributeAndNormalize(
  radii: PerCornerRadii,
  width: number,
  height: number,
): Record<CornerName, { radius: number; budget: number }> {
  const budgetByCorner: Record<CornerName, number> = {
    topLeft: -1,
    topRight: -1,
    bottomLeft: -1,
    bottomRight: -1,
  };
  const radiusByCorner: Record<CornerName, number> = { ...radii };

  const adjacents: Record<CornerName, Array<{ corner: CornerName; horizontal: boolean }>> = {
    topLeft: [
      { corner: "topRight", horizontal: true },
      { corner: "bottomLeft", horizontal: false },
    ],
    topRight: [
      { corner: "topLeft", horizontal: true },
      { corner: "bottomRight", horizontal: false },
    ],
    bottomLeft: [
      { corner: "bottomRight", horizontal: true },
      { corner: "topLeft", horizontal: false },
    ],
    bottomRight: [
      { corner: "bottomLeft", horizontal: true },
      { corner: "topRight", horizontal: false },
    ],
  };

  (Object.entries(radiusByCorner) as Array<[CornerName, number]>)
    .sort(([, r1], [, r2]) => r2 - r1)
    .forEach(([corner, radius]) => {
      const budget = Math.min(
        ...adjacents[corner].map(({ corner: adjacentCorner, horizontal }) => {
          const adjacentRadius = radiusByCorner[adjacentCorner];
          if (radius === 0 && adjacentRadius === 0) return 0;

          const sideLength = horizontal ? width : height;
          const adjacentBudget = budgetByCorner[adjacentCorner];

          if (adjacentBudget >= 0) {
            return sideLength - adjacentBudget;
          }
          return (radius / (radius + adjacentRadius)) * sideLength;
        }),
      );

      budgetByCorner[corner] = budget;
      radiusByCorner[corner] = Math.min(radius, budget);
    });

  return {
    topLeft: { radius: radiusByCorner.topLeft, budget: budgetByCorner.topLeft },
    topRight: { radius: radiusByCorner.topRight, budget: budgetByCorner.topRight },
    bottomRight: { radius: radiusByCorner.bottomRight, budget: budgetByCorner.bottomRight },
    bottomLeft: { radius: radiusByCorner.bottomLeft, budget: budgetByCorner.bottomLeft },
  };
}

/** Axis-aligned unit vector, either (±1, 0) or (0, ±1). */
interface Vec2 {
  x: number;
  y: number;
}

/**
 * Build the two bezier segments + one circular arc for a single corner, given
 * its sharp-corner point `origin`, the two perpendicular unit vectors
 * pointing from `origin` toward the entry point (where the flat edge the path
 * arrives FROM ends) and the exit point (where the next flat edge begins),
 * and the corner's curve params. This single function is geometrically valid
 * for any of the 4 rect corners (only `origin`/`entryDir`/`exitDir` differ) —
 * see module doc for the derivation.
 */
function buildCornerSegments(
  origin: Vec2,
  entryDir: Vec2,
  exitDir: Vec2,
  params: CornerPathParams,
): PathSegment[] {
  const { a, b, c, d, arcSectionLength, cornerRadius, p } = params;

  if (cornerRadius <= 0 || p <= 0) {
    // Degenerate corner: no curve, just meet at the sharp point.
    return [{ type: "line", x: origin.x, y: origin.y }];
  }

  const entry = { x: origin.x + p * entryDir.x, y: origin.y + p * entryDir.y };

  const cp1 = { x: entry.x - a * entryDir.x, y: entry.y - a * entryDir.y };
  const cp2 = { x: entry.x - (a + b) * entryDir.x, y: entry.y - (a + b) * entryDir.y };
  const arcStart = {
    x: entry.x - (a + b + c) * entryDir.x + d * exitDir.x,
    y: entry.y - (a + b + c) * entryDir.y + d * exitDir.y,
  };

  const arcEnd = {
    x: arcStart.x - arcSectionLength * entryDir.x + arcSectionLength * exitDir.x,
    y: arcStart.y - arcSectionLength * entryDir.y + arcSectionLength * exitDir.y,
  };

  const cp3 = { x: arcEnd.x - d * entryDir.x + c * exitDir.x, y: arcEnd.y - d * entryDir.y + c * exitDir.y };
  const cp4 = {
    x: arcEnd.x - d * entryDir.x + (b + c) * exitDir.x,
    y: arcEnd.y - d * entryDir.y + (b + c) * exitDir.y,
  };
  const exit = {
    x: arcEnd.x - d * entryDir.x + (a + b + c) * exitDir.x,
    y: arcEnd.y - d * entryDir.y + (a + b + c) * exitDir.y,
  };

  const center = {
    x: origin.x + cornerRadius * (entryDir.x + exitDir.x),
    y: origin.y + cornerRadius * (entryDir.y + exitDir.y),
  };

  const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
  const endAngle = Math.atan2(arcEnd.y - center.y, arcEnd.x - center.x);
  // Pick whichever rotation direction is the minor (<=90 deg) arc, so callers
  // never need to reason about winding direction themselves.
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const anticlockwise = delta < 0;

  return [
    { type: "cubic", cp1x: cp1.x, cp1y: cp1.y, cp2x: cp2.x, cp2y: cp2.y, x: arcStart.x, y: arcStart.y },
    {
      type: "arc",
      cx: center.x,
      cy: center.y,
      radius: cornerRadius,
      startAngle,
      endAngle,
      anticlockwise,
    },
    { type: "cubic", cp1x: cp3.x, cp1y: cp3.y, cp2x: cp4.x, cp2y: cp4.y, x: exit.x, y: exit.y },
  ];
}

/**
 * Build a closed rounded-rect path with squircle corners, clockwise starting
 * at the top edge just right of the top-left corner (matching the existing
 * `drawPerCornerRoundRect`/`roundedRectPath` traversal order). Only meant to
 * be called when `cornerSmoothing > 0` — callers keep the plain-arc code path
 * for `cornerSmoothing <= 0` so that behavior stays bit-identical to before
 * this feature existed.
 */
export function buildSquircleRectPath(
  width: number,
  height: number,
  radii: PerCornerRadii,
  cornerSmoothing: number,
): SquircleRectPath {
  const clamped: PerCornerRadii = {
    topLeft: Math.max(0, Math.min(radii.topLeft, width / 2, height / 2)),
    topRight: Math.max(0, Math.min(radii.topRight, width / 2, height / 2)),
    bottomRight: Math.max(0, Math.min(radii.bottomRight, width / 2, height / 2)),
    bottomLeft: Math.max(0, Math.min(radii.bottomLeft, width / 2, height / 2)),
  };
  const smoothing = Math.max(0, Math.min(1, cornerSmoothing));

  const normalized = distributeAndNormalize(clamped, width, height);

  const params: Record<CornerName, CornerPathParams> = {
    topLeft: getCornerPathParams(normalized.topLeft.radius, smoothing, normalized.topLeft.budget),
    topRight: getCornerPathParams(normalized.topRight.radius, smoothing, normalized.topRight.budget),
    bottomRight: getCornerPathParams(normalized.bottomRight.radius, smoothing, normalized.bottomRight.budget),
    bottomLeft: getCornerPathParams(normalized.bottomLeft.radius, smoothing, normalized.bottomLeft.budget),
  };

  const start = { x: params.topLeft.p, y: 0 };

  const segments: PathSegment[] = [];

  // Top edge -> top-right corner
  segments.push({ type: "line", x: width - params.topRight.p, y: 0 });
  segments.push(
    ...buildCornerSegments(
      { x: width, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      params.topRight,
    ),
  );

  // Right edge -> bottom-right corner
  segments.push({ type: "line", x: width, y: height - params.bottomRight.p });
  segments.push(
    ...buildCornerSegments(
      { x: width, y: height },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      params.bottomRight,
    ),
  );

  // Bottom edge -> bottom-left corner
  segments.push({ type: "line", x: params.bottomLeft.p, y: height });
  segments.push(
    ...buildCornerSegments(
      { x: 0, y: height },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      params.bottomLeft,
    ),
  );

  // Left edge -> top-left corner (closes back to `start`)
  segments.push({ type: "line", x: 0, y: params.topLeft.p });
  segments.push(
    ...buildCornerSegments(
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      params.topLeft,
    ),
  );

  return { start, segments };
}
