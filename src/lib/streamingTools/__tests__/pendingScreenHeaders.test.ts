import { describe, expect, it } from "vitest";
import { parsePendingScreenHeaders } from "../pendingScreenHeaders";

// The prescribed key order from CLAUDE.md / the real system prompt:
// type, name, x, y, width, height, then htmlContent last.
const SCREEN_1 =
  's1=I(document, {type: "embed", name: "Login", x: 0, y: 0, width: 390, height: 844, htmlContent: "<div style=\\"width: 100%\\">...</div>"})';
const SCREEN_2_HEADER =
  's2=I(document, {type: "embed", name: "Feed", x: 440, y: 0, width: 390, height: 844, htmlContent: "';
const LOGIN_HTML = '<div style="width: 100%">...</div>';
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
      { index: 0, start: 0, name: "Login", x: 0, y: 0, width: 390, height: 844, html: "", htmlComplete: false },
    ]);
  });

  it("ignores width/height-shaped text inside htmlContent's own CSS", () => {
    // This is the main trap this module exists to avoid: htmlContent's value
    // contains `width: 100%` in inline CSS, in the exact same textual shape
    // as a real field.
    const headers = parsePendingScreenHeaders(SCREEN_1);
    expect(headers).toMatchObject([
      { index: 0, name: "Login", x: 0, y: 0, width: 390, height: 844, html: LOGIN_HTML },
    ]);
  });

  it("shows the second screen's header as pending while its htmlContent is still streaming", () => {
    const headers = parsePendingScreenHeaders(FULL_FIXTURE);
    expect(headers).toMatchObject([
      { index: 0, name: "Login", x: 0, y: 0, width: 390, height: 844, html: LOGIN_HTML },
      { index: 1, name: "Feed", x: 440, y: 0, width: 390, height: 844, html: "" },
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
    expect(parsePendingScreenHeaders(noBinding)).toMatchObject([
      { index: 0, name: "Onboarding", x: 10, y: 20, width: 300, height: 600, html: "<p>hi" },
    ]);
  });

  it("does not confuse a numeric field with the tail of a longer key name", () => {
    // "boxwidth"/"cardheight" contain "width"/"height" as a bare substring —
    // without a word-boundary guard those would be misread as the real
    // fields with the wrong values (999 instead of 200/400).
    const tricky =
      's1=I(document, {type: "embed", name: "Card", boxwidth: 999, cardheight: 999, x: 5, y: 6, width: 200, height: 400, htmlContent: "…';
    expect(parsePendingScreenHeaders(tricky)).toMatchObject([
      { index: 0, name: "Card", x: 5, y: 6, width: 200, height: 400, html: "…" },
    ]);
  });

  describe("html extraction", () => {
    const HEAD = 'I(document, {type: "embed", name: "A", x: 0, y: 0, width: 10, height: 20, htmlContent: ';
    const htmlOf = (tail: string) => parsePendingScreenHeaders(HEAD + tail)[0]?.html;

    it.each([
      ["nothing before the opening quote", "", ""],
      ["just the opening quote", '"', ""],
      ["plain text, still open", '"<p>Hi', "<p>Hi"],
      ["decoded escapes", '"<p>a\\nb\\t\\"c\\\\ \\/ \\u00e9</p>', '<p>a\nb\t"c\\ / \u00e9</p>'],
      ["partial escape at the tail is dropped", '"ab\\', "ab"],
      ["partial unicode escape at the tail is dropped", '"ab\\u00', "ab"],
      ["unescaped inner quotes stay content", '"<div class="card">x', '<div class="card">x'],
      ["single-quote delimiter", "'<p class=\"a\">it\\'s", '<p class="a">it\'s'],
      ["backtick delimiter", "`<p>a\nb", "<p>a\nb"],
      ["closing quote ends the string", '"<p>x</p>"})', "<p>x</p>"],
    ])("%s", (_name, tail, expected) => {
      expect(htmlOf(tail)).toBe(expected);
    });

    it("keeps CSS width/height inside html from touching the header", () => {
      const headers = parsePendingScreenHeaders(
        HEAD + '"<style>.a{width: 999px; height: 999px}</style>',
      );
      expect(headers).toEqual([
        {
          index: 0,
          start: 0,
          htmlComplete: false,
          name: "A",
          x: 0,
          y: 0,
          width: 10,
          height: 20,
          html: "<style>.a{width: 999px; height: 999px}</style>",
        },
      ]);
    });

    it("gives each screen its own html", () => {
      const ops = `${HEAD}"<p>one</p>"})\nI(document, {type: "embed", name: "B", x: 50, y: 0, width: 10, height: 20, htmlContent: "<p>tw`;
      expect(parsePendingScreenHeaders(ops).map((h) => h.html)).toEqual(["<p>one</p>", "<p>tw"]);
    });

    it("html only ever grows as the stream advances", () => {
      const full = HEAD + '"<div class="a">x\\ny &amp; z</div>"})';
      let prev = "";
      for (let i = 0; i <= full.length; i++) {
        const html = parsePendingScreenHeaders(full.slice(0, i))[0]?.html ?? "";
        expect(html.startsWith(prev.slice(0, -1))).toBe(true);
        prev = html;
      }
    });
  });

  describe("decodeFromOffset / completedHtml / htmlComplete", () => {
    const ops = `${SCREEN_1}\n${SCREEN_2_HEADER}<p>tw`;

    it("skips html decoding for headers starting before the offset but keeps their geometry", () => {
      const headers = parsePendingScreenHeaders(ops, { decodeFromOffset: SCREEN_1.length + 1 });
      expect(headers.map((h) => [h.index, h.name, h.html])).toEqual([
        [0, "Login", ""],
        [1, "Feed", "<p>tw"],
      ]);
      expect(headers[1].start).toBe(SCREEN_1.length + 1);
    });

    it("decodes everything by default", () => {
      expect(parsePendingScreenHeaders(ops).map((h) => h.html)).toEqual([LOGIN_HTML, "<p>tw"]);
    });

    it("reports htmlComplete only once the closing quote is confirmed by a follower", () => {
      const headers = parsePendingScreenHeaders(ops);
      expect(headers.map((h) => h.htmlComplete)).toEqual([true, false]);
      // A quote at the very end of the text could still be inner content.
      const HEAD = 'I(document, {type: "embed", name: "A", x: 0, y: 0, width: 10, height: 20, htmlContent: ';
      expect(parsePendingScreenHeaders(HEAD + '"<p>x</p>"')[0].htmlComplete).toBe(false);
      expect(parsePendingScreenHeaders(HEAD + '"<p>x</p>"})')[0].htmlComplete).toBe(true);
    });

    it("reuses completedHtml instead of decoding", () => {
      const headers = parsePendingScreenHeaders(ops, { completedHtml: new Map([[0, "CACHED"]]) });
      expect(headers[0]).toMatchObject({ html: "CACHED", htmlComplete: true });
      expect(headers[1].html).toBe("<p>tw");
    });
  });

  it("decodes escapes and drops an incomplete trailing escape", () => {
    const head = 'I(document, {type: "embed", name: "A", x: 0, y: 0, width: 10, height: 20, htmlContent: ';
    expect(parsePendingScreenHeaders(head + '"a\\nb\\u0041c\\u00')[0].html).toBe("a\nbAc");
    expect(parsePendingScreenHeaders(head + '"tail\\')[0].html).toBe("tail");
  });
});