import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

function load(markdown: string): Editor {
  return new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
}

function chips(editor: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "docLogin") found.push(node.attrs);
  });
  return found;
}

describe("login chip markdown", () => {
  it("parses a login: link into an atom node", () => {
    const editor = load("Sign in as [@alice · github.com](login:abc-123) first.");
    expect(chips(editor)).toEqual([{ id: "abc-123", username: "alice", host: "github.com" }]);
    // Not a link mark: the node replaces the whole link.
    expect(editor.getJSON().content?.[0].content?.some((n) => n.marks?.some((m) => m.type === "link"))).toBe(false);
    editor.destroy();
  });

  it("serializes back to the same link", () => {
    const markdown = "Use [@alice · github.com](login:abc-123) here.";
    const editor = load(markdown);
    expect(editor.getMarkdown()).toBe(markdown);
    editor.destroy();
  });

  it("round-trips an id and a username that need escaping", () => {
    const editor = load("");
    editor.commands.insertContent({ type: "docLogin", attrs: { id: "a b/ü", username: "we[ir]d\\name", host: "x.test" } });
    const out = editor.getMarkdown();
    editor.destroy();
    const again = load(out);
    expect(chips(again)).toEqual([{ id: "a b/ü", username: "we[ir]d\\name", host: "x.test" }]);
    expect(again.getMarkdown()).toBe(out);
    again.destroy();
  });

  it("round-trips an id with parentheses", () => {
    const editor = load("");
    editor.commands.insertContent({ type: "docLogin", attrs: { id: "a)b(c", username: "u", host: "x.test" } });
    const out = editor.getMarkdown();
    expect(out).toContain("(login:a%29b%28c)");
    editor.destroy();
    const again = load(out);
    expect(chips(again)).toEqual([{ id: "a)b(c", username: "u", host: "x.test" }]);
    again.destroy();
  });

  it("survives inside a table cell with a pipe in the username", () => {
    const editor = load("| A | B |\n| --- | --- |\n| x | y |");
    editor.commands.setTextSelection(editor.state.doc.content.size - 4);
    editor.commands.insertContent({ type: "docLogin", attrs: { id: "p1", username: "a|b", host: "x.test" } });
    const out = editor.getMarkdown();
    editor.destroy();
    const again = load(out);
    expect(chips(again)).toEqual([{ id: "p1", username: "a|b", host: "x.test" }]);
    again.destroy();
  });

  it("round-trips a username holding the separator, with an empty host", () => {
    const editor = load("");
    editor.commands.insertContent({ type: "docLogin", attrs: { id: "s1", username: "a · b", host: "" } });
    const out = editor.getMarkdown();
    expect(out).toContain("[@a \\· b · ](login:s1)");
    editor.destroy();
    const again = load(out);
    expect(chips(again)).toEqual([{ id: "s1", username: "a · b", host: "" }]);
    expect(again.getMarkdown()).toBe(out);
    again.destroy();
  });

  it("turns line breaks in the label into spaces so the chip stays one link", () => {
    const editor = load("");
    editor.commands.insertContent({ type: "docLogin", attrs: { id: "n1", username: "a\r\nb\nc", host: "x.test" } });
    const out = editor.getMarkdown();
    editor.destroy();
    expect(out).not.toMatch(/[\r\n]/);
    const again = load(out);
    expect(chips(again)).toEqual([{ id: "n1", username: "a b c", host: "x.test" }]);
    again.destroy();
  });

  it("keeps ordinary links as links", () => {
    const editor = load("[@mention](https://x.test) and [a](login)");
    expect(chips(editor)).toEqual([]);
    expect(editor.getMarkdown()).toContain("https://x.test");
    editor.destroy();
  });

  it("is selectable as a node and deleted with it", () => {
    const editor = load("[@alice · github.com](login:1)");
    editor.commands.setNodeSelection(1);
    expect(editor.state.selection.empty).toBe(false);
    editor.commands.deleteSelection();
    expect(chips(editor)).toEqual([]);
    editor.destroy();
  });
});
