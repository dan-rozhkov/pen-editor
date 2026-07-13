import { describe, it, expect } from "vitest";
import { escapeXml, pxToEmu, pxToPt100, degTo60k, parseHexColor, alphaToXml } from "../xml";

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });
  it("passes plain text through", () => {
    expect(escapeXml("Hello — Слайд 1")).toBe("Hello — Слайд 1");
  });
});

describe("unit conversion", () => {
  it("converts px to EMU at 96dpi", () => {
    expect(pxToEmu(1)).toBe(9525);
    expect(pxToEmu(960)).toBe(9144000);
    expect(pxToEmu(540)).toBe(5143500);
  });
  it("converts px to hundredths of a point", () => {
    expect(pxToPt100(16)).toBe(1200);
    expect(pxToPt100(13.5)).toBe(1013); // rounded
  });
  it("converts degrees to 60000ths, normalized", () => {
    expect(degTo60k(90)).toBe(5400000);
    expect(degTo60k(-90)).toBe(16200000);
    expect(degTo60k(360)).toBe(0);
  });
});

describe("parseHexColor", () => {
  it("parses #rrggbb", () => {
    expect(parseHexColor("#ff8000")).toEqual({ rgb: "FF8000", alpha: 1 });
  });
  it("parses #rrggbbaa", () => {
    expect(parseHexColor("#ff800080")).toEqual({ rgb: "FF8000", alpha: 128 / 255 });
  });
  it("parses shorthand #rgb", () => {
    expect(parseHexColor("#f00")).toEqual({ rgb: "FF0000", alpha: 1 });
  });
  it("falls back to black for garbage", () => {
    expect(parseHexColor("not-a-color")).toEqual({ rgb: "000000", alpha: 1 });
  });
});

describe("alphaToXml", () => {
  it("returns empty string for opaque", () => {
    expect(alphaToXml(1)).toBe("");
  });
  it("emits an a:alpha element for translucent", () => {
    expect(alphaToXml(0.5)).toBe('<a:alpha val="50000"/>');
  });
});
