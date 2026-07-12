// Parsing of the html.to.design / Figma-capture ("h2d") clipboard payload.
//
// capture.js writes `text/html` containing two markers:
//   <span data-metadata="<!--(figmeta)BASE64(/figmeta)-->"></span>
//   <span data-h2d="<!--(figh2d)BASE64(/figh2d)-->"></span>
// Unlike Figma's own clipboard buffer (fig-kiwi, see ../figmaPaste), the h2d
// payload is plain, uncompressed JSON — no schema, no deflate/zstd.

import { base64ToBytes, extractBase64Section } from '@/lib/clipboardPayload'
import { H2D_DATA_END, H2D_DATA_START, H2D_META_END, H2D_META_START } from './detect'
import type { H2dClipboardMeta, H2dDocument } from './h2dTypes'

/**
 * The payload was produced by base64-encoding `TextEncoder().encode(JSON)`
 * bytes, so it must be decoded as bytes → UTF-8 text, not as a plain `atob`
 * string (which mangles any non-ASCII character in the JSON).
 */
function base64ToUtf8(base64: string): string {
  return new TextDecoder('utf-8').decode(base64ToBytes(base64))
}

function parseMeta(html: string): H2dClipboardMeta {
  const metaB64 = extractBase64Section(html, H2D_META_START, H2D_META_END)
  if (!metaB64) return {}
  try {
    return JSON.parse(base64ToUtf8(metaB64)) as H2dClipboardMeta
  } catch {
    return {}
  }
}

/**
 * Decode an h2d clipboard `text/html` payload into its document JSON plus
 * clipboard metadata. Throws a descriptive error if the payload is missing
 * or malformed.
 */
export function parseH2dClipboardHtml(html: string): { document: H2dDocument; meta: H2dClipboardMeta } {
  const dataB64 = extractBase64Section(html, H2D_DATA_START, H2D_DATA_END)
  if (!dataB64) {
    throw new Error('No h2d data section in clipboard HTML')
  }

  let json: string
  try {
    json = base64ToUtf8(dataB64)
  } catch (error) {
    throw new Error(`h2d clipboard payload is not valid base64: ${(error as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`h2d clipboard payload is not valid JSON: ${(error as Error).message}`)
  }

  const document = parsed as H2dDocument
  if (!document || typeof document !== 'object' || !document.root) {
    throw new Error('h2d clipboard payload is missing a "root" node')
  }

  return { document, meta: parseMeta(html) }
}
