// Conversion of a decoded Figma clipboard message into pen-editor SceneNodes.
//
// Coordinate model mapping:
// - Figma stores a relative 2x3 transform per node; the editor stores x/y
//   (top-left, relative to parent) + rotation in degrees applied around the
//   same origin — so x = m02, y = m12, rotation = atan2(m10, m00).
// - Figma children arrays are ordered bottom-to-top, same as the editor.
// - Auto-layout (Figma "stacks") maps onto the editor's flexbox layout:
//   direction/gap/padding/alignment on the frame, fill/hug sizing and
//   absolute positioning on children. The editor's layout engine recomputes
//   child positions on insert; with exact gap/padding and fixed child sizes
//   this reproduces Figma's coordinates (hugged text may drift by a few px
//   where font metrics differ).

import {
  generateId,
  type AlignItems,
  type EllipseNode,
  type FrameNode,
  type JustifyContent,
  type LayoutProperties,
  type GradientColorStop,
  type GradientFill,
  type GroupNode,
  type ImageFill,
  type LineNode,
  type PathNode,
  type PerCornerRadius,
  type RectNode,
  type SceneNode,
  type ShadowEffect,
  type SizingMode,
  type SizingProperties,
  type TextAlign,
  type TextAlignVertical,
  type TextNode,
  type TextTransform,
  type TextWidthMode,
} from '@/types/scene'
import {
  figGuidKey,
  type FigBlob,
  type FigColor,
  type FigMatrix,
  type FigNodeChange,
  type FigPaint,
  type FigPasteData,
} from './figTypes'
import { decodePathCommandsBlob, decodeVectorNetworkBlob, vectorNetworkToPathData } from './pathBlobs'

export interface FigmaConversionResult {
  nodes: SceneNode[]
  warnings: string[]
}

interface FigTreeNode {
  change: FigNodeChange
  children: FigTreeNode[]
}

interface InstanceContext {
  overrides: Map<string, FigNodeChange>
  path: string[]
}

interface ConvertContext {
  blobs: FigBlob[]
  byGuid: Map<string, FigTreeNode>
  warnings: string[]
  instance?: InstanceContext
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function buildFigTree(data: FigPasteData): {
  roots: FigTreeNode[]
  byGuid: Map<string, FigTreeNode>
} {
  const changes = data.message.nodeChanges ?? []
  const byGuid = new Map<string, FigTreeNode>()

  for (const change of changes) {
    if (!change.guid || change.phase === 'REMOVED') continue
    byGuid.set(figGuidKey(change.guid), { change, children: [] })
  }

  const parentless: FigTreeNode[] = []
  for (const node of byGuid.values()) {
    const parentKey = node.change.parentIndex ? figGuidKey(node.change.parentIndex.guid) : ''
    const parent = parentKey ? byGuid.get(parentKey) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      parentless.push(node)
    }
  }

  const byPosition = (a: FigTreeNode, b: FigTreeNode): number => {
    const pa = a.change.parentIndex?.position ?? ''
    const pb = b.change.parentIndex?.position ?? ''
    return pa < pb ? -1 : pa > pb ? 1 : 0
  }
  for (const node of byGuid.values()) {
    node.children.sort(byPosition)
  }

  // The payload is structured DOCUMENT → CANVAS(es) → copied nodes. Symbol
  // masters referenced by copied instances live on internal-only canvases.
  const roots: FigTreeNode[] = []
  for (const node of byGuid.values()) {
    if (node.change.type !== 'CANVAS' || node.change.internalOnly) continue
    roots.push(...node.children)
  }
  if (roots.length === 0) {
    for (const node of parentless) {
      const type = node.change.type
      if (type === 'DOCUMENT' || type === 'CANVAS') continue
      roots.push(node)
    }
  }
  roots.sort(byPosition)
  return { roots, byGuid }
}

// ---------------------------------------------------------------------------
// Color / paint helpers
// ---------------------------------------------------------------------------

function channelToHex(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0')
}

