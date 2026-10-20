import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

export type ColumnAlign = "left" | "center" | "right";

/**
 * Pure table commands for the /doc editor. The document is GFM markdown, so a table is a plain
 * grid with exactly one header row (the first) and no merged cells. Each mutating command rebuilds
 * the table node from its rows and swaps it in with ONE transaction (one undo step).
 */

interface TableInfo {
  node: PMNode;
  rows: PMNode[][];
}

function readTable(editor: Editor, tablePos: number): TableInfo | null {
  const { doc } = editor.state;
  if (!Number.isInteger(tablePos) || tablePos < 0 || tablePos >= doc.content.size) return null;
  const node = doc.nodeAt(tablePos);
  if (!node || node.type.name !== "table") return null;
  const rows: PMNode[][] = [];
  node.forEach((row) => {
    const cells: PMNode[] = [];
    row.forEach((cell) => cells.push(cell));
    rows.push(cells);
  });
  return { node, rows };
}

function isMerged(info: TableInfo): boolean {
  return info.rows.some((cells) => cells.some((c) => (c.attrs.colspan ?? 1) !== 1 || (c.attrs.rowspan ?? 1) !== 1));
}

/** A table that can be edited structurally: rectangular, no merged cells. */
function readEditable(editor: Editor, tablePos: number): TableInfo | null {
  const info = readTable(editor, tablePos);
  if (!info || info.rows.length === 0 || isMerged(info)) return null;
  const cols = info.rows[0].length;
  return cols > 0 && info.rows.every((r) => r.length === cols) ? info : null;
}

function inRange(i: number, n: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < n;
}

function emptyCell(editor: Editor, header: boolean, attrs: Record<string, unknown>): PMNode | null {
  const type = editor.schema.nodes[header ? "tableHeader" : "tableCell"];
  return type.createAndFill(attrs);
}

function clearCell(cell: PMNode): PMNode {
  return cell.type.createAndFill(cell.attrs) ?? cell;
}

/** Replaces the table with the given rows; puts the cursor in cell (selRow, selCol). One transaction. */
function commit(editor: Editor, tablePos: number, info: TableInfo, rows: PMNode[][], selRow: number, selCol: number): boolean {
  const { schema, state } = editor;
  const rowType = schema.nodes.tableRow;
  const newTable = info.node.type.create(info.node.attrs, rows.map((cells) => rowType.create(null, cells)), info.node.marks);
  const tr = state.tr.replaceWith(tablePos, tablePos + info.node.nodeSize, newTable);
  let pos = tablePos + 1;
  for (let r = 0; r < selRow; r++) pos += tr.doc.nodeAt(pos)?.nodeSize ?? 0;
  pos += 1;
  for (let c = 0; c < selCol; c++) pos += tr.doc.nodeAt(pos)?.nodeSize ?? 0;
  // pos is before the target cell; +1 enters the cell, near() lands in its first textblock.
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

function newBodyRow(editor: Editor, headerRow: PMNode[]): PMNode[] | null {
  const cells: PMNode[] = [];
  for (const h of headerRow) {
    const cell = emptyCell(editor, false, { align: h.attrs.align ?? null });
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}

function selectCell(editor: Editor, tablePos: number, row: number, col: number, kind: "row" | "col"): boolean {
  const info = readTable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length) || !inRange(col, info.rows[0].length)) return false;
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += info.node.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < col; c++) pos += info.rows[row][c].nodeSize;
  const $cell = editor.state.doc.resolve(pos);
  const sel = kind === "row" ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  editor.view.focus();
  return true;
}

export function selectRow(editor: Editor, tablePos: number, row: number): boolean {
  return selectCell(editor, tablePos, row, 0, "row");
}

export function selectColumn(editor: Editor, tablePos: number, col: number): boolean {
  return selectCell(editor, tablePos, 0, col, "col");
}

export function insertRow(editor: Editor, tablePos: number, row: number, side: "before" | "after"): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length)) return false;
  const index = side === "before" ? row : row + 1;
  if (index < 1) return false;
  const fresh = newBodyRow(editor, info.rows[0]);
  if (!fresh) return false;
  const rows = [...info.rows];
  rows.splice(index, 0, fresh);
  return commit(editor, tablePos, info, rows, index, 0);
}

export function deleteRow(editor: Editor, tablePos: number, row: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length) || row === 0) return false;
  const rows = info.rows.filter((_, i) => i !== row);
  return commit(editor, tablePos, info, rows, Math.min(row, rows.length - 1), 0);
}

export function moveRow(editor: Editor, tablePos: number, from: number, to: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(from, info.rows.length) || !inRange(to, info.rows.length)) return false;
  if (from < 1 || to < 1 || from === to) return false;
  const rows = [...info.rows];
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return commit(editor, tablePos, info, rows, to, 0);
}

export function duplicateRow(editor: Editor, tablePos: number, row: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length) || row === 0) return false;
  const rows = [...info.rows];
  rows.splice(row + 1, 0, [...info.rows[row]]);
  return commit(editor, tablePos, info, rows, row + 1, 0);
}

