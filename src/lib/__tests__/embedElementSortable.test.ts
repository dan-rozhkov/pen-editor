import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildDropSlots,
  collectDropSlots,
  collectSortCandidates,
  isNoOpSlot,
  isSortable,
  pickDropSlot,
} from "../embedElementSortable";

// happy-dom never runs real layout, so `getBoundingClientRect()`/
// `getComputedStyle()` on a freshly-created element report all-zero/initial
// values — none of this module's logic (in-flow filtering, side-by-side
// detection, distance ranking) is exercisable against that. Every test here
// builds elements with STUBBED rects/computed styles instead, the same
// pattern `embedElementStyle.test.ts` uses for its zoom-related regression
// tests.

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function stubRect(el: Element, r: DOMRect): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(r);
}

// `let`, not `const`: `afterEach` below reassigns a fresh WeakMap rather than
// trying to clear this one — `WeakMap` has no `clear()`/iteration, so a
// fresh instance is the only way to drop every test's stubs between cases.
let computedStyles = new WeakMap<Element, Partial<CSSStyleDeclaration>>();

function stubComputed(el: Element, style: Partial<CSSStyleDeclaration>): void {
  computedStyles.set(el, { position: "static", display: "block", ...style });
}

let getComputedStyleSpy: ReturnType<typeof vi.spyOn> | undefined;

function installComputedStyleStub(): void {
  getComputedStyleSpy = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
    return (computedStyles.get(el) ?? { position: "static", display: "block" }) as CSSStyleDeclaration;
  });
}

// Parents created by `makeRow` below, so they (and the children stubbed onto
// them) can be detached from `document.body` again once a test is done —
// otherwise every test's tree piles up in the shared happy-dom `document`
// for the rest of the run.
const mountedParents: HTMLElement[] = [];

afterEach(() => {
  getComputedStyleSpy?.mockRestore();
  getComputedStyleSpy = undefined;
  for (const parent of mountedParents) parent.remove();
  mountedParents.length = 0;
  // `computedStyles` is shared by every test in this file — swap in a fresh
  // WeakMap so a later test that forgets to stub a child never silently
  // reads an earlier test's leftover computed style.
  computedStyles = new WeakMap();
});

/** Build a `<div class="parent"><div/>...</div>` tree, stub each child's
 * rect/computed style, and return the parent + children. */
function makeRow(
  specs: Array<{ rect: DOMRect; position?: string; display?: string }>,
): { parent: HTMLElement; children: HTMLElement[] } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  mountedParents.push(parent);
  const children = specs.map((spec) => {
    const child = document.createElement("div");
    parent.appendChild(child);
    stubRect(child, spec.rect);
    stubComputed(child, { position: spec.position ?? "static", display: spec.display ?? "block" });
    return child;
  });
  return { parent, children };
}

describe("isSortable", () => {
  it("is false for position: absolute — reordering it in the DOM wouldn't move it on screen", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20) },
    ]);
    const computed = { position: "absolute", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(children[0], computed)).toBe(false);
  });

  it("is false for position: fixed", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20) },
    ]);
    const computed = { position: "fixed", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(children[0], computed)).toBe(false);
  });

  it("is true for static/relative/sticky with at least one in-flow sibling", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20), position: "relative" },
      { rect: rect(0, 20, 100, 20), position: "sticky" },
    ]);
    const computed = { position: "relative", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(children[0], computed)).toBe(true);
  });

  it("is false when the parent has only one in-flow child (the element itself)", () => {
    installComputedStyleStub();
    const { children } = makeRow([{ rect: rect(0, 0, 100, 20) }]);
    const computed = { position: "static", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(children[0], computed)).toBe(false);
  });

  it("is false when the only other sibling is out-of-flow (absolute) — it doesn't count", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20), position: "absolute" },
    ]);
    const computed = { position: "static", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(children[0], computed)).toBe(false);
  });

  it("is false when the element has no parent", () => {
    installComputedStyleStub();
    const el = document.createElement("div");
    const computed = { position: "static", display: "block" } as CSSStyleDeclaration;
    expect(isSortable(el, computed)).toBe(false);
  });
});

