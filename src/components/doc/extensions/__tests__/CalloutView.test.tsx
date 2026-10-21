import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

let current: Editor | null = null;

function Harness() {
  const editor = useEditor({ extensions: DOC_EXTENSIONS, content: "> [!NOTE]\n> Body", contentType: "markdown" });
  useEffect(() => {
    current = editor;
  }, [editor]);
  return (
    <>
      <EditorContent editor={editor} />
      <button type="button">outside</button>
    </>
  );
}

const openMenu = async () => {
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: /Note callout, change type/ }));
  await screen.findByRole("menu", { name: "Callout type" });
};

afterEach(cleanup);

describe("callout kind menu", () => {
  it("changes the kind and closes", async () => {
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Warning" }));
    expect(current?.getMarkdown()).toContain("[!WARNING]");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on Escape", async () => {
    await openMenu();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("closes on an outside press", async () => {
    await openMenu();
    const outside = screen.getByRole("button", { name: "outside" });
    fireEvent.pointerDown(outside);
    fireEvent.mouseDown(outside);
    fireEvent.pointerUp(outside);
    fireEvent.click(outside);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
