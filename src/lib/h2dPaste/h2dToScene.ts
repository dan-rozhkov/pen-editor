// Conversion of a decoded h2d clipboard document (see `h2dTypes.ts`) into
// native pen-editor SceneNodes. Pure — no DOM APIs — so it runs the same way
// in the browser and under a happy-dom test environment.
//
// Coordinate model: h2d node rects are ABSOLUTE page coordinates. The editor
// stores x/y relative to the parent, so every child's position is computed as
// `childRect - parentRect`. The BODY element becomes the root frame (its own
// extension chrome — e.g. capture.js's own toast overlay — lives as a HTML
// sibling of BODY and is never visited).

import { generateId, type Effect, type FrameNode, type GradientFill, type PerCornerRadius, type SceneNode, type ShadowEffect, type TextNode } from '@/types/scene'
import { extractCssUrl, parseColorWithOpacity } from '@/lib/htmlToDesign/colorParsing'
import { parseCssLinearGradient, parseCssRadialGradient } from '@/lib/htmlToDesign/gradientParsing'
import { applyTextProps, parseShadows } from '@/lib/htmlToDesign/styleApplication'
import { svgTextToDataUrl } from '@/lib/htmlToDesign/svgHandling'
import { base64ToBytes } from '@/lib/clipboardPayload'
import { maybeApplyAutoLayout } from './autoLayoutInference'
import { isH2dElementNode, isH2dTextNode } from './h2dTypes'
import type { H2dDocument, H2dElementNode, H2dNode, H2dRect, H2dTextNode as H2dTextNodeType } from './h2dTypes'

export interface H2dConversionResult {
  nodes: SceneNode[]
  warnings: string[]
}

interface ConvertCtx {
  document: H2dDocument
  warnings: string[]
  /** Per-node memoization for the visibility checks below — each is a pure
   * function of the node's subtree, but `hasVisibleContent` recurses through
   * `shouldSkipElement` and vice-versa, so without caching a deep tree gets
   * revisited once per ancestor query. */
  visibilityCache: WeakMap<H2dElementNode, boolean>
  skipCache: WeakMap<H2dElementNode, boolean>
  /** Resolved `data:` URLs are re-derived from the same asset the moment an
   * image/background is reused (e.g. a repeated icon) — memoize by raw URL. */
  assetUrlCache: Map<string, string | null>
}

function createConvertCtx(document: H2dDocument): ConvertCtx {
  return { document, warnings: [], visibilityCache: new WeakMap(), skipCache: new WeakMap(), assetUrlCache: new Map() }
}

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TEMPLATE'])

function isEmptyText(node: H2dTextNodeType): boolean {
  if (!node.text || node.text.trim() === '') return true
  if (node.rect.width <= 0 || node.rect.height <= 0) return true
  return false
}

function shouldSkipElementTag(node: H2dElementNode): boolean {
  if (SKIPPED_TAGS.has(node.tag.toUpperCase())) return true
  if (node.styles.display === 'none') return true
  return false
}

function hasVisibleContent(node: H2dElementNode, ctx: ConvertCtx): boolean {
  const cached = ctx.visibilityCache.get(node)
  if (cached !== undefined) return cached
  let result = false
  for (const child of node.childNodes) {
    if (isH2dTextNode(child)) {
      if (!isEmptyText(child)) {
        result = true
        break
      }
      continue
    }
    if (shouldSkipElementTag(child)) continue
    if (child.rect.width > 0 && child.rect.height > 0) {
      result = true
      break
    }
    if (hasVisibleContent(child, ctx)) {
      result = true
      break
    }
  }
  ctx.visibilityCache.set(node, result)
  return result
}

/** Zero-size elements with no visible descendants are noise (layout helpers, empty wrappers). */
function shouldSkipElement(node: H2dElementNode, ctx: ConvertCtx): boolean {
  const cached = ctx.skipCache.get(node)
  if (cached !== undefined) return cached
  let result: boolean
  if (shouldSkipElementTag(node)) {
    result = true
  } else if (node.rect.width > 0 && node.rect.height > 0) {
    result = false
  } else {
    result = !hasVisibleContent(node, ctx)
  }
  ctx.skipCache.set(node, result)
  return result
}

