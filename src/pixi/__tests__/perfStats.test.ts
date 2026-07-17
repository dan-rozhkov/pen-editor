import { describe, it, expect } from "vitest";
import { perfStats } from "../perfStats";

describe("perfStats", () => {
  it("aggregates timings per label and resets", () => {
    perfStats.reset();
    const out = perfStats.time("flush", () => 42);
    expect(out).toBe(42);
    perfStats.time("flush", () => 0);
    const s = perfStats.summary();
    expect(s.flush.count).toBe(2);
    expect(s.flush.totalMs).toBeGreaterThanOrEqual(0);
    expect(s.flush.maxMs).toBeGreaterThanOrEqual(0);
    perfStats.reset();
    expect(perfStats.summary()).toEqual({});
  });
});
