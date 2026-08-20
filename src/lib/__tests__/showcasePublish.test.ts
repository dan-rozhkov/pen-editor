import { describe, it, expect } from "vitest";
import {
  inferPlatformForSizes,
  sortByReadingOrder,
  isGenericScreenName,
  screenTitleFor,
  isPlausibleShowcaseSize,
} from "@/lib/showcasePublish";
import { assertErr } from "@/test/assertions";

describe("inferPlatformForSizes", () => {
  it("infers mobile when every screen matches the mobile viewport", () => {
    const result = inferPlatformForSizes([
      { title: "Home", width: 390, height: 844 },
      { title: "Settings", width: 390, height: 843 }, // within tolerance
    ]);
    expect(result).toEqual({ ok: true, platform: "mobile" });
  });

  it("infers desktop when every screen matches the desktop viewport", () => {
    const result = inferPlatformForSizes([
      { title: "Home", width: 1440, height: 1024 },
      { title: "Settings", width: 1441, height: 1024 },
    ]);
    expect(result).toEqual({ ok: true, platform: "desktop" });
  });

  it("infers the nearest platform for a screen that will be normalized on publish", () => {
    expect(
      inferPlatformForSizes([{ title: "Product Listing", width: 375, height: 812 }]),
    ).toEqual({ ok: true, platform: "mobile" });
  });

  it("rejects a screen count of zero", () => {
    const result = inferPlatformForSizes([]);
    expect(result.ok).toBe(false);
  });

  it("rejects mixed platform sizes, naming only the offenders", () => {
    const result = inferPlatformForSizes([
      { title: "Home", width: 390, height: 844 },
      { title: "Wide", width: 1440, height: 1024 },
    ]);
    assertErr(result);
    expect(result.error).toContain("Wide");
    expect(result.error).not.toContain('"Home"');
  });

  it("infers one platform when every non-standard screen is closest to it", () => {
    const result = inferPlatformForSizes([
      { title: "Home", width: 375, height: 812 },
      { title: "Settings", width: 414, height: 896 },
    ]);
    expect(result).toEqual({ ok: true, platform: "mobile" });
  });
});

describe("sortByReadingOrder", () => {
  it("sorts left-to-right by x", () => {
    const items = [
      { id: "c", x: 200, y: 0 },
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
    ];
    expect(sortByReadingOrder(items).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties top-to-bottom by y", () => {
    const items = [
      { id: "bottom", x: 0, y: 100 },
      { id: "top", x: 0, y: 0 },
    ];
    expect(sortByReadingOrder(items).map((i) => i.id)).toEqual(["top", "bottom"]);
  });

  it("does not mutate the input array", () => {
    const items = [
      { id: "b", x: 100, y: 0 },
      { id: "a", x: 0, y: 0 },
    ];
    const original = [...items];
    sortByReadingOrder(items);
    expect(items).toEqual(original);
  });

  it("orders a multi-row grid row-major, not column-major", () => {
    // A 3+2 grid of 390px-wide screens: two columns share x exactly, which a
    // naive x-then-y sort would order column-major (col1row1, col1row2,
    // col2row1, ...) instead of reading order (row1 left-to-right, then
    // row2). Row 2 is offset a full screen height + gap below row 1.
    const items = [
      { id: "r1c1", x: 0, y: 0 },
      { id: "r1c2", x: 430, y: 0 },
      { id: "r1c3", x: 860, y: 0 },
      { id: "r2c1", x: 0, y: 900 },
      { id: "r2c2", x: 430, y: 900 },
    ];
    expect(sortByReadingOrder(items).map((i) => i.id)).toEqual([
      "r1c1",
      "r1c2",
      "r1c3",
      "r2c1",
      "r2c2",
    ]);
  });

  it("tolerates a few px of Y misalignment within one row", () => {
    const items = [
      { id: "left", x: 0, y: 3 },
      { id: "right", x: 430, y: 0 },
    ];
    expect(sortByReadingOrder(items).map((i) => i.id)).toEqual(["left", "right"]);
  });
});

describe("isPlausibleShowcaseSize", () => {
  it("accepts an exact viewport match", () => {
    expect(isPlausibleShowcaseSize({ width: 390, height: 844 })).toBe(true);
    expect(isPlausibleShowcaseSize({ width: 1440, height: 1024 })).toBe(true);
  });

  it("accepts a near-miss worth showing an error for", () => {
    expect(isPlausibleShowcaseSize({ width: 388, height: 840 })).toBe(true);
  });

  it("rejects a small unrelated node like a button frame", () => {
    expect(isPlausibleShowcaseSize({ width: 120, height: 40 })).toBe(false);
  });
});

describe("isGenericScreenName / screenTitleFor", () => {
  it("treats undefined and empty names as generic", () => {
    expect(isGenericScreenName(undefined)).toBe(true);
    expect(isGenericScreenName("")).toBe(true);
    expect(isGenericScreenName("   ")).toBe(true);
  });

  it("treats bare and numbered Frame/Embed defaults as generic", () => {
    expect(isGenericScreenName("Frame")).toBe(true);
    expect(isGenericScreenName("Frame 12")).toBe(true);
    expect(isGenericScreenName("embed")).toBe(true);
    expect(isGenericScreenName("Embed 3")).toBe(true);
  });

  it("treats a user-given name as meaningful", () => {
    expect(isGenericScreenName("Home screen")).toBe(false);
  });

  it("falls back to Screen N (1-based) for generic names", () => {
    expect(screenTitleFor("Frame", 0)).toBe("Screen 1");
    expect(screenTitleFor(undefined, 2)).toBe("Screen 3");
  });

  it("uses the trimmed name when meaningful", () => {
    expect(screenTitleFor("  Home  ", 4)).toBe("Home");
  });
});
