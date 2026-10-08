import { describe, expect, it } from "vitest";
import {
  colorsEqual,
  compositeOver,
  contrastRatio,
  isLargeText,
  oklabDistance,
  parseColor,
  requiredRatio,
  toHex,
  type Rgba,
} from "../colorMath";

const rgba = (input: string): Rgba => {
  const c = parseColor(input);
  if (!c) throw new Error(`unparsable ${input}`);
  return c;
};

describe("parseColor", () => {
  it.each([
    ["#fff", "#ffffff"],
    ["#FF0000", "#ff0000"],
    ["#00000080", "#00000080"],
    ["#f008", "#ff000088"],
    ["rgb(255, 0, 0)", "#ff0000"],
    ["rgb(255 0 0 / 50%)", "#ff000080"],
    ["rgba(0,0,0,0.5)", "#00000080"],
    ["hsl(0, 100%, 50%)", "#ff0000"],
    ["hsl(120deg 100% 25%)", "#008000"],
    ["navy", "#000080"],
    ["oklch(1 0 0)", "#ffffff"],
    ["oklch(0 0 0)", "#000000"],
    ["transparent", "#00000000"],
  ])("%s -> %s", (input, hex) => {
    expect(toHex(rgba(input))).toBe(hex);
  });

  it.each(["var(--x)", "currentColor", "linear-gradient(red, blue)", "#12", "rgb(1,2)", "", "nope"])(
    "rejects %s",
    (input) => {
      expect(parseColor(input)).toBeNull();
    },
  );

  it("rejects non-strings", () => {
    expect(parseColor(undefined)).toBeNull();
  });
});

describe("contrast", () => {
  const white = rgba("#ffffff");
  it.each([
    ["#000000", 21],
    ["#777777", 4.48],
    ["#767676", 4.54],
  ])("%s on white = %d", (fg, expected) => {
    expect(contrastRatio(rgba(fg), white)).toBeCloseTo(expected, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio(white, rgba("#777"))).toBeCloseTo(contrastRatio(rgba("#777"), white), 6);
  });

  it("composites translucent foregrounds before measuring", () => {
    const over = compositeOver(rgba("rgba(0,0,0,0.5)"), white);
    expect(toHex(over)).toBe("#808080");
    expect(contrastRatio(over, white)).toBeCloseTo(3.98, 2);
  });

  it("keeps the backdrop when the foreground is transparent", () => {
    expect(toHex(compositeOver(rgba("transparent"), rgba("#123456")))).toBe("#123456");
  });

  it("isLargeText: 24px, or 18.66px bold", () => {
    expect(isLargeText(24)).toBe(true);
    expect(isLargeText(23.9)).toBe(false);
    expect(isLargeText(18.66, "700")).toBe(true);
    expect(isLargeText(18.66, "bold")).toBe(true);
    expect(isLargeText(18.65, "700")).toBe(false);
    expect(isLargeText(20, "400")).toBe(false);
  });

  it("requiredRatio", () => {
    expect(requiredRatio(false)).toBe(4.5);
    expect(requiredRatio(true)).toBe(3);
    expect(requiredRatio(false, "AAA")).toBe(7);
  });
});

describe("oklabDistance / colorsEqual", () => {
  it("is zero for identical colors and grows with difference", () => {
    expect(oklabDistance(rgba("#336699"), rgba("#336699"))).toBe(0);
    expect(oklabDistance(rgba("#336699"), rgba("#346699"))).toBeLessThan(0.01);
    expect(oklabDistance(rgba("#000"), rgba("#fff"))).toBeGreaterThan(0.9);
  });

  it("colorsEqual tolerates sub-step float noise only", () => {
    expect(colorsEqual(rgba("#336699"), { r: 51.4, g: 102, b: 153, a: 1 })).toBe(true);
    expect(colorsEqual(rgba("#336699"), rgba("#346699"))).toBe(false);
    expect(colorsEqual(rgba("#33669980"), rgba("#336699"))).toBe(false);
  });
});
