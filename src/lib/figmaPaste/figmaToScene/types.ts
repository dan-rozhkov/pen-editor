// Internal types shared across the Figma → SceneNode conversion modules.

import type {
  Effect,
  GradientFill,
  ImageFill,
  Paint,
  PerSideStroke,
  SceneNode,
  ShadowEffect,
} from '@/types/scene'
import type { FigBlob, FigNodeChange } from '../figTypes'
import type { ComponentPropMap } from './componentProps'

export interface FigmaConversionResult {
  nodes: SceneNode[]
  warnings: string[]
  /**
   * Number of IMAGE fills that referenced pixels not present in the clipboard
   * (hash-only, no embedded bytes). Figma's cross-document clipboard omits image
   * pixels for a plain copy, so these degrade to a gray placeholder. The paste
   * handler uses this to fall back to a flattened `image/png` clipboard raster
   * or surface an actionable message. See `paints.ts` `convertImagePaint`.
   */
  unresolvedImageCount: number
}

export interface FigTreeNode {
  change: FigNodeChange
  children: FigTreeNode[]
}

export interface InstanceContext {
  overrides: Map<string, FigNodeChange>
  path: string[]
}

export interface ConvertContext {
  /**
   * Resolve a blob reference (image.dataBlob, commandsBlob, vectorNetworkBlob)
   * to its bytes. Clipboard payloads ship only a slice of the document's blob
   * table, so references are absolute indices offset by `message.blobBaseIndex`
   * (blobs[ref - blobBaseIndex]). This is the ONLY correct way to read a blob —
   * indexing the raw array directly drops data on any partial copy.
   */
  resolveBlob: (index: number | undefined) => FigBlob | undefined
  byGuid: Map<string, FigTreeNode>
  warnings: string[]
  /** Mutable counters shared across the recursive conversion (incl. instances). */
  stats: { unresolvedImages: number }
  instance?: InstanceContext
  /**
   * defID -> value map supplied by the innermost enclosing component
   * instance (merged with any outer instance's map). Absent outside of an
   * instance subtree, so `resolveComponentProps` is a no-op at the top
   * level and for plain Figma paste payloads that never set this.
   */
  componentProps?: ComponentPropMap
}

export type MutableBase = {
  id: string
  name?: string
  x: number
  y: number
  width: number
  height: number
  visible?: boolean
  opacity?: number
  rotation?: number
  fill?: string
  fillOpacity?: number
  gradientFill?: GradientFill
  imageFill?: ImageFill
  // Figma-style paint stack — set instead of the legacy single fields above
  // when the node carries more than one visible fill.
  fills?: Paint[]
  stroke?: string
  strokeOpacity?: number
  // Figma-style stroke paint stack — set instead of the legacy single fields
  // above when the node carries more than one visible stroke paint, or a
  // gradient stroke paint (which the legacy fields can't represent at all).
  strokes?: Paint[]
  strokeWidth?: number
  strokeWidthPerSide?: PerSideStroke
  strokeAlign?: 'center' | 'inside' | 'outside'
  effect?: ShadowEffect
  // Figma-style effect stack — set instead of the legacy single `effect`
  // field when the node carries more than one visible shadow.
  effects?: Effect[]
}

export interface StrokeStyle {
  color: string
  opacity?: number
  width: number
  align: 'center' | 'inside' | 'outside'
}
