import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { makeEditor } from "@/components/doc/ui/__tests__/editorFixture";
import {
  appendColumn,
  appendRow,
  clearColumn,
  clearRow,
  columnActions,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  getColumnAlign,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseCellNumber,
  rowActions,
  selectColumn,
  selectRow,
  setColumnAlign,
  sortColumn,
  tableAround,
} from "../tableCommands";

const SRC = "| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |";

let editor: Editor;
afterEach(() => editor.destroy());

function make(md = SRC): number {
  // A trailing paragraph keeps the trailing-node plugin from adding one inside the first edit.
  editor = makeEditor(`${md}\n\nend`);
  return 0;
}

/** Cell texts and the delimiter row, whitespace-normalised, one string per row. */
function rows(): string[] {
  return editor
    .getMarkdown()
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/\s+/g, " ").replace(/-{3,}/g, "---").trim());
}

function expectUndoRestores(before: string) {
  editor.commands.undo();
  expect(editor.getMarkdown()).toBe(before);
}

describe("table commands: read-only", () => {
  it("tableAround finds the table from a cell position and null outside", () => {
    make(`before\n\n${SRC}`);
    const tablePos = editor.state.doc.child(0).nodeSize;
    expect(tableAround(editor, tablePos + 4)).toBe(tablePos);
    expect(tableAround(editor, 1)).toBeNull();
  });

  it("getColumnAlign reads the header cell align", () => {
    const t = make("| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |");
    expect(getColumnAlign(editor, t, 0)).toBe("left");
    expect(getColumnAlign(editor, t, 1)).toBe("center");
    expect(getColumnAlign(editor, t, 2)).toBe("right");
    expect(getColumnAlign(editor, t, 3)).toBeNull();
  });

  it("rowActions disables header and edge moves", () => {
    const t = make();
    expect(rowActions(editor, t, 0)).toEqual({ insertBefore: false, insertAfter: true, moveUp: false, moveDown: false, duplicate: false, clear: true, delete: false });
    expect(rowActions(editor, t, 1)).toEqual({ insertBefore: true, insertAfter: true, moveUp: false, moveDown: true, duplicate: true, clear: true, delete: true });
    expect(rowActions(editor, t, 2).moveDown).toBe(false);
    expect(rowActions(editor, t, 2).moveUp).toBe(true);
    expect(rowActions(editor, t, 7).delete).toBe(false);
  });

  it("columnActions disables edge moves and deleting the last column", () => {
    const t = make();
    expect(columnActions(editor, t, 0)).toMatchObject({ moveLeft: false, moveRight: true, delete: true });
    expect(columnActions(editor, t, 2)).toMatchObject({ moveLeft: true, moveRight: false });
    const single = make("| A |\n| --- |\n| 1 |");
    expect(columnActions(editor, single, 0).delete).toBe(false);
  });
});

describe("table commands: selection", () => {
  it("selectRow makes a row CellSelection", () => {
    const t = make();
    expect(selectRow(editor, t, 1)).toBe(true);
    const sel = editor.state.selection as CellSelection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect(sel.isRowSelection()).toBe(true);
    let count = 0;
    sel.forEachCell(() => count++);
    expect(count).toBe(3);
    expect(selectRow(editor, t, 5)).toBe(false);
  });

  it("selectColumn makes a column CellSelection", () => {
    const t = make();
    expect(selectColumn(editor, t, 2)).toBe(true);
    const sel = editor.state.selection as CellSelection;
    expect(sel.isColSelection()).toBe(true);
    let count = 0;
    sel.forEachCell(() => count++);
    expect(count).toBe(3);
    expect(selectColumn(editor, t, -1)).toBe(false);
  });
});

