import { describe, expect, it } from "vitest";
import { tidyUp, type TidyRect } from "../tidyUp";

function byId(positions: { id: string; x: number; y: number }[]) {
  return Object.fromEntries(positions.map((p) => [p.id, p]));
}

describe("tidyUp", () => {
  it("returns an empty array for an empty selection", () => {
    expect(tidyUp([])).toEqual([]);
  });

  it("leaves a single rect untouched", () => {
    const rects: TidyRect[] = [{ id: "a", x: 42, y: 17, width: 10, height: 10 }];
    expect(tidyUp(rects)).toEqual([{ id: "a", x: 42, y: 17 }]);
  });

  it("lays out a single row with the median gap, preserving reading order", () => {
    // Chaotic gaps (10, 40, 10) and slight vertical jitter — should collapse
    // to one row using the median gap (10) and a common top.
    const rects: TidyRect[] = [
      { id: "a", x: 0, y: 5, width: 20, height: 20 },
      { id: "b", x: 30, y: 0, width: 20, height: 20 }, // gap 10
      { id: "c", x: 90, y: 8, width: 20, height: 20 }, // gap 40
      { id: "d", x: 120, y: 2, width: 20, height: 20 }, // gap 10
    ];

    const positions = byId(tidyUp(rects));

    // Common top across the row.
    const top = positions.a.y;
    expect(positions.b.y).toBe(top);
    expect(positions.c.y).toBe(top);
    expect(positions.d.y).toBe(top);

    // Median gap (10) applied between every consecutive pair, left to right.
    expect(positions.a.x).toBeLessThan(positions.b.x);
    expect(positions.b.x - (positions.a.x + 20)).toBe(10);
    expect(positions.c.x - (positions.b.x + 20)).toBe(10);
    expect(positions.d.x - (positions.c.x + 20)).toBe(10);
  });

  it("lays out a single column with the median gap, preserving reading order", () => {
    const rects: TidyRect[] = [
      { id: "a", x: 5, y: 0, width: 20, height: 20 },
      { id: "b", x: 0, y: 30, width: 20, height: 20 }, // gap 10
      { id: "c", x: 8, y: 90, width: 20, height: 20 }, // gap 40
      { id: "d", x: 2, y: 120, width: 20, height: 20 }, // gap 10
    ];

    const positions = byId(tidyUp(rects));

    const left = positions.a.x;
    expect(positions.b.x).toBe(left);
    expect(positions.c.x).toBe(left);
    expect(positions.d.x).toBe(left);

    expect(positions.a.y).toBeLessThan(positions.b.y);
    expect(positions.b.y - (positions.a.y + 20)).toBe(10);
    expect(positions.c.y - (positions.b.y + 20)).toBe(10);
    expect(positions.d.y - (positions.c.y + 20)).toBe(10);
  });

  it("lays out a chaotic 2x3 selection into a grid with equal gaps", () => {
    // Two rows of three items each, scattered around a nominal grid.
    const rects: TidyRect[] = [
      { id: "r0c0", x: 3, y: 0, width: 30, height: 30 },
      { id: "r0c1", x: 45, y: 6, width: 30, height: 30 }, // hgap ~12
      { id: "r0c2", x: 88, y: 2, width: 30, height: 30 }, // hgap ~13
      { id: "r1c0", x: 0, y: 60, width: 30, height: 30 }, // vgap ~30
      { id: "r1c1", x: 47, y: 55, width: 30, height: 30 },
      { id: "r1c2", x: 90, y: 62, width: 30, height: 30 },
    ];

    const positions = byId(tidyUp(rects));

    // Rows share a common top, columns share a common left.
    expect(positions.r0c1.y).toBe(positions.r0c0.y);
    expect(positions.r0c2.y).toBe(positions.r0c0.y);
    expect(positions.r1c1.y).toBe(positions.r1c0.y);
    expect(positions.r1c2.y).toBe(positions.r1c0.y);
    expect(positions.r1c0.x).toBe(positions.r0c0.x);
    expect(positions.r1c1.x).toBe(positions.r0c1.x);
    expect(positions.r1c2.x).toBe(positions.r0c2.x);

    // Row 1 is below row 0 with a positive gap.
    expect(positions.r1c0.y).toBeGreaterThan(positions.r0c0.y);
    // Columns are ordered left to right.
    expect(positions.r0c0.x).toBeLessThan(positions.r0c1.x);
    expect(positions.r0c1.x).toBeLessThan(positions.r0c2.x);

    // Gaps are equal across columns and across rows.
    const colGap1 = positions.r0c1.x - (positions.r0c0.x + 30);
    const colGap2 = positions.r0c2.x - (positions.r0c1.x + 30);
    expect(colGap1).toBe(colGap2);
    const rowGap = positions.r1c0.y - (positions.r0c0.y + 30);
    expect(rowGap).toBeGreaterThan(0);
  });

  it("lays out two stacked items as a single column", () => {
    // Two vertically-stacked, non-row-overlapping items collapse to a single
    // column: shared left edge, second item below the first. Exercises the
    // `layoutColumn` branch (every clustered row has exactly one item).
    const rects: TidyRect[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 4, y: 20, width: 20, height: 20 },
    ];
    const positions = byId(tidyUp(rects));
    expect(positions.a.x).toBe(positions.b.x);
    expect(positions.b.y).toBeGreaterThan(positions.a.y);
  });
});
