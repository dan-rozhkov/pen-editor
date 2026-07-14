import type { Container as PixiContainer } from "pixi.js";
import type { PixiExportRefs } from "@/store/canvasRefStore";
import {
  findContainerByLabel,
  extractImageBytes,
  withForcedRenderable,
  downloadBlob,
  resolvePageExportBaseName,
  type PdfFrameDescriptor,
} from "./exportUtils";
import { assemblePdfFromPngPages, type PdfPageImage } from "@/lib/pdfExport/assemblePdf";

export type { PdfFrameDescriptor } from "./exportUtils";

/**
 * Extract a Pixi container's live pixels as raw PNG bytes (not a data URL),
 * so they can be handed to pdf-lib's `embedPng`. Thin PNG-specific wrapper
 * around the shared `extractImageBytes` (see `exportUtils.ts`).
 */
function extractPngBytes(
  pixiRefs: PixiExportRefs,
  container: PixiContainer,
  scale: number,
  size: { width: number; height: number },
): Uint8Array {
  return extractImageBytes(pixiRefs, container, scale, size, "image/png");
}

/**
 * Resolve the final PDF download filename.
 *
 * When `finalFilename` is provided (e.g. by `runExportSettingsForNode`, which
 * has already built `Icon@2x.pdf` via `buildExportFilename`), it is used
 * verbatim so the downloaded file matches the reported `ExportRunResult.filename`
 * — crucially preserving the `@2x` scale label, which the base-name sanitizer
 * would otherwise mangle into `_2x`. Otherwise (page-level "all frames" export)
 * a safe name is derived from the frames.
 */
export function resolvePdfDownloadFilename(
  finalFilename: string | undefined,
  frames: PdfFrameDescriptor[],
): string {
  if (finalFilename) return finalFilename;
  return `${resolvePageExportBaseName(frames)}.pdf`;
}

/**
 * Render one or more frames to PDF pages (one page per frame, in the given
 * order) and trigger a file download. Rasterizes each frame via Pixi's
 * `renderer.extract` at the given export scale, then assembles the pages with
 * the pure `assemblePdfFromPngPages`. This function itself touches
 * Pixi/WebGL/DOM and is intentionally not unit-tested (see `assemblePdf.ts`
 * and `resolvePdfDownloadFilename` for the tested logic).
 *
 * `filename`, when given, is the FINAL download filename (already sanitized,
 * including the `.pdf` extension) and is used verbatim; omit it for the
 * page-level "all frames" export to derive a safe name from the frames.
 */
export async function exportFramesToPdf(
  pixiRefs: PixiExportRefs,
  frames: PdfFrameDescriptor[],
  scale: number,
  filename?: string,
): Promise<boolean> {
  if (frames.length === 0) {
    console.error("No frames to export to PDF");
    return false;
  }

  try {
    const pages: PdfPageImage[] = [];

    for (const frame of frames) {
      const container = findContainerByLabel(pixiRefs.sceneRoot, frame.id);
      if (!container) {
        console.warn(`PDF export: skipping frame "${frame.name ?? frame.id}" (${frame.id}) — not found in canvas`);
        continue;
      }

      pages.push({
        pngBytes: withForcedRenderable(container, pixiRefs.sceneRoot, () =>
          extractPngBytes(pixiRefs, container, scale, { width: frame.width, height: frame.height }),
        ),
        widthPt: frame.width,
        heightPt: frame.height,
      });
    }

    if (pages.length === 0) {
      console.error("None of the requested frames were found in the canvas");
      return false;
    }

    const pdfBytes = await assemblePdfFromPngPages(pages);
    downloadBlob(pdfBytes, resolvePdfDownloadFilename(filename, frames), "application/pdf");
    return true;
  } catch (error) {
    console.error("Failed to export PDF:", error);
    return false;
  }
}