describe("collectDropSlots: vertical list (stacked siblings)", () => {
  it("returns n+1 slots with horizontal-line indicators, and picks the nearest one", () => {
    installComputedStyleStub();
    // Dragging the middle item of a 3-item vertical stack.
    const { parent, children } = makeRow([
      { rect: rect(0, 0, 200, 40) },
      { rect: rect(0, 40, 200, 40) },
      { rect: rect(0, 80, 200, 40) },
    ]);
    stubComputed(parent, { position: "static", display: "block" });
    const dragged = children[1];

    const slots = collectDropSlots(dragged);
    // Candidates are the other two siblings (index 0 and 2) -> 3 slots.
    expect(slots).toHaveLength(3);

    // Slot 0: before the first candidate (top item) -> horizontal line
    // anchored at its top edge (y=0).
    expect(slots[0].before).toBe(children[0]);
    expect(slots[0].indicator.height).toBeLessThan(slots[0].indicator.width);
    expect(slots[0].y).toBeCloseTo(0, 5);

    // Slot 1: between the two candidates -> horizontal line straddling the gap.
    expect(slots[1].before).toBe(children[2]);

    // Slot 2 (last): before null -> insert at end, line anchored at the last
    // candidate's bottom edge (y=120).
    expect(slots[2].before).toBeNull();
    expect(slots[2].y).toBeCloseTo(120, 5);

    // Cursor near the very bottom should pick the trailing "end" slot.
    const picked = pickDropSlot(slots, 100, 130);
    expect(picked).toBe(slots[2]);

    // Cursor near the top should pick the first slot.
    const pickedTop = pickDropSlot(slots, 100, 2);
    expect(pickedTop).toBe(slots[0]);
  });
});

describe("collectDropSlots: horizontal row (side-by-side siblings)", () => {
  it("uses vertical-line indicators for a row layout", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 50, 50) },
      { rect: rect(50, 0, 50, 50) },
      { rect: rect(100, 0, 50, 50) },
    ]);
    const dragged = children[1];

    const slots = collectDropSlots(dragged);
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.indicator.width).toBeLessThan(slot.indicator.height);
    }

    // Slot between the two candidates sits at the midpoint of the gap between
    // them (children[0]'s right edge at 50, children[2]'s left edge at 100 ->
    // midpoint 75 — this is where the dragged element currently sits).
    const middleSlot = slots.find((s) => s.before === children[2])!;
    expect(middleSlot.indicator.left + middleSlot.indicator.width / 2).toBeCloseTo(75, 5);
  });
});

describe("collectDropSlots: excludes out-of-flow and hidden siblings", () => {
  it("skips an absolutely-positioned sibling entirely", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20), position: "absolute" },
      { rect: rect(0, 40, 100, 20) },
    ]);
    const dragged = children[0];

    const slots = collectDropSlots(dragged);
    // Only children[2] is a valid candidate -> 2 slots (before it, and at the end).
    expect(slots).toHaveLength(2);
    expect(slots.some((s) => s.before === children[1])).toBe(false);
  });

  it("skips a display:none sibling entirely", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20), display: "none" },
      { rect: rect(0, 40, 100, 20) },
    ]);
    const dragged = children[0];

    const slots = collectDropSlots(dragged);
    expect(slots).toHaveLength(2);
    expect(slots.some((s) => s.before === children[1])).toBe(false);
  });

  it("returns [] when the element itself isn't sortable", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20), position: "absolute" },
      { rect: rect(0, 20, 100, 20) },
    ]);
    expect(collectDropSlots(children[0])).toEqual([]);
  });

  it("returns [] when there is no reorderable sibling", () => {
    installComputedStyleStub();
    const { children } = makeRow([{ rect: rect(0, 0, 100, 20) }]);
    expect(collectDropSlots(children[0])).toEqual([]);
  });
});

describe("pickDropSlot", () => {
  it("returns null for an empty slot list", () => {
    expect(pickDropSlot([], 0, 0)).toBeNull();
  });

  it("picks the slot with the minimum Euclidean distance, not just the closest axis", () => {
    const slots = [
      { index: 0, before: null, indicator: { left: 0, top: 0, width: 2, height: 10 }, x: 1, y: 5 },
      { index: 1, before: null, indicator: { left: 100, top: 0, width: 2, height: 10 }, x: 101, y: 5 },
    ];
    expect(pickDropSlot(slots, 90, 5)).toBe(slots[1]);
    expect(pickDropSlot(slots, 10, 5)).toBe(slots[0]);
  });

  it("keeps the earlier slot on an exact tie", () => {
    const slots = [
      { index: 0, before: null, indicator: { left: 0, top: 0, width: 2, height: 10 }, x: 0, y: 0 },
      { index: 1, before: null, indicator: { left: 10, top: 0, width: 2, height: 10 }, x: 10, y: 0 },
    ];
    expect(pickDropSlot(slots, 5, 0)).toBe(slots[0]);
  });
});

