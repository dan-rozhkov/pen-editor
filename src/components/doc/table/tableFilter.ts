import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection, type Transaction } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * View-only column filters for the /doc tables. GFM has nowhere to store a filter, so it is never part of the
 * document: the plugin keeps `{ pos, filters, heads, protectedRow }` per filtered table and hides non-matching
 * body rows with node decorations. `getMarkdown()`, autosave and the agent's `doc_read` always see every row.
 *
 * Rules (one place, so the choice is easy to find):
 * - Identity. A filtered table is its document position, mapped through every transaction with assoc 1. A
 *   step that replaces a range covering the table's start drops the filters, unless the transaction is tagged
 *   "same table" (the structural commands in tableCommands swap in a whole new table node; `tagSameTable` /
 *   `tagColumnRemap`). So `setContent`, a paste over the table or a deletion never leave a filter on whatever
 *   moved into its place, even a new table. A ReplaceAroundStep whose gap holds the table (wrap or lift in a
 *   blockquote, list, toggle) keeps it: the position maps.
 * - Untagged change (undo, paste, the agent). Compare the header texts before and after: identical, or the same
 *   column count with exactly one header different (the user edits a header) keeps ALL filters at their
 *   indices; anything else (several headers, a reorder, another count) drops ALL the table's filters. There is
 *   no text matching to relocate a filter, so an undone column move simply drops them. Dropping is safe: the
 *   user sees every row again, never a wrong subset.
 * - A tagged column command says how it renumbers (`ColumnRemap`): move shifts the filter with its column,
 *   delete drops that column's filter, insert/duplicate/append shift the rest.
 * - Protected row. While the user edits a body row of a filtered table, that row stays visible: the protected
 *   row is the row of the selection at the last document change made inside the table's body. The protection
 *   ends when the selection leaves that row or when a filter changes.
 */

export interface TableFilterEntry {
  pos: number;
  filters: Record<number, string>;
  heads: string[];
  /** Body row (index in the table) that stays visible because it is being edited; null when none. */
  protectedRow: number | null;
}

export interface TableFilterState {
  tables: TableFilterEntry[];
  decos: DecorationSet;
}

/** How a column command renumbers the columns: old index -> new index, or null when the column is gone. */
export interface ColumnRemap {
  /** Table position in the document BEFORE the transaction. */
  tablePos: number;
  /** Column count after the transaction. */
  cols: number;
  map: (col: number) => number | null;
}

type FilterMeta =
  | { type: "set"; tablePos: number; col: number; query: string | null }
  | { type: "sameTable"; tablePos: number }
  | ({ type: "columns" } & ColumnRemap);

export const tableFilterKey = new PluginKey<TableFilterState>("docTableFilter");

export const FILTERED_ROW_CLASS = "doc-row-filtered";

const EMPTY: TableFilterState = { tables: [], decos: DecorationSet.empty };

/** Plain text of a cell, blocks separated by a space. The one way sort and filter read a cell. */
export function cellText(cell: PMNode): string {
  return cell.textBetween(0, cell.content.size, " ");
}

/** A filter query is trimmed; a blank one means no filter. */
export function normalizeQuery(query: string | null): string | null {
  const trimmed = query?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Whether a body row stays visible: contains-match (case-insensitive) in every filtered column; an all-empty row always stays. */
export function isRowVisible(texts: readonly string[], filters: Readonly<Record<number, string>>): boolean {
  if (texts.every((t) => t.trim() === "")) return true;
  return Object.entries(filters).every(([col, query]) => (texts[Number(col)] ?? "").toLowerCase().includes(query.toLowerCase()));
}

function rowTexts(row: PMNode): string[] {
  const texts: string[] = [];
  row.forEach((cell) => texts.push(cellText(cell)));
  return texts;
}

/** Indices (0 = header) of the body rows the filters hide; `keepRow` (the row being edited) stays visible. */
export function hiddenRows(table: PMNode, filters: Readonly<Record<number, string>>, keepRow: number | null = null): number[] {
  const hidden: number[] = [];
  table.forEach((row, _offset, index) => {
    if (index > 0 && index !== keepRow && !isRowVisible(rowTexts(row), filters)) hidden.push(index);
  });
  return hidden;
}

function tableAt(doc: PMNode, pos: number): PMNode | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node?.type.name === "table" ? node : null;
}

function headTexts(table: PMNode): string[] {
  return table.childCount > 0 ? rowTexts(table.child(0)) : [];
}

