import { describe, it, expect } from "vitest";
import {
  inferAutoLayoutFromGeometry,
  type InferChildRect,
} from "@/utils/inferAutoLayoutFromGeometry";

function frame(width: number, height: number) {
  return { width, height };
}

describe("inferAutoLayoutFromGeometry", () => {
  it("infers column direction + equal gap for vertically stacked children", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 10, y: 10, width: 100, height: 20 },
      { id: "b", x: 10, y: 40, width: 100, height: 20 },
      { id: "c", x: 10, y: 70, width: 100, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(120, 100), children });

    expect(result.layout.flexDirection).toBe("column");
    expect(result.layout.gap).toBe(10);
    expect(result.orderedIds).toEqual(["a", "b", "c"]);
  });

  it("infers row direction + equal gap for horizontally stacked children", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 10, y: 10, width: 50, height: 30 },
      { id: "b", x: 70, y: 10, width: 50, height: 30 },
      { id: "c", x: 130, y: 10, width: 50, height: 30 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(190, 50), children });

    expect(result.layout.flexDirection).toBe("row");
    expect(result.layout.gap).toBe(10);
    expect(result.orderedIds).toEqual(["a", "b", "c"]);
  });

  it("orders children visually even when the tree/z-order is reversed", () => {
    // z-order (array position) is c, b, a — but visually a is on top.
    const children: InferChildRect[] = [
      { id: "c", x: 0, y: 80, width: 50, height: 20 },
      { id: "b", x: 0, y: 40, width: 50, height: 20 },
      { id: "a", x: 0, y: 0, width: 50, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(50, 100), children });

    expect(result.layout.flexDirection).toBe("column");
    expect(result.orderedIds).toEqual(["a", "b", "c"]);
  });

  it("uses the median gap when gaps are unequal", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 0, y: 0, width: 50, height: 20 }, // ends at 20
      { id: "b", x: 0, y: 30, width: 50, height: 20 }, // gap 10, ends at 50
      { id: "c", x: 0, y: 70, width: 50, height: 20 }, // gap 20, ends at 90
      { id: "d", x: 0, y: 106, width: 50, height: 20 }, // gap 16
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(50, 126), children });

    // gaps: 10, 20, 16 -> median 16
    expect(result.layout.gap).toBe(16);
  });

  it("returns column + zero gap/padding for a single child", () => {
    const children: InferChildRect[] = [{ id: "a", x: 5, y: 5, width: 40, height: 20 }];
    const result = inferAutoLayoutFromGeometry({ frame: frame(50, 30), children });

    expect(result.layout.flexDirection).toBe("column");
    expect(result.layout.gap).toBe(0);
    expect(result.orderedIds).toEqual(["a"]);
  });

  it("returns all-zero layout for zero children", () => {
    const result = inferAutoLayoutFromGeometry({ frame: frame(100, 100), children: [] });

    expect(result.layout).toMatchObject({
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    });
    expect(result.orderedIds).toEqual([]);
  });

  it("derives padding from the children's bbox relative to the frame", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 20, y: 15, width: 60, height: 20 },
      { id: "b", x: 20, y: 45, width: 60, height: 20 },
    ];
    // frame 100x100, children bbox: x 20..80, y 15..65
    const result = inferAutoLayoutFromGeometry({ frame: frame(100, 100), children });

    expect(result.layout.paddingLeft).toBe(20);
    expect(result.layout.paddingTop).toBe(15);
    expect(result.layout.paddingRight).toBe(20); // 100 - 80
    expect(result.layout.paddingBottom).toBe(35); // 100 - 65
  });

  it("subtracts the frame's inside-stroke width from inferred padding", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 20, y: 20, width: 60, height: 20 },
      { id: "b", x: 20, y: 50, width: 60, height: 20 },
    ];
    // frame 100x100, children bbox: x 20..80, y 20..70 -> raw padding 20/20/20/30
    const strokedFrame = {
      width: 100,
      height: 100,
      stroke: "#000",
      strokeWidth: 10,
      strokeAlign: "inside" as const,
    };
    const result = inferAutoLayoutFromGeometry({ frame: strokedFrame, children });

    expect(result.layout.paddingLeft).toBe(10); // 20 - 10
    expect(result.layout.paddingTop).toBe(10); // 20 - 10
    expect(result.layout.paddingRight).toBe(10); // 20 - 10
    expect(result.layout.paddingBottom).toBe(20); // 30 - 10
  });

  it("infers full offset as padding for a frame without a stroke (control)", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 20, y: 20, width: 60, height: 20 },
      { id: "b", x: 20, y: 50, width: 60, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(100, 100), children });

    expect(result.layout.paddingLeft).toBe(20);
    expect(result.layout.paddingTop).toBe(20);
  });

  it("infers stretch alignItems when children span the full cross-axis content width", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 0, y: 0, width: 100, height: 20 },
      { id: "b", x: 0, y: 30, width: 100, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(100, 50), children });
    expect(result.layout.alignItems).toBe("stretch");
  });

  it("infers center alignItems when children's cross-axis centers line up", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 25, y: 0, width: 50, height: 20 },
      { id: "b", x: 10, y: 30, width: 80, height: 20 }, // same center (50) as a
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(100, 50), children });
    expect(result.layout.alignItems).toBe("center");
  });

  it("infers flex-start alignItems when only children's starts line up", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 10, y: 0, width: 50, height: 20 },
      { id: "b", x: 10, y: 30, width: 80, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(120, 50), children });
    expect(result.layout.alignItems).toBe("flex-start");
  });

  it("infers flex-end alignItems when only children's ends line up", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 60, y: 0, width: 50, height: 20 }, // ends at 110
      { id: "b", x: 30, y: 30, width: 80, height: 20 }, // ends at 110
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(120, 50), children });
    expect(result.layout.alignItems).toBe("flex-end");
  });

  it("clamps overlapping children to a zero gap instead of a negative value", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 0, y: 0, width: 50, height: 40 },
      { id: "b", x: 0, y: 20, width: 50, height: 40 }, // overlaps a by 20px
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(50, 60), children });
    expect(result.layout.gap).toBe(0);
    expect(result.layout.gap).toBeGreaterThanOrEqual(0);
  });

  it("always returns flex-start justifyContent (never infers space-between)", () => {
    const children: InferChildRect[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 0, y: 40, width: 20, height: 20 },
      { id: "c", x: 0, y: 80, width: 20, height: 20 },
    ];
    const result = inferAutoLayoutFromGeometry({ frame: frame(20, 100), children });
    expect(result.layout.justifyContent).toBe("flex-start");
  });
});
