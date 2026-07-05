import type { PerCornerRadius } from "@/types/scene";
import { flattenSvgPath, type Point } from "./svgPathFlatten";

const ELLIPSE_SEGMENTS = 64;
const CORNER_SEGMENTS = 12;

function closeRing(points: Point[]): Point[] {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    return [...points, first];
  }
  return points;
}

/** Flatten a rectangle (optionally rounded) into a single closed polygon ring, local to (0,0)..(width,height). */
export function rectToRing(
  width: number,
  height: number,
  cornerRadius?: number,
  cornerRadiusPerCorner?: PerCornerRadius,
): Point[] {
  const maxR = Math.min(width, height) / 2;
  const tl = Math.max(0, Math.min(cornerRadiusPerCorner?.topLeft ?? cornerRadius ?? 0, maxR));
  const tr = Math.max(0, Math.min(cornerRadiusPerCorner?.topRight ?? cornerRadius ?? 0, maxR));
  const br = Math.max(0, Math.min(cornerRadiusPerCorner?.bottomRight ?? cornerRadius ?? 0, maxR));
  const bl = Math.max(0, Math.min(cornerRadiusPerCorner?.bottomLeft ?? cornerRadius ?? 0, maxR));

  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    return closeRing([
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ]);
  }

  function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Point[] {
    const points: Point[] = [];
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const t = startDeg + ((endDeg - startDeg) * i) / CORNER_SEGMENTS;
      const rad = (t * Math.PI) / 180;
      points.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
    }
    return points;
  }

  const points: Point[] = [
    { x: tl, y: 0 },
    { x: width - tr, y: 0 },
    ...(tr > 0 ? arcPoints(width - tr, tr, tr, -90, 0) : []),
    { x: width, y: height - br },
    ...(br > 0 ? arcPoints(width - br, height - br, br, 0, 90) : []),
    { x: bl, y: height },
    ...(bl > 0 ? arcPoints(bl, height - bl, bl, 90, 180) : []),
    { x: 0, y: tl },
    ...(tl > 0 ? arcPoints(tl, tl, tl, 180, 270) : []),
  ];
  return closeRing(points);
}

/** Flatten an ellipse inscribed in (0,0)..(width,height) into a closed polygon ring. */
export function ellipseToRing(width: number, height: number): Point[] {
  const rx = width / 2;
  const ry = height / 2;
  const points: Point[] = [];
  for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
    const angle = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
    points.push({ x: rx + rx * Math.cos(angle), y: ry + ry * Math.sin(angle) });
  }
  return closeRing(points);
}

/** Convert a flat [x1,y1,x2,y2,...] point list (polygon node) into a closed ring. */
export function pointsToRing(points: number[]): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    ring.push({ x: points[i], y: points[i + 1] });
  }
  return closeRing(ring);
}

/**
 * Flatten a path node's SVG geometry into polygon rings, applying the same
 * geometryBounds scale/offset the renderer uses (see `pathRenderer.ts`
 * `drawPath`) so the rings land in the node's own width/height box.
 */
export function pathGeometryToRings(
  geometry: string,
  width: number,
  height: number,
  geometryBounds?: { x: number; y: number; width: number; height: number },
): Point[][] {
  const rawSubpaths = flattenSvgPath(geometry);
  const scaleX = geometryBounds && geometryBounds.width !== 0 ? width / geometryBounds.width : 1;
  const scaleY = geometryBounds && geometryBounds.height !== 0 ? height / geometryBounds.height : 1;
  const offsetX = geometryBounds ? -geometryBounds.x * scaleX : 0;
  const offsetY = geometryBounds ? -geometryBounds.y * scaleY : 0;

  return rawSubpaths
    .map((ring) =>
      closeRing(ring.map((p) => ({ x: p.x * scaleX + offsetX, y: p.y * scaleY + offsetY }))),
    )
    .filter((ring) => ring.length >= 4);
}
