import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { DOC_EXTENSIONS } from "./docExtensions";
import "./docProse.css";

interface Props {
  markdown: string;
  /** Changes when `markdown` was replaced from outside. */
  revision: number;
  onMarkdown: (markdown: string) => void;
  onSynced: (markdown: string) => void;
  onEditor: (editor: Editor | null) => void;
}

export function DocEditor({ markdown, revision, onMarkdown, onSynced, onEditor }: Props) {
  const handlers = useRef({ onMarkdown, onSynced });
  useEffect(() => {
    handlers.current = { onMarkdown, onSynced };
  });

  const editor = useEditor({
    extensions: [...DOC_EXTENSIONS, Placeholder.configure({ placeholder: "Start writing…" })],
    content: markdown,
    contentType: "markdown",
    editorProps: { attributes: { class: "doc-prose", "aria-label": "Document" } },
    onUpdate: ({ editor: e }) => handlers.current.onMarkdown(e.getMarkdown()),
  });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  // External replace (agent write): same editor instance, no echo-save, selection kept.
  const appliedRevision = useRef(revision);
  useEffect(() => {
    if (!editor || appliedRevision.current === revision) return;
    appliedRevision.current = revision;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    const max = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    handlers.current.onSynced(editor.getMarkdown());
  }, [editor, markdown, revision]);

  return <EditorContent editor={editor} />;
}
