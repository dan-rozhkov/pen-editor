import { describe, it, expect } from "vitest";
import { getMaskMode, resolveMasking } from "../maskResolution";
import type { FlatSceneNode } from "@/types/scene";

function rect(id: string, overrides: Partial<FlatSceneNode> = {}): FlatSceneNode {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  } as FlatSceneNode;
}

describe("getMaskMode", () => {
  it("returns 'vector' for shape nodes without an image fill", () => {
    expect(getMaskMode(rect("a"))).toBe("vector");
    expect(getMaskMode(rect("a", { type: "ellipse" } as Partial<FlatSceneNode>))).toBe("vector");
    expect(getMaskMode(rect("a", { type: "path", geometry: "M0 0" } as Partial<FlatSceneNode>))).toBe(
      "vector",
    );
  });

  it("returns 'alpha' for text nodes", () => {
    expect(
      getMaskMode(rect("a", { type: "text", text: "hi" } as Partial<FlatSceneNode>)),
    ).toBe("alpha");
  });

  it("returns 'alpha' for nodes with a legacy imageFill", () => {
    expect(
      getMaskMode(rect("a", { imageFill: { url: "https://x/y.png", mode: "fill" } })),
    ).toBe("alpha");
  });

  it("returns 'alpha' for nodes with an image paint in the fills stack", () => {
    expect(
      getMaskMode(
        rect("a", {
          fills: [{ id: "p1", type: "image", image: { url: "https://x/y.png", mode: "fill" } }],
        }),
      ),
    ).toBe("alpha");
  });

  it("returns 'vector' for a solid-fill rect even with fills set", () => {
    expect(
      getMaskMode(rect("a", { fills: [{ id: "p1", type: "solid", color: "#fff" }] })),
    ).toBe("vector");
  });
});

describe("resolveMasking", () => {
  it("returns empty resolution when no node is a mask", () => {
    const nodesById = { a: rect("a"), b: rect("b") };
    const { maskerIdBySiblingId, maskerIds } = resolveMasking(["a", "b"], nodesById);
    expect(maskerIds.size).toBe(0);
    expect(maskerIdBySiblingId.size).toBe(0);
  });

  it("masks every sibling above the masker (bottom of z-order)", () => {
    const nodesById = {
      mask: rect("mask", { isMask: true }),
      a: rect("a"),
      b: rect("b"),
    };
    const { maskerIdBySiblingId, maskerIds } = resolveMasking(["mask", "a", "b"], nodesById);
    expect(maskerIds.has("mask")).toBe(true);
    expect(maskerIdBySiblingId.get("a")).toBe("mask");
    expect(maskerIdBySiblingId.get("b")).toBe("mask");
  });

  it("does not mask siblings below the masker", () => {
    const nodesById = {
      below: rect("below"),
      mask: rect("mask", { isMask: true }),
      above: rect("above"),
    };
    const { maskerIdBySiblingId } = resolveMasking(["below", "mask", "above"], nodesById);
    expect(maskerIdBySiblingId.has("below")).toBe(false);
    expect(maskerIdBySiblingId.get("above")).toBe("mask");
  });

  it("a masker never masks itself", () => {
    const nodesById = { mask: rect("mask", { isMask: true }) };
    const { maskerIdBySiblingId } = resolveMasking(["mask"], nodesById);
    expect(maskerIdBySiblingId.has("mask")).toBe(false);
  });

  it("a second masker starts a new group, ending the previous one's coverage", () => {
    const nodesById = {
      mask1: rect("mask1", { isMask: true }),
      a: rect("a"),
      mask2: rect("mask2", { isMask: true }),
      b: rect("b"),
    };
    const { maskerIdBySiblingId, maskerIds } = resolveMasking(
      ["mask1", "a", "mask2", "b"],
      nodesById,
    );
    expect(maskerIds.has("mask1")).toBe(true);
    expect(maskerIds.has("mask2")).toBe(true);
    expect(maskerIdBySiblingId.get("a")).toBe("mask1");
    expect(maskerIdBySiblingId.get("b")).toBe("mask2");
  });

  it("a masker at the top of the stack (nothing above) masks nothing", () => {
    const nodesById = { a: rect("a"), mask: rect("mask", { isMask: true }) };
    const { maskerIdBySiblingId, maskerIds } = resolveMasking(["a", "mask"], nodesById);
    expect(maskerIds.has("mask")).toBe(true);
    expect(maskerIdBySiblingId.size).toBe(0);
  });

  it("ignores ids missing from nodesById (defensive)", () => {
    const nodesById = { a: rect("a") };
    expect(() => resolveMasking(["a", "missing"], nodesById)).not.toThrow();
  });
});
