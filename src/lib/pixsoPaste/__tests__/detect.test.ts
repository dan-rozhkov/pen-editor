import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import { isPixsoClipboardHtml } from '../detect'

describe('isPixsoClipboardHtml', () => {
  it('accepts a real Pixso payload', () => {
    expect(isPixsoClipboardHtml(rectHtml)).toBe(true)
  })
  it('accepts the HTML-escaped sentinel variant', () => {
    expect(isPixsoClipboardHtml('&lt;!--PixsoClipboardData--&gt;<span></span>')).toBe(true)
  })
  it('rejects Figma / plain / empty', () => {
    expect(isPixsoClipboardHtml('<!--(figma)abc(/figma)-->')).toBe(false)
    expect(isPixsoClipboardHtml('<p>hello</p>')).toBe(false)
    expect(isPixsoClipboardHtml('')).toBe(false)
  })
})
