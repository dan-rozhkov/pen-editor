import type { PathAnchor } from "./pathAnchors";
import { cubicDerivative, cubicValue } from "./pathAnchors";

/**
 * Pure arc-length arithmetic over `PathAnchor[]` (the same anchor model used
 * by the pen tool / path point-edit mode — see `pathAnchors.ts`). Nothing in
 * this codebase computes arc length before this module: no `getTotalLength`,
 * `getPointAtLength`, tangent, or flatten helper existed. The API deliberately
 * mirrors SVG's `SVGPathElement.getTotalLength()` / `.getPointAtLength()`
 * naming, but is built entirely from the `cubicValue`/`cubicDerivative`
 * primitives in `pathAnchors.ts` rather than the DOM — `SVGPathElement` isn't
 * implemented in happy-dom, so a DOM-backed version would be untestable in
 * this project's unit-test environment (see `pathAnchors.ts`'s own doc
 * comment for the same constraint).
 *
 * Implementation: each segment (straight or cubic) is sampled at a fixed
 * resolution into a length lookup table (LUT); `getPointAtLength` binary-
 * searches the cumulative-length LUT for the enclosing sample, then
 * re-evaluates the *exact* cubic at the interpolated `t` (not just the
 * nearest sample) via `cubicValue`/`cubicDerivative`. This keeps the
 * returned point/tangent exact while only needing the LUT for the
 * length->t mapping (which has no closed form for a cubic).
 *
 * `preparePath(points, closed)` builds the segment LUT exactly once and
 * returns a small object callers hold onto and query repeatedly
 * (`getTotalLength`/`getPointAtLength`/`getClosestPoint`) — the
 * `getTotalLength`/`getPointAtLength`/`getClosestPointOnPath` module
 * functions below are thin convenience wrappers around a fresh
 * `preparePath()` call for one-shot callers, but a hot loop (per-glyph
 * layout, or a drag handler firing `getClosestPointOnPath` ~250 times per
 * pointermove) MUST call `preparePath` once and reuse the returned object,
 * or it silently re-samples the whole contour (64 cubic evals x2 axes per
 * segment) on every single point/probe query.
 */

/** Samples per segment for the length LUT. Enough for sub-pixel accuracy on typical canvas-scale paths. */
const SAMPLES_PER_SEGMENT = 64;

export interface PointOnPath {
  x: number;
  y: number;
  /** Tangent angle in radians (`Math.atan2` convention: 0 = pointing along +x). */
  angle: number;
}

interface Segment {
  /** Endpoints + control points in "de Casteljau" form: p0..p3. For a straight
   * segment (no handles) these degenerate to the endpoints (cubicValue with
   * colinear controls is exact for a line). */
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  /** Cumulative length of all *previous* segments (start of this segment's length range). */
  startLength: number;
  /** This segment's own length. */
  length: number;
  /** LUT of {t, cumLenWithinSegment} sample pairs, t in [0,1], strictly increasing cumLen. */
  samples: { t: number; len: number }[];
}

function buildSegment(a: PathAnchor, b: PathAnchor, startLength: number): Segment {
  const p0x = a.x, p0y = a.y;
  const p3x = b.x, p3y = b.y;
  const p1x = a.handleOut?.x ?? p0x;
  const p1y = a.handleOut?.y ?? p0y;
  const p2x = b.handleIn?.x ?? p3x;
  const p2y = b.handleIn?.y ?? p3y;

  const samples: { t: number; len: number }[] = [{ t: 0, len: 0 }];
  let prevX = p0x, prevY = p0y;
  let acc = 0;
  for (let i = 1; i <= SAMPLES_PER_SEGMENT; i++) {
    const t = i / SAMPLES_PER_SEGMENT;
    const x = cubicValue(p0x, p1x, p2x, p3x, t);
    const y = cubicValue(p0y, p1y, p2y, p3y, t);
    acc += Math.hypot(x - prevX, y - prevY);
    samples.push({ t, len: acc });
    prevX = x;
    prevY = y;
  }

  return {
    p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y,
    startLength,
    length: acc,
    samples,
  };
}

function buildSegments(points: PathAnchor[], closed: boolean): Segment[] {
  if (points.length < 2) return [];
  const segCount = closed ? points.length : points.length - 1;
  const segments: Segment[] = [];
  let cumLen = 0;
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const seg = buildSegment(a, b, cumLen);
    segments.push(seg);
    cumLen += seg.length;
  }
  return segments;
}

/** Binary search a segment's length LUT for the sample bracketing `localLen`, returning an interpolated `t`. */
function tAtLocalLength(seg: Segment, localLen: number): number {
  const samples = seg.samples;
  if (localLen <= 0) return 0;
  if (localLen >= seg.length) return 1;

  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].len <= localLen) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = b.len - a.len;
  const frac = span > 1e-9 ? (localLen - a.len) / span : 0;
  return a.t + (b.t - a.t) * frac;
}

function pointOnSegment(seg: Segment, t: number): PointOnPath {
  const x = cubicValue(seg.p0x, seg.p1x, seg.p2x, seg.p3x, t);
  const y = cubicValue(seg.p0y, seg.p1y, seg.p2y, seg.p3y, t);
  const dx = cubicDerivative(seg.p0x, seg.p1x, seg.p2x, seg.p3x, t);
  const dy = cubicDerivative(seg.p0y, seg.p1y, seg.p2y, seg.p3y, t);
  // A zero-length segment (or a sampled t with a locally-zero derivative, e.g.
  // a cusp) has no defined tangent from the derivative alone — fall back to
  // the endpoint-to-endpoint direction rather than atan2(0, 0) (which is 0
  // and would silently draw the glyph unrotated).
  const angle = Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9
    ? Math.atan2(dy, dx)
    : Math.atan2(seg.p3y - seg.p0y, seg.p3x - seg.p0x);
  return { x, y, angle };
}

