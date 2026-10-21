import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { DOC_EXTENSIONS } from "./docExtensions";
import { SlashCommand } from "./slash/SlashCommand";
import { BlockHandle } from "./blockHandle/BlockHandle";
import { TableControls } from "./table/TableControls";
import { BubbleToolbar } from "./ui/BubbleToolbar";
import { ImagePrompt } from "./ui/ImagePrompt";
import { DocLinkPicker } from "./ui/DocLinkPicker";
import { TemplateStarter } from "./ui/TemplateStarter";
import { DocLinkClick } from "./extensions/docLinkClick";
import { insertTemplate, TEMPLATE_INSERTED_EVENT } from "./templateInsert";
import { focusNodeLink, openDocLink } from "@/lib/docs/docLinkActions";
import { getCachedDocTemplates, loadDocTemplates, type DocTemplate } from "@/lib/docs/docTemplates";
import "./docProse.css";

interface Props {
  markdown: string;
  /** Changes when `markdown` was replaced from outside. */
  revision: number;
  onMarkdown: (markdown: string) => void;
  onSynced: (markdown: string) => void;
  onEditor: (editor: Editor | null) => void;
  /** The open document, left out of the "Link to document" list. */
  docId?: string | null;
  /** A click on a `/doc?id=` link: switch the tab to that document. */
  onOpenDoc?: (id: string) => void;
  /** A template went in: the page sets the title if it is still empty. */
  onTemplateTitle?: (title: string) => void;
}

/** Templates for the slash menu and the empty-document row; null until the backend answered. */
function useDocTemplates(): DocTemplate[] | null {
  const [templates, setTemplates] = useState(getCachedDocTemplates);
  useEffect(() => {
    let live = true;
    void loadDocTemplates().then((loaded) => live && setTemplates(loaded));
    return () => {
      live = false;
    };
  }, []);
  return templates;
}

function placeholderFor({ node }: { node: { type: { name: string }; attrs: Record<string, unknown> } }): string {
  return node.type.name === "heading" ? `Heading ${node.attrs.level}` : "Write, or press '/' for commands…";
}

export function DocEditor({ markdown, revision, onMarkdown, onSynced, onEditor, docId, onOpenDoc, onTemplateTitle }: Props) {
  const handlers = useRef({ onMarkdown, onSynced, onOpenDoc, onTemplateTitle });
  useEffect(() => {
    handlers.current = { onMarkdown, onSynced, onOpenDoc, onTemplateTitle };
  });
  const templates = useDocTemplates();

  const editor = useEditor({
    extensions: [
      ...DOC_EXTENSIONS,
      DocLinkClick.configure({
        getActions: () => ({
          openDoc: (id) => openDocLink(id, (next) => handlers.current.onOpenDoc?.(next)),
          focusNode: focusNodeLink,
        }),
      }),
      SlashCommand, Placeholder.configure({ placeholder: placeholderFor }),
    ],
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

  // A template went in (slash menu or the empty-document row): hand its title to the page.
  useEffect(() => {
    if (!editor || editor !== createdEditor) return;
    const dom = editor.view.dom;
    const onInserted = (event: Event) => handlers.current.onTemplateTitle?.((event as CustomEvent<{ title: string }>).detail.title);
    dom.addEventListener(TEMPLATE_INSERTED_EVENT, onInserted);
    return () => dom.removeEventListener(TEMPLATE_INSERTED_EVENT, onInserted);
  }, [editor, createdEditor]);

  const isEmpty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? false });

  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={containerRef} className="relative">
      <EditorContent editor={editor} />
      {editor && isEmpty && templates && (
        <TemplateStarter
          templates={templates}
          onPick={(template) => insertTemplate(editor, editor.chain().focus("start"), template)}
        />
      )}
      {editor && editor === createdEditor && (
        <>
          <BubbleToolbar editor={editor} />
          <BlockHandle editor={editor} containerRef={containerRef} />
          <TableControls editor={editor} containerRef={containerRef} />
          <ImagePrompt editor={editor} />
          <DocLinkPicker editor={editor} currentDocId={docId} />
        </>
      )}
    </div>
  );
}
