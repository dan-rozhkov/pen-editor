import { describe, it, expect } from "vitest";
import { getMaskMode, resolveMasking, isActiveMasker } from "../maskResolution";
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

  it("a hidden masker (visible: false) stops masking — its would-be-masked siblings render unmasked", () => {
    const nodesById = {
      mask: rect("mask", { isMask: true, visible: false }),
      a: rect("a"),
    };
    const { maskerIdBySiblingId, maskerIds } = resolveMasking(["mask", "a"], nodesById);
    expect(maskerIds.has("mask")).toBe(true); // still classified as a masker node...
    expect(maskerIdBySiblingId.has("a")).toBe(false); // ...but isn't actively masking
  });

  it("a hidden masker (enabled: false) stops masking", () => {
    const nodesById = {
      mask: rect("mask", { isMask: true, enabled: false }),
      a: rect("a"),
    };
    const { maskerIdBySiblingId } = resolveMasking(["mask", "a"], nodesById);
    expect(maskerIdBySiblingId.has("a")).toBe(false);
  });

  it("a hidden masker doesn't reset an earlier active masker's coverage", () => {
    const nodesById = {
      mask1: rect("mask1", { isMask: true }),
      hiddenMask: rect("hiddenMask", { isMask: true, visible: false }),
      a: rect("a"),
    };
    const { maskerIdBySiblingId } = resolveMasking(["mask1", "hiddenMask", "a"], nodesById);
    // mask1 is still the active masker past the hidden masker (a masker node
    // is never itself the target of `maskerIdBySiblingId` — same rule as "a
    // second masker starts a new group" above — but only when it's actually
    // active; a hidden one doesn't reset the chain for what comes after it).
    expect(maskerIdBySiblingId.get("a")).toBe("mask1");
  });

  it("re-hiding then re-showing a masker toggles its coverage back on", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      mask: rect("mask", { isMask: true, visible: false }),
      a: rect("a"),
    };
    expect(resolveMasking(["mask", "a"], nodesById).maskerIdBySiblingId.has("a")).toBe(false);

    nodesById.mask = rect("mask", { isMask: true, visible: true });
    expect(resolveMasking(["mask", "a"], nodesById).maskerIdBySiblingId.get("a")).toBe("mask");
  });
});

describe("isActiveMasker", () => {
  it("is false for a node without isMask", () => {
    expect(isActiveMasker(rect("a"))).toBe(false);
  });

  it("is true for a visible isMask node", () => {
    expect(isActiveMasker(rect("a", { isMask: true }))).toBe(true);
  });

  it("is false when isMask but visible: false or enabled: false", () => {
    expect(isActiveMasker(rect("a", { isMask: true, visible: false }))).toBe(false);
    expect(isActiveMasker(rect("a", { isMask: true, enabled: false }))).toBe(false);
  });

  it("is false for undefined/null", () => {
    expect(isActiveMasker(undefined)).toBe(false);
    expect(isActiveMasker(null)).toBe(false);
  });
});
