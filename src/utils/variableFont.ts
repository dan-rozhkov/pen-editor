/**
 * OpenType Variable Font support. The UI/render paths resolve axis ranges from
 * a static registry (`KNOWN_VARIABLE_FONT_AXES`) because Google's CDN doesn't
 * expose axis metadata over the CSS API and there's no font-upload feature yet.
 * `parseFvarAxes` is a dependency-free `fvar` table reader (the table layout is
 * a handful of fixed-width fields, well within hand-rolling) kept available for
 * when a raw font binary *is* on hand (uploads / a future fetch-and-inspect
 * path); the registry is the source of truth today.
 */

export interface FontAxis {
  /** 4-char OpenType axis tag, e.g. "wght", "wdth", "slnt", "opsz". */
  tag: string;
  /** Human-readable name for known axes (falls back to the raw tag). */
  name?: string;
  min: number;
  default: number;
  max: number;
}

/** Human-readable labels for the five registered axis tags (OpenType spec). */
export const AXIS_LABELS: Record<string, string> = {
  wght: "Weight",
  wdth: "Width",
  slnt: "Slant",
  ital: "Italic",
  opsz: "Optical Size",
};

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readInt16(view: DataView, offset: number): number {
  return view.getInt16(offset, false);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

/** Fixed 16.16 fixed-point → JS number, used for axis min/default/max values. */
function readFixed(view: DataView, offset: number): number {
  return readInt16(view, offset) + readUint16(view, offset + 2) / 65536;
}

function tagToString(view: DataView, offset: number): string {
  let tag = "";
  for (let i = 0; i < 4; i++) {
    tag += String.fromCharCode(view.getUint8(offset + i));
  }
  return tag;
}

/**
 * Parse the `fvar` table out of a raw sfnt (TTF/OTF) font binary and return
 * its registered axes. Returns `[]` if the binary has no `fvar` table (a
 * static font) or isn't a recognizable sfnt. Does not handle TTC font
 * collections (`ttcf`) — single-font binaries only, which covers every
 * variable font served by Google Fonts / typical uploads.
 */
export function parseFvarAxes(buffer: ArrayBuffer): FontAxis[] {
  if (buffer.byteLength < 12) return [];
  const view = new DataView(buffer);

  const sfntVersion = readUint32(view, 0);
  // 'true' (0x74727565), 0x00010000 (TTF), or 'OTTO' (OpenType/CFF).
  const isSfnt =
    sfntVersion === 0x00010000 || sfntVersion === 0x4f54544f || sfntVersion === 0x74727565;
  if (!isSfnt) return [];

  const numTables = readUint16(view, 4);
  let fvarOffset = -1;
  const tableDirStart = 12;
  for (let i = 0; i < numTables; i++) {
    const recordOffset = tableDirStart + i * 16;
    if (recordOffset + 16 > buffer.byteLength) break;
    const tag = tagToString(view, recordOffset);
    if (tag === "fvar") {
      fvarOffset = readUint32(view, recordOffset + 8);
      break;
    }
  }
  if (fvarOffset < 0 || fvarOffset + 16 > buffer.byteLength) return [];

  // fvar header: majorVersion(2) minorVersion(2) axesArrayOffset(2) reserved(2)
  // axisCount(2) axisSize(2) instanceCount(2) instanceSize(2)
  const axesArrayOffset = fvarOffset + readUint16(view, fvarOffset + 4);
  const axisCount = readUint16(view, fvarOffset + 8);
  const axisSize = readUint16(view, fvarOffset + 10) || 20;

  const axes: FontAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const axisOffset = axesArrayOffset + i * axisSize;
    if (axisOffset + 20 > buffer.byteLength) break;
    const tag = tagToString(view, axisOffset);
    const min = readFixed(view, axisOffset + 4);
    const def = readFixed(view, axisOffset + 8);
    const max = readFixed(view, axisOffset + 12);
    axes.push({ tag, name: AXIS_LABELS[tag], min, default: def, max });
  }
  return axes;
}

/**
 * Static fallback axis ranges for popular variable Google Fonts (all already
 * present in `GOOGLE_FONTS`). Values sourced from each family's published
 * `fvar` table. Used when we haven't (or can't) fetch+parse the actual font
 * binary — e.g. the UI slider bounds before the real file has loaded.
 */