export interface ClosestPointResult extends PointOnPath {
  /** Arc-length at which the closest point occurs. */
  length: number;
  /** Euclidean distance from the query point to the closest point on the path. */
  distance: number;
}

/**
 * A contour's segment LUT, built once, plus the query methods that reuse it.
 * Callers that need more than one point/probe against the same `points`
 * (per-glyph text-on-path layout, the start-offset drag handle's per-
 * pointermove hit-test) must call `preparePath` once and hold the result —
 * see this module's doc comment.
 */
export interface PreparedPath {
  /** Total arc length of the contour. */
  readonly totalLength: number;
  /**
   * Point (and tangent angle) at arc-length `len` along the contour. Clamps
   * `len` to `[0, totalLength]` — matches SVG `getPointAtLength` semantics,
   * which likewise clamps rather than throwing. A path with fewer than 2
   * anchors has no defined tangent; returns the single point (or the origin
   * for an empty path) with `angle: 0`.
   */
  getPointAtLength(len: number): PointOnPath;
  /**
   * Nearest point on the contour to an arbitrary (x, y), by arc length.
   * Coarse sample over the whole contour followed by a local golden-section
   * refinement between the two bracketing samples, so accuracy doesn't
   * depend on bumping the coarse sample count arbitrarily high.
   */
  getClosestPoint(x: number, y: number, coarseSamples?: number): ClosestPointResult | null;
}

/**
 * Build the segment LUT for `points`/`closed` exactly once and return a
 * handle for repeated point/tangent/closest-point queries against it. See
 * this module's doc comment for why callers in a loop or a per-pointermove
 * handler must use this instead of the one-shot `getPointAtLength`/
 * `getClosestPointOnPath` convenience functions below.
 */
export function preparePath(points: PathAnchor[], closed: boolean): PreparedPath {
  const segments = buildSegments(points, closed);
  const totalLength =
    segments.length > 0 ? segments[segments.length - 1].startLength + segments[segments.length - 1].length : 0;

  function getPointAtLength(len: number): PointOnPath {
    if (points.length === 0) return { x: 0, y: 0, angle: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angle: 0 };

    const clamped = Math.max(0, Math.min(totalLength, len));

    // Binary search segments by startLength for the one containing `clamped`.
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].startLength <= clamped) lo = mid;
      else hi = mid - 1;
    }
    const seg = segments[lo];
    const localLen = clamped - seg.startLength;
    const t = tAtLocalLength(seg, localLen);
    return pointOnSegment(seg, t);
  }

  function getClosestPoint(x: number, y: number, coarseSamples = 200): ClosestPointResult | null {
    if (points.length === 0) return null;
    if (points.length === 1 || totalLength === 0) {
      const only = getPointAtLength(0);
      return { ...only, length: 0, distance: Math.hypot(x - only.x, y - only.y) };
    }

    const distAt = (len: number): number => {
      const p = getPointAtLength(len);
      return Math.hypot(x - p.x, y - p.y);
    };

    let bestLen = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= coarseSamples; i++) {
      const len = (i / coarseSamples) * totalLength;
      const d = distAt(len);
      if (d < bestDist) {
        bestDist = d;
        bestLen = len;
      }
    }

    // Golden-section search within one coarse-sample span around the best
    // hit for sub-sample precision.
    const span = totalLength / coarseSamples;
    let lo = Math.max(0, bestLen - span);
    let hi = Math.min(totalLength, bestLen + span);
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 24 && hi - lo > 1e-4; i++) {
      const c = hi - gr * (hi - lo);
      const d = hi - (hi - lo) * (1 - gr);
      if (distAt(c) < distAt(d)) hi = d;
      else lo = c;
    }
    bestLen = (lo + hi) / 2;

    const point = getPointAtLength(bestLen);
    return { ...point, length: bestLen, distance: Math.hypot(x - point.x, y - point.y) };
  }

  return { totalLength, getPointAtLength, getClosestPoint };
}

/** Total arc length of the contour described by `points` (see `pathAnchors.ts` for the anchor model). One-shot convenience wrapper — see this module's doc comment for hot-loop callers. */
export function getTotalLength(points: PathAnchor[], closed: boolean): number {
  return preparePath(points, closed).totalLength;
}

/** One-shot convenience wrapper around `preparePath(...).getPointAtLength(...)` — see this module's doc comment for hot-loop callers. */
export function getPointAtLength(points: PathAnchor[], closed: boolean, len: number): PointOnPath {
  return preparePath(points, closed).getPointAtLength(len);
}

/** One-shot convenience wrapper around `preparePath(...).getClosestPoint(...)` — see this module's doc comment for hot-loop callers (e.g. a pointermove handler probing the same contour repeatedly). */
export function getClosestPointOnPath(
  points: PathAnchor[],
  closed: boolean,
  x: number,
  y: number,
  coarseSamples = 200,
): ClosestPointResult | null {
  return preparePath(points, closed).getClosestPoint(x, y, coarseSamples);
}