describe("table commands: rows", () => {
  it("insertRow after / before adds an empty body row", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(insertRow(editor, t, 1, "after")).toBe(true);
    expect(rows()).toEqual(["| A | B | C |", "| --- | --- | --- |", "| a1 | b1 | c1 |", "| | | |", "| a2 | b2 | c2 |"]);
    expectUndoRestores(before);
    expect(insertRow(editor, t, 1, "before")).toBe(true);
    expect(rows()[2]).toBe("| | | |");
    expect(editor.state.doc.child(0).child(1).child(0).type.name).toBe("tableCell");
  });

  it("insertRow refuses above the header and bad indexes", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(insertRow(editor, t, 0, "before")).toBe(false);
    expect(insertRow(editor, t, 9, "after")).toBe(false);
    expect(insertRow(editor, 500, 1, "after")).toBe(false);
    expect(editor.getMarkdown()).toBe(before);
  });

  it("insertRow copies column alignment", () => {
    const t = make("| A | B |\n| :---: | ---: |\n| 1 | 2 |");
    insertRow(editor, t, 1, "after");
    expect(editor.state.doc.child(0).child(2).child(0).attrs.align).toBe("center");
    expect(editor.state.doc.child(0).child(2).child(1).attrs.align).toBe("right");
  });

  it("deleteRow removes a body row, refuses the header, allows the last body row", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(deleteRow(editor, t, 0)).toBe(false);
    expect(deleteRow(editor, t, 1)).toBe(true);
    expect(rows()).toEqual(["| A | B | C |", "| --- | --- | --- |", "| a2 | b2 | c2 |"]);
    expectUndoRestores(before);
    deleteRow(editor, t, 1);
    expect(deleteRow(editor, t, 1)).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it("moveRow reorders body rows and refuses the header slot", () => {
    const t = make("| A |\n| --- |\n| r1 |\n| r2 |\n| r3 |");
    const before = editor.getMarkdown();
    expect(moveRow(editor, t, 1, 3)).toBe(true);
    expect(rows().slice(2)).toEqual(["| r2 |", "| r3 |", "| r1 |"]);
    expectUndoRestores(before);
    expect(moveRow(editor, t, 3, 2)).toBe(true);
    expect(rows().slice(2)).toEqual(["| r1 |", "| r3 |", "| r2 |"]);
    expect(moveRow(editor, t, 2, 0)).toBe(false);
    expect(moveRow(editor, t, 0, 2)).toBe(false);
    expect(moveRow(editor, t, 2, 2)).toBe(false);
    expect(moveRow(editor, t, 2, 9)).toBe(false);
  });

  it("duplicateRow copies content right below, refuses the header", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(duplicateRow(editor, t, 1)).toBe(true);
    expect(rows().slice(2)).toEqual(["| a1 | b1 | c1 |", "| a1 | b1 | c1 |", "| a2 | b2 | c2 |"]);
    expectUndoRestores(before);
    expect(duplicateRow(editor, t, 0)).toBe(false);
  });

  it("clearRow empties cells but keeps them, header included", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(clearRow(editor, t, 1)).toBe(true);
    expect(rows().slice(2)).toEqual(["| | | |", "| a2 | b2 | c2 |"]);
    expectUndoRestores(before);
    expect(clearRow(editor, t, 0)).toBe(true);
    expect(rows()[0]).toBe("| | | |");
    expect(editor.state.doc.child(0).child(0).child(0).type.name).toBe("tableHeader");
    expect(clearRow(editor, t, 8)).toBe(false);
  });

  it("appendRow adds a last body row and puts the cursor in its first cell", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(appendRow(editor, t)).toBe(true);
    expect(rows()).toHaveLength(5);
    expect(rows()[4]).toBe("| | | |");
    const $head = editor.state.selection.$head;
    expect($head.node($head.depth - 2).type.name).toBe("tableRow");
    expect($head.index($head.depth - 3)).toBe(3);
    expect($head.index($head.depth - 2)).toBe(0);
    expectUndoRestores(before);
  });
});

