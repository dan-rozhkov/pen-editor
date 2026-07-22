import { describe, it, expect } from "vitest";
import { createDoubleClickDetector } from "@/pixi/interaction/doubleClickDetector";

const DEFAULT_OPTIONS = { timeThresholdMs: 500, distanceThreshold: 5 };

describe("createDoubleClickDetector", () => {
  it("fires on the 2nd click of a pair at the same spot within the time window", () => {
    const detector = createDoubleClickDetector(DEFAULT_OPTIONS);

    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false);
    expect(detector.registerClick({ x: 102, y: 98, time: 150 })).toBe(true);
  });

  it("fires again on a rapid 4-click train (regression: native dblclick only fires once)", () => {
    const detector = createDoubleClickDetector(DEFAULT_OPTIONS);

    // Click train: 1,2,3,4 in rapid succession at the same spot.
    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false); // click 1
    expect(detector.registerClick({ x: 100, y: 100, time: 100 })).toBe(true); // click 2 -> pair
    expect(detector.registerClick({ x: 100, y: 100, time: 200 })).toBe(false); // click 3 -> new first click
    expect(detector.registerClick({ x: 100, y: 100, time: 300 })).toBe(true); // click 4 -> pair
  });

  it("keeps firing on every pair of a 6-click train", () => {
    const detector = createDoubleClickDetector(DEFAULT_OPTIONS);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(detector.registerClick({ x: 100, y: 100, time: i * 100 }));
    }
    expect(results).toEqual([false, true, false, true, false, true]);
  });

  it("does not fire when clicks are too far apart in time", () => {
    const detector = createDoubleClickDetector({ timeThresholdMs: 400, distanceThreshold: 5 });

    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false);
    expect(detector.registerClick({ x: 100, y: 100, time: 401 })).toBe(false);
  });

  it("does not fire when clicks are too far apart in space", () => {
    const detector = createDoubleClickDetector({ timeThresholdMs: 500, distanceThreshold: 5 });

    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false);
    expect(detector.registerClick({ x: 106, y: 100, time: 100 })).toBe(false);
  });

  it("resets after firing so the next click starts a fresh pair", () => {
    const detector = createDoubleClickDetector(DEFAULT_OPTIONS);

    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false);
    expect(detector.registerClick({ x: 100, y: 100, time: 100 })).toBe(true);
    // Immediately after firing, a lone click must not itself be treated as
    // completing a (stale) pair.
    expect(detector.registerClick({ x: 100, y: 100, time: 150 })).toBe(false);
  });

  it("reset() discards a pending first click", () => {
    const detector = createDoubleClickDetector(DEFAULT_OPTIONS);

    expect(detector.registerClick({ x: 100, y: 100, time: 0 })).toBe(false);
    detector.reset();
    expect(detector.registerClick({ x: 100, y: 100, time: 100 })).toBe(false);
  });
});
