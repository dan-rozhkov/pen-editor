/**
 * The streaming frontier: bottom edge (px, relative to `contentTop`, unscaled)
 * of the last visible, in-flow leaf in document order. Full-height wrappers and
 * absolute/fixed/sticky bars and backgrounds exist from the first byte and
 * would pin the "writing head" to the bottom, so a leaf is skipped when it OR
 * ANY ANCESTOR up to `mountRoot` is out of flow (a `.tab{position:absolute}`
 * whose `<span>` children are the leaves). Reads only; the per-ancestor
 * computed-style verdicts are cached for the duration of one measurement.
 */

/** Text-bearing or childless: an element that is itself visible content, not
 * merely a wrapper around it. */
function isLeafLike(el: Element): boolean {
  if (el.children.length === 0) return true;
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return true;
  }
  return false;
}

function isOutOfFlow(position: string): boolean {
  return position === "absolute" || position === "fixed" || position === "sticky";
}

export function measureFrontier(
  elements: HTMLElement[],
  contentTop: number,
  mountRoot: Element,
): number {
  const outOfFlowCache = new Map<Element, boolean>();
  const inFlowChain = (el: Element): boolean => {
    for (let cur: Element | null = el; cur && cur !== mountRoot; cur = cur.parentElement) {
      let out = outOfFlowCache.get(cur);
      if (out === undefined) {
        out = isOutOfFlow(getComputedStyle(cur).position);
        outOfFlowCache.set(cur, out);
      }
      if (out) return false;
    }
    return true;
  };

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isLeafLike(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (!inFlowChain(el)) continue;
    return rect.bottom - contentTop;
  }
  return 0;
}
