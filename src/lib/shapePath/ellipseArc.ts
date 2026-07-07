/**
 * Ellipse arc/donut ("pie"/"donut") path math, shared by the Pixi renderer
 * (`@/pixi/renderers/ellipseRenderer`) and the SVG exporter
 * (`@/lib/designToSvg/convertNode`). Both consume `buildEllipseArcGeometry`
 * and translate the returned contour list into their own drawing API, so the
 * two stay pixel-consistent (mirrors the `squircleCorner.ts` split).
 *
 * The arc is approximated as a polyline (no true elliptical-arc primitive is
 * needed on either consumer): Pixi's `Graphics` has no native ellipse-arc
 * command, and sampling keeps the exact same numbers usable for both an SVG
 * `M/L/Z` path and a `moveTo`/`lineTo`/`closePath` sequence.
 *
 * A donut with `sweepAngle` covering a full 360° turn cannot be expressed as
 * a single non-self-intersecting contour — it is returned as two separate
 * closed contours (outer ring wound forward, inner ring wound in reverse) so
 * a nonzero-winding fill (Pixi's and SVG's shared default) renders the hole.
 * A partial-sweep donut ("thick arc") is a single contour (outer forward +
 * inner reversed, joined) since it's already a simple polygon.
 */

export interface EllipseArcParams {
  /** Degrees, 0 = rightmost point, increasing clockwise (screen space). Default 0. */
  startAngle?: number;
  /** Degrees, clamped to [-360, 360]. Default 360 (full ellipse). */
  sweepAngle?: number;
  /** 0..1 ratio of the outer radius. Default 0 (no hole). */
  innerRadiusRatio?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One closed polyline contour (renderer/exporter implicitly closes it). */
export interface EllipseArcContour {
  points: Point[];
}

export interface EllipseArcGeometry {
  contours: EllipseArcContour[];
  /** True when this is a plain, unmodified full ellipse (no arc/donut needed) — callers may prefer a native ellipse primitive in that case. */
  isPlainEllipse: boolean;
}

const SEGMENTS_PER_FULL_TURN = 128;
const MIN_SEGMENTS = 3;

/** True when any arc/donut param deviates from "plain full ellipse" defaults. */
export function hasCustomEllipseArc(params: EllipseArcParams): boolean {
  const start = params.startAngle ?? 0;
  const sweep = params.sweepAngle ?? 360;
  const ratio = params.innerRadiusRatio ?? 0;
  return start !== 0 || Math.abs(sweep) < 360 || (ratio > 0 && ratio < 1);
}

export function buildEllipseArcGeometry(
  width: number,
  height: number,
  params: EllipseArcParams,
): EllipseArcGeometry {
  const rx = width / 2;
  const ry = height / 2;
  const cx = rx;
  const cy = ry;

  const startDeg = params.startAngle ?? 0;
  const sweepDeg = Math.max(-360, Math.min(360, params.sweepAngle ?? 360));
  const ratio = Math.max(0, Math.min(0.99, params.innerRadiusRatio ?? 0));
  const isFullSweep = Math.abs(sweepDeg) >= 360;

  if (isFullSweep && ratio <= 0 && startDeg === 0) {
    // Plain full ellipse, no arc/donut needed.
    return { contours: [], isPlainEllipse: true };
  }

  const segCount = Math.max(
    MIN_SEGMENTS,
    Math.round((Math.abs(sweepDeg) / 360) * SEGMENTS_PER_FULL_TURN),
  );
  const startRad = (startDeg * Math.PI) / 180;
  const sweepRad = (sweepDeg * Math.PI) / 180;

  const sampleRing = (radiusRatio: number, reverse: boolean): Point[] => {
    const count = isFullSweep ? segCount : segCount + 1;
    const pts: Point[] = [];
    for (let i = 0; i < count; i++) {
      const t = startRad + (sweepRad * i) / segCount;
      pts.push({
        x: cx + rx * radiusRatio * Math.cos(t),
        y: cy + ry * radiusRatio * Math.sin(t),
      });
    }
    return reverse ? pts.reverse() : pts;
  };

  const outer = sampleRing(1, false);

  if (ratio <= 0) {
    // Pie slice (partial sweep) or plain arc outline (full sweep).
    const contourPoints = isFullSweep ? outer : [{ x: cx, y: cy }, ...outer];
    return { contours: [{ points: contourPoints }], isPlainEllipse: false };
  }

  const inner = sampleRing(ratio, true);

  if (isFullSweep) {
    // Donut: two separate closed contours, opposite winding creates the hole.
    return {
      contours: [{ points: outer }, { points: inner }],
      isPlainEllipse: false,
    };
  }

  // Partial-sweep "thick arc" ring segment: single simple polygon.
  return { contours: [{ points: [...outer, ...inner] }], isPlainEllipse: false };
}

/** Render an `EllipseArcGeometry` as an SVG path `d` string (one `M/L…Z` subpath per contour). */
export function ellipseArcGeometryToSvgPath(geometry: EllipseArcGeometry): string {
  return geometry.contours
    .map((contour) => {
      const [first, ...rest] = contour.points;
      if (!first) return "";
      const lines = rest.map((p) => `L${p.x},${p.y}`).join(" ");
      return `M${first.x},${first.y} ${lines} Z`;
    })
    .join(" ");
}