function visibleElementChildren(node: H2dElementNode, ctx: ConvertCtx): H2dElementNode[] {
  const out: H2dElementNode[] = []
  for (const child of node.childNodes) {
    if (isH2dElementNode(child) && !shouldSkipElement(child, ctx)) out.push(child)
  }
  return out
}

function visibleTextChildren(node: H2dElementNode): H2dTextNodeType[] {
  const out: H2dTextNodeType[] = []
  for (const child of node.childNodes) {
    if (isH2dTextNode(child) && !isEmptyText(child)) out.push(child)
  }
  return out
}

/** Find the BODY element inside the root, falling back to the root itself. */
function findBody(root: H2dNode): H2dElementNode | null {
  if (!isH2dElementNode(root)) return null
  if (root.tag.toUpperCase() === 'BODY') return root
  for (const child of root.childNodes) {
    const found = findBody(child)
    if (found) return found
  }
  return null
}

function relRect(rect: H2dRect, parentRect: H2dRect): { x: number; y: number; width: number; height: number } {
  return { x: rect.x - parentRect.x, y: rect.y - parentRect.y, width: rect.width, height: rect.height }
}

/** Parse a resolved CSS length like '16px' into a number; `undefined`/unparseable (`normal`, a percentage, ...) -> `null`. */
export function px(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/)
  if (!match) return null
  const n = parseFloat(match[1])
  return Number.isFinite(n) ? n : null
}

/** Uniform vs. per-corner border radius from the (only-non-default) resolved styles. */
function cornerRadiusFromStyles(styles: Record<string, string>): { cornerRadius?: number; cornerRadiusPerCorner?: PerCornerRadius } {
  const topLeft = px(styles.borderTopLeftRadius)
  const topRight = px(styles.borderTopRightRadius)
  const bottomRight = px(styles.borderBottomRightRadius)
  const bottomLeft = px(styles.borderBottomLeftRadius)
  const values = [topLeft, topRight, bottomRight, bottomLeft]
  if (values.every((v) => v === null)) return {}
  if (values.every((v) => v !== null) && new Set(values).size === 1) {
    return { cornerRadius: values[0] as number }
  }
  const perCorner: PerCornerRadius = {}
  if (topLeft !== null) perCorner.topLeft = topLeft
  if (topRight !== null) perCorner.topRight = topRight
  if (bottomRight !== null) perCorner.bottomRight = bottomRight
  if (bottomLeft !== null) perCorner.bottomLeft = bottomLeft
  return { cornerRadiusPerCorner: perCorner }
}

/**
 * Resolved `box-shadow` values (possibly a comma-separated multi-shadow list)
 * → effect(s), reusing the same parser as the live-DOM htmlToDesign import
 * path (`parseShadows` — handles multi-shadow lists and colors it can
 * recognize; shadows in a color syntax it can't parse, e.g. `oklch()`, are
 * dropped rather than producing garbage offsets).
 */
function effectsFromBoxShadow(value: string | undefined): Effect[] {
  if (!value) return []
  return parseShadows(value)
}

/** Uniform border{Top,Right,Bottom,Left}Width + solid borderColor → a stroke. Non-uniform borders are skipped with a warning. */
function strokeFromStyles(styles: Record<string, string>, ctx: ConvertCtx, name: string): { stroke?: string; strokeWidth?: number } {
  const widths = [
    px(styles.borderTopWidth),
    px(styles.borderRightWidth),
    px(styles.borderBottomWidth),
    px(styles.borderLeftWidth),
  ]
  const present = widths.filter((w): w is number => w !== null && w > 0)
  if (present.length === 0) return {}
  const style = styles.borderTopStyle ?? styles.borderStyle
  if (style && style !== 'solid') return {}
  if (new Set(widths.map((w) => w ?? 0)).size > 1) {
    ctx.warnings.push(`Non-uniform border on "${name}" skipped (only uniform borders are supported)`)
    return {}
  }
  const colorStr = styles.borderTopColor ?? styles.borderColor
  const parsedColor = colorStr ? parseColorWithOpacity(colorStr) : null
  if (!parsedColor) return {}
  return { stroke: parsedColor.color, strokeWidth: present[0] }
}

