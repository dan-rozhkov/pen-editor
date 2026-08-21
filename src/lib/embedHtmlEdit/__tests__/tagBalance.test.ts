import { describe, it, expect } from "vitest";
import { checkTagBalance } from "../tagBalance";

describe("checkTagBalance", () => {
  it("reports balanced for well-formed nested markup", () => {
    expect(checkTagBalance("<div><span>hi</span></div>").balanced).toBe(true);
  });

  it("reports unbalanced when a tag is left unclosed", () => {
    const result = checkTagBalance('<div class="top-bar"><div class="map-mini"></div>');
    expect(result.balanced).toBe(false);
    expect(result.unclosed?.tagName).toBe("div");
  });

  it("does not treat void elements as needing a closer", () => {
    expect(checkTagBalance("<div><img src=\"a.png\"><br><hr></div>").balanced).toBe(true);
  });

  it("does not treat self-closing tags as needing a closer", () => {
    expect(checkTagBalance('<svg><path d="M0 0" /></svg>').balanced).toBe(true);
  });

  it("ignores tag-like content inside <script>", () => {
    expect(checkTagBalance("<div><script>if (a < b) { x = '<div>'; }</script></div>").balanced).toBe(
      true,
    );
  });

  it("ignores selector-like content inside <style>", () => {
    expect(checkTagBalance("<div><style>.a > .b { color: red; }</style></div>").balanced).toBe(true);
  });

  it("ignores tag-like content inside comments", () => {
    expect(checkTagBalance("<div><!-- <span> --></div>").balanced).toBe(true);
  });

  it("is case-insensitive for tag names", () => {
    expect(checkTagBalance("<DIV><Span>hi</SPAN></div>").balanced).toBe(true);
  });
});
