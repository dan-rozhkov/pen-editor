import { Editor } from "@tiptap/core";
import { DOC_EXTENSIONS } from "@/components/doc/docExtensions";

export function makeEditor(markdown: string): Editor {
  return new Editor({ extensions: DOC_EXTENSIONS, content: markdown, contentType: "markdown" });
}

/** Top-level node type names, e.g. ["heading", "paragraph"]. */
export function topTypes(editor: Editor): string[] {
  return (editor.getJSON().content ?? []).map((node) => node.type ?? "");
}
