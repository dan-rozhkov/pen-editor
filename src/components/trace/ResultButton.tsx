import { FileTextIcon } from "@phosphor-icons/react";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { memo, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { createDoc, readDoc } from "@/lib/docs/docStore";
import { buildResultMarkdown, canOpenResult, resultDocTitle, resultText } from "./resultDoc";

const MAP_PREFIX = "pen.trace.resultDoc.";

function rememberedDocId(traceId: string): string | null {
  try {
    const id = localStorage.getItem(MAP_PREFIX + traceId);
    return id && readDoc(id).kind === "ok" ? id : null;
  } catch {
    return null;
  }
}

function remember(traceId: string, docId: string): void {
  try {
    localStorage.setItem(MAP_PREFIX + traceId, docId);
  } catch {
    // The document exists; it just will not be reused next time.
  }
}

/** The doc of this run's result: the remembered one while it still exists, else a new one. Throws when storage is full or blocked. */
function resultDocId(trace: BrowseTrace): string {
  const known = rememberedDocId(trace.id);
  if (known) return known;
  const doc = createDoc({ title: resultDocTitle(trace), markdown: buildResultMarkdown(trace) }, "editor");
  remember(trace.id, doc.id);
  return doc.id;
}

/** "Open result": the run result as a Markdown document in the /doc editor. Hidden when there is no result or no way to open it. */
export const ResultButton = memo(function ResultButton({ trace }: { trace: BrowseTrace }) {
  const [error, setError] = useState<string | null>(null);
  const desktop = typeof window !== "undefined" ? window.penDesktop : undefined;
  if (!resultText(trace)) return null;
  if (!canOpenResult()) return null;

  const open = () => {
    setError(null);
    let id: string;
    try {
      id = resultDocId(trace);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The result could not be saved.");
      return;
    }
    if (desktop?.docs?.open) {
      void desktop.docs.open(id).then((r) => !r.ok && setError(r.error ?? "The document could not be opened."), () => setError("The document could not be opened."));
      return;
    }
    // Synchronous in the click, or popup blockers refuse it.
    window.open(`${import.meta.env.BASE_URL}doc?id=${encodeURIComponent(id)}`, "_blank", "noopener");
  };

  return (
    <>
      {error && (
        <span role="alert" className="max-w-56 truncate text-xs text-destructive" title={error}>
          {error}
        </span>
      )}
      <IconButton tooltip="Open result" variant="ghost" size="icon" onClick={open}>
        <FileTextIcon className="size-4" weight="light" />
      </IconButton>
    </>
  );
});