function colorToHex(color: FigColor): string {
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`
}

function colorToHex8(color: FigColor, extraOpacity = 1): string {
  return `${colorToHex(color)}${channelToHex(color.a * extraOpacity)}`
}

function paintIsVisible(paint: FigPaint): boolean {
  return paint.visible !== false && (paint.opacity ?? 1) > 0
}

/** Topmost visible paint of the given kinds (Figma paints are bottom-to-top). */
function topPaint(paints: FigPaint[] | undefined, kinds: (paint: FigPaint) => boolean): FigPaint | null {
  if (!paints) return null
  for (let i = paints.length - 1; i >= 0; i--) {
    const paint = paints[i]
    if (paintIsVisible(paint) && kinds(paint)) return paint
  }
  return null
}

interface InvertedMatrix {
  apply: (x: number, y: number) => { x: number; y: number }
}

function invertMatrix(m: FigMatrix): InvertedMatrix | null {
  const det = m.m00 * m.m11 - m.m01 * m.m10
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  const i00 = m.m11 / det
  const i01 = -m.m01 / det
  const i10 = -m.m10 / det
  const i11 = m.m00 / det
  return {
    apply: (x: number, y: number) => {
      const dx = x - m.m02
      const dy = y - m.m12
      return { x: i00 * dx + i01 * dy, y: i10 * dx + i11 * dy }
    },
  }
}

function gradientStops(paint: FigPaint): GradientColorStop[] {
  const paintOpacity = paint.opacity ?? 1
  return (paint.stops ?? []).map((stop) => {
    const result: GradientColorStop = {
      color: colorToHex(stop.color),
      position: Math.max(0, Math.min(1, stop.position)),
    }
    const opacity = stop.color.a * paintOpacity
    if (opacity < 1) result.opacity = opacity
    return result
  })
}

/**
 * Figma gradient transforms map normalized object space into gradient space
 * (t = x' for linear). Inverting the matrix recovers the handle positions.
 */
function convertGradient(paint: FigPaint): GradientFill | null {
  const stops = gradientStops(paint)
  if (stops.length === 0) return null
  const inverse = paint.transform ? invertMatrix(paint.transform) : null
  const isRadial = paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_DIAMOND'

  if (isRadial) {
    const center = inverse ? inverse.apply(0.5, 0.5) : { x: 0.5, y: 0.5 }
    const edge = inverse ? inverse.apply(1, 0.5) : { x: 1, y: 0.5 }
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y) || 0.5
    return {
      type: 'radial',
      stops,
      startX: center.x,
      startY: center.y,
      endX: center.x,
      endY: center.y,
      endRadius: radius,
    }
  }

  // Linear (ANGULAR falls back to linear along the same axis)
  const start = inverse ? inverse.apply(0, 0.5) : { x: 0, y: 0.5 }
  const end = inverse ? inverse.apply(1, 0.5) : { x: 1, y: 0.5 }
  return {
    type: 'linear',
    stops,
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
  }
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'image/png'
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${sniffImageMime(bytes)};base64,${btoa(binary)}`
}

function convertImagePaint(paint: FigPaint, ctx: ConvertContext): ImageFill | null {
  const blobIndex = paint.image?.dataBlob
  const blob = blobIndex != null ? ctx.blobs[blobIndex] : undefined
  if (!blob || blob.bytes.length === 0) {
    ctx.warnings.push(
      `Image "${paint.image?.name ?? 'unnamed'}" is not embedded in the clipboard payload`,
    )
    return null
  }
  const mode =
    paint.imageScaleMode === 'FIT' ? 'fit' : paint.imageScaleMode === 'STRETCH' ? 'stretch' : 'fill'
  return { url: bytesToDataUrl(blob.bytes), mode }
}

// ---------------------------------------------------------------------------
// Shared node properties
// ---------------------------------------------------------------------------

