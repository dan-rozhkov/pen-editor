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
  rowActions,
  selectColumn,
  selectRow,
  setColumnAlign,
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
  });
});
