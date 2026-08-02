import { describe, it, expect } from "vitest";
import {
  resolveStrokeInsets,
  resolveContentInsets,
  nodeStrokeAffectsLayout,
  autoLayoutMinSize,
} from "@/utils/strokeInsets";
import type { BaseNode } from "@/types/scene";

const node = (extra: Partial<BaseNode>): BaseNode =>
  ({
    id: "n",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...extra,
  } as BaseNode);

describe("resolveStrokeInsets", () => {
  it("returns zero insets when there is no stroke at all", () => {
    expect(resolveStrokeInsets(node({}))).toEqual({
      top: 0, right: 0, bottom: 0, left: 0,
    });
  });

  it("returns zero for center strokes (default) — CSS outline semantics", () => {
    expect(
      resolveStrokeInsets(node({ stroke: "#000", strokeWidth: 8 })),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("returns zero for an explicit outside stroke", () => {
    expect(
      resolveStrokeInsets(
        node({ stroke: "#000", strokeWidth: 8, strokeAlign: "outside" }),
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("returns uniform insets for an inside stroke — CSS border semantics", () => {
    expect(
      resolveStrokeInsets(
        node({ stroke: "#000", strokeWidth: 8, strokeAlign: "inside" }),
      ),
    ).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });

  it("per-side widths take precedence over the uniform width, missing sides are 0", () => {
    expect(
      resolveStrokeInsets(
        node({
          stroke: "#000",
          strokeWidth: 8,
          strokeAlign: "inside",
          strokeWidthPerSide: { top: 2, left: 4 },
        }),
      ),
    ).toEqual({ top: 2, right: 0, bottom: 0, left: 4 });
  });

  it("returns zero when the inside stroke has no renderable paint", () => {
    // strokes: [] overrides the legacy `stroke` field per getStrokes()
    expect(
      resolveStrokeInsets(
        node({ strokes: [], strokeWidth: 8, strokeAlign: "inside" }),
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("respects the paint-stack model: invisible paint contributes nothing", () => {
    expect(
      resolveStrokeInsets(
        node({
          strokes: [{ type: "solid", color: "#000", visible: false } as never],
          strokeWidth: 8,
          strokeAlign: "inside",
        }),
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("zero-width inside stroke yields zero insets", () => {
    expect(
      resolveStrokeInsets(
        node({ stroke: "#000", strokeWidth: 0, strokeAlign: "inside" }),
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("an all-zero per-side override takes the per-side branch and yields zero insets, ignoring the uniform width (matches renderer's hasPerSideStroke: any side present, even 0, switches mode)", () => {
    expect(
      resolveStrokeInsets(
        node({
          stroke: "#000",
          strokeWidth: 8,
          strokeAlign: "inside",
          strokeWidthPerSide: { top: 0, right: 0, bottom: 0, left: 0 },
        }),
      ),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("resolveContentInsets", () => {
  it("sums layout padding and inside stroke per side", () => {
    const f = node({
      stroke: "#000",
      strokeWidth: 5,
      strokeAlign: "inside",
      layout: {
        paddingTop: 1,
        paddingRight: 2,
        paddingBottom: 3,
        paddingLeft: 4,
      },
    } as Partial<BaseNode>);
    expect(resolveContentInsets(f)).toEqual({
      top: 6,
      right: 7,
      bottom: 8,
      left: 9,
    });
  });

  it("is just padding when there's no inside stroke", () => {
    const f = node({
      layout: { paddingTop: 10, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
    } as Partial<BaseNode>);
    expect(resolveContentInsets(f)).toEqual({ top: 10, right: 0, bottom: 0, left: 0 });
  });
});

describe("nodeStrokeAffectsLayout", () => {
  it("returns the stroke insets for a rect (renderer honors strokeAlign)", () => {
    const n = node({ type: "rect", stroke: "#000", strokeWidth: 6, strokeAlign: "inside" });
    expect(nodeStrokeAffectsLayout(n)).toEqual({ top: 6, right: 6, bottom: 6, left: 6 });
  });

  it("returns zero for a text node even with an inside stroke — text never renders strokeAlign", () => {
    const n = node({
      type: "text",
      stroke: "#000",
      strokeWidth: 6,
      strokeAlign: "inside",
    } as Partial<BaseNode>);
    expect(nodeStrokeAffectsLayout(n)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("returns zero for a line node even with an inside stroke", () => {
    const n = node({
      type: "line",
      stroke: "#000",
      strokeWidth: 6,
      strokeAlign: "inside",
    } as Partial<BaseNode>);
    expect(nodeStrokeAffectsLayout(n)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("autoLayoutMinSize", () => {
  it("returns zero for non-frames and non-auto-layout frames", () => {
    expect(autoLayoutMinSize(node({}))).toEqual({ minWidth: 0, minHeight: 0 });
    expect(
      autoLayoutMinSize(node({ type: "frame" } as Partial<BaseNode>)),
    ).toEqual({ minWidth: 0, minHeight: 0 });
  });

  it("sums padding and inside stroke per axis for an auto-layout frame", () => {
    const f = node({
      type: "frame",
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside",
      layout: {
        autoLayout: true,
        paddingTop: 1,
        paddingRight: 2,
        paddingBottom: 3,
        paddingLeft: 4,
      },
    } as Partial<BaseNode>);
    expect(autoLayoutMinSize(f)).toEqual({
      minWidth: 4 + 2 + 10 + 10,
      minHeight: 1 + 3 + 10 + 10,
    });
  });
});
