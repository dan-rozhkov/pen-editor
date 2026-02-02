/**
 * Generate regular polygon points that are normalized to span exactly 0..width and 0..height.
 * This ensures Konva Line's computed bounding box matches the stored node dimensions.
 */
export function generatePolygonPoints(
  sides: number,
  width: number,
  height: number,
): number[] {
  // Generate raw unit-circle-based points
  const rawX: number[] = [];
  const rawY: number[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    rawX.push(Math.cos(angle));
    rawY.push(Math.sin(angle));
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
  for (let i = 0; i < sides; i++) {
    points.push(((rawX[i] - minX) / rangeX) * width);
    points.push(((rawY[i] - minY) / rangeY) * height);
  }

  return points;
}