/** Fill (solid/gradient/image) derived from backgroundColor/backgroundImage. */
function applyBackground(base: Partial<FrameNode>, node: H2dElementNode, ctx: ConvertCtx): void {
  const bgColor = node.styles.backgroundColor
  if (bgColor) {
    const parsed = parseColorWithOpacity(bgColor)
    if (parsed) {
      base.fill = parsed.color
      if (parsed.opacity !== undefined) base.fillOpacity = parsed.opacity
    }
  }
  const bgImage = node.styles.backgroundImage
  if (bgImage && bgImage.includes('linear-gradient(')) {
    // Also matches repeating-linear-gradient: the parser reads the inner
    // linear-gradient stop list, giving a non-repeating approximation.
    const gradient: GradientFill | null = parseCssLinearGradient(bgImage)
    if (gradient) {
      base.gradientFill = gradient
      return
    }
  }
  if (bgImage && bgImage.includes('radial-gradient(')) {
    // Also matches repeating-radial-gradient, same approximation strategy as
    // the linear branch above.
    const gradient: GradientFill | null = parseCssRadialGradient(bgImage)
    if (gradient) {
      base.gradientFill = gradient
      return
    }
  }
  if (bgImage && /conic-gradient\(/.test(bgImage) && !base.fill) {
    // Unsupported gradient shape: degrade to the first stop color so the
    // element keeps a visible box instead of being dropped as invisible.
    const firstColor = bgImage.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/)?.[1]
    const parsed = firstColor ? parseColorWithOpacity(firstColor) : null
    if (parsed) {
      base.fill = parsed.color
      if (parsed.opacity !== undefined) base.fillOpacity = parsed.opacity
      return
    }
  }
  if (bgImage) {
    const rawUrl = extractCssUrl(bgImage)
    if (rawUrl) {
      const url = resolveAssetUrl(rawUrl, ctx)
      if (url) {
        base.imageFill = { url, mode: 'fill' }
        return
      }
    }
  }
}

function resolveAssetUrl(rawUrl: string, ctx: ConvertCtx): string | null {
  if (rawUrl.startsWith('data:')) return rawUrl
  const cached = ctx.assetUrlCache.get(rawUrl)
  if (cached !== undefined) return cached
  const asset = ctx.document.assets?.[rawUrl]
  let resolved: string | null
  if (asset?.blob) {
    // base64Blob is wrapped in a misleading `data:application/octet-stream;base64,`
    // prefix regardless of the real MIME type — strip it and re-prefix with the
    // asset's actual `blob.type`.
    const payload = asset.blob.base64Blob.replace(/^data:[^,]*,/, '')
    // Some captures ship an empty `blob.type` — default to a generic binary
    // MIME type rather than emitting an invalid `data:;base64,` URL.
    const mimeType = asset.blob.type || 'application/octet-stream'
    resolved = `data:${mimeType};base64,${payload}`
  } else {
    ctx.warnings.push(`Image asset not found in clipboard for "${rawUrl}" — kept as an external URL`)
    resolved = rawUrl
  }
  ctx.assetUrlCache.set(rawUrl, resolved)
  return resolved
}

function applyCommonProps(base: FrameNode, node: H2dElementNode, ctx: ConvertCtx): void {
  const { styles } = node
  const opacity = styles.opacity !== undefined ? parseFloat(styles.opacity) : undefined
  if (opacity !== undefined && Number.isFinite(opacity) && opacity < 1) base.opacity = opacity
  if (styles.overflow === 'hidden' || styles.overflow === 'clip' || styles.overflowX === 'hidden' || styles.overflowX === 'clip') {
    base.clip = true
  }
  const radii = cornerRadiusFromStyles(styles)
  if (radii.cornerRadius !== undefined) base.cornerRadius = radii.cornerRadius
  if (radii.cornerRadiusPerCorner) base.cornerRadiusPerCorner = radii.cornerRadiusPerCorner

  const stroke = strokeFromStyles(styles, ctx, node.tag)
  if (stroke.stroke) {
    base.stroke = stroke.stroke
    base.strokeWidth = stroke.strokeWidth
  }

  const shadows = effectsFromBoxShadow(styles.boxShadow)
  if (shadows.length === 1) {
    base.effect = shadows[0] as ShadowEffect
  } else if (shadows.length > 1) {
    base.effects = shadows
  }
}

/** Bare FrameNode skeleton shared by every conversion site that produces a frame. */
function makeFrame(name: string, x: number, y: number, width: number, height: number): FrameNode {
  return {
    id: generateId(),
    type: 'frame',
    name,
    x,
    y,
    width,
    height,
    children: [],
  }
}

