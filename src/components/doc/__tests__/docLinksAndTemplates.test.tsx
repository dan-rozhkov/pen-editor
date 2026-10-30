import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyLoaded, load, parseTwice } from "@/components/doc/ui/__tests__/editorFixture";
import { DocLinkClick } from "@/components/doc/extensions/docLinkClick";
import { SLASH_ITEMS, filterSlashItems, slashItemsAt } from "@/components/doc/slash/slashItems";
import { TEMPLATE_INSERTED_EVENT, insertTemplate, templateSlashItems } from "@/components/doc/templateInsert";
import { insertDocLink, linkableDocs } from "@/components/doc/docLinkPicker";
import { Editor } from "@tiptap/core";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";
import type { DocTemplate } from "@/lib/docs/docTemplates";

afterEach(destroyLoaded);

describe("doc and frame links", () => {
  it.each([
    ["a document link", "[Spec](/doc?id=doc_abc123)"],
    ["a document link keeping another param", "[Spec](/doc?id=doc_abc123&chat=off)"],
    ["a frame link", "[Login screen](/app?node=n_42)"],
    ["the document placeholder", "[Title](/doc?id=DOC_ID)"],
    ["the frame placeholder", "[Name](/app?node=NODE_ID)"],
  ])("keeps %s through a round trip", (_name, markdown) => {
    expect(parseTwice(markdown)).toBe(markdown);
    const link = load(markdown).getJSON().content?.[0].content?.[0].marks?.[0];
    expect(link?.type).toBe("link");
    expect(markdown).toContain(`](${link?.attrs?.href})`);
  });
});

describe("internal link chips", () => {
  const anchors = (markdown: string) => Array.from(load(markdown).view.dom.querySelectorAll("a"));

  it.each([
    ["/doc?id=doc_abc", "doc"],
    ["/app?node=n_42", "node"],
    ["/app?tab=3", "canvasTab"],
    ["/trace/1b4e28ba?src=local", "trace"],
  ])("renders %s with class and kind %s", (href, kind) => {
    const [a] = anchors(`[x](${href})`);
    expect(a.classList.contains("internal-link")).toBe(true);
    expect(a.getAttribute("data-link-kind")).toBe(kind);
  });

  it("marks neither class nor kind on an external link", () => {
    const [a] = anchors("[x](https://example.com)");
    expect(a.classList.contains("internal-link")).toBe(false);
    expect(a.hasAttribute("data-link-kind")).toBe(false);
  });

  it("marks links inside a property value", () => {
    const md = "|  |  |\n| --- | --- |\n| Trace | [run](/trace/abc?src=local) |\n| Link | [site](https://example.com) |";
    // Property rows render through node views, so read the schema's own HTML output.
    const host = document.createElement("div");
    host.innerHTML = load(md).getHTML();
    const [trace, site] = Array.from(host.querySelectorAll("a"));
    expect(trace.getAttribute("data-link-kind")).toBe("trace");
    expect(site.hasAttribute("data-link-kind")).toBe(false);
  });

  it("keeps the markup out of the markdown", () => {
    const md = "[Spec](/doc?id=doc_abc) and [site](https://example.com)";
    const out = load(md).getMarkdown();
    expect(out).toBe(md);
    expect(out).not.toContain("internal-link");
    expect(out).not.toContain("data-link-kind");
  });
});

describe("insertDocLink", () => {
  it("leaves the caret outside the link so typed text stays plain", () => {
    const editor = load("Hi");
    editor.commands.focus("end");
    insertDocLink(editor, { id: "doc_abc123", title: "Spec", updatedAt: 1 });
    editor.commands.insertContent("more");
    expect(editor.getMarkdown()).toBe("Hi[Spec](/doc?id=doc_abc123) more");
  });
});

describe("DocLinkClick", () => {
  function click(markdown: string, actions: { openDoc: (id: string) => void; focusNode: (id: string) => void }) {
    const editor = new Editor({
      extensions: [...DOC_EXTENSIONS, DocLinkClick.configure({ getActions: () => actions })],
      content: markdown,
      contentType: "markdown",
      element: document.body.appendChild(document.createElement("div")),
    });
    const anchor = editor.view.dom.querySelector("a")!;
    // ProseMirror calls handleClick from its mouseup bookkeeping; call the prop directly.
    const event = new MouseEvent("click", { bubbles: true, button: 0 });
    Object.defineProperty(event, "target", { value: anchor });
    editor.view.someProp("handleClick", (handle) => handle(editor.view, 1, event));
    editor.destroy();
  }

  it.each([
    ["[A](/doc?id=d1)", "openDoc", "d1"],
    ["[A](/app?node=n1)", "focusNode", "n1"],
  ] as const)("a plain click on %s calls %s", (markdown, method, id) => {
    const actions = { openDoc: vi.fn(), focusNode: vi.fn() };
    click(markdown, actions);
    expect(actions[method]).toHaveBeenCalledWith(id);
  });
});

