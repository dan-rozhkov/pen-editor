import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocEditor } from "../DocEditor";

describe("DocEditor", () => {
  afterEach(cleanup);

  // StrictMode recreates the editor: the old instance's onDestroy fires after the
  // new one's onCreate and must not unmount the overlays of the live editor.
  it("shows the selection toolbar after the editor is recreated", async () => {
    let editor: Editor | null = null;
    render(
      <StrictMode>
        <DocEditor
          markdown="Hello world"
          revision={0}
          onMarkdown={() => {}}
          onSynced={() => {}}
          onEditor={(e) => {
            editor = e;
          }}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(editor?.isInitialized).toBe(true));
    act(() => {
      editor!.chain().focus().setTextSelection({ from: 1, to: 6 }).run();
    });
    expect(await screen.findByRole("toolbar", { name: "Text formatting" })).toBeTruthy();
  });
});
