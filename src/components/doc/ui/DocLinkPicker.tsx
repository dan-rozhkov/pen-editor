import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { FileTextIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { listDocs, type DocMeta } from "@/lib/docs/docStore";
import { cn } from "@/lib/utils";
import { DOC_LINK_PICKER_EVENT } from "../slash/slashItems";
import { insertDocLink, linkableDocs } from "../docLinkPicker";
import { MENU_INPUT, MENU_SURFACE } from "./menuSurface";

const WIDTH = 288;

/** Filterable document list under the caret, opened by the slash menu's "Link to document" item. */
export function DocLinkPicker({ editor, currentDocId }: { editor: Editor; currentDocId: string | null | undefined }) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<DocMeta[]>([]);

  useEffect(() => {
    const dom = editor.view.dom;
    const open = () => {
      const caret = editor.view.coordsAtPos(editor.state.selection.from);
      setQuery("");
      setDocs(listDocs());
      setAnchor({ left: Math.max(8, Math.min(caret.left, window.innerWidth - WIDTH - 8)), top: caret.bottom + 6 });
    };
    dom.addEventListener(DOC_LINK_PICKER_EVENT, open);
    return () => dom.removeEventListener(DOC_LINK_PICKER_EVENT, open);
  }, [editor]);

  const matches = useMemo(() => linkableDocs(docs, currentDocId, query), [docs, currentDocId, query]);

  if (!anchor) return null;
  const close = () => setAnchor(null);
  const pick = (doc: DocMeta) => {
    close();
    insertDocLink(editor, doc);
  };
  return createPortal(
    <div
      className={cn(MENU_SURFACE, "fixed z-[10050] p-1.5")}
      style={{ left: anchor.left, top: anchor.top, width: WIDTH }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <Input
        autoFocus
        className={MENU_INPUT}
        aria-label="Find a document"
        placeholder="Find a document"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
            editor.commands.focus();
          } else if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            pick(matches[0]);
          }
        }}
      />
      <div role="listbox" aria-label="Documents" className="mt-1 max-h-60 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="px-2.5 py-1.5 text-[13px] text-menu-muted-foreground">No documents</div>
        ) : (
          matches.map((doc) => (
            <div
              key={doc.id}
              role="option"
              aria-selected={false}
              className="text-menu-foreground flex min-h-8 cursor-default items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] leading-5 hover:bg-menu-highlight hover:text-menu-foreground"
              onClick={() => pick(doc)}
            >
              <FileTextIcon className="text-menu-muted-foreground size-4 shrink-0" />
              <span className="truncate">{doc.title.trim() || "Untitled"}</span>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
