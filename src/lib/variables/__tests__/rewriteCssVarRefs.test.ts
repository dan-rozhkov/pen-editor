import { describe, expect, it } from "vitest";
import { rewriteCssVarRefs } from "../rewriteCssVarRefs";

const map = { "--a": "--b" };

describe("rewriteCssVarRefs", () => {
  it("rewrites a plain reference", () => {
    expect(rewriteCssVarRefs("color: var(--a);", map)).toBe("color: var(--b);");
  });

  it("never touches a longer name that shares the prefix", () => {
    const html = "color: var(--a-b); margin: var(--a2); x: var(--ab)";
    expect(rewriteCssVarRefs(html, map)).toBe(html);
  });

  it("handles whitespace and a fallback", () => {
    expect(rewriteCssVarRefs("var( --a ) var(--a , #fff) var(--a,#000)", map)).toBe(
      "var( --b ) var(--b , #fff) var(--b,#000)",
    );
  });

  it("rewrites every occurrence", () => {
    expect(rewriteCssVarRefs("var(--a) var(--a)", map)).toBe("var(--b) var(--b)");
  });

  it("rewrites nested references in a fallback", () => {
    expect(rewriteCssVarRefs("var(--a, var(--c))", { "--a": "--x", "--c": "--y" })).toBe(
      "var(--x, var(--y))",
    );
  });

  it("is a single pass: a swap does not cascade", () => {
    expect(rewriteCssVarRefs("var(--a) var(--b)", { "--a": "--b", "--b": "--a" })).toBe(
      "var(--b) var(--a)",
    );
  });

  it("rewrites inline custom-property declarations, not longer names", () => {
    expect(rewriteCssVarRefs('<div style="--a: 4px; --a-b: 2px">', map)).toBe(
      '<div style="--b: 4px; --a-b: 2px">',
    );
    expect(rewriteCssVarRefs(":root{--a:#fff}", map)).toBe(":root{--b:#fff}");
  });

  it("returns the same string when nothing matches", () => {
    const html = "<p>var(--zzz)</p>";
    expect(rewriteCssVarRefs(html, map)).toBe(html);
    expect(rewriteCssVarRefs(html, {})).toBe(html);
  });
});