type MutableBase = {
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

function decomposePosition(change: FigNodeChange): { x: number; y: number; rotation?: number } {
  const m = change.transform
  if (!m) return { x: 0, y: 0 }
  let rotationDeg = (Math.atan2(m.m10, m.m00) * 180) / Math.PI
  if (Math.abs(rotationDeg) < 0.01) rotationDeg = 0
  if (rotationDeg < 0) rotationDeg += 360
  return {
    x: m.m02,
    y: m.m12,
    ...(rotationDeg !== 0 ? { rotation: rotationDeg } : {}),
  }
}

function buildBase(change: FigNodeChange, ctx: ConvertContext, withStroke = true): MutableBase {
  const { x, y, rotation } = decomposePosition(change)
  const base: MutableBase = {
    id: generateId(),
    x,
    y,
    width: change.size?.x ?? 0,
    height: change.size?.y ?? 0,
  }
  if (change.name) base.name = change.name
  if (rotation != null) base.rotation = rotation
  if (change.visible === false) base.visible = false
  if (change.opacity != null && change.opacity < 1) base.opacity = change.opacity

  applyFillPaints(base, change, ctx)
  // Path nodes render strokes through pathStroke — top-level stroke props
  // would double-draw there, so vector conversion opts out
  if (withStroke) applyStrokePaints(base, change, ctx)
  applyEffects(base, change)
  return base
}

function applyFillPaints(base: MutableBase, change: FigNodeChange, ctx: ConvertContext): void {
  const solid = topPaint(change.fillPaints, (p) => p.type === 'SOLID')
  if (solid?.color) {
    base.fill = colorToHex(solid.color)
    const opacity = solid.color.a * (solid.opacity ?? 1)
    if (opacity < 1) base.fillOpacity = opacity
  }
  const gradient = topPaint(change.fillPaints, (p) => p.type?.startsWith('GRADIENT_') === true)
  if (gradient) {
    const converted = convertGradient(gradient)
    if (converted) base.gradientFill = converted
  }
  const image = topPaint(change.fillPaints, (p) => p.type === 'IMAGE')
  if (image) {
    const converted = convertImagePaint(image, ctx)
    if (converted) {
      base.imageFill = converted
    } else if (!base.fill && !base.gradientFill) {
      base.fill = '#cccccc'
    }
  }
}

interface StrokeStyle {
  color: string
  opacity?: number
  width: number
  align: 'center' | 'inside' | 'outside'
}

/** Resolve the topmost stroke paint into a color/width/align triple. */
function resolveStroke(change: FigNodeChange, ctx: ConvertContext): StrokeStyle | null {
  const paint = topPaint(change.strokePaints, (p) => p.type !== 'IMAGE')
  if (!paint) return null
  const style: StrokeStyle = {
    color: '',
    width: change.strokeWeight ?? 1,
    align:
      change.strokeAlign === 'INSIDE' ? 'inside' : change.strokeAlign === 'OUTSIDE' ? 'outside' : 'center',
  }
  if (paint.type === 'SOLID' && paint.color) {
    style.color = colorToHex(paint.color)
    const opacity = paint.color.a * (paint.opacity ?? 1)
    if (opacity < 1) style.opacity = opacity
  } else if (paint.stops && paint.stops.length > 0) {
    style.color = colorToHex(paint.stops[0].color)
    ctx.warnings.push(`Gradient stroke on "${change.name ?? 'node'}" approximated with a solid color`)
  } else {
    return null
  }
  return style
}

function applyStrokePaints(base: MutableBase, change: FigNodeChange, ctx: ConvertContext): void {
  const stroke = resolveStroke(change, ctx)
  if (!stroke) return
  base.stroke = stroke.color
  if (stroke.opacity != null) base.strokeOpacity = stroke.opacity
  base.strokeWidth = stroke.width
  if (change.strokeAlign) base.strokeAlign = stroke.align
}

function applyEffects(base: MutableBase, change: FigNodeChange): void {
  const effects = change.effects ?? []
  const shadow =
    effects.find((e) => e.visible !== false && e.type === 'DROP_SHADOW') ??
    effects.find((e) => e.visible !== false && e.type === 'INNER_SHADOW')
  if (!shadow?.color) return
  base.effect = {
    type: 'shadow',
    shadowType: shadow.type === 'INNER_SHADOW' ? 'inner' : 'outer',
    color: colorToHex8(shadow.color),
    offset: { x: shadow.offset?.x ?? 0, y: shadow.offset?.y ?? 0 },
    blur: shadow.radius ?? 0,
    spread: shadow.spread ?? 0,
  }
}

function perCornerRadius(change: FigNodeChange): PerCornerRadius | undefined {
  if (!change.rectangleCornerRadiiIndependent) return undefined
  const corners: PerCornerRadius = {}
  if (change.rectangleTopLeftCornerRadius) corners.topLeft = change.rectangleTopLeftCornerRadius
  if (change.rectangleTopRightCornerRadius) corners.topRight = change.rectangleTopRightCornerRadius
  if (change.rectangleBottomRightCornerRadius) corners.bottomRight = change.rectangleBottomRightCornerRadius
  if (change.rectangleBottomLeftCornerRadius) corners.bottomLeft = change.rectangleBottomLeftCornerRadius
  return Object.keys(corners).length > 0 ? corners : undefined
}

// ---------------------------------------------------------------------------
// Per-type conversion
// ---------------------------------------------------------------------------

function convertRect(change: FigNodeChange, ctx: ConvertContext): RectNode {
  const node: RectNode = { type: 'rect', ...buildBase(change, ctx) }
  if (change.cornerRadius) node.cornerRadius = change.cornerRadius
  const corners = perCornerRadius(change)
  if (corners) node.cornerRadiusPerCorner = corners
  return node
}

function convertEllipse(change: FigNodeChange, ctx: ConvertContext): EllipseNode {
  return { type: 'ellipse', ...buildBase(change, ctx) }
}

function geometryFromPaths(
  paths: { commandsBlob?: number; windingRule?: 'NONZERO' | 'ODD' }[] | undefined,
  ctx: ConvertContext,
): { d: string; windingRule: 'NONZERO' | 'ODD' } | null {
  if (!paths || paths.length === 0) return null
  const parts: string[] = []
  for (const path of paths) {
    if (path.commandsBlob == null) continue
    const blob = ctx.blobs[path.commandsBlob]
    if (!blob) continue
    const d = decodePathCommandsBlob(blob.bytes)
    if (d) parts.push(d)
  }
  if (parts.length === 0) return null
  return { d: parts.join(' '), windingRule: paths[0].windingRule ?? 'NONZERO' }
}

/**
 * Vector geometry from the editing topology (vectorNetworkBlob) — clipboard
 * payloads carry this instead of derived fill/stroke command geometry.
 */
function geometryFromVectorNetwork(
  change: FigNodeChange,
  ctx: ConvertContext,
): { d: string; windingRule: 'NONZERO' | 'ODD' } | null {
  const blobIndex = change.vectorData?.vectorNetworkBlob
  if (blobIndex == null) return null
  const blob = ctx.blobs[blobIndex]
  if (!blob) return null
  const network = decodeVectorNetworkBlob(blob.bytes)
  if (!network) return null
  // Network coordinates are in normalizedSize space; scale to the node size
  const normalized = change.vectorData?.normalizedSize
  const scaleX = normalized?.x ? (change.size?.x ?? normalized.x) / normalized.x : 1
  const scaleY = normalized?.y ? (change.size?.y ?? normalized.y) / normalized.y : 1
  return vectorNetworkToPathData(network, scaleX, scaleY)
}

function convertVectorLike(change: FigNodeChange, ctx: ConvertContext): PathNode | null {
  const base = buildBase(change, ctx, false)
  const stroke = resolveStroke(change, ctx)
  const fillGeometry =
    geometryFromPaths(change.fillGeometry, ctx) ?? geometryFromVectorNetwork(change, ctx)
  const strokeGeometry = geometryFromPaths(change.strokeGeometry, ctx)

  if (fillGeometry) {
    const node: PathNode = {
      type: 'path',
      ...base,
      geometry: fillGeometry.d,
      fillRule: fillGeometry.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
    }
    if (stroke) {
      node.pathStroke = {
        align: stroke.align,
        thickness: stroke.width,
        join: change.strokeJoin ? change.strokeJoin.toLowerCase() : undefined,
        cap: change.strokeCap === 'ROUND' ? 'round' : change.strokeCap === 'SQUARE' ? 'square' : 'butt',
        fill: stroke.color,
      }
    }
    return node
  }

  if (strokeGeometry && stroke) {
    // Open path: Figma pre-computes the stroke outline; fill it with the
    // stroke paint for an exact visual match (caps, joins and dashes included).
    const node: PathNode = {
      type: 'path',
      ...base,
      geometry: strokeGeometry.d,
      fillRule: strokeGeometry.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
      fill: stroke.color,
    }
    if (stroke.opacity != null) node.fillOpacity = stroke.opacity
    return node
  }

  ctx.warnings.push(`Vector "${change.name ?? 'node'}" has no geometry and was skipped`)
  return null
}

function convertLine(change: FigNodeChange, ctx: ConvertContext): LineNode {
  const base = buildBase(change, ctx)
  return {
    type: 'line',
    ...base,
    points: [0, 0, base.width, base.height],
  }
}

const FONT_WEIGHTS: [RegExp, string][] = [
  [/extra\s*black|ultra\s*black/, '950'],
  [/black|heavy/, '900'],
  [/extra\s*bold|ultra\s*bold/, '800'],
  [/semi\s*bold|demi\s*bold|demi/, '600'],
  [/bold/, '700'],
  [/medium/, '500'],
  [/extra\s*light|ultra\s*light/, '200'],
  [/light/, '300'],
  [/thin|hairline/, '100'],
]

function fontWeightFromStyle(style: string): string | undefined {
  const normalized = style.toLowerCase()
  for (const [pattern, weight] of FONT_WEIGHTS) {
    if (pattern.test(normalized)) return weight
  }
  return undefined
}

const TEXT_ALIGN_MAP: Record<string, TextAlign> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSTIFIED: 'left',
}

