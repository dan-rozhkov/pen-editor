import { diff, intersection, union, xor, type Geometry, type Polygon, type Position } from "martinez-polygon-clipping";
import type { Point } from "./svgPathFlatten";

export type BooleanOpKind = "union" | "subtract" | "intersect" | "exclude" | "flatten";

function ringToPositions(ring: Point[]): Position[] {
  return ring.map((p): Position => [p.x, p.y]);
}

/** A single shape's rings (first = exterior, rest = holes) as a martinez Polygon. */
export function ringsToPolygon(rings: Point[][]): Polygon {
  return rings.map(ringToPositions);
}

/** Normalize a martinez result (which may come back as a bare Polygon) into a MultiPolygon. */
function toMultiPolygon(geometry: Geometry): Polygon[] {
  if (geometry.length === 0) return [];
  const first = geometry[0];
  // Polygon = Ring[], Ring = Position[] = [number, number][].
  // A bare Polygon's first element is a Ring (array of [number, number] pairs);
  // a MultiPolygon's first element is itself a Polygon (array of rings).
  const looksLikePolygon = Array.isArray(first[0]) && typeof (first[0] as unknown[])[0] === "number";
  return looksLikePolygon ? [geometry as Polygon] : (geometry as unknown as Polygon[]);
}

/**
 * Reduce an ordered (bottom-to-top z-order) list of shape polygons into one
 * boolean-combined MultiPolygon. `flatten` behaves like `union` — it merges
 * the shapes' outlines into a single flattened silhouette.
 */
export function combinePolygons(op: BooleanOpKind, orderedPolygons: Polygon[]): Polygon[] {
  if (orderedPolygons.length === 0) return [];
  if (orderedPolygons.length === 1) return [orderedPolygons[0]];

  let result: Geometry = orderedPolygons[0];
  for (let i = 1; i < orderedPolygons.length; i++) {
    const next = orderedPolygons[i];
    const combined: Geometry | null =
      op === "subtract"
        ? diff(result, next)
        : op === "intersect"
          ? intersection(result, next)
          : op === "exclude"
            ? xor(result, next)
            : union(result, next); // "union" and "flatten"
    if (!combined || combined.length === 0) {
      result = [];
      break;
    }
    result = combined;
  }

  return toMultiPolygon(result);
}
