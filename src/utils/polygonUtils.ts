/**
 * True when an `innerRadiusRatio` should be treated as a star (rather than a
 * plain regular polygon): defined, and strictly between 0 (inclusive) and 1
 * (exclusive) — 1 (or unset) collapses back to a regular polygon.
 */
export function isStarRatio(innerRadiusRatio: number | undefined): innerRadiusRatio is number {
  return (
    innerRadiusRatio !== undefined &&
    Number.isFinite(innerRadiusRatio) &&
    innerRadiusRatio >= 0 &&
    innerRadiusRatio < 1
  );
}

/**
 * Generate regular polygon (or star, when `innerRadiusRatio` is given) points
 * that are normalized to span exactly 0..width and 0..height. This ensures
 * the renderer's computed bounding box matches the stored node dimensions.
 *
 * For a star, `sides` is the number of rays: the shape alternates `sides`
 * outer vertices (radius 1) with `sides` inner vertices (radius
 * `innerRadiusRatio`), for `sides * 2` vertices total.
 */
export function generatePolygonPoints(
  sides: number,
  width: number,
  height: number,
  innerRadiusRatio?: number,
): number[] {
  const isStar = isStarRatio(innerRadiusRatio);
  const vertexCount = isStar ? sides * 2 : sides;

  // Generate raw unit-circle-based points
  const rawX: number[] = [];
  const rawY: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount - Math.PI / 2;
    const radius = isStar && i % 2 === 1 ? innerRadiusRatio! : 1;
    rawX.push(Math.cos(angle) * radius);
    rawY.push(Math.sin(angle) * radius);
  }

  // Find bounding box of raw points
  const minX = Math.min(...rawX);
  const maxX = Math.max(...rawX);
  const minY = Math.min(...rawY);
  const maxY = Math.max(...rawY);
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  // Normalize to 0..width and 0..height
  const points: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    points.push(((rawX[i] - minX) / rangeX) * width);
    points.push(((rawY[i] - minY) / rangeY) * height);
  }

  return points;
}
