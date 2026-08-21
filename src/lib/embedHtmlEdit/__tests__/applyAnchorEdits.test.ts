import { describe, it, expect } from "vitest";
import { applyAnchorEdits, AnchorEditError } from "../applyAnchorEdits";

describe("applyAnchorEdits", () => {
  it("replaces a unique anchor", () => {
    const result = applyAnchorEdits('<button class="cta">Buy</button>', [
      { oldString: ">Buy<", newString: ">Get started<" },
    ]);
    expect(result.html).toBe('<button class="cta">Get started</button>');
    expect(result.replacements).toBe(1);
  });

  it("applies edits in order, each against the previous result", () => {
    const result = applyAnchorEdits("a-b-c", [
      { oldString: "a", newString: "x" },
      { oldString: "x-b", newString: "y" },
    ]);
    expect(result.html).toBe("y-c");
    expect(result.replacements).toBe(2);
  });

  it("throws when the anchor is missing", () => {
    expect(() => applyAnchorEdits("<p>hi</p>", [{ oldString: "nope", newString: "x" }]))
      .toThrow(AnchorEditError);
  });

  it("throws when the anchor is ambiguous and reports the count", () => {
    expect(() => applyAnchorEdits("<i></i><i></i>", [{ oldString: "<i>", newString: "<b>" }]))
      .toThrow(/occurs 2 times/);
  });

  it("replaces every occurrence with replaceAll", () => {
    const result = applyAnchorEdits("#111 and #111", [
      { oldString: "#111", newString: "#222", replaceAll: true },
    ]);
    expect(result.html).toBe("#222 and #222");
    expect(result.replacements).toBe(2);
  });

  it("deletes the fragment when newString is empty", () => {
    const result = applyAnchorEdits("<p>keep</p><p>drop</p>", [
      { oldString: "<p>drop</p>", newString: "" },
    ]);
    expect(result.html).toBe("<p>keep</p>");
  });

  it("treats $& and $1 in newString as literal text", () => {
    const result = applyAnchorEdits("cost: X", [{ oldString: "X", newString: "$& $1" }]);
    expect(result.html).toBe("cost: $& $1");
  });

  it("prefers the exact match over a normalized one when both exist", () => {
    // Both "<p>a</p>" (exact) and a whitespace-drifted variant of it exist;
    // the exact match must win and the normalized path must not even engage.
    const result = applyAnchorEdits("<p>a</p><p>  a  </p>", [
      { oldString: "<p>a</p>", newString: "<p>X</p>" },
    ]);
    expect(result.html).toBe("<p>X</p><p>  a  </p>");
    expect(result.normalizedMatches).toBe(0);
  });

  it("falls back to a whitespace-normalized match when the exact one is not found", () => {
    const result = applyAnchorEdits("<div>\n  <p>\n    hi\n  </p>\n</div>", [
      { oldString: "<p> hi </p>", newString: "<p>bye</p>" },
    ]);
    expect(result.html).toBe("<div>\n  <p>bye</p>\n</div>");
    expect(result.normalizedMatches).toBe(1);
  });

  it("throws when the normalized match is ambiguous", () => {
    // Neither occurrence matches the byte-exact double-space oldString, but
    // both normalize to the same "<i> x </i>" — an ambiguous normalized match.
    const html = "<i>\n  x\n</i><i> x </i>";
    expect(() =>
      applyAnchorEdits(html, [{ oldString: "<i>  x  </i>", newString: "<b/>" }]),
    ).toThrow(/ambiguous/);
  });

  it("replaces all normalized matches when replaceAll is set and they are ambiguous", () => {
    const html = "<i>\n  x\n</i><i> x </i>";
    const result = applyAnchorEdits(html, [
      { oldString: "<i>  x  </i>", newString: "<b/>", replaceAll: true },
    ]);
    expect(result.html).toBe("<b/><b/>");
    expect(result.replacements).toBe(2);
  });

  it("includes near-miss context when nothing matches, exact or normalized", () => {
    expect(() =>
      applyAnchorEdits('<div class="top-bar-wrapper">content</div>', [
        { oldString: '<div class="top-bar-typo">', newString: "" },
      ]),
    ).toThrow(/Closest text in the document/);
  });

  it("omits near-miss hints when no reasonably long prefix matches", () => {
    expect(() =>
      applyAnchorEdits("<p>hi</p>", [{ oldString: "totally different text", newString: "" }]),
    ).toThrow(AnchorEditError);
    expect(() =>
      applyAnchorEdits("<p>hi</p>", [{ oldString: "totally different text", newString: "" }]),
    ).not.toThrow(/Closest text/);
  });

  it("leaves the input untouched when a later edit fails", () => {
    const input = "a-b";
    expect(() =>
      applyAnchorEdits(input, [
        { oldString: "a", newString: "x" },
        { oldString: "zzz", newString: "y" },
      ]),
    ).toThrow(AnchorEditError);
    expect(input).toBe("a-b");
  });

  it("rejects an edit that leaves a well-formed document unbalanced", () => {
    const input = '<div class="top-bar"><span>title</span></div><div class="map-mini"></div>';
    expect(() =>
      applyAnchorEdits(input, [
        // Drops the closing </div> of top-bar, nesting map-mini inside it.
        { oldString: "</span></div><div", newString: "</span><div" },
      ]),
    ).toThrow(/unclosed/);
  });

  it("still allows editing HTML that was already unbalanced before the edit", () => {
    const input = '<div class="top-bar"><span>title</span><div class="map-mini"></div>';
    const result = applyAnchorEdits(input, [{ oldString: "title", newString: "renamed" }]);
    expect(result.html).toBe(
      '<div class="top-bar"><span>renamed</span><div class="map-mini"></div>',
    );
  });
});
