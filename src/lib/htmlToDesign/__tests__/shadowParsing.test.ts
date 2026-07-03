import { describe, it, expect } from "vitest";
import { parseShadow, parseShadows, parseBlurRadius } from "../styleApplication";

describe("parseShadow (single)", () => {
  it("parses offset/blur/spread/color", () => {
    const s = parseShadow("rgba(0, 0, 0, 0.25) 2px 4px 6px 1px");
    expect(s).toMatchObject({
      type: "shadow",
      shadowType: "outer",
      offset: { x: 2, y: 4 },
      blur: 6,
      spread: 1,
    });
    expect(s!.color).toBe("#00000040");
  });

  it("detects inset → inner", () => {
    const s = parseShadow("rgba(0, 0, 0, 0.5) 1px 1px 2px 0px inset");
    expect(s!.shadowType).toBe("inner");
  });

  it("none → null", () => {
    expect(parseShadow("none")).toBeNull();
  });
});

describe("parseShadows (list)", () => {
  it("single shadow → one effect", () => {
    const list = parseShadows("rgba(0, 0, 0, 0.25) 0px 2px 4px 0px");
    expect(list).toHaveLength(1);
  });

  it("multiple shadows → reversed (bottom-to-top), inner detected", () => {
    const css =
      "rgba(0, 0, 0, 0.25) 0px 2px 4px 0px, rgba(255, 255, 255, 0.5) 1px 1px 2px 1px inset";
    const list = parseShadows(css);
    expect(list).toHaveLength(2);
    // CSS order: outer(top), inner; reversed → inner first (bottom)
    expect(list[0].shadowType).toBe("inner");
    expect(list[1].shadowType).toBe("outer");
    // commas inside rgba() not split
    expect(list[1].offset).toEqual({ x: 0, y: 2 });
  });
});

describe("parseBlurRadius", () => {
  it("parses filter: blur(6px)", () => {
    expect(parseBlurRadius("blur(6px)")).toBe(6);
  });

  it("parses blur() inside a filter list", () => {
    expect(parseBlurRadius("drop-shadow(0 1px 2px black) blur(4.5px)")).toBe(4.5);
  });

  it("returns null for none, empty, unrelated, or zero-radius filters", () => {
    expect(parseBlurRadius("none")).toBeNull();
    expect(parseBlurRadius("")).toBeNull();
    expect(parseBlurRadius("grayscale(1)")).toBeNull();
    expect(parseBlurRadius("blur(0px)")).toBeNull();
  });
});
