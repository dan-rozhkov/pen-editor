/** A rect in plain numbers (DOMRect subset), so the helpers run without layout. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Short side of a grip pill; the row grip sits on the left border, the column grip on the top border. */
export const GRIP_THICKNESS = 12;
/** Long side of a grip pill. */
export const GRIP_LENGTH = 22;
/**
 * The row grip extends this far left of the table. The block handle ends 6px (its pr-1.5) left of the
 * container, so a grip reaching at most 5px out never touches its buttons.
 */
export const ROW_GRIP_OVERHANG = 5;
/** Thickness of the "+" bars that add a row / column. */
export const BAR_SIZE = 14;
/** Gap between the table and its "+" bars; BAR_GAP + BAR_SIZE must fit the wrapper's reserved padding (20px). */
export const BAR_GAP = 3;

export interface HoveredCell {
  table: HTMLTableElement;
  row: number;
  col: number;
}

/** The table, row and column indices of the cell that contains `target`; null outside a table cell. */
export function hoveredCell(target: EventTarget | null): HoveredCell | null {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const cell = el?.closest("td, th");
  const rowEl = cell?.closest("tr");
  const table = rowEl?.closest("table");
  if (!(cell instanceof HTMLTableCellElement) || !rowEl || !table) return null;
  const row = Array.from(table.rows).indexOf(rowEl);
  return row < 0 ? null : { table, row, col: cell.cellIndex };
}

/** Whether `target` is inside one of the overlay's own controls (they carry `data-table-control`). */
export function isTableControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-table-control]") !== null;
}

/** `rect` in the container's coordinate space (the overlay is absolutely positioned inside it). */
export function relativeTo(rect: Box, container: Box): Box {
  return {
    left: rect.left - container.left,
    top: rect.top - container.top,
    right: rect.right - container.left,
    bottom: rect.bottom - container.top,
  };
}

/** The part of the table that is visible: its horizontal extent clipped by the scroll wrapper. */
export function visibleSpan(table: Box, wrapper: Box): { left: number; right: number } {
  return { left: Math.max(table.left, wrapper.left), right: Math.min(table.right, wrapper.right) };
}

/** Row grip: centred vertically on the row, straddling the left border (mostly inside the table). */
export function rowGrip(row: Box, visible: { left: number }): Placed {
  return {
    left: visible.left - ROW_GRIP_OVERHANG,
    top: (row.top + row.bottom) / 2 - GRIP_LENGTH / 2,
    width: GRIP_THICKNESS,
    height: GRIP_LENGTH,
  };
}

/** Column grip: centred on the column, straddling the top border. Null when the column is scrolled out of view. */
export function columnGrip(cell: Box, tableTop: number, visible: { left: number; right: number }): Placed | null {
  const centre = (cell.left + cell.right) / 2;
  if (centre < visible.left || centre > visible.right) return null;
  return { left: centre - GRIP_LENGTH / 2, top: tableTop - GRIP_THICKNESS / 2, width: GRIP_LENGTH, height: GRIP_THICKNESS };
}

/** The full-width bar just below the table, inside the room the table wrapper reserves there. */
export function addRowBar(table: Box, visible: { left: number; right: number }): Placed {
  return { left: visible.left, top: table.bottom + BAR_GAP, width: visible.right - visible.left, height: BAR_SIZE };
}

/**
 * The full-height bar just right of the table, inside the room the table wrapper reserves there. `limit` is
 * the right edge the bar must not pass (the wrapper's, or the container's if smaller): a table scrolled wider
 * than its wrapper gets the bar over the last visible pixels instead of outside the wrapper.
 */
export function addColumnBar(table: Box, visible: { right: number }, limit: number): Placed {
  return {
    left: Math.min(visible.right + BAR_GAP, limit - BAR_SIZE),
    top: table.top,
    width: BAR_SIZE,
    height: table.bottom - table.top,
  };
}
