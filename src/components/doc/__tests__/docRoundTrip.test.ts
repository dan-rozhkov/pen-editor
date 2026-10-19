import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { DOC_EXTENSIONS, DocStrike } from "@/components/doc/docExtensions";

function roundTrip(markdown: string): string {
  const editor = new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}

describe("doc editor markdown round trip", () => {
  it.each([
    ["a GFM table", "| A | B |\n| --- | --- |\n| 1 | 2 |", ["| A", "| B", "| 1", "| 2"]],
    ["a task list", "- [ ] todo\n- [x] done", ["- [ ] todo", "- [x] done"]],
    ["an image", "![alt text](https://x.test/y.png)", ["![alt text](https://x.test/y.png)"]],
  ])("keeps %s", (_name, markdown, fragments) => {
    const out = roundTrip(markdown);
    for (const fragment of fragments) expect(out).toContain(fragment);
  });
});

describe("doc strike shortcut", () => {
  it("binds Mod-Shift-x and leaves Mod-Shift-s to the desktop export menu", () => {
    const toggleStrike = vi.fn();
    const shortcuts = DocStrike.config.addKeyboardShortcuts?.call({ editor: { commands: { toggleStrike } } } as never) ?? {};
    expect(Object.keys(shortcuts)).toEqual(["Mod-Shift-x"]);
    shortcuts["Mod-Shift-x"]({ editor: undefined as never });
    expect(toggleStrike).toHaveBeenCalledOnce();
  });

  it("registers strike exactly once (StarterKit's copy is off)", () => {
    const editor = new Editor({ extensions: DOC_EXTENSIONS });
    expect(editor.extensionManager.extensions.filter((e) => e.name === "strike")).toHaveLength(1);
    editor.destroy();
  });
});
