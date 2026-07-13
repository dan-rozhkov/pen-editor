import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { assemblePptx } from "../assemblePptx";

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function assertWellFormed(xml: string, part: string): void {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror"), `${part} is not well-formed`).toBeNull();
}

describe("assemblePptx (empty deck)", () => {
  const bytes = assemblePptx({ widthPx: 960, heightPx: 540, slides: [{ shapes: [] }, { shapes: [] }] });
  const files = unzip(bytes);

  it("contains every required OPC part", () => {
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/slides/_rels/slide2.xml.rels",
    ]) {
      expect(files[part], `missing ${part}`).toBeDefined();
    }
  });

  it("every XML part is well-formed", () => {
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        assertWellFormed(strFromU8(content), name);
      }
    }
  });

  it("declares the slide size in EMU and lists both slides", () => {
    const pres = strFromU8(files["ppt/presentation.xml"]);
    expect(pres).toContain('<p:sldSz cx="9144000" cy="5143500"/>');
    expect(pres.match(/<p:sldId /g)).toHaveLength(2);
  });

  it("content types cover every slide", () => {
    const ct = strFromU8(files["[Content_Types].xml"]);
    expect(ct).toContain('PartName="/ppt/slides/slide1.xml"');
    expect(ct).toContain('PartName="/ppt/slides/slide2.xml"');
  });

  it("throws on zero slides", () => {
    expect(() => assemblePptx({ widthPx: 960, heightPx: 540, slides: [] })).toThrow();
  });
});

describe("assemblePptx (shapes + media)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const bytes = assemblePptx({
    widthPx: 960,
    heightPx: 540,
    slides: [
      {
        shapes: [
          { kind: "rect", rect: { x: 0, y: 0, width: 960, height: 540 }, fill: { kind: "solid", rgb: "FFFFFF", alpha: 1 } },
          { kind: "picture", rect: { x: 10, y: 10, width: 100, height: 100 }, media: { bytes: png, mime: "image/png" } },
        ],
      },
      { shapes: [{ kind: "picture", rect: { x: 0, y: 0, width: 50, height: 50 }, media: { bytes: png, mime: "image/png" } }] },
    ],
  });
  const files = unzip(bytes);

  it("dedupes identical media into one file", () => {
    const names = Object.keys(files).filter((n) => n.startsWith("ppt/media/"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/image1\.png$/);
  });

  it("slide rels reference layout and the image", () => {
    const rels = strFromU8(files["ppt/slides/_rels/slide1.xml.rels"]);
    expect(rels).toContain("slideLayout1.xml");
    expect(rels).toContain("../media/image1.png");
  });

  it("slide XML contains the shapes and stays well-formed", () => {
    const slide = strFromU8(files["ppt/slides/slide1.xml"]);
    expect(slide).toContain("<p:sp>");
    expect(slide).toContain("<p:pic>");
    assertWellFormed(slide, "slide1.xml");
  });
});
