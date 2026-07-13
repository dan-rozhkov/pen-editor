import { describe, it, expect } from "vitest";

import {
  xfrmXml,
  rectGeometryXml,
  ellipseGeometryXml,
  fillXml,
  strokeXml,
  effectsXml,
} from "../drawingml/shapeProps";

function wellFormed(fragment: string): boolean {
  const xml = `<root xmlns:a="urn:a" xmlns:p="urn:p">${fragment}</root>`;
  return new DOMParser().parseFromString(xml, "application/xml").querySelector("parsererror") === null;
}

describe("xfrmXml", () => {
  it("emits off/ext in EMU", () => {
    expect(xfrmXml({ x: 10, y: 20, width: 100, height: 50 })).toBe(
      '<a:xfrm><a:off x="95250" y="190500"/><a:ext cx="952500" cy="476250"/></a:xfrm>',
    );
  });
  it("adds rot for rotated shapes", () => {
    expect(xfrmXml({ x: 0, y: 0, width: 10, height: 10 }, 45)).toContain('<a:xfrm rot="2700000">');
  });
});

describe("rectGeometryXml", () => {
  it("plain rect", () => {
    expect(rectGeometryXml({ x: 0, y: 0, width: 100, height: 50 })).toBe(
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
    );
  });
  it("uniform radius → roundRect with adj as fraction of the smaller side", () => {
    // radius 10 on a 100×50 rect → 10/50 * 100000 = 20000
    expect(rectGeometryXml({ x: 0, y: 0, width: 100, height: 50 }, [10, 10, 10, 10])).toBe(
      '<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>',
    );
  });
  it("clamps roundRect adj to fully-rounded (50000)", () => {
    expect(rectGeometryXml({ x: 0, y: 0, width: 100, height: 50 }, [40, 40, 40, 40])).toContain("val 50000");
  });
  it("mixed radii → custGeom with four arcs", () => {
    const xml = rectGeometryXml({ x: 0, y: 0, width: 100, height: 50 }, [10, 0, 20, 0]);
    expect(xml).toContain("<a:custGeom>");
    expect(xml.match(/<a:arcTo /g)).toHaveLength(2); // only nonzero corners arc
    expect(wellFormed(xml)).toBe(true);
  });
});

describe("ellipseGeometryXml", () => {
  it("emits the ellipse preset", () => {
    expect(ellipseGeometryXml()).toBe('<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>');
  });
});

describe("fillXml", () => {
  it("empty for undefined", () => {
    expect(fillXml(undefined)).toBe("");
  });
  it("solid fill with alpha", () => {
    expect(fillXml({ kind: "solid", rgb: "FF8000", alpha: 0.5 })).toBe(
      '<a:solidFill><a:srgbClr val="FF8000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>',
    );
  });
  it("linear gradient: stops in per-mille-of-100k positions and lin angle", () => {
    const xml = fillXml({
      kind: "gradient",
      gradientType: "linear",
      angleDeg: 90,
      stops: [
        { rgb: "FF0000", alpha: 1, position: 0 },
        { rgb: "0000FF", alpha: 1, position: 1 },
      ],
    });
    expect(xml).toContain('<a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>');
    expect(xml).toContain('<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>');
    expect(xml).toContain('<a:lin ang="5400000" scaled="1"/>');
  });
  it("radial gradient uses a circle path", () => {
    const xml = fillXml({
      kind: "gradient",
      gradientType: "radial",
      angleDeg: 0,
      stops: [
        { rgb: "FFFFFF", alpha: 1, position: 0 },
        { rgb: "000000", alpha: 1, position: 1 },
      ],
    });
    expect(xml).toContain('<a:path path="circle">');
  });
});

describe("strokeXml", () => {
  it("empty for undefined", () => {
    expect(strokeXml(undefined)).toBe("");
  });
  it("emits width in EMU with a solid fill", () => {
    expect(strokeXml({ rgb: "000000", alpha: 1, widthPx: 2 })).toBe(
      '<a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>',
    );
  });
});

describe("effectsXml", () => {
  it("empty for undefined/empty", () => {
    expect(effectsXml(undefined)).toBe("");
    expect(effectsXml([])).toBe("");
  });
  it("outer shadow: blur/dist/dir from offset vector", () => {
    const xml = effectsXml([
      { variant: "outer", rgb: "000000", alpha: 0.25, offsetX: 0, offsetY: 4, blurPx: 8 },
    ]);
    // offset (0, 4) → dist = 4px in EMU, dir = 90° (down) in 60000ths
    expect(xml).toBe(
      '<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000" rotWithShape="0">' +
        '<a:srgbClr val="000000"><a:alpha val="25000"/></a:srgbClr></a:outerShdw></a:effectLst>',
    );
  });
  it("inner shadow uses innerShdw", () => {
    const xml = effectsXml([
      { variant: "inner", rgb: "FF0000", alpha: 1, offsetX: 2, offsetY: 0, blurPx: 4 },
    ]);
    expect(xml).toContain("<a:innerShdw");
    expect(xml).toContain('dir="0"');
  });

  it("emits innerShdw before outerShdw regardless of input order (CT_EffectList order)", () => {
    const xml = effectsXml([
      { variant: "outer", rgb: "000000", alpha: 1, offsetX: 0, offsetY: 4, blurPx: 8 },
      { variant: "inner", rgb: "FF0000", alpha: 1, offsetX: 2, offsetY: 0, blurPx: 4 },
    ]);
    expect(xml.indexOf("<a:innerShdw")).toBeLessThan(xml.indexOf("<a:outerShdw"));
  });
});
