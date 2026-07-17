import { describe, it, expect } from "vitest";
import { computeRasterCacheDecisions, resolutionBucketFor, QUIET_MS } from "../rasterCache";

const base = () => ({
  topLevelFrameIds: ["f1", "f2"],
  frameSubtreeDirtyAt: new Map([["f1", 0], ["f2", 0]]),
  cachedFrames: new Map(),
  hotFrameIds: new Set<string>(),
  framePixelSize: new Map([["f1", { width: 1440, height: 900 }], ["f2", { width: 1440, height: 900 }]]),
  scale: 1,
  now: QUIET_MS + 1,
});

describe("computeRasterCacheDecisions", () => {
  it("caches quiet, cold, size-ok frames at the current bucket", () => {
    const d = computeRasterCacheDecisions(base());
    expect(d.toCache).toEqual([{ id: "f1", resolutionBucket: 1 }, { id: "f2", resolutionBucket: 1 }]);
    expect(d.toUncache).toEqual([]);
  });

  it("never caches hot or recently-dirty frames; uncaches a cached frame that got dirty", () => {
    const input = base();
    input.hotFrameIds.add("f1");
    input.frameSubtreeDirtyAt.set("f2", input.now - 10);
    input.cachedFrames.set("f2", { resolutionBucket: 1 });
    const d = computeRasterCacheDecisions(input);
    expect(d.toCache).toEqual([]);
    expect(d.toUncache).toEqual(["f2"]);
  });

  it("uncaches on zoom bucket change and respects the texture limit", () => {
    const input = base();
    input.cachedFrames.set("f1", { resolutionBucket: 1 });
    input.scale = 3; // bucket 4
    input.framePixelSize.set("f2", { width: 6000, height: 900 });
    const d = computeRasterCacheDecisions(input);
    expect(d.toUncache).toContain("f1");
    expect(d.toCache.find((c) => c.id === "f2")).toBeUndefined();
    expect(resolutionBucketFor(3)).toBe(4);
  });

  it("uncaches a cached frame that is missing from framePixelSize", () => {
    const input = base();
    input.cachedFrames.set("f1", { resolutionBucket: 1 });
    input.framePixelSize.delete("f1");
    const d = computeRasterCacheDecisions(input);
    expect(d.toUncache).toContain("f1");
    expect(d.toCache.find((c) => c.id === "f1")).toBeUndefined();
  });
});