describe("isNoOpSlot", () => {
  it("is true when the slot's `before` is the element's current next sibling", () => {
    const parent = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");
    parent.append(a, b, c);

    expect(isNoOpSlot(a, { index: 0, before: b, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 })).toBe(
      true,
    );
    expect(isNoOpSlot(a, { index: 0, before: c, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 })).toBe(
      false,
    );
  });

  it("is true for the trailing 'end' slot when the element is already last", () => {
    const parent = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    parent.append(a, b);

    expect(
      isNoOpSlot(b, { index: 1, before: null, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 }),
    ).toBe(true);
    expect(
      isNoOpSlot(a, { index: 1, before: null, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 }),
    ).toBe(false);
  });

  // Code-review finding #2: candidates (and therefore `slot.before`) always
  // skip out-of-flow siblings, but the OLD `isNoOpSlot` compared against the
  // raw `el.nextElementSibling` — so with `[A, el, X(absolute), B]`, a drop
  // "before B" looked like a real move (raw next sibling is X, not B) even
  // though nothing on screen changes: X isn't part of the visual flow at
  // all. Must compare against the next IN-FLOW sibling instead.
  it("treats a drop 'before' the next in-flow sibling as a no-op even when an out-of-flow sibling sits directly after the element", () => {
    installComputedStyleStub();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    mountedParents.push(parent);
    const a = document.createElement("div");
    const el = document.createElement("div");
    const x = document.createElement("div"); // out-of-flow, sits right after `el`
    const b = document.createElement("div");
    parent.append(a, el, x, b);
    stubComputed(a, {});
    stubComputed(el, {});
    stubComputed(x, { position: "absolute" });
    stubComputed(b, {});

    // Dropping "before b" is a no-op: `el`'s next IN-FLOW sibling is already
    // `b` (skipping the out-of-flow `x`), so nothing would visually move.
    expect(
      isNoOpSlot(el, { index: 0, before: b, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 }),
    ).toBe(true);

    // Dropping "before a" (moving `el` earlier) is a real move.
    expect(
      isNoOpSlot(el, { index: 0, before: a, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 }),
    ).toBe(false);
  });

  it("treats the trailing 'end' slot as a no-op when only an out-of-flow sibling follows the element", () => {
    installComputedStyleStub();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    mountedParents.push(parent);
    const a = document.createElement("div");
    const el = document.createElement("div");
    const x = document.createElement("div"); // trailing out-of-flow sibling
    parent.append(a, el, x);
    stubComputed(a, {});
    stubComputed(el, {});
    stubComputed(x, { position: "absolute" });

    // No in-flow sibling comes after `el` — the trailing slot is a no-op
    // even though `el.nextElementSibling` (the out-of-flow `x`) is not null.
    expect(
      isNoOpSlot(el, { index: 0, before: null, indicator: { left: 0, top: 0, width: 0, height: 0 }, x: 0, y: 0 }),
    ).toBe(true);
  });
});

describe("collectSortCandidates / buildDropSlots split", () => {
  it("collectSortCandidates returns the same in-flow filtering collectDropSlots used to do inline", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20), position: "absolute" },
      { rect: rect(0, 40, 100, 20) },
    ]);
    const dragged = children[0];

    const candidates = collectSortCandidates(dragged);
    expect(candidates).toEqual([children[2]]);
  });

  it("returns null (not []) when the element isn't sortable", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20), position: "absolute" },
      { rect: rect(0, 20, 100, 20) },
    ]);
    expect(collectSortCandidates(children[0])).toBeNull();
  });

  it("buildDropSlots produces slots matching collectDropSlots for the same candidates/rect", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 200, 40) },
      { rect: rect(0, 40, 200, 40) },
      { rect: rect(0, 80, 200, 40) },
    ]);
    const dragged = children[1];
    const candidates = collectSortCandidates(dragged)!;
    const elRect = dragged.getBoundingClientRect();

    const viaSplit = buildDropSlots(candidates, elRect);
    const viaWrapper = collectDropSlots(dragged);
    expect(viaSplit).toEqual(viaWrapper);
  });

  // Code-review finding #1 (unit-level half): `buildDropSlots` must reflect
  // whatever rects the candidates report RIGHT NOW, not whatever they
  // reported when `candidates` was first collected — the drag gesture relies
  // on this to stay correct through a mid-drag zoom/pan/reflow (see
  // `EmbedLayer.elementPicker.test.tsx`'s integration-level test of the same
  // finding). Simulates that by mutating a sibling's rect between two
  // `buildDropSlots` calls over the SAME `candidates` array.
  it("rebuilds slots (and picks a different one) when a candidate's rect changes between calls, given the same candidates array", () => {
    installComputedStyleStub();
    const { children } = makeRow([
      { rect: rect(0, 0, 100, 20) },
      { rect: rect(0, 20, 100, 20) }, // dragged
      { rect: rect(0, 40, 100, 20) },
    ]);
    const dragged = children[1];
    const candidates = collectSortCandidates(dragged)!; // [children[0], children[2]]
    const elRect = dragged.getBoundingClientRect();

    const slotsBefore = buildDropSlots(candidates, elRect);
    const pickedBefore = pickDropSlot(slotsBefore, 100, 30); // between item0 and item2

    // Relocate the second candidate (children[2]) far away — same
    // `candidates` array, only its LIVE rect changed.
    stubRect(children[2], rect(0, 400, 100, 20));

    const slotsAfter = buildDropSlots(candidates, elRect);
    const pickedAfter = pickDropSlot(slotsAfter, 100, 30);

    expect(pickedAfter).not.toEqual(pickedBefore);
  });
});
