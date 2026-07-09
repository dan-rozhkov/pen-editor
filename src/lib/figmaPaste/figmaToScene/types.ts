// Internal types shared across the Figma → SceneNode conversion modules.

import type {
  Effect,
  GradientFill,
  ImageFill,
  Paint,
  SceneNode,
  ShadowEffect,
} from '@/types/scene'
import type { FigBlob, FigNodeChange } from '../figTypes'

export interface FigmaConversionResult {
  nodes: SceneNode[]
  warnings: string[]
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
  instance?: InstanceContext
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
  strokeWidth?: number
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
