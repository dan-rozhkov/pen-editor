import { describe, expect, it } from "vitest";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import type { FrameNode, RectNode } from "@/types/scene";

function exportNodes(nodes: (FrameNode | RectNode)[]) {
  const json = serializePublicPenDocument(nodes, [], "light");
  return JSON.parse(json);
}

function frame(overrides: Partial<FrameNode>): FrameNode {
  return {
    id: "frame-1",
    type: "frame",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    children: [],
    ...overrides,
  };
}

describe("publicPenExport: wrap / row-column gap", () => {
  it("exports wrap: true for a wrapping auto-layout frame", () => {
    const node = frame({
      layout: { autoLayout: true, flexDirection: "row", flexWrap: true, gap: 10 },
    });
    const exported = exportNodes([node]).children[0];
    expect(exported.wrap).toBe(true);
    expect(exported.gap).toBe(10);
  });

  it("omits wrap for a non-wrapping frame", () => {
    const node = frame({
      layout: { autoLayout: true, flexDirection: "row", gap: 10 },
    });
    const exported = exportNodes([node]).children[0];
    expect(exported.wrap).toBeUndefined();
  });

  it("exports separate rowGap/columnGap when they diverge", () => {
    const node = frame({
      layout: {
        autoLayout: true,
        flexDirection: "row",
        flexWrap: true,
        rowGap: 24,
        columnGap: 8,
      },
    });
    const exported = exportNodes([node]).children[0];
    expect(exported.rowGap).toBe(24);
    expect(exported.columnGap).toBe(8);
    expect(exported.gap).toBeUndefined();
  });

  it("collapses to a single resolved gap when rowGap/columnGap match, even with no base gap set", () => {
    const node = frame({
      layout: {
        autoLayout: true,
        flexDirection: "row",
        flexWrap: true,
        rowGap: 12,
        columnGap: 12,
      },
    });
    const exported = exportNodes([node]).children[0];
    // Both axes resolve to 12 (rowGap/columnGap, no base `gap` set) — that
    // resolved value must still round-trip as `gap: 12`, not silently drop
    // to zero on import.
    expect(exported.gap).toBe(12);
    expect(exported.rowGap).toBeUndefined();
    expect(exported.columnGap).toBeUndefined();
  });

  it("resolves a rowGap-only override against the base gap instead of collapsing to it", () => {
    // { rowGap: 24, gap: 8 } means: row-gap (between lines) is 24, but
    // column-gap (between items in a row) falls back to the shared gap, 8.
    // The two resolved values (24 vs 8) diverge, so they must export as
    // independent rowGap/columnGap — collapsing to `{ gap: 8 }` would lose
    // the rowGap override entirely.
    const node = frame({
      layout: {
        autoLayout: true,
        flexDirection: "row",
        flexWrap: true,
        rowGap: 24,
        gap: 8,
      },
    });
    const exported = exportNodes([node]).children[0];
    expect(exported.rowGap).toBe(24);
    expect(exported.columnGap).toBe(8);
    expect(exported.gap).toBeUndefined();
  });
});

describe("publicPenExport: min/max width/height", () => {
  it("exports min/max sizing constraints on any node", () => {
    const node: RectNode = {
      id: "rect-1",
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      sizing: { minWidth: 50, maxWidth: 400, minHeight: 20, maxHeight: 300 },
    };
    const exported = exportNodes([node]).children[0];
    expect(exported.minWidth).toBe(50);
    expect(exported.maxWidth).toBe(400);
    expect(exported.minHeight).toBe(20);
    expect(exported.maxHeight).toBe(300);
  });

  it("omits min/max fields when unset", () => {
    const node: RectNode = {
      id: "rect-1",
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    const exported = exportNodes([node]).children[0];
    expect(exported.minWidth).toBeUndefined();
    expect(exported.maxWidth).toBeUndefined();
    expect(exported.minHeight).toBeUndefined();
    expect(exported.maxHeight).toBeUndefined();
  });
});
