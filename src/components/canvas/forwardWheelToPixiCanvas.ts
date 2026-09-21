/**
 * Wheel forwarding for the DOM overlays that sit on top of the Pixi canvas.
 *
 * Pixi's wheel listener is bound to the `<canvas>` element, which is a
 * *sibling* of every overlay host, not an ancestor — so a wheel event landing
 * on an overlay that has taken pointer events (`pointerEvents: "auto"`) never
 * reaches it via bubbling, and zoom/pan silently stops working exactly over
 * the region the user is looking at. Both overlay hosts therefore re-dispatch
 * a matching event at the canvas; this module is the one copy of that, shared
 * by `EmbedLayer` (element picking / active embed) and `EmbedPromptHost` (the
 * empty-embed composer card).
 */

/**
 * Locates the Pixi `<canvas>` that `el` is overlaying, via the `[data-canvas]`
 * wrapper both are inside. Returns null when the overlay is rendered outside a
 * canvas (tests, teardown).
 */
export function findPixiCanvasFrom(el: HTMLElement): HTMLCanvasElement | null {
  return (
    el.closest<HTMLElement>("[data-canvas]")?.querySelector<HTMLCanvasElement>("canvas") ??
    null
  );
}

/**
 * Re-dispatches `e` at `canvas` as a fresh bubbling WheelEvent. Every field
 * `panController` reads is preserved — dropping one (`ctrlKey`, say) turns a
 * pinch-zoom into a scroll, which is the kind of bug that only shows up on a
 * trackpad.
 */
export function redispatchWheelAt(canvas: HTMLCanvasElement, e: WheelEvent): void {
  canvas.dispatchEvent(
    new WheelEvent("wheel", {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
      deltaMode: e.deltaMode,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}
