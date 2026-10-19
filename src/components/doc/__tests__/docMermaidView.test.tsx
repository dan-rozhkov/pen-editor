import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";

// Lets one test hold the first render pending; null means the real renderer.
const gate: { hold: Promise<void> | null } = { hold: null };
vi.mock("@/components/doc/extensions/mermaidRender", async (importActual) => {
  const actual = await importActual<typeof import("@/components/doc/extensions/mermaidRender")>();
  return { ...actual, renderMermaid: async (src: string) => (await gate.hold, actual.renderMermaid(src)) };
});
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

let current: Editor | null = null;

function Harness({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
  useEffect(() => {
    current = editor;
  }, [editor]);
  return <EditorContent editor={editor} />;
}

const MERMAID = "```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```";

describe("code block node view", () => {
  it("renders a mermaid fence as an SVG preview with the source hidden", async () => {
    const { container } = render(<Harness markdown={MERMAID} />);
    await waitFor(() => expect(container.querySelector(".doc-mermaid-preview svg")).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector(".doc-mermaid")?.getAttribute("data-editing")).toBe("false");
    expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(true);
    expect(container.querySelector(".doc-mermaid-preview")?.textContent).toContain("Start");
  });

  it("shows the source while the cursor is inside the block and the error under it for a bad diagram", async () => {
    const { container } = render(<Harness markdown={"```mermaid\nnot a diagram at all\n```"} />);
    await act(async () => {
      current?.commands.focus(3);
    });
    await waitFor(() => expect(container.querySelector(".doc-mermaid")?.getAttribute("data-editing")).toBe("true"));
    await waitFor(() => expect(container.querySelector(".doc-mermaid-error")).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(false);
  });

  it("leaves other languages as a plain pre/code block", async () => {
    const { container } = render(<Harness markdown={"```js\nconst a = 1;\n```"} />);
    await waitFor(() => expect(container.querySelector("pre code.language-js")).not.toBeNull());
    expect(container.querySelector(".doc-mermaid")).toBeNull();
  });

  it("shows the source when the diagram has no valid SVG, so it can be edited", async () => {
    const { container } = render(<Harness markdown={"```mermaid\nnot a diagram at all\n```"} />);
    await waitFor(() => expect(container.querySelector(".doc-mermaid-hint")).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(false);
  });

  it("clicking the error hint puts the cursor in the source", async () => {
    const { container } = render(<Harness markdown={"```mermaid\nnot a diagram at all\n```"} />);
    await waitFor(() => expect(container.querySelector(".doc-mermaid-hint")).not.toBeNull(), { timeout: 5000 });
    await act(async () => {
      container.querySelector<HTMLElement>(".doc-mermaid-hint")?.click();
    });
    expect(current?.state.selection.$from.parent.type.name).toBe("codeBlock");
  });

  it("shows the source for an empty diagram", async () => {
    const { container } = render(<Harness markdown={"```mermaid\n```"} />);
    await waitFor(() => expect(container.querySelector(".doc-mermaid-hint")).not.toBeNull());
    expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(false);
  });

  it("drops the old SVG and shows the error when the latest render failed", async () => {
    const { container } = render(<Harness markdown={MERMAID} />);
    await waitFor(() => expect(container.querySelector(".doc-mermaid-preview svg")).not.toBeNull(), { timeout: 5000 });
    await act(async () => {
      current?.commands.insertContentAt(current.state.doc.content.size - 1, "((( broken");
    });
    await waitFor(() => expect(container.querySelector(".doc-mermaid-hint")).not.toBeNull(), { timeout: 5000 });
    expect(container.querySelector(".doc-mermaid-preview svg")).toBeNull();
    expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(false);
  });

  it("shows a quiet placeholder, not the source or a hint, while the first render is pending", async () => {
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => (release = resolve));
    try {
      const { container } = render(<Harness markdown={MERMAID} />);
      await waitFor(() => expect(container.querySelector(".doc-mermaid-body")).not.toBeNull());
      await new Promise((r) => setTimeout(r, 50));
      expect(container.querySelector(".doc-mermaid-body")?.getAttribute("data-pending")).toBe("true");
      expect(container.querySelector<HTMLElement>(".doc-mermaid-source")?.hidden).toBe(true);
      expect(container.querySelector(".doc-mermaid-hint")).toBeNull();
      gate.hold = null;
      release();
      await waitFor(() => expect(container.querySelector(".doc-mermaid-preview svg")).not.toBeNull(), { timeout: 5000 });
      expect(container.querySelector(".doc-mermaid-body")?.getAttribute("data-pending")).toBe("false");
    } finally {
      gate.hold = null;
      release();
    }
  });

});
