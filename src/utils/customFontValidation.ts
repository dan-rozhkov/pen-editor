/** Extensions accepted for custom font uploads (checked case-insensitively). */
export const ACCEPTED_FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

export type FontFormat = "ttf" | "otf" | "woff" | "woff2";

const EXTENSION_TO_FORMAT: Record<string, FontFormat> = {
  ".ttf": "ttf",
  ".otf": "otf",
  ".woff": "woff",
  ".woff2": "woff2",
};

/** Defensive ceiling so a mis-selected file can't blow up IndexedDB storage. */
const MAX_FONT_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

export interface CustomFontValidationOk {
  ok: true;
  format: FontFormat;
  /** Family name derived from the file name; used to register + display the font. */
  family: string;
}

export interface CustomFontValidationError {
  ok: false;
  error: string;
}

export type CustomFontValidationResult = CustomFontValidationOk | CustomFontValidationError;

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1) return "";
  return fileName.slice(idx).toLowerCase();
}

export function getFontFormatFromFileName(fileName: string): FontFormat | null {
  const ext = getExtension(fileName);
  return EXTENSION_TO_FORMAT[ext] ?? null;
}

/** Derive a human-readable family name from an uploaded file's name. */
export function deriveFontFamilyName(fileName: string): string {
  const ext = getExtension(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const cleaned = base
    .replace(/[_-]+/g, " ")
    // Strip characters that break CSS font-family matching: commas split a
    // family list (so "Foo,Bar" would be truncated to "Foo" when applied) and
    // quotes are the family-name delimiters.
    .replace(/["',]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Custom Font";
}

export function isDuplicateFamily(family: string, existingFamilies: string[]): boolean {
  const normalized = family.trim().toLowerCase();
  return existingFamilies.some((f) => f.trim().toLowerCase() === normalized);
}

/**
 * Validate an uploaded font file before it's registered with the browser.
 * `existingFamilies` should be every family name already uploaded, so a
 * re-upload with a colliding name is rejected with a clear error instead of
 * silently overwriting the earlier font. `reservedFamilies` should be every
 * built-in/system/Google family the picker already offers: registering a
 * `FontFace` under one of those names would hijack that font everywhere it's
 * used (CSS matching is case-insensitive and an author FontFace wins), so a
 * collision is rejected rather than silently shadowing the real font.
 */
export function validateCustomFontFile(
  file: { name: string; size: number },
  existingFamilies: string[],
  reservedFamilies: string[] = [],
): CustomFontValidationResult {
  const format = getFontFormatFromFileName(file.name);
  if (!format) {
    return {
      ok: false,
      error: `Unsupported font file "${file.name}" — accepted formats are ${ACCEPTED_FONT_EXTENSIONS.join(", ")}.`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: `"${file.name}" is empty and can't be used as a font.` };
  }
  if (file.size > MAX_FONT_FILE_SIZE_BYTES) {
    return { ok: false, error: `"${file.name}" is too large (max 20MB).` };
  }

  const family = deriveFontFamilyName(file.name);
  if (isDuplicateFamily(family, existingFamilies)) {
    return { ok: false, error: `A font named "${family}" is already uploaded.` };
  }
  if (isDuplicateFamily(family, reservedFamilies)) {
    return {
      ok: false,
      error: `"${family}" matches a built-in font — rename the file to a distinct family name before uploading.`,
    };
  }

  return { ok: true, format, family };
}
