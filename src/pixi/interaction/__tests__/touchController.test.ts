import { describe, it, expect, beforeEach } from "vitest";
import { createTouchController, type MinimalTouchEvent } from "../touchController";
import type { InteractionContext } from "../types";
import { useViewportStore } from "@/store/viewportStore";

// A fake canvas whose bounding rect is the origin, so client coords == canvas coords.
function makeContext(): InteractionContext {
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    screenToWorld: (x, y) => ({ x, y }),
    isSpaceHeld: () => false,
  };
}

function touchEvent(points: Array<{ clientX: number; clientY: number }>): MinimalTouchEvent {
  return { touches: points, preventDefault: () => {} };
}

beforeEach(() => {
  useViewportStore.setState({ scale: 1, x: 0, y: 0, isPanning: false });
});

describe("touchController", () => {
  it("ignores a single-finger touch (lets it fall through to drag/select)", () => {
    const ctrl = createTouchController(makeContext());
    const consumed = ctrl.handleTouchStart(touchEvent([{ clientX: 100, clientY: 100 }]));
    expect(consumed).toBe(false);
    expect(ctrl.isGesturing()).toBe(false);
  });

  it("pans by the midpoint delta of two fingers", () => {
    const ctrl = createTouchController(makeContext());
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    expect(ctrl.isGesturing()).toBe(true);
    expect(useViewportStore.getState().isPanning).toBe(true);

    // Move both fingers right by 50 and down by 30 (separation unchanged → no zoom).
    ctrl.handleTouchMove(
      touchEvent([
        { clientX: 150, clientY: 130 },
        { clientX: 250, clientY: 130 },
      ]),
    );

    const vs = useViewportStore.getState();
    expect(vs.x).toBe(50);
    expect(vs.y).toBe(30);
    expect(vs.scale).toBe(1);
  });

  it("zooms in when the fingers spread apart, anchored at the midpoint", () => {
    const ctrl = createTouchController(makeContext());
    // Midpoint at (150,100), separation 100.
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    // Spread to separation 200 around the same midpoint → 2x zoom.
    ctrl.handleTouchMove(
      touchEvent([
        { clientX: 50, clientY: 100 },
        { clientX: 250, clientY: 100 },
      ]),
    );

    const vs = useViewportStore.getState();
    expect(vs.scale).toBeCloseTo(2, 5);
    // The world point under the midpoint (150,100) must stay put: world was
    // (150,100) at scale 1, so newX = 150 - 150*2 = -150, newY = 100 - 100*2 = -100.
    expect(vs.x).toBeCloseTo(-150, 5);
    expect(vs.y).toBeCloseTo(-100, 5);
  });

  it("keeps consuming until every finger lifts, then releases", () => {
    const ctrl = createTouchController(makeContext());
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    // One finger lifts — still consuming so the leftover finger can't drag.
    ctrl.handleTouchEnd(touchEvent([{ clientX: 200, clientY: 100 }]));
    expect(ctrl.isGesturing()).toBe(true);

    // Last finger lifts — gesture ends.
    ctrl.handleTouchEnd(touchEvent([]));
    expect(ctrl.isGesturing()).toBe(false);
    expect(useViewportStore.getState().isPanning).toBe(false);
  });

  it("re-baselines when dropping from three to two fingers (no jump)", () => {
    const ctrl = createTouchController(makeContext());
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
        { clientX: 300, clientY: 100 },
      ]),
    );
    const before = { ...useViewportStore.getState() };
    // Third finger lifts; the two remaining are at new positions. Because end
    // re-baselines, no pan/zoom is applied on this event.
    ctrl.handleTouchEnd(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    const after = useViewportStore.getState();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.scale).toBe(before.scale);
  });
});
