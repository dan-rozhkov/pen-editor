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

describe("buildTextStyle: fontFeatures is a documented no-op in Pixi", () => {
  it("does not vary fontVariant with fontFeatures unset", () => {
    const style = buildTextStyle(textNode());
    expect(style.fontVariant).toBe("normal");
  });

  it("leaves fontVariant at its default even when smcp is set (no small-caps approximation)", () => {
    // Verified in-browser: canvas `font-variant: small-caps` renders as a
    // plain uppercase substitution for fonts without a real `smcp` table,
    // not true reduced-size small caps — misleading rather than a faithful
    // approximation, so Pixi intentionally ignores it (see `TextNode.fontFeatures`).
    const style = buildTextStyle(textNode({ fontFeatures: { smcp: 1 } }));
    expect(style.fontVariant).toBe("normal");
  });

  it("ignores every curated feature tag for Pixi rendering (documented degradation)", () => {
    const style = buildTextStyle(
      textNode({ fontFeatures: { dlig: 1, tnum: 1, frac: 1, zero: 1, onum: 1 } }),
    );
    expect(style.fontVariant).toBe("normal");
  });

  it("produces the same style whether or not fontFeatures is set (no rebuild trigger needed)", () => {
    const without = buildTextStyle(textNode());
    const withFeatures = buildTextStyle(
      textNode({ fontFeatures: { dlig: 1, smcp: 1, tnum: 1 } }),
    );
    expect(withFeatures.fontVariant).toBe(without.fontVariant);
    expect(withFeatures.fontWeight).toBe(without.fontWeight);
  });
});
