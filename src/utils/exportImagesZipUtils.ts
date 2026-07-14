import type { PixiExportRefs } from "@/store/canvasRefStore";
import {
  findContainerByLabel,
  extractImageBytes,
  withForcedRenderable,
  downloadBlob,
  resolvePageExportBaseName,
  type RasterExportFormat,
  type PdfFrameDescriptor,
} from "@/utils/exportUtils";
import { getExportSettingExtension, getExportSettingMimeType, sanitizeExportBaseName } from "@/utils/exportSettingsUtils";
import { assembleImagesZip, type ZipImageFile } from "@/lib/imagesZipExport/assembleImagesZip";

/** Lossy raster quality, matching `exportImageFromPixiWithFilename`'s default. */
const LOSSY_QUALITY = 0.92;

/**
 * Render one or more frames to independent raster images (one file per
 * frame, in the given order) and download them as a single ZIP. This is the
 * Pixi/DOM-touching orchestrator for the page-level "export all frames as
 * images" path — the tested logic lives in `assembleImagesZip`
 * (`@/lib/imagesZipExport`), mirroring the PDF/PPTX split described in
 * CLAUDE.md. Not unit-tested itself (WebGL extract can't run under
 * happy-dom), same as `exportFramesToPdf`/`exportSlidesToPptx`.
 *
 * Deliberately imports only from the format-neutral `exportUtils` (not
 * `exportPdfUtils`) so a raster ("ZIP") export never pulls in the PDF chunk
 * (`pdf-lib` via `assemblePdf.ts`) — see `PageExportSection`'s format branch.
 *
 * Rasterization reuses the exact two PDF-export gotchas this codebase has
 * already hit: `withForcedRenderable` (viewport culling would otherwise
 * blank out any frame currently off-screen) and `toExtractFrame`-pinned
 * extract via `extractImageBytes` (bug-02 — Pixi's implicit content-bounds
 * region can come out smaller than the frame's declared size).
 *
 * File names are derived from `frame.name` (falling back to `frame.id`) via
 * `sanitizeExportBaseName`; duplicate names (e.g. two frames both named
 * "Slide 1") are deduped by `assembleImagesZip` so no frame is silently
 * dropped from the archive.
 *
 * Returns the number of files actually written to the archive (frames whose
 * container isn't found in the canvas are skipped — see the `continue`
 * below), or `null` on failure/no frames. Callers must report this count,
 * not `frames.length`, so the status message can't overstate what's in the
 * ZIP.
 */
export async function exportFramesToImagesZip(
  pixiRefs: PixiExportRefs,
  frames: PdfFrameDescriptor[],
  format: RasterExportFormat,
  scale: number,
): Promise<number | null> {
  if (frames.length === 0) {
    console.error("No frames to export to ZIP");
    return null;
  }

  try {
    const ext = getExportSettingExtension(format);
    const mimeType = getExportSettingMimeType(format);
    const quality = format === "png" ? undefined : LOSSY_QUALITY;

    const files: ZipImageFile[] = [];
    for (const frame of frames) {
      const container = findContainerByLabel(pixiRefs.sceneRoot, frame.id);
      if (!container) {
        console.warn(`ZIP export: skipping frame "${frame.name ?? frame.id}" (${frame.id}) — not found in canvas`);
        continue;
      }

      const bytes = withForcedRenderable(container, pixiRefs.sceneRoot, () =>
        extractImageBytes(pixiRefs, container, scale, { width: frame.width, height: frame.height }, mimeType, quality),
      );
      files.push({ name: `${sanitizeExportBaseName(frame.name || frame.id)}.${ext}`, bytes });
    }

    if (files.length === 0) {
      console.error("None of the requested frames were found in the canvas");
      return null;
    }

    const zipBytes = assembleImagesZip(files);
    downloadBlob(zipBytes, `${resolvePageExportBaseName(frames)}.zip`, "application/zip");
    return files.length;
  } catch (error) {
    console.error("Failed to export images ZIP:", error);
    return null;
  }
}
