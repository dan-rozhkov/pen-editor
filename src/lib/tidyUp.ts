/**
 * "Tidy up" — pure clustering + arrangement algorithm for auto-arranging a
 * chaotic selection into a neat row/column/grid with equal (median) spacing.
 *
 * Deliberately store-agnostic: callers gather absolute rects for the current
 * selection (see `tidyUpNodes` in `@/utils/alignmentUtils`), pass them here,
 * and convert the returned absolute positions back into whatever coordinate
 * space they need. This keeps the algorithm trivially unit-testable.
 */

export interface TidyRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TidyPosition {
  id: string;
  x: number;
  y: number;
}

/** Gap used when there are fewer than two gaps to take a median from. */
const DEFAULT_GAP = 16;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function overlapFraction(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  const minLen = Math.min(aEnd - aStart, bEnd - bStart);
  if (minLen <= 0) return 0;
  return Math.max(0, overlap) / minLen;
}

/**
 * Cluster rects into groups whose projections onto one axis overlap by at
 * least `threshold` (fraction of the smaller extent). Membership is against
 * the cluster's growing bounds, so overlap is transitive: A~B and B~C put all
 * three in one cluster even if A and C don't directly overlap — intentional,
 * since "tidy up" flattens a staggered run into one clean row/column. Clusters
 * are returned sorted by their (growing) start position along that axis; items
 * within a cluster are NOT sorted.
 */
function clusterByOverlap(
  rects: TidyRect[],
  getStart: (r: TidyRect) => number,
  getEnd: (r: TidyRect) => number,
  threshold = 0.5,
): TidyRect[][] {
  const sorted = [...rects].sort((a, b) => getStart(a) - getStart(b));
  const clusters: { items: TidyRect[]; start: number; end: number }[] = [];

  for (const rect of sorted) {
    const start = getStart(rect);
    const end = getEnd(rect);
    const cluster = clusters.find(
      (c) =>
        overlapFraction(start, end, c.start, c.end) >= threshold ||
        overlapFraction(c.start, c.end, start, end) >= threshold,
    );
    if (cluster) {
      cluster.items.push(rect);
      cluster.start = Math.min(cluster.start, start);
      cluster.end = Math.max(cluster.end, end);
    } else {
      clusters.push({ items: [rect], start, end });
    }
  }

  clusters.sort((a, b) => a.start - b.start);
  return clusters.map((c) => c.items);
}

/** Cluster rects into rows by vertical-projection overlap, top to bottom. */
export function clusterIntoRows(rects: TidyRect[]): TidyRect[][] {
  return clusterByOverlap(
    rects,
    (r) => r.y,
    (r) => r.y + r.height,
  );
}

/** Cluster rects into columns by horizontal-projection overlap, left to right. */
export function clusterIntoColumns(rects: TidyRect[]): TidyRect[][] {
  return clusterByOverlap(
    rects,
    (r) => r.x,
    (r) => r.x + r.width,
  );
}

function gapsBetween(sorted: TidyRect[], axis: "x" | "y"): number[] {
  const sizeKey = axis === "x" ? "width" : "height";
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    gaps.push(Math.max(0, next[axis] - (current[axis] + current[sizeKey])));
  }
  return gaps;
}

/** Single row: sort left to right, place at the row's top with the median gap. */
function layoutRow(items: TidyRect[]): TidyPosition[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const gaps = gapsBetween(sorted, "x");
  const gap = gaps.length > 0 ? median(gaps) : DEFAULT_GAP;
  const top = Math.min(...sorted.map((r) => r.y));

  const positions: TidyPosition[] = [];
  let cursorX = Math.min(...sorted.map((r) => r.x));
  for (const item of sorted) {
    positions.push({ id: item.id, x: cursorX, y: top });
    cursorX += item.width + gap;
  }
  return positions;
}

