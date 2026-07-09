/**
 * Registers a custom font's binary with the browser so text using its family
 * renders with the real glyphs (not a fallback). Not unit-testable — real
 * FontFace parsing needs a browser (like `get_screenshot`/the shader bake).
 * Callers must catch: `FontFace#load()` rejects on a corrupt/unparsable file.
 *
 * We keep a reference to every FontFace WE added, keyed by family, so that
 * `unregisterFontFace` deletes exactly our face and never a same-named face
 * the browser reflected in from a `<link>`/CSS load (e.g. a real Google Font).
 * The map also makes re-registration idempotent — a second call for the same
 * family (React StrictMode double-mount, a restore racing an upload) replaces
 * the prior face instead of piling up duplicates in `document.fonts`.
 */
const registeredFaces = new Map<string, FontFace>();

export async function registerFontFace(family: string, bytes: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, bytes);
  await face.load();
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const key = family.toLowerCase();
  const previous = registeredFaces.get(key);
  if (previous) document.fonts.delete(previous);
  document.fonts.add(face);
  registeredFaces.set(key, face);
}

/** Removes the FontFace this module registered under `family` (and only that one). */
export function unregisterFontFace(family: string): void {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const key = family.toLowerCase();
  const face = registeredFaces.get(key);
  if (face) {
    document.fonts.delete(face);
    registeredFaces.delete(key);
  }
}
