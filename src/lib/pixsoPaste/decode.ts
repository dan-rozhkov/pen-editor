// data-fic base64 → decompressed kiwi bytes → decoded PixsoMessage.
//
// Wire format of the pre-zstd header (confirmed against real captures — NOT
// what an early draft of the design spec guessed):
//   "pixso-kw"          8 raw ASCII bytes, no length prefix (fixed magic)
//   <2 bytes>           unknown/version pair, currently always 00 02
//   <len:1><token>      length-prefixed ASCII token, e.g. "compress:zstd"
//   <zstd frame...>     everything after the compress token
// We parse the compress token by its length prefix (rather than hard-coding
// an offset) so a future version/algo string still works; the fixed 8+2
// prefix before it is a stable anchor confirmed across all 3 captured
// fixtures (rect/frame/text).

import { decompress as zstdDecompress } from 'fzstd'
import { decodePixsoMsg, type PixsoMessage } from './schema'

const MAGIC = 'pixso-kw'
const VERSION_BYTES = 2

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i])
  return s
}

/** Validate the pixso-kw header, skip it, and zstd-decompress the payload. */
export function decompressPixsoDataFic(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes, 0, MAGIC.length) !== MAGIC) {
    throw new Error('Not a Pixso clipboard payload (missing pixso-kw magic)')
  }
  let pos = MAGIC.length + VERSION_BYTES
  const len = bytes[pos++]
  const token = ascii(bytes, pos, len)
  pos += len
  if (!token.startsWith('compress:')) {
    throw new Error('Pixso payload header missing compress token')
  }
  const algo = token.slice('compress:'.length)
  if (algo !== 'zstd') throw new Error(`Unsupported Pixso compression: ${algo}`)
  return zstdDecompress(bytes.subarray(pos))
}

export async function decodePixsoDataFic(base64: string): Promise<PixsoMessage> {
  return decodePixsoMsg(decompressPixsoDataFic(base64ToBytes(base64)))
}
