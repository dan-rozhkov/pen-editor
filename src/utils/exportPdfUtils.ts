import type { Container as PixiContainer } from "pixi.js";
import type { PixiExportRefs } from "@/store/canvasRefStore";
import type { ExportScale } from "./exportUtils";
import { findContainerByLabel } from "./exportUtils";
import { assemblePdfFromPngPages, type PdfPageImage } from "@/lib/pdfExport/assemblePdf";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";

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
 */
function extractPngBytes(
  pixiRefs: PixiExportRefs,
  container: PixiContainer,
  scale: ExportScale,
): Uint8Array {
  const canvas = pixiRefs.app.renderer.extract.canvas({
    target: container,
    resolution: scale,
    antialias: true,
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
function withForcedRenderable<T>(container: PixiContainer, sceneRoot: PixiContainer, fn: () => T): T {
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

function downloadBlob(bytes: Uint8Array, filename: string, mimeType: string): void {
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
  const sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, "_") || "canvas";
  return `${sanitized}.pdf`;
}

/**
 * Render one or more frames to PDF pages (one page per frame, in the given
 * order) and trigger a file download. Rasterizes each frame via Pixi's
 * `renderer.extract` (like `exportImageFromPixi`) at the given export scale,
 * then assembles the pages with the pure `assemblePdfFromPngPages`. This
 * function itself touches Pixi/WebGL/DOM and is intentionally not
 * unit-tested (see `assemblePdf.ts` for the tested logic).
 */
export async function exportFramesToPdf(
  pixiRefs: PixiExportRefs,
  frames: PdfFrameDescriptor[],
  scale: ExportScale,
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
          extractPngBytes(pixiRefs, container, scale),
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
    const name = filename ?? (frames.length === 1 ? frames[0].name || frames[0].id : "canvas");
    downloadBlob(pdfBytes, safePdfFilename(name), "application/pdf");
    return true;
  } catch (error) {
    console.error("Failed to export PDF:", error);
    return false;
  }
}