function convertImage(node: H2dElementNode, parentRect: H2dRect, ctx: ConvertCtx): FrameNode {
  const rel = relRect(node.rect, parentRect)
  const frame = makeFrame(node.tag, rel.x, rel.y, rel.width, rel.height)
  const rawSrc = node.attributes.currentSrc ?? node.attributes.src
  if (rawSrc) {
    const url = resolveAssetUrl(rawSrc, ctx)
    if (url) frame.imageFill = { url, mode: 'fill' }
  } else {
    ctx.warnings.push(`IMG element has no resolvable source`)
  }
  applyCommonProps(frame, node, ctx)
  return frame
}

/** SVG element with inline `content` markup: embedded as a data-URL image fill (kept test-safe/DOM-free). */
function convertSvg(node: H2dElementNode, parentRect: H2dRect, ctx: ConvertCtx): FrameNode {
  const rel = relRect(node.rect, parentRect)
  const frame = makeFrame('SVG', rel.x, rel.y, rel.width, rel.height)
  if (node.content) {
    frame.imageFill = { url: svgTextToDataUrl(node.content), mode: 'fit' }
  } else {
    ctx.warnings.push('SVG element had no inline content — skipped fill')
  }
  applyCommonProps(frame, node, ctx)
  return frame
}

function svgAssetSize(rawUrl: string, ctx: ConvertCtx): { width: number; height: number } | null {
  const asset = ctx.document.assets?.[rawUrl]
  if (asset?.blob?.type !== 'image/svg+xml') return null
  try {
    const payload = asset.blob.base64Blob.replace(/^data:[^,]*,/, '')
    const svg = new TextDecoder().decode(base64ToBytes(payload))
    const width = parseFloat(svg.match(/\bwidth=["']([^"']+)["']/i)?.[1] ?? '')
    const height = parseFloat(svg.match(/\bheight=["']([^"']+)["']/i)?.[1] ?? '')
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) return { width, height }
    const viewBox = svg.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i)
    if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
  } catch {
    // Fall back to the standard icon size below when embedded SVG bytes are malformed.
  }
  return null
}

function convertInput(node: H2dElementNode, parentRect: H2dRect, ctx: ConvertCtx): FrameNode {
  const rel = relRect(node.rect, parentRect)
  const frame = makeFrame(node.tag, rel.x, rel.y, rel.width, rel.height)
  // An input's CSS background image is usually a small no-repeat adornment,
  // not a fill. Apply the solid background to the field and materialize the
  // image separately below so it keeps its intrinsic dimensions.
  const backgroundColor = node.styles.backgroundColor
  if (backgroundColor) {
    const parsed = parseColorWithOpacity(backgroundColor)
    if (parsed) {
      frame.fill = parsed.color
      if (parsed.opacity !== undefined) frame.fillOpacity = parsed.opacity
    }
  }
  applyCommonProps(frame, node, ctx)

  const children: SceneNode[] = []
  const rawBackgroundUrl = node.styles.backgroundImage ? extractCssUrl(node.styles.backgroundImage) : null
  if (rawBackgroundUrl && node.styles.backgroundRepeat === 'no-repeat') {
    const size = svgAssetSize(rawBackgroundUrl, ctx) ?? { width: 16, height: 16 }
    const x = px(node.styles.backgroundPositionX) ?? 0
    const y = node.styles.backgroundPositionY === '50%'
      ? (node.rect.height - size.height) / 2
      : (px(node.styles.backgroundPositionY) ?? 0)
    const url = resolveAssetUrl(rawBackgroundUrl, ctx)
    if (url) {
      const icon = makeFrame('Background image', x, y, size.width, size.height)
      icon.imageFill = { url, mode: 'fit' }
      children.push(icon)
    }
  }

  const value = node.attributes.value || node.attributes.placeholder
  if (value) {
    const isPlaceholder = !node.attributes.value && !!node.attributes.placeholder
    const placeholderStyles = isPlaceholder ? node.pseudoElementStyles?.placeholder : undefined
    const textStyles = { ...node.styles, ...placeholderStyles }
    const paddingLeft = px(node.styles.paddingLeft) ?? 0
    const paddingRight = px(node.styles.paddingRight) ?? 0
    const height = px(placeholderStyles?.height) ?? px(node.styles.lineHeight) ?? node.rect.height
    const width = px(placeholderStyles?.width) ?? Math.max(0, node.rect.width - paddingLeft - paddingRight)
    const textNode: TextNode = {
      id: generateId(),
      type: 'text',
      name: isPlaceholder ? 'Placeholder' : 'Value',
      x: paddingLeft,
      y: (node.rect.height - height) / 2,
      width,
      height,
      text: value,
      textWidthMode: 'fixed-height',
    }
    applyTextProps(textNode, textStyles)
    children.push(textNode)
  }
  frame.children = children
  return frame
}

