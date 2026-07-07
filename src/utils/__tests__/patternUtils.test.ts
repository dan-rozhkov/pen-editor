import { describe, expect, it } from "vitest";
import {
  computePatternCell,
  normalizePattern,
  patternNeedsCellBake,
} from "@/utils/patternUtils";
import type { PatternFill } from "@/types/scene";

const tile = (overrides: Partial<PatternFill> = {}): PatternFill => ({
  url: "https://example.com/tile.png",
  ...overrides,
});

describe("normalizePattern", () => {
  it("applies defaults for all omitted params", () => {
    expect(normalizePattern(tile())).toEqual({
      scale: 1,
      spacingX: 0,
      spacingY: 0,
      offsetX: 0,
      offsetY: 0,
      rowOffset: 0,
    });
  });

  it("clamps non-positive / non-finite scale to 1", () => {
    expect(normalizePattern(tile({ scale: 0 })).scale).toBe(1);
    expect(normalizePattern(tile({ scale: -2 })).scale).toBe(1);
    expect(normalizePattern(tile({ scale: Number.NaN })).scale).toBe(1);
    expect(normalizePattern(tile({ scale: 0.5 })).scale).toBe(0.5);
  });

  it("clamps negative spacing to 0 and wraps rowOffset into [0, 1)", () => {
    const n = normalizePattern(
      tile({ spacingX: -5, spacingY: -1, rowOffset: 1.25 }),
    );
    expect(n.spacingX).toBe(0);
    expect(n.spacingY).toBe(0);
    expect(n.rowOffset).toBeCloseTo(0.25);
    expect(normalizePattern(tile({ rowOffset: -0.25 })).rowOffset).toBeCloseTo(0.75);
    expect(normalizePattern(tile({ rowOffset: 1 })).rowOffset).toBe(0);
  });

  it("passes through offsets (including negative)", () => {
    const n = normalizePattern(tile({ offsetX: -3, offsetY: 7 }));
    expect(n.offsetX).toBe(-3);
    expect(n.offsetY).toBe(7);
  });
});

describe("patternNeedsCellBake", () => {
  it("is false for plain scaled tiling (scale handled via tileScale)", () => {
    expect(patternNeedsCellBake(tile())).toBe(false);
    expect(patternNeedsCellBake(tile({ scale: 2 }))).toBe(false);
  });

  it("is true when spacing or row offset is in play", () => {
    expect(patternNeedsCellBake(tile({ spacingX: 4 }))).toBe(true);
    expect(patternNeedsCellBake(tile({ spacingY: 4 }))).toBe(true);
    expect(patternNeedsCellBake(tile({ rowOffset: 0.5 }))).toBe(true);
    // rowOffset that wraps to 0 needs no bake
    expect(patternNeedsCellBake(tile({ rowOffset: 1 }))).toBe(false);
  });
});

describe("computePatternCell", () => {
  it("a bare tile maps to a single-placement cell at tile size", () => {
    const cell = computePatternCell(tile(), 10, 20);
    expect(cell).toEqual({
      tileWidth: 10,
      tileHeight: 20,
      cellWidth: 10,
      cellHeight: 20,
      placements: [{ x: 0, y: 0 }],
    });
  });

  it("scale multiplies the tile size", () => {
    const cell = computePatternCell(tile({ scale: 0.5 }), 10, 20);
    expect(cell.tileWidth).toBe(5);
    expect(cell.tileHeight).toBe(10);
    expect(cell.cellWidth).toBe(5);
    expect(cell.cellHeight).toBe(10);
  });

  it("spacing grows the cell around a single placement", () => {
    const cell = computePatternCell(tile({ spacingX: 4, spacingY: 6 }), 10, 20);
    expect(cell.cellWidth).toBe(14);
    expect(cell.cellHeight).toBe(26);
    expect(cell.placements).toEqual([{ x: 0, y: 0 }]);
  });

  it("rowOffset doubles the cell height and staggers the second row with a wrap copy", () => {
    const cell = computePatternCell(tile({ rowOffset: 0.5 }), 10, 10);
    expect(cell.cellWidth).toBe(10);
    expect(cell.cellHeight).toBe(20);
    // row 0 at origin; row 1 shifted by 0.5 * cellWidth with a wrapped copy.
    expect(cell.placements).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 10 },
      { x: -5, y: 10 },
    ]);
  });

  it("rowOffset combines with spacing (shift is a fraction of the full cell width)", () => {
    const cell = computePatternCell(
      tile({ rowOffset: 0.25, spacingX: 2, spacingY: 4 }),
      10,
      10,
    );
    expect(cell.cellWidth).toBe(12);
    expect(cell.cellHeight).toBe(28); // 2 * (10 + 4)
    expect(cell.placements).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 14 },
      { x: -9, y: 14 },
    ]);
  });

  it("guards degenerate texture sizes to at least 1px", () => {
    const cell = computePatternCell(tile(), 0, 0);
    expect(cell.tileWidth).toBe(1);
    expect(cell.tileHeight).toBe(1);
  });
});