const TEXT_ALIGN_VERTICAL_MAP: Record<string, TextAlignVertical> = {
  TOP: 'top',
  CENTER: 'middle',
  BOTTOM: 'bottom',
}

const TEXT_CASE_MAP: Partial<Record<string, TextTransform>> = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
}

const TEXT_WIDTH_MODE_MAP: Record<string, TextWidthMode> = {
  WIDTH_AND_HEIGHT: 'auto',
  HEIGHT: 'fixed',
  NONE: 'fixed-height',
}

/**
 * Figma keeps the style a text node was created with in the top-level fields
 * and records later edits as per-character overrides: characterStyleIDs maps
 * each character to a styleOverrideTable entry (0 = base style). A text whose
 * font was changed after creation therefore still carries the stale base font
 * (typically Inter). Resolve the style covering the most characters and merge
 * it over the base so the visible style wins.
 */
function resolveTextStyle(change: FigNodeChange): { change: FigNodeChange; mixed: boolean } {
  const ids = change.textData?.characterStyleIDs ?? []
  if (ids.length === 0) return { change, mixed: false }

  // Characters beyond the ids array keep the base style (id 0)
  const baseCount = Math.max((change.textData?.characters?.length ?? 0) - ids.length, 0)
  const counts = new Map([[0, baseCount]])
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  if (counts.get(0) === 0) counts.delete(0)

  // Base style wins ties (it was inserted first)
  let dominantId = 0
  let dominantCount = 0
  for (const [id, count] of counts) {
    if (count > dominantCount) {
      dominantId = id
      dominantCount = count
    }
  }

  const override =
    dominantId !== 0
      ? change.textData?.styleOverrideTable?.find((entry) => entry.styleID === dominantId)
      : undefined
  return { change: override ? mergeChange(change, override) : change, mixed: counts.size > 1 }
}

