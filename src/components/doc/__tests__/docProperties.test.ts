import type { Editor, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { inferIconKind, insertFlattenedIntoCell, isDateText, type PropertyValueFacts } from "@/components/doc/extensions/docProperties";
import { Slice } from "@tiptap/pm/model";
import { Editor as TiptapEditor } from "@tiptap/core";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";
import { SlashCommand } from "@/components/doc/slash/SlashCommand";
import { isSlashActive } from "@/components/doc/slash/slashKey";
import { filterSlashItems, runSlashItem, SLASH_ITEMS, slashItemsAt } from "@/components/doc/slash/slashItems";
import { destroyLoaded, load, own, parseTwice, topTypes } from "@/components/doc/ui/__tests__/editorFixture";

const HEAD = "|  |  |\n| --- | --- |";
const list = (...rows: string[]) => [HEAD, ...rows].join("\n");

const PLAIN = list("| Status | Active |", "| Owner |  |");
const TAG = list('| Status | <span data-bg="gray">Active</span> |');
const LINKS = list("| Links | [Spec](https://a) [Design](https://b) |");
const CODE = list("| Cmd | `npm run dev` |");
const PIPE = list("| Choice | a \\| b |");
const MIXED = list(
  "| Name | **Bold** value |",
  "| Empty |  |",
  '| Tag | <span data-bg="gray">Active</span> |',
  "| Links | [Spec](https://a) [Design](https://b) |",
  "| Cmd | `x` |",
  "| Pipe | a \\| b |",
);

afterEach(destroyLoaded);

function makeSlashEditor(markdown: string): Editor {
  const editor = own(new TiptapEditor({ extensions: [...DOC_EXTENSIONS, SlashCommand], content: markdown, contentType: "markdown" }));
  editor.view.focus();
  return editor;
}

const topNode = (editor: Editor): JSONContent => editor.getJSON().content![0];

describe("property list parsing", () => {
  it("turns a 2-column table with an empty header into a property list", () => {
    const node = topNode(load(PLAIN));
    expect(node.type).toBe("propertyList");
    expect(node.content).toHaveLength(2);
    expect(node.content![0].content!.map((n) => n.type)).toEqual(["propertyKey", "propertyValue"]);
  });

  it.each([
    ["a non-empty header", "| Name | Value |\n| --- | --- |\n| a | b |"],
    ["three columns with an empty header", "|  |  |  |\n| --- | --- | --- |\n| a | b | c |"],
    ["one empty and one filled header cell", "|  | Value |\n| --- | --- |\n| a | b |"],
    ["the padded empty header the stock serializer writes", "|      |     |\n| ---- | --- |\n| a    | b   |"],
  ])("keeps %s as a normal table", (_name, markdown) => {
    expect(topNode(load(markdown)).type).toBe("table");
  });

  it.each([
    ["one space per cell", "| | |"],
    ["two spaces per cell", "|  |  |"],
  ])("turns a header with %s into a property list", (_name, header) => {
    expect(topNode(load(`${header}\n| --- | --- |\n| a | b |`)).type).toBe("propertyList");
  });

  it("keeps a header-less HTML table a table through serialize and reload", () => {
    const editor = load("");
    editor.commands.setContent("<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>", { contentType: "html" });
    const markdown = editor.getMarkdown();
    expect(topNode(load(markdown)).type).toBe("table");
    expect(topNode(load(parseTwice(markdown))).type).toBe("table");
  });

  it("keeps a table whose header cells were cleared a table", () => {
    const source = load("| Name | Value |\n| --- | --- |\n| a | b |");
    const json: JSONContent = source.getJSON();
    json.content![0].content![0].content!.forEach((cell) => {
      cell.content = [{ type: "paragraph" }];
    });
    const editor = load("");
    editor.commands.setContent(json);
    expect(topNode(load(editor.getMarkdown())).type).toBe("table");
  });

  it("round-trips a normal table byte for byte", () => {
    const table = "| Name | Value |\n| ---- | ----- |\n| a    | b     |";
    expect(parseTwice(table).trim()).toBe(table);
  });
});

describe("property list markdown", () => {
  it.each([
    ["plain text and an empty value", PLAIN],
    ["a tag span", TAG],
    ["two links", LINKS],
    ["inline code", CODE],
    ["a pipe inside a value", PIPE],
    ["every kind together", MIXED],
  ])("serializes %s exactly and parses twice to the same text", (_name, markdown) => {
    expect(load(markdown).getMarkdown()).toBe(markdown);
    expect(parseTwice(markdown)).toBe(markdown);
  });

  it("keeps the pipe as text inside the value", () => {
    const value = topNode(load(PIPE)).content![0].content![1];
    expect(value.content![0].text).toBe("a | b");
  });
});

describe("icon inference", () => {
  const facts = (over: Partial<PropertyValueFacts>): PropertyValueFacts => ({ text: "x", hasLink: false, onlyTags: false, ...over });

  it.each([
    ["empty", facts({ text: "  " }), "text"],
    ["an ISO date", facts({ text: "2026-10-20" }), "date"],
    ["a long date", facts({ text: "Oct 18, 2019" }), "date"],
    ["a dotted date", facts({ text: "20.10.2026" }), "date"],
    ["a date range", facts({ text: "2026-10-20 → 2026-11-01" }), "date"],
    ["a link", facts({ text: "Spec", hasLink: true }), "link"],
    ["tags only", facts({ text: "Active", onlyTags: true }), "tags"],
    ["a number", facts({ text: "42.5" }), "number"],
    ["words", facts({ text: "Hello there" }), "lines"],
  ])("%s", (_name, input, expected) => {
    expect(inferIconKind(input)).toBe(expected);
  });

  it.each([
    ["2026-10-20", true],
    ["3 Mar 2020", true],
    ["2026-10-20 → nope", false],
    ["call 2026", false],
    ["20.10.2026", true],
    ["10/20/2026", true],
    ["October 18, 2019", true],
    ["Aug 28, 2019 → Oct 18, 2019", true],
    ["18 октября 2019", true],
    ["2.10.15", false],
    ["1.2.30", false],
    ["Decision 5, 2024", false],
    ["Mayday 1 2020", false],
    ["45.13.2026", false],
  ])("isDateText(%s) is %s", (text, expected) => {
    expect(isDateText(text)).toBe(expected);
  });
});

describe("property list commands", () => {
  const keyDown = (editor: Editor, key: string, shiftKey = false) =>
    editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, new KeyboardEvent("keydown", { key, shiftKey, cancelable: true })));
  const rows = (editor: Editor) => topNode(editor).content ?? [];
  /** Put the cursor at the start of the nth key (0) or value (1) of row `row`. */
  function cursorAt(editor: Editor, row: number, part: 0 | 1) {
    let pos = 1;
    editor.state.doc.firstChild!.forEach((r, offset, index) => {
      const before = r.firstChild!.nodeSize;
      pos = index === row ? 1 + offset + 2 + (part ? before : 0) : pos;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  }
  /** Select the whole "Active" text of the first row's value. */
  function selectActive(editor: Editor) {
    cursorAt(editor, 0, 1);
    const from = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + "Active".length)));
  }
  const inPart = (editor: Editor) => editor.state.selection.$from.parent.type.name;

  it("the slash item creates one empty row with the cursor in its key", () => {
    const editor = load("/p");
    runSlashItem(editor, { from: 1, to: 3 }, SLASH_ITEMS.find((item) => item.id === "properties")!);
    expect(topTypes(editor)).toContain("propertyList");
    expect(rows(editor)).toHaveLength(1);
    expect(inPart(editor)).toBe("propertyKey");
  });

  it.each([["properties"], ["fields"], ["key value"], ["свойства"]])("slash search finds Properties for %s", (query) => {
    expect(filterSlashItems(query).map((item) => item.title)).toContain("Properties");
  });

  it("Enter in a key moves to its value", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 0, 0);
    expect(keyDown(editor, "Enter")).toBe(true);
    expect(inPart(editor)).toBe("propertyValue");
    expect(rows(editor)).toHaveLength(2);
  });

  it("Enter in a value adds a row below and moves into its key", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 0, 1);
    keyDown(editor, "Enter");
    expect(rows(editor)).toHaveLength(3);
    expect(inPart(editor)).toBe("propertyKey");
    expect(editor.state.selection.$from.index(1)).toBe(1);
  });

  it("Tab and Shift-Tab walk key, value and the next row", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 0, 0);
    keyDown(editor, "Tab");
    expect(inPart(editor)).toBe("propertyValue");
    keyDown(editor, "Tab");
    expect(editor.state.selection.$from.index(1)).toBe(1);
    expect(inPart(editor)).toBe("propertyKey");
    keyDown(editor, "Tab", true);
    expect(editor.state.selection.$from.index(1)).toBe(0);
    expect(inPart(editor)).toBe("propertyValue");
  });

  it("Backspace at the start of an empty row's key deletes the row", () => {
    const editor = load(list("| A | 1 |", "|  |  |"));
    cursorAt(editor, 1, 0);
    expect(keyDown(editor, "Backspace")).toBe(true);
    expect(rows(editor)).toHaveLength(1);
    expect(inPart(editor)).toBe("propertyValue");
  });

  it("Backspace on the last remaining empty row replaces the list with a paragraph", () => {
    const editor = load(list("|  |  |"));
    cursorAt(editor, 0, 0);
    keyDown(editor, "Backspace");
    expect(topTypes(editor)).not.toContain("propertyList");
    expect(inPart(editor)).toBe("paragraph");
  });

  it("Backspace at the start of a filled row's key is swallowed and changes nothing", () => {
    const editor = load(PLAIN);
    const before = rows(editor);
    cursorAt(editor, 0, 0);
    expect(keyDown(editor, "Backspace")).toBe(true);
    expect(rows(editor)).toEqual(before);
  });

  it("Backspace in the first block's key (list opens the doc, key empty, value filled) leaves the document unchanged", () => {
    const editor = load(list("|  | x |"));
    const before = rows(editor);
    cursorAt(editor, 0, 0);
    expect(keyDown(editor, "Backspace")).toBe(true);
    expect(rows(editor)).toEqual(before);
    expect(topTypes(editor)[0]).toBe("propertyList");
    expect(inPart(editor)).toBe("propertyKey");
  });

  it("Backspace at the start of a value moves the caret to the end of its key", () => {
    const editor = load(PLAIN);
    const before = rows(editor);
    cursorAt(editor, 0, 1);
    expect(keyDown(editor, "Backspace")).toBe(true);
    expect(rows(editor)).toEqual(before);
    expect(inPart(editor)).toBe("propertyKey");
    expect(editor.state.selection.$from.parentOffset).toBe("Status".length);
  });

  it("an empty-looking row whose value holds a hard break is not deleted by Backspace", () => {
    const editor = load(list("| A | 1 |", "|  |  |"));
    const json: JSONContent = editor.getJSON();
    json.content![0].content![1].content![1].content = [{ type: "hardBreak" }];
    editor.commands.setContent(json);
    cursorAt(editor, 1, 0);
    expect(keyDown(editor, "Backspace")).toBe(true);
    expect(rows(editor)).toHaveLength(2);
  });

  it("Tab in the last row's value appends a row and focuses its key", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 1, 1);
    expect(keyDown(editor, "Tab")).toBe(true);
    expect(rows(editor)).toHaveLength(3);
    expect(inPart(editor)).toBe("propertyKey");
    expect(editor.state.selection.$from.index(1)).toBe(2);
  });

  it("Shift-Tab in the first row's key is swallowed and the caret stays", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 0, 0);
    const { from } = editor.state.selection;
    expect(keyDown(editor, "Tab", true)).toBe(true);
    expect(editor.state.selection.from).toBe(from);
  });

  it("Tab does not delete a selection, it collapses to the target cell", () => {
    const editor = load(PLAIN);
    selectActive(editor);
    keyDown(editor, "Tab");
    expect(rows(editor)[0].content![1].content![0].text).toBe("Active");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.index(1)).toBe(1);
  });

  it("Shift-Tab does not delete a selection in a value", () => {
    const editor = load(PLAIN);
    selectActive(editor);
    keyDown(editor, "Tab", true);
    expect(rows(editor)[0].content![1].content![0].text).toBe("Active");
    expect(inPart(editor)).toBe("propertyKey");
  });

  it("Enter replaces a selected range inside the value before adding the row", () => {
    const editor = load(PLAIN);
    selectActive(editor);
    keyDown(editor, "Enter");
    expect(rows(editor)).toHaveLength(3);
    expect(rows(editor)[0].content![1].content).toBeUndefined();
    expect(inPart(editor)).toBe("propertyKey");
  });

  it("Tab with a selection reaching outside the list is left to the editor", () => {
    const editor = load(`${PLAIN}\n\ntail`);
    cursorAt(editor, 0, 0);
    const { from } = editor.state.selection;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, editor.state.doc.content.size - 1)));
    expect(keyDown(editor, "Tab")).not.toBe(true);
    expect(editor.getText()).toContain("tail");
  });

  it("pasting several paragraphs into a value keeps one row and joins them with a space", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 1, 1);
    const before = topTypes(editor);
    editor.view.pasteHTML("<p>first</p><p>second</p>");
    expect(topTypes(editor)).toEqual(before);
    expect(rows(editor)).toHaveLength(2);
    expect(rows(editor)[1].content![1].content![0].text).toBe("first second");
  });

  it("pasting a list into a key stays inside the key", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 1, 0);
    const before = topTypes(editor);
    editor.view.pasteHTML("<ul><li>one</li><li>two</li></ul>");
    expect(topTypes(editor)).toEqual(before);
    expect(rows(editor)[1].content![0].content![0].text).toContain("one two");
  });

  it("pasting paragraphs while the caret is in a cell but the target is the selection elsewhere changes nothing special", () => {
    const editor = load(`${PLAIN}\n\ntail`);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteHTML("<p>first</p><p>second</p>");
    expect(topTypes(editor)).toEqual(["propertyList", "paragraph", "paragraph"]);
  });

  it("a drop landing in a cell is flattened into it", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 1, 1);
    const at = editor.state.selection.from;
    const slice = new Slice(editor.schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] }).content, 0, 0);
    expect(insertFlattenedIntoCell(editor.view, at, slice)).toBe(true);
    expect(rows(editor)).toHaveLength(2);
    expect(rows(editor)[1].content![1].content![0].text).toBe("a b");
  });

  it("a drop with no inline content (a divider) is swallowed and changes nothing", () => {
    const editor = load(PLAIN);
    cursorAt(editor, 1, 1);
    const before = JSON.stringify(rows(editor));
    const slice = new Slice(editor.schema.nodeFromJSON({ type: "doc", content: [{ type: "horizontalRule" }] }).content, 0, 0);
    expect(insertFlattenedIntoCell(editor.view, editor.state.selection.from, slice)).toBe(true);
    expect(JSON.stringify(rows(editor))).toBe(before);
  });

  it("a drop outside a cell is left to the default handler even with the caret in a cell", () => {
    const editor = load(`${PLAIN}\n\ntail`);
    cursorAt(editor, 0, 0);
    const slice = new Slice(editor.schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }).content, 0, 0);
    expect(insertFlattenedIntoCell(editor.view, editor.state.doc.content.size - 1, slice)).toBe(false);
    expect(topTypes(editor)).toEqual(["propertyList", "paragraph"]);
  });

  it("insertPropertyList in the middle of the doc puts the cursor in the new list's key", () => {
    const editor = load("a\n\ntail");
    editor.commands.insertContentAt(editor.state.doc.firstChild!.nodeSize, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1);
    editor.commands.insertPropertyList();
    expect(topTypes(editor)).toEqual(["paragraph", "propertyList", "paragraph"]);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("propertyKey");
    expect($from.node(1).type.name).toBe("propertyList");
    expect($from.index(0)).toBe(1);
  });

  it("insertPropertyList at the end of the doc puts the cursor in its key", () => {
    const editor = load("a");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertPropertyList();
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("propertyKey");
    expect(topTypes(editor)).toContain("propertyList");
  });

  it("insertPropertyList right after a list puts the cursor in the NEW list's key", () => {
    const editor = load(`${PLAIN}\n\ntail`);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertPropertyList();
    expect(topTypes(editor).filter((type) => type === "propertyList")).toHaveLength(2);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe("propertyKey");
    expect($from.index(0)).toBeGreaterThan(0);
    expect($from.node(1).childCount).toBe(1);
  });
});

