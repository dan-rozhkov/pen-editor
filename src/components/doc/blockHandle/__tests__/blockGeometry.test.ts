import { describe, expect, it } from "vitest";
import { blockAtY, firstLineHeight, handleTop, HANDLE_SIZE, nearBlock, topLevelChild, type BlockRect } from "../blockGeometry";

const blocks: BlockRect[] = [
  { pos: 0, top: 100, bottom: 130 },
  { pos: 5, top: 133, bottom: 200 },
  { pos: 9, top: 260, bottom: 290 },
];

describe("blockAtY", () => {
  it.each([
    [110, 0],
    [131.5, 0],
    [150, 5],
    [205, 5],
    [270, 9],
  ])("y=%s is on the block at pos %s", (y, pos) => {
    expect(blockAtY(blocks, y)?.pos).toBe(pos);
  });

  it.each([[50], [230], [400]])("y=%s is too far from any block", (y) => {
    expect(blockAtY(blocks, y)).toBeNull();
  });

  it("handles an empty document", () => {
    expect(blockAtY([], 10)).toBeNull();
  });
});

describe("handleTop", () => {
  it("centres the handle on the first line", () => {
    expect(handleTop(200, 100, 24)).toBe(100);
    expect(handleTop(200, 100, 40)).toBe(100 + (40 - HANDLE_SIZE) / 2);
  });
});

describe("firstLineHeight", () => {
  it("uses a pixel line height", () => {
    expect(firstLineHeight("30px", "20px")).toBe(30);
  });
  it("falls back to 1.5 x font size for `normal`", () => {
    expect(firstLineHeight("normal", "20px")).toBe(30);
    expect(firstLineHeight("normal", "")).toBe(24);
  });
});

describe("topLevelChild / nearBlock", () => {
  it("finds the top-level child containing a nested target", () => {
    const root = document.createElement("div");
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    ul.append(li);
    root.append(ul, document.createElement("p"));
    expect(topLevelChild(root, li)).toBe(ul);
    expect(topLevelChild(root, ul)).toBe(ul);
    expect(topLevelChild(root, root)).toBeNull();
    expect(topLevelChild(root, document.createElement("div"))).toBeNull();
    expect(topLevelChild(root, null)).toBeNull();
  });

  it("nearBlock allows the inter-block gap only", () => {
    expect(nearBlock({ top: 100, bottom: 120 }, 110)).toBe(true);
    expect(nearBlock({ top: 100, bottom: 120 }, 124)).toBe(true);
    expect(nearBlock({ top: 100, bottom: 120 }, 140)).toBe(false);
  });
});
