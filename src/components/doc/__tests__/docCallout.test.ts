import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@tiptap/pm/state";
import { destroyLoaded, load, parseTwice, topTypes } from "@/components/doc/ui/__tests__/editorFixture";
import { runSlashItem, SLASH_ITEMS } from "@/components/doc/slash/slashItems";
import { CALLOUT_KINDS } from "@/components/doc/extensions/docCallout";

afterEach(destroyLoaded);

describe("callout round trip", () => {
  it.each(CALLOUT_KINDS.map((kind) => [kind, `> [!${kind.toUpperCase()}]\n> Body text.`]))("keeps a %s callout byte for byte", (kind, markdown) => {
    expect(parseTwice(markdown)).toBe(markdown);
    const node = load(markdown).getJSON().content?.[0];
    expect(node?.type).toBe("callout");
    expect(node?.attrs).toEqual({ kind });
  });

  it("normalizes a lower-case marker", () => {
    expect(parseTwice("> [!warning]\n> Careful")).toBe("> [!WARNING]\n> Careful");
  });

  it("keeps several paragraphs, a list and a blank line in the body", () => {
    const markdown = "> [!TIP]\n> First\n>\n> Second\n>\n> - one\n> - two\n>\n> ```js\n> const a = 1;\n>\n> const b = 2;\n> ```";
    expect(parseTwice(markdown)).toBe(markdown);
    expect(topTypes(load(markdown))).toEqual(["callout"]);
  });

  it("keeps a nested toggle inside the body", () => {
    const markdown = "> [!NOTE]\n> <details>\n> <summary>More</summary>\n>\n> Hidden\n>\n> </details>";
    expect(parseTwice(markdown)).toBe(markdown);
    expect(load(markdown).getJSON().content?.[0].content?.[0].type).toBe("details");
  });

  it("keeps a marker-only callout and text after it", () => {
    expect(parseTwice("> [!NOTE]\n\nAfter")).toBe("> [!NOTE]\n\nAfter");
    expect(topTypes(load("> [!NOTE]\n\nAfter"))).toEqual(["callout", "paragraph"]);
  });

  it("leaves a plain quote a quote", () => {
    expect(parseTwice("> Just a quote")).toBe("> Just a quote");
    expect(topTypes(load("> Just a quote"))).toEqual(["blockquote"]);
  });

  it("leaves an unknown marker a quote with the text intact", () => {
    const editor = load("> [!UNKNOWN]\n> Body");
    expect(topTypes(editor)).toEqual(["blockquote"]);
    expect(editor.getMarkdown()).toContain("\\[!UNKNOWN\\]");
    expect(editor.getMarkdown()).toContain("Body");
  });

  it("lives next to a property list and a toggle", () => {
    const markdown = "|  |  |\n| --- | --- |\n| Owner | Ann |\n\n> [!CAUTION]\n> Mind the gap\n\n<details>\n<summary>T</summary>\n\nBody\n\n</details>";
    expect(parseTwice(markdown)).toBe(markdown);
    expect(topTypes(load(markdown))).toEqual(["propertyList", "callout", "details"]);
  });
});

describe("callout editing", () => {
  it("the slash item inserts a note callout with the caret inside", () => {
    const editor = load("/c");
    const item = SLASH_ITEMS.find((candidate) => candidate.id === "callout")!;
    runSlashItem(editor, { from: 1, to: 3 }, item);
    const json = editor.getJSON().content ?? [];
    expect(json.map((node) => node.type)).toEqual(["callout", "paragraph"]); // the trailing-node plugin adds the second one
    expect(json[0].attrs).toEqual({ kind: "note" });
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.node(1).type.name).toBe("callout");
    editor.state.doc.check();
  });

  it("Backspace in an empty callout turns it back into a paragraph", () => {
    const editor = load("> [!NOTE]");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    editor.commands.keyboardShortcut("Backspace");
    expect(topTypes(editor)).toEqual(["paragraph", "paragraph"]); // the second is the trailing node
    expect(editor.state.selection.$from.depth).toBe(1);
  });
});
