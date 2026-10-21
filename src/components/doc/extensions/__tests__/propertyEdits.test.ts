import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyLoaded, load, parseTwice } from "../../ui/__tests__/editorFixture";
import { clearProperty, setPropertyDate, setPropertyOption, setPropertyText } from "../propertyEdits";

const SRC = "|  |  |\n| --- | --- |\n| Status | Active |\n| Owner | Ann |";

afterEach(destroyLoaded);

/** Position of the nth row of the first property list (the list sits at 0, its first row at 1). */
function rowPos(editor: Editor, index: number): number {
  let pos = 1;
  const list = editor.state.doc.firstChild!;
  for (let i = 0; i < index; i += 1) pos += list.child(i).nodeSize;
  return pos;
}

describe("property value edits", () => {
  it("sets an option as one tagged run and survives parse-twice", () => {
    const editor = load(SRC);
    expect(setPropertyOption(editor, rowPos(editor, 0), "Done", "green")).toBe(true);
    const markdown = editor.getMarkdown();
    expect(markdown).toContain('| Status | <span data-bg="green">Done</span> |');
    expect(markdown).toContain("| Owner | Ann |");
    expect(parseTwice(markdown)).toBe(markdown);
  });

  it("sets a date as plain text", () => {
    const editor = load(SRC);
    setPropertyDate(editor, rowPos(editor, 1), "2026-10-21");
    expect(editor.getMarkdown()).toContain("| Owner | 2026-10-21 |");
  });

  it("rejects a malformed date", () => {
    const editor = load(SRC);
    expect(setPropertyDate(editor, rowPos(editor, 1), "21.10.2026")).toBe(false);
    expect(editor.getMarkdown()).toContain("| Owner | Ann |");
  });

  it("clears the value and keeps the key", () => {
    const editor = load(SRC);
    clearProperty(editor, rowPos(editor, 0));
    expect(editor.getMarkdown()).toContain("| Status |  |");
  });

  it("drops the tag mark when text replaces a tag", () => {
    const editor = load("|  |  |\n| --- | --- |\n| Status | <span data-bg=\"red\">Bad</span> |");
    setPropertyText(editor, rowPos(editor, 0), "Fine");
    expect(editor.getMarkdown()).toContain("| Status | Fine |");
  });

  it("refuses a blank option and a position that is not a row", () => {
    const editor = load(SRC);
    expect(setPropertyOption(editor, rowPos(editor, 0), "  ", "gray")).toBe(false);
    expect(setPropertyText(editor, 0, "x")).toBe(false);
  });

  it("puts the caret at the end of the new value", () => {
    const editor = load(SRC);
    setPropertyOption(editor, rowPos(editor, 0), "Done", "green");
    const { $from } = editor.state.selection;
    expect([$from.parent.type.name, $from.parentOffset]).toEqual(["propertyValue", 4]);
  });

  it("is a single undo step", () => {
    const editor = load(SRC);
    setPropertyOption(editor, rowPos(editor, 0), "Done", "green");
    editor.commands.undo();
    expect(editor.getMarkdown()).toContain("| Status | Active |");
  });
});
