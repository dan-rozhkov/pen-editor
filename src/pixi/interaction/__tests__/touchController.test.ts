import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTouchController, type MinimalTouchEvent, type TouchControllerDeps } from "../touchController";
import type { InteractionContext } from "../types";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findCanvasClickTargetAtPoint, findFrameLabelAtPoint } from "../hitTesting";
import { resetStores, seedScene } from "@/test/fixtures";

// findFrameLabelAtPoint measures label text via pixi's CanvasTextMetrics,
// which needs a real CanvasRenderingContext2D global happy-dom doesn't
// provide (see drawFrameNames.test.ts for the same workaround). Stub it
// deterministically (8px/char, matching src/test/setup.ts's fake 2D
// context) so label hit-testing is exercisable without PixiJS/WebGL.
vi.mock("@/pixi/frameLabelUtils", () => ({
  truncateLabelToWidth: (text: string) => text,
  measureLabelTextWidth: (text: string) => text.length * 8,
}));

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

function noopDeps(): TouchControllerDeps {
  return { onTap: () => {} };
}

/**
 * Real tap-select deps mirroring pixiInteractionCore's onTap wiring —
 * including the frame-label-first check (a frame's name label is drawn
 * above the node's own hit bounds, so a tap on it must select the frame
 * rather than fall through to empty space).
 */
function realDeps(): TouchControllerDeps {
  return {
    onTap: (world) => {
      const labelHitId = findFrameLabelAtPoint(world.x, world.y);
      if (labelHitId) {
        useSelectionStore.getState().select(labelHitId);
        return;
      }

      const hitTarget = findCanvasClickTargetAtPoint(world.x, world.y, {
        metaKey: false,
        ctrlKey: false,
        devModeActive: false,
      });
      if (!hitTarget) {
        useSelectionStore.getState().clearSelection();
      } else if (hitTarget.kind === "instance-descendant") {
        useSelectionStore.getState().selectDescendant(hitTarget.instanceId, hitTarget.descendantPath);
      } else {
        useSelectionStore.getState().select(hitTarget.nodeId);
      }
    },
  };
}

function touchEvent(
  points: Array<{ clientX: number; clientY: number }>,
  type?: string,
): MinimalTouchEvent {
  return { touches: points, preventDefault: () => {}, type };
}

beforeEach(() => {
  useViewportStore.setState({ scale: 1, x: 0, y: 0, isPanning: false });
});