function convertText(rawChange: FigNodeChange, ctx: ConvertContext): TextNode {
  const { change, mixed } = resolveTextStyle(rawChange)
  const base = buildBase(change, ctx)
  const node: TextNode = {
    type: 'text',
    ...base,
    text: change.textData?.characters ?? '',
  }
  if (change.fontSize) node.fontSize = change.fontSize
  if (change.fontName?.family) node.fontFamily = change.fontName.family
  const style = change.fontName?.style ?? ''
  const weight = fontWeightFromStyle(style)
  if (weight) node.fontWeight = weight
  if (/italic|oblique/i.test(style)) node.fontStyle = 'italic'

  const fontSize = change.fontSize ?? 12
  if (change.lineHeight) {
    if (change.lineHeight.units === 'PIXELS' && fontSize > 0) {
      node.lineHeight = change.lineHeight.value / fontSize
    } else if (change.lineHeight.units === 'PERCENT') {
      node.lineHeight = change.lineHeight.value / 100
    }
    // RAW means "auto" — leave the renderer default
  }
  if (change.letterSpacing && change.letterSpacing.value !== 0) {
    node.letterSpacing =
      change.letterSpacing.units === 'PERCENT'
        ? (fontSize * change.letterSpacing.value) / 100
        : change.letterSpacing.value
  }

  if (change.textAlignHorizontal && change.textAlignHorizontal !== 'LEFT') {
    node.textAlign = TEXT_ALIGN_MAP[change.textAlignHorizontal] ?? 'left'
  }
  if (change.textAlignVertical && change.textAlignVertical !== 'TOP') {
    node.textAlignVertical = TEXT_ALIGN_VERTICAL_MAP[change.textAlignVertical] ?? 'top'
  }
  const transform = change.textCase ? TEXT_CASE_MAP[change.textCase] : undefined
  if (transform) node.textTransform = transform
  if (change.textDecoration === 'UNDERLINE') node.underline = true
  if (change.textDecoration === 'STRIKETHROUGH') node.strikethrough = true

  node.textWidthMode = TEXT_WIDTH_MODE_MAP[change.textAutoResize ?? 'NONE'] ?? 'fixed-height'

  if (mixed) {
    ctx.warnings.push(
      `Text "${change.name ?? node.text.slice(0, 20)}" has mixed styles; the dominant style was applied`,
    )
  }
  return node
}