const TEMPLATE_BODY = [
  "> [!IMPORTANT]",
  "> Fill every [TBD: field] before sharing.",
  "",
  "|  |  |",
  "| --- | --- |",
  "| Status | [TBD: status] |",
  "| Spec | [Title](/doc?id=DOC_ID) |",
  "",
  "## Flow",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Start] --> B[End]",
  "```",
  "",
  "- [ ] [TBD: first step]",
  "",
  "See [Name](/app?node=NODE_ID).",
].join("\n");

const TEMPLATE: DocTemplate = {
  id: "bug-report",
  skill: "bug-report",
  label: "Bug report",
  title: "Bug report: [Area] [Summary]",
  description: "Report a bug",
  markdown: `${TEMPLATE_BODY}\n`,
};

describe("template body", () => {
  it("round-trips callout, properties, mermaid, task list, placeholders and links", () => {
    const once = parseTwice(TEMPLATE_BODY);
    expect(once).toContain("> [!IMPORTANT]");
    expect(once).toContain("```mermaid");
    expect(once).toContain("\\[TBD: status\\]"); // escaped by the serializer, stable on re-parse
    expect(once).toContain("(/doc?id=DOC_ID)");
    expect(once).toContain("(/app?node=NODE_ID)");
    expect(once).toContain("- [ ] \\[TBD: first step\\]");
  });

  it("is inserted at the cursor as parsed nodes and reports its title", () => {
    const editor = load("Before");
    editor.commands.focus("end");
    const onInserted = vi.fn();
    editor.view.dom.addEventListener(TEMPLATE_INSERTED_EVENT, (event) => onInserted((event as CustomEvent).detail));
    insertTemplate(editor, editor.chain().focus(), TEMPLATE);
    const types = (editor.getJSON().content ?? []).map((node) => node.type);
    expect(types).toContain("callout");
    expect(types).toContain("codeBlock");
    expect(editor.getMarkdown()).toContain("Before");
    expect(onInserted).toHaveBeenCalledWith({ title: TEMPLATE.title });
  });
});

describe("template slash items", () => {
  const items = templateSlashItems([TEMPLATE]);

  it("form a Templates group found by 'template' and by the label words", () => {
    expect(items.map((item) => item.group)).toEqual(["Templates"]);
    expect(filterSlashItems("template", items)).toHaveLength(1);
    expect(filterSlashItems("bug", items)).toHaveLength(1);
  });

  it("sit after every built-in match, in one contiguous group, even when they score better", () => {
    const tpl = (id: string, title: string) => ({ ...items[0], id, title, keywords: [], group: "Templates" });
    const mixed = [tpl("t1", "Zebra table"), tpl("t2", "Table plan"), ...SLASH_ITEMS];
    const result = filterSlashItems("table", mixed);
    const firstTemplate = result.findIndex((item) => item.group);
    expect(result.slice(0, firstTemplate).every((item) => !item.group)).toBe(true);
    expect(result.slice(firstTemplate).map((item) => item.id)).toEqual(["t2", "t1"]);
    expect(result.slice(0, firstTemplate).length).toBeGreaterThan(0);
  });

  it("are not offered inside a table cell", () => {
    const editor = load("| A | B |\n| --- | --- |\n| 1 | 2 |");
    let cellPos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && !cellPos) cellPos = pos + 2;
    });
    const all = [...SLASH_ITEMS, ...items];
    expect(slashItemsAt(editor.state.doc.resolve(cellPos), all).map((i) => i.id)).not.toContain("template-bug-report");
    expect(slashItemsAt(editor.state.doc.resolve(0), all).map((i) => i.id)).toContain("template-bug-report");
  });

  it("are empty before the backend answered", () => {
    expect(templateSlashItems(null)).toEqual([]);
  });

  it("includes Link to document", () => {
    expect(filterSlashItems("mention").map((item) => item.id)).toContain("link-to-document");
  });
});

describe("linkableDocs", () => {
  const docs = [
    { id: "a", title: "Alpha", updatedAt: 1 },
    { id: "b", title: "Beta", updatedAt: 3 },
    { id: "c", title: "alphabet", updatedAt: 2 },
  ];
  it.each([
    ["sorts newest first and drops the open document", "b", "", ["c", "a"]],
    ["filters by title, ignoring case", null, "ALPHA", ["c", "a"]],
    ["finds nothing", null, "zzz", []],
  ])("%s", (_name, current, query, expected) => {
    expect(linkableDocs(docs, current, query).map((doc) => doc.id)).toEqual(expected);
  });
});
