import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

const SRC = `|  |  |\n| --- | --- |\n| ID | BUG-07 |\n| Status | Open |\n\nBody text`;

let current: Editor | null = null;

function Harness() {
  const editor = useEditor({ extensions: DOC_EXTENSIONS, content: SRC, contentType: "markdown" });
  useEffect(() => {
    current = editor;
  }, [editor]);
  return <EditorContent editor={editor} />;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const icons = () => screen.findAllByRole("button", { name: "Change value type" });

async function openPicker(view: "Option" | "Date", row = 0) {
  render(<Harness />);
  fireEvent.click((await icons())[row]);
  fireEvent.click(await screen.findByRole("menuitem", { name: view }));
  return screen.findByLabelText(view === "Option" ? "Filter options" : "Date");
}

/** Put the caret at the end of the body paragraph, where the user clicked before typing. */
function caretInBody(editor: Editor) {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

describe("property popovers: Escape and focus", () => {
  it("closes on Escape in the option filter and hands focus to the editor", async () => {
    const input = await openPicker("Option");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(current?.view.hasFocus()).toBe(true);
  });

  it("closes on Escape in the date input", async () => {
    const input = await openPicker("Date");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Date")).toBeNull());
    expect(current?.view.hasFocus()).toBe(true);
  });

  it.each([["Option"], ["Date"]] as const)("sends later typing in a paragraph to the paragraph after the %s picker closed", async (view) => {
    const input = await openPicker(view);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText(view === "Option" ? "Filter options" : "Date")).toBeNull());
    const editor = current!;
    caretInBody(editor);
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    editor.commands.insertContent("/report");
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("| ID | BUG-07 |");
    expect(markdown).toContain("| Status | Open |");
    expect(markdown).toContain("/report");
    expect(markdown).not.toContain("BUG-07/report");
  });

  it("keeps a single property popover open at a time", async () => {
    render(<Harness />);
    const [first, second] = await icons();
    fireEvent.click(first);
    await screen.findByRole("menu", { name: "Value type" });
    fireEvent.click(second);
    await waitFor(() => expect(screen.getAllByRole("menu", { name: "Value type" })).toHaveLength(1));
  });
});
