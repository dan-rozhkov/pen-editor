type Axis = "x" | "y";

/** The nearest ancestor that scrolls on an axis (overflow auto or scroll), whether or not it overflows yet; null if none. */
function scroller(el: HTMLElement, axis: Axis): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * Scrolls an element into view inside its own scroll container only, never the page or an outer
 * scroller (`scrollIntoView` walks all of them, and playback calls this many times a minute).
 */
export function keepInView(el: HTMLElement | null | undefined, axis: Axis = "y"): void {
  if (!el) return;
  const box = scroller(el, axis);
  if (!box) return;
  const item = el.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  const [start, end] = axis === "y" ? [item.top - view.top, item.bottom - view.bottom] : [item.left - view.left, item.right - view.right];
  const delta = start < 0 ? start : end > 0 ? end : 0;
  if (axis === "y") box.scrollTop += delta;
  else box.scrollLeft += delta;
}
