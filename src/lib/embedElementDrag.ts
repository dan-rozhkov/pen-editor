/**
 * Pure helpers for embed-element drag-to-reposition (see `EmbedLayer.tsx`'s
 * pointerdown/pointermove/pointerup drag gesture on a picked embed element).
 *
 * Every control here writes an EXPLICIT declaration, never `null`/
 * `removeProperty` — same rule as `embedElementStyle.ts`'s panel controls:
 * embed HTML is almost entirely class-driven, so clearing an inline
 * declaration that was never there is a no-op, and it would let a class's
 * own `right`/`bottom` stretch the element again the moment `left` moves.
 */

export type DragPosition = "absolute" | "fixed" | "sticky" | "relative";

/** How `computeDragStyles` expresses the delta:
 * - `"offset"`: writes `position`/`left`/`top` (and pinned `right`/`bottom`/
 *   `width`/`height`) — the normal case.
 * - `"margin"`: writes `margin-left`/`margin-top` only, `position` untouched
 *   — `sticky`'s own `left`/`top`/`right`/`bottom` are stick THRESHOLDS, not
 *   an offset, so writing them wouldn't move the element and would silently
 *   change its scroll-stick behavior instead. */
export type DragMode = "offset" | "margin";

export interface DragBase {
  mode: DragMode;
  /** The CSS `position` value to write while dragging (`"offset"` mode only
   * — `"margin"` mode never touches `position`). Static elements are
   * promoted to `relative` — the element has no `position` of its own to
   * preserve, and a relative offset is the only way to shift it without
   * taking it out of flow. */
  position: DragPosition;
  /** Base horizontal offset, CSS px, captured once at drag start — the
   * base `left`/`margin-left` in `"offset"`/`"margin"` mode respectively. */
  left: number;
  /** Base vertical offset, CSS px, captured once at drag start — the base
   * `top`/`margin-top` in `"offset"`/`"margin"` mode respectively. */
  top: number;
  /** Whether `right` must be pinned to an explicit `auto` while dragging
   * (positioned elements only) — a computed `right` that isn't already
   * `auto` would otherwise stretch the element between the new `left` and
   * the old `right` instead of moving it. */
  pinRight: boolean;
  /** Same as `pinRight`, for `bottom`. */
  pinBottom: boolean;
  /** The element's own layout width, CSS px, captured once at drag start —
   * only set when `pinRight` is true. Pinning `right: auto` alone would let
   * the element collapse to its content width the instant `right` stops
   * stretching it against `left` (classic embed pattern:
   * `left:0; right:0` for a full-width bar) — writing this alongside
   * `right: auto` keeps its rendered width unchanged. `offsetWidth` (the
   * untransformed layout box), not `getBoundingClientRect()`, which would
   * read the *scaled* screen size under the embed host's zoom transform. */
  pinnedWidth?: number;
  /** Same as `pinnedWidth`, for `pinBottom` / `height`. */
  pinnedHeight?: number;
}

const OFFSET_POSITIONED = new Set(["absolute", "fixed"]);

function parseOffset(value: string | undefined | null, fallback: number): number {
  if (!value || value === "auto") return fallback;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

function isAutoOrEmpty(value: string | undefined | null): boolean {
  return !value || value === "auto";
}

/**
 * Snapshot the base offsets for a drag from the LIVE element's computed
 * style (plus its offset box, used only as the "auto" fallback for a
 * positioned element with no explicit left/top yet).
 *
 * Call this ONCE, at drag start. `computeDragStyles` always offsets from the
 * `DragBase` it returns, never from the element's current (possibly
 * already-dragged-this-gesture) style — recapturing mid-drag would make the
 * base itself move every frame and the element would drift away from the
 * cursor instead of tracking it.
 */
export function captureDragBase(el: HTMLElement, computed: CSSStyleDeclaration): DragBase {
  const position = computed.position;

  if (position === "sticky") {
    // See `DragMode` doc: sticky's left/top/right/bottom are stick
    // thresholds, not an offset. Drag it by shifting its margin instead —
    // `position` and the thresholds stay untouched, so the element keeps
    // sticking exactly as before once the drag ends. `auto` (an unset
    // margin) has no numeric meaning here, so it falls back to 0 rather
    // than any offset-box measurement.
    return {
      mode: "margin",
      position: "sticky",
      left: parseOffset(computed.marginLeft, 0),
      top: parseOffset(computed.marginTop, 0),
      pinRight: false,
      pinBottom: false,
    };
  }

  if (OFFSET_POSITIONED.has(position)) {
    const pinRight = !isAutoOrEmpty(computed.right);
    const pinBottom = !isAutoOrEmpty(computed.bottom);
    return {
      mode: "offset",
      position: position as DragPosition,
      left: parseOffset(computed.left, el.offsetLeft),
      top: parseOffset(computed.top, el.offsetTop),
      pinRight,
      pinBottom,
      pinnedWidth: pinRight ? el.offsetWidth : undefined,
      pinnedHeight: pinBottom ? el.offsetHeight : undefined,
    };
  }

  // static/relative: the base offset is the current relative shift (0 when
  // unset) — a static element has no left/top of its own to inherit.
  return {
    mode: "offset",
    position: "relative",
    left: parseOffset(computed.left, 0),
    top: parseOffset(computed.top, 0),
    pinRight: false,
    pinBottom: false,
  };
}

/**
 * Compute the inline style declarations for dragging `base` by (dx, dy) CSS
 * px. `dx`/`dy` must always be measured from the drag's start (i.e. relative
 * to the same `base` `captureDragBase` produced once) — calling this
 * repeatedly with a growing delta against a fixed `base` is exactly how a
 * drag gesture should be driven, and is what keeps it drift-free.
 */
export function computeDragStyles(
  base: DragBase,
  dx: number,
  dy: number,
): Record<string, string> {
  const left = base.left + dx;
  const top = base.top + dy;

  if (base.mode === "margin") {
    return {
      "margin-left": `${left}px`,
      "margin-top": `${top}px`,
    };
  }

  const styles: Record<string, string> = {
    position: base.position,
    left: `${left}px`,
    top: `${top}px`,
  };
  if (base.pinRight) {
    styles.right = "auto";
    styles.width = `${base.pinnedWidth}px`;
  }
  if (base.pinBottom) {
    styles.bottom = "auto";
    styles.height = `${base.pinnedHeight}px`;
  }
  return styles;
}
