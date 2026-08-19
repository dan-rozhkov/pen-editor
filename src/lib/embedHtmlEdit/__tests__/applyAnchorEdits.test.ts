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

  it("does not normalize whitespace when matching", () => {
    expect(() => applyAnchorEdits("<p>  a  </p>", [{ oldString: "<p> a </p>", newString: "" }]))
      .toThrow(AnchorEditError);
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
});
