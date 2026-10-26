import { browseTraceToPlaywrightSpec, type BrowseTrace } from "@sideform/browser-agent/agent/session";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { exportBrowseTrace, traceFileName } from "@/lib/browseTraceFile";
import { createDoc, readDoc } from "@/lib/docs/docStore";
import { saveBlob } from "@/lib/downloadFile";
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

// A failure is a toast: the menu has closed by then, and an inline alert would move the header icons.
const failed = (message: string, cause?: unknown) => {
  if (cause !== undefined) console.error(message, cause);
  toast.error(message);
};

/** "Open result": the run result as a Markdown document in the /doc editor. `available` is false without result text or a way to open it. */
export function useOpenResult(trace: BrowseTrace) {
  const available = Boolean(resultText(trace)) && canOpenResult();
  const open = () => {
    let id: string;
    try {
      id = resultDocId(trace);
    } catch (e) {
      failed(e instanceof Error ? e.message : "The result could not be saved.", e);
      return;
    }
    const desktop = window.penDesktop;
    if (desktop?.docs?.open) {
      void desktop.docs.open(id).then(
        (r) => !r.ok && failed(r.error ?? "The document could not be opened."),
        (e: unknown) => failed("The document could not be opened.", e),
      );
      return;
    }
    // Synchronous in the click, or popup blockers refuse it.
    window.open(`${import.meta.env.BASE_URL}doc?id=${encodeURIComponent(id)}`, "_blank", "noopener");
  };
  return { available, open };
}

/**
 * "Download trace": the run as one portable JSON file, frames inlined. The menu closes on the click, so the
 * progress is a loading toast (inlining a cloud trace's frames can take seconds); it turns into the error on a failure.
 */
export function useDownloadTrace(trace: BrowseTrace, cloudTraceId?: string) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const progress = toast.loading("Preparing the trace file…");
    try {
      const { blob, notInlined } = await exportBrowseTrace(trace, undefined, cloudTraceId);
      saveBlob(blob, traceFileName(trace));
      toast.dismiss(progress);
      if (notInlined > 0) toast(`${notInlined} ${notInlined === 1 ? "frame stays a link" : "frames stay as links"}; the file needs network access to show ${notInlined === 1 ? "it" : "them"}.`);
    } catch (e) {
      console.error("Trace download failed", e);
      toast.error("Download failed, try again.", { id: progress });
    } finally {
      setBusy(false);
    }
  };
  return { busy, download };
}

/** "Download Playwright test": the run as a `.spec.ts` file. `available` is false for a trace recorded without `repro`. */
export function usePlaywrightSpec(trace: BrowseTrace) {
  const spec = useMemo(() => browseTraceToPlaywrightSpec(trace), [trace]);
  if (!spec.ok) return { available: false as const };
  const notes = [
    spec.gaps > 0 ? `${spec.gaps} ${spec.gaps === 1 ? "gap" : "gaps"}` : "",
    spec.failingChecks > 0 ? `${spec.failingChecks} failing ${spec.failingChecks === 1 ? "check" : "checks"}` : "",
  ].filter(Boolean);
  return {
    available: true as const,
    notes: notes.join(", "),
    download: () => saveBlob(new Blob([spec.code], { type: "text/plain" }), spec.fileName),
  };
}