describe("touchController — two-finger pan/pinch", () => {
  it("a single-finger touchstart never counts as a two-finger gesture", () => {
    const ctrl = createTouchController(makeContext(), noopDeps());
    const consumed = ctrl.handleTouchStart(touchEvent([{ clientX: 100, clientY: 100 }]));
    expect(consumed).toBe(false);
    expect(ctrl.isGesturing()).toBe(false);
  });

  it("pans by the midpoint delta of two fingers", () => {
    const ctrl = createTouchController(makeContext(), noopDeps());
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
    const ctrl = createTouchController(makeContext(), noopDeps());
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
    const ctrl = createTouchController(makeContext(), noopDeps());
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
    const ctrl = createTouchController(makeContext(), noopDeps());
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

describe("touchController — single-finger pan/tap", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("pans the viewport once movement passes the tap threshold", () => {
    const ctrl = createTouchController(makeContext(), noopDeps());
    ctrl.handleTouchStart(touchEvent([{ clientX: 100, clientY: 100 }]));
    expect(useViewportStore.getState().isPanning).toBe(false);

    // Still within the tap threshold — no pan yet.
    ctrl.handleTouchMove(touchEvent([{ clientX: 102, clientY: 101 }]));
    expect(useViewportStore.getState().isPanning).toBe(false);
    expect(useViewportStore.getState().x).toBe(0);

    // Past the threshold — pan engages.
    ctrl.handleTouchMove(touchEvent([{ clientX: 150, clientY: 140 }]));
    expect(useViewportStore.getState().isPanning).toBe(true);
    let vs = useViewportStore.getState();
    expect(vs.x).toBe(48); // 150 - 102
    expect(vs.y).toBe(39); // 140 - 101

    // Further movement pans by the incremental delta.
    ctrl.handleTouchMove(touchEvent([{ clientX: 160, clientY: 150 }]));
    vs = useViewportStore.getState();
    expect(vs.x).toBe(58);
    expect(vs.y).toBe(49);

    ctrl.handleTouchEnd(touchEvent([]));
    expect(useViewportStore.getState().isPanning).toBe(false);
  });

  it("does not pan on a sub-threshold tap and selects the node under the finger", () => {
    const onTap = vi.fn();
    const ctrl = createTouchController(makeContext(), { onTap });
    // rect2 "Floating" spans (600,100)-(800,200) in the fixture scene.
    ctrl.handleTouchStart(touchEvent([{ clientX: 650, clientY: 150 }]));
    ctrl.handleTouchMove(touchEvent([{ clientX: 652, clientY: 151 }]));
    expect(useViewportStore.getState().isPanning).toBe(false);
    expect(useViewportStore.getState().x).toBe(0);

    const consumed = ctrl.handleTouchEnd(touchEvent([]));
    expect(consumed).toBe(true);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 652, y: 151 });
  });

  it("selects the tapped node using the real hit-test/selection path", () => {
    const ctrl = createTouchController(makeContext(), realDeps());
    ctrl.handleTouchStart(touchEvent([{ clientX: 650, clientY: 150 }]));
    ctrl.handleTouchEnd(touchEvent([]));
    expect(useSelectionStore.getState().selectedIds).toEqual(["rect2"]);
  });

  it("clears selection on a tap over empty canvas", () => {
    useSelectionStore.getState().select("rect2");
    const ctrl = createTouchController(makeContext(), realDeps());
    ctrl.handleTouchStart(touchEvent([{ clientX: 5, clientY: 5 }]));
    ctrl.handleTouchEnd(touchEvent([]));
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it("does not select on touchcancel", () => {
    const onTap = vi.fn();
    const ctrl = createTouchController(makeContext(), { onTap });
    ctrl.handleTouchStart(touchEvent([{ clientX: 650, clientY: 150 }]));
    ctrl.handleTouchEnd(touchEvent([], "touchcancel"));
    expect(onTap).not.toHaveBeenCalled();
  });

  it("resets pan state on touchcancel mid-pan without treating it as a tap", () => {
    const onTap = vi.fn();
    const ctrl = createTouchController(makeContext(), { onTap });
    ctrl.handleTouchStart(touchEvent([{ clientX: 100, clientY: 100 }]));
    ctrl.handleTouchMove(touchEvent([{ clientX: 200, clientY: 200 }]));
    expect(useViewportStore.getState().isPanning).toBe(true);

    ctrl.handleTouchEnd(touchEvent([], "touchcancel"));
    expect(useViewportStore.getState().isPanning).toBe(false);
    expect(onTap).not.toHaveBeenCalled();
  });

  it("selects the frame when the tap lands on its name label, not empty space", () => {
    // frame1 "Screen" is at (100,100) 400x300 — its label is drawn above the
    // frame's own top edge, so a tap there must not fall through to a miss.
    const ctrl = createTouchController(makeContext(), realDeps());
    // Sanity check: the label really is outside the frame's own hit bounds.
    expect(findCanvasClickTargetAtPoint(120, 85, {
      metaKey: false,
      ctrlKey: false,
      devModeActive: false,
    })).toBeNull();
    expect(findFrameLabelAtPoint(120, 85)).toBe("frame1");

    ctrl.handleTouchStart(touchEvent([{ clientX: 120, clientY: 85 }]));
    ctrl.handleTouchEnd(touchEvent([]));
    expect(useSelectionStore.getState().selectedIds).toEqual(["frame1"]);
  });
});

describe("touchController — single-to-two-finger handoff", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("hands off a single-finger pan to the pinch gesture without a viewport jump", () => {
    const onTap = vi.fn();
    const ctrl = createTouchController(makeContext(), { onTap });
    ctrl.handleTouchStart(touchEvent([{ clientX: 100, clientY: 100 }]));
    ctrl.handleTouchMove(touchEvent([{ clientX: 140, clientY: 100 }]));
    expect(useViewportStore.getState().isPanning).toBe(true);
    const beforeHandoff = { ...useViewportStore.getState() };

    // Second finger lands — no jump: baseline is re-derived from live touches.
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 140, clientY: 100 },
        { clientX: 240, clientY: 100 },
      ]),
    );
    expect(ctrl.isGesturing()).toBe(true);
    expect(useViewportStore.getState().x).toBe(beforeHandoff.x);
    expect(useViewportStore.getState().y).toBe(beforeHandoff.y);
    expect(useViewportStore.getState().isPanning).toBe(true);

    // Pinch/pan now drives the viewport as usual.
    ctrl.handleTouchMove(
      touchEvent([
        { clientX: 150, clientY: 100 },
        { clientX: 250, clientY: 100 },
      ]),
    );
    expect(useViewportStore.getState().x).toBe(beforeHandoff.x + 10);

    // The now-single leftover finger doesn't resume single-finger pan logic.
    ctrl.handleTouchEnd(touchEvent([{ clientX: 250, clientY: 100 }]));
    expect(ctrl.isGesturing()).toBe(true);
    const beforeLift = { ...useViewportStore.getState() };
    ctrl.handleTouchMove(touchEvent([{ clientX: 300, clientY: 100 }]));
    expect(useViewportStore.getState().x).toBe(beforeLift.x);

    ctrl.handleTouchEnd(touchEvent([]));
    expect(ctrl.isGesturing()).toBe(false);
    expect(useViewportStore.getState().isPanning).toBe(false);
    // The finger that lifted last was carried over from the original
    // single-finger pan and then absorbed into the pinch — it must never
    // resolve as a tap once every finger is gone.
    expect(onTap).not.toHaveBeenCalled();
  });

  it("starts a fresh single-finger tap correctly after a full pinch release", () => {
    const onTap = vi.fn();
    const ctrl = createTouchController(makeContext(), { onTap });

    // A full two-finger pinch gesture, start to finish.
    ctrl.handleTouchStart(
      touchEvent([
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    ctrl.handleTouchMove(
      touchEvent([
        { clientX: 120, clientY: 100 },
        { clientX: 220, clientY: 100 },
      ]),
    );
    ctrl.handleTouchEnd(touchEvent([{ clientX: 220, clientY: 100 }]));
    ctrl.handleTouchEnd(touchEvent([]));
    expect(ctrl.isGesturing()).toBe(false);
    expect(useViewportStore.getState().isPanning).toBe(false);

    // A brand-new single-finger tap afterwards must behave normally: no
    // stray pan, and onTap fires once on lift.
    ctrl.handleTouchStart(touchEvent([{ clientX: 650, clientY: 150 }]));
    expect(useViewportStore.getState().isPanning).toBe(false);
    const consumed = ctrl.handleTouchEnd(touchEvent([]));
    expect(consumed).toBe(true);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ x: 650, y: 150 });
  });
});
