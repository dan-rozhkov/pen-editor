// Paste-from-Figma support: detect the Figma clipboard payload in text/html,
// decode the embedded fig-kiwi archive and convert it into native scene nodes.

import { isFigmaClipboardHtml } from './detect'
import type { FigmaConversionResult } from './figmaToScene'

export { isFigmaClipboardHtml }
export type { FigmaConversionResult }

/**
 * Full pipeline: Figma clipboard `text/html` → native SceneNodes.
 * Returns null when the payload is not from Figma; throws on malformed data.
 * The decoder and its dependencies are dynamically imported so they stay out
 * of the main bundle until the first Figma paste.
 */
export async function convertFigmaClipboardHtml(html: string): Promise<FigmaConversionResult | null> {
  if (!isFigmaClipboardHtml(html)) return null
  const [{ parseFigmaClipboardHtml }, { convertFigmaPasteToSceneNodes }] = await Promise.all([
    import('./parseFigmaClipboard'),
    import('./figmaToScene'),
  ])
  return convertFigmaPasteToSceneNodes(parseFigmaClipboardHtml(html))
}
