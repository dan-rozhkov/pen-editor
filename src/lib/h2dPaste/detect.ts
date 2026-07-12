// Cheap detection of the html.to.design / Figma-capture ("h2d") clipboard
// payload. Kept free of heavy imports: the JSON payload can be large, so the
// parser is loaded on demand only when an h2d paste actually happens (see
// index.ts).

export const H2D_META_START = '<!--(figmeta)'
export const H2D_META_END = '(/figmeta)-->'
export const H2D_DATA_START = '<!--(figh2d)'
export const H2D_DATA_END = '(/figh2d)-->'

const H2D_ESCAPED_DATA_START = H2D_DATA_START.replace('<', '&lt;')
const H2D_ESCAPED_DATA_END = H2D_DATA_END.replace('>', '&gt;')

/** Quick check: does this `text/html` clipboard payload carry an h2d capture? */
export function isH2dClipboardHtml(html: string): boolean {
  return (
    (html.includes(H2D_DATA_START) && html.includes(H2D_DATA_END)) ||
    (html.includes(H2D_ESCAPED_DATA_START) && html.includes(H2D_ESCAPED_DATA_END))
  )
}
