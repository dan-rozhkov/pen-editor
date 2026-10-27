import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";
import { joinImageWidth, splitImageWidth } from "../docImage";

/** Drags the right resize handle by `dx`; `beforeRelease` runs between the move and the release. */
function drag(e: Editor, dx: number, beforeRelease?: () => void) {
  // happy-dom lays nothing out; give the image a measurable width so the drag has a size to commit.
  const img = e.view.dom.querySelector("img")!;
  Object.defineProperty(img, "offsetWidth", { configurable: true, get: () => parseInt(img.style.width || "200", 10) });
  const handle = e.view.dom.querySelector("[data-resize-handle='right']");
  expect(handle).not.toBeNull();
  handle!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: dx, clientY: 0 }));
  beforeRelease?.();
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: dx, clientY: 0 }));
}

function roundTrip(markdown: string) {
  const first = load(markdown);
  const attrs = { ...imageAttrs(first) };
  const out = first.getMarkdown().trim();
  const second = new Editor({ extensions: DOC_EXTENSIONS, content: out, contentType: "markdown" });
  const again = { ...second.state.doc.firstChild!.attrs };
  second.destroy();
  return { attrs, out, again };
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function load(markdown: string): Editor {
  editor = new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
  return editor;
}

function imageAttrs(e: Editor) {
  const image = e.state.doc.firstChild!;
  expect(image.type.name).toBe("image");
  return image.attrs;
}

describe("doc image markdown", () => {
  it.each([
    ["width", "![a](https://x.test/y.png#width=480)", { src: "https://x.test/y.png", alt: "a", width: 480 }],
    ["width after a fragment", "![a](https://x.test/y.png#frag&width=300)", { src: "https://x.test/y.png#frag", width: 300 }],
    ["no width", "![a](https://x.test/y.png)", { src: "https://x.test/y.png", width: null }],
    ["title and width", '![a](https://x.test/y.png#width=120 "T")', { src: "https://x.test/y.png", title: "T", width: 120 }],
    ["a non-numeric width", "![a](https://x.test/y.png#width=abc)", { src: "https://x.test/y.png#width=abc", width: null }],
    ["a query-string width", "![a](https://cdn.test/p.jpg?auto=format&width=480)", { src: "https://cdn.test/p.jpg?auto=format&width=480", width: null }],
    ["a zero width", "![a](https://x.test/y.png#width=0)", { src: "https://x.test/y.png#width=0", width: null }],
  ])("round trips %s", (_name, markdown, attrs) => {
    const e = load(markdown);
    expect(imageAttrs(e)).toMatchObject(attrs);
    expect(() => e.state.doc.check()).not.toThrow();
    const once = e.getMarkdown().trim();
    expect(once).toBe(markdown);
    // parse twice: the serialized form loads to the same document.
    const again = new Editor({ extensions: DOC_EXTENSIONS, content: once, contentType: "markdown" });
    expect(again.getMarkdown().trim()).toBe(once);
    expect(again.state.doc.firstChild!.toJSON()).toEqual(e.state.doc.firstChild!.toJSON());
    again.destroy();
  });

  it("serializes a width set through updateAttributes", () => {
    const e = load("![a](https://x.test/y.png)");
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 0)));
    e.commands.updateAttributes("image", { width: 333 });
    expect(imageAttrs(e)).toMatchObject({ width: 333, height: null });
    expect(e.getMarkdown().trim()).toBe("![a](https://x.test/y.png#width=333)");
    expect(e.getHTML()).toContain("width: 333px");
    expect(e.getHTML()).not.toContain("height");
  });

  it("commits a drag as width only, never height", () => {
    const e = load("![a](https://x.test/y.png)");
    drag(e, 40);
    expect(imageAttrs(e).width).toEqual(expect.any(Number));
    expect(imageAttrs(e).height).toBeNull();
    expect(e.getMarkdown().trim()).toMatch(/^!\[a\]\(https:\/\/x\.test\/y\.png#width=\d+\)$/);
    expect(e.getHTML()).not.toContain("height");
  });

  it.each([
    ["https://x.test/y.png#width=480", "https://x.test/y.png", 480],
    ["https://x.test/y.png#a&width=5", "https://x.test/y.png#a", 5],
    ["https://x.test/y.png#width=-4", "https://x.test/y.png#width=-4", null],
    ["https://x.test/y.png", "https://x.test/y.png", null],
  ])("splits %s", (href, src, width) => {
    expect(splitImageWidth(href)).toEqual({ src, width });
  });

  it.each([
    ["https://x.test/y.png", 480, "https://x.test/y.png#width=480"],
    ["https://x.test/y.png#a", 480, "https://x.test/y.png#a&width=480"],
    ["https://x.test/y.png", null, "https://x.test/y.png"],
  ])("joins %s with %s", (src, width, out) => {
    expect(joinImageWidth(src, width)).toBe(out);
  });

  it.each([
    ["https://cdn.test/p.jpg?auto=format&width=480", "https://cdn.test/p.jpg?auto=format&width=480", null],
    ["https://x.test/y.png#a?b&width=7", "https://x.test/y.png#a?b", 7],
    ["https://x.test/y.png#width=3&width=5", "https://x.test/y.png", 5],
  ])("splits %s respecting the fragment", (href, src, width) => {
    expect(splitImageWidth(href)).toEqual({ src, width });
  });

  it("replaces an existing marker when joining", () => {
    expect(joinImageWidth("https://x.test/y.png#width=300", 500)).toBe("https://x.test/y.png#width=500");
  });

  it.each([
    ["a percentage attribute", '<img src="https://x.test/y.png" width="100%">', null],
    ["an em style", '<img src="https://x.test/y.png" style="width: 20em">', null],
    ["a px attribute", '<img src="https://x.test/y.png" width="120px">', 120],
    ["a plain attribute", '<img src="https://x.test/y.png" width="64">', 64],
    ["a px style", '<img src="https://x.test/y.png" style="width: 90px">', 90],
    ["a marker in src", '<img src="https://x.test/y.png#width=210">', 210],
  ])("reads width from HTML with %s", (_name, html, width) => {
    editor = new Editor({ extensions: DOC_EXTENSIONS, content: html });
    expect(imageAttrs(editor).width).toBe(width);
    expect(imageAttrs(editor).src).toBe("https://x.test/y.png");
  });

  it.each([
    ["alt with brackets", "![a\\]b \\[c](https://x.test/y.png)", { alt: "a]b [c" }],
    ["title with quotes", '![a](https://x.test/y.png "say \\"hi\\"")', { title: 'say "hi"' }],
    ["unbalanced paren url", "![a](<https://x.test/y(1.png>)", { src: "https://x.test/y(1.png" }],
    ["unbalanced paren url with width", "![a](<https://x.test/y).png#width=200>)", { src: "https://x.test/y).png", width: 200 }],
  ])("round trips %s", (_name, markdown, expected) => {
    const { attrs, again } = roundTrip(markdown);
    expect(attrs).toMatchObject(expected);
    expect(again).toEqual(attrs);
  });

  it("keeps the width marker out of src for setImage and resizes to exactly one marker", () => {
    editor = new Editor({ extensions: DOC_EXTENSIONS, content: "", contentType: "markdown" });
    editor.commands.setImage({ src: "https://x.test/y.png#width=300" });
    const image = editor.state.doc.firstChild!;
    expect(image.attrs).toMatchObject({ src: "https://x.test/y.png", width: 300 });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    editor.commands.updateAttributes("image", { width: 450 });
    expect(editor.getMarkdown().trim()).toBe("![](https://x.test/y.png#width=450)");
  });

  it("does not commit a resize while the editor is read-only", () => {
    const e = load("![a](https://x.test/y.png)");
    drag(e, 40, () => e.setEditable(false));
    expect(imageAttrs(e).width).toBeNull();
  });

  it.each([
    ["a backslash in alt", "![C:\\\\img](https://x.test/y.png)", "C:\\img"],
    ["a backslash before a bracket", "![a \\\\\\] b](https://x.test/y.png)", "a \\] b"],
  ])("keeps %s byte-stable over three load/save cycles", (_name, markdown, alt) => {
    let current = markdown;
    for (let i = 0; i < 3; i += 1) {
      const e = new Editor({ extensions: DOC_EXTENSIONS, content: current, contentType: "markdown" });
      expect(e.state.doc.firstChild!.attrs.alt).toBe(alt);
      current = e.getMarkdown().trim();
      e.destroy();
    }
    expect(current).toBe(markdown);
  });

  it("keeps a backslash in the title byte-stable", () => {
    const markdown = '![a](https://x.test/y.png "t\\\\u")';
    let current = markdown;
    for (let i = 0; i < 3; i += 1) {
      const e = new Editor({ extensions: DOC_EXTENSIONS, content: current, contentType: "markdown" });
      expect(e.state.doc.firstChild!.attrs.title).toBe("t\\u");
      current = e.getMarkdown().trim();
      e.destroy();
    }
    expect(current).toBe(markdown);
  });

  it("clears the inline height a drag pinned even when the width ends up unchanged", () => {
    const e = load("![a](https://x.test/y.png#width=200)");
    const img = e.view.dom.querySelector("img")!;
    drag(e, 0, () => {
      img.style.height = "123px";
    });
    expect(img.style.height).toBe("");
    expect(img.style.width).toBe("200px");
  });

  it("shows the block when the image has no src", () => {
    const e = load("![alt]()");
    const block = e.view.dom.querySelector("img")!.parentElement!.closest("[data-node-view-wrapper], div") as HTMLElement;
    expect(e.view.dom.querySelector("img")).not.toBeNull();
    expect(block.style.visibility).not.toBe("hidden");
    e.commands.setContent({ type: "doc", content: [{ type: "image", attrs: { src: null } }] });
    const again = e.view.dom.querySelector("img")!.closest("div") as HTMLElement;
    expect(again.style.visibility).not.toBe("hidden");
    expect(again.style.pointerEvents).not.toBe("none");
  });

  describe("open button", () => {
    const button = (e: Editor) => e.view.dom.querySelector<HTMLButtonElement>("button.doc-image-open");

    it("renders a labelled button inside the resize wrapper", () => {
      const e = load("![a](https://x.test/y.png)");
      const b = button(e)!;
      expect(b).not.toBeNull();
      expect(b.getAttribute("aria-label")).toBe("Open image in new tab");
      expect(b.parentElement!.hasAttribute("data-resize-wrapper")).toBe(true);
      expect(b.hidden).toBe(false);
    });

    it("labels a data: image as a download", () => {
      const b = button(load("![a](data:image/png;base64,AAAA)"))!;
      expect(b.getAttribute("aria-label")).toBe("Download image");
      expect(b.hidden).toBe(false);
    });

    it("leaves image mutations outside the button to ProseMirror's leaf default", () => {
      const e = load("![a](https://x.test/y.png)");
      const desc = (e.view as unknown as { docView: { children: { ignoreMutation(m: unknown): boolean }[] } }).docView
        .children[0];
      const img = e.view.dom.querySelector("img")!;
      expect(desc.ignoreMutation({ type: "attributes", target: img })).toBe(true);
      expect(desc.ignoreMutation({ type: "selection", target: img })).toBe(false);
      expect(desc.ignoreMutation({ type: "attributes", target: button(e)! })).toBe(true);
    });

    it("hides the button when the image has no src", () => {
      const e = load("![a]()");
      expect(button(e)!.hidden).toBe(true);
    });

    it("opens the current src in a new tab on click", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const e = load("![a](https://x.test/y.png)");
      const b = button(e);
      e.chain().setNodeSelection(0).updateAttributes("image", { src: "https://x.test/z.png" }).run();
      // The same node view took the update (not a rebuilt one), so it read the new src.
      expect(button(e)).toBe(b);
      button(e)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(open).toHaveBeenCalledWith("https://x.test/z.png", "_blank", "noopener,noreferrer");
      open.mockRestore();
    });

    it("does not select the node on mousedown", () => {
      const e = load("![a](https://x.test/y.png)\n\ntext");
      e.commands.setTextSelection(e.state.doc.content.size - 1);
      expect(e.state.selection instanceof NodeSelection).toBe(false);
      const before = e.state.selection;
      button(e)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      expect(e.state.selection instanceof NodeSelection).toBe(false);
      expect(e.state.selection.eq(before)).toBe(true);
    });
  });
});