const sameList = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function remapFilters(filters: Record<number, string>, map: (col: number) => number | null): Record<number, string> {
  const next: Record<number, string> = {};
  for (const [col, query] of Object.entries(filters)) {
    const to = map(Number(col));
    if (to !== null) next[to] = query;
  }
  return next;
}

/** Untagged change: keep the filters only when the headers are the same or exactly one header text differs. */
function headersCompatible(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.filter((h, i) => h !== after[i]).length <= 1;
}

/** Where the table that started at `pos` starts after `tr`; null when it was deleted or replaced. */
function trackTable(tr: Transaction, pos: number, tagged: boolean): number | null {
  let at = pos;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (step instanceof ReplaceStep && at >= step.from && at < step.to && !tagged) return null;
    if (step instanceof ReplaceAroundStep && at >= step.from && at < step.to) {
      const inGap = at >= step.gapFrom && at < step.gapTo;
      if (!inGap && !tagged) return null;
    }
    at = tr.mapping.maps[i].map(at, 1);
  }
  return at;
}

/** Whether any step of `tr` changed content inside [from, to) of the NEW document. */
function touches(tr: Transaction, from: number, to: number): boolean {
  let hit = false;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_a, _b, start, end) => {
      if (rest.map(start, -1) < to && rest.map(end, 1) > from) hit = true;
    });
  });
  return hit;
}

/** The body row (>= 1) of the table at `tablePos` that holds the selection head; null elsewhere. */
function bodyRowOf(selection: Selection, tablePos: number): number | null {
  const $pos = selection instanceof CellSelection ? selection.$headCell : selection.$head;
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table" && $pos.before(d) === tablePos) {
      const row = $pos.index(d);
      return row >= 1 ? row : null;
    }
  }
  return null;
}

function reduceTables(value: TableFilterEntry[], tr: Transaction, selection: Selection): TableFilterEntry[] {
  const meta = tr.getMeta(tableFilterKey) as FilterMeta | undefined;
  if (value.length === 0 && meta?.type !== "set") return value;
  let tables = value;
  if (tr.docChanged) {
    const seen = new Set<number>();
    const next: TableFilterEntry[] = [];
    for (const t of tables) {
      const tagged = meta !== undefined && meta.type !== "set" && meta.tablePos === t.pos;
      const pos = trackTable(tr, t.pos, tagged);
      const table = pos === null ? null : tableAt(tr.doc, pos);
      if (pos === null || !table || seen.has(pos)) continue;
      const heads = headTexts(table);
      const remap = meta?.type === "columns" && tagged ? meta : null;
      let filters = t.filters;
      if (remap) filters = heads.length === remap.cols ? remapFilters(t.filters, remap.map) : {};
      else if (!headersCompatible(t.heads, heads)) filters = {};
      if (Object.keys(filters).length === 0) continue;
      seen.add(pos);
      const kept = sameList(heads, t.heads) ? t.heads : heads;
      next.push(pos === t.pos && filters === t.filters && kept === t.heads ? t : { pos, filters, heads: kept, protectedRow: t.protectedRow });
    }
    tables = sameList(next, tables) ? tables : next;
  }
  const edited = tr.docChanged && meta === undefined;
  const protectedPass = tables.map((e) => {
    const table = tableAt(tr.doc, e.pos);
    const row = bodyRowOf(selection, e.pos);
    const inside = edited && table !== null && touches(tr, e.pos, e.pos + table.nodeSize);
    const protectedRow = inside ? row : e.protectedRow !== null && e.protectedRow === row ? row : null;
    return protectedRow === e.protectedRow ? e : { ...e, protectedRow };
  });
  tables = sameList(protectedPass, tables) ? tables : protectedPass;
  if (meta?.type === "set") {
    const table = tableAt(tr.doc, meta.tablePos);
    const heads = table ? headTexts(table) : [];
    if (table && meta.col >= 0 && meta.col < heads.length) {
      const query = normalizeQuery(meta.query);
      const current = tables.find((t) => t.pos === meta.tablePos);
      if (query === null && !current) return tables;
      const filters = { ...(current?.filters ?? {}) };
      if (query === null) delete filters[meta.col];
      else filters[meta.col] = query;
      const rest = tables.filter((t) => t.pos !== meta.tablePos);
      tables = Object.keys(filters).length === 0 ? rest : [...rest, { pos: meta.tablePos, filters, heads, protectedRow: null }];
    }
  }
  return tables;
}

