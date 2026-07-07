import { describe, it, expect } from "vitest";
import {
  isSvgUrl,
  getTextureCacheKey,
  getPatternTextureCacheKey,
} from "@/pixi/renderers/imageFillHelpers";

describe("isSvgUrl", () => {
  it("treats SVG data URIs as SVG", () => {
    expect(isSvgUrl("data:image/svg+xml;base64,AAAA")).toBe(true);
    expect(isSvgUrl("data:image/svg+xml,<svg/>")).toBe(true);
  });

  it("treats .svg file URLs as SVG", () => {
    expect(isSvgUrl("https://example.com/icon.svg")).toBe(true);
  });

  it("treats .svg URLs with query string or fragment as SVG", () => {
    expect(isSvgUrl("https://example.com/icon.svg?v=1")).toBe(true);
    expect(isSvgUrl("https://example.com/icon.svg#frag")).toBe(true);
  });

  it("does not treat non-SVG URLs as SVG", () => {
    expect(isSvgUrl("https://example.com/photo.png")).toBe(false);
    expect(isSvgUrl("https://example.com/image-no-extension")).toBe(false);
  });
});

describe("getTextureCacheKey", () => {
  it("ignores size for non-SVG URLs", () => {
    const url = "https://example.com/photo.png";
    const a = getTextureCacheKey(url, 100, 100, 1);
    const b = getTextureCacheKey(url, 300, 50, 1);
    expect(a).toBe(b);
    expect(a).toBe("img:https://example.com/photo.png");
  });

  it("includes size in the key for SVG URLs", () => {
    const url = "https://example.com/icon.svg";
    const a = getTextureCacheKey(url, 100, 100, 1);
    const b = getTextureCacheKey(url, 300, 50, 1);
    expect(a).not.toBe(b);
  });

  it("buckets nearby resolutions to the same SVG key", () => {
    const url = "https://example.com/icon.svg";
    // round(1.1 * 4) / 4 = round(4.4)/4 = 4/4 = 1.0 → same bucket as 1.0
    const a = getTextureCacheKey(url, 100, 100, 1.0);
    const b = getTextureCacheKey(url, 100, 100, 1.1);
    expect(a).toBe(b);
  });

  it("distinguishes resolutions that fall in different buckets", () => {
    const url = "https://example.com/icon.svg";
    const a = getTextureCacheKey(url, 100, 100, 1.0);
    const b = getTextureCacheKey(url, 100, 100, 1.25);
    expect(a).not.toBe(b);
  });

  it("clamps the resolution bucket floor to 1", () => {
    const url = "https://example.com/icon.svg";
    // round(0.1 * 4)/4 = round(0.4)/4 = 0/4 = 0 → Math.max(1, 0) = 1
    const key = getTextureCacheKey(url, 100, 100, 0.1);
    expect(key).toBe("svg:https://example.com/icon.svg:100x100@1");
  });
});

describe("getPatternTextureCacheKey", () => {
  it("is independent of container size for SVG tiles (only url/scale/resolution matter)", () => {
    const url = "https://example.com/tile.svg";
    // A pattern tile's cache key must never vary with the node's fill area —
    // that's the whole point of loading it at natural size (finding #2) and
    // getting a 100% cache hit rate across resize (finding #6a).
    const a = getPatternTextureCacheKey(url, 1, 1);
    const b = getPatternTextureCacheKey(url, 1, 1);
    expect(a).toBe(b);
    expect(a).toBe("svg-pattern:https://example.com/tile.svg:1@1");
  });

  it("varies with scale", () => {
    const url = "https://example.com/tile.svg";
    const a = getPatternTextureCacheKey(url, 1, 1);
    const b = getPatternTextureCacheKey(url, 2, 1);
    expect(a).not.toBe(b);
  });

  it("ignores size/scale for raster tile sources", () => {
    const url = "https://example.com/tile.png";
    expect(getPatternTextureCacheKey(url, 1, 1)).toBe(getPatternTextureCacheKey(url, 5, 3));
    expect(getPatternTextureCacheKey(url, 1, 1)).toBe("img:https://example.com/tile.png");
  });
});
