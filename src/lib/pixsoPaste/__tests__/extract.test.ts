import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import { extractPixsoDataFic } from '../extract'

describe('extractPixsoDataFic', () => {
  it('returns the base64 payload from a real capture', () => {
    const b64 = extractPixsoDataFic(rectHtml)
    expect(b64).toBeTruthy()
    expect(b64!.startsWith('cGl4c28ta3')).toBe(true) // "pixso-kw" base64 prefix
  })
  it('returns null when absent', () => {
    expect(extractPixsoDataFic('<span id="pixso-data"></span>')).toBeNull()
    expect(extractPixsoDataFic('nope')).toBeNull()
  })
})
