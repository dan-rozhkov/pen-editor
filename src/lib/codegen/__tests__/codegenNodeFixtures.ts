import type { FlatFrameNode, RectNode, TextNode } from "@/types/scene";

// Shared node fixtures for react.test.ts and tailwind.test.ts — both
// exercise the same codegen node shapes (auto-layout frame, text, an
// unsupported `path` child) against their respective code generators.

export function frameNode(overrides: Partial<FlatFrameNode> = {}): FlatFrameNode {
  return {
    id: "frame1",
    type: "frame",
    name: "Card",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    },
    ...overrides,
  } as unknown as FlatFrameNode;
}

export function titleText(text = "Hello & <world>"): TextNode {
  return {
    id: "text1",
    type: "text",
    name: "Title",
    x: 0,
    y: 0,
    width: 120,
    height: 24,
    text,
    fontSize: 16,
    fontWeight: "700",
  } as unknown as TextNode;
}

/** An unsupported `path` node — every generator falls back to an empty
 * placeholder plus a "vector" warning for this type. */
export function pathNode(): RectNode {
  return {
    id: "path1",
    type: "path",
    name: "Icon",
    x: 0,
    y: 0,
    width: 50,
    height: 20,
  } as unknown as RectNode;
}
