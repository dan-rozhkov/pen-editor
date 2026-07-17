import { describe, it, expect } from "vitest";
import { createSpatialGrid } from "../spatialGrid";

describe("spatialGrid", () => {
  it("returns exactly the intersecting rects (brute-force equivalence)", () => {
    const grid = createSpatialGrid(100);
    const rects = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    // deterministic pseudo-random layout
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 500; i++) {
      const x = rand() * 10000 - 5000, y = rand() * 10000 - 5000;
      const r = { minX: x, minY: y, maxX: x + rand() * 800, maxY: y + rand() * 800 };
      rects.set(`n${i}`, r);
      grid.set(`n${i}`, r);
    }
    const view = { minX: -500, minY: -500, maxX: 1500, maxY: 900 };
    const expected = new Set([...rects].filter(([, r]) =>
      !(r.maxX < view.minX || r.minX > view.maxX || r.maxY < view.minY || r.minY > view.maxY),
    ).map(([id]) => id));
    expect(grid.query(view)).toEqual(expected);
  });

  it("set() moves an entry; remove() drops it", () => {
    const grid = createSpatialGrid(100);
    grid.set("a", { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    grid.set("a", { minX: 5000, minY: 5000, maxX: 5010, maxY: 5010 });
    expect(grid.query({ minX: -50, minY: -50, maxX: 50, maxY: 50 }).has("a")).toBe(false);
    expect(grid.query({ minX: 4990, minY: 4990, maxX: 5050, maxY: 5050 }).has("a")).toBe(true);
    grid.remove("a");
    expect(grid.size()).toBe(0);
  });

  it("ignores non-finite rects: they are recorded but never indexed or returned, and remove() stays consistent", () => {
    const grid = createSpatialGrid(100);
    grid.set("bad", { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });
    expect(grid.size()).toBe(1);
    // A generous finite query rect must not hang and must not return the non-finite entry.
    const result = grid.query({ minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 });
    expect(result.has("bad")).toBe(false);

    grid.set("nan", { minX: NaN, minY: 0, maxX: 10, maxY: 10 });
    expect(grid.size()).toBe(2);
    expect(grid.query({ minX: -5000, minY: -5000, maxX: 5000, maxY: 5000 }).has("nan")).toBe(false);

    // A non-finite query rect is itself treated as intersecting nothing.
    expect(grid.query({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }).size).toBe(0);

    // remove() must not throw and must drop the entry from size(), even though it was never indexed.
    grid.remove("bad");
    grid.remove("nan");
    expect(grid.size()).toBe(0);
  });
});
