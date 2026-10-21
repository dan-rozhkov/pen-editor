import type { Editor } from "@tiptap/react";
import { docLinkHref } from "@/lib/docs/docLinks";
import { DEFAULT_DOC_TITLE, type DocMeta } from "@/lib/docs/docStore";

/** Documents a link can point to: everything but the open one, newest first, filtered by title. */
export function linkableDocs(docs: DocMeta[], currentId: string | null | undefined, query: string): DocMeta[] {
  const q = query.trim().toLowerCase();
  return docs
    .filter((doc) => doc.id !== currentId && (!q || doc.title.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Inserts the document's title as a link to it, then a plain space so typing on does not extend the link. */
export function insertDocLink(editor: Editor, doc: DocMeta): void {
  const text = doc.title.trim() || DEFAULT_DOC_TITLE;
  editor
    .chain()
    .focus()
    .insertContent([
      { type: "text", text, marks: [{ type: "link", attrs: { href: docLinkHref(doc.id) } }] },
      { type: "text", text: " " },
    ])
    .run();
}
