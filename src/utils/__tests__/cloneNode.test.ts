import { describe, expect, it } from "vitest";
import { cloneNodeWithNewId } from "@/utils/cloneNode";
import { createShadowEffect, createSolidPaint } from "@/utils/fillUtils";
import type { FrameNode, TextNode } from "@/types/scene";

function makeTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "text-1",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "one\ntwo",
    paragraphs: [{ listType: "bullet" }, { listType: "bullet" }],
    ...overrides,
  } as TextNode;
}

function makePlainFrame(overrides: Partial<FrameNode> = {}): FrameNode {
  return {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    enabled: true,
    children: [],
    ...overrides,
  } as FrameNode;
}

describe("cloneNodeWithNewId — frame", () => {
  it("carries the paint stack and effects onto the cloned frame", () => {
    const frame = makePlainFrame({
      fills: [createSolidPaint("#ff0000"), createSolidPaint("#00ff00")],
      effects: [createShadowEffect()],
    });

    const result = cloneNodeWithNewId(frame) as FrameNode;

    expect(result.type).toBe("frame");
    expect(result.id).not.toBe(frame.id);
    expect(result.fills).toHaveLength(2);
    expect(result.fills?.[0].type).toBe("solid");
    expect(result.fills?.map((p) => (p.type === "solid" ? p.color : null))).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
    expect(result.effects).toHaveLength(1);
  });

  it("omits fills key when the frame has no fills", () => {
    const frame = makePlainFrame();

    const result = cloneNodeWithNewId(frame);

    expect(result.type).toBe("frame");
    expect("fills" in result).toBe(false);
    expect("effects" in result).toBe(false);
  });
});

describe("exportSettings survive duplicate/clone", () => {
  it("cloneNodeWithNewId carries exportSettings on an ordinary node", () => {
    const original = makeTextNode({
      exportSettings: [{ id: "es1", format: "png", scale: 2, suffix: "@2x" }],
    });

    const clone = cloneNodeWithNewId(original, false) as TextNode;

    expect(clone.exportSettings).toEqual(original.exportSettings);
  });
});

describe("text node clones do not alias the paragraphs array (finding 7b)", () => {
  it("cloneNodeWithNewId copies the array — mutating the clone leaves the original untouched", () => {
    const original = makeTextNode();
    const clone = cloneNodeWithNewId(original, false) as TextNode;

    expect(clone.paragraphs).toEqual(original.paragraphs);
    expect(clone.paragraphs).not.toBe(original.paragraphs);

    clone.paragraphs![0] = { listType: "number" };
    expect(original.paragraphs![0]).toEqual({ listType: "bullet" });
  });
});