describe("property cells and the slash menu", () => {
  it("hides Properties and Table inside a table cell and header", () => {
    const editor = load("| h | h |\n| --- | --- |\n| a | b |");
    const ids = (pos: number) => slashItemsAt(editor.state.doc.resolve(pos)).map((item) => item.id);
    const header = 4;
    const body = editor.state.doc.firstChild!.nodeSize - 6;
    expect(ids(header)).not.toContain("properties");
    expect(ids(body)).not.toContain("properties");
    expect(ids(body)).not.toContain("table");
    expect(ids(body)).toContain("text");
  });

  it("keeps Properties outside tables", () => {
    const editor = load("x");
    expect(slashItemsAt(editor.state.doc.resolve(1)).map((item) => item.id)).toContain("properties");
  });

  const typeSlash = (editor: Editor) => editor.view.dispatch(editor.state.tr.insertText("/"));

  it("does not open inside a value but still opens in a paragraph", () => {
    const inCell = makeSlashEditor(PLAIN);
    inCell.commands.setTextSelection(inCell.state.doc.firstChild!.nodeSize - 4);
    typeSlash(inCell);
    expect(inCell.state.doc.firstChild!.textContent).toContain("/");
    expect(isSlashActive(inCell.state)).toBe(false);
    const inParagraph = makeSlashEditor("x ");
    inParagraph.commands.setTextSelection(3);
    typeSlash(inParagraph);
    expect(isSlashActive(inParagraph.state)).toBe(true);
  });
});
