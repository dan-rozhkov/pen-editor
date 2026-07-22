// Pixso's clipboard payloads are kiwi messages encoded with Pixso's OWN schema,
// fetched by the live app from https://cdn.pixso.net/app/pixso.binary and bundled
// here (base64) so paste works offline and deterministically.
//
// Quirk: Pixso's kiwi encoder has one extra builtin type, so kiwi-schema's
// decodeBinarySchema resolves every user-defined field type off by +1. We remap
// each message field's type name by that offset before compiling. The offset is
// derived from a known anchor (PixsoMsg.pixsoNodes must be PixsoNode) so it
// self-corrects if Pixso bumps its kiwi version.

import pixsoSchemaB64 from './pixso.kiwi.b64?raw'

export interface PixsoMessage {
  type?: string
  sessionID?: number
  pixsoNodes?: Record<string, unknown>[]
  blobs?: { bytes: Uint8Array }[]
  blobBaseIndex?: number
  pasteFileKey?: string
}

// kiwi-schema's compiled schema shape (decodeMessage-per-type). We only call
// decodePixsoMsg; type it loosely to avoid depending on kiwi-schema's types.
type CompiledSchema = { decodePixsoMsg(bytes: Uint8Array): PixsoMessage }

const BUILTIN_TYPES = new Set(['bool', 'byte', 'int', 'uint', 'float', 'string', 'int64', 'uint64'])

let cached: Promise<CompiledSchema> | null = null

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function build(): Promise<CompiledSchema> {
  const { decodeBinarySchema, compileSchema } = await import('kiwi-schema')
  const schema = decodeBinarySchema(b64ToBytes(pixsoSchemaB64))
  const defs = schema.definitions as { name: string; fields?: { name: string; type: string | null }[] }[]
  const nameToIdx = new Map(defs.map((d, i) => [d.name, i]))
  const anchorFrom = nameToIdx.get('DynamicStrokeSettings')
  const anchorTo = nameToIdx.get('PixsoNode')
  const offset = anchorFrom != null && anchorTo != null ? anchorTo - anchorFrom : 1
  for (const d of defs) {
    for (const f of d.fields ?? []) {
      if (f.type == null || BUILTIN_TYPES.has(f.type)) continue
      const idx = nameToIdx.get(f.type)
      if (idx == null) continue
      const remapped = idx + offset
      if (remapped >= 0 && remapped < defs.length) f.type = defs[remapped].name
    }
  }
  return compileSchema(schema) as unknown as CompiledSchema
}

export function getPixsoSchema(): Promise<CompiledSchema> {
  if (!cached) cached = build()
  return cached
}

export async function decodePixsoMsg(bytes: Uint8Array): Promise<PixsoMessage> {
  return (await getPixsoSchema()).decodePixsoMsg(bytes)
}
