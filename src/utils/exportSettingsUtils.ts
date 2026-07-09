import type { ExportSetting, ExportSettingFormat } from "@/types/scene";
import { generateId } from "@/types/scene";

/** File extension for a given export format (jpg stays "jpg", not "jpeg"). */
export function getExportSettingExtension(format: ExportSettingFormat): string {
  return format;
}

/** MIME type for a given export format, used when encoding raster canvases. */
export function getExportSettingMimeType(format: ExportSettingFormat): string {
  switch (format) {
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "png":
    default:
      return "image/png";
  }
}

/** Whether a format is rasterized via the Pixi canvas (as opposed to vector/paged). */
export function isRasterExportFormat(format: ExportSettingFormat): boolean {
  return format === "png" || format === "jpg" || format === "webp";
}

/** Create a new export setting with sensible defaults, assigning a fresh id. */
export function createExportSetting(
  overrides: Partial<Omit<ExportSetting, "id">> = {},
): ExportSetting {
  return {
    id: generateId(),
    format: overrides.format ?? "png",
    scale: overrides.scale ?? 1,
    suffix: overrides.suffix,
    quality: overrides.quality,
  };
}

/**
 * Sanitize a base filename the same way existing exporters do (alnum/_/- only).
 * Shared choke point reused by the raster/SVG/PDF exporters so the allowed
 * charset lives in exactly one place.
 */
export function sanitizeExportBaseName(baseName: string): string {
  return baseName.replace(/[^a-zA-Z0-9_-]/g, "_") || "canvas";
}

/**
 * Sanitize a user-supplied filename suffix. The suffix is spliced into the
 * download filename (from both the inspector UI and the `set_export_settings`
 * AI tool, neither of which restricts the charset), so any path separator or
 * traversal sequence here would corrupt the filename/path. Allows the base
 * charset plus `@` (so the documented `@2x`-style suffixes survive) and drops
 * everything else — critically `/`, `\`, `.` and whitespace — to `_`.
 */
export function sanitizeExportSuffix(suffix: string): string {
  return suffix.replace(/[^a-zA-Z0-9_@-]/g, "_");
}

/**
 * Format a scale multiplier for filenames/labels, dropping a trailing ".0"
 * (e.g. 2 -> "2", 1.5 -> "1.5", 0.5 -> "0.5").
 */
export function formatScaleLabel(scale: number): string {
  return String(Math.round(scale * 100) / 100);
}

/**
 * Build the export filename for a single setting: sanitized base name, then
 * the sanitized suffix (if any), then an auto `@Nx` scale label when the
 * scale isn't 1x, then the format's extension. The suffix lets users encode
 * their own convention (`@2x`, `_dark`, ...) but is sanitized (see
 * `sanitizeExportSuffix`) so it can't inject path separators; the scale
 * label is appended separately so "Export all" output is unambiguous even
 * when no suffix is set.
 */
export function buildExportFilename(baseName: string, setting: Pick<ExportSetting, "format" | "scale" | "suffix">): string {
  const sanitized = sanitizeExportBaseName(baseName);
  const suffix = setting.suffix ? sanitizeExportSuffix(setting.suffix) : "";
  const scaleLabel = setting.scale !== 1 ? `@${formatScaleLabel(setting.scale)}x` : "";
  const ext = getExportSettingExtension(setting.format);
  return `${sanitized}${suffix}${scaleLabel}.${ext}`;
}

/** Compute the output pixel dimensions for a node exported at a given scale. */
export function computeExportSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  return { width: width * scale, height: height * scale };
}

/** Add a new export setting to a node's list (returns a new array, immutable). */
export function addExportSetting(
  existing: ExportSetting[] | undefined,
  setting: ExportSetting,
): ExportSetting[] {
  return [...(existing ?? []), setting];
}

/** Remove an export setting by id (returns a new array, immutable). */
export function removeExportSetting(
  existing: ExportSetting[] | undefined,
  id: string,
): ExportSetting[] {
  return (existing ?? []).filter((s) => s.id !== id);
}

/** Replace one export setting's fields by id (returns a new array, immutable). */
export function updateExportSetting(
  existing: ExportSetting[] | undefined,
  id: string,
  updates: Partial<Omit<ExportSetting, "id">>,
): ExportSetting[] {
  return (existing ?? []).map((s) => (s.id === id ? { ...s, ...updates } : s));
}
