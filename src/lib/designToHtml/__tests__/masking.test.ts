import { describe, it, expect } from "vitest";
import { convertNodeToHtml, type ConversionContext } from "../convertNode";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";

function frame(overrides: Partial<FlatFrameNode> = {}): FlatFrameNode {
  return {
    id: "frame",
    type: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    layout: { autoLayout: false },
    ...overrides,
  } as FlatFrameNode;
}

function rect(id: string, overrides: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fill: "#ff0000",
    ...overrides,
  } as unknown as FlatSceneNode;
}

function ellipse(id: string, overrides: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return { ...rect(id, overrides), type: "ellipse" } as FlatSceneNode;
}

function makeCtx(nodesById: Record<string, FlatSceneNode>, childrenById: Record<string, string[]>): ConversionContext {
  return { nodesById, childrenById, allNodes: [] };
}

describe("designToHtml masking", () => {
  it("does not render the masker node itself as content", () => {
    const nodesById = {
      frame: frame(),
      maskShape: rect("maskShape", { isMask: true }),
      content: rect("content"),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    // The masker contributes no visible box of its own.
    expect(html.match(/<div/g)?.length).toBe(2); // frame wrapper + content wrapper
  });

  it("applies a rect masker as clip-path: inset(...) on the masked sibling, in the sibling's local box", () => {
    const nodesById = {
      frame: frame(),
      maskShape: rect("maskShape", { x: 20, y: 20, width: 60, height: 60, isMask: true }),
      content: rect("content", { x: 0, y: 0, width: 200, height: 200 }),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    // localLeft/top = 20 - 0 = 20; right = 200 - (20+60) = 120; bottom = 200 - (20+60) = 120.
    expect(html).toContain("clip-path:inset(20px 120px 120px 20px)");
  });

  it("applies an ellipse masker as clip-path: ellipse(...)", () => {
    const nodesById = {
      frame: frame(),
      maskShape: ellipse("maskShape", { x: 20, y: 20, width: 60, height: 60, isMask: true }),
      content: rect("content", { x: 0, y: 0, width: 200, height: 200 }),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).toContain("clip-path:ellipse(30px 30px at 50px 50px)");
  });

  it("computes the clip relative to the masked sibling's own box, not the frame's", () => {
    const nodesById = {
      frame: frame(),
      maskShape: rect("maskShape", { x: 30, y: 30, width: 40, height: 40, isMask: true }),
      // content offset from the frame origin — the clip-path math must use
      // (masker - content) local offsets, not the frame-relative ones.
      content: rect("content", { x: 10, y: 10, width: 80, height: 80 }),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    // left = 30-10=20, top = 30-10=20, right = 80-(20+40)=20, bottom = 80-(20+40)=20.
    expect(html).toContain("clip-path:inset(20px 20px 20px 20px)");
  });

  it("leaves an unmasked sibling (below the masker, or with no masker at all) without a clip-path", () => {
    const nodesById = {
      frame: frame(),
      below: rect("below"),
      maskShape: rect("maskShape", { isMask: true }),
    };
    const childrenById = { frame: ["below", "maskShape"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).not.toContain("clip-path");
  });

  it("falls back to no clip (renders unmasked) for a path masker — not CSS-expressible here", () => {
    const nodesById = {
      frame: frame(),
      maskShape: {
        id: "maskShape",
        type: "path",
        x: 0,
        y: 0,
        width: 60,
        height: 60,
        geometry: "M0 0 L60 0 L30 60 Z",
        isMask: true,
      } as unknown as FlatSceneNode,
      content: rect("content"),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).not.toContain("clip-path");
    // Content still renders (unmasked), matching this exporter's no-warning
    // handling of other unsupported features.
    expect(html).toContain("background-color:#ff0000");
  });

  it("applies mask-image for an image-fill (alpha mode) masker", () => {
    const nodesById = {
      frame: frame(),
      maskShape: {
        id: "maskShape",
        type: "rect",
        x: 5,
        y: 5,
        width: 50,
        height: 50,
        isMask: true,
        fills: [{ id: "p1", type: "image", image: { url: "https://x/y.png", mode: "fit" } }],
      } as unknown as FlatSceneNode,
      content: rect("content", { x: 0, y: 0, width: 200, height: 200 }),
    };
    const childrenById = { frame: ["maskShape", "content"] };
    const html = convertNodeToHtml("frame", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).toContain('mask-image:url("https://x/y.png")');
    expect(html).toContain("mask-size:contain");
    expect(html).toContain("mask-position:5px 5px");
  });

  it("groups also apply sibling masking to their children", () => {
    const nodesById = {
      group: { id: "group", type: "group", x: 0, y: 0, width: 100, height: 100 } as unknown as FlatSceneNode,
      maskShape: rect("maskShape", { x: 10, y: 10, width: 20, height: 20, isMask: true }),
      content: rect("content", { x: 0, y: 0, width: 100, height: 100 }),
    };
    const childrenById = { group: ["maskShape", "content"] };
    const html = convertNodeToHtml("group", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).toContain("clip-path:inset(");
  });
});
