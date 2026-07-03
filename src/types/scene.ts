import type { ThemeName, Variable } from './variable'

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

// --- Multiple fills (Figma-style paint stack) ---

// Blend modes supported per paint layer (subset of CSS/Pixi blend modes).
// Single source of truth — UI options and CSS parsing derive from this list.
export const PAINT_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
] as const

export type PaintBlendMode = (typeof PAINT_BLEND_MODES)[number]

interface PaintBase {
  // Stable id for UI list keys/reordering (generated, not semantic)
  id: string
  visible?: boolean   // defaults to true
  opacity?: number    // 0-1, defaults to 1
  blendMode?: PaintBlendMode // defaults to 'normal'
}

export interface SolidPaint extends PaintBase {
  type: 'solid'
  color: string             // hex, e.g. '#ff0000' or '#ff000080'
  colorBinding?: ColorBinding
}

export interface GradientPaint extends PaintBase {
  type: 'gradient'
  gradient: GradientFill
}

export interface ImagePaint extends PaintBase {
  type: 'image'
  image: ImageFill
}

/**
 * One paint layer in a fill stack. `fills: Paint[]` is ordered bottom-to-top:
 * fills[0] renders first (bottom), the last element renders on top.
 */
export type Paint = SolidPaint | GradientPaint | ImagePaint

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
  // Stable id for UI list keys when used inside `effects: Effect[]`
  id?: string
  visible?: boolean   // defaults to true
}

export interface BlurEffect {
  type: 'blur'
  radius: number      // px, 0-100 in the UI; <= 0 renders nothing
  // Stable id for UI list keys when used inside `effects: Effect[]`
  id?: string
  visible?: boolean   // defaults to true
}

/**
 * One effect layer in an effect stack. `effects: Effect[]` is ordered
 * bottom-to-top like `fills`. Shadows and layer blur; future effect kinds
 * extend this union.
 */
export type Effect = ShadowEffect | BlurEffect

