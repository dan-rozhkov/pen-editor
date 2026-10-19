import { Editor, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { DocDetails } from "@/components/doc/extensions/docDetails";
import { DOC_EXTENSIONS, getActiveDocColor } from "@/components/doc/docExtensions";

function makeEditor(markdown: string): Editor {
  return new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
}

function roundTrip(markdown: string): string {
  const editor = makeEditor(markdown);
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}

/** Parse twice: load -> getMarkdown -> load again -> getMarkdown must agree, and both docs must satisfy the schema. */
function parseTwice(markdown: string): string {
  const first = makeEditor(markdown);
  first.state.doc.check();
  const once = first.getMarkdown();
  first.destroy();
  const second = makeEditor(once);
  second.state.doc.check();
  const twice = second.getMarkdown();
  second.destroy();
  expect(twice).toBe(once);
  return once;
}

const TOGGLE = "<details>\n<summary>Title</summary>\n\nBody text\n\n</details>";
const OPEN_TOGGLE = "<details open>\n<summary>Open **one**</summary>\n\nBody\n\n</details>";
const NESTED = "<details>\n<summary>Outer</summary>\n\nBefore\n\n<details>\n<summary>Inner</summary>\n\nDeep\n\n</details>\n\nAfter\n\n</details>";
const RICH = "<details>\n<summary>Rich</summary>\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\n</details>";

describe("toggle round trip", () => {
  it.each([
    ["a closed toggle", TOGGLE],
    ["an open toggle with inline markdown in the summary", OPEN_TOGGLE],
    ["a nested toggle", NESTED],
    ["a body with a list and a code block", RICH],
  ])("keeps %s byte for byte", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
    expect(parseTwice(markdown)).toBe(markdown);
  });

  it("keeps the body inside the toggle across blank lines", () => {
    const editor = makeEditor("<details>\n<summary>T</summary>\n\nOne\n\nTwo\n\n</details>\n\nOutside");
    const doc: JSONContent[] = editor.getJSON().content ?? [];
    editor.destroy();
    expect(doc.map((n) => n.type)).toEqual(["details", "paragraph"]);
    expect(doc[0].content?.[1].content).toHaveLength(2);
  });

  it("stores the open state as an attribute", () => {
    const editor = makeEditor(OPEN_TOGGLE);
    const attrs = editor.getJSON().content?.[0].attrs;
    editor.destroy();
    expect(attrs).toEqual({ open: true });
  });

  it("exposes setDetails and unsetDetails", () => {
    const editor = makeEditor("plain");
    editor.commands.setDetails();
    const wrapped = editor.getMarkdown();
    editor.destroy();
    expect(wrapped).toContain("<details>");
    expect(wrapped).toContain("plain");
  });
});

describe("colour mark round trip", () => {
  it.each([
    ["text colour", '<span data-color="red">hot</span>'],
    ["background colour", '<span data-bg="yellow">marked</span>'],
    ["both on one span", '<span data-color="blue" data-bg="gray">both</span>'],
    ["bold inside", '<span data-color="red">**bold**</span>'],
    ["inside a sentence", 'before <span data-color="green">mid</span> after'],
  ])("keeps %s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
    expect(parseTwice(markdown)).toBe(markdown);
  });

  it("parses the inner bold into the mark", () => {
    const editor = makeEditor('<span data-color="red">**bold**</span>');
    const text = editor.getJSON().content?.[0].content?.[0];
    editor.destroy();
    expect(text?.marks?.map((m) => m.type).sort()).toEqual(["bold", "docColor"]);
  });

  it("drops an unknown colour name and keeps the text", () => {
    expect(roundTrip('<span data-color="chartreuse">plain</span>')).toBe("plain");
  });

  it("keeps the valid half when the other name is unknown", () => {
    expect(roundTrip('<span data-color="chartreuse" data-bg="pink">x</span>')).toBe('<span data-bg="pink">x</span>');
  });
});

