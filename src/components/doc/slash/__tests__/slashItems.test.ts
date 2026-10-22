import { peekOpenAdd } from "@/components/doc/extensions/docGallery";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor, JSONContent } from "@tiptap/core";
import { filterSlashItems, IMAGE_PROMPT_EVENT, runSlashItem, SLASH_ITEMS } from "../slashItems";
import { makeEditor, topTypes } from "@/components/doc/ui/__tests__/editorFixture";

const titles = (query: string) => filterSlashItems(query).map((item) => item.title);

describe("filterSlashItems", () => {
  it("lists every item for an empty query, in menu order", () => {
    expect(titles("")).toEqual(SLASH_ITEMS.map((item) => item.title));
    expect(titles("")[0]).toBe("Text");
  });

  it.each([
    ["head", ["Heading 1", "Heading 2", "Heading 3"]],
    ["TABLE", ["Table"]],
    ["mer", ["Mermaid diagram"]],
    ["todo", ["To-do list"]],
    ["nothing-matches-this", []],
  ])("filters %s", (query, expected) => {
    expect(titles(query)).toEqual(expected);
  });

  it("ranks a title prefix above a keyword hit", () => {
    expect(titles("list")[0]).toBe("Bulleted list");
    expect(titles("code")[0]).toBe("Code");
  });
});

describe("runSlashItem", () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  /** A document that is just "/<query>" in one paragraph; the typed range is 1..end. */
  function run(id: string, query = "x") {
    editor = makeEditor(`/${query}`);
    const item = SLASH_ITEMS.find((candidate) => candidate.id === id)!;
    runSlashItem(editor, { from: 1, to: 2 + query.length }, item);
  }

  it.each([
    ["h1", "heading"],
    ["bullet", "bulletList"],
    ["ordered", "orderedList"],
    ["todo", "taskList"],
    ["toggle", "details"],
    ["quote", "blockquote"],
    ["code", "codeBlock"],
    ["table", "table"],
    ["text", "paragraph"],
  ])("%s removes the typed text and creates a %s", (id, type) => {
    run(id);
    expect(topTypes(editor)).toContain(type);
    expect(editor.getText()).not.toContain("/x");
  });

  it("heading items set their level", () => {
    run("h3");
    expect(editor.getJSON().content?.[0].attrs?.level).toBe(3);
  });

  it("divider inserts a horizontal rule", () => {
    run("divider");
    expect(topTypes(editor)).toContain("horizontalRule");
  });

  it("table is 3 x 3 with a header row", () => {
    run("table");
    const blocks: JSONContent[] = editor.getJSON().content ?? [];
    const table = blocks.find((node) => node.type === "table");
    expect(table?.content).toHaveLength(3);
    expect(table?.content?.[0].content?.map((cell: JSONContent) => cell.type)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
  });

  it("mermaid inserts a mermaid code block", () => {
    run("mermaid");
    expect(editor.getJSON().content?.some((node) => node.type === "codeBlock" && node.attrs?.language === "mermaid")).toBe(true);
  });

  it("image removes the typed text and asks for a URL through an event", () => {
    editor = makeEditor("/x");
    let asked = 0;
    editor.view.dom.addEventListener(IMAGE_PROMPT_EVENT, () => (asked += 1));
    runSlashItem(editor, { from: 1, to: 3 }, SLASH_ITEMS.find((item) => item.id === "image")!);
    expect(asked).toBe(1);
    expect(editor.getText()).not.toContain("/x");
  });

  it("gallery inserts a selected empty gallery and asks its view to open the URL field", () => {
    run("gallery");
    expect(topTypes(editor)).toContain("imageGallery");
    expect(peekOpenAdd(editor, editor.state.selection.from)).toBe(true);
  });
});