function decorate(doc: PMNode, tables: TableFilterEntry[]): DecorationSet {
  const decorations: Decoration[] = [];
  for (const entry of tables) {
    const table = tableAt(doc, entry.pos);
    if (!table) continue;
    const hidden = new Set(hiddenRows(table, entry.filters, entry.protectedRow));
    table.forEach((row, rowOffset, rowIndex) => {
      const rowPos = entry.pos + 1 + rowOffset;
      if (hidden.has(rowIndex)) decorations.push(Decoration.node(rowPos, rowPos + row.nodeSize, { class: FILTERED_ROW_CLASS }));
      if (rowIndex !== 0) return;
      row.forEach((cell, cellOffset, col) => {
        if (entry.filters[col] === undefined) return;
        const cellPos = rowPos + 1 + cellOffset;
        decorations.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { "data-filtered": "true" }));
      });
    });
  }
  return DecorationSet.create(doc, decorations);
}

const sameExceptPos = (a: TableFilterEntry, b: TableFilterEntry) =>
  a.filters === b.filters && a.heads === b.heads && a.protectedRow === b.protectedRow;

export const DocTableFilter = Extension.create({
  name: "docTableFilter",
  addProseMirrorPlugins() {
    return [
      new Plugin<TableFilterState>({
        key: tableFilterKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value, _old, state) => {
            const tables = reduceTables(value.tables, tr, state.selection);
            if (tables.length === 0) return value.tables.length === 0 ? value : EMPTY;
            if (tables === value.tables && !tr.docChanged) return value;
            // Only positions moved and no step touched a filtered table: shift the decorations, do not rebuild them.
            const untouched =
              tables.length === value.tables.length &&
              tables.every((e, i) => sameExceptPos(e, value.tables[i]) && !touches(tr, e.pos, e.pos + (tableAt(tr.doc, e.pos)?.nodeSize ?? 0)));
            if (untouched) return { tables, decos: value.decos.map(tr.mapping, tr.doc) };
            return { tables, decos: decorate(state.doc, tables) };
          },
        },
        props: {
          decorations: (state) => tableFilterKey.getState(state)?.decos ?? DecorationSet.empty,
        },
      }),
    ];
  },
});

/** The active filters of the table at `tablePos` (column index -> query). Empty when there are none. */
export function getColumnFilters(editor: Editor, tablePos: number): Record<number, string> {
  const entry = tableFilterKey.getState(editor.state)?.tables.find((t) => t.pos === tablePos);
  return entry ? { ...entry.filters } : {};
}

/** Sets (or, with null / blank, clears) the filter of one column. View-only: never changes the document. */
export function setColumnFilter(editor: Editor, tablePos: number, col: number, query: string | null): boolean {
  if (!tableAt(editor.state.doc, tablePos)) return false;
  const meta: FilterMeta = { type: "set", tablePos, col, query };
  editor.view.dispatch(editor.state.tr.setMeta(tableFilterKey, meta));
  return true;
}

/** Tags a transaction with how it renumbers a table's columns, so the filters follow (see the rules above). */
export function tagColumnRemap(tr: Transaction, remap: ColumnRemap): Transaction {
  return tr.setMeta(tableFilterKey, { type: "columns", ...remap } satisfies FilterMeta);
}

/** Marks a transaction as an in-place rewrite of the table at `tablePos`, so its filters stay with it. */
export function tagSameTable(tr: Transaction, tablePos: number): Transaction {
  return tr.setMeta(tableFilterKey, { type: "sameTable", tablePos } satisfies FilterMeta);
}

/** Rows shown / total body rows for the table at `tablePos` under its current filters. */
export function filterSummary(editor: Editor, tablePos: number): { shown: number; total: number } {
  const table = tableAt(editor.state.doc, tablePos);
  if (!table) return { shown: 0, total: 0 };
  const total = Math.max(0, table.childCount - 1);
  const entry = tableFilterKey.getState(editor.state)?.tables.find((t) => t.pos === tablePos);
  // The same hidden set as on screen, protected row included.
  return { shown: total - hiddenRows(table, entry?.filters ?? {}, entry?.protectedRow ?? null).length, total };
}

/** Column renumbering for "move column `from` to index `to`". */
export function moveMap(from: number, to: number): (col: number) => number {
  return (col) => {
    if (col === from) return to;
    if (from < to && col > from && col <= to) return col - 1;
    if (from > to && col >= to && col < from) return col + 1;
    return col;
  };
}

/** Column renumbering for removing column `at`. */
export function deleteMap(at: number): (col: number) => number | null {
  return (col) => (col === at ? null : col > at ? col - 1 : col);
}

/** Column renumbering for inserting a new column at index `at`. */
export function insertMap(at: number): (col: number) => number {
  return (col) => (col >= at ? col + 1 : col);
}
