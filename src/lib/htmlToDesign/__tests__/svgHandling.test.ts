import { describe, expect, it } from 'vitest'
import { normalizeSvgMarkup } from '../svgHandling'

describe('normalizeSvgMarkup', () => {
  it('injects fallback width/height/viewBox when none are present', () => {
    const out = normalizeSvgMarkup('<svg><path d="M0 0L10 10"/></svg>', 24, 24)
    expect(out).toMatch(/width="24"/)
    expect(out).toMatch(/height="24"/)
    expect(out).toMatch(/viewBox="0 0 24 24"/)
    expect(out).toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(out).toContain('<path d="M0 0L10 10"/>')
  })

  it('preserves an existing width/height instead of overwriting with the fallback', () => {
    const out = normalizeSvgMarkup('<svg width="40" height="20"><path/></svg>', 24, 24)
    expect(out).toMatch(/width="40"/)
    expect(out).toMatch(/height="20"/)
    expect(out).toMatch(/viewBox="0 0 40 20"/)
  })

  it('derives width/height from an existing viewBox when no width/height attrs are present', () => {
    const out = normalizeSvgMarkup('<svg viewBox="0 0 32 16"><path/></svg>', 999, 999)
    expect(out).toMatch(/width="32"/)
    expect(out).toMatch(/height="16"/)
    expect(out.match(/viewBox=/g)).toHaveLength(1)
  })

  it('falls back to a sane default when fallback dimensions are non-positive and no attrs/viewBox exist', () => {
    const out = normalizeSvgMarkup('<svg><path/></svg>', 0, -1)
    expect(out).toMatch(/width="24"/)
    expect(out).toMatch(/height="24"/)
  })

  it('does not treat root stroke-width as the svg width (Feather/Lucide icons)', () => {
    // No real width/height; only stroke-width and a viewBox. width/height must
    // be injected from the viewBox, not read from `stroke-width`.
    const out = normalizeSvgMarkup('<svg viewBox="0 0 24 24" stroke-width="2"><path/></svg>', 0, 0)
    expect(out).toMatch(/(?:\s)width="24"/)
    expect(out).toMatch(/(?:\s)height="24"/)
    expect(out).toContain('stroke-width="2"')
  })

  it('returns non-svg input unchanged', () => {
    const out = normalizeSvgMarkup('<div>not svg</div>', 24, 24)
    expect(out).toBe('<div>not svg</div>')
  })

  it('does not touch inner markup, only the root <svg> opening tag', () => {
    const inner = '<path width="1" viewBox="weird"/>'
    const out = normalizeSvgMarkup(`<svg>${inner}</svg>`, 24, 24)
    expect(out).toContain(inner)
  })
})