export const KNOWN_VARIABLE_FONT_AXES: Record<string, FontAxis[]> = {
  Inter: [{ tag: "wght", name: AXIS_LABELS.wght, min: 100, default: 400, max: 900 }],
  "Inter Tight": [{ tag: "wght", name: AXIS_LABELS.wght, min: 100, default: 400, max: 900 }],
  "Roboto Flex": [
    { tag: "wght", name: AXIS_LABELS.wght, min: 100, default: 400, max: 1000 },
    { tag: "wdth", name: AXIS_LABELS.wdth, min: 25, default: 100, max: 151 },
    { tag: "opsz", name: AXIS_LABELS.opsz, min: 8, default: 14, max: 144 },
    { tag: "slnt", name: AXIS_LABELS.slnt, min: -10, default: 0, max: 0 },
  ],
  Recursive: [
    { tag: "wght", name: AXIS_LABELS.wght, min: 300, default: 400, max: 1000 },
    { tag: "slnt", name: AXIS_LABELS.slnt, min: -15, default: 0, max: 0 },
  ],
  Fraunces: [
    { tag: "wght", name: AXIS_LABELS.wght, min: 100, default: 400, max: 900 },
    { tag: "opsz", name: AXIS_LABELS.opsz, min: 9, default: 144, max: 144 },
    { tag: "slnt", name: AXIS_LABELS.slnt, min: -10, default: 0, max: 0 },
  ],
  "Source Sans 3": [{ tag: "wght", name: AXIS_LABELS.wght, min: 200, default: 400, max: 900 }],
  "Source Serif 4": [
    { tag: "wght", name: AXIS_LABELS.wght, min: 200, default: 400, max: 900 },
    { tag: "opsz", name: AXIS_LABELS.opsz, min: 8, default: 14, max: 60 },
  ],
  Newsreader: [
    { tag: "wght", name: AXIS_LABELS.wght, min: 200, default: 400, max: 800 },
    { tag: "opsz", name: AXIS_LABELS.opsz, min: 6, default: 16, max: 72 },
  ],
};

function normalizeFamily(family: string): string {
  const primary = family.split(",")[0]?.trim() ?? "";
  return primary.replace(/^["']|["']$/g, "");
}

/**
 * Known variable families that ship a true italic variable face on Google
 * Fonts (an `ital` axis), so the CSS2 request must include the roman+italic
 * tuple pair to load italic glyphs. Families whose only slant is a `slnt` axis
 * (Roboto Flex, Recursive) are intentionally excluded — requesting `ital` for
 * them would 400 the whole request and fail even the roman load.
 */
const VARIABLE_FONTS_WITH_ITALIC = new Set<string>([
  "Inter",
  "Inter Tight",
  "Source Sans 3",
  "Source Serif 4",
  "Newsreader",
]);

/** Whether `family` is a known variable font that has an italic variable face. */
export function hasItalicVariant(family: string | undefined): boolean {
  if (!family) return false;
  return VARIABLE_FONTS_WITH_ITALIC.has(normalizeFamily(family));
}

/**
 * The effective CSS font-weight for a text node: the `wght` variable-font axis
 * (when set) overrides the static `fontWeight`, clamped to the valid CSS
 * font-weight range [1, 1000] and guarded against NaN/Infinity so the value is
 * always a legal token — an out-of-range or non-finite `wght` would otherwise
 * produce an invalid canvas font string that the 2D context silently rejects.
 * Shared by the Pixi renderer and the text-measurement path so wrapping/
 * auto-size and rendering agree on the weight.
 */
export function resolveEffectiveFontWeight(
  fontVariations: Record<string, number> | undefined,
  staticWeight: string | number | undefined,
): string {
  const wght = fontVariations?.wght;
  if (typeof wght === "number" && Number.isFinite(wght)) {
    return String(Math.min(1000, Math.max(1, Math.round(wght))));
  }
  return staticWeight != null ? String(staticWeight) : "normal";
}

/** Registered variable-font axes for `family`, or `undefined` if it's not known to be variable. */
export function getVariableFontAxes(family: string | undefined): FontAxis[] | undefined {
  if (!family) return undefined;
  return KNOWN_VARIABLE_FONT_AXES[normalizeFamily(family)];
}

export function isVariableFont(family: string | undefined): boolean {
  return getVariableFontAxes(family) !== undefined;
}

/** Clamp `value` to the axis's [min, max] range. */
export function clampToAxis(axis: FontAxis, value: number): number {
  return Math.min(axis.max, Math.max(axis.min, value));
}

/**
 * Build the CSS `font-variation-settings` value from a node's axis map, e.g.
 * `{ wght: 530, opsz: 24 }` -> `"wght" 530, "opsz" 24`. Returns `undefined`
 * when there are no axis values to express (so callers can omit the property
 * entirely rather than emitting `font-variation-settings: normal`).
 */
export function toFontVariationSettingsCss(
  variations: Record<string, number> | undefined,
): string | undefined {
  if (!variations) return undefined;
  const entries = Object.entries(variations).filter(([, v]) => typeof v === "number" && !Number.isNaN(v));
  if (entries.length === 0) return undefined;
  return entries.map(([tag, value]) => `"${tag}" ${value}`).join(", ");
}
