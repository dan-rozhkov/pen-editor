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

function makeCtx(nodesById: Record<string, FlatSceneNode>, childrenById: Record<string, string[]>): ConversionContext {
  return { nodesById, childrenById, allNodes: [], isComponent: true };
}

describe("designToHtml slot naming — untrusted node.name in slot attribute", () => {
  it("escapes a quote in an isSlot node's name so it cannot break out of the slot attribute", () => {
    const nodesById = {
      root: frame(),
      slotChild: rect("slotChild", {
        type: "frame",
        isSlot: true,
        name: '"><img src=x onerror=alert(1)>',
      } as Partial<FlatFrameNode>),
    };
    const childrenById = { root: ["slotChild"] };
    const html = convertNodeToHtml("root", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).not.toContain('"><img');
    expect(html).toContain("&quot;&gt;&lt;img");
  });

  it("escapes a quote in a 'slot:' naming-convention node so it cannot break out of the slot attribute", () => {
    const nodesById = {
      root: frame(),
      slotChild: rect("slotChild", { name: 'slot:"><svg onload=alert(1)>' }),
    };
    const childrenById = { root: ["slotChild"] };
    const html = convertNodeToHtml("root", makeCtx(nodesById, childrenById), undefined, true);

    expect(html).not.toContain('"><svg');
    expect(html).toContain("&quot;&gt;&lt;svg");
  });
});
