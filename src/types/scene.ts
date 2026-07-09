import type { ThemeName, Variable } from './variable'
import type { Guide } from '../store/guidesStore'
import type { TextStyle } from './textStyle'
import type { FillStyle, EffectStyle } from './style'

// Variable binding to a variable (generic)
export interface VariableBinding {
  variableId: string
}

// Color binding (alias for backward compatibility)
export type ColorBinding = VariableBinding

// Image fill for shapes
export type ImageFillMode = 'fill' | 'fit' | 'stretch'

/**
 * Crop rect in normalized 0-1 source-image coordinates (Figma-style image
 * "Crop" mode). Selects the sub-region of the source image that is visible;
 * `x`/`y` is the top-left corner, `width`/`height` the extent, all as
 * fractions of the source image's natural dimensions. Absent means the whole
 * image is visible (equivalent to `{ x: 0, y: 0, width: 1, height: 1 }`) —
 * kept optional so existing `.pen` files without a crop keep loading
 * unchanged. See `@/lib/imageCrop/cropRect` for the clamp/pan/zoom helpers.
 */
export interface ImageCropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Non-destructive color-correction sliders for an image fill (Figma-style
 * image "Adjustments" panel). All values are `-100..100`, `0` meaning "no
 * change" — absent (or all-zero) is equivalent to no adjustments at all, so
 * existing `.pen` files without this field keep loading unchanged. See
 * `@/lib/imageAdjustments/imageAdjustments` for the clamp/default helpers and
 * the pure color-matrix builder used to render these on a Pixi sprite.
 */
export interface ImageAdjustments {
  brightness: number   // -100..100, exposure-style additive shift
  contrast: number      // -100..100
  saturation: number    // -100..100, -100 = grayscale
  temperature: number    // -100..100, negative = cooler/blue, positive = warmer/orange
  tint: number           // -100..100, negative = green, positive = magenta
}

export interface ImageFill {
  url: string              // data:image/... or https://...
  mode: ImageFillMode
  /** Optional crop applied on top of `mode` (see `ImageCropRect`). */
  crop?: ImageCropRect
  /** Optional non-destructive color corrections (see `ImageAdjustments`). */
  adjustments?: ImageAdjustments
}

/**
 * Playback configuration for a video fill (see `VideoFill`). Mirrors the
 * subset of HTML `<video>` attributes that make sense for a background/fill.
 *
 * `muted` deliberately defaults to `true`: every modern browser blocks
 * *unmuted* autoplay, so an autoplaying preview must stay muted unless the
 * user explicitly unmutes it. The Pixi renderer and the HTML exporter both
 * honor this — an unmuted+autoplay combination simply won't start playing in
 * most browsers, which is expected behaviour, not a bug.
 */
export interface VideoPlayback {
  autoplay: boolean
  loop: boolean
  muted: boolean
}

/**
 * A video fill for shapes/frames — the moving-image analogue of `ImageFill`.
 * Shares the exact same transform model as an image fill (`mode` +
 * `crop`), so the fill/fit/crop machinery in `@/lib/imageCrop/cropRect` is
 * reused verbatim for both. Adjustments (color correction) are intentionally
 * image-only and have no video equivalent here.
 *
 * `src` is the playable source (a `data:` or `https://` URL). `videoId` is an
 * optional asset-library id kept for provenance/future asset management; the
 * renderer always plays from `src`.
 */
