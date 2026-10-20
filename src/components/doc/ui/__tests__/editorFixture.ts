import { Editor } from "@tiptap/core";
import { expect } from "vitest";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

export function makeEditor(markdown: string): Editor {
  return new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
}

/** Top-level node type names, e.g. ["heading", "paragraph"]. */
export function topTypes(editor: Editor): string[] {
  return (editor.getJSON().content ?? []).map((node) => node.type ?? "");
}

const owned: Editor[] = [];

/** Register an editor built elsewhere so `destroyLoaded` destroys it too. */
export function own(editor: Editor): Editor {
  owned.push(editor);
  return editor;
}

/** makeEditor whose editor is destroyed by `destroyLoaded` (call it from afterEach). */
export function load(markdown: string): Editor {
  const editor = makeEditor(markdown);
  owned.push(editor);
  return editor;
}

export function destroyLoaded(): void {
  owned.splice(0).forEach((editor) => editor.destroy());
}

/** Parse twice: the second load of the first output must serialize identically, and both docs satisfy the schema. */
export function parseTwice(markdown: string): string {
  const first = load(markdown);
  first.state.doc.check();
  const once = first.getMarkdown();
  const second = load(once);
  second.state.doc.check();
  expect(second.getMarkdown()).toBe(once);
  return once;
}
