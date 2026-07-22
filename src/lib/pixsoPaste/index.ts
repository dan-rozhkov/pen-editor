// Paste-from-Pixso: detect the Pixso clipboard payload in text/html, decode the
// kiwi message, normalize it to Figma's shape and reuse the Figma converter.

import { isPixsoClipboardHtml } from './detect'
import type { FigmaConversionResult } from '@/lib/figmaPaste/figmaToScene'

export { isPixsoClipboardHtml }

/**
 * Full pipeline: Pixso clipboard `text/html` → native SceneNodes.
 * Returns null when the payload is not from Pixso (or has no data-fic); throws
 * on malformed data. Heavy deps load on demand so they stay out of the main
 * bundle until the first Pixso paste.
 */
export async function convertPixsoClipboardHtml(html: string): Promise<FigmaConversionResult | null> {
  if (!isPixsoClipboardHtml(html)) return null
  const { extractPixsoDataFic } = await import('./extract')
  const base64 = extractPixsoDataFic(html)
  if (!base64) return null
  const [{ decodePixsoDataFic }, { pixsoMessageToFigPasteData }, { convertFigmaPasteToSceneNodes }] =
    await Promise.all([import('./decode'), import('./adapt'), import('@/lib/figmaPaste/figmaToScene')])
  const message = await decodePixsoDataFic(base64)
  return convertFigmaPasteToSceneNodes(pixsoMessageToFigPasteData(message))
}
