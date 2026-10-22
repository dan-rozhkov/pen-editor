import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { peekOpenAdd } from "../docGallery";
import { destroyLoaded, load, parseTwice, topTypes } from "@/components/doc/ui/__tests__/editorFixture";

afterEach(destroyLoaded);

const TWO = "> [!GALLERY]\n> ![First](https://x.test/1.png)\n> ![Second](https://x.test/2.png)";

describe("gallery round trip", () => {
  it.each([
    ["two images", TWO],
    ["an empty gallery", "> [!GALLERY]"],
    ["text around it", `Before\n\n${TWO}\n\nAfter`],
    ["a src with spaces and parens", "> [!GALLERY]\n> ![A b](<https://x.test/a b (1).png>)"],
    ["an image title", '> [!GALLERY]\n> ![A](https://x.test/1.png "A \\"quoted\\" title")'],
    ["an escaped alt", "> [!GALLERY]\n> ![a \\[x\\]](https://x.test/1.png)"],
  ])("keeps %s byte for byte", (_name, markdown) => {
    expect(parseTwice(markdown)).toBe(markdown);
    expect(topTypes(load(markdown))).toContain("imageGallery");
  });

  it("reads the images into the attribute", () => {
    const node = load(TWO).getJSON().content?.[0];
    expect(node?.type).toBe("imageGallery");
    expect(node?.attrs?.images).toEqual([
      { src: "https://x.test/1.png", alt: "First" },
      { src: "https://x.test/2.png", alt: "Second" },
    ]);
  });

  it("accepts a bare url with balanced parens and saves it in angle brackets", () => {
    const markdown = "> [!GALLERY]\n> ![W](https://en.wikipedia.org/wiki/File:X_(1).jpg)";
    expect(topTypes(load(markdown))).toContain("imageGallery");
    expect(parseTwice(markdown)).toBe("> [!GALLERY]\n> ![W](<https://en.wikipedia.org/wiki/File:X_(1).jpg>)");
  });

  it("keeps parens in the src and the title in the attribute", () => {
    const images = load('> [!GALLERY]\n> ![W](https://en.wikipedia.org/wiki/File:X_(1).jpg "Cap")').getJSON().content?.[0].attrs?.images;
    expect(images).toEqual([{ src: "https://en.wikipedia.org/wiki/File:X_(1).jpg", alt: "W", title: "Cap" }]);
  });

  it("keeps the src verbatim, including a width fragment", () => {
    const markdown = "> [!GALLERY]\n> ![](https://x.test/1.png#width=200)";
    expect(parseTwice(markdown)).toBe(markdown);
  });

  it("ignores blank quote lines and normalizes a lower-case marker", () => {
    expect(parseTwice("> [!gallery]\n>\n> ![A](https://x.test/1.png)\n>\n> ![B](https://x.test/2.png)")).toBe(
      "> [!GALLERY]\n> ![A](https://x.test/1.png)\n> ![B](https://x.test/2.png)",
    );
  });
});

describe("gallery fallbacks", () => {
  it.each([
    ["a text line", "> [!GALLERY]\n> ![A](https://x.test/1.png)\n> caption"],
    ["two images on a line", "> [!GALLERY]\n> ![A](https://x.test/1.png) ![B](https://x.test/2.png)"],
  ])("a quote with %s stays a blockquote", (_name, markdown) => {
    const editor = load(markdown);
    expect(topTypes(editor)).toEqual(["blockquote"]);
  });

  it("lives next to a note callout", () => {
    const markdown = `${TWO}\n\n> [!NOTE]\n> Body`;
    expect(parseTwice(markdown)).toBe(markdown);
    expect(topTypes(load(markdown))).toEqual(["imageGallery", "callout"]);
  });
});

describe("insertGallery placement", () => {
  it("selects an imageGallery when the cursor is in an empty bullet", () => {
    const editor = load("- ");
    editor.commands.setTextSelection(editor.state.doc.resolve(3).pos);
    editor.commands.insertGallery(true);
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe("imageGallery");
    editor.state.doc.check();
    expect(peekOpenAdd(editor, selection.from)).toBe(true);
  });

  it("replaces an empty top-level paragraph", () => {
    const editor = load("Intro");
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertGallery();
    // The editor keeps a trailing paragraph after a final atom; the empty one was replaced, not kept before it.
    expect(topTypes(editor).slice(0, 2)).toEqual(["paragraph", "imageGallery"]);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("imageGallery");
  });

  it("drops the open request when the selection moves away", () => {
    const editor = load("Intro");
    editor.commands.insertGallery(true);
    const pos = editor.state.selection.from;
    expect(peekOpenAdd(editor, pos)).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(peekOpenAdd(editor, pos)).toBe(false);
    // A later gallery, selected by hand, does not inherit the request.
    editor.commands.insertGallery(false);
    expect(peekOpenAdd(editor, editor.state.selection.from)).toBe(false);
  });

  it("follows the node while text is typed before it", () => {
    const editor = load("Intro");
    editor.commands.insertGallery(true);
    const pos = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.insertText("xx", 1));
    expect(peekOpenAdd(editor, pos)).toBe(false);
    expect(peekOpenAdd(editor, pos + 2)).toBe(true);
  });
});
