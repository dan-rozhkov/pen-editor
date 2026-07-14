import type { RasterExportFormat } from "@/utils/exportUtils";

/** Formats offered by the page-level export (no SVG — vector export stays per-node in `ExportSettingsSection`). */
export type PageExportFormat = RasterExportFormat | "pdf";

/** Which exporter/result shape a page-export format maps to. */
export type PageExportKind = "pdf" | "raster";

/**
 * Pure format → exporter-kind decision, single source of truth for both the
 * dispatch branch (which exporter to call) and the result label ("PDF" vs
 * "ZIP") in `PageExportSection`, so the two can't silently diverge if a new
 * non-raster format is ever added.
 */
export function resolvePageExportKind(format: PageExportFormat): PageExportKind {
  return format === "pdf" ? "pdf" : "raster";
}

/** Human-readable label for the archive/document a format produces. */
export function pageExportResultLabel(format: PageExportFormat): string {
  return resolvePageExportKind(format) === "pdf" ? "PDF" : "ZIP";
}