export function clearRow(editor: Editor, tablePos: number, row: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length)) return false;
  const rows = info.rows.map((cells, i) => (i === row ? cells.map(clearCell) : cells));
  return commit(editor, tablePos, info, rows, row, 0);
}

export function insertColumn(editor: Editor, tablePos: number, col: number, side: "before" | "after"): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0]?.length ?? 0)) return false;
  const index = side === "before" ? col : col + 1;
  const rows: PMNode[][] = [];
  for (let r = 0; r < info.rows.length; r++) {
    const cell = emptyCell(editor, r === 0, { align: null });
    if (!cell) return false;
    const cells = [...info.rows[r]];
    cells.splice(index, 0, cell);
    rows.push(cells);
  }
  return commit(editor, tablePos, info, rows, 0, index);
}

export function deleteColumn(editor: Editor, tablePos: number, col: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0].length) || info.rows[0].length < 2) return false;
  const rows = info.rows.map((cells) => cells.filter((_, i) => i !== col));
  return commit(editor, tablePos, info, rows, 0, Math.min(col, rows[0].length - 1));
}

export function moveColumn(editor: Editor, tablePos: number, from: number, to: number): boolean {
  const info = readEditable(editor, tablePos);
  const cols = info?.rows[0].length ?? 0;
  if (!info || !inRange(from, cols) || !inRange(to, cols) || from === to) return false;
  const rows = info.rows.map((cells) => {
    const next = [...cells];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
  return commit(editor, tablePos, info, rows, 0, to);
}

export function duplicateColumn(editor: Editor, tablePos: number, col: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0].length)) return false;
  const rows = info.rows.map((cells) => {
    const next = [...cells];
    next.splice(col + 1, 0, cells[col]);
    return next;
  });
  return commit(editor, tablePos, info, rows, 0, col + 1);
}

export function clearColumn(editor: Editor, tablePos: number, col: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0].length)) return false;
  const rows = info.rows.map((cells) => cells.map((c, i) => (i === col ? clearCell(c) : c)));
  return commit(editor, tablePos, info, rows, 0, col);
}

export function getColumnAlign(editor: Editor, tablePos: number, col: number): ColumnAlign | null {
  const info = readTable(editor, tablePos);
  if (!info || info.rows.length === 0 || !inRange(col, info.rows[0].length)) return null;
  const align = info.rows[0][col].attrs.align;
  return align === "left" || align === "center" || align === "right" ? align : null;
}

/** Sets the alignment attr of one column's cells in place (one transaction), so the selection survives. */
export function setColumnAlign(editor: Editor, tablePos: number, col: number, align: ColumnAlign | null): boolean {
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0].length)) return false;
  if (info.rows.every((cells) => (cells[col].attrs.align ?? null) === align)) return false;
  const tr = editor.state.tr;
  let rowPos = tablePos + 1;
  info.rows.forEach((cells) => {
    let cellPos = rowPos + 1;
    for (let c = 0; c < col; c++) cellPos += cells[c].nodeSize;
    tr.setNodeMarkup(cellPos, undefined, { ...cells[col].attrs, align });
    rowPos += cells.reduce((sum, cell) => sum + cell.nodeSize, 2);
  });
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

export function appendRow(editor: Editor, tablePos: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info) return false;
  const fresh = newBodyRow(editor, info.rows[0]);
  if (!fresh) return false;
  return commit(editor, tablePos, info, [...info.rows, fresh], info.rows.length, 0);
}

export function appendColumn(editor: Editor, tablePos: number): boolean {
  const info = readEditable(editor, tablePos);
  if (!info) return false;
  const index = info.rows[0].length;
  const rows: PMNode[][] = [];
  for (let r = 0; r < info.rows.length; r++) {
    const cell = emptyCell(editor, r === 0, { align: null });
    if (!cell) return false;
    rows.push([...info.rows[r], cell]);
  }
  return commit(editor, tablePos, info, rows, 0, index);
}

export function rowActions(editor: Editor, tablePos: number, row: number) {
  const none = { insertBefore: false, insertAfter: false, moveUp: false, moveDown: false, duplicate: false, clear: false, delete: false };
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(row, info.rows.length)) return none;
  const body = row >= 1;
  return {
    insertBefore: body,
    insertAfter: true,
    moveUp: body && row > 1,
    moveDown: body && row < info.rows.length - 1,
    duplicate: body,
    clear: true,
    delete: body,
  };
}

export function columnActions(editor: Editor, tablePos: number, col: number) {
  const none = { align: false, insertBefore: false, insertAfter: false, moveLeft: false, moveRight: false, duplicate: false, clear: false, delete: false };
  const info = readEditable(editor, tablePos);
  if (!info || !inRange(col, info.rows[0].length)) return none;
  const cols = info.rows[0].length;
  return {
    align: true,
    insertBefore: true,
    insertAfter: true,
    moveLeft: col > 0,
    moveRight: col < cols - 1,
    duplicate: true,
    clear: true,
    delete: cols > 1,
  };
}

export function tableAround(editor: Editor, pos: number): number | null {
  const { doc } = editor.state;
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") return $pos.before(d);
  }
  return null;
}