describe("table commands: columns", () => {
  it("insertColumn adds header + body cells with null align", () => {
    const t = make("| A | B |\n| :---: | ---: |\n| 1 | 2 |");
    const before = editor.getMarkdown();
    expect(insertColumn(editor, t, 0, "after")).toBe(true);
    expect(rows()).toEqual(["| A | | B |", "| :---: | --- | ---: |", "| 1 | | 2 |"]);
    expect(editor.state.doc.child(0).child(0).child(1).type.name).toBe("tableHeader");
    expect(editor.state.doc.child(0).child(1).child(1).type.name).toBe("tableCell");
    expectUndoRestores(before);
    insertColumn(editor, t, 0, "before");
    expect(rows()[0]).toBe("| | A | B |");
  });

  it("insertColumn refuses a bad index", () => {
    const t = make();
    expect(insertColumn(editor, t, 3, "after")).toBe(false);
    expect(insertColumn(editor, 900, 0, "after")).toBe(false);
  });

  it("deleteColumn removes a column and refuses the last one", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(deleteColumn(editor, t, 1)).toBe(true);
    expect(rows()[0]).toBe("| A | C |");
    expectUndoRestores(before);
    deleteColumn(editor, t, 1);
    deleteColumn(editor, t, 1);
    expect(rows()[0]).toBe("| A |");
    expect(deleteColumn(editor, t, 0)).toBe(false);
    expect(rows()[0]).toBe("| A |");
  });

  it("moveColumn reorders every row", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(moveColumn(editor, t, 0, 2)).toBe(true);
    expect(rows()).toEqual(["| B | C | A |", "| --- | --- | --- |", "| b1 | c1 | a1 |", "| b2 | c2 | a2 |"]);
    expectUndoRestores(before);
    expect(moveColumn(editor, t, 2, 1)).toBe(true);
    expect(rows()[0]).toBe("| A | C | B |");
    expect(moveColumn(editor, t, 1, 1)).toBe(false);
    expect(moveColumn(editor, t, 1, 3)).toBe(false);
  });

  it("duplicateColumn copies content and alignment to the right", () => {
    const t = make("| A | B |\n| :---: | --- |\n| 1 | 2 |");
    const before = editor.getMarkdown();
    expect(duplicateColumn(editor, t, 0)).toBe(true);
    expect(rows()).toEqual(["| A | A | B |", "| :---: | :---: | --- |", "| 1 | 1 | 2 |"]);
    expectUndoRestores(before);
    expect(duplicateColumn(editor, t, 5)).toBe(false);
  });

  it("clearColumn empties one column and keeps the cells", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(clearColumn(editor, t, 1)).toBe(true);
    expect(rows()).toEqual(["| A | | C |", "| --- | --- | --- |", "| a1 | | c1 |", "| a2 | | c2 |"]);
    expectUndoRestores(before);
    expect(clearColumn(editor, t, -1)).toBe(false);
  });

  it("appendColumn adds a last column and puts the cursor in its header cell", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(appendColumn(editor, t)).toBe(true);
    expect(rows()[0]).toBe("| A | B | C | |");
    const $head = editor.state.selection.$head;
    expect($head.node($head.depth - 2).type.name).toBe("tableRow");
    expect($head.index($head.depth - 3)).toBe(0);
    expect($head.index($head.depth - 2)).toBe(3);
    expectUndoRestores(before);
  });
});

describe("table commands: alignment", () => {
  it("setColumnAlign sets every cell and survives a markdown round trip", () => {
    const t = make();
    const before = editor.getMarkdown();
    expect(setColumnAlign(editor, t, 1, "center")).toBe(true);
    expect(setColumnAlign(editor, t, 2, "right")).toBe(true);
    expect(setColumnAlign(editor, t, 0, "left")).toBe(true);
    expect(rows()[1]).toBe("| :--- | :---: | ---: |");
    expect(getColumnAlign(editor, t, 1)).toBe("center");
    const reloaded = makeEditor(editor.getMarkdown());
    expect(reloaded.getMarkdown()).toBe(editor.getMarkdown());
    expect(reloaded.state.doc.child(0).child(2).child(1).attrs.align).toBe("center");
    reloaded.destroy();
    editor.commands.undo();
    editor.commands.undo();
    editor.commands.undo();
    expect(editor.getMarkdown()).toBe(before);
  });

  it("setColumnAlign keeps the column selection", () => {
    const t = make();
    selectColumn(editor, t, 1);
    expect(setColumnAlign(editor, t, 1, "right")).toBe(true);
    const sel = editor.state.selection as CellSelection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect(sel.isColSelection()).toBe(true);
    expect(getColumnAlign(editor, t, 1)).toBe("right");
  });

  it("setColumnAlign null clears it and refuses bad columns", () => {
    const t = make("| A | B |\n| :---: | --- |\n| 1 | 2 |");
    expect(setColumnAlign(editor, t, 0, null)).toBe(true);
    expect(getColumnAlign(editor, t, 0)).toBeNull();
    expect(rows()[1]).toBe("| --- | --- |");
    expect(setColumnAlign(editor, t, 4, "left")).toBe(false);
  });
});

