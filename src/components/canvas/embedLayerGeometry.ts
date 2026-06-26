export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Round a CSS px value to the nearest device pixel. */
function snap(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

/**
 * Map a world-space rect to a device-pixel-snapped screen rect, given the
 * viewport pan/zoom. Mirrors the math used by InlineEmbedEditor.
 */
export function embedScreenRect(
  absX: number,
  absY: number,
  width: number,
  height: number,
  scale: number,
  panX: number,
  panY: number,
  dpr: number,
): ScreenRect {
  return {
    left: snap(absX * scale + panX, dpr),
    top: snap(absY * scale + panY, dpr),
    width: snap(width * scale, dpr),
    height: snap(height * scale, dpr),
  };
}
