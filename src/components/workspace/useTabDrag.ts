import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";

// Drag to reorder, a port of pen-editor-desktop/src/tabbar/renderer.ts ("Drag to reorder").
// pointerdown arms a drag, it starts after DRAG_THRESHOLD_PX of horizontal movement (a plain click
// never moves a tab). The dragged tab follows the pointer with translateX, its siblings shift with
// inline transforms to open a gap. Transforms are imperative: the tab must not get `style` from React.
// Drop calls onMove(id, beforeId) (null = the end). Cancel paths send nothing.

const DRAG_THRESHOLD_PX = 4;
const SIBLING_TRANSITION = "transform 150ms ease-out";
const GLIDE_MS = 120;
const GLIDE_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";

interface Slot {
  id: string;
  el: HTMLElement;
  left: number;
  width: number;
}

interface Drag {
  id: string;
  el: HTMLElement;
  pointerId: number;
  startX: number;
  started: boolean;
  slots: Slot[];
  from: number;
  to: number;
  gap: number;
  stripLeft: number;
  stripRight: number;
  animate: boolean;
}

interface Deps {
  getList: () => HTMLElement | null;
  getIds: () => readonly string[];
  move: (tabId: string, beforeId: string | null) => void;
}

const tabEls = (list: HTMLElement) => Array.from(list.querySelectorAll<HTMLElement>(":scope > [data-ws-tab]"));

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** true when element.animate exists and the user has not asked for less motion (happy-dom has no animate). */
export function canAnimate(el: Element): boolean {
  return typeof el.animate === "function" && !prefersReducedMotion();
}

/** A click that opens the context menu: any non-primary button, or Ctrl+click on macOS. */
export function isSecondaryClick(e: { button: number; ctrlKey: boolean }): boolean {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  return e.button !== 0 || (mac && e.ctrlKey);
}

