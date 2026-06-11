// Parsing of the Figma clipboard payload.
//
// When copying layers, Figma writes `text/html` containing two markers:
//   <span data-metadata="<!--(figmeta)BASE64(/figmeta)-->"></span>
//   <span data-buffer="<!--(figma)BASE64(/figma)-->"></span>
// The buffer is a "fig-kiwi" archive: an 8-byte prelude + uint32 version,
// followed by length-prefixed chunks. Chunk 0 is a binary kiwi schema and
// chunk 1 is a kiwi message encoded with that schema; both are compressed
// with raw deflate (older payloads) or zstd (newer payloads).
//
// Because the schema travels with the data, decoding stays compatible across
// Figma versions — we only depend on the field names we read (see figTypes).

import { compileSchema, decodeBinarySchema } from 'kiwi-schema'
import { inflateSync } from 'fflate'
import { decompress as zstdDecompress } from 'fzstd'
import { DATA_END, DATA_START, META_END, META_START } from './detect'
import type { FigClipboardMeta, FigMessage, FigPasteData } from './figTypes'

const FIG_KIWI_PRELUDE = 'fig-kiwi'
const FIG_JAM_PRELUDE = 'fig-jam.'

function extractBase64Section(html: string, start: string, end: string): string | null {
  const startIndex = html.indexOf(start)
  if (startIndex === -1) return null
  const endIndex = html.indexOf(end, startIndex + start.length)
  if (endIndex === -1) return null
  // The base64 payload may contain whitespace/newlines inserted by the clipboard
  return html.slice(startIndex + start.length, endIndex).replace(/\s+/g, '')
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

interface FigArchive {
  version: number
  chunks: Uint8Array[]
}

function parseFigArchive(bytes: Uint8Array): FigArchive {
  if (bytes.length < 12) {
    throw new Error('Figma clipboard payload is too short')
  }
  const prelude = String.fromCharCode(...bytes.slice(0, 8))
  if (prelude !== FIG_KIWI_PRELUDE && prelude !== FIG_JAM_PRELUDE) {
    throw new Error(`Unexpected Figma archive prelude: "${prelude}"`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(8, true)
  const chunks: Uint8Array[] = []
  let offset = 12
  while (offset + 4 <= bytes.length) {
    const chunkLength = view.getUint32(offset, true)
    offset += 4
    if (offset + chunkLength > bytes.length) break
    chunks.push(bytes.slice(offset, offset + chunkLength))
    offset += chunkLength
  }
  return { version, chunks }
}

function decompressChunk(chunk: Uint8Array): Uint8Array {
  try {
    return inflateSync(chunk)
  } catch (deflateError) {
    try {
      return zstdDecompress(chunk)
    } catch {
      throw deflateError
    }
  }
}

function parseMeta(html: string): FigClipboardMeta {
  const metaB64 = extractBase64Section(html, META_START, META_END)
  if (!metaB64) return {}
  try {
    const json = new TextDecoder().decode(base64ToBytes(metaB64))
    return JSON.parse(json) as FigClipboardMeta
  } catch {
    return {}
  }
}

/**
 * Decode a Figma clipboard `text/html` payload into the raw kiwi message
 * ({ nodeChanges, blobs }) plus clipboard metadata.
 * Throws if the payload is malformed.
 */
export function parseFigmaClipboardHtml(html: string): FigPasteData {
  const dataB64 = extractBase64Section(html, DATA_START, DATA_END)
  if (!dataB64) {
    throw new Error('No Figma data section in clipboard HTML')
  }
  const archive = parseFigArchive(base64ToBytes(dataB64))
  if (archive.chunks.length < 2) {
    throw new Error('Figma archive has fewer chunks than expected')
  }
  const encodedSchema = decompressChunk(archive.chunks[0])
  const encodedData = decompressChunk(archive.chunks[1])
  const schema = compileSchema(decodeBinarySchema(encodedSchema))
  const message = schema.decodeMessage(encodedData) as FigMessage
  return {
    meta: parseMeta(html),
    message,
    version: archive.version,
  }
}
