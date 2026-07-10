import { describe, expect, it } from "vitest";
import { clampPositionToViewport, computeDragPosition } from "@/components/ui/popoverDrag";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 100 };

describe("clampPositionToViewport", () => {
  it("passes an in-bounds position through unchanged", () => {
    expect(clampPositionToViewport({ x: 300, y: 200 }, size, viewport)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("clamps a negative x/y to 0", () => {
    expect(clampPositionToViewport({ x: -50, y: -20 }, size, viewport)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("clamps so the box's right/bottom edge stays inside the viewport", () => {
    // 1000 - 200 = 800 max x; 800 - 100 = 700 max y
    expect(clampPositionToViewport({ x: 950, y: 750 }, size, viewport)).toEqual({
      x: 800,
      y: 700,
    });
  });

  it("pins to 0 (rather than negative) when the box is larger than the viewport", () => {
    const hugeSize = { width: 1200, height: 900 };
    expect(clampPositionToViewport({ x: 500, y: 500 }, hugeSize, viewport)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("computeDragPosition", () => {
  const origin = { pointer: { x: 100, y: 100 }, position: { x: 300, y: 200 } };

  it("shifts the position by the pointer delta", () => {
    expect(computeDragPosition(origin, { x: 140, y: 150 }, size, viewport)).toEqual({
      x: 340,
      y: 250,
    });
  });

  it("returns the origin position unchanged for a zero delta", () => {
    expect(computeDragPosition(origin, { x: 100, y: 100 }, size, viewport)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("clamps the dragged position to the viewport", () => {
    // Dragging far right/down should clamp to the max in-bounds position.
    expect(computeDragPosition(origin, { x: 5000, y: 5000 }, size, viewport)).toEqual({
      x: 800,
      y: 700,
    });
  });

  it("clamps the dragged position when dragged past the top-left edge", () => {
    expect(computeDragPosition(origin, { x: -5000, y: -5000 }, size, viewport)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
