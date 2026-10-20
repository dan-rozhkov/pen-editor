import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { DOC_EXTENSIONS } from "./docExtensions";
import { SlashCommand } from "./slash/SlashCommand";
import { BlockHandle } from "./blockHandle/BlockHandle";
import { BubbleToolbar } from "./ui/BubbleToolbar";
import { ImagePrompt } from "./ui/ImagePrompt";
import "./docProse.css";

interface Props {
  markdown: string;
  /** Changes when `markdown` was replaced from outside. */
  revision: number;
  onMarkdown: (markdown: string) => void;
  onSynced: (markdown: string) => void;
  onEditor: (editor: Editor | null) => void;
}

function placeholderFor({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } }): string {
  return node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Write, or press '/' for commands…";
}

export function DocEditor({ markdown, revision, onMarkdown, onSynced, onEditor }: Props) {
  const handlers = useRef({ onMarkdown, onSynced });
  useEffect(() => {
    handlers.current = { onMarkdown, onSynced };
  });

  const editor = useEditor({
    extensions: [...DOC_EXTENSIONS, SlashCommand, Placeholder.configure({ placeholder: placeholderFor })],
    content: markdown,
    contentType: "markdown",
    editorProps: { attributes: { class: "doc-prose", "aria-label": "Document" } },
    onUpdate: ({ editor: e }) => handlers.current.onMarkdown(e.getMarkdown()),
  });

  // The view exists only after "create"; the overlays read `editor.view.dom`. Listen on
  // the live instance itself: in StrictMode the `onCreate` option fired for an instance
  // that was destroyed right after, and a shared flag then hid the overlays.
  const [createdEditor, setCreatedEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    let active = true;
    const onCreate = () => active && setCreatedEditor(editor);
    const onUnmount = () => setCreatedEditor(null);
    editor.on("create", onCreate);
    editor.on("unmount", onUnmount);
    if (editor.isInitialized) queueMicrotask(onCreate);
    return () => {
      active = false;
      editor.off("create", onCreate);
      editor.off("unmount", onUnmount);
    };
  }, [editor]);

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

  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} className="relative">
      <EditorContent editor={editor} />
      {editor && editor === createdEditor && (
        <>
          <BubbleToolbar editor={editor} />
          <BlockHandle editor={editor} containerRef={containerRef} />
          <ImagePrompt editor={editor} />
        </>
      )}
    </div>
  );
}
