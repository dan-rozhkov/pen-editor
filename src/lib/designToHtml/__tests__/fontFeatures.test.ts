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

describe("designToHtml generateTextStyles: font-feature-settings", () => {
  it("omits font-feature-settings when fontFeatures is unset", () => {
    const styles = generateTextStyles(textNode());
    expect(styles["font-feature-settings"]).toBeUndefined();
  });

  it("emits a single-tag font-feature-settings value", () => {
    const styles = generateTextStyles(textNode({ fontFeatures: { dlig: 1 } }));
    expect(styles["font-feature-settings"]).toBe('"dlig" 1');
  });

  it("emits a multi-tag font-feature-settings value in insertion order", () => {
    const styles = generateTextStyles(
      textNode({ fontFeatures: { dlig: 1, tnum: 1, ss03: 1 } }),
    );
    expect(styles["font-feature-settings"]).toBe('"dlig" 1, "tnum" 1');
  });

  it("omits font-feature-settings for an empty fontFeatures object", () => {
    const styles = generateTextStyles(textNode({ fontFeatures: {} }));
    expect(styles["font-feature-settings"]).toBeUndefined();
  });
});
