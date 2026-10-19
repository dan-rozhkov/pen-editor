// Notion's colour names for text and background. A document stores the NAME
// (`<span data-color="red" data-bg="yellow">`), never a hex value, so both
// themes can map it to their own shade (docProse.css).

export const DOC_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

export type DocColor = (typeof DOC_COLORS)[number];

export function isDocColor(value: unknown): value is DocColor {
  return typeof value === "string" && (DOC_COLORS as readonly string[]).includes(value);
}