describe("colour commands", () => {
  function select(markdown: string): Editor {
    const editor = makeEditor(markdown);
    editor.commands.selectAll();
    return editor;
  }

  it("sets, merges, and removes the two halves independently", () => {
    const editor = select("word");
    editor.chain().setDocColor({ color: "red" }).run();
    editor.chain().setDocColor({ background: "yellow" }).run();
    expect(getActiveDocColor(editor)).toEqual({ color: "red", background: "yellow" });
    expect(editor.getMarkdown()).toBe('<span data-color="red" data-bg="yellow">word</span>');
    editor.chain().setDocColor({ color: null }).run();
    expect(getActiveDocColor(editor)).toEqual({ background: "yellow" });
    editor.chain().setDocColor({ background: null }).run();
    expect(editor.getMarkdown()).toBe("word");
    editor.destroy();
  });

  it("unsetDocColor removes the mark", () => {
    const editor = select('<span data-color="red" data-bg="gray">word</span>');
    editor.chain().unsetDocColor().run();
    expect(editor.getMarkdown()).toBe("word");
    editor.destroy();
  });
});

describe("code blocks", () => {
  it.each([
    ["a mermaid fence", "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```"],
    ["a js fence", "```js\nconst a = 1;\n```"],
    ["a fence without a language", "```\nplain\n```"],
  ])("keeps %s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("insertMermaid adds a mermaid block and puts the cursor inside it", () => {
    const editor = makeEditor("intro");
    editor.chain().focus("end").insertContent({ type: "paragraph" }).run();
    editor.commands.insertMermaid();
    const { $from } = editor.state.selection;
    const inside = $from.parent.type.name === "codeBlock" && $from.parent.attrs.language === "mermaid";
    const out = editor.getMarkdown();
    editor.destroy();
    expect(inside).toBe(true);
    expect(out).toContain("```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```");
  });
});

describe("toggle edge cases", () => {
  it("ignores details tags inside fenced code and inline code when balancing", () => {
    const md = "<details>\n<summary>S</summary>\n\n```html\n</details>\n```\n\n</details>\n\nAfter";
    expect(parseTwice(md)).toBe("<details>\n<summary>S</summary>\n\n```html\n</details>\n```\n\n</details>\n\nAfter");
    const tilde = "<details>\n<summary>S</summary>\n\n~~~~\n</details>\n~~~~\n\nUse `</details>` here\n\n</details>\n\nAfter";
    const editor = makeEditor(tilde);
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    editor.destroy();
    expect(types).toEqual(["details", "paragraph"]);
    parseTwice(tilde);
  });

  it("does not turn a mid-line or inline-code mention into a toggle", () => {
    const md = "Wrap it in `<details>` and close with `</details>` please.";
    const editor = makeEditor(md);
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    editor.destroy();
    expect(types).toEqual(["paragraph"]);
    expect(parseTwice(md)).toContain("`<details>`");
    expect(parseTwice("text <details>\n<summary>x</summary>\n\nb\n\n</details>")).toContain("text");
  });

  it("does not treat <detailsfoo> as a toggle", () => {
    const editor = makeEditor("<detailsfoo>\n\nx");
    const types = (editor.getJSON().content ?? []).map((n) => n.type);
    editor.destroy();
    expect(types).not.toContain("details");
  });

  it("keeps a toggle inside a loose list item valid and keeps its text", () => {
    const out = parseTwice("- item\n\n  <details>\n  <summary>S</summary>\n\n  Body here\n\n  </details>");
    expect(out).toContain("<details>");
    expect(out).toContain("Body here");
    expect(out).toContain("</details>");
  });

  // @tiptap/extension-list collects an ordered item's lines itself and treats a tag directly under the first
  // line as paragraph text, so the toggle markup cannot survive there; the doc must stay valid and lose no text.
  it("keeps a tight ordered list item with a toggle valid and drops no text (lossy: tags are not kept)", () => {
    const editor = makeEditor("1. one\n   <details>\n   <summary>S</summary>\n\n   Body here\n\n   </details>\n2. two");
    editor.state.doc.check();
    const out = editor.getMarkdown();
    editor.destroy();
    for (const text of ["one", "S", "Body here", "two"]) expect(out).toContain(text);
  });

  it("keeps a toggle in an ordered list item after a blank line with its tags", () => {
    const out = parseTwice("1. one\n\n   <details>\n   <summary>S</summary>\n\n   Body here\n\n   </details>\n\n2. two");
    expect(out).toContain("Body here");
    expect(out).toContain("two");
  });
});

