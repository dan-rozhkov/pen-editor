import { PDFDocument } from "pdf-lib";

/**
 * One PDF page's worth of content: a raster PNG plus the page's physical
 * size in PDF points (1pt = 1/72in; we treat design px as pt 1:1, matching
 * the existing screen/export convention — raster *resolution* is controlled
 * separately via the PNG's own pixel dimensions/export scale, not page size).
 */
export interface PdfPageImage {
  pngBytes: Uint8Array;
  widthPt: number;
  heightPt: number;
}

/**
 * Assemble a PDF from one or more PNG "pages". Pure and Pixi/DOM-free — it
 * only touches byte arrays and pdf-lib, so it's unit-testable without WebGL
 * (mirrors the shader `placeShaderSprite`/`shaderRaster` split described in
 * CLAUDE.md: pure assembly is tested here, the Pixi rasterization that
 * produces the PNG bytes lives separately in `exportPdfUtils.ts` and is not
 * unit-tested).
 *
 * Multi-frame exports produce one page per frame, in the given array order
 * (callers are responsible for ordering frames — e.g. layer/page order).
 */
export async function assemblePdfFromPngPages(pages: PdfPageImage[]): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error("assemblePdfFromPngPages requires at least one page");
  }

  const pdfDoc = await PDFDocument.create();

  for (const { pngBytes, widthPt, heightPt } of pages) {
    const image = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  }

  return pdfDoc.save();
}
