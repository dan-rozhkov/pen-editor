// Slim type definitions for the decoded Figma clipboard payload (fig-kiwi message).
// Field names follow Figma's internal kiwi schema; everything is optional because
// the schema is versioned and self-describing — only fields we map are listed.

export interface FigGUID {
  sessionID: number
  localID: number
}

export interface FigColor {
  r: number
  g: number
  b: number
  a: number
}

export interface FigVector {
  x: number
  y: number
}

export interface FigMatrix {
  m00: number
  m01: number
  m02: number
  m10: number
  m11: number
  m12: number
}

export interface FigColorStop {
  color: FigColor
  position: number
}

export interface FigImage {
  hash?: Uint8Array
  name?: string
  dataBlob?: number
}

export interface FigPaint {
  type?:
    | 'SOLID'
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
    | 'IMAGE'
    | 'EMOJI'
  color?: FigColor
  opacity?: number
  visible?: boolean
  stops?: FigColorStop[]
  transform?: FigMatrix
  image?: FigImage
  imageScaleMode?: 'STRETCH' | 'FIT' | 'FILL' | 'TILE'
}

export interface FigFontName {
  family: string
  style: string
  postscript?: string
}

export interface FigNumber {
  value: number
  units: 'RAW' | 'PIXELS' | 'PERCENT'
}

export interface FigTextData {
  characters?: string
  characterStyleIDs?: number[]
  // Entries are NodeChange-shaped style patches keyed by styleID
  styleOverrideTable?: FigNodeChange[]
}

export interface FigEffect {
  type?: 'INNER_SHADOW' | 'DROP_SHADOW' | 'FOREGROUND_BLUR' | 'BACKGROUND_BLUR'
  color?: FigColor
  offset?: FigVector
  radius?: number
  visible?: boolean
  spread?: number
}

export interface FigPath {
  windingRule?: 'NONZERO' | 'ODD'
  commandsBlob?: number
  styleID?: number
}

export interface FigParentIndex {
  guid: FigGUID
  position: string
}

export interface FigVectorData {
  vectorNetworkBlob?: number
  normalizedSize?: FigVector
}

export interface FigGUIDPath {
  guids?: FigGUID[]
}

export interface FigSymbolData {
  symbolID?: FigGUID
  symbolOverrides?: FigNodeChange[]
  uniformScaleFactor?: number
}

export interface FigArcData {
  startingAngle?: number
  endingAngle?: number
  innerRadius?: number
}

export type FigStackSize = 'FIXED' | 'RESIZE_TO_FIT' | 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'

export type FigNodeType =
  | 'NONE'
  | 'DOCUMENT'
  | 'CANVAS'
  | 'GROUP'
  | 'FRAME'
  | 'BOOLEAN_OPERATION'
  | 'VECTOR'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'RECTANGLE'
  | 'REGULAR_POLYGON'
  | 'ROUNDED_RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'SYMBOL'
  | 'INSTANCE'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'CODE_BLOCK'
  | 'WIDGET'
  | 'STAMP'
  | 'MEDIA'
  | 'HIGHLIGHT'
  | 'SECTION'
  | 'SECTION_OVERLAY'
  | 'WASHI_TAPE'
  | 'VARIABLE'

export interface FigNodeChange {
  guid?: FigGUID
  phase?: 'CREATED' | 'REMOVED'
  parentIndex?: FigParentIndex
  type?: FigNodeType
  name?: string
  visible?: boolean
  opacity?: number
  size?: FigVector
  transform?: FigMatrix
  mask?: boolean
  maskIsOutline?: boolean
  cornerRadius?: number
  strokeWeight?: number
  borderTopWeight?: number
  borderRightWeight?: number
  borderBottomWeight?: number
  borderLeftWeight?: number
  borderStrokeWeightsIndependent?: boolean
  strokeAlign?: 'CENTER' | 'INSIDE' | 'OUTSIDE'
  strokeCap?: string
  strokeJoin?: 'MITER' | 'BEVEL' | 'ROUND'
  fillPaints?: FigPaint[]
  strokePaints?: FigPaint[]
  effects?: FigEffect[]
  fillGeometry?: FigPath[]
  strokeGeometry?: FigPath[]
  vectorData?: FigVectorData
  arcData?: FigArcData
  // Text
  fontSize?: number
  fontName?: FigFontName
  // Present on textData.styleOverrideTable entries — a text *character run*
  // style id, unrelated to shared paint/effect styles. There is no field
  // here for a fill/stroke/effect style id or name/definition table; see
  // the p1-21 note atop `figmaToScene/paints.ts`.
  styleID?: number
  textData?: FigTextData
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM'
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED'
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH'
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT'
  lineHeight?: FigNumber
  letterSpacing?: FigNumber
  // Corner radii (rectangles)
  rectangleTopLeftCornerRadius?: number
  rectangleTopRightCornerRadius?: number
  rectangleBottomLeftCornerRadius?: number
  rectangleBottomRightCornerRadius?: number
  rectangleCornerRadiiIndependent?: boolean
  // Frames / groups
  resizeToFit?: boolean
  frameMaskDisabled?: boolean
  // Auto-layout (container)
  stackMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL'
  stackSpacing?: number
  stackPadding?: number
  stackHorizontalPadding?: number
  stackVerticalPadding?: number
  stackPaddingRight?: number
  stackPaddingBottom?: number
  stackPrimaryAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_EVENLY' | 'SPACE_BETWEEN'
  stackCounterAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE'
  stackPrimarySizing?: FigStackSize
  stackCounterSizing?: FigStackSize
  // Auto-layout (child-in-stack)
  stackChildPrimaryGrow?: number
  stackChildAlignSelf?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'AUTO' | 'BASELINE'
  stackPositioning?: 'AUTO' | 'ABSOLUTE'
  // Components
  symbolData?: FigSymbolData
  derivedSymbolData?: FigNodeChange[]
  overriddenSymbolID?: FigGUID
  guidPath?: FigGUIDPath
  overrideKey?: FigGUID
  internalOnly?: boolean
}

export interface FigBlob {
  bytes: Uint8Array
}

export interface FigMessage {
  type?: string
  nodeChanges?: FigNodeChange[]
  blobs?: FigBlob[]
  // Absolute index of the first blob shipped in `blobs`. Clipboard payloads
  // carry only a *slice* of the document's blob table, so every blob reference
  // (image.dataBlob, commandsBlob, vectorNetworkBlob) is an absolute index that
  // must be offset by this value: blobs[ref - blobBaseIndex]. Full .fig files
  // start at 0; partial copies do not. See parseFigmaClipboard.
  blobBaseIndex?: number
}

export interface FigClipboardMeta {
  fileKey?: string
  pasteID?: number
  dataType?: string
}

/** A decoded Figma clipboard payload. */
export interface FigPasteData {
  meta: FigClipboardMeta
  message: FigMessage
  version: number
}

export function figGuidKey(guid: FigGUID | undefined): string {
  if (!guid) return ''
  return `${guid.sessionID}:${guid.localID}`
}
