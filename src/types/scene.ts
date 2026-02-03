import type { ThemeName } from './variable'

// Variable binding to a variable (generic)
export interface VariableBinding {
  variableId: string
}

// Color binding (alias for backward compatibility)
export type ColorBinding = VariableBinding

// Image fill for shapes
export type ImageFillMode = 'fill' | 'fit' | 'stretch'

export interface ImageFill {
  url: string              // data:image/... or https://...
  mode: ImageFillMode
}

// Gradient fill types
export interface GradientColorStop {
  color: string
  position: number  // 0-1
  opacity?: number  // 0-1
}

export type GradientType = 'linear' | 'radial'

export interface GradientFill {
  type: GradientType
  stops: GradientColorStop[]
  // Normalized 0-1 coordinates relative to bounding box
  startX: number
  startY: number
  endX: number
  endY: number
  // Radial gradient radii (normalized)
  startRadius?: number
  endRadius?: number
}

// Sizing modes for elements inside auto-layout containers
export type SizingMode = 'fixed' | 'fill_container' | 'fit_content'

export interface SizingProperties {
  widthMode?: SizingMode   // default: 'fixed'
  heightMode?: SizingMode  // default: 'fixed'
}

// Stroke properties for path nodes (SVG-style)
export interface PathStroke {
  align?: string       // 'center' | 'inside' | 'outside'
  thickness?: number   // stroke width
  join?: string        // 'round' | 'bevel' | 'miter'
  cap?: string         // 'round' | 'butt' | 'square'
  fill?: string        // stroke color (may be a variable reference like "$--foreground")
}

export interface ShadowEffect {
  type: 'shadow'
  shadowType: 'outer' | 'inner'  // only outer supported for now
  color: string       // hex with alpha, e.g. '#00000040'
  offset: { x: number; y: number }
  blur: number
  spread: number
}

export interface BaseNode {
  id: string
  type: 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'ref' | 'path' | 'line' | 'polygon'
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
  // Opacity (0-1, defaults to 1)
  opacity?: number
  // Per-color opacity (0-1, defaults to 1)
  fillOpacity?: number
  strokeOpacity?: number
  // Flip (horizontal / vertical)
  flipX?: boolean
  flipY?: boolean
  // Image fill (takes priority over color fill when set)
  imageFill?: ImageFill
  // Gradient fill (takes priority over solid fill when set)
  gradientFill?: GradientFill
  // Shadow effect
  effect?: ShadowEffect
  // Aspect ratio lock for proportional resize
  aspectRatioLocked?: boolean
  // Stored aspect ratio (width/height) when lock is enabled
  aspectRatio?: number
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
  // Clip content - when true, visually clip children to frame bounds
  clip?: boolean
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
// 'auto' = width follows text content (no wrapping)
// 'fixed' = manual width, height auto (wraps text)
// 'fixed-height' = manual width and height (wraps text, may overflow)
export type TextWidthMode = 'auto' | 'fixed' | 'fixed-height'

// Text alignment
export type TextAlign = 'left' | 'center' | 'right'

// Vertical text alignment
export type TextAlignVertical = 'top' | 'middle' | 'bottom'

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  fontSize?: number
  fontFamily?: string
  // Font weight: "normal", "bold", or numeric "100"-"900"
  fontWeight?: string
  // Font style: "normal" or "italic"
  fontStyle?: string
  // Text decoration
  underline?: boolean
  strikethrough?: boolean
  // Text width mode: 'auto' = width follows text content, 'fixed' = manual width, 'fixed-height' = manual width+height
  textWidthMode?: TextWidthMode
  // Text alignment within the text block
  textAlign?: TextAlign
  // Vertical text alignment within the text block
  textAlignVertical?: TextAlignVertical
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

export interface GroupNode extends BaseNode {
  type: 'group'
  children: SceneNode[]
  // SVG clip-path geometry for clipping this group
  clipGeometry?: string
  clipBounds?: { x: number; y: number; width: number; height: number }
}

export interface PathNode extends BaseNode {
  type: 'path'
  geometry: string           // SVG path data (d attribute)
  pathStroke?: PathStroke    // SVG-style stroke properties
  // Bounding box origin of the raw geometry (for offsetting path rendering inside the node)
  geometryBounds?: { x: number; y: number; width: number; height: number }
  // SVG clip-path geometry for clipping this path
  clipGeometry?: string
  clipBounds?: { x: number; y: number; width: number; height: number }
}

export interface LineNode extends BaseNode {
  type: 'line'
  points: number[]  // [x1, y1, x2, y2] relative to node x,y
}

export interface PolygonNode extends BaseNode {
  type: 'polygon'
  points: number[]  // vertices [x1,y1,x2,y2,...] relative to node x,y
  sides?: number    // number of sides (default 6)
}

export type SceneNode = FrameNode | GroupNode | RectNode | EllipseNode | TextNode | RefNode | PathNode | LineNode | PolygonNode

/** Check if a node is a container (has children array) */
export function isContainerNode(node: SceneNode): node is FrameNode | GroupNode {
  return node.type === 'frame' || node.type === 'group'
}

/** Get children of a container node, or empty array for leaf nodes */
export function getNodeChildren(node: SceneNode): SceneNode[] {
  if (node.type === 'frame' || node.type === 'group') {
    return node.children
  }
  return []
}

/** Return a copy of a container node with updated children */
export function withChildren(node: FrameNode | GroupNode, children: SceneNode[]): FrameNode | GroupNode {
  return { ...node, children } as FrameNode | GroupNode
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}
