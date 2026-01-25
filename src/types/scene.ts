import type { ThemeName } from './variable'

// Color binding to a variable
export interface ColorBinding {
  variableId: string
}

// Sizing modes for elements inside auto-layout containers
export type SizingMode = 'fixed' | 'fill_container' | 'fit_content'

export interface SizingProperties {
  widthMode?: SizingMode   // default: 'fixed'
  heightMode?: SizingMode  // default: 'fixed'
}

export interface BaseNode {
  id: string
  type: 'frame' | 'rect' | 'ellipse' | 'text' | 'ref'
  name?: string
  x: number
  y: number
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  visible?: boolean // defaults to true
  enabled?: boolean // defaults to true, false hides node (used for instance overrides)
  // Sizing mode (used when node is inside auto-layout container)
  sizing?: SizingProperties
  // Variable bindings for colors
  fillBinding?: ColorBinding
  strokeBinding?: ColorBinding
  // Rotation in degrees (0-360)
  rotation?: number
}

// Auto-layout properties for Frame nodes
export type FlexDirection = 'row' | 'column'
export type AlignItems = 'flex-start' | 'center' | 'flex-end' | 'stretch'
export type JustifyContent = 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'

export interface LayoutProperties {
  autoLayout?: boolean // whether auto-layout is enabled
  flexDirection?: FlexDirection
  gap?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  alignItems?: AlignItems
  justifyContent?: JustifyContent
}

export interface FrameNode extends BaseNode {
  type: 'frame'
  children: SceneNode[]
  cornerRadius?: number
  // Auto-layout properties
  layout?: LayoutProperties
  // Theme override (light/dark) - if set, overrides global theme for this frame
  themeOverride?: ThemeName
  // Reusable component flag - when true, this frame is a component that can be instantiated
  reusable?: boolean
}

export interface RectNode extends BaseNode {
  type: 'rect'
  cornerRadius?: number
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse'
}

// Text width mode
export type TextWidthMode = 'auto' | 'fixed'

// Text alignment
export type TextAlign = 'left' | 'center' | 'right'

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  fontSize?: number
  fontFamily?: string
  // Text width mode: 'auto' = width follows text content, 'fixed' = manual width
  textWidthMode?: TextWidthMode
  // Text alignment within the text block
  textAlign?: TextAlign
  // Line height multiplier (e.g., 1.2 = 120% of font size)
  lineHeight?: number
  // Letter spacing in pixels
  letterSpacing?: number
}

// Descendant overrides for instance nodes
// Maps child node IDs to their overridden properties
export type DescendantOverride = Partial<Omit<BaseNode, 'id' | 'type'>> & {
  // For nested frames with their own children
  descendants?: DescendantOverrides
}

export type DescendantOverrides = {
  [nodeId: string]: DescendantOverride
}

// Reference to a component (instance)
export interface RefNode extends BaseNode {
  type: 'ref'
  componentId: string  // ID of the component (FrameNode with reusable: true)
  // Overrides for descendant nodes within the component
  descendants?: DescendantOverrides
}

export type SceneNode = FrameNode | RectNode | EllipseNode | TextNode | RefNode

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}