function convertTextElement(node: H2dElementNode, textChildren: H2dTextNodeType[], parentRect: H2dRect): TextNode {
  // Union of the text nodes' rects, relative to the parent.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const t of textChildren) {
    minX = Math.min(minX, t.rect.x)
    minY = Math.min(minY, t.rect.y)
    maxX = Math.max(maxX, t.rect.x + t.rect.width)
    maxY = Math.max(maxY, t.rect.y + t.rect.height)
  }
  const rel = {
    x: minX - parentRect.x,
    y: minY - parentRect.y,
    width: maxX - minX,
    height: maxY - minY,
  }
  const text = normalizeCapturedText(textChildren.map((t) => t.text).join(''), node.styles.whiteSpace)
  const isMultiline = text.includes('\n') || textChildren.some((child) => (child.lineCount ?? 1) > 1)
  const textNode: TextNode = {
    id: generateId(),
    type: 'text',
    name: node.tag,
    x: rel.x,
    y: rel.y,
    width: rel.width,
    height: rel.height,
    text,
    // capture.js reports the rendered line count. Without an explicit fixed
    // mode Pixi treats width as hug-content and renders the entire value on a
    // single line, despite the captured width/height stored above.
    ...(isMultiline ? { textWidthMode: 'fixed-height' as const } : {}),
  }
  // `node.styles` is a plain Record<string, string> of resolved styles (not a
  // live CSSStyleDeclaration) — applyTextProps only reads a narrow, string-only
  // subset (TextStyleSource), so it works the same as it does against the DOM.
  applyTextProps(textNode, node.styles)
  return textNode
}

/**
 * HTML source indentation is included verbatim by capture.js even though normal
 * CSS whitespace collapsing never renders it. Keep genuinely inline trailing
 * spaces (for example `Hello ` before a nested link), and preserve whitespace
 * completely for preformatted elements.
 */
function normalizeCapturedText(text: string, whiteSpace: string | undefined): string {
  if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') return text
  if (!/[\r\n]/.test(text)) return text
  return text.replace(/[ \t\r\n\f]+/g, ' ').trim()
}

/**
 * Whether an element carries its own visible "box" (background, border,
 * shadow) worth preserving as a frame even when its only content is text —
 * e.g. a BUTTON with a white pill background must stay a frame wrapping a
 * text child, while a plain SPAN/H1/P with no box collapses straight to a
 * TextNode.
 */
function hasOwnVisualBox(styles: Record<string, string>): boolean {
  if (styles.backgroundColor) return true
  if (styles.backgroundImage) return true
  if (styles.boxShadow && styles.boxShadow !== 'none') return true
  if ([styles.borderTopWidth, styles.borderRightWidth, styles.borderBottomWidth, styles.borderLeftWidth].some((w) => (px(w) ?? 0) > 0)) {
    return true
  }
  return false
}

/**
 * Auto-layout is only attempted when every flow child of `frame` came
 * straight from `elementChildren` (same order, one-to-one) — i.e. the
 * element has no direct text content of its own. A direct text child
 * (`convertTextElement`) is always synthesized as the FIRST child regardless
 * of its real position in the original DOM order, so its presence would
 * make the flow order unreliable for verification; skipping it here is
 * conservative (never wrong, just occasionally misses a real flex box with
 * mixed text+element children).
 */
function applyAutoLayoutIfPossible(frame: FrameNode, styles: Record<string, string>, elementChildren: H2dElementNode[], textChildren: H2dTextNodeType[]): void {
  if (textChildren.length > 0 || elementChildren.length === 0) return
  maybeApplyAutoLayout(frame, styles, elementChildren.map((c) => c.styles))
}

