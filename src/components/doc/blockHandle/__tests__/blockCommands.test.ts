import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { blockHasText, deleteBlock, duplicateBlock, insertBelowAndOpenSlash, resolveBlockPos, selectBlockText } from "../blockCommands";
import { makeEditor, topTypes } from "@/components/doc/ui/__tests__/editorFixture";

let editor: Editor;
afterEach(() => editor.destroy());

/** Doc position of the n-th top-level block. */
function posOf(index: number): number {
  let pos = 0;
  editor.state.doc.forEach((_node, offset, i) => {
    if (i === index) pos = offset;
  });
  return pos;
}

describe("block commands", () => {
  it("deleteBlock removes only that block", () => {
    editor = makeEditor("one\n\n# two\n\nthree");
    deleteBlock(editor, posOf(1));
    expect(topTypes(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.getText()).toBe("one\n\nthree");
  });

  it("deleteBlock on the only block leaves one empty paragraph", () => {
    editor = makeEditor("only");
    deleteBlock(editor, posOf(0));
    expect(topTypes(editor)).toEqual(["paragraph"]);
    expect(editor.getText()).toBe("");
  });

  it("duplicateBlock inserts a copy right below, keeping the type", () => {
    editor = makeEditor("# Head\n\n- a\n- b\n\ntail");
    duplicateBlock(editor, posOf(1));
    expect(topTypes(editor)).toEqual(["heading", "bulletList", "bulletList", "paragraph"]);
    expect(editor.getMarkdown()).toBe("# Head\n\n- a\n- b\n\n- a\n- b\n\ntail");
  });

  it("insertBelowAndOpenSlash adds a paragraph holding a slash under the block", () => {
    editor = makeEditor("# Head\n\ntail");
    insertBelowAndOpenSlash(editor, posOf(0));
    expect(topTypes(editor)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(editor.state.doc.child(1).textContent).toBe("/");
    expect(editor.state.selection.from).toBe(editor.state.doc.child(0).nodeSize + 2);
  });

  it("insertBelowAndOpenSlash reuses an empty paragraph", () => {
    editor = makeEditor("# Head");
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    insertBelowAndOpenSlash(editor, posOf(1));
    expect(topTypes(editor)).toEqual(["heading", "paragraph"]);
    expect(editor.state.doc.child(1).textContent).toBe("/");
  });

  it("blockHasText is false for a property list, so Turn into is not offered", () => {
    editor = makeEditor("|  |  |\n| --- | --- |\n| a | b |\n\ntail");
    expect(topTypes(editor)).toEqual(["propertyList", "paragraph"]);
    expect(blockHasText(editor, posOf(0))).toBe(false);
    expect(blockHasText(editor, posOf(1))).toBe(true);
  });

  it("selectBlockText selects the whole text of the block", () => {
    editor = makeEditor("one\n\ntwo words\n\nthree");
    selectBlockText(editor, posOf(1));
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("two words");
  });

  it("selectBlockText spans a whole list", () => {
    editor = makeEditor("- a\n- b\n\nafter");
    selectBlockText(editor, posOf(0));
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to, " ")).toBe("a b");
  });

  it("selectBlockText on a divider selects the divider itself, not a neighbour", () => {
    editor = makeEditor("before\n\n---\n\nafter");
    expect(topTypes(editor)).toEqual(["paragraph", "horizontalRule", "paragraph"]);
    expect(blockHasText(editor, posOf(1))).toBe(false);
    expect(blockHasText(editor, posOf(0))).toBe(true);
    selectBlockText(editor, posOf(1));
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect(selection.from).toBe(posOf(1));
    expect(selection.to).toBe(posOf(2));
  });

  it("deleteBlock and duplicateBlock work on a divider", () => {
    editor = makeEditor("before\n\n---\n\nafter");
    duplicateBlock(editor, posOf(1));
    expect(topTypes(editor)).toEqual(["paragraph", "horizontalRule", "horizontalRule", "paragraph"]);
    deleteBlock(editor, posOf(1));
    expect(topTypes(editor)).toEqual(["paragraph", "horizontalRule", "paragraph"]);
  });

  it("resolveBlockPos follows a block's DOM element across edits", () => {
    editor = makeEditor("one\n\ntwo\n\nthree");
    const el = editor.view.nodeDOM(posOf(2)) as HTMLElement;
    expect(resolveBlockPos(editor, el)).toBe(posOf(2));
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "zero" }] });
    expect(resolveBlockPos(editor, el)).toBe(posOf(3));
    deleteBlock(editor, posOf(3));
    expect(resolveBlockPos(editor, el)).toBeNull();
    expect(resolveBlockPos(editor, null)).toBeNull();
  });

  it("resolveBlockPos resolves leaf blocks (hr, image) and rejects a detached element", () => {
    editor = makeEditor("one\n\n---\n\n![alt](https://example.com/a.png)\n\ntail");
    const types = topTypes(editor);
    for (const name of ["horizontalRule", "image"]) {
      const index = types.indexOf(name);
      if (index < 0) continue;
      const el = editor.view.nodeDOM(posOf(index)) as HTMLElement;
      expect(resolveBlockPos(editor, el)).toBe(posOf(index));
    }
    expect(types.some((name) => name === "horizontalRule" || name === "image")).toBe(true);
    expect(resolveBlockPos(editor, document.createElement("p"))).toBeNull();
    const nested = editor.view.dom.querySelector("p") as HTMLElement;
    expect(resolveBlockPos(editor, nested)).toBe(posOf(0));
  });
});
