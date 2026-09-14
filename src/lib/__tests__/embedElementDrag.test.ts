import { describe, it, expect } from "vitest";
import { captureDragBase, computeDragStyles } from "../embedElementDrag";

/** happy-dom never runs layout: `getComputedStyle` returns "" for anything
 * not set inline, and `offsetLeft`/`offsetWidth` are always 0. Build a fake
 * `CSSStyleDeclaration`-shaped object and stub the offset properties
 * explicitly, as instructed, rather than relying on real layout. */
function fakeComputed(props: Partial<CSSStyleDeclaration>): CSSStyleDeclaration {
  return {
    position: "static",
    left: "auto",
    top: "auto",
    right: "auto",
    bottom: "auto",
    ...props,
  } as CSSStyleDeclaration;
}

function elWithOffset(
  offsetLeft: number,
  offsetTop: number,
  offsetWidth = 0,
  offsetHeight = 0,
): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetLeft", { value: offsetLeft, configurable: true });
  Object.defineProperty(el, "offsetTop", { value: offsetTop, configurable: true });
  Object.defineProperty(el, "offsetWidth", { value: offsetWidth, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: offsetHeight, configurable: true });
  return el;
}

describe("captureDragBase", () => {
  it("absolute element with explicit left/top uses the computed values", () => {
    const el = elWithOffset(0, 0);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "absolute", left: "10px", top: "20px" }),
    );
    expect(base).toEqual({
      mode: "offset",
      position: "absolute",
      left: 10,
      top: 20,
      pinRight: false,
      pinBottom: false,
    });
  });

  it("absolute element with auto left/top falls back to the offset box", () => {
    const el = elWithOffset(40, 60);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "absolute", left: "auto", top: "auto" }),
    );
    expect(base.left).toBe(40);
    expect(base.top).toBe(60);
    expect(base.position).toBe("absolute");
  });

  it("absolute element with non-auto right/bottom pins them for the drag", () => {
    const el = elWithOffset(0, 0);
    const base = captureDragBase(
      el,
      fakeComputed({
        position: "absolute",
        left: "10px",
        top: "20px",
        right: "5px",
        bottom: "8px",
      }),
    );
    expect(base.pinRight).toBe(true);
    expect(base.pinBottom).toBe(true);
  });

  it("static element is promoted to relative with a zero base offset", () => {
    const el = elWithOffset(999, 999); // offset box irrelevant for static
    const base = captureDragBase(el, fakeComputed({ position: "static" }));
    expect(base).toEqual({
      mode: "offset",
      position: "relative",
      left: 0,
      top: 0,
      pinRight: false,
      pinBottom: false,
    });
  });

  it("relative element with an already-set left/top uses it as the base", () => {
    const el = elWithOffset(0, 0);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "relative", left: "15px", top: "-3px" }),
    );
    expect(base.position).toBe("relative");
    expect(base.left).toBe(15);
    expect(base.top).toBe(-3);
  });

  // Finding #3: `position: sticky`'s left/top/right/bottom are stick
  // THRESHOLDS, not an offset — writing them wouldn't move the element and
  // would silently change its scroll-stick behavior. Sticky must be dragged
  // by margin instead, with `position` left untouched.
  it("sticky element captures a margin-mode base instead of an offset base", () => {
    const el = elWithOffset(0, 0);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "sticky", top: "0px", marginLeft: "4px", marginTop: "8px" }),
    );
    expect(base).toEqual({
      mode: "margin",
      position: "sticky",
      left: 4,
      top: 8,
      pinRight: false,
      pinBottom: false,
    });
  });

  it("sticky element with auto margin falls back to a zero base", () => {
    const el = elWithOffset(0, 0);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "sticky", marginLeft: "auto", marginTop: "auto" }),
    );
    expect(base.left).toBe(0);
    expect(base.top).toBe(0);
  });

  // Finding #4: `left:0; right:0` (or `bottom:0`) stretches an absolute/fixed
  // element to its container — pinning `right`/`bottom` to `auto` alone
  // would let it instantly collapse to its content width/height. The base
  // must also capture the element's current layout box so the drag can pin
  // an explicit width/height alongside `right`/`bottom: auto`.
  it("captures pinnedWidth from offsetWidth when right is pinned", () => {
    const el = elWithOffset(0, 0, 320, 48);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "absolute", left: "0px", top: "0px", right: "0px" }),
    );
    expect(base.pinRight).toBe(true);
    expect(base.pinnedWidth).toBe(320);
  });

  it("captures pinnedHeight from offsetHeight when bottom is pinned", () => {
    const el = elWithOffset(0, 0, 320, 48);
    const base = captureDragBase(
      el,
      fakeComputed({ position: "absolute", left: "0px", top: "0px", bottom: "0px" }),
    );
    expect(base.pinBottom).toBe(true);
    expect(base.pinnedHeight).toBe(48);
  });
});

describe("computeDragStyles", () => {
  it("returns the base position/left/top unchanged for a zero delta", () => {
    const base = captureDragBase(
      elWithOffset(0, 0),
      fakeComputed({ position: "absolute", left: "10px", top: "20px" }),
    );
    expect(computeDragStyles(base, 0, 0)).toEqual({
      position: "absolute",
      left: "10px",
      top: "20px",
    });
  });

  it("adds dx/dy to the base for an absolute element", () => {
    const base = captureDragBase(
      elWithOffset(0, 0),
      fakeComputed({ position: "absolute", left: "10px", top: "20px" }),
    );
    expect(computeDragStyles(base, 5, -8)).toEqual({
      position: "absolute",
      left: "15px",
      top: "12px",
    });
  });

  it("pins right/bottom to auto, plus the captured width/height, when the base had them set", () => {
    const base = captureDragBase(
      elWithOffset(0, 0, 320, 48),
      fakeComputed({
        position: "absolute",
        left: "10px",
        top: "20px",
        right: "5px",
        bottom: "8px",
      }),
    );
    expect(computeDragStyles(base, 1, 1)).toEqual({
      position: "absolute",
      left: "11px",
      top: "21px",
      right: "auto",
      bottom: "auto",
      width: "320px",
      height: "48px",
    });
  });

  it("margin-mode (sticky) base produces only margin-left/margin-top, never position/left/top", () => {
    const base = captureDragBase(
      elWithOffset(0, 0),
      fakeComputed({ position: "sticky", top: "0px", marginLeft: "4px", marginTop: "8px" }),
    );
    expect(computeDragStyles(base, 6, -2)).toEqual({
      "margin-left": "10px",
      "margin-top": "6px",
    });
  });

  it("promotes a static element to relative with an explicit offset", () => {
    const base = captureDragBase(elWithOffset(0, 0), fakeComputed({ position: "static" }));
    expect(computeDragStyles(base, 12, 4)).toEqual({
      position: "relative",
      left: "12px",
      top: "4px",
    });
  });

  it("never drifts: two calls against the same base with different deltas both measure from the base", () => {
    const base = captureDragBase(
      elWithOffset(0, 0),
      fakeComputed({ position: "absolute", left: "10px", top: "20px" }),
    );
    const first = computeDragStyles(base, 5, 5);
    const second = computeDragStyles(base, 30, -10);
    expect(first).toEqual({ position: "absolute", left: "15px", top: "25px" });
    expect(second).toEqual({ position: "absolute", left: "40px", top: "10px" });
  });
});
