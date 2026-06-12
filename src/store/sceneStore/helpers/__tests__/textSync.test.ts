import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import { syncTextDimensions } from "@/store/sceneStore/helpers/textSync";

// 8px/char stub from src/test/setup.ts.
const CHAR = 8;

function textNode(overrides: Partial<TextNode>): TextNode {
  return {
    id: "t",
    type: "text",
    name: "T",
    x: 100,
    y: 100,
    width: 80,
    height: 20,
    text: "hello",
    fontSize: 16,
    lineHeight: 1.2,
    textWidthMode: "auto",
    ...overrides,
  } as TextNode;
}

describe("syncTextDimensions", () => {
  it("auto mode re-measures width and height", () => {
    const node = textNode({ text: "hello", width: 999, height: 999 });
    const synced = syncTextDimensions(node) as TextNode;
    expect(synced.width).toBe(5 * CHAR); // "hello"
    expect(synced.height).toBe(Math.ceil(16 * 1.2));
  });

  it("fixed mode re-measures height only, leaves width", () => {
    // width 24 => 3 chars/line, "aaa bbb ccc" => 3 lines.
    const node = textNode({
      text: "aaa bbb ccc",
      width: 3 * CHAR,
      height: 5,
      textWidthMode: "fixed",
    });
    const synced = syncTextDimensions(node) as TextNode;
    expect(synced.width).toBe(3 * CHAR);
    expect(synced.height).toBe(Math.ceil(3 * 16 * 1.2));
  });

  it("fixed-height -> fixed re-measures height with the new mode", () => {
    // Simulate the store merge: a node that was fixed-height, now switched to
    // fixed; syncTextDimensions must hug height to the wrapped content.
    const node = textNode({
      text: "aaa bbb ccc",
      width: 3 * CHAR,
      height: 200, // stale tall height from fixed-height
      textWidthMode: "fixed",
    });
    const synced = syncTextDimensions(node) as TextNode;
    expect(synced.height).toBe(Math.ceil(3 * 16 * 1.2));
  });

  it("fixed-height mode is a no-op", () => {
    const node = textNode({
      width: 40,
      height: 40,
      textWidthMode: "fixed-height",
    });
    const synced = syncTextDimensions(node) as TextNode;
    expect(synced).toBe(node);
  });

  it("auto + left align keeps x fixed", () => {
    const node = textNode({ text: "hello", width: 999, x: 100 });
    const synced = syncTextDimensions(node) as TextNode;
    expect(synced.x).toBe(100);
  });

  it("auto + center align keeps the center fixed (x shifts by half the delta)", () => {
    const node = textNode({
      text: "hello",
      width: 100,
      x: 100,
      textAlign: "center",
    });
    const synced = syncTextDimensions(node) as TextNode;
    const newW = 5 * CHAR; // 40
    expect(synced.width).toBe(newW);
    expect(synced.x).toBe(Math.round(100 - (newW - 100) / 2)); // 130
  });

  it("auto + right align keeps the right edge fixed (x shifts by full delta)", () => {
    const node = textNode({
      text: "hello",
      width: 100,
      x: 100,
      textAlign: "right",
    });
    const synced = syncTextDimensions(node) as TextNode;
    const newW = 5 * CHAR; // 40
    expect(synced.x).toBe(100 - (newW - 100)); // 160
  });
});
