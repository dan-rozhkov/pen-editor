// Fire-the-operation-and-report-the-result glue shared by the toolbar
// buttons (ImageOpsTools.tsx, which also tracks a local busy state around
// the call) and the palette commands (imageOpsCommands.ts, which are
// fire-and-forget). The actual network calls + scene mutation live in
// src/lib/imageOps/ (removeBackground.ts, vectorize.ts) — this module only
// owns turning their outcome into user-visible feedback, so that feedback
// can't drift between the two entry points.
import { toast } from "sonner";
import { removeBackgroundOnNode } from "@/lib/imageOps/removeBackground";
import { vectorizeNode } from "@/lib/imageOps/vectorize";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Remove the background of `nodeId`'s image fill. Shows an error toast and
 * rethrows on failure so a caller tracking a busy flag can clear it in a
 * `finally`; never throws for the caller to handle a *second* time (the
 * toast IS the error handling).
 */
export async function runRemoveBackground(nodeId: string): Promise<void> {
  try {
    await removeBackgroundOnNode(nodeId);
  } catch (err) {
    toast.error(errorMessage(err, "Couldn't remove the background. Please try again."));
    throw err;
  }
}

/**
 * Vectorize `nodeId`'s image fill into scene layers. A `tooComplex` result
 * is not an error — the request succeeded, the traced image just has too
 * many contours to place as layers (typically a photo, not a logo/flat
 * illustration) — so it gets an informational toast, not `toast.error`.
 */
export async function runVectorize(nodeId: string): Promise<void> {
  try {
    const result = await vectorizeNode(nodeId, { mode: "layers" });
    if (result.tooComplex) {
      toast(
        "This image traced into too many shapes to place as layers" +
          (result.nodeCount ? ` (${result.nodeCount} contours)` : "") +
          ". Vectorizing works best on logos and flat illustrations, not photos.",
      );
    }
  } catch (err) {
    toast.error(errorMessage(err, "Couldn't vectorize this image. Please try again."));
    throw err;
  }
}
