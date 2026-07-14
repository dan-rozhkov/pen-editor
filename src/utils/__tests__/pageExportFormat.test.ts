import { describe, it, expect } from "vitest";
import { resolvePageExportKind, pageExportResultLabel, type PageExportFormat } from "@/utils/pageExportFormat";

describe("resolvePageExportKind / pageExportResultLabel", () => {
  const cases: Array<{ format: PageExportFormat; kind: "pdf" | "raster"; label: string }> = [
    { format: "png", kind: "raster", label: "ZIP" },
    { format: "jpg", kind: "raster", label: "ZIP" },
    { format: "webp", kind: "raster", label: "ZIP" },
    { format: "pdf", kind: "pdf", label: "PDF" },
  ];

  it.each(cases)("maps $format to kind=$kind, label=$label", ({ format, kind, label }) => {
    expect(resolvePageExportKind(format)).toBe(kind);
    expect(pageExportResultLabel(format)).toBe(label);
  });

  it("derives dispatch and label from the same predicate so they can't diverge", () => {
    for (const { format } of cases) {
      const isPdf = resolvePageExportKind(format) === "pdf";
      expect(pageExportResultLabel(format)).toBe(isPdf ? "PDF" : "ZIP");
    }
  });
});
