import { describe, it, expect } from "vitest";
import { filterCssRules, parseCss, scopeCss, splitSelectors } from "../css";

describe("splitSelectors", () => {
  it("splits on top-level commas only", () => {
    expect(splitSelectors(".a, .b:is(.c, .d), [x='1,2']")).toEqual([
      ".a",
      ".b:is(.c, .d)",
      "[x='1,2']",
    ]);
  });
});

describe("scopeCss", () => {
  it("prefixes bare descendant selectors", () => {
    expect(scopeCss("span { color: red }", "btn")).toBe('[data-c="btn"] span{color: red}');
  });

  it("emits both root and descendant forms for class/id/attribute selectors", () => {
    expect(scopeCss(".x { a: b }", "btn")).toBe('[data-c="btn"].x, [data-c="btn"] .x{a: b}');
  });

  it("maps :root to the component root and pseudo-first selectors to the root", () => {
    expect(scopeCss(":root { --a: 1 } :hover { b: c }", "btn")).toBe(
      '[data-c="btn"]{--a: 1}\n[data-c="btn"]:hover{b: c}',
    );
  });

  it("leaves already-scoped selectors alone", () => {
    const css = '[data-c="btn"][data-v-kind="primary"]{background: red}';
    expect(scopeCss(css, "btn")).toBe(css);
  });

  it("is idempotent", () => {
    const once = scopeCss(".a, b > c { x: y } @media (min-width: 1px) { .d { e: f } }", "btn");
    expect(scopeCss(once, "btn")).toBe(once);
  });

  it("recurses into @media and keeps @keyframes raw", () => {
    const out = scopeCss("@media (min-width: 1px) { p { a: b } } @keyframes spin { to { r: 1 } }", "k");
    expect(out).toContain('@media (min-width: 1px){\n[data-c="k"] p{a: b}\n}');
    expect(out).toContain("@keyframes spin{to { r: 1 }}");
  });

  it("drops comments and survives braces inside strings", () => {
    const out = scopeCss('/* hi */ p::after { content: "}"; }', "k");
    expect(out).toBe('[data-c="k"] p::after{content: "}";}');
  });
});

describe("filterCssRules", () => {
  it("keeps only rules with a selector the predicate accepts", () => {
    const css = ".a { x: 1 } .b { y: 2 } @media (min-width: 1px) { .a { z: 3 } .c { w: 4 } }";
    const out = filterCssRules(css, (s) => s === ".a");
    expect(parseCss(out)).toHaveLength(2);
    expect(out).toContain(".a{x: 1}");
    expect(out).not.toContain(".b");
    expect(out).not.toContain(".c");
  });

  it("keeps a @keyframes block that a kept rule references", () => {
    const css = ".a { animation: spin 1s } @keyframes spin { to { r: 1 } } @keyframes other { to { r: 2 } }";
    const out = filterCssRules(css, () => true);
    expect(out).toContain("@keyframes spin");
    expect(out).not.toContain("@keyframes other");
  });
});
