import { describe, it, expect } from "vitest";
import { getParentContextFlat } from "../nodeUtils";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";

const autoLayoutFrame = {
  id: "frame1",
  type: "frame",
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  layout: { autoLayout: true },
} as unknown as FlatFrameNode;

const plainFrame = {
  id: "frame2",
  type: "frame",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
} as unknown as FlatFrameNode;

const rect = { id: "rect1", type: "rect", x: 0, y: 0, width: 10, height: 10 } as FlatSceneNode;

const nodesById: Record<string, FlatSceneNode> = {
  frame1: autoLayoutFrame,
  frame2: plainFrame,
  rect1: rect,
};

describe("getParentContextFlat", () => {
  it("returns null parent for a root node", () => {
    const ctx = getParentContextFlat(nodesById, { frame1: null }, "frame1");
    expect(ctx).toEqual({ parent: null, isInsideAutoLayout: false });
  });

  it("returns the parent frame and detects auto-layout", () => {
    const ctx = getParentContextFlat(nodesById, { rect1: "frame1" }, "rect1");
    expect(ctx.parent?.id).toBe("frame1");
    expect(ctx.isInsideAutoLayout).toBe(true);
  });

  it("detects a non-auto-layout parent", () => {
    const ctx = getParentContextFlat(nodesById, { rect1: "frame2" }, "rect1");
    expect(ctx.parent?.id).toBe("frame2");
    expect(ctx.isInsideAutoLayout).toBe(false);
  });

  it("returns null parent when parentById has no entry", () => {
    const ctx = getParentContextFlat(nodesById, {}, "rect1");
    expect(ctx).toEqual({ parent: null, isInsideAutoLayout: false });
  });
});
