import { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";
import { CreateLoginDialog } from "../CreateLoginDialog";
import { CREATE_LOGIN_EVENT } from "../LoginMention";

const add = vi.fn();
let editor: Editor;

beforeEach(() => {
  add.mockReset().mockResolvedValue({ ok: true, id: "new-1" });
  window.penDesktop = { logins: { list: vi.fn().mockResolvedValue({ entries: [], encryptionAvailable: true }), add } } as never;
  editor = new Editor({ extensions: DOC_EXTENSIONS, content: "Hello @al world", contentType: "markdown" });
});
afterEach(() => {
  cleanup();
  editor.destroy();
  window.penDesktop = undefined;
});

const text = () => editor.state.doc.textContent;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function openAndSave(range: { from: number; to: number }) {
  render(<CreateLoginDialog editor={editor} />);
  act(() => void editor.view.dom.dispatchEvent(new CustomEvent(CREATE_LOGIN_EVENT, { detail: { range, query: "al" } })));
  await screen.findByText("Create login");
  type("Site URL", "https://github.com");
  type("Password", "p");
  return () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("CreateLoginDialog", () => {
  it("replaces @query with the chip, following edits made meanwhile", async () => {
    // "Hello @al world": the paragraph starts at 1, so "@al" is 7..10.
    const save = await openAndSave({ from: 7, to: 10 });
    act(() => void editor.commands.insertContentAt(1, "Well, "));
    save();
    await waitFor(() => expect(editor.getMarkdown()).toContain("[@al · github.com](login:new-1)"));
    expect(text()).not.toContain("@al ");
    expect(text().startsWith("Well, Hello")).toBe(true);
  });

  it("puts the chip at the caret when the typed text is gone", async () => {
    const save = await openAndSave({ from: 7, to: 10 });
    act(() => void editor.commands.deleteRange({ from: 6, to: 10 }));
    save();
    await waitFor(() => expect(editor.getMarkdown()).toContain("login:new-1"));
    expect(text()).toContain("Hello");
    expect(text()).not.toContain("@al");
  });
});
