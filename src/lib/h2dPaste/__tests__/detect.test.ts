import { describe, expect, it } from 'vitest'
import { isH2dClipboardHtml } from '../detect'
import { H2D_FIXTURE_HTML } from './h2dFixtureHtml'

describe('isH2dClipboardHtml', () => {
  it('detects a real h2d capture payload', () => {
    expect(isH2dClipboardHtml(H2D_FIXTURE_HTML)).toBe(true)
  })

  it('rejects a real Figma clipboard payload', () => {
    const figmaHtml =
      '<span data-metadata="<!--(figmeta)eyJhIjoxfQ==(/figmeta)-->"></span>' +
      '<span data-buffer="<!--(figma)Zm9v(/figma)-->"></span>'
    expect(isH2dClipboardHtml(figmaHtml)).toBe(false)
  })

  it('rejects plain HTML', () => {
    expect(isH2dClipboardHtml('<div>hello</div>')).toBe(false)
  })
})
