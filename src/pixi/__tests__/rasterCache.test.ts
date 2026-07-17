import { describe, it, expect } from "vitest";
import { computeRasterCacheDecisions, resolutionBucketFor, QUIET_MS, type RasterCacheInput } from "../rasterCache";

const base = (): RasterCacheInput => ({
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

  // Bug 2 (field report): resolution bucket must derive from EFFECTIVE scale
  // (CSS scale * devicePixelRatio), not CSS scale alone — otherwise a HiDPI
  // display renders a bucket-1 cache at half the pixels it actually needs,
  // and zooming within the same CSS-scale bucket never fixes it.
  it("buckets from effective scale (scale * devicePixelRatio), not CSS scale alone", () => {
    const input = base();
    input.scale = 1;
    input.pixelRatio = 2;
    const d = computeRasterCacheDecisions(input);
    expect(d.toCache).toEqual([
      { id: "f1", resolutionBucket: 2 },
      { id: "f2", resolutionBucket: 2 },
    ]);
  });

  it("defaults pixelRatio to 1 when omitted (back-compat with CSS-scale-only callers)", () => {
    const d = computeRasterCacheDecisions(base());
    expect(d.toCache).toEqual([
      { id: "f1", resolutionBucket: 1 },
      { id: "f2", resolutionBucket: 1 },
    ]);
  });
});
