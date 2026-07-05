import type { Point } from "./svgPathFlatten";

export interface NodeTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Map local shape points (0,0)..(width,height) into the shared parent-local
 * coordinate space, applying the same flip-then-rotate-then-translate order
 * PixiJS uses for node containers (see `src/pixi/renderers/index.ts`:
 * pivot = flip anchor, scale = flip, rotation about that pivot, then position).
 */
export function localPointToParentSpace(point: Point, transform: NodeTransform): Point {
  const { x, y, width, height, rotation = 0, flipX = false, flipY = false } = transform;

  let px = flipX ? width - point.x : point.x;
  let py = flipY ? height - point.y : point.y;

  if (rotation) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx;
    py = ry;
  }

  return { x: x + px, y: y + py };
}

export function transformRing(ring: Point[], transform: NodeTransform): Point[] {
  return ring.map((p) => localPointToParentSpace(p, transform));
}
