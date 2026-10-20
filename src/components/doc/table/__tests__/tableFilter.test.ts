import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { findWrapping } from "@tiptap/pm/transform";
import { makeEditor } from "@/components/doc/ui/__tests__/editorFixture";
import { deleteColumn, insertColumn, moveColumn, sortColumn } from "../tableCommands";
import {
  cellText,
  filterSummary,
  getColumnFilters,
  hiddenRows,
  isRowVisible,
  normalizeQuery,
  setColumnFilter,
  tableFilterKey,
} from "../tableFilter";

const SRC = "| Name | City | Qty |\n| --- | --- | --- |\n| Ann | Paris | 1 |\n| bob | Rome | 2 |\n| Cy | paris | 3 |";

let editor: Editor;
afterEach(() => editor?.destroy());

function make(md = SRC) {
  editor = makeEditor(`${md}\n\nend`);
}

/** Row indices (0 = header) carrying the hidden-row decoration. */
function hiddenInDom(): number[] {
  const out: number[] = [];
  editor.view.dom.querySelectorAll("tr").forEach((tr, i) => tr.classList.contains("doc-row-filtered") && out.push(i));
  return out;
}

/** Start position of the text node `text` (first match). */
function textPos(text: string): number {
  const nodes: [string, number, boolean][] = [];
  editor.state.doc.descendants((node, pos) => void nodes.push([node.text ?? "", pos, node.isText]));
  return nodes.find(([t, , isText]) => isText && t === text)![1];
}

function caretIn(text: string) {
  editor.commands.setTextSelection(textPos(text) + 1);
}

function filteredHeaders(): number[] {
  return Array.from(editor.view.dom.querySelectorAll("tr:first-child > *"))
    .map((cell, i) => (cell.hasAttribute("data-filtered") ? i : -1))
    .filter((i) => i >= 0);
}

describe("filter matching helpers", () => {
  it("normalizeQuery treats blank as no filter", () => {
    expect(normalizeQuery("  ")).toBeNull();
    expect(normalizeQuery("  Ab ")).toBe("Ab");
    expect(normalizeQuery(null)).toBeNull();
    expect(normalizeQuery(" a")).toBe("a");
  });

  it("isRowVisible is a case-insensitive contains, ANDed across columns", () => {
    expect(isRowVisible(["Ann", "Paris"], { 1: "PAR" })).toBe(true);
    expect(isRowVisible(["Ann", "Rome"], { 1: "par" })).toBe(false);
    expect(isRowVisible(["Ann", "Paris"], { 0: "an", 1: "rome" })).toBe(false);
    expect(isRowVisible(["Ann", "Paris"], { 0: "an", 1: "ri" })).toBe(true);
  });

  it("an all-empty row is never hidden", () => {
    expect(isRowVisible(["", " "], { 0: "zzz" })).toBe(true);
  });

  it("cellText and hiddenRows read the table node", () => {
    make();
    const table = editor.state.doc.child(0);
    expect(cellText(table.child(1).child(1))).toBe("Paris");
    expect(hiddenRows(table, { 1: "paris" })).toEqual([2]);
    expect(hiddenRows(table, {})).toEqual([]);
  });
});

