// Pixso's PixsoNode is field-for-field a Figma FigNodeChange for everything the
// converter reads, and its enum values are the same strings (RECTANGLE, FRAME,
// TEXT, SOLID, IMAGE, …). Two normalizations make a decoded PixsoMessage
// consumable by convertFigmaPasteToSceneNodes unchanged:
//   1. pixsoNodes  -> nodeChanges
//   2. colors 0..255 -> 0..1  (Figma's colorToHex expects [0,1])

import type { FigMessage, FigNodeChange, FigPasteData } from '@/lib/figmaPaste/figTypes'
import type { PixsoMessage } from './schema'

function isColor(v: unknown): v is { r: number; g: number; b: number; a?: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { r?: unknown }).r === 'number' &&
    typeof (v as { g?: unknown }).g === 'number' &&
    typeof (v as { b?: unknown }).b === 'number'
  )
}

// Deep-walk, scaling any {r,g,b(,a)} color object from 0..255 to 0..1 in place.
// Guarded against cycles; re-scaling an already-normalized color is not a
// concern here since Pixso emits 0..255 uniformly for a fresh decode.
function scaleColors(value: unknown, seen: WeakSet<object>): void {
  if (value == null || typeof value !== 'object') return
  if (seen.has(value as object)) return
  seen.add(value as object)
  if (isColor(value)) {
    value.r /= 255
    value.g /= 255
    value.b /= 255
    if (typeof value.a === 'number') value.a /= 255
  }
  if (Array.isArray(value)) {
    for (const item of value) scaleColors(item, seen)
  } else {
    for (const key of Object.keys(value)) scaleColors((value as Record<string, unknown>)[key], seen)
  }
}

export function pixsoMessageToFigPasteData(msg: PixsoMessage): FigPasteData {
  const nodeChanges = (msg.pixsoNodes ?? []) as unknown as FigNodeChange[]
  const seen = new WeakSet<object>()
  for (const change of nodeChanges) scaleColors(change, seen)
  const message: FigMessage = {
    type: msg.type,
    nodeChanges,
    blobs: msg.blobs,
    blobBaseIndex: msg.blobBaseIndex,
  }
  return { meta: {}, message, version: 0 }
}
