import { describe, it, expect } from "vitest";
import { resolveTextStyleProperties } from "../textStyleResolve";
import type { TextStyle } from "@/types/textStyle";

describe("resolveTextStyleProperties", () => {
  const style: TextStyle = {
    id: "s1",
    name: "Heading/L",
    fontFamily: "Inter",
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 1.1,
    letterSpacing: -0.5,
    textTransform: "none",
  };

  it("returns all style properties when there are no local overrides", () => {
    expect(resolveTextStyleProperties(style)).toEqual({
      fontFamily: "Inter",
      fontSize: 32,
      fontWeight: "700",
      lineHeight: 1.1,
      letterSpacing: -0.5,
      textTransform: "none",
    });
  });

  it("skips keys present in the override list", () => {
    const result = resolveTextStyleProperties(style, ["fontSize", "letterSpacing"]);
    expect(result).toEqual({
      fontFamily: "Inter",
      fontWeight: "700",
      lineHeight: 1.1,
      textTransform: "none",
    });
  });

  it("omits properties the style does not define", () => {
    const partial: TextStyle = { id: "s2", name: "Body", fontSize: 14 };
    expect(resolveTextStyleProperties(partial)).toEqual({ fontSize: 14 });
  });

  it("returns an empty object when every property is overridden", () => {
    const result = resolveTextStyleProperties(style, [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "textTransform",
    ]);
    expect(result).toEqual({});
  });
});
