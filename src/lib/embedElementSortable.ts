/**
 * Pure DOM math for the embed element drag gesture's "sortable" mode: given
 * an element being dragged, compute the candidate insertion slots among its
 * in-flow siblings, and pick the slot nearest a cursor position.
 *
 * Kept DOM-only (no React/Zustand/Pixi) so it's testable against a plain
 * tree, matching `embedElementPicker.ts`/`embedElementStyle.ts`. The actual
 * DOM mutation (moving the element) is `applyEmbedElementReorder`'s job in
 * `embedElementStyle.ts` — this module only answers "where would it go".
 *
 * Reordering is deliberately restricted to in-flow siblings
 * (`position` not `absolute`/`fixed`, `display` not `none`): an
 * absolutely/fixed-positioned element is placed relative to its containing
 * block, not its position in the DOM, so moving it among its siblings would
 * change paint order but not move it on screen at all — the drag would look
 * like it did nothing. See `isSortable`.
 */

/** Where a dragged element would land if dropped on this slot. */
export interface DropSlot {
  /** Index among this element's candidate siblings (0..n, n = candidate
   * count) — for debugging/tests only, not used to resolve the drop. */
  index: number;
  /** The sibling to insert before, or null to insert as the parent's last
   * child. */
  before: Element | null;
  /** The insertion-line rect, in CLIENT coordinates (screen px, same frame
   * as `getBoundingClientRect`) — ready to draw as a thin highlight rect. */
  indicator: { left: number; top: number; width: number; height: number };
  /** Anchor point for distance-to-cursor comparisons: the indicator rect's
   * center. */
  x: number;
  y: number;
}

const OUT_OF_FLOW_POSITIONS = new Set(["absolute", "fixed"]);

function isInFlowPosition(position: string): boolean {
  return !OUT_OF_FLOW_POSITIONS.has(position);
}

/** A sibling that participates in in-flow layout and is actually rendered —
 * the two properties that make it a legitimate anchor for an insertion slot. */
function isInFlowSibling(child: Element): boolean {
  const cs = getComputedStyle(child);
  return isInFlowPosition(cs.position) && cs.display !== "none";
}

/**
 * Can `el` be reordered by this gesture at all. False for an out-of-flow
 * element (see module doc), and false when the parent doesn't have at least
 * one OTHER in-flow sibling to reorder against (a lone in-flow child has
 * nowhere to move to).
 *
 * `computed` is `el`'s own `getComputedStyle` result — passed in rather than
 * recomputed here since callers (the drag gesture) already have it at
 * pointerdown time.
 */
export function isSortable(el: HTMLElement, computed: CSSStyleDeclaration): boolean {
  if (!isInFlowPosition(computed.position)) return false;

  // Walked via `parentElement`, not `parentNode`: unlike `embedElementPicker`'s
  // path-building (which must walk through a ShadowRoot), this only ever
  // needs to look at *element* siblings, and a shadow root has none — a
  // top-level content element there correctly has no reorderable siblings.
  const parent = el.parentElement;
  if (!parent) return false;

  const inFlowSiblingCount = Array.from(parent.children).filter(
    (c) => c === el || isInFlowSibling(c),
  ).length;
  return inFlowSiblingCount >= 2;
}

function verticalOverlapRatio(a: DOMRect, b: DOMRect): number {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const minHeight = Math.min(a.height, b.height) || 1;
  return overlap / minHeight;
}

function horizontalOverlapRatio(a: DOMRect, b: DOMRect): number {
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const minWidth = Math.min(a.width, b.width) || 1;
  return overlap / minWidth;
}

/** True when `a`/`b` sit side-by-side horizontally: they substantially share
 * the same vertical band (same "row") while barely overlapping horizontally
 * (they're not stacked). This is the one check that has to work uniformly
 * for column/row/grid/flex-wrap layouts — it looks only at the two rects,
 * never at `display`/`flex-direction`, so it doesn't need to special-case
 * any of them. */
function isSideBySide(a: DOMRect, b: DOMRect): boolean {
  return verticalOverlapRatio(a, b) > 0.5 && horizontalOverlapRatio(a, b) < 0.5;
}

type IndicatorAxis = "vertical-line" | "horizontal-line";