describe("table filter plugin", () => {
  it("hides non-matching body rows and marks the filtered header cell", () => {
    make();
    expect(setColumnFilter(editor, 0, 1, "PARIS")).toBe(true);
    expect(hiddenInDom()).toEqual([2]);
    expect(filteredHeaders()).toEqual([1]);
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "PARIS" });
    expect(filterSummary(editor, 0)).toEqual({ shown: 2, total: 3 });
  });

  it("ANDs filters across columns", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    setColumnFilter(editor, 0, 0, "cy");
    expect(hiddenInDom()).toEqual([1, 2]);
  });

  it("clears a filter with null or a blank query and shows the rows again", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    setColumnFilter(editor, 0, 1, "  ");
    expect(hiddenInDom()).toEqual([]);
    expect(filteredHeaders()).toEqual([]);
    expect(getColumnFilters(editor, 0)).toEqual({});
  });

  it("never hides the header row and keeps an all-empty body row", () => {
    make("| A |\n| --- |\n| x |\n|  |");
    setColumnFilter(editor, 0, 0, "zzz");
    expect(hiddenInDom()).toEqual([1]);
  });

  it("refuses a non-table position and a column out of range", () => {
    make();
    expect(setColumnFilter(editor, 1, 0, "a")).toBe(false);
    setColumnFilter(editor, 0, 9, "a");
    expect(getColumnFilters(editor, 0)).toEqual({});
  });

  it("never changes the markdown or the document", () => {
    make();
    const markdown = editor.getMarkdown();
    const doc = editor.state.doc;
    setColumnFilter(editor, 0, 1, "paris");
    expect(editor.getMarkdown()).toBe(markdown);
    expect(editor.state.doc.eq(doc)).toBe(true);
  });

  it("follows the table through an edit above it", () => {
    make(`intro\n\n${SRC}`);
    const pos = editor.state.doc.child(0).nodeSize;
    setColumnFilter(editor, pos, 1, "paris");
    editor.commands.insertContentAt(1, "more ");
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "new" }] });
    const moved = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    expect(editor.state.doc.nodeAt(moved)?.type.name).toBe("table");
    expect(getColumnFilters(editor, moved)).toEqual({ 1: "paris" });
    expect(hiddenInDom()).toEqual([2]);
  });

  it("survives structural edits that keep the column count (sort, row insert)", () => {
    make();
    setColumnFilter(editor, 0, 0, "o");
    sortColumn(editor, 0, 0, "desc");
    expect(getColumnFilters(editor, 0)).toEqual({ 0: "o" });
    expect(hiddenInDom()).toEqual([1, 3]);
  });

  it("moves a filter with its column", () => {
    make();
    setColumnFilter(editor, 0, 0, "o");
    moveColumn(editor, 0, 0, 2);
    expect(getColumnFilters(editor, 0)).toEqual({ 2: "o" });
    expect(filteredHeaders()).toEqual([2]);
  });

  it("shifts the other filters when a column is inserted before them", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    insertColumn(editor, 0, 0, "before");
    expect(getColumnFilters(editor, 0)).toEqual({ 2: "paris" });
  });

  it("drops the filter of a deleted column and renumbers the rest", () => {
    make();
    setColumnFilter(editor, 0, 0, "o");
    setColumnFilter(editor, 0, 2, "2");
    deleteColumn(editor, 0, 0);
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "2" });
  });

  it("drops all filters of a table that stops existing", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.child(0).nodeSize });
    expect(getColumnFilters(editor, 0)).toEqual({});
  });

  it("does not move to the next table when a filtered table is deleted (a)", () => {
    make(`${SRC}\n\nmid\n\n${SRC}`);
    setColumnFilter(editor, 0, 1, "rome");
    const first = editor.state.doc.child(0).nodeSize;
    editor.commands.deleteRange({ from: 0, to: first + editor.state.doc.child(1).nodeSize });
    expect(editor.state.doc.nodeAt(0)?.type.name).toBe("table");
    expect(getColumnFilters(editor, 0)).toEqual({});
    expect(hiddenInDom()).toEqual([]);
  });

  it("drops filters when the whole document is replaced (b)", () => {
    make();
    setColumnFilter(editor, 0, 1, "rome");
    editor.commands.setContent("| X | Y | Z |\n| --- | --- | --- |\n| 1 | 2 | 3 |", { contentType: "markdown" });
    expect(getColumnFilters(editor, 0)).toEqual({});
    editor.commands.setContent("plain", { contentType: "markdown" });
    expect(tableFilterKey.getState(editor.state)?.tables).toEqual([]);
  });
});

describe("table filter: columns changed without a remap", () => {
  it("drops all filters when an undone column move reorders the headers", () => {
    make();
    setColumnFilter(editor, 0, 0, "o");
    moveColumn(editor, 0, 0, 2);
    editor.commands.undo();
    expect(getColumnFilters(editor, 0)).toEqual({});
  });

  it("keeps all filters when the user edits exactly one header, including empty and retyped ones", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    const from = textPos("City");
    editor.commands.insertContentAt({ from, to: from + 4 }, "Town");
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "paris" });
    editor.commands.deleteRange({ from, to: from + 4 });
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "paris" });
    editor.commands.insertContentAt(from, "City");
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "paris" });
  });

  it("keeps a filter on a column whose header is empty and duplicated", () => {
    make("|  |  |  |\n| --- | --- | --- |\n| a | b | c |");
    setColumnFilter(editor, 0, 1, "b");
    editor.commands.insertContentAt(textPos("a") + 1, "x");
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "b" });
  });

  it("drops all filters when two headers change in one step", () => {
    make();
    setColumnFilter(editor, 0, 1, "paris");
    const qty = textPos("Qty");
    const name = textPos("Name");
    editor.chain().insertContentAt({ from: qty, to: qty + 3 }, "Q").insertContentAt({ from: name, to: name + 4 }, "N").run();
    expect(getColumnFilters(editor, 0)).toEqual({});
  });
});

