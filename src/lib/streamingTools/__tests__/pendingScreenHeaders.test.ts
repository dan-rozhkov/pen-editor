import { describe, expect, it } from "vitest";
import { parsePendingScreenHeaders } from "../pendingScreenHeaders";

// The prescribed key order from CLAUDE.md / the real system prompt:
// type, name, x, y, width, height, then htmlContent last.
const SCREEN_1 =
  's1=I(document, {type: "embed", name: "Login", x: 0, y: 0, width: 390, height: 844, htmlContent: "<div style=\\"width: 100%\\">...</div>"})';
const SCREEN_2_HEADER =
  's2=I(document, {type: "embed", name: "Feed", x: 440, y: 0, width: 390, height: 844, htmlContent: "';
const FULL_FIXTURE = `${SCREEN_1}\n${SCREEN_2_HEADER}`;

describe("parsePendingScreenHeaders", () => {
  it("never throws across every truncation point of a realistic fixture", () => {
    for (let i = 0; i <= FULL_FIXTURE.length; i++) {
      const prefix = FULL_FIXTURE.slice(0, i);
      expect(() => parsePendingScreenHeaders(prefix)).not.toThrow();
    }
  });

  it("never reports a half-parsed number across every truncation point", () => {
    // A trailing "390" that might still grow into "3900" must never surface
    // as width: 390 for a header whose width value isn't actually finished.
    for (let i = 0; i <= FULL_FIXTURE.length; i++) {
      const prefix = FULL_FIXTURE.slice(0, i);
      const headers = parsePendingScreenHeaders(prefix);
      for (const header of headers) {
        expect(Number.isFinite(header.x)).toBe(true);
        expect(Number.isFinite(header.y)).toBe(true);
        expect(Number.isFinite(header.width)).toBe(true);
        expect(Number.isFinite(header.height)).toBe(true);
      }
    }
  });

  it("returns nothing for an empty or garbage string", () => {
    expect(parsePendingScreenHeaders("")).toEqual([]);
    expect(parsePendingScreenHeaders("not an operations script at all")).toEqual([]);
    expect(parsePendingScreenHeaders("{{{[[[")).toEqual([]);
  });

  it("does not report a header until all four numeric fields are terminated", () => {
    // width still growing — could become 3900, 390, or anything else.
    const partial = 's1=I(document, {type: "embed", name: "Login", x: 0, y: 0, width: 39';
    expect(parsePendingScreenHeaders(partial)).toEqual([]);
  });

  it("reports a header the instant its four numeric fields and name are terminated, before htmlContent starts", () => {
    const partial = 's1=I(document, {type: "embed", name: "Login", x: 0, y: 0, width: 390, height: 844,';
    expect(parsePendingScreenHeaders(partial)).toEqual([
      { name: "Login", x: 0, y: 0, width: 390, height: 844 },
    ]);
  });

  it("ignores width/height-shaped text inside htmlContent's own CSS", () => {
    // This is the main trap this module exists to avoid: htmlContent's value
    // contains `width: 100%` in inline CSS, in the exact same textual shape
    // as a real field.
    const headers = parsePendingScreenHeaders(SCREEN_1);
    expect(headers).toEqual([{ name: "Login", x: 0, y: 0, width: 390, height: 844 }]);
  });

  it("shows the second screen's header as pending while its htmlContent is still streaming", () => {
    const headers = parsePendingScreenHeaders(FULL_FIXTURE);
    expect(headers).toEqual([
      { name: "Login", x: 0, y: 0, width: 390, height: 844 },
      { name: "Feed", x: 440, y: 0, width: 390, height: 844 },
    ]);
  });

  it("ignores a non-embed operation entirely", () => {
    const nonEmbed =
      's1=I(document, {type: "rect", name: "Box", x: 0, y: 0, width: 100, height: 100})';
    expect(parsePendingScreenHeaders(nonEmbed)).toEqual([]);
  });

  it("tolerates a header with no binding prefix", () => {
    const noBinding =
      'I(document, {type: "embed", name: "Onboarding", x: 10, y: 20, width: 300, height: 600, htmlContent: "<p>hi';
    expect(parsePendingScreenHeaders(noBinding)).toEqual([
      { name: "Onboarding", x: 10, y: 20, width: 300, height: 600 },
    ]);
  });

  it("does not confuse a numeric field with the tail of a longer key name", () => {
    // "boxwidth"/"cardheight" contain "width"/"height" as a bare substring —
    // without a word-boundary guard those would be misread as the real
    // fields with the wrong values (999 instead of 200/400).
    const tricky =
      's1=I(document, {type: "embed", name: "Card", boxwidth: 999, cardheight: 999, x: 5, y: 6, width: 200, height: 400, htmlContent: "…';
    expect(parsePendingScreenHeaders(tricky)).toEqual([
      { name: "Card", x: 5, y: 6, width: 200, height: 400 },
    ]);
  });
});
