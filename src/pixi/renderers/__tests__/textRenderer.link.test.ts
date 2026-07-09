import { describe, expect, it } from "vitest";
import { Graphics } from "pixi.js";
import { buildTextStyle, createTextContainer } from "../textRenderer";
import { hasEffectiveUnderline, TEXT_LINK_COLOR } from "@/lib/textLink";
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
    text: "Sign up now",
    fontSize: 16,
    fontFamily: "Arial",
    ...overrides,
  } as TextNode;
}

describe("buildTextStyle: link color fallback", () => {
  it("defaults to black with no link and no fill", () => {
    const style = buildTextStyle(textNode());
    expect(style.fill).toBe("#000000");
  });

  it("uses TEXT_LINK_COLOR when linked and no explicit fill", () => {
    const style = buildTextStyle(textNode({ link: { url: "https://example.com" } }));
    expect(style.fill).toBe(TEXT_LINK_COLOR);
  });

  it("respects an explicit legacy fill over the link color", () => {
    const style = buildTextStyle(
      textNode({ link: { url: "https://example.com" }, fill: "#ff0000" }),
    );
    expect(style.fill).toBe("#ff0000");
  });

  it("respects an explicit fills-stack solid paint over the link color", () => {
    const style = buildTextStyle(
      textNode({
        link: { url: "https://example.com" },
        fills: [{ id: "p1", type: "solid", color: "#00ff00" }],
      }),
    );
    expect(style.fill).toBe("#00ff00");
  });
});

describe("hasEffectiveUnderline: link forces an underline decoration", () => {
  it("is true for a linked node even with underline unset", () => {
    expect(hasEffectiveUnderline({ link: { url: "https://example.com" } })).toBe(true);
  });

  it("is false for a plain node with no link/underline", () => {
    expect(hasEffectiveUnderline({})).toBe(false);
  });

  it("is true for underline alone (no link)", () => {
    expect(hasEffectiveUnderline({ underline: true })).toBe(true);
  });
});

describe("createTextContainer: draws no decoration for a plain node", () => {
  it("emits no text-decorations Graphics with no link/underline/strikethrough", () => {
    const container = createTextContainer(textNode());
    const deco = container.getChildByLabel("text-decorations") as Graphics | null;
    expect(deco).toBeNull();
  });
});
