import { describe, it, expect } from "vitest";
import { generateNoisePixels, noiseCellCounts, hashSeed } from "@/lib/noise/generateNoise";
import { createNoiseEffect } from "@/utils/fillUtils";

describe("generateNoisePixels", () => {
  it("is deterministic for the same seed and differs across seeds", () => {
    const e = createNoiseEffect({ density: 0.5 });
    const a = generateNoisePixels(e, 32, 32, 42);
    const b = generateNoisePixels(e, 32, 32, 42);
    const c = generateNoisePixels(e, 32, 32, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("respects density statistically", () => {
    const e = createNoiseEffect({ density: 0.25, color: "#000000ff" });
    const px = generateNoisePixels(e, 100, 100, 1);
    let painted = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) painted++;
    expect(painted / 10000).toBeGreaterThan(0.2);
    expect(painted / 10000).toBeLessThan(0.3);
  });
  it("mono paints only the base color with its alpha", () => {
    const e = createNoiseEffect({ density: 1, color: "#ff000080" });
    const px = generateNoisePixels(e, 4, 4, 1);
    expect(px[0]).toBe(255); expect(px[1]).toBe(0); expect(px[2]).toBe(0); expect(px[3]).toBe(128);
  });
  it("duo mixes base and secondary colors", () => {
    const e = createNoiseEffect({ noiseType: "duo", density: 1, color: "#ff0000ff", secondaryColor: "#0000ffff" });
    const px = generateNoisePixels(e, 32, 32, 7);
    let red = 0, blue = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] === 255) red++; if (px[i + 2] === 255) blue++; }
    expect(red).toBeGreaterThan(0);
    expect(blue).toBeGreaterThan(0);
  });
  it("multi paints varied colors at the given opacity", () => {
    const e = createNoiseEffect({ noiseType: "multi", density: 1, opacity: 0.5 });
    const px = generateNoisePixels(e, 16, 16, 3);
    expect(px[3]).toBe(128);
    const first = [px[0], px[1], px[2]].join(",");
    let varied = false;
    for (let i = 4; i < px.length; i += 4) if ([px[i], px[i + 1], px[i + 2]].join(",") !== first) varied = true;
    expect(varied).toBe(true);
  });
});

describe("noiseCellCounts", () => {
  it("derives cell counts from noiseSize / noiseSizeY and clamps", () => {
    const e = createNoiseEffect({ noiseSize: 2, noiseSizeY: 4 });
    expect(noiseCellCounts(e, 200, 200)).toEqual({ cellsX: 100, cellsY: 50 });
    expect(noiseCellCounts(createNoiseEffect({ noiseSize: 0.001 }), 1e6, 10).cellsX).toBe(2048);
  });
});

describe("hashSeed", () => {
  it("is stable and distinguishes strings", () => {
    expect(hashSeed("node-1:0")).toBe(hashSeed("node-1:0"));
    expect(hashSeed("node-1:0")).not.toBe(hashSeed("node-1:1"));
  });
});