describe("table commands: align no-op and availability", () => {
  it("setColumnAlign returns false without a transaction when every cell already has the align", () => {
    const t = make("| A | B |\n| :---: | --- |\n| 1 | 2 |");
    const before = editor.state.doc;
    expect(setColumnAlign(editor, t, 0, "center")).toBe(false);
    expect(setColumnAlign(editor, t, 1, null)).toBe(false);
    expect(editor.state.doc).toBe(before);
    editor.commands.undo();
    expect(editor.state.doc).toBe(before);
  });

  it("columnActions.align is true for an editable table", () => {
    const t = make();
    expect(columnActions(editor, t, 1).align).toBe(true);
    expect(columnActions(editor, t, 1).filter).toBe(true);
  });
});

const NAMES = (names: string[], extra = "") =>
  `| Name | Qty |\n| --- | --- |\n${names.map((n, i) => `| ${n} | ${extra || i} |`).join("\n")}`;

/** First-column cell texts of the body rows, in document order. */
function firstColumn(): string[] {
  return rows().slice(2).map((r) => r.split("|")[1].trim());
}

describe("table commands: sortColumn", () => {
  it.each([
    ["asc", ["apple", "Banana", "cherry"]],
    ["desc", ["cherry", "Banana", "apple"]],
  ] as const)("sorts text %s, ignoring case", (dir, expected) => {
    const t = make(NAMES(["cherry", "apple", "Banana"]));
    expect(sortColumn(editor, t, 0, dir)).toBe(true);
    expect(firstColumn()).toEqual(expected);
  });

  it("keeps the header row first", () => {
    const t = make(NAMES(["b", "a"]));
    sortColumn(editor, t, 0, "asc");
    expect(rows()[0]).toBe("| Name | Qty |");
  });

  it.each([
    ["asc", ["2", "10", "100"]],
    ["desc", ["100", "10", "2"]],
  ] as const)("compares numbers by value %s (not as text)", (dir, expected) => {
    const t = make("| N |\n| --- |\n| 10 |\n| 100 |\n| 2 |");
    sortColumn(editor, t, 0, dir);
    expect(firstColumn()).toEqual(expected);
  });

  it("falls back to text compare when one cell is not a number, numeric-aware", () => {
    const t = make("| N |\n| --- |\n| item 10 |\n| item 2 |\n| 5 |");
    sortColumn(editor, t, 0, "asc");
    expect(firstColumn()).toEqual(["5", "item 2", "item 10"]);
  });

  it.each(["asc", "desc"] as const)("puts empty cells last when sorting %s", (dir) => {
    const t = make("| N | K |\n| --- | --- |\n|  | e |\n| b | x |\n| a | y |");
    sortColumn(editor, t, 0, dir);
    expect(rows().slice(2).map((r) => r.split("|")[2].trim()).pop()).toBe("e");
  });

  it.each([
    [["1.5", "1.10", "1.7a"]],
    [["1.7a", "1.10", "1.5"]],
  ])("sorts a mixed column by one text rule and a second sort changes nothing (%j)", (input) => {
    const t = make(`| N |\n| --- |\n${input.map((v) => `| ${v} |`).join("\n")}`);
    sortColumn(editor, t, 0, "asc");
    expect(firstColumn()).toEqual(["1.5", "1.7a", "1.10"]);
    expect(sortColumn(editor, t, 0, "asc")).toBe(false);
  });

  it.each([
    [["950", "1,200", "80"], ["80", "950", "1,200"]],
    [["-5", "-10", "3"], ["-10", "-5", "3"]],
    [["$1,000", "€20", "5%"], ["5%", "€20", "$1,000"]],
    [["1 200", "950", "80"], ["80", "950", "1 200"]],
  ])("reads %j as numbers", (input, expected) => {
    const t = make(`| N |\n| --- |\n${input.map((v) => `| ${v} |`).join("\n")}`);
    sortColumn(editor, t, 0, "asc");
    expect(firstColumn()).toEqual(expected);
  });

  it.each([
    ["950", 950],
    ["1,200.5", 1200.5],
    ["-$5", -5],
    ["12%", 12],
    ["1\u202f000", 1000],
    ["1,5", null],
    ["12a", null],
    ["", null],
  ])("parseCellNumber(%j)", (text, expected) => {
    expect(parseCellNumber(text)).toBe(expected);
  });

  it("is stable for equal keys", () => {
    const t = make("| K | V |\n| --- | --- |\n| a | 1 |\n| A | 2 |\n| a | 3 |");
    sortColumn(editor, t, 0, "desc");
    expect(rows().slice(2).map((r) => r.split("|")[2].trim())).toEqual(["1", "2", "3"]);
  });

  it("moves whole rows and is one undo step", () => {
    const t = make(NAMES(["b", "a"]));
    const before = editor.getMarkdown();
    sortColumn(editor, t, 0, "asc");
    expect(rows().slice(2)).toEqual(["| a | 1 |", "| b | 0 |"]);
    expectUndoRestores(before);
  });

  it("keeps inline marks of the moved cells", () => {
    const t = make("| N |\n| --- |\n| **b** |\n| *a* |");
    sortColumn(editor, t, 0, "asc");
    expect(rows().slice(2)).toEqual(["| *a* |", "| **b** |"]);
  });

  it("returns false and leaves the document alone when the order does not change", () => {
    const t = make(NAMES(["a", "b"]));
    const before = editor.state.doc;
    expect(sortColumn(editor, t, 0, "asc")).toBe(false);
    expect(editor.state.doc).toBe(before);
  });

  it("refuses a bad column, a header-only table and a non-table position", () => {
    const t = make(NAMES(["b", "a"]));
    expect(sortColumn(editor, t, 5, "asc")).toBe(false);
    expect(sortColumn(editor, 1, 0, "asc")).toBe(false);
    const single = make("| N |\n| --- |\n| a |");
    expect(sortColumn(editor, single, 0, "asc")).toBe(false);
    expect(columnActions(editor, single, 0).sort).toBe(false);
  });
});

