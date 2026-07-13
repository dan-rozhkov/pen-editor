import { describe, it, expect } from "vitest";

import { shapeXml } from "../drawingml/mappers";
import type { ShapeInput } from "../types";

const rect: ShapeInput = {
  kind: "rect",
  name: "Card",
  rect: { x: 10, y: 10, width: 100, height: 50 },
  fill: { kind: "solid", rgb: "FFFFFF", alpha: 1 },
  stroke: { rgb: "000000", alpha: 1, widthPx: 1 },
};

describe("shapeXml", () => {
  it("rect → p:sp with nvSpPr/spPr/txBody in order", () => {
    const xml = shapeXml(rect, 2);
    expect(xml.startsWith("<p:sp>")).toBe(true);
    expect(xml).toContain('<p:cNvPr id="2" name="Card"/>');
    expect(xml).toContain('<a:prstGeom prst="rect">');
    expect(xml).toContain("<a:solidFill>");
    expect(xml).toContain("<a:ln ");
    expect(xml).toContain("<p:txBody>"); // empty body — required by schema
  });

  it("text → p:sp with real txBody and no geometry fill", () => {
    const xml = shapeXml(
      {
        kind: "text",
        rect: { x: 0, y: 0, width: 200, height: 40 },
        anchor: "t",
        paragraphs: [{ text: "Hi", align: "l" }],
        font: {
          family: "Inter",
          sizePx: 16,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          rgb: "000000",
          alpha: 1,
        },
      },
      3,
    );
    expect(xml).toContain("<a:t>Hi</a:t>");
    expect(xml).toContain("<a:noFill/>"); // text boxes have no shape fill
  });

  it("line → p:sp with prstGeom line, flip flags from direction", () => {
    // from (110, 60) to (10, 10): dx<0 → flipH, dy<0 → flipV
    const xml = shapeXml(
      { kind: "line", x1: 110, y1: 60, x2: 10, y2: 10, stroke: { rgb: "FF0000", alpha: 1, widthPx: 2 } },
      4,
    );
    expect(xml).toContain('<a:prstGeom prst="line">');
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain('flipV="1"');
    expect(xml).toContain('<a:off x="95250" y="95250"/>'); // min corner (10,10)
  });

  it("line caps map to head/tail ends", () => {
    const xml = shapeXml(
      { kind: "line", x1: 0, y1: 0, x2: 100, y2: 0, stroke: { rgb: "000000", alpha: 1, widthPx: 1 }, endCap: "arrow" },
      5,
    );
    expect(xml).toContain('<a:tailEnd type="arrow"/>');
  });

  it("picture → p:pic with blip r:embed", () => {
    const xml = shapeXml(
      { kind: "picture", rect: { x: 0, y: 0, width: 50, height: 50 }, media: { bytes: new Uint8Array([1]), mime: "image/png" } },
      6,
      "rId2",
    );
    expect(xml.startsWith("<p:pic>")).toBe(true);
    expect(xml).toContain('<a:blip r:embed="rId2"/>');
    expect(xml).toContain("<a:stretch><a:fillRect/></a:stretch>");
  });

  it("picture without mediaRelId throws", () => {
    expect(() =>
      shapeXml(
        { kind: "picture", rect: { x: 0, y: 0, width: 1, height: 1 }, media: { bytes: new Uint8Array([1]), mime: "image/png" } },
        7,
      ),
    ).toThrow();
  });
});
