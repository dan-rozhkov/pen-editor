import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { toast } from "sonner";
import { createDoc } from "@/lib/docs/docStore";
import { SimpleMarkdown } from "../SimpleMarkdown";

vi.mock("sonner", () => ({ toast: vi.fn() }));

afterEach(() => cleanup());

describe("<SimpleMarkdown />", () => {
  it("renders plain text as a paragraph", () => {
    const { container } = render(<SimpleMarkdown content="hello world" />);
    const p = container.querySelector("p");
    expect(p).toBeTruthy();
    expect(p?.textContent).toBe("hello world");
  });

  it("renders nothing meaningful for an empty string", () => {
    const { container } = render(<SimpleMarkdown content="" />);
    // No headings, paragraphs, lists, code, etc.
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  describe("headings", () => {
    it("renders # as <h1>", () => {
      const { container } = render(<SimpleMarkdown content="# Title" />);
      const h1 = container.querySelector("h1");
      expect(h1).toBeTruthy();
      expect(h1?.textContent).toBe("Title");
    });

    it("renders ## as <h2> and ### as <h3>", () => {
      const { container } = render(
        <SimpleMarkdown content={"## Sub\n### Deeper"} />
      );
      expect(container.querySelector("h2")?.textContent).toBe("Sub");
      expect(container.querySelector("h3")?.textContent).toBe("Deeper");
    });

    it("renders levels 4-6 as <h4>/<h5>/<h6>", () => {
      const { container } = render(
        <SimpleMarkdown content={"#### Four\n##### Five\n###### Six"} />
      );
      expect(container.querySelector("h4")?.textContent).toBe("Four");
      expect(container.querySelector("h5")?.textContent).toBe("Five");
      expect(container.querySelector("h6")?.textContent).toBe("Six");
    });

    it("applies inline formatting inside headings", () => {
      const { container } = render(<SimpleMarkdown content="# Hello **bold**" />);
      const h1 = container.querySelector("h1");
      expect(h1?.querySelector("strong")?.textContent).toBe("bold");
    });
  });

  describe("inline formatting", () => {
    it("renders **bold** as <strong>", () => {
      const { container } = render(
        <SimpleMarkdown content="this is **strong** text" />
      );
      const strong = container.querySelector("strong");
      expect(strong).toBeTruthy();
      expect(strong?.textContent).toBe("strong");
      // surrounding text is preserved
      expect(container.querySelector("p")?.textContent).toBe(
        "this is strong text"
      );
    });

    it("renders `inline code` as <code>", () => {
      const { container } = render(
        <SimpleMarkdown content="run `npm test` now" />
      );
      const code = container.querySelector("p code");
      expect(code).toBeTruthy();
      expect(code?.textContent).toBe("npm test");
    });

    it("renders both bold and inline code in the same line", () => {
      const { container } = render(
        <SimpleMarkdown content="**bold** and `code`" />
      );
      expect(container.querySelector("strong")?.textContent).toBe("bold");
      expect(container.querySelector("code")?.textContent).toBe("code");
    });

    it("does NOT render *italic* (single-asterisk) emphasis", () => {
      const { container } = render(
        <SimpleMarkdown content="this is *not italic*" />
      );
      expect(container.querySelector("em")).toBeNull();
      // The asterisks are left as literal text.
      expect(container.querySelector("p")?.textContent).toBe(
        "this is *not italic*"
      );
    });
  });

  describe("code blocks", () => {
    it("renders a fenced code block as <pre><code>", () => {
      const { container } = render(
        <SimpleMarkdown content={"```\nconst x = 1;\n```"} />
      );
      const pre = container.querySelector("pre");
      expect(pre).toBeTruthy();
      const code = pre?.querySelector("code");
      expect(code?.textContent).toBe("const x = 1;");
    });

    it("preserves multiple lines and does not apply inline formatting inside code blocks", () => {
      const { container } = render(
        <SimpleMarkdown content={"```js\nline **one**\nline two\n```"} />
      );
      const code = container.querySelector("pre code");
      // raw content kept verbatim, asterisks intact, no <strong> inside
      expect(code?.textContent).toBe("line **one**\nline two");
      expect(code?.querySelector("strong")).toBeNull();
    });
  });

  describe("lists", () => {
    it("renders a dash unordered list as <ul> with <li> items", () => {
      const { container } = render(
        <SimpleMarkdown content={"- apple\n- banana"} />
      );
      const ul = container.querySelector("ul");
      expect(ul).toBeTruthy();
      const items = ul?.querySelectorAll("li");
      expect(items?.length).toBe(2);
      expect(items?.[0].textContent).toBe("apple");
      expect(items?.[1].textContent).toBe("banana");
    });

    it("renders a star-bullet unordered list as <ul>", () => {
      const { container } = render(
        <SimpleMarkdown content={"* one\n* two"} />
      );
      const items = container.querySelectorAll("ul li");
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe("one");
    });

    it("renders an ordered list as <ol> with <li> items", () => {
      const { container } = render(
        <SimpleMarkdown content={"1. first\n2. second"} />
      );
      const ol = container.querySelector("ol");
      expect(ol).toBeTruthy();
      const items = ol?.querySelectorAll("li");
      expect(items?.length).toBe(2);
      expect(items?.[0].textContent).toBe("first");
      expect(items?.[1].textContent).toBe("second");
    });

    it("applies inline formatting inside list items", () => {
      const { container } = render(
        <SimpleMarkdown content={"- item with `code`"} />
      );
      expect(container.querySelector("ul li code")?.textContent).toBe("code");
    });
  });

  describe("horizontal rules", () => {
    it("renders --- as an <hr>", () => {
      const { container } = render(
        <SimpleMarkdown content={"above\n\n---\n\nbelow"} />
      );
      expect(container.querySelector("hr")).toBeTruthy();
    });
  });

  describe("tables", () => {
    it("renders a GFM table with header and body cells", () => {
      const content = ["| Name | Age |", "| --- | --- |", "| Alice | 30 |", "| Bob | 25 |"].join(
        "\n"
      );
      const { container } = render(<SimpleMarkdown content={content} />);
      const table = container.querySelector("table");
      expect(table).toBeTruthy();

      const headers = table?.querySelectorAll("thead th");
      expect(headers?.length).toBe(2);
      expect(headers?.[0].textContent).toBe("Name");
      expect(headers?.[1].textContent).toBe("Age");

      const rows = table?.querySelectorAll("tbody tr");
      expect(rows?.length).toBe(2);
      const firstRowCells = rows?.[0].querySelectorAll("td");
      expect(firstRowCells?.[0].textContent).toBe("Alice");
      expect(firstRowCells?.[1].textContent).toBe("30");
    });

    it("applies inline formatting inside table cells", () => {
      const content = ["| A | B |", "| --- | --- |", "| **bold** | `code` |"].join(
        "\n"
      );
      const { container } = render(<SimpleMarkdown content={content} />);
      expect(container.querySelector("tbody td strong")?.textContent).toBe(
        "bold"
      );
      expect(container.querySelector("tbody td code")?.textContent).toBe("code");
    });
  });

  describe("paragraphs and line breaks", () => {
    it("separates paragraphs with a short spacer, not a full empty line", () => {
      const { container } = render(
        <SimpleMarkdown content={"first\n\nsecond"} />
      );
      const paras = container.querySelectorAll("p");
      expect(paras.length).toBe(2);
      // A <br> would add a whole line of height; the spacer is 6px.
      expect(container.querySelector("br")).toBeNull();
      expect(container.querySelectorAll("div.h-1\\.5").length).toBe(1);
    });

    it("wraps long unbroken tokens instead of overflowing", () => {
      const { container } = render(
        <SimpleMarkdown content={'selectedNodes: [{"id":"i8ik44k","x":1468.87}]'} />
      );
      expect(
        container.firstElementChild?.classList.contains("break-words")
      ).toBe(true);
    });

    it("collapses a run of blank lines into a single spacer", () => {
      const { container } = render(
        <SimpleMarkdown content={"first\n\n\n\nsecond"} />
      );
      expect(container.querySelectorAll("div.h-1\\.5").length).toBe(1);
    });

    it("drops leading and trailing blank lines", () => {
      const { container } = render(
        <SimpleMarkdown content={"\n\nonly paragraph\n\n"} />
      );
      expect(container.querySelectorAll("div.h-1\\.5").length).toBe(0);
      expect(container.querySelectorAll("p").length).toBe(1);
    });

    it("renders no empty block for newlines after a code fence", () => {
      const { container } = render(
        <SimpleMarkdown content={"```\ncode\n```\n\n"} />
      );
      expect(container.querySelectorAll("div.h-1\\.5").length).toBe(0);
      expect(container.firstElementChild?.children.length).toBe(1);
    });
  });

  describe("malformed / unsupported markdown", () => {
    it("leaves an incomplete markdown link as literal text", () => {
      const { container } = render(
        <SimpleMarkdown content="see [docs](https://example.com" />
      );
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("p")?.textContent).toBe(
        "see [docs](https://example.com"
      );
    });

    it("renders unterminated bold markers as literal text", () => {
      const { container } = render(
        <SimpleMarkdown content="dangling **bold without close" />
      );
      expect(container.querySelector("strong")).toBeNull();
      expect(container.querySelector("p")?.textContent).toBe(
        "dangling **bold without close"
      );
    });

    it("escapes raw HTML (does not inject markup)", () => {
      const { container } = render(
        <SimpleMarkdown content="<b>not bold</b>" />
      );
      // React escapes it: no real <b> element, the angle-bracket text is shown.
      expect(container.querySelector("b")).toBeNull();
      expect(screen.getByText("<b>not bold</b>")).toBeTruthy();
    });
  });

  describe("links", () => {
    afterEach(() => {
      delete window.penAgentPanel;
      vi.restoreAllMocks();
    });

    it.each([
      ["/doc?id=d1"],
      ["/app?node=n1"],
      ["/app?tab=3"],
      ["/trace/t1?src=local"],
    ])("renders %s as an anchor", (href) => {
      const { container } = render(<SimpleMarkdown content={`see [the **thing**](${href}) now`} />);
      const a = container.querySelector("a");
      expect(a?.getAttribute("href")).toBe(href);
      expect(a?.textContent).toBe("the thing");
      expect(a?.querySelector("strong")).toBeTruthy();
      expect(a?.getAttribute("target")).toBeNull();
    });

    it("opens external links in a new tab", () => {
      const { container } = render(<SimpleMarkdown content="[x](https://example.com/a)" />);
      const a = container.querySelector("a");
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it.each([["javascript:alert(1)"], ["data:text/html,hi"], ["ftp://x.test"], ["/other"]])(
      "keeps %s as plain text",
      (href) => {
        const { container } = render(<SimpleMarkdown content={`[x](${href})`} />);
        expect(container.querySelector("a")).toBeNull();
        expect(container.textContent).toBe(`[x](${href})`);
      },
    );

    it("keeps bold and code next to links", () => {
      const { container } = render(<SimpleMarkdown content="**b** `c` [l](/doc?id=d)" />);
      expect(container.querySelector("strong")?.textContent).toBe("b");
      expect(container.querySelector("code")?.textContent).toBe("c");
      expect(container.querySelector("a")?.textContent).toBe("l");
    });

    it("a doc link click opens a new window without the docs bridge and prevents navigation", async () => {
      const doc = createDoc({ title: "T", markdown: "x" }, "agent");
      const win = vi.spyOn(window, "open").mockReturnValue(null);
      const { container } = render(<SimpleMarkdown content={`[Doc](/doc?id=${doc.id})`} />);
      const notPrevented = fireEvent.click(container.querySelector("a") as Element);
      expect(notPrevented).toBe(false);
      await vi.waitFor(() =>
        expect(win).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}doc?id=${doc.id}`, "_blank", "noopener"),
      );
    });

    it("a doc link click goes through the docs bridge when present", async () => {
      const doc = createDoc({ title: "T", markdown: "x" }, "agent");
      const open = vi.fn(async () => undefined);
      window.penAgentPanel = { version: 1, docs: { open } } as never;
      const { container } = render(<SimpleMarkdown content={`[Doc](/doc?id=${doc.id})`} />);
      fireEvent.click(container.querySelector("a") as Element);
      await vi.waitFor(() => expect(open).toHaveBeenCalledWith(doc.id));
    });

    it("a doc link to a missing document or a placeholder toasts instead of opening", async () => {
      const win = vi.spyOn(window, "open").mockReturnValue(null);
      const { container } = render(<SimpleMarkdown content="[A](/doc?id=gone) [B](/doc?id=DOC_ID)" />);
      const anchors = container.querySelectorAll("a");
      fireEvent.click(anchors[0]);
      fireEvent.click(anchors[1]);
      await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
      expect(win).not.toHaveBeenCalled();
    });

    it("a middle click on an internal link is prevented; an external link is left alone", () => {
      const { container } = render(<SimpleMarkdown content="[A](/doc?id=d1) [B](https://example.com)" />);
      const anchors = container.querySelectorAll("a");
      expect(fireEvent(anchors[0], new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
      expect(fireEvent(anchors[1], new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(true);
    });

    it("keeps one level of parentheses inside a link href", () => {
      const href = "https://en.wikipedia.org/wiki/Rust_(programming_language)";
      const { container } = render(<SimpleMarkdown content={`see [Rust](${href}) now (really)`} />);
      const a = container.querySelector("a");
      expect(a?.getAttribute("href")).toBe(href);
      expect(container.querySelector("p")?.textContent).toBe("see Rust now (really)");
    });

    it("a canvas tab link click activates the tab", () => {
      const activateTab = vi.fn();
      window.penAgentPanel = { version: 1, canvas: { activateTab } } as never;
      const { container } = render(<SimpleMarkdown content="[Tab](/app?tab=5)" />);
      fireEvent.click(container.querySelector("a") as Element);
      expect(activateTab).toHaveBeenCalledWith(5);
    });
  });
});