describe("table commands: refusals", () => {
  it("every command returns false when the position is not a table", () => {
    make(`para\n\n${SRC}`);
    const p = 0;
    expect(insertRow(editor, p, 1, "after")).toBe(false);
    expect(deleteRow(editor, p, 1)).toBe(false);
    expect(moveRow(editor, p, 1, 2)).toBe(false);
    expect(duplicateRow(editor, p, 1)).toBe(false);
    expect(clearRow(editor, p, 1)).toBe(false);
    expect(insertColumn(editor, p, 0, "after")).toBe(false);
    expect(deleteColumn(editor, p, 0)).toBe(false);
    expect(moveColumn(editor, p, 0, 1)).toBe(false);
    expect(duplicateColumn(editor, p, 0)).toBe(false);
    expect(clearColumn(editor, p, 0)).toBe(false);
    expect(setColumnAlign(editor, p, 0, "left")).toBe(false);
    expect(appendRow(editor, p)).toBe(false);
    expect(appendColumn(editor, p)).toBe(false);
    expect(selectRow(editor, p, 0)).toBe(false);
    expect(selectColumn(editor, p, 0)).toBe(false);
    expect(getColumnAlign(editor, p, 0)).toBeNull();
    expect(rowActions(editor, p, 1).delete).toBe(false);
    expect(columnActions(editor, p, 0).delete).toBe(false);
    expect(columnActions(editor, p, 0).align).toBe(false);
    expect(columnActions(editor, p, 0).filter).toBe(false);
  });
});
