import { describe, expect, it } from "vitest";
import { cloneNodeWithNewId, deepCloneNode } from "@/utils/cloneNode";
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

function makeReusableFrame(overrides: Partial<FrameNode> = {}): FrameNode {
  return {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    enabled: true,
    reusable: true,
    children: [],
    ...overrides,
  } as FrameNode;
}

describe("cloneNodeWithNewId — reusable frame -> ref", () => {
  it("carries the paint stack and effects onto the ref node", () => {
    const frame = makeReusableFrame({
      fills: [createSolidPaint("#ff0000"), createSolidPaint("#00ff00")],
      effects: [createShadowEffect()],
    });

    const result = cloneNodeWithNewId(frame);

    expect(result.type).toBe("ref");
    if (result.type !== "ref") throw new Error("expected ref node");
    expect(result.fills).toHaveLength(2);
    expect(result.fills?.[0].type).toBe("solid");
    expect(result.fills?.map((p) => (p.type === "solid" ? p.color : null))).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
    expect(result.effects).toHaveLength(1);
  });

  it("omits fills key when the reusable frame has no fills", () => {
    const frame = makeReusableFrame();

    const result = cloneNodeWithNewId(frame);

    expect(result.type).toBe("ref");
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

  it("deepCloneNode carries exportSettings on an ordinary node", () => {
    const original = makeTextNode({
      exportSettings: [{ id: "es1", format: "svg", scale: 1 }],
    });

    const clone = deepCloneNode(original) as TextNode;

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

  it("deepCloneNode copies the array — mutating the clone leaves the original untouched", () => {
    const original = makeTextNode();
    const clone = deepCloneNode(original) as TextNode;

    expect(clone.paragraphs).toEqual(original.paragraphs);
    expect(clone.paragraphs).not.toBe(original.paragraphs);

    clone.paragraphs![1] = { listType: "number" };
    expect(original.paragraphs![1]).toEqual({ listType: "bullet" });
  });
});
