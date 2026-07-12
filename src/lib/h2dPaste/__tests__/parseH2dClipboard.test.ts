import { describe, expect, it } from 'vitest'
import { parseH2dClipboardHtml } from '../parseH2dClipboard'
import { H2D_FIXTURE_HTML } from './h2dFixtureHtml'
import { buildDocument, buildH2dClipboardHtml, el, rect, text } from './h2dFixture'
import type { H2dElementNode } from '../h2dTypes'
import { isH2dElementNode } from '../h2dTypes'

describe('parseH2dClipboardHtml', () => {
  it('parses the real captured fixture', () => {
    const { document, meta } = parseH2dClipboardHtml(H2D_FIXTURE_HTML)
    expect(document.documentTitle).toBe('Capture test page')
    expect(isH2dElementNode(document.root) && document.root.tag).toBe('HTML')
    expect(document.version).toBe(2)
    expect(meta.dataType).toBe('h2d')
  })

  it('throws a descriptive error when the base64 is garbage', () => {
    const html = '<span data-h2d="<!--(figh2d)not-valid-base64!!!(/figh2d)-->"></span>'
    expect(() => parseH2dClipboardHtml(html)).toThrow(/base64/i)
  })

  it('throws a descriptive error when the markers are absent', () => {
    expect(() => parseH2dClipboardHtml('<div>hello</div>')).toThrow(/no h2d data section/i)
  })

  it('throws a descriptive error when JSON is malformed', () => {
    const badJsonB64 = btoa('{not json')
    const html = `<span data-h2d="<!--(figh2d)${badJsonB64}(/figh2d)-->"></span>`
    expect(() => parseH2dClipboardHtml(html)).toThrow(/not valid json/i)
  })

  it('throws when the document has no root', () => {
    const badDocB64 = btoa(JSON.stringify({ documentTitle: 'x' }))
    const html = `<span data-h2d="<!--(figh2d)${badDocB64}(/figh2d)-->"></span>`
    expect(() => parseH2dClipboardHtml(html)).toThrow(/root/i)
  })

  it('preserves non-ASCII text (UTF-8 decoding, not plain atob)', () => {
    const body = el('BODY', rect(0, 0, 100, 40), {}, [text('Привет', rect(0, 0, 100, 40))])
    const doc = buildDocument(body, { documentTitle: 'Юникод' })
    const html = buildH2dClipboardHtml(doc)
    const { document } = parseH2dClipboardHtml(html)
    expect(document.documentTitle).toBe('Юникод')
    const bodyNode = (document.root as H2dElementNode).childNodes[0] as H2dElementNode
    const textNode = bodyNode.childNodes[0]
    expect(textNode.nodeType).toBe(3)
    expect((textNode as { text: string }).text).toBe('Привет')
  })
})
