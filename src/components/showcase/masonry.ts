import { useEffect, useState } from "react";

// Breakpoints mirror the Tailwind ones the grid used to key off
// (`columns-2 sm:columns-3 lg:columns-4 xl:columns-5`).
const BREAKPOINTS: Array<{ minWidth: number; columns: number }> = [
  { minWidth: 1280, columns: 5 },
  { minWidth: 1024, columns: 4 },
  { minWidth: 640, columns: 3 },
  { minWidth: 0, columns: 2 },
];

export function columnCountForWidth(width: number): number {
  return BREAKPOINTS.find((b) => width >= b.minWidth)?.columns ?? 2;
}

/**
 * Deal items across columns round-robin, so reading order runs left→right
 * across each row and the newest item lands top-left. CSS multi-column does
 * the opposite: it fills column 1 top-to-bottom before starting column 2,
 * which buried the newest screens at the top of a column nobody reads first.
 */
export function distributeIntoColumns<T>(items: T[], columns: number): T[][] {
  const count = Math.max(1, columns);
  const result: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, i) => {
    result[i % count].push(item);
  });
  return result;
}

/**
 * Vertical head-start for each column, in pixels. Staggering the odd columns
 * breaks the row grid up so uniformly-sized screens still read as masonry
 * rather than as a table.
 */
export function columnOffset(columnIndex: number): number {
  return columnIndex % 2 === 1 ? 72 : 0;
}

export function useColumnCount(): number {
  const [columns, setColumns] = useState(() =>
    columnCountForWidth(
      typeof window === "undefined" ? 1280 : window.innerWidth,
    ),
  );

  useEffect(() => {
    const update = () => setColumns(columnCountForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return columns;
}
