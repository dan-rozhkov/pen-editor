// Paste-from-Figma support: detect the Figma clipboard payload in text/html,
// decode the embedded fig-kiwi archive and convert it into native scene nodes.

import { convertFigmaPasteToSceneNodes, type FigmaConversionResult } from './figmaToScene'
import { isFigmaClipboardHtml, parseFigmaClipboardHtml } from './parseFigmaClipboard'

export { isFigmaClipboardHtml, parseFigmaClipboardHtml }
export { convertFigmaPasteToSceneNodes }
export type { FigmaConversionResult }

/**
 * Full pipeline: Figma clipboard `text/html` → native SceneNodes.
 * Returns null when the payload is not from Figma; throws on malformed data.
 */
export function convertFigmaClipboardHtml(html: string): FigmaConversionResult | null {
  if (!isFigmaClipboardHtml(html)) return null
  const parsed = parseFigmaClipboardHtml(html)
  return convertFigmaPasteToSceneNodes(parsed)
}
