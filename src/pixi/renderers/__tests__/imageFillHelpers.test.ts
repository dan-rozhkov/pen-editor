import { describe, it, expect } from "vitest";
import { isSvgUrl, getTextureCacheKey } from "@/pixi/renderers/imageFillHelpers";

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