// ---------------------------------------------------------------------------
// Auto-layout (Figma stacks → flexbox layout)
// ---------------------------------------------------------------------------

function isStackContainer(change: FigNodeChange): boolean {
  return change.stackMode === 'HORIZONTAL' || change.stackMode === 'VERTICAL'
}

function isHugSizing(sizing: string | undefined): boolean {
  return sizing === 'RESIZE_TO_FIT' || sizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'
}

const STACK_JUSTIFY: Record<string, JustifyContent> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_EVENLY: 'space-between',
}

const STACK_ALIGN: Record<string, AlignItems> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'center',
}

function buildAutoLayout(change: FigNodeChange): LayoutProperties | null {
  if (!isStackContainer(change)) return null
  const justify = STACK_JUSTIFY[change.stackPrimaryAlignItems ?? 'MIN'] ?? 'flex-start'
  return {
    autoLayout: true,
    flexDirection: change.stackMode === 'VERTICAL' ? 'column' : 'row',
    // Figma ignores the stored item spacing in "space between" mode
    gap: justify === 'space-between' ? 0 : change.stackSpacing ?? 0,
    paddingTop: change.stackVerticalPadding ?? 0,
    paddingRight: change.stackPaddingRight ?? 0,
    paddingBottom: change.stackPaddingBottom ?? 0,
    paddingLeft: change.stackHorizontalPadding ?? 0,
    alignItems: STACK_ALIGN[change.stackCounterAlignItems ?? 'MIN'] ?? 'flex-start',
    justifyContent: justify,
  }
}

/** Hug-content sizing of a node itself (auto-layout frames and text). */
function hugSizing(change: FigNodeChange): { width: boolean; height: boolean } {
  if (change.stackMode === 'HORIZONTAL') {
    return {
      width: isHugSizing(change.stackPrimarySizing),
      height: isHugSizing(change.stackCounterSizing),
    }
  }
  if (change.stackMode === 'VERTICAL') {
    return {
      width: isHugSizing(change.stackCounterSizing),
      height: isHugSizing(change.stackPrimarySizing),
    }
  }
  if (change.type === 'TEXT') {
    return {
      width: change.textAutoResize === 'WIDTH_AND_HEIGHT',
      height: change.textAutoResize === 'WIDTH_AND_HEIGHT' || change.textAutoResize === 'HEIGHT',
    }
  }
  return { width: false, height: false }
}

function stackSizing(fill: boolean, hug: boolean): SizingMode | undefined {
  if (fill) return 'fill_container'
  if (hug) return 'fit_content'
  return undefined
}

/**
 * Sizing and positioning of a child inside an auto-layout parent:
 * fill (grow/stretch), hug (its own content sizing) or fixed; absolutely
 * positioned children are excluded from the flow.
 */
function applyStackChildProps(
  node: SceneNode,
  childChange: FigNodeChange,
  parentChange: FigNodeChange,
): void {
  if (childChange.stackPositioning === 'ABSOLUTE') {
    node.absolutePosition = true
    return
  }
  const horizontal = parentChange.stackMode === 'HORIZONTAL'
  const fillPrimary = (childChange.stackChildPrimaryGrow ?? 0) > 0
  const fillCounter = childChange.stackChildAlignSelf === 'STRETCH'
  const hug = hugSizing(childChange)

  const widthMode = stackSizing(horizontal ? fillPrimary : fillCounter, hug.width)
  const heightMode = stackSizing(horizontal ? fillCounter : fillPrimary, hug.height)
  if (widthMode || heightMode) {
    const sizing: SizingProperties = {}
    if (widthMode) sizing.widthMode = widthMode
    if (heightMode) sizing.heightMode = heightMode
    node.sizing = sizing
  }
}

// ---------------------------------------------------------------------------
// Containers, masks and instances
// ---------------------------------------------------------------------------

