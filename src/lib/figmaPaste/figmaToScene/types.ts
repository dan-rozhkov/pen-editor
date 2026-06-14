// Internal types shared across the Figma → SceneNode conversion modules.

import type {
  GradientFill,
  ImageFill,
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
  blobs: FigBlob[]
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
  stroke?: string
  strokeOpacity?: number
  strokeWidth?: number
  strokeAlign?: 'center' | 'inside' | 'outside'
  effect?: ShadowEffect
}

export interface StrokeStyle {
  color: string
  opacity?: number
  width: number
  align: 'center' | 'inside' | 'outside'
}
