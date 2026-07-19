import { beforeEach, describe, expect, it } from "vitest";
import { useViewportStore } from "@/store/viewportStore";
import type { SceneNode } from "@/types/scene";

function frame(overrides: Partial<SceneNode> = {}): SceneNode[] {
  return [
    {
      id: "F",
      type: "frame",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      children: [],
      ...overrides,
    } as SceneNode,
  ];
}

describe("viewportStore.fitToWidth", () => {
  beforeEach(() => {
    useViewportStore.setState({ scale: 1, x: 0, y: 0 });
  });

  it("scales to viewport width / frame width", () => {
    useViewportStore.getState().fitToWidth(frame({ width: 400 }), 800, 1000);
    expect(useViewportStore.getState().scale).toBeCloseTo(2, 5);
  });

  it("left-aligns the frame's left edge to screen x=0", () => {
    useViewportStore.getState().fitToWidth(frame({ x: 0, width: 400 }), 800, 1000);
    // scale 2, frame left edge (world x=0) should land at screen x=0
    expect(useViewportStore.getState().x).toBeCloseTo(0, 5);
  });

  it("left-aligns a frame with a non-zero x offset", () => {
    // scale = 800/400 = 2, frame's world left edge is x=50.
    useViewportStore.getState().fitToWidth(frame({ x: 50, width: 400 }), 800, 1000);
    const { scale, x } = useViewportStore.getState();
    expect(x).toBeCloseTo(-50 * scale, 5);
  });

  it("top-aligns when the scaled frame is shorter than the viewport", () => {
    // scale = 800/400 = 2, scaled height = 300*2 = 600 <= viewport height 1000
    // — a slide must ALWAYS be pinned to the top, never centered.
    useViewportStore.getState().fitToWidth(frame({ y: 0, height: 300 }), 800, 1000);
    const { y } = useViewportStore.getState();
    expect(y).toBeCloseTo(0, 5);
  });

  it("top-aligns a frame with a non-zero y offset", () => {
    useViewportStore.getState().fitToWidth(frame({ y: 100, height: 300 }), 800, 1000);
    const { scale, y } = useViewportStore.getState();
    expect(y).toBeCloseTo(-100 * scale, 5);
  });

  it("top-aligns when the scaled frame is taller than the viewport", () => {
    // scale = 800/400 = 2, scaled height = 4000*2 = 8000 > viewport height 1000
    useViewportStore.getState().fitToWidth(frame({ y: 0, height: 4000 }), 800, 1000);
    const { y } = useViewportStore.getState();
    // Frame top (world y=0) should land at screen y=0.
    expect(y).toBeCloseTo(0, 5);
  });

  it("clamps to MAX_SCALE for a very narrow frame", () => {
    useViewportStore.getState().fitToWidth(frame({ width: 1 }), 800, 1000);
    expect(useViewportStore.getState().scale).toBeLessThanOrEqual(20);
  });

  it("clamps to MIN_SCALE for a very wide frame", () => {
    useViewportStore.getState().fitToWidth(frame({ width: 100000 }), 800, 1000);
    expect(useViewportStore.getState().scale).toBeGreaterThanOrEqual(0.1);
  });

  it("still left-aligns when MAX_SCALE clamp binds (narrow frame)", () => {
    // rawScale = 1920 / 60 = 32, clamped to MAX_SCALE (20). A non-zero x
    // offset distinguishes left-align from the old centered-around-midpoint
    // behavior even though the clamp binds.
    useViewportStore.getState().fitToWidth(frame({ x: 100, width: 60 }), 1920, 1080);
    const { scale, x } = useViewportStore.getState();
    expect(scale).toBeCloseTo(20, 5);
    expect(x).toBeCloseTo(-100 * scale, 5);
  });

  it("still left-aligns when MIN_SCALE clamp binds (very wide frame)", () => {
    // rawScale = 800 / 100000 = 0.008, clamped to MIN_SCALE (0.1) — the
    // frame overflows the viewport, but its left edge must still land at
    // screen x=0 (top-left pin), never centered.
    useViewportStore.getState().fitToWidth(frame({ x: 0, width: 100000 }), 800, 1000);
    const { scale, x } = useViewportStore.getState();
    expect(scale).toBeCloseTo(0.1, 5);
    expect(x).toBeCloseTo(0, 5);
  });

  it("falls back to identity view for empty content", () => {
    useViewportStore.getState().fitToWidth([], 800, 1000);
    expect(useViewportStore.getState().scale).toBe(1);
    expect(useViewportStore.getState().x).toBe(400);
    expect(useViewportStore.getState().y).toBe(500);
  });

  it("does not change fitToContent's math (regression guard)", () => {
    useViewportStore.getState().fitToContent(frame({ width: 400, height: 300 }), 800, 1000);
    const { scale } = useViewportStore.getState();
    // fitToContent pads by 50 and uses min(scaleX, scaleY) — not equal to fitToWidth's scale.
    expect(scale).not.toBeCloseTo(2, 5);
  });
});
