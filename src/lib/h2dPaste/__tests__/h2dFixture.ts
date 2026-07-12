// Synthetic h2d clipboard payload builder for tests — encodes a document the
// same way capture.js does (base64 of UTF-8 JSON bytes, wrapped in the
// `(figh2d)`/`(figmeta)` markers) without needing a real capture.
import type { H2dDocument, H2dElementNode, H2dNode, H2dRect, H2dTextNode } from '../h2dTypes'

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Wrap an h2d document in clipboard HTML exactly like capture.js does. */
export function buildH2dClipboardHtml(document: H2dDocument, meta: object = { dataType: 'h2d', source: 'mcp' }): string {
  const metaB64 = utf8ToBase64(JSON.stringify(meta))
  const dataB64 = utf8ToBase64(JSON.stringify(document))
  return (
    `<span data-metadata="<!--(figmeta)${metaB64}(/figmeta)-->"></span>` +
    `<span data-h2d="<!--(figh2d)${dataB64}(/figh2d)-->"></span>`
  )
}

let nextId = 1
function id(): string {
  return `h2d-node-${nextId++}`
}

export function rect(x: number, y: number, width: number, height: number): H2dRect {
  return { x, y, width, height }
}

export function el(
  tag: string,
  r: H2dRect,
  styles: Record<string, string> = {},
  childNodes: H2dNode[] = [],
  attributes: Record<string, string> = {},
): H2dElementNode {
  return { nodeType: 1, id: id(), tag, attributes, styles, rect: r, childNodes }
}

export function text(value: string, r: H2dRect): H2dTextNode {
  return { nodeType: 3, id: id(), text: value, rect: r }
}

export function svgEl(r: H2dRect, content: string, styles: Record<string, string> = {}): H2dElementNode {
  return { nodeType: 1, id: id(), tag: 'SVG', attributes: {}, styles, rect: r, childNodes: [], content }
}

export function buildDocument(body: H2dElementNode, opts: Partial<H2dDocument> = {}): H2dDocument {
  const html: H2dElementNode = {
    nodeType: 1,
    id: id(),
    tag: 'HTML',
    attributes: {},
    styles: {},
    rect: body.rect,
    childNodes: [body],
  }
  return {
    documentTitle: 'Test page',
    root: html,
    documentRect: body.rect,
    version: 2,
    assets: {},
    ...opts,
  }
}
