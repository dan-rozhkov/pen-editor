import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { assemblePdfFromPngPages } from "../assemblePdf";

// A real (but minimal) 1x1 transparent PNG, base64-encoded. Using a valid PNG
// (rather than arbitrary bytes) lets pdf-lib's `embedPng` actually parse it,
// while still keeping the test free of Pixi/WebGL/DOM — the PNG bytes are
// mocked/static data, not rendered.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function mockPngBytes(): Uint8Array {
  return Uint8Array.from(Buffer.from(PNG_1X1_BASE64, "base64"));
}

describe("assemblePdfFromPngPages", () => {
  it("creates a single-page PDF with the correct page size for one frame", async () => {
    const bytes = await assemblePdfFromPngPages([
      { pngBytes: mockPngBytes(), widthPt: 400, heightPt: 300 },
    ]);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBe(400);
    expect(page.getHeight()).toBe(300);
  });

  it("creates a multi-page PDF in the given order, one page per frame, with per-page sizes", async () => {
    const bytes = await assemblePdfFromPngPages([
      { pngBytes: mockPngBytes(), widthPt: 100, heightPt: 200 },
      { pngBytes: mockPngBytes(), widthPt: 500, heightPt: 250 },
      { pngBytes: mockPngBytes(), widthPt: 50, heightPt: 50 },
    ]);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]).toEqual([100, 200]);
    expect([doc.getPage(1).getWidth(), doc.getPage(1).getHeight()]).toEqual([500, 250]);
    expect([doc.getPage(2).getWidth(), doc.getPage(2).getHeight()]).toEqual([50, 50]);
  });

  it("rejects an empty page list instead of producing a blank PDF", async () => {
    await expect(assemblePdfFromPngPages([])).rejects.toThrow();
  });
});
