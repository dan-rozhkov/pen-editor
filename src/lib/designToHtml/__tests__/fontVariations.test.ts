import { describe, it, expect } from "vitest";
import { generateTextStyles } from "../styleGeneration";
import type { TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "hello",
    ...overrides,
  } as unknown as TextNode;
}

describe("designToHtml generateTextStyles: font-variation-settings", () => {
  it("omits font-variation-settings when fontVariations is unset", () => {
    const styles = generateTextStyles(textNode());
    expect(styles["font-variation-settings"]).toBeUndefined();
  });

  it("emits a single-axis font-variation-settings value", () => {
    const styles = generateTextStyles(textNode({ fontVariations: { wght: 530 } }));
    expect(styles["font-variation-settings"]).toBe('"wght" 530');
  });

  it("emits a multi-axis font-variation-settings value in insertion order", () => {
    const styles = generateTextStyles(
      textNode({ fontVariations: { wght: 700, wdth: 87, opsz: 24 } }),
    );
    expect(styles["font-variation-settings"]).toBe('"wght" 700, "wdth" 87, "opsz" 24');
  });

  it("omits font-variation-settings for an empty fontVariations object", () => {
    const styles = generateTextStyles(textNode({ fontVariations: {} }));
    expect(styles["font-variation-settings"]).toBeUndefined();
  });
});