describe("table filter: table identity", () => {
  it("keeps the filters when the table is wrapped in a blockquote and lifted out again", () => {
    make();
    setColumnFilter(editor, 0, 1, "rome");
    const size = editor.state.doc.child(0).nodeSize;
    const wrapRange = editor.state.doc.resolve(0).blockRange(editor.state.doc.resolve(size))!;
    editor.view.dispatch(editor.state.tr.wrap(wrapRange, findWrapping(wrapRange, editor.schema.nodes.blockquote)!));
    expect(getColumnFilters(editor, 1)).toEqual({ 1: "rome" });
    expect(hiddenInDom()).toEqual([1, 3]);
    const liftRange = editor.state.doc.resolve(1).blockRange(editor.state.doc.resolve(1 + size))!;
    editor.view.dispatch(editor.state.tr.lift(liftRange, 0));
    expect(getColumnFilters(editor, 0)).toEqual({ 1: "rome" });
  });

  it("drops the filters when setContent brings a new document that starts with a table, even the same one", () => {
    make();
    setColumnFilter(editor, 0, 1, "rome");
    editor.commands.setContent(SRC, { contentType: "markdown" });
    expect(tableFilterKey.getState(editor.state)?.tables).toEqual([]);
  });
});

describe("table filter: the row being edited stays visible", () => {
  it("keeps a body row visible while it is typed in, and hides it when the caret leaves", () => {
    make();
    setColumnFilter(editor, 0, 1, "rome");
    caretIn("Cy");
    editor.commands.insertContentAt(textPos("Cy") + 2, "x");
    expect(hiddenInDom()).toEqual([1]);
    expect(filterSummary(editor, 0)).toEqual({ shown: 2, total: 3 });
    caretIn("Name");
    expect(hiddenInDom()).toEqual([1, 3]);
    expect(filterSummary(editor, 0)).toEqual({ shown: 1, total: 3 });
  });

  it("does not protect a row just because the caret is in it when a filter is set", () => {
    make();
    caretIn("Ann");
    setColumnFilter(editor, 0, 1, "rome");
    expect(hiddenInDom()).toEqual([1, 3]);
  });

  it("ends the protection when a filter changes", () => {
    make();
    setColumnFilter(editor, 0, 1, "rome");
    caretIn("Cy");
    editor.commands.insertContentAt(textPos("Cy") + 2, "x");
    setColumnFilter(editor, 0, 0, "b");
    expect(hiddenInDom()).toEqual([1, 3]);
  });

  it("sort leaves the caret in the header row", () => {
    make();
    sortColumn(editor, 0, 0, "desc");
    expect(editor.state.selection.$head.index(1)).toBe(0);
  });
});

describe("table filter: state stays stable", () => {
  it("keeps the plugin state object across edits when no table is filtered", () => {
    make(`para\n\n${SRC}`);
    const before = tableFilterKey.getState(editor.state);
    editor.commands.insertContentAt(1, "x");
    expect(tableFilterKey.getState(editor.state)).toBe(before);
  });

  it("keeps the entries and decorations across an unrelated edit and a caret move inside the same row", () => {
    make(`para\n\n${SRC}`);
    setColumnFilter(editor, editor.state.doc.child(0).nodeSize, 1, "rome");
    caretIn("Ann");
    const before = tableFilterKey.getState(editor.state)!;
    editor.commands.setTextSelection(textPos("Ann") + 2);
    const after = tableFilterKey.getState(editor.state)!;
    expect(after.tables).toBe(before.tables);
    expect(after.decos).toBe(before.decos);
    editor.commands.insertContentAt(1, "x");
    expect(tableFilterKey.getState(editor.state)!.tables[0].filters).toBe(before.tables[0].filters);
  });
});
