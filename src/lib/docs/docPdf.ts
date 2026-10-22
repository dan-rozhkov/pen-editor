import { toast } from "sonner";
import { docPdfFilename } from "@/lib/docs/docExport";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Resolves after two frames: an open menu has unmounted and the DOM has settled. */
function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return new Promise((r) => setTimeout(r, 50));
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/**
 * Exports the open document as a PDF. The desktop shell prints the tab to a file
 * (save dialog); on the web or an older shell the system print dialog opens, where
 * the user picks "Save as PDF". Both render the page with print CSS (docProse.css).
 */
export async function exportDocPdf(title: string): Promise<void> {
  // The click that starts the export may come from a dropdown item; let the menu close before printing.
  await nextPaint();
  const exportPdf = typeof window === "undefined" ? undefined : window.penDesktop?.docs?.exportPdf;
  if (typeof exportPdf !== "function") {
    window.print();
    return;
  }
  try {
    const result = await exportPdf(docPdfFilename(title));
    if ("ok" in result) toast(`Saved ${baseName(result.path)}`);
    else if ("error" in result && result.error === "Not allowed.") window.print();
    else if ("error" in result) toast.error(`Could not save the PDF: ${result.error}`);
  } catch (e) {
    toast.error(`Could not save the PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
}