describe("nested colours", () => {
  it("merges an outer colour with an inner background", () => {
    const md = '<span data-color="red">a <span data-bg="yellow">b</span> c</span>';
    const editor = makeEditor(md);
    const texts: JSONContent[] = editor.getJSON().content?.[0].content ?? [];
    editor.destroy();
    const attrsOf = (t: string) => texts.find((n) => n.text === t)?.marks?.find((m) => m.type === "docColor")?.attrs;
    expect(attrsOf("a ")).toMatchObject({ color: "red", background: null });
    expect(attrsOf("b")).toMatchObject({ color: "red", background: "yellow" });
    expect(attrsOf(" c")).toMatchObject({ color: "red", background: null });
    parseTwice(md);
  });

  it("lets the inner colour win per attribute", () => {
    const editor = makeEditor('<span data-color="red">x<span data-color="blue">y</span></span>');
    const texts: JSONContent[] = editor.getJSON().content?.[0].content ?? [];
    editor.destroy();
    expect(texts.find((n) => n.text === "y")?.marks?.find((m) => m.type === "docColor")?.attrs?.color).toBe("blue");
  });

  it("never puts a colour on code", () => {
    const md = '<span data-color="red">`x`</span> and <span data-color="red">a `y` b</span>';
    const out = parseTwice(md);
    expect(out).toContain("`x`");
    expect(out).toContain("`y`");
  });

  it("parses a toggle whose closing tag follows body text on the same line", () => {
    for (const md of [
      "<details><summary>A</summary>\nbody</details>\n\nAfter",
      "<details><summary>A</summary>x</details>\n\nAfter",
    ]) {
      const editor = makeEditor(md);
      expect(editor.getJSON().content?.map((n) => n.type)).toEqual(["details", "paragraph"]);
      editor.destroy();
      expect(parseTwice(md)).toMatch(/^<details>\n<summary>A<\/summary>\n\n(body|x)\n\n<\/details>\n\nAfter$|^<details>\n<summary>A<\/summary>\n\nx\n\n<\/details>\n\nAfter$/);
    }
  });

  it("start() hints only at lines the tokenizer accepts", () => {
    const start = DocDetails.config.markdownTokenizer?.start as (src: string) => number;
    expect(start("para\n<details\nmore")).toBe(-1);
    expect(start("para\n<details open=\"x\">")).toBe(-1);
    for (const open of ["<details>", "<details open>", '<details open="">', '<details open="open">', "   <details>"]) {
      expect(start(`para\n${open}\nx`)).toBe(5);
    }
  });

  it("keeps a toggle that is the second block of a task item", () => {
    const md = "- [ ] task\n  <details>\n  <summary>T</summary>\n\n  Body\n\n  </details>";
    const out = parseTwice(md);
    expect(out).toContain("<details>");
    const editor = makeEditor(out);
    const types: string[] = [];
    editor.state.doc.descendants((n) => void types.push(n.type.name));
    editor.destroy();
    expect(types).toContain("details");
    expect(types).toContain("taskItem");
  });

  it("round-trips a hard break inside a colour span", () => {
    expect(parseTwice('<span data-color="red">a<br>b</span>')).toBe('<span data-color="red">a</span>  \n<span data-color="red">b</span>');
    parseTwice('<span data-color="red">a  \nb</span>');
  });
});
