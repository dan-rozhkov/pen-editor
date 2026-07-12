// Paste-from-h2d support (html.to.design / Figma-capture clipboard payloads):
// detect the marker in `text/html`, decode the embedded JSON document and
// convert it into native scene nodes.

import { isH2dClipboardHtml } from './detect'
import type { H2dConversionResult } from './h2dToScene'

export { isH2dClipboardHtml }
export type { H2dConversionResult }

/**
 * Full pipeline: h2d clipboard `text/html` → native SceneNodes.
 * Returns null when the payload isn't an h2d capture; throws on malformed data.
 * The parser/converter are dynamically imported so they stay out of the main
 * bundle until the first h2d paste.
 */
export async function convertH2dClipboardHtml(html: string): Promise<H2dConversionResult | null> {
  if (!isH2dClipboardHtml(html)) return null
  const [{ parseH2dClipboardHtml }, { convertH2dToSceneNodes }] = await Promise.all([
    import('./parseH2dClipboard'),
    import('./h2dToScene'),
  ])
  const { document } = parseH2dClipboardHtml(html)
  return convertH2dToSceneNodes(document)
}
