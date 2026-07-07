import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { createTextContainer, updateTextContainer } from "../textRenderer";
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
    text: "one\ntwo",
    fontSize: 16,
    fontFamily: "Arial",
    textWidthMode: "fixed",
    paragraphs: [{ listType: "bullet" }, { listType: "bullet" }],
    ...overrides,
  } as TextNode;
}

/** The list-rendering path's wrapper container, so tests can tell whether `updateTextContainer` rebuilt it (new object) or left it alone (same object) without depending on `LIST_ROOT_LABEL` being exported. */
function listRoot(container: Container): Container | undefined {
  return container.getChildByLabel("text-list-root") as Container | undefined;
}

describe("updateTextContainer — list-node rebuild gate (finding 6)", () => {
  it("skips the rebuild entirely on a position-only (x/y) update", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);
    expect(before).toBeDefined();

    const moved = { ...node, x: node.x + 50, y: node.y + 25 };
    updateTextContainer(container, moved, node);

    const after = listRoot(container);
    expect(after).toBe(before); // same object — no destroy/rebuild happened
  });

  it("skips the rebuild when an unrelated field changes (e.g. isMask)", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);

    const updated = { ...node, isMask: true } as TextNode;
    updateTextContainer(container, updated, node);

    expect(listRoot(container)).toBe(before);
  });

  it("rebuilds when text changes", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);

    const updated = { ...node, text: "one\ntwo\nthree", paragraphs: [{ listType: "bullet" as const }, { listType: "bullet" as const }, {}] };
    updateTextContainer(container, updated, node);

    expect(listRoot(container)).not.toBe(before);
  });

  it("rebuilds when paragraphs (list formatting) changes", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);

    const updated = { ...node, paragraphs: [{ listType: "number" as const }, { listType: "number" as const }] };
    updateTextContainer(container, updated, node);

    expect(listRoot(container)).not.toBe(before);
  });

  it("rebuilds on a width change (wrapping depends on it)", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);

    const updated = { ...node, width: node.width + 100 };
    updateTextContainer(container, updated, node);

    expect(listRoot(container)).not.toBe(before);
  });

  it("rebuilds on a textAlign change", () => {
    const node = textNode();
    const container = createTextContainer(node);
    const before = listRoot(container);

    const updated = { ...node, textAlign: "center" as const };
    updateTextContainer(container, updated, node);

    expect(listRoot(container)).not.toBe(before);
  });
});
