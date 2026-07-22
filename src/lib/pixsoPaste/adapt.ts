// Pixso's PixsoNode is field-for-field a Figma FigNodeChange for everything the
// converter reads, and its enum values are the same strings (RECTANGLE, FRAME,
// TEXT, SOLID, IMAGE, …). Three normalizations make a decoded PixsoMessage
// consumable by convertFigmaPasteToSceneNodes unchanged:
//   1. pixsoNodes  -> nodeChanges
//   2. colors 0..255 -> 0..1  (Figma's colorToHex expects [0,1])
//   3. Pixso's auto-layout child field names -> the Figma field names the
//      converter reads (see remapAutoLayoutFields below)

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

// Pixso's auto-layout *child* fields differ from the Figma field names the
// shared converter (`figmaToScene/autoLayout.ts`) reads. Mapping is 1:1 by
// field, applied wherever the Pixso field turns up: on master/symbol nodes,
// instance nodes, and nested `derivedSymbolData`/`symbolData.symbolOverrides`
// entries (all of which are just more FigNodeChange-shaped objects). See the
// design spec for the empirical basis of each mapping.
interface AutoLayoutFieldMap {
  pixsoKey: string
  figKey: string
  // Returns the Figma-field value to set, or undefined to skip (Pixso field
  // present but not in the mapped state, e.g. a StackSize other than
  // RESIZE_TO_FIT — nothing to derive).
  map: (pixsoValue: unknown) => unknown
}

const AUTO_LAYOUT_FIELD_MAP: AutoLayoutFieldMap[] = [
  {
    pixsoKey: 'autoLayoutAbsolutePos',
    figKey: 'stackPositioning',
    map: (v) => (v === true ? 'ABSOLUTE' : undefined),
  },
  // NB: there is deliberately NO stackChildPrimarySizing → stackChildPrimaryGrow
  // mapping. Empirically (design spec), a child's StackSize on the PRIMARY axis
  // means FIXED = keep size, RESIZE_TO_FIT = HUG its own content — NOT fill. A
  // hugging child already renders at its authored content size (and, if it is
  // itself an auto-layout container or text, `hugSizing` recomputes it), so
  // there is nothing to map. Mapping RESIZE_TO_FIT to grow=1 wrongly stretched
  // every such child to fill the parent's primary axis, collapsing stacked rows
  // on top of each other.
  {
    pixsoKey: 'stackChildCounterSizing',
    figKey: 'stackChildAlignSelf',
    map: (v) => (v === 'RESIZE_TO_FIT' ? 'STRETCH' : undefined),
  },
  {
    pixsoKey: 'stackPaddingTop',
    figKey: 'stackVerticalPadding',
    map: (v) => v,
  },
  {
    pixsoKey: 'stackPaddingLeft',
    figKey: 'stackHorizontalPadding',
    map: (v) => v,
  },
]

// Deep-walk, remapping known Pixso auto-layout field names to their Figma
// equivalents in place wherever they appear. Never overwrites a Figma field
// that already holds a meaningful (non-null) value — only derives from the
// Pixso field when present. Guarded against cycles like scaleColors.
function remapAutoLayoutFields(value: unknown, seen: WeakSet<object>): void {
  if (value == null || typeof value !== 'object') return
  if (seen.has(value as object)) return
  seen.add(value as object)
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const { pixsoKey, figKey, map } of AUTO_LAYOUT_FIELD_MAP) {
      const raw = record[pixsoKey]
      if (raw == null) continue
      if (record[figKey] != null) continue
      const mapped = map(raw)
      if (mapped === undefined) continue
      record[figKey] = mapped
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) remapAutoLayoutFields(item, seen)
  } else {
    for (const key of Object.keys(value)) {
      remapAutoLayoutFields((value as Record<string, unknown>)[key], seen)
    }
  }
}

export function pixsoMessageToFigPasteData(msg: PixsoMessage): FigPasteData {
  const nodeChanges = (msg.pixsoNodes ?? []) as unknown as FigNodeChange[]
  const seen = new WeakSet<object>()
  for (const change of nodeChanges) scaleColors(change, seen)
  const layoutSeen = new WeakSet<object>()
  for (const change of nodeChanges) remapAutoLayoutFields(change, layoutSeen)
  const message: FigMessage = {
    type: msg.type,
    nodeChanges,
    blobs: msg.blobs,
    blobBaseIndex: msg.blobBaseIndex,
  }
  return { meta: {}, message, version: 0 }
}
