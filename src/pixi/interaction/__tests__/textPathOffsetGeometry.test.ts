import { describe, it, expect } from "vitest";
import {
  getStartOffsetHandleWorldPos,
  hitTestStartOffsetHandle,
  offsetFromWorldPoint,
  type TextPath,
} from "../textPathOffsetGeometry";

const STRAIGHT: TextPath = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  closed: false,
  startOffset: 0,
  side: "left",
};

describe("getStartOffsetHandleWorldPos", () => {
  it("places the handle at startOffset=0 at the path's start", () => {
    const pos = getStartOffsetHandleWorldPos(STRAIGHT, { x: 400, y: 300 });
    expect(pos).toEqual({ x: 400, y: 300 });
  });

  it("places the handle at the fractional arc-length position", () => {
    const tp: TextPath = { ...STRAIGHT, startOffset: 0.25 };
    const pos = getStartOffsetHandleWorldPos(tp, { x: 0, y: 0 });
    expect(pos!.x).toBeCloseTo(25, 1);
    expect(pos!.y).toBeCloseTo(0, 6);
  });

  it("clamps an out-of-range startOffset", () => {
    const tp: TextPath = { ...STRAIGHT, startOffset: 1.5 };
    const pos = getStartOffsetHandleWorldPos(tp, { x: 0, y: 0 });
    expect(pos).toEqual({ x: 100, y: 0 });
  });

  it("returns null for an empty path", () => {
    const tp: TextPath = { ...STRAIGHT, points: [] };
    expect(getStartOffsetHandleWorldPos(tp, { x: 0, y: 0 })).toBeNull();
  });
});

describe("hitTestStartOffsetHandle", () => {
  it("hits within radius, misses outside it", () => {
    const tp: TextPath = { ...STRAIGHT, startOffset: 0.5 };
    // Handle sits at world (50, 0).
    expect(hitTestStartOffsetHandle(tp, { x: 0, y: 0 }, 52, 0, 5)).toBe(true);
    expect(hitTestStartOffsetHandle(tp, { x: 0, y: 0 }, 60, 0, 5)).toBe(false);
  });

  it("misses when the path is empty", () => {
    const tp: TextPath = { ...STRAIGHT, points: [] };
    expect(hitTestStartOffsetHandle(tp, { x: 0, y: 0 }, 0, 0, 100)).toBe(false);
  });
});

describe("offsetFromWorldPoint", () => {
  it("projects a world point onto the curve and returns its 0..1 fraction", () => {
    const offset = offsetFromWorldPoint(STRAIGHT, { x: 0, y: 0 }, 25, 0);
    expect(offset).toBeCloseTo(0.25, 3);
  });

  it("clamps to [0,1] for a point beyond either end", () => {
    expect(offsetFromWorldPoint(STRAIGHT, { x: 0, y: 0 }, -50, 0)).toBeCloseTo(0, 3);
    expect(offsetFromWorldPoint(STRAIGHT, { x: 0, y: 0 }, 500, 0)).toBeCloseTo(1, 3);
  });

  it("accounts for absPos (world -> local conversion)", () => {
    const offset = offsetFromWorldPoint(STRAIGHT, { x: 1000, y: 1000 }, 1025, 1000);
    expect(offset).toBeCloseTo(0.25, 3);
  });

  it("returns the current (clamped) offset unchanged for a zero-length path", () => {
    const tp: TextPath = { ...STRAIGHT, points: [{ x: 5, y: 5 }], startOffset: 0.5 };
    expect(offsetFromWorldPoint(tp, { x: 0, y: 0 }, 999, 999)).toBe(0.5);
  });
});