function isMaskChange(change: FigNodeChange): boolean {
  return change.mask === true
}

function fullyCovers(outer: SceneNode, inner: SceneNode): boolean {
  return (
    outer.x <= inner.x + 0.5 &&
    outer.y <= inner.y + 0.5 &&
    outer.x + outer.width >= inner.x + inner.width - 0.5 &&
    outer.y + outer.height >= inner.y + inner.height - 0.5
  )
}

/**
 * Best-effort Figma mask emulation (the editor clips with frames only):
 * - mask + a single image layer covering it → image fill on the mask shape
 * - otherwise the mask shape is hidden and a warning is recorded
 */
function applyMaskWorkarounds(
  figChildren: FigTreeNode[],
  converted: (SceneNode | null)[],
  ctx: ConvertContext,
): SceneNode[] {
  const maskIndex = figChildren.findIndex(
    (child, i) => isMaskChange(child.change) && converted[i] != null,
  )
  if (maskIndex === -1) {
    return converted.filter((node): node is SceneNode => node != null)
  }

  const maskNode = converted[maskIndex] as SceneNode
  const above = converted.filter(
    (node, i): node is SceneNode => node != null && i > maskIndex,
  )

  const onlyImage =
    above.length === 1 &&
    above[0].imageFill != null &&
    (above[0].type === 'rect' || above[0].type === 'frame') &&
    fullyCovers(above[0], maskNode) &&
    (maskNode.type === 'rect' || maskNode.type === 'ellipse')
  if (onlyImage) {
    maskNode.imageFill = { ...above[0].imageFill!, mode: 'fill' }
    return converted.filter(
      (node, i): node is SceneNode => node != null && node !== above[0] && i <= maskIndex,
    )
  }

  ctx.warnings.push(
    `Mask "${maskNode.name ?? 'mask'}" is not supported and was hidden; content is left unclipped`,
  )
  maskNode.visible = false
  return converted.filter((node): node is SceneNode => node != null)
}

function convertChildren(
  figChildren: FigTreeNode[],
  ctx: ConvertContext,
  parentChange?: FigNodeChange,
): SceneNode[] {
  const parentIsStack = parentChange != null && isStackContainer(parentChange)
  const converted = figChildren.map((child) => {
    const node = convertNode(child, ctx)
    if (node && parentIsStack) {
      applyStackChildProps(node, child.change, parentChange)
    }
    return node
  })
  return applyMaskWorkarounds(figChildren, converted, ctx)
}

function convertFrame(node: FigTreeNode, change: FigNodeChange, ctx: ConvertContext): FrameNode | GroupNode {
  const isGroup = change.type === 'GROUP' || change.resizeToFit === true
  const children = convertChildren(node.children, ctx, change)

  if (isGroup) {
    const base = buildBase(change, ctx)
    // Figma groups have no own paints — drop accidental ones
    return { type: 'group', ...base, children }
  }

  const frame: FrameNode = {
    type: 'frame',
    ...buildBase(change, ctx),
    children,
    clip: change.type === 'SECTION' ? false : change.frameMaskDisabled !== true,
  }
  if (change.cornerRadius) frame.cornerRadius = change.cornerRadius
  const corners = perCornerRadius(change)
  if (corners) frame.cornerRadiusPerCorner = corners

  const layout = buildAutoLayout(change)
  if (layout) {
    frame.layout = layout
    // Hug sizing on the stack frame itself (when it is not a stack child,
    // applyStackChildProps does not run for it — e.g. pasted as a root)
    if (!frame.sizing) {
      const hug = hugSizing(change)
      const sizing: SizingProperties = {}
      if (hug.width) sizing.widthMode = 'fit_content'
      if (hug.height) sizing.heightMode = 'fit_content'
      if (sizing.widthMode || sizing.heightMode) frame.sizing = sizing
    }
  }
  return frame
}

const OVERRIDE_EXCLUDED_KEYS = new Set(['guid', 'guidPath', 'parentIndex', 'type', 'phase', 'styleID'])

function mergeChange(original: FigNodeChange, override: FigNodeChange): FigNodeChange {
  const merged: FigNodeChange = { ...original }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || OVERRIDE_EXCLUDED_KEYS.has(key)) continue
    ;(merged as Record<string, unknown>)[key] = value
  }
  return merged
}

