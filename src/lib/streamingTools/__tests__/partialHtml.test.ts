import { describe, expect, it } from "vitest";
import { repairPartialHtml } from "../partialHtml";

describe("repairPartialHtml", () => {
  it.each([
    ["complete markup untouched", "<div><p>hi</p></div>", "<div><p>hi</p></div>"],
    ["trailing bare <", "<div>a<", "<div>a"],
    ["incomplete open tag", '<div>a<div cla', "<div>a"],
    ["incomplete tag with open attribute", '<div>a<a href="/x', "<div>a"],
    ["incomplete closing tag", "<div>a</di", "<div>a"],
    ["incomplete entity", "<p>Tom &amp", "<p>Tom "],
    ["bare ampersand", "<p>Tom &", "<p>Tom "],
    ["complete entity kept", "<p>Tom &amp; Jerry", "<p>Tom &amp; Jerry"],
    ["numeric entity cut off", "<p>&#16", "<p>"],
    ["open comment", "<div><!-- note", "<div><!-- note-->"],
    ["closed comment untouched", "<!-- a --><p>x", "<!-- a --><p>x"],
    ["unclosed style", "<style>.a{color:red}.b{col", "<style>.a{color:red}.b{col</style>"],
    ["closed style untouched", "<style>.a{}</style><p>x", "<style>.a{}</style><p>x"],
    ["half-typed style close tag", "<style>.a{}</sty", "<style>.a{}</style>"],
    ["empty", "", ""],
  ])("%s", (_name, input, expected) => {
    expect(repairPartialHtml(input)).toBe(expected);
  });

  it("never throws across every truncation point", () => {
    const html = '<style>a{b:c}</style><div class="x">A &amp; B<!-- c --><img src="y"></div>';
    for (let i = 0; i <= html.length; i++) {
      expect(() => repairPartialHtml(html.slice(0, i))).not.toThrow();
    }
  });
});
