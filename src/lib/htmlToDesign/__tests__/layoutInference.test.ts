import { describe, it, expect, afterEach } from "vitest";
import { inferAutoLayout } from "../layoutInference";
import { parsePositiveCssLength } from "../convertElement";

function styleFor(el: HTMLElement, css: Record<string, string>): CSSStyleDeclaration {
  Object.assign(el.style, css);
  document.body.appendChild(el);
  return window.getComputedStyle(el);
}

describe("inferAutoLayout: flex-wrap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("sets layout.flexWrap when the container wraps", () => {
    const el = document.createElement("div");
    const style = styleFor(el, {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: "10px",
    });
    const result = inferAutoLayout(style, el);
    expect(result?.layout.autoLayout).toBe(true);
    expect(result?.layout.flexWrap).toBe(true);
  });

  it("leaves flexWrap unset for a non-wrapping flex container", () => {
    const el = document.createElement("div");
    const style = styleFor(el, { display: "flex", flexDirection: "row" });
    const result = inferAutoLayout(style, el);
    expect(result?.layout.flexWrap).toBeUndefined();
  });

  it("keeps a single gap value when row-gap and column-gap match", () => {
    const el = document.createElement("div");
    const style = styleFor(el, {
      display: "flex",
      flexWrap: "wrap",
      rowGap: "12px",
      columnGap: "12px",
    });
    const result = inferAutoLayout(style, el);
    expect(result?.layout.gap).toBe(12);
    expect(result?.layout.rowGap).toBeUndefined();
    expect(result?.layout.columnGap).toBeUndefined();
  });

  it("preserves independent rowGap/columnGap when they diverge", () => {
    const el = document.createElement("div");
    const style = styleFor(el, {
      display: "flex",
      flexWrap: "wrap",
      rowGap: "24px",
      columnGap: "8px",
    });
    const result = inferAutoLayout(style, el);
    expect(result?.layout.rowGap).toBe(24);
    expect(result?.layout.columnGap).toBe(8);
  });
});

describe("parsePositiveCssLength", () => {
  it("parses a px length", () => {
    expect(parsePositiveCssLength("120px")).toBe(120);
  });

  it("returns undefined for none/auto/0px", () => {
    expect(parsePositiveCssLength("none")).toBeUndefined();
    expect(parsePositiveCssLength("auto")).toBeUndefined();
    expect(parsePositiveCssLength("0px")).toBeUndefined();
    expect(parsePositiveCssLength(undefined)).toBeUndefined();
  });
});
