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

export function getCanvasViewportCenter(): { centerX: number; centerY: number } {
  const canvasEl = getCanvasElement();
  const rect = canvasEl?.getBoundingClientRect();
  return {
    centerX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    centerY: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
  };
}
