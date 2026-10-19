import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { bubbleVisible } from "../bubbleRules";
import { normalizeLinkHref } from "../linkHref";
import { makeEditor } from "./editorFixture";

let editor: Editor;
afterEach(() => editor.destroy());

describe("bubbleVisible", () => {
  it("shows for a non-empty text selection", () => {
    editor = makeEditor("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(bubbleVisible(editor.state, true)).toBe(true);
  });

  it("hides for a caret, an inactive editor and a read-only editor", () => {
    editor = makeEditor("hello world");
    editor.commands.setTextSelection(3);
    expect(bubbleVisible(editor.state, true)).toBe(false);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(bubbleVisible(editor.state, false)).toBe(false);
    expect(bubbleVisible(editor.state, true, false)).toBe(false);
  });

  it("hides inside a code block", () => {
    editor = makeEditor("```js\nconst a = 1;\n```");
    editor.commands.setTextSelection({ from: 2, to: 8 });
    expect(bubbleVisible(editor.state, true)).toBe(false);
  });

  it("hides for a node selection", () => {
    editor = makeEditor("![alt](https://x.test/a.png)\n\ntext");
    editor.commands.setNodeSelection(1);
    expect(bubbleVisible(editor.state, true)).toBe(false);
  });
});

describe("normalizeLinkHref", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["example.com", "https://example.com"],
    [" https://a.test/x ", "https://a.test/x"],
    ["mailto:a@b.c", "mailto:a@b.c"],
    ["/doc?id=1", "/doc?id=1"],
    ["#top", "#top"],
  ])("%j becomes %j", (input, expected) => {
    expect(normalizeLinkHref(input)).toBe(expected);
  });
});