/**
 * Decide whether the gap at a slot should be drawn as a vertical or
 * horizontal line. Uses the slot's real neighbor(s) when there are two
 * (`prev`/`next` straddling the gap); at the start or end of the candidate
 * list there's only one real neighbor, so the dragged element's OWN rect
 * stands in for the missing side — it's the only other rect anyone actually
 * has at that boundary, and it's a reasonable proxy for "which way does this
 * row/column run" since `el` currently sits inside that same flow.
 */
function determineAxis(prev: DOMRect | null, next: DOMRect | null, elRect: DOMRect): IndicatorAxis {
  const [a, b] = prev && next ? [prev, next] : [(prev ?? next) as DOMRect, elRect];
  return isSideBySide(a, b) ? "vertical-line" : "horizontal-line";
}

/** Build the indicator rect for one slot from its real neighbor rect(s)
 * (never `elRect` — that's only consulted for axis detection above; sizing
 * a slot off the element being dragged would make the indicator jump size
 * as soon as the drag starts). */
function buildIndicator(
  axis: IndicatorAxis,
  prev: DOMRect | null,
  next: DOMRect | null,
  thickness: number,
): DropSlot["indicator"] {
  const rects = [prev, next].filter((r): r is DOMRect => r !== null);

  if (axis === "vertical-line") {
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const centerX = prev && next ? (prev.right + next.left) / 2 : prev ? prev.right : next!.left;
    return { left: centerX - thickness / 2, top, width: thickness, height: bottom - top };
  }

  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const centerY = prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom : next!.top;
  return { left, top: centerY - thickness / 2, width: right - left, height: thickness };
}

/**
 * Filter `el`'s parent's element children down to the in-flow candidates
 * `el` could be dropped against — everything `collectDropSlots` used to do
 * except the rect reads. Returns `null` when `el` isn't sortable at all (see
 * `isSortable`), matching `collectDropSlots`'s old `[]` return but letting a
 * caller distinguish "not sortable" from "sortable, compute slots".
 *
 * This reads `getComputedStyle` on every sibling, which is why callers
 * (the drag gesture) call it ONCE per drag, right when the pointer crosses
 * the drag threshold — computed styles don't change over the course of a
 * gesture, unlike rects, which do (zoom/pan/reflow can happen mid-drag while
 * `forwardWheel` deliberately keeps them live). See `buildDropSlots` for the
 * per-frame half.
 */
export function collectSortCandidates(el: HTMLElement): Element[] | null {
  const computed = getComputedStyle(el);
  if (!isSortable(el, computed)) return null;

  const parent = el.parentElement!;
  const candidates = Array.from(parent.children).filter(
    (c) => c !== el && isInFlowSibling(c),
  );
  // `isSortable` guarantees at least one in-flow sibling besides `el`, so
  // `candidates` is never empty here — but guard anyway rather than trust a
  // future edit to that invariant silently.
  if (candidates.length === 0) return null;

  return candidates;
}

/**
 * Build the insertion slots for dragging `el` (whose rect is `elRect`) among
 * `candidates` — one slot before each candidate (in DOM order) plus one
 * trailing slot for "insert as last child". Only reads rects (`candidates`
 * is assumed already filtered by `collectSortCandidates`), so it's cheap
 * enough to call on every `pointermove` of a drag — rects, unlike computed
 * styles, can change mid-gesture (viewport zoom/pan stays live while
 * picking; see `forwardWheel` in `EmbedLayer.tsx`), so slots must be rebuilt
 * every frame rather than cached from drag-start.
 *
 * @param elRect The dragged element's own rect, used only to decide the
 *   indicator axis at the edges of the candidate list (see
 *   `determineAxis`) — never to size or position a slot. Callers pass the
 *   rect captured ONCE, before any drag-visual transform was ever applied to
 *   the dragged element, since a transformed rect would drift the axis
 *   decision as the drag progresses.
 * @param indicatorThickness CSS px width of the drawn line's short axis
 *   (2px matches the design decision recorded in the plan).
 */