// Per-side stroke widths (like CSS border-top, border-right, etc.)
export interface PerSideStroke {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

// Per-corner border radius
export interface PerCornerRadius {
  topLeft?: number
  topRight?: number
  bottomRight?: number
  bottomLeft?: number
}

/** Curated set of paper-design/shaders exposed in the editor. */
export type ShaderKind =
  | 'meshGradient' | 'waves' | 'warp' | 'spiral'
  | 'metaballs' | 'godRays' | 'voronoi' | 'dithering'
  | 'water' | 'flutedGlass' | 'halftoneDots' | 'imageDithering'

/**
 * A shader attached to a node. Baked to a static texture and rendered inside the
 * node's Pixi container (so it obeys scene z-order). `params` holds prop
 * overrides on top of the selected preset.
 */
export interface ShaderConfig {
  kind: ShaderKind
  preset?: string
  params: Record<string, number | string | string[]>
}

export interface BaseNode {
  id: string
  type: 'frame' | 'group' | 'rect' | 'ellipse' | 'text' | 'path' | 'line' | 'polygon' | 'embed' | 'ref' | 'connector'
  name?: string
  x: number
  y: number
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  // Stroke alignment: center (default canvas behavior), inside, or outside
  strokeAlign?: 'center' | 'inside' | 'outside'
  // Per-side stroke widths (takes precedence over strokeWidth when set)
  strokeWidthPerSide?: PerSideStroke
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
  // Legacy single-fill field — superseded by `fills` when that is set
  imageFill?: ImageFill
  // Gradient fill (takes priority over solid fill when set)
  // Legacy single-fill field — superseded by `fills` when that is set
  gradientFill?: GradientFill
  /**
   * Figma-style paint stack (bottom-to-top). When defined, this is the single
   * source of truth for the node's fill; the legacy `fill`/`gradientFill`/
   * `imageFill`/`fillOpacity`/`fillBinding` fields are ignored. Use
   * `getFills()` from `@/utils/fillUtils` to read fills with legacy fallback.
   */
  fills?: Paint[]
  // Shadow effect (legacy single-effect field — superseded by `effects`)
  effect?: ShadowEffect
  /**
   * Figma-style effect stack (bottom-to-top). When defined, supersedes the
   * legacy `effect` field. Use `getEffects()` from `@/utils/fillUtils`.
   */
  effects?: Effect[]
  /** Shader (paper-design/shaders), baked to a texture and rendered in Pixi. */
  shader?: ShaderConfig
  // Aspect ratio lock for proportional resize
  aspectRatioLocked?: boolean
  // Stored aspect ratio (width/height) when lock is enabled
  aspectRatio?: number
  // Absolute position inside auto-layout parent (excluded from flex flow)
  absolutePosition?: boolean
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

// Layout grid types (Figma-style visual grid overlays)
export type LayoutGridType = 'grid' | 'columns' | 'rows'
export type LayoutGridAlignment = 'stretch' | 'center' | 'min' | 'max'
// columns: min=left, max=right; rows: min=top, max=bottom

export interface LayoutGridConfig {
  id: string
  type: LayoutGridType
  visible: boolean
  color: string        // hex e.g. "#FF0000"
  opacity: number      // 0-1
  size?: number        // grid type cell size (default 10)
  count?: number       // columns/rows count (default 5)
  gutter?: number      // spacing between columns/rows (default 20)
  margin?: number      // offset from frame edge (default 0)
  width?: number | null // null = auto (stretch fills available space)
  alignment?: LayoutGridAlignment
}

export interface FrameNode extends BaseNode {
  type: 'frame'
  children: SceneNode[]
  cornerRadius?: number
  cornerRadiusPerCorner?: PerCornerRadius
  // Clip content - when true, visually clip children to frame bounds
  clip?: boolean
  // Auto-layout properties
  layout?: LayoutProperties
  // Theme override (light/dark) - if set, overrides global theme for this frame
  themeOverride?: ThemeName
  // Reusable component flag - when true, this frame is a component that can be instantiated
  reusable?: boolean
  // When true, this frame is a slot (replaceable in instances)
  isSlot?: boolean
  // Layout grid overlays (visual design aid, not part of exported design)
  layoutGrids?: LayoutGridConfig[]
}

export interface RectNode extends BaseNode {
  type: 'rect'
  cornerRadius?: number
  cornerRadiusPerCorner?: PerCornerRadius
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

// Text transform
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize'

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
  // Text transform (visual only, applied at render/measure time)
  textTransform?: TextTransform
  // Truncate overflowing text with an ellipsis ("…"). Figma "Truncate text".
  // Only meaningful in wrapped modes ('fixed' / 'fixed-height'): in 'fixed-height'
  // lines past the box height are dropped; combine with maxLines for a tighter cap.
  truncateText?: boolean
  // Optional hard cap on the number of rendered lines (>= 1). When the wrapped
  // text exceeds it, the last kept line ends with an ellipsis. Figma "Max lines".
  maxLines?: number
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
  // SVG fill-rule for complex paths with holes (evenodd creates cutouts)
  fillRule?: 'nonzero' | 'evenodd'
}

export interface LineNode extends BaseNode {
  type: 'line'
  points: number[]  // [x1, y1, x2, y2] relative to node x,y
}

export type AnchorPosition = 'top' | 'right' | 'bottom' | 'left'

export interface ConnectorEndpoint {
  nodeId: string
  anchor: AnchorPosition
}

export interface ConnectorNode extends BaseNode {
  type: 'connector'
  startConnection: ConnectorEndpoint
  endConnection: ConnectorEndpoint
  points: number[]  // [x1, y1, x2, y2] relative to node x,y
}

export interface PolygonNode extends BaseNode {
  type: 'polygon'
  points: number[]  // vertices [x1,y1,x2,y2,...] relative to node x,y
  sides?: number    // number of sides (default 6)
}

export interface EmbedNode extends BaseNode {
  type: 'embed'
  htmlContent: string
  sourceTemplate?: string
}

export type InstanceOverrideUpdateProps = Partial<Omit<FlatSceneNode, 'id' | 'type'>>

export type InstanceOverride =
  | {
      kind: 'update'
      props: InstanceOverrideUpdateProps
    }
  | {
      kind: 'replace'
      node: SceneNode
    }

export type InstanceOverrides = {
  [path: string]: InstanceOverride
}

// Reference to a component definition (instance)
export interface RefNode extends BaseNode {
  type: 'ref'
  componentId: string
  overrides?: InstanceOverrides
}

export type SceneNode = FrameNode | GroupNode | RectNode | EllipseNode | TextNode | PathNode | LineNode | PolygonNode | EmbedNode | RefNode | ConnectorNode

// --- Flat node types (no children arrays - structure lives in store indices) ---

/** FrameNode without children array - used in flat storage */
export type FlatFrameNode = Omit<FrameNode, 'children'>

/** GroupNode without children array - used in flat storage */
export type FlatGroupNode = Omit<GroupNode, 'children'>

/** Union of all node types in flat storage (containers have no children property) */
export type FlatSceneNode = FlatFrameNode | FlatGroupNode | RectNode | EllipseNode | TextNode | PathNode | LineNode | PolygonNode | EmbedNode | RefNode | ConnectorNode

/** Check if a node is a container (has children array) */
export function isContainerNode(node: SceneNode): node is FrameNode | GroupNode {
  return node.type === 'frame' || node.type === 'group'
}

/** Check if a flat node is a container type (frame or group) */
export function isFlatContainerType(node: FlatSceneNode): node is FlatFrameNode | FlatGroupNode {
  return node.type === 'frame' || node.type === 'group'
}

/** Check if a flat node is a frame */
export function isFlatFrameNode(node: FlatSceneNode): node is FlatFrameNode {
  return node.type === 'frame'
}

/** Check if a flat node is a component instance (ref) */
export function isRefNode(node: FlatSceneNode): node is RefNode {
  return node.type === 'ref'
}

/** Check if a flat node is a connector */
export function isConnectorNode(node: FlatSceneNode): node is ConnectorNode {
  return node.type === 'connector'
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

/** Strip children from a SceneNode to create a FlatSceneNode */
export function toFlatNode(node: SceneNode): FlatSceneNode {
  if (isContainerNode(node)) {
    const { children, ...flat } = node
    void children
    return flat as FlatSceneNode
  }
  return node
}

/** Flatten a nested tree into flat storage maps */
export function flattenTree(nodes: SceneNode[]): {
  nodesById: Record<string, FlatSceneNode>
  parentById: Record<string, string | null>
  childrenById: Record<string, string[]>
  rootIds: string[]
} {
  const nodesById: Record<string, FlatSceneNode> = {}
  const parentById: Record<string, string | null> = {}
  const childrenById: Record<string, string[]> = {}
  const rootIds: string[] = []

  function visit(node: SceneNode, parentId: string | null) {
    nodesById[node.id] = toFlatNode(node)
    parentById[node.id] = parentId
    if (isContainerNode(node)) {
      childrenById[node.id] = node.children.map(c => c.id)
      for (const child of node.children) {
        visit(child, node.id)
      }
    }
  }

  for (const node of nodes) {
    rootIds.push(node.id)
    visit(node, null)
  }

  return { nodesById, parentById, childrenById, rootIds }
}

/** Rebuild a nested tree from flat storage */
export function buildTree(
  rootIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): SceneNode[] {
  // Track the ancestor chain currently being built so a corrupt graph with a
  // parent/child cycle degrades to a missing-children node instead of recursing
  // forever and overflowing the stack.
  const building = new Set<string>()
  function buildNode(id: string): SceneNode {
    const flat = nodesById[id]
    if (!flat) throw new Error(`Node not found: ${id}`)
    if (isFlatContainerType(flat)) {
      if (building.has(id)) {
        return { ...flat, children: [] } as SceneNode
      }
      building.add(id)
      const childIds = childrenById[id] ?? []
      const children = childIds.map(buildNode)
      building.delete(id)
      return { ...flat, children } as SceneNode
    }
    return flat as SceneNode
  }

  return rootIds.map(buildNode)
}

/** Collect all descendant IDs recursively from flat storage */
export function collectDescendantIds(
  nodeId: string,
  childrenById: Record<string, string[]>,
  visited: Set<string> = new Set(),
): string[] {
  const result: string[] = []
  const childIds = childrenById[nodeId]
  if (childIds) {
    for (const childId of childIds) {
      // Skip already-visited ids so a corrupt cyclic graph can't recurse forever.
      if (visited.has(childId)) continue
      visited.add(childId)
      result.push(childId)
      result.push(...collectDescendantIds(childId, childrenById, visited))
    }
  }
  return result
}

/** Snapshot of flat scene state (used by history) */
export interface FlatSnapshot {
  nodesById: Record<string, FlatSceneNode>
  parentById: Record<string, string | null>
  childrenById: Record<string, string[]>
  rootIds: string[]
  componentArtifactsById?: Record<string, ComponentArtifact>
  variables?: Variable[]
}

export interface ComponentArtifact {
  authoringHtml?: string
  sourceTemplate?: string
  revision: number
  syncState: 'in_sync' | 'stale_from_native' | 'stale_from_html' | 'missing' | 'failed'
}

/** Selection state snapshot (used by history) */
export interface SelectionSnapshot {
  selectedIds: string[]
  enteredContainerId: string | null
  lastSelectedId: string | null
}

/** Full editor snapshot for history (scene + selection) */
export interface HistorySnapshot extends FlatSnapshot {
  selection: SelectionSnapshot
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}
