import { describe, expect, it } from "vitest";
import {
  columnCountForWidth,
  columnOffset,
  distributeIntoColumns,
} from "@/components/showcase/masonry";

describe("distributeIntoColumns", () => {
  it("deals items left→right across a row, so the newest lands top-left", () => {
    expect(distributeIntoColumns([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 4, 7],
      [2, 5],
      [3, 6],
    ]);
  });

  it("keeps empty trailing columns rather than collapsing them", () => {
    expect(distributeIntoColumns([1, 2], 4)).toEqual([[1], [2], [], []]);
  });

  it("never divides by zero", () => {
    expect(distributeIntoColumns([1, 2], 0)).toEqual([[1, 2]]);
  });
});

describe("columnCountForWidth", () => {
  it("matches the Tailwind breakpoints the grid used to key off", () => {
    expect(columnCountForWidth(390)).toBe(2);
    expect(columnCountForWidth(639)).toBe(2);
    expect(columnCountForWidth(640)).toBe(3);
    expect(columnCountForWidth(1024)).toBe(4);
    expect(columnCountForWidth(1440)).toBe(5);
  });
});

describe("columnOffset", () => {
  it("staggers odd columns downward so uniform screens still read as masonry", () => {
    expect(columnOffset(0)).toBe(0);
    expect(columnOffset(1)).toBeGreaterThan(0);
    expect(columnOffset(2)).toBe(0);
    expect(columnOffset(3)).toBeGreaterThan(0);
  });
});