function convertFrame(node: H2dElementNode, elementChildren: H2dElementNode[], textChildren: H2dTextNodeType[], parentRect: H2dRect, ctx: ConvertCtx): FrameNode {
  const rel = relRect(node.rect, parentRect)
  const frame = makeFrame(node.tag, rel.x, rel.y, rel.width, rel.height)
  applyBackground(frame, node, ctx)
  applyCommonProps(frame, node, ctx)
  const children: SceneNode[] = []
  if (textChildren.length > 0) {
    // Direct text content is synthesized as its own TextNode child, positioned
    // (relative to this element's own rect) from the union of the text nodes'
    // rects — this runs whether or not there are ALSO element children, so
    // `<p>Hello <a>world</a></p>` keeps the leading "Hello " text.
    children.push(convertTextElement(node, textChildren, node.rect))
  }
  if (elementChildren.length > 0) {
    for (const child of elementChildren) {
      const converted = convertElement(child, node.rect, ctx)
      if (converted) children.push(converted)
    }
  }
  frame.children = children
  applyAutoLayoutIfPossible(frame, node.styles, elementChildren, textChildren)
  return frame
}

function convertElement(node: H2dElementNode, parentRect: H2dRect, ctx: ConvertCtx): SceneNode | null {
  if (node.tag.toUpperCase() === 'INPUT') return convertInput(node, parentRect, ctx)
  if (node.tag.toUpperCase() === 'IMG') return convertImage(node, parentRect, ctx)
  if (node.tag.toUpperCase() === 'SVG') return convertSvg(node, parentRect, ctx)

  const elementChildren = visibleElementChildren(node, ctx)
  const textChildren = visibleTextChildren(node)
  if (elementChildren.length === 0 && textChildren.length > 0 && !hasOwnVisualBox(node.styles)) {
    return convertTextElement(node, textChildren, parentRect)
  }
  return convertFrame(node, elementChildren, textChildren, parentRect, ctx)
}

/** Convert a decoded h2d clipboard document into editor scene nodes (1:1 layout). */
export function convertH2dToSceneNodes(document: H2dDocument): H2dConversionResult {
  const ctx = createConvertCtx(document)
  const body = findBody(document.root)
  if (!body && isH2dElementNode(document.root)) {
    const rootRect = document.root.rect
    const converted = convertElement(document.root, rootRect, ctx)
    if (!converted) return { nodes: [], warnings: ctx.warnings }
    converted.x = 0
    converted.y = 0
    converted.name = document.documentTitle?.trim() || converted.name
    return { nodes: [converted], warnings: ctx.warnings }
  }
  if (!body) {
    return { nodes: [], warnings: ['h2d document has no convertible root element'] }
  }

  // Some full-page h2d captures keep BODY's resolved page styles in
  // `computedStyles` while `styles` is empty. Treat the explicit `styles`
  // values as overrides, matching normal CSS precedence, so the page frame
  // retains its background, clipping, effects, and layout properties.
  const styledBody: H2dElementNode = body.computedStyles
    ? { ...body, styles: { ...body.computedStyles, ...body.styles } }
    : body
  const rootRect = styledBody.rect
  // Deliberately NOT `makeFrame` + convertFrame's text-only fallback: the root
  // is always BODY (or the document root as a fallback), so its own direct
  // text content (if any) is discarded rather than nested as a text child —
  // only BODY's element children become the page's top-level nodes.
  const root = makeFrame(document.documentTitle?.trim() || 'Pasted page', 0, 0, rootRect.width, rootRect.height)
  applyBackground(root, styledBody, ctx)
  applyCommonProps(root, styledBody, ctx)
  const bodyElementChildren = visibleElementChildren(styledBody, ctx)
  const children: SceneNode[] = []
  for (const child of bodyElementChildren) {
    const converted = convertElement(child, rootRect, ctx)
    if (converted) children.push(converted)
  }
  root.children = children
  // BODY's own direct text (if any) is discarded (see comment above), so it
  // never counts as a `textChildren` blocker here — the root always
  // qualifies on that front the same way convertFrame's children do.
  applyAutoLayoutIfPossible(root, styledBody.styles, bodyElementChildren, [])

  return { nodes: [root], warnings: ctx.warnings }
}
