// Cheap detection of the Figma clipboard payload. Kept free of heavy imports:
// the decoder (kiwi-schema, fflate, fzstd) is loaded on demand only when a
// Figma paste actually happens (see index.ts).

export const META_START = '<!--(figmeta)'
export const META_END = '(/figmeta)-->'
export const DATA_START = '<!--(figma)'
export const DATA_END = '(/figma)-->'

/** Quick check: does this `text/html` clipboard payload come from Figma? */
export function isFigmaClipboardHtml(html: string): boolean {
  return html.includes(DATA_START) && html.includes(DATA_END)
}
