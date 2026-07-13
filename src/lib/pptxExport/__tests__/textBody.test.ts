import { describe, it, expect } from "vitest";

import { textBodyXml, emptyTextBodyXml } from "../drawingml/textBody";
import type { TextShapeInput } from "../types";

function makeText(overrides: Partial<TextShapeInput> = {}): TextShapeInput {
  return {
    kind: "text",
    rect: { x: 0, y: 0, width: 200, height: 50 },
    paragraphs: [{ text: "Hello", align: "l" }],
    anchor: "t",
    font: {
      family: "Inter",
      sizePx: 16,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      rgb: "111111",
      alpha: 1,
    },
    ...overrides,
  };
}

describe("textBodyXml", () => {
  it("emits bodyPr with zero insets and anchor, one a:p per paragraph", () => {
    const xml = textBodyXml(
      makeText({ paragraphs: [{ text: "One", align: "l" }, { text: "Two", align: "ctr" }], anchor: "ctr" }),
    );
    expect(xml).toContain('<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>');
    expect(xml.match(/<a:p>/g)).toHaveLength(2);
    expect(xml).toContain('<a:pPr algn="ctr"');
  });

  it("maps font size px→hundredths of pt and family to latin typeface", () => {
    const xml = textBodyXml(makeText());
    expect(xml).toContain('sz="1200"');
    expect(xml).toContain('<a:latin typeface="Inter"/>');
    expect(xml).toContain("<a:t>Hello</a:t>");
  });

  it("bold/italic/underline/strike become rPr attributes", () => {
    const xml = textBodyXml(
      makeText({ font: { ...makeText().font, bold: true, italic: true, underline: true, strike: true } }),
    );
    expect(xml).toContain('b="1"');
    expect(xml).toContain('i="1"');
    expect(xml).toContain('u="sng"');
    expect(xml).toContain('strike="sngStrike"');
  });

  it("line height and paragraph spacing map to lnSpc/spcAft", () => {
    const xml = textBodyXml(
      makeText({ font: { ...makeText().font, lineHeight: 1.5, paragraphSpacingPx: 8 } }),
    );
    expect(xml).toContain('<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>');
    expect(xml).toContain('<a:spcAft><a:spcPts val="600"/></a:spcAft>'); // 8px = 6pt = 600
  });

  it("letter spacing maps to rPr spc in hundredths of pt", () => {
    const xml = textBodyXml(makeText({ font: { ...makeText().font, letterSpacingPx: 2 } }));
    expect(xml).toContain('spc="150"'); // 2px = 1.5pt
  });

  it("escapes text content", () => {
    const xml = textBodyXml(makeText({ paragraphs: [{ text: "<b> & 'q'", align: "l" }] }));
    expect(xml).toContain("<a:t>&lt;b&gt; &amp; &apos;q&apos;</a:t>");
  });

  it("empty paragraph still emits endParaRPr-free empty a:p", () => {
    const xml = textBodyXml(makeText({ paragraphs: [{ text: "", align: "l" }] }));
    expect(xml.match(/<a:p>/g)).toHaveLength(1);
  });
});

describe("emptyTextBodyXml", () => {
  it("is the minimal legal txBody", () => {
    expect(emptyTextBodyXml()).toBe("<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>");
  });
});
