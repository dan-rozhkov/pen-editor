// Slim type definitions for the decoded html.to.design / Figma-capture
// ("h2d") clipboard payload. Only the fields the converter actually reads
// are declared — the real payload carries many more (see the captured
// fixture in `__tests__/h2dFixtureHtml.ts`).

export interface H2dRect {
  x: number
  y: number
  width: number
  height: number
  // Present on rotated/skewed elements; unused by the converter (rect is
  // the axis-aligned bounding box already).
  quad?: unknown
}

/** An element node (`nodeType === 1`). */
export interface H2dElementNode {
  nodeType: 1
  id: string
  tag: string
  attributes: Record<string, string>
  styles: Record<string, string>
  computedStyles?: Record<string, string>
  rect: H2dRect
  childNodes: H2dNode[]
  /** Serialized outer `<svg>...</svg>` markup, present when `tag === 'SVG'`. */
  content?: string
}

/** A text node (`nodeType === 3`). */
export interface H2dTextNode {
  nodeType: 3
  id: string
  text: string
  rect: H2dRect
  lineCount?: number
}

export type H2dNode = H2dElementNode | H2dTextNode

export interface H2dAssetBlob {
  type: string
  /** `data:application/octet-stream;base64,<payload>` — the mime prefix is a lie; strip it and re-prefix with `type`. */
  base64Blob: string
}

export interface H2dAsset {
  url: string
  blob: H2dAssetBlob | null
}

export interface H2dFontUsage {
  [key: string]: unknown
}

export interface H2dFont {
  familyName: string
  faces?: unknown[]
  usages?: H2dFontUsage[]
}

/** The decoded h2d clipboard document (version 2). */
export interface H2dDocument {
  documentTitle: string
  root: H2dNode
  documentRect: { x: number; y: number; width: number; height: number }
  viewportRect?: { x: number; y: number; width: number; height: number }
  devicePixelRatio?: number
  version: number
  assets: Record<string, H2dAsset>
  fonts?: Record<string, H2dFont>
}

export interface H2dClipboardMeta {
  dataType?: string
  source?: string
  capturedAtIso?: string
}

export function isH2dElementNode(node: H2dNode): node is H2dElementNode {
  return node.nodeType === 1
}

export function isH2dTextNode(node: H2dNode): node is H2dTextNode {
  return node.nodeType === 3
}