function buildOverrideMap(change: FigNodeChange): Map<string, FigNodeChange> {
  const map = new Map<string, FigNodeChange>()
  const collect = (overrides: FigNodeChange[] | undefined) => {
    for (const override of overrides ?? []) {
      const guids = override.guidPath?.guids
      if (!guids || guids.length === 0) continue
      const key = guids.map(figGuidKey).join('/')
      const existing = map.get(key)
      map.set(key, existing ? mergeChange(existing, override) : override)
    }
  }
  collect(change.symbolData?.symbolOverrides)
  collect(change.derivedSymbolData)
  return map
}

function convertInstance(change: FigNodeChange, ctx: ConvertContext): SceneNode | null {
  const symbolKey = change.symbolData?.symbolID ? figGuidKey(change.symbolData.symbolID) : ''
  const symbol = symbolKey ? ctx.byGuid.get(symbolKey) : undefined
  if (!symbol) {
    ctx.warnings.push(
      `Component instance "${change.name ?? 'instance'}" has no master in the clipboard; pasted as a plain frame`,
    )
    const base = buildBase(change, ctx)
    return { type: 'frame', ...base, children: [], clip: true }
  }

  // Wrapper frame: symbol defaults + instance-level overrides (size, transform,
  // fills…); mergeChange skips undefined fields and keeps type pinned to FRAME
  const mergedChange = mergeChange({ ...symbol.change, type: 'FRAME' }, change)

  const instanceCtx: ConvertContext = {
    ...ctx,
    instance: { overrides: buildOverrideMap(change), path: [] },
  }
  const frame = convertFrame(
    { change: mergedChange, children: symbol.children },
    mergedChange,
    instanceCtx,
  )
  return frame
}

function convertNode(node: FigTreeNode, ctx: ConvertContext): SceneNode | null {
  let change = node.change

  // Apply instance overrides addressed to this node's guid path
  if (ctx.instance && change.guid) {
    const path = [...ctx.instance.path, figGuidKey(change.guid)]
    const override = ctx.instance.overrides.get(path.join('/'))
    if (override) change = mergeChange(change, override)
    ctx = { ...ctx, instance: { ...ctx.instance, path } }
  }

  switch (change.type) {
    case 'FRAME':
    case 'SECTION':
    case 'GROUP':
      return convertFrame(node, change, ctx)
    case 'SYMBOL':
      // A component master copied directly — paste as a regular frame
      return convertFrame(node, { ...change, type: 'FRAME' }, ctx)
    case 'INSTANCE':
      return convertInstance(change, ctx)
    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
      return convertRect(change, ctx)
    case 'ELLIPSE': {
      const arc = change.arcData
      const isFullEllipse =
        !arc ||
        ((arc.innerRadius ?? 0) === 0 &&
          Math.abs((arc.endingAngle ?? Math.PI * 2) - (arc.startingAngle ?? 0)) >= Math.PI * 2 - 1e-3)
      if (isFullEllipse) return convertEllipse(change, ctx)
      return convertVectorLike(change, ctx)
    }
    case 'LINE':
      return convertLine(change, ctx)
    case 'TEXT':
      return convertText(change, ctx)
    case 'VECTOR':
    case 'STAR':
    case 'REGULAR_POLYGON':
    case 'BOOLEAN_OPERATION':
    case 'HIGHLIGHT':
      return convertVectorLike(change, ctx)
    case 'SLICE':
    case 'WIDGET':
    case 'STAMP':
    case 'CONNECTOR':
    case 'STICKY':
    case 'CODE_BLOCK':
      return null
    default:
      // Unknown/new node type: salvage what we can through derived geometry
      if (change.fillGeometry?.length || change.strokeGeometry?.length) {
        return convertVectorLike(change, ctx)
      }
      ctx.warnings.push(`Unsupported Figma node type "${change.type ?? 'UNKNOWN'}" was skipped`)
      return null
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Convert a decoded Figma clipboard payload into editor scene nodes (1:1 layout). */
export function convertFigmaPasteToSceneNodes(data: FigPasteData): FigmaConversionResult {
  const { roots, byGuid } = buildFigTree(data)
  const ctx: ConvertContext = {
    blobs: data.message.blobs ?? [],
    byGuid,
    warnings: [],
  }
  const nodes = roots
    .map((root) => convertNode(root, ctx))
    .filter((node): node is SceneNode => node != null)
  return { nodes, warnings: ctx.warnings }
}
