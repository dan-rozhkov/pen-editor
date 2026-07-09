import { describe, expect, it } from "vitest";
import { buildTextStyle } from "../textRenderer";
import type { TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "hello",
    fontSize: 16,
    fontFamily: "Inter",
    ...overrides,
  } as TextNode;
}

describe("buildTextStyle: fontVariations wght approximation", () => {
  it("falls back to the static fontWeight when fontVariations is unset", () => {
    const style = buildTextStyle(textNode({ fontWeight: "700" }));
    expect(style.fontWeight).toBe("700");
  });

  it("uses the wght axis value, taking precedence over the static fontWeight", () => {
    const style = buildTextStyle(textNode({ fontWeight: "700", fontVariations: { wght: 530 } }));
    expect(style.fontWeight).toBe("530");
  });

  it("rounds a fractional wght value", () => {
    const style = buildTextStyle(textNode({ fontVariations: { wght: 452.7 } }));
    expect(style.fontWeight).toBe("453");
  });

  it("ignores non-wght axes for the Pixi weight approximation (falls back to fontWeight)", () => {
    const style = buildTextStyle(textNode({ fontWeight: "400", fontVariations: { wdth: 87 } }));
    expect(style.fontWeight).toBe("400");
  });
});
