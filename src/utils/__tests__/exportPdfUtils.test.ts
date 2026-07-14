import { describe, it, expect } from "vitest";
import { resolvePdfDownloadFilename } from "@/utils/exportPdfUtils";
import type { PdfFrameDescriptor } from "@/utils/exportUtils";

describe("resolvePdfDownloadFilename", () => {
  const frames: PdfFrameDescriptor[] = [{ id: "f1", name: "Icon", width: 10, height: 10 }];

  it("uses the provided final filename verbatim, keeping the @Nx scale label", () => {
    // Regression: the PDF runner used to strip .pdf then re-sanitize, turning
    // "Icon@2x.pdf" into "Icon_2x.pdf" and diverging from the reported filename.
    expect(resolvePdfDownloadFilename("Icon@2x.pdf", frames)).toBe("Icon@2x.pdf");
    expect(resolvePdfDownloadFilename("Icon@2x.pdf", frames)).toContain("@2x");
  });

  it("derives a safe single-frame name when no filename is given", () => {
    expect(resolvePdfDownloadFilename(undefined, frames)).toBe("Icon.pdf");
  });

  it("falls back to canvas.pdf for a multi-frame export with no filename", () => {
    const multi: PdfFrameDescriptor[] = [
      { id: "f1", name: "A", width: 10, height: 10 },
      { id: "f2", name: "B", width: 10, height: 10 },
    ];
    expect(resolvePdfDownloadFilename(undefined, multi)).toBe("canvas.pdf");
  });

  it("sanitizes the derived single-frame name", () => {
    const messy: PdfFrameDescriptor[] = [{ id: "f1", name: "My Frame / v2", width: 10, height: 10 }];
    expect(resolvePdfDownloadFilename(undefined, messy)).toBe("My_Frame___v2.pdf");
  });
});