/** Single column: sort top to bottom, place at the column's left with the median gap. */
function layoutColumn(items: TidyRect[]): TidyPosition[] {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  const gaps = gapsBetween(sorted, "y");
  const gap = gaps.length > 0 ? median(gaps) : DEFAULT_GAP;
  const left = Math.min(...sorted.map((r) => r.x));

  const positions: TidyPosition[] = [];
  let cursorY = Math.min(...sorted.map((r) => r.y));
  for (const item of sorted) {
    positions.push({ id: item.id, x: left, y: cursorY });
    cursorY += item.height + gap;
  }
  return positions;
}

/**
 * 2D grid: rows are already clustered top to bottom. Each row's items are
 * sorted left to right and assigned a column index by position within the
 * row (handles ragged rows sensibly — column width/gap is derived from
 * whichever rows happen to have an item at that index). Rows align to a
 * common top per row; columns align to a common left per column.
 */
function layoutGrid(rows: TidyRect[][]): TidyPosition[] {
  const sortedRows = rows.map((row) => [...row].sort((a, b) => a.x - b.x));

  const vGaps: number[] = [];
  for (let i = 0; i < sortedRows.length - 1; i++) {
    const bottom = Math.max(...sortedRows[i].map((r) => r.y + r.height));
    const nextTop = Math.min(...sortedRows[i + 1].map((r) => r.y));
    vGaps.push(Math.max(0, nextTop - bottom));
  }
  const vGap = vGaps.length > 0 ? median(vGaps) : DEFAULT_GAP;

  const hGaps: number[] = [];
  for (const row of sortedRows) {
    hGaps.push(...gapsBetween(row, "x"));
  }
  const hGap = hGaps.length > 0 ? median(hGaps) : DEFAULT_GAP;

  const nCols = Math.max(...sortedRows.map((row) => row.length));
  const colWidths: number[] = new Array(nCols).fill(0);
  for (const row of sortedRows) {
    row.forEach((item, colIndex) => {
      colWidths[colIndex] = Math.max(colWidths[colIndex], item.width);
    });
  }
  const rowHeights = sortedRows.map((row) =>
    Math.max(...row.map((r) => r.height)),
  );

  const startX = Math.min(...sortedRows.flat().map((r) => r.x));
  const colX: number[] = [startX];
  for (let j = 1; j < nCols; j++) {
    colX.push(colX[j - 1] + colWidths[j - 1] + hGap);
  }

  const startY = Math.min(...sortedRows.flat().map((r) => r.y));
  const rowY: number[] = [startY];
  for (let i = 1; i < sortedRows.length; i++) {
    rowY.push(rowY[i - 1] + rowHeights[i - 1] + vGap);
  }

  const positions: TidyPosition[] = [];
  sortedRows.forEach((row, i) => {
    row.forEach((item, j) => {
      positions.push({ id: item.id, x: colX[j], y: rowY[i] });
    });
  });
  return positions;
}

/**
 * Auto-arrange a chaotic selection into a neat row, column, or grid with
 * equal (median) spacing, preserving reading order (current position).
 *
 * 1. Cluster into rows by vertical overlap.
 * 2. One row → 1D row layout. Every row has exactly one item → 1D column
 *    layout. Otherwise → 2D grid, columns assigned by left-to-right order
 *    within each row.
 * 3. Gaps are the median of the current gaps along that axis (falling back
 *    to `DEFAULT_GAP` when there is nothing to measure a median from).
 */
export function tidyUp(rects: TidyRect[]): TidyPosition[] {
  if (rects.length === 0) return [];
  if (rects.length === 1) {
    return [{ id: rects[0].id, x: rects[0].x, y: rects[0].y }];
  }

  const rows = clusterIntoRows(rects);

  if (rows.length === 1) {
    return layoutRow(rows[0]);
  }
  if (rows.every((row) => row.length === 1)) {
    return layoutColumn(rows.map((row) => row[0]));
  }
  return layoutGrid(rows);
}
