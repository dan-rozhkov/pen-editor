interface Point {
  x: number;
  y: number;
}

/**
 * Ramer-Douglas-Peucker line simplification.
 * Removes points within `epsilon` tolerance of the line between remaining points.
 */
export function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  const num = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return num / Math.sqrt(lengthSq);
}

/**
 * Chaikin's corner-cutting subdivision.
 * Each iteration replaces sharp corners with smoother curves by inserting
 * points at 25%/75% along each segment. Preserves start and end points.
 */
function chaikinSmooth(points: Point[], iterations: number): Point[] {
  if (points.length <= 2 || iterations <= 0) return points;

  let current = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      next.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      });
      next.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Convert raw freehand points to a smooth SVG path.
 * Pipeline: RDP simplification → Chaikin subdivision → Catmull-Rom cubic beziers.
 */
export function pointsToSmoothSVGPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  // 1. RDP simplification — remove jitter (higher epsilon = fewer points)
  const simplified = simplifyPoints(points, 2.0);

  if (simplified.length === 1) return `M${simplified[0].x},${simplified[0].y}`;
  if (simplified.length === 2) {
    return `M${simplified[0].x},${simplified[0].y} L${simplified[1].x},${simplified[1].y}`;
  }

  // 2. Chaikin corner-cutting — smooths sharp corners before curve fitting
  const smoothed = chaikinSmooth(simplified, 1);

  // 3. Catmull-Rom to cubic bezier conversion
  const alpha = 0.85;
  let d = `M${smoothed[0].x},${smoothed[0].y}`;

  for (let i = 0; i < smoothed.length - 1; i++) {
    const p0 = smoothed[Math.max(0, i - 1)];
    const p1 = smoothed[i];
    const p2 = smoothed[Math.min(smoothed.length - 1, i + 1)];
    const p3 = smoothed[Math.min(smoothed.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / (6 * alpha);
    const cp1y = p1.y + (p2.y - p0.y) / (6 * alpha);
    const cp2x = p2.x - (p3.x - p1.x) / (6 * alpha);
    const cp2y = p2.y - (p3.y - p1.y) / (6 * alpha);

    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }

  return d;
}