export function buildDropSlots(
  candidates: Element[],
  elRect: DOMRect,
  indicatorThickness = 2,
): DropSlot[] {
  const slots: DropSlot[] = [];

  for (let i = 0; i <= candidates.length; i++) {
    const prevCandidate = i > 0 ? candidates[i - 1] : null;
    const nextCandidate = i < candidates.length ? candidates[i] : null;
    const prevRect = prevCandidate ? prevCandidate.getBoundingClientRect() : null;
    const nextRect = nextCandidate ? nextCandidate.getBoundingClientRect() : null;

    const axis = determineAxis(prevRect, nextRect, elRect);
    const indicator = buildIndicator(axis, prevRect, nextRect, indicatorThickness);

    slots.push({
      index: i,
      before: nextCandidate,
      indicator,
      x: indicator.left + indicator.width / 2,
      y: indicator.top + indicator.height / 2,
    });
  }

  return slots;
}

/**
 * Collect the insertion slots for dragging `el` among its parent's in-flow
 * element children. Thin wrapper over `collectSortCandidates` +
 * `buildDropSlots` for callers (existing tests, one-shot lookups) that don't
 * need the two-phase split — a real drag gesture calls the two functions
 * separately instead (see their doc comments for why). Returns `[]` when
 * `el` isn't sortable at all (see `isSortable`).
 */
export function collectDropSlots(el: HTMLElement, indicatorThickness = 2): DropSlot[] {
  const candidates = collectSortCandidates(el);
  if (!candidates) return [];
  const elRect = el.getBoundingClientRect();
  return buildDropSlots(candidates, elRect, indicatorThickness);
}

/** Nearest slot to (clientX, clientY) by squared Euclidean distance (no
 * `Math.sqrt` needed — it doesn't change which slot is closest). Ties keep
 * the earlier slot, since `slots` is walked in order and only a STRICTLY
 * smaller distance replaces the current best. */
export function pickDropSlot(slots: DropSlot[], clientX: number, clientY: number): DropSlot | null {
  if (slots.length === 0) return null;

  let best = slots[0];
  let bestDist = Infinity;
  for (const slot of slots) {
    const dx = slot.x - clientX;
    const dy = slot.y - clientY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot;
    }
  }
  return best;
}

/** `el`'s next sibling that is itself a candidate (in-flow, not
 * `display: none`) — skipping over any out-of-flow siblings sitting between
 * `el` and it. `slot.before` is always drawn from the candidate list (see
 * `buildDropSlots`), so this is the one comparison `isNoOpSlot` needs: the
 * raw `nextElementSibling` can point at an out-of-flow element that isn't a
 * slot boundary at all. */
function nextCandidateSibling(el: Element): Element | null {
  let sibling = el.nextElementSibling;
  while (sibling) {
    if (isInFlowSibling(sibling)) return sibling;
    sibling = sibling.nextElementSibling;
  }
  return null;
}

/**
 * True when `slot` describes `el`'s CURRENT position — i.e. dropping there
 * would move nothing on screen. Callers use this to skip writing a no-op
 * reorder and just revert the drag's visual-only transform.
 *
 * Compares against `el`'s next IN-FLOW sibling, not the raw
 * `nextElementSibling`: an out-of-flow sibling (`position: absolute/fixed`)
 * sitting right after `el` is never a candidate (see `isSortable`'s doc
 * comment), so dropping "before" it is really dropping into the same visual
 * slot `el` already occupies — the DOM would move (past that out-of-flow
 * sibling) but nothing on screen would change, and worse, moving `el` past
 * an unstyled `z-index` absolute overlay can flip which one paints on top.
 * `slot.before === null` (the trailing "insert as last child" slot) is a
 * no-op only when there is no in-flow sibling after `el` either — a
 * trailing out-of-flow sibling doesn't disqualify it.
 *
 * This is a live-DOM-only distinction: `applyEmbedElementReorder` in
 * `embedElementStyle.ts` (the source-html half of a commit) has no
 * `getComputedStyle`/layout available on a `DOMParser` document, so it stays
 * purely mechanical and compares raw DOM adjacency — only this function,
 * looking at the live shadow DOM, can know what's actually in-flow.
 */
export function isNoOpSlot(el: HTMLElement, slot: DropSlot): boolean {
  const nextInFlow = nextCandidateSibling(el);
  if (slot.before === null) return nextInFlow === null;
  return slot.before === nextInFlow;
}
