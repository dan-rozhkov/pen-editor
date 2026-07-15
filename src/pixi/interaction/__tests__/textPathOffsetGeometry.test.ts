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

describe("flip", () => {
  // `flip` reverses the points the handle walks (via `resolveTextPathDirection`)
  // but leaves `startOffset` itself unchanged, so `0` is always "the start of
  // wherever the text currently reads from" — see `textPathLayout.ts`.
  const FLIPPED: TextPath = { ...STRAIGHT, flip: true };

  it("places startOffset=0's handle at the path's END (100,0) — the visual start of the reversed/flipped text", () => {
    const pos = getStartOffsetHandleWorldPos(FLIPPED, { x: 0, y: 0 });
    expect(pos).toEqual({ x: 100, y: 0 });
  });

  it("moves the handle monotonically opposite to the unflipped direction as startOffset increases", () => {
    const at0 = getStartOffsetHandleWorldPos(FLIPPED, { x: 0, y: 0 })!;
    const at50 = getStartOffsetHandleWorldPos({ ...FLIPPED, startOffset: 0.5 }, { x: 0, y: 0 })!;
    const at100 = getStartOffsetHandleWorldPos({ ...FLIPPED, startOffset: 1 }, { x: 0, y: 0 })!;
    expect(at0.x).toBeCloseTo(100, 5);
    expect(at50.x).toBeCloseTo(50, 5);
    expect(at100.x).toBeCloseTo(0, 5);
  });

  it("offsetFromWorldPoint round-trips with getStartOffsetHandleWorldPos under flip (drag lands the handle under the cursor)", () => {
    for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
      const tp = { ...FLIPPED, startOffset: offset };
      const handlePos = getStartOffsetHandleWorldPos(tp, { x: 0, y: 0 })!;
      const roundTripped = offsetFromWorldPoint(tp, { x: 0, y: 0 }, handlePos.x, handlePos.y);
      expect(roundTripped).toBeCloseTo(offset, 5);
    }
  });
});
