/**
 * Pure math for Play/Present mode's vertical-only wheel scroll. Kept free of
 * PixiJS/store imports so it's trivially unit-testable; pixiInteractionCore
 * wires it to the real wheel handler and viewportStore.
 */

export interface PresentScrollRange {
  /** viewportStore.y when the frame's bottom edge is flush with the screen bottom. */
  minY: number;
  /** viewportStore.y when the frame's top edge is flush with the screen top (fit-to-width position). */
  maxY: number;
}

/**
 * The vertical scroll range for the active present-mode frame, or `null` when
 * the frame (at the current scale) fits within the viewport — in that case it
 * stays centered by fitToWidth and no scrolling is allowed.
 */
export function computePresentScrollRange(
  frameTop: number,
  frameHeight: number,
  scale: number,
  viewportHeight: number,
): PresentScrollRange | null {
  const scaledHeight = frameHeight * scale;
  if (scaledHeight <= viewportHeight) return null;

  const maxY = -frameTop * scale;
  const minY = viewportHeight - scaledHeight - frameTop * scale;
  return { minY, maxY };
}

/** Clamp a candidate viewport.y into the given scroll range. */
export function clampPresentScrollY(y: number, range: PresentScrollRange): number {
  return Math.min(range.maxY, Math.max(range.minY, y));
}
