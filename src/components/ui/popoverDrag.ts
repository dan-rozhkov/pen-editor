/**
 * Pure position math for `PopoverContent`'s draggable ("torn off") mode.
 * Kept free of DOM/React so the clamp/drag arithmetic is directly unit
 * testable — see `__tests__/popoverDrag.test.ts`.
 */

/** A 2D point in viewport (client) pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A box's width/height in pixels. */
export interface Size {
  width: number;
  height: number;
}

/** Where a drag gesture started: the pointer's client position and the box's top-left at that moment. */
export interface DragOrigin {
  pointer: Point;
  position: Point;
}

/**
 * Clamp a box's top-left position so it stays fully inside the viewport.
 * If the box is bigger than the viewport on an axis, pin it to 0 on that
 * axis rather than producing a negative position.
 */
export function clampPositionToViewport(position: Point, size: Size, viewport: Size): Point {
  const maxX = Math.max(0, viewport.width - size.width);
  const maxY = Math.max(0, viewport.height - size.height);
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY),
  };
}

/**
 * Compute a dragged box's new top-left from where the drag started and the
 * pointer's current client position, clamped to stay inside the viewport.
 */
export function computeDragPosition(
  origin: DragOrigin,
  pointer: Point,
  size: Size,
  viewport: Size,
): Point {
  const raw: Point = {
    x: origin.position.x + (pointer.x - origin.pointer.x),
    y: origin.position.y + (pointer.y - origin.pointer.y),
  };
  return clampPositionToViewport(raw, size, viewport);
}