function createController() {
  let drag: Drag | null = null;
  let deps: Deps = { getList: () => null, getIds: () => [], move: () => {} };
  const getList = () => deps.getList();
  const getIds = () => deps.getIds();
  const move = (id: string, before: string | null) => deps.move(id, before);

  function startDrag(d: Drag): boolean {
    const list = getList();
    if (!list) return false;
    // Neighbours still entering or leaving move while measured: wait for a quiet strip.
    if (list.querySelector(".ws-tab-ghost, .ws-tab.entering")) return false;
    d.slots = tabEls(list).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.wsTab ?? "", el, left: r.left, width: r.width };
    });
    d.from = d.slots.findIndex((s) => s.id === d.id);
    if (d.from === -1 || d.slots.length < 2) return false;
    d.to = d.from;
    const strip = list.getBoundingClientRect();
    const cs = getComputedStyle(list);
    d.stripLeft = strip.left + (parseFloat(cs.paddingLeft) || 0);
    d.stripRight = strip.right - (parseFloat(cs.paddingRight) || 0);
    d.gap = parseFloat(cs.columnGap) || 0;
    d.animate = canAnimate(d.el);
    try {
      d.el.setPointerCapture(d.pointerId);
    } catch {
      return false;
    }
    d.el.addEventListener("lostpointercapture", cancel);
    // Slots were measured once: a scrolling strip would make them wrong (no auto-scroll, like the desktop).
    list.addEventListener("scroll", cancel);
    d.el.classList.add("dragging");
    list.classList.add("reordering");
    for (const s of d.slots) {
      if (s.el !== d.el) s.el.style.transition = d.animate ? SIBLING_TRANSITION : "none";
    }
    return true;
  }

  function layout(d: Drag, clientX: number): void {
    const me = d.slots[d.from];
    const minTx = d.stripLeft - me.left;
    const maxTx = d.stripRight - me.width - me.left;
    const tx = Math.max(minTx, Math.min(Math.max(minTx, maxTx), clientX - d.startX));
    d.el.style.transform = `translateX(${tx}px)`;
    const center = me.left + tx + me.width / 2;
    const others = d.slots.filter((_, i) => i !== d.from);
    let to = 0;
    for (const o of others) if (o.left + o.width / 2 < center) to++;
    d.to = to;
    // Final layout if dropped here: contiguous from the first slot's left edge.
    const ordered = others.slice();
    ordered.splice(to, 0, me);
    let x = d.slots[0].left;
    for (const s of ordered) {
      if (s !== me) s.el.style.transform = x === s.left ? "" : `translateX(${x - s.left}px)`;
      x += s.width + d.gap;
    }
  }

  function end(d: Drag): void {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cancel);
    d.el.removeEventListener("lostpointercapture", cancel);
    getList()?.removeEventListener("scroll", cancel);
    try {
      d.el.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
  }

  function resetStyles(d: Drag): void {
    for (const s of d.slots) {
      s.el.style.transition = "none";
      s.el.style.transform = "";
    }
    d.el.classList.remove("dragging");
    getList()?.classList.remove("reordering");
    void getList()?.offsetWidth; // flush with transitions off, so clearing the transforms is instant
    for (const s of d.slots) s.el.style.transition = "";
  }

  function cancel(): void {
    const d = drag;
    if (!d) return;
    end(d);
    if (d.started) resetStyles(d);
  }

  function onMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if ((e.buttons & 1) === 0) {
      cancel(); // the button is up: a pointerup was lost
      return;
    }
    if (!d.started) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
      if (!startDrag(d)) return; // stay armed, retry on a later move once the strip is quiet
      d.started = true;
    }
    layout(d, e.clientX);
  }

  function onUp(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    end(d);
    if (!d.started) return;
    const visualLeft = d.el.getBoundingClientRect().left;
    resetStyles(d);
    if (d.to !== d.from) {
      const others = d.slots.filter((s) => s.el !== d.el);
      const before = d.to < others.length ? others[d.to] : null;
      // Neighbours already sit in their final slots, so the commit does not make them jump.
      flushSync(() => move(d.id, before ? before.id : null));
    }
    if (d.animate) {
      const delta = visualLeft - d.el.getBoundingClientRect().left;
      if (Math.abs(delta) > 0.5) {
        d.el.animate([{ transform: `translateX(${delta}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: GLIDE_EASING });
      }
    }
  }

  function pointerDown(e: ReactPointerEvent<HTMLElement>, id: string): void {
    if (isSecondaryClick(e) || e.pointerType === "touch") return;
    if (e.target instanceof Element && e.target.closest(".ws-tab-close")) return;
    const el = e.currentTarget;
    if (el.classList.contains("entering")) return;
    if (drag) cancel(); // a stale gesture (lost pointerup) must not swallow this one
    drag = { id, el, pointerId: e.pointerId, startX: e.clientX, started: false, slots: [], from: 0, to: 0, gap: 0, stripLeft: 0, stripRight: 0, animate: false };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
  }

  /** Aborts a started drag when the set of tabs changed under it. */
  function checkIds(): void {
    const d = drag;
    if (!d) return;
    const ids = new Set(getIds());
    const same = d.started ? ids.size === d.slots.length && d.slots.every((s) => ids.has(s.id)) : ids.has(d.id);
    if (!same) cancel();
  }

  return { pointerDown, cancel, checkIds, setDeps: (d: Deps) => (deps = d) };
}

/**
 * Drag-to-reorder for the tab strip. `onPointerDown(e, tabId)` goes on each tab element, which must
 * carry `data-ws-tab={id}` and be a direct child of the list.
 */
export function useTabDrag(listRef: RefObject<HTMLElement | null>, tabIds: readonly string[], onMove: (tabId: string, beforeId: string | null) => void) {
  const [ctl] = useState(createController);
  useEffect(() => {
    ctl.setDeps({ getList: () => listRef.current, getIds: () => tabIds, move: onMove });
    ctl.checkIds();
  }, [tabIds, onMove, ctl, listRef]);
  useEffect(() => () => ctl.cancel(), [ctl]);
  return ctl.pointerDown;
}
