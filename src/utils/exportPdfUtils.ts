import type { Container as PixiContainer } from "pixi.js";
import type { PixiExportRefs } from "@/store/canvasRefStore";
import { findContainerByLabel, toExtractFrame } from "./exportUtils";
import { assemblePdfFromPngPages, type PdfPageImage } from "@/lib/pdfExport/assemblePdf";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { sanitizeExportBaseName } from "@/utils/exportSettingsUtils";

/** A frame (or any node) to render onto one PDF page. */
export interface PdfFrameDescriptor {
  id: string;
  name?: string;
  /** Logical (unscaled) width/height in design px, used as the PDF page size in pt (1px = 1pt). */
  width: number;
  height: number;
}

/** Resolve a single frame's effective PDF page size, falling back to stored width/height. */
export function getFrameDescriptor(nodeId: string, name: string | undefined): PdfFrameDescriptor {
  const { getNodes, nodesById } = useSceneStore.getState();
  const { calculateLayoutForFrame } = useLayoutStore.getState();
  const nodes = getNodes();
  const node = nodesById[nodeId];
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame) ?? {
    width: node?.width ?? 0,
    height: node?.height ?? 0,
  };
  return { id: nodeId, name, width: size.width, height: size.height };
}

/** Top-level `frame` nodes on the current page, in Layers-panel top-to-bottom (page) order. */
export function getTopLevelFrames(): PdfFrameDescriptor[] {
  const { rootIds, nodesById } = useSceneStore.getState();

  const frames: PdfFrameDescriptor[] = [];
  for (const id of [...rootIds].reverse()) {
    const node = nodesById[id];
    if (!node || node.type !== "frame") continue;
    frames.push(getFrameDescriptor(id, node.name));
  }
  return frames;
}

/**
 * Extract a Pixi container's live pixels as raw PNG bytes (not a data URL),
 * so they can be handed to pdf-lib's `embedPng`.
 *
 * Pins an explicit `frame` from the page's declared width/height (see
 * `exportUtils.toExtractFrame`) so the rasterized page is exactly
 * `width×height×scale` px, instead of Pixi's implicit content-bounds region
 * (which can come out smaller than the frame for pages with no
 * full-covering background). `resolution: scale` alone is already correct
 * here — Pixi v8 uses it independent of the app renderer's resolution/DPR.
 */
function extractPngBytes(
  pixiRefs: PixiExportRefs,
  container: PixiContainer,
  scale: number,
  size: { width: number; height: number },
): Uint8Array {
  const canvas = pixiRefs.app.renderer.extract.canvas({
    target: container,
    resolution: scale,
    antialias: true,
    frame: toExtractFrame(size.width, size.height),
  }) as HTMLCanvasElement;
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrlToUint8Array(dataUrl);
}

/**
 * Viewport culling (`syncAutoLayout.ts` `updateCulling`) sets `container.renderable
 * = false` on root frame containers outside the viewport, which would make
 * `renderer.extract.canvas` rasterize a blank page for any frame not currently
 * on-screen. Force `container` and its ancestors (up to and including
 * `sceneRoot`) renderable for the duration of `fn`, then restore whatever they
 * were before.
 */
export function withForcedRenderable<T>(container: PixiContainer, sceneRoot: PixiContainer, fn: () => T): T {
  const restore: Array<() => void> = [];
  let current: PixiContainer | null = container;
  while (current) {
    if (!current.renderable) {
      const target = current;
      restore.push(() => {
        target.renderable = false;
      });
      current.renderable = true;
    }
    if (current === sceneRoot) break;
    current = current.parent as PixiContainer | null;
  }
  try {
    return fn();
  } finally {
    for (const undo of restore) undo();
  }
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function downloadBlob(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function safePdfFilename(baseName: string): string {
  return `${sanitizeExportBaseName(baseName)}.pdf`;
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
  const base = frames.length === 1 ? frames[0].name || frames[0].id : "canvas";
  return safePdfFilename(base);
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