export interface VideoFill {
  /** Optional asset-library id (provenance only — playback uses `src`). */
  videoId?: string
  src: string              // data:video/... or https://...
  playback: VideoPlayback
  /** Same fit model as an image fill: 'fill' | 'fit' | 'stretch'. */
  mode: ImageFillMode
  /** Optional crop applied on top of `mode` (see `ImageCropRect`). */
  crop?: ImageCropRect
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
  /**
   * When set, this paint layer is bound to a named `FillStyle` (see
   * `types/style.ts`) — the layer's own type-specific fields (color/gradient/
   * image/pattern) are a fallback used only if the referenced style is
   * missing (e.g. deleted). Resolution happens at render time
   * (`utils/fillUtils.ts#resolveFillStylePaint`), mirroring how `colorBinding`
   * resolves a variable reference. `detach` (see `store/styleStore.ts`)
   * clears this and copies the style's current value onto the layer inline.
   */
  styleId?: string
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

// Pattern fill: an image tile repeated across the fill area (Figma-style
// pattern paint). Phase 1 supports image tiles only (node-as-source is a
// possible later extension).
export interface PatternFill {
  url: string         // tile source: data:image/... or https://...
  scale?: number      // tile scale factor (>0), default 1
  spacingX?: number   // horizontal gap between tiles, px, default 0
  spacingY?: number   // vertical gap between tiles (rows), px, default 0
  offsetX?: number    // whole-pattern horizontal offset, px, default 0
  offsetY?: number    // whole-pattern vertical offset, px, default 0
  rowOffset?: number  // fraction (0-1) of a cell each row shifts (brick stagger), default 0
}

export interface PatternPaint extends PaintBase {
  type: 'pattern'
  pattern: PatternFill
}

/**
 * A video fill paint layer (see `VideoFill`). Rendered by the Pixi renderer as
 * a masked `<video>`-backed sprite (`pixi/renderers/videoFillHelpers.ts`) and
 * exported to HTML as a `<video>` element (`designToHtml`). Only one video
 * paint per node is rendered on the live canvas (the topmost one); additional
 * video paints below it are a documented no-op.
 */
export interface VideoPaint extends PaintBase {
  type: 'video'
  video: VideoFill
}

/**
 * One paint layer in a fill stack. `fills: Paint[]` is ordered bottom-to-top:
 * fills[0] renders first (bottom), the last element renders on top.
 */
export type Paint = SolidPaint | GradientPaint | ImagePaint | PatternPaint | VideoPaint

// Sizing modes for elements inside auto-layout containers
export type SizingMode = 'fixed' | 'fill_container' | 'fit_content'

export interface SizingProperties {
  widthMode?: SizingMode   // default: 'fixed'
  heightMode?: SizingMode  // default: 'fixed'
  // Min/max clamps applied to the resolved width/height inside an auto-layout
  // parent (fixed/fill/fit sizes are all clamped to this range). Figma parity.
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
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
  // Variable binding for the shadow color (resolves like `fillBinding`/
  // `colorBinding` — enables the style→variable→theme resolution chain when
  // this shadow lives inside an `EffectStyle`).
  colorBinding?: ColorBinding
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
 * Background blur (a.k.a. backdrop blur): unlike `BlurEffect`, which blurs the
 * node itself, this blurs whatever is rendered BEHIND the node (glassmorphism/
 * iOS-style "frosted glass" cards). Combine with a semi-transparent fill for
 * the classic frosted-glass look.
 */
export interface BackgroundBlurEffect {
  type: 'background-blur'
  radius: number      // px, 0-100 in the UI; <= 0 renders nothing
  // Stable id for UI list keys when used inside `effects: Effect[]`
  id?: string
  visible?: boolean   // defaults to true
}

/**
 * One effect layer in an effect stack. `effects: Effect[]` is ordered
 * bottom-to-top like `fills`. Shadows, layer blur, and background blur;
 * future effect kinds extend this union.
 */
export type Effect = ShadowEffect | BlurEffect | BackgroundBlurEffect

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
  /**
   * When set, references a named `EffectStyle` (see `types/style.ts`) whose
   * `effects` supersede this node's own `effects`/`effect` for rendering —
   * the whole stack is style-driven, mirroring Figma's "effect style"
   * (applies to the full shadow/blur stack, not a single layer). Resolved at
   * render time (`utils/fillUtils.ts#resolveEffectStack`). `detach` (see
   * `store/styleStore.ts`) clears this and copies the style's current
   * effects onto `effects` inline.
   */
  effectStyleId?: string
  /** Shader (paper-design/shaders), baked to a texture and rendered in Pixi. */
  shader?: ShaderConfig
  // Aspect ratio lock for proportional resize
  aspectRatioLocked?: boolean
  // Stored aspect ratio (width/height) when lock is enabled
  aspectRatio?: number
  // Absolute position inside auto-layout parent (excluded from flex flow)
  absolutePosition?: boolean
  /**
   * Figma-style constraints controlling how a child repositions/resizes when
   * its parent frame is resized. Only meaningful for direct children of a
   * `frame` node WITHOUT auto-layout enabled — auto-layout (Yoga) frames
   * ignore constraints entirely, sizing children via `sizing`/flex rules
   * instead. Undefined per axis defaults to `'min'` (pinned to the
   * left/top edge, fixed size) — matching pre-constraints behavior.
   */
  constraints?: NodeConstraints
  /**
   * Figma-style layer mask. When `true`, this node clips its siblings that
   * render ABOVE it (later in the parent's children order — z-order is
   * bottom-to-top by array index, see `flattenTree`/`childrenById`) within the
   * same parent, up to (but not including) the next masking sibling or the
   * end of the list. The masker itself is not rendered as normal content —
   * only its shape/alpha is used to clip.
   *
   * Mode is inferred from the node, not stored separately (minimum viable
   * per the Figma-parity spec: vector + alpha, no luminance mode yet):
   * - "vector": shape nodes (rect/ellipse/path/polygon/...) clip by their
   *   geometric outline (hard edges).
   * - "alpha": text nodes, or any node with an image paint. SVG export
   *   (`designToSvg`) renders these with a true luminance/alpha `<mask>`, but
   *   the live PixiJS canvas currently clips them to the same bounding shape
   *   as "vector" — real per-pixel transparency isn't respected there yet
   *   (see `pixi/renderers/maskHelpers.ts`).
   * See `@/lib/masks/maskResolution` for the pure resolution logic.
   */
  isMask?: boolean
}

/** Per-axis constraint mode (Figma parity). */
export type ConstraintMode = 'min' | 'max' | 'center' | 'stretch' | 'scale'

export interface NodeConstraints {
  horizontal: ConstraintMode
  vertical: ConstraintMode
}

// Auto-layout properties for Frame nodes
export type FlexDirection = 'row' | 'column'
export type AlignItems = 'flex-start' | 'center' | 'flex-end' | 'stretch'
export type JustifyContent = 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'

export interface LayoutProperties {
  autoLayout?: boolean // whether auto-layout is enabled
  flexDirection?: FlexDirection
  // Wrap children onto multiple lines (rows for a row container, columns for
  // a column container) once the main axis runs out of space. Default: false.
  flexWrap?: boolean
  // Single-value gap, applied to both axes when rowGap/columnGap are unset.
  // Kept for backward compatibility with existing .pen files.
  gap?: number
  // Per-axis gaps (CSS row-gap/column-gap semantics): rowGap is the space
  // between wrapped lines/rows, columnGap is the space between items within
  // a row. Either falls back to `gap` when unset.
  rowGap?: number
  columnGap?: number
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
  /**
   * Corner smoothing ("squircle") fraction, 0-1 (matches figma-squircle's own
   * convention; the UI shows it as 0-100%). 0 (or unset) = plain circular-arc
   * corners (current behavior). Applies uniformly to every rounded corner of
   * this shape, working alongside independent per-corner radii. See
   * `@/lib/shapePath/squircleCorner`.
   */
  cornerSmoothing?: number
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
  /**
   * Component properties declaration (only meaningful when `reusable` is true).
   * Each property is a typed axis (Figma-style component-set variant) that a
   * RefNode instance can select a value for via `RefNode.propertyValues`.
   */
  properties?: ComponentPropertyDef[]
}

/** Property types a reusable component can declare (variant enum, boolean, text). */
export type ComponentPropertyType = 'variant' | 'boolean' | 'text'

/**
 * Declares one switchable property on a reusable component. `bindingPath` is
 * the path of a descendant node (same addressing scheme as
 * `InstanceOverrides` keys — the child's id, or `parentId/childId` for nested
 * descendants) whose `bindingProp` the property controls. Resolving a
 * property's current value produces an "update" override at that path, so
 * property switching reuses the exact override-application machinery
 * instances already use (see `resolveRefToTree` / `@/utils/componentProperties`).
 */
export interface ComponentPropertyDef {
  id: string
  name: string
  type: ComponentPropertyType
  /** Allowed values for a `variant` property (required when type === 'variant'). */
  variantOptions?: string[]
  defaultValue: string | boolean
  bindingPath: string
  /**
   * Name of the node property at `bindingPath` this property controls (e.g.
   * `"text"`, `"visible"`, `"fill"`). Loosely typed (not `keyof
   * InstanceOverrideUpdateProps`) because that alias only exposes fields
   * common to every node type (an artifact of `keyof` over a union) — this
   * needs to reach type-specific fields like `TextNode.text` too.
   */
  bindingProp: string
}

export interface RectNode extends BaseNode {
  type: 'rect'
  cornerRadius?: number
  cornerRadiusPerCorner?: PerCornerRadius
  /** See `FrameNode.cornerSmoothing`. */
  cornerSmoothing?: number
}

export interface EllipseNode extends BaseNode {
  type: 'ellipse'
  /** Arc start angle in degrees (0 = rightmost point, clockwise). Default 0. */
  startAngle?: number
  /** Arc sweep in degrees, clamped to [-360, 360]. Default 360 (full ellipse). */
  sweepAngle?: number
  /** Donut hole radius as a ratio (0..1) of the outer radius. Default 0 (no hole). */
  innerRadiusRatio?: number
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

// List kind for a paragraph. 'none' = plain paragraph (default when unset).
export type ListType = 'none' | 'bullet' | 'number'

/**
 * Per-paragraph attributes, index-aligned with `TextNode.text.split('\n')`
 * (one entry per paragraph — a paragraph is a hard line break, same boundary
 * `wrapTextToLines`/`InlineTextEditor` already use). Missing entries (array
 * shorter than the paragraph count, or a `{}` entry) default to
 * `{ listType: 'none', indentLevel: 0 }` — see `getParagraphAttrs` in
 * `@/lib/textLists/paragraphs`.
 *
 * Deliberately a parallel array rather than restructuring `text` into a
 * richer paragraph/run model: every existing single-string consumer (canvas
 * measurement, the Pixi renderer's non-list fast path, the contentEditable
 * round-trip, designToHtml/htmlToDesign, the AI tool contract) keeps working
 * unchanged when this field is absent.
 *
 * Extension point: this is also where future paragraph-level formatting
 * (e.g. per-paragraph spacing-before/after) should live — add fields to
 * `ParagraphAttrs` rather than introducing a second parallel array.
 */
export interface ParagraphAttrs {
  listType?: ListType
  indentLevel?: number // 0-based, clamped to [0, MAX_INDENT_LEVEL] — see textLists/paragraphs.ts
}

/**
 * A hyperlink attached to a text node (Figma "Link" attribute). Like every
 * other typographic attribute in this codebase (bold/italic/underline/color),
 * there is no per-character span/run model here — `link` applies to the
 * node's ENTIRE text content, not a sub-string of mixed content. See
 * `@/lib/textLink` for the shared color constant, markdown-link parser, and
 * "has an explicit color" helper used by the renderer/inline-editor/HTML
 * exporter to decide when to fall back to the default link color.
 */
export interface TextLink {
  url: string
  title?: string
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  /** See `ParagraphAttrs` doc comment. Optional — absent means every paragraph is plain. */
  paragraphs?: ParagraphAttrs[]
  fontSize?: number
  fontFamily?: string
  // Font weight: "normal", "bold", or numeric "100"-"900"
  fontWeight?: string
  // Font style: "normal" or "italic"
  fontStyle?: string
  // Text decoration
  underline?: boolean
  strikethrough?: boolean
  // Hyperlink for the whole node's text content. Renders with a forced
  // underline and a default link color (unless `fill`/`fills` is set) —
  // see `TextLink` doc comment.
  link?: TextLink
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
  // Extra vertical gap, in px, inserted after each paragraph (a paragraph is a
  // hard line break — same boundary as `splitParagraphs`/`ParagraphAttrs`).
  // Default 0 (no extra gap). Included in auto-size/hug height measurement
  // (`measureTextAutoSize`/`measureTextFixedWidthHeight`) and rendered
  // identically by the Pixi renderer and the inline contentEditable editor
  // (as `margin-bottom` on each paragraph's line div).
  paragraphSpacing?: number
  // OpenType Variable Font axis values, e.g. { wght: 530, opsz: 24, wdth: 87 }.
  // Keys are 4-char axis tags (see `utils/variableFont.ts`'s `AXIS_LABELS` for the
  // ones with dedicated UI sliders — arbitrary tags are still forwarded to CSS
  // `font-variation-settings` / Pixi's font-weight approximation). Only meaningful
  // when `fontFamily` is a known variable font (`getVariableFontAxes`); absent
  // (or the font isn't variable) means "use static fontWeight/fontStyle only".
  fontVariations?: Record<string, number>
  // Text transform (visual only, applied at render/measure time)
  textTransform?: TextTransform
  // Truncate overflowing text with an ellipsis ("…"). Figma "Truncate text".
  // Only meaningful in wrapped modes ('fixed' / 'fixed-height'): in 'fixed-height'
  // lines past the box height are dropped; combine with maxLines for a tighter cap.
  truncateText?: boolean
  // Optional hard cap on the number of rendered lines (>= 1). When the wrapped
  // text exceeds it, the last kept line ends with an ellipsis. Figma "Max lines".
  maxLines?: number
  // Bound named text style (see `types/textStyle.ts`). When set, the node's own
  // typography fields above (fontFamily, fontSize, ...) are kept in sync with the
  // style and are the values actually rendered/measured — `textStyleId` only
  // tracks provenance so future style edits know which nodes to update and the UI
  // can show a "linked to style" affordance.
  textStyleId?: string
  // Typography property keys (a subset of `TEXT_STYLE_PROPERTY_KEYS`) that have
  // been locally edited since the style was applied. Centralized style edits skip
  // these keys for this node ("local override", mirrors ref-instance overrides).
  textStyleOverrides?: string[]
}

export interface GroupNode extends BaseNode {
  type: 'group'
  children: SceneNode[]
  // SVG clip-path geometry for clipping this group
  clipGeometry?: string
  clipBounds?: { x: number; y: number; width: number; height: number }
}

export interface PathHandle {
  x: number
  y: number
}

// Structured anchor for the pen tool / path point-edit mode. Coordinates live
// in the same space as `PathNode.geometry`/`geometryBounds` (see pathAnchors.ts).
// Optional so existing/legacy paths (pencil strokes drawn before this model,
// imported SVGs, old .pen files) keep loading and rendering from `geometry`
// alone — `points`/`closed` are lazily derived from `geometry` the first time
// a path is entered into point-edit mode, and kept as the source of truth
// (with `geometry` regenerated from them) from then on.
export interface PathAnchor {
  x: number
  y: number
  handleIn?: PathHandle | null
  handleOut?: PathHandle | null
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
  // Structured anchor model backing `geometry` for the pen tool / point-edit
  // mode (see PathAnchor doc comment). Absent on legacy/imported paths until
  // first edited.
  points?: PathAnchor[]
  closed?: boolean
}

/** Endpoint decoration for a line/connector. */
export type LineCapShape = 'none' | 'arrow' | 'triangle' | 'circle' | 'bar'

export interface LineNode extends BaseNode {
  type: 'line'
  points: number[]  // [x1, y1, x2, y2] relative to node x,y
  /** Cap shape at (points[0], points[1]). Default 'none'. */
  startCap?: LineCapShape
  /** Cap shape at (points[2], points[3]). Default 'none'. */
  endCap?: LineCapShape
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
  sides?: number    // number of sides (regular polygon) or points/rays (star), default 6
  /**
   * Star inner-radius ratio (0..1), relative to the outer radius. When set
   * (and < 1) the node renders as a star with `sides` rays instead of a
   * regular polygon. Undefined/1 means a plain regular polygon.
   */
  innerRadiusRatio?: number
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
  /** Selected values for the component's declared `properties`, keyed by property id. */
  propertyValues?: Record<string, string | boolean>
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
  /** Persistent ruler guides for the current page, at the time of the snapshot. */
  guides?: Guide[]
  /** Named reusable text styles, at the time of the snapshot. */
  textStyles?: TextStyle[]
  /** Named reusable fill/color styles, at the time of the snapshot. */
  fillStyles?: FillStyle[]
  /** Named reusable effect styles, at the time of the snapshot. */
  effectStyles?: EffectStyle[]
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
