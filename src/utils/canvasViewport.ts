/**
 * Single source for the canvas element's viewport metrics. The element is
 * rendered once by PixiCanvas (`[data-canvas]`). Fallback when the canvas
 * isn't mounted (e.g. tests, pre-init): the window dimensions — deliberately
 * NOT the old `window.innerWidth` minus a magic sidebar-width offset (480),
 * which baked in a stale assumption about panel widths.
 */

export function getCanvasElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-canvas]");
}

export function getCanvasViewportMetrics(): { width: number; height: number } {
  const canvasEl = getCanvasElement();
  // `|| window.*` (not `??`) so a mounted-but-unlaid-out canvas (clientWidth 0)
  // still falls back to the window instead of a degenerate 0-size viewport.
  return {
    width: canvasEl?.clientWidth || window.innerWidth,
    height: canvasEl?.clientHeight || window.innerHeight,
  };
}

/**
 * Center of the canvas viewport in canvas-local coordinates (i.e. relative
 * to the `[data-canvas]` element's own top-left, the same coordinate space
 * `zoomAtPoint` expects — see `panController.ts`'s `e.clientX - rect.left`).
 * NOT window/client coordinates: those only coincide with canvas-local ones
 * when the canvas sits flush at the window origin, which it doesn't once
 * side panels are open. Falls back to half the window size when the canvas
 * isn't mounted.
 */
export function getCanvasViewportCenter(): { centerX: number; centerY: number } {
  const { width, height } = getCanvasViewportMetrics();
  return {
    centerX: width / 2,
    centerY: height / 2,
  };
}
