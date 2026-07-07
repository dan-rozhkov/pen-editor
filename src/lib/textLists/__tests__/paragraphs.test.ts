import { describe, expect, it } from 'vitest'
import {
  MAX_INDENT_LEVEL,
  getBulletGlyph,
  getParagraphAttrs,
  hasActiveList,
  normalizeParagraphs,
  splitParagraphs,
} from '../paragraphs'

describe('splitParagraphs', () => {
  it('splits on hard line breaks', () => {
    expect(splitParagraphs('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('a single-line string is one paragraph', () => {
    expect(splitParagraphs('hello')).toEqual(['hello'])
  })
})

describe('getParagraphAttrs', () => {
  it('defaults to none/0 when paragraphs is absent', () => {
    expect(getParagraphAttrs({ paragraphs: undefined }, 0)).toEqual({ listType: 'none', indentLevel: 0 })
  })

  it('defaults missing indices even when the array exists', () => {
    const node = { paragraphs: [{ listType: 'bullet' as const }] }
    expect(getParagraphAttrs(node, 5)).toEqual({ listType: 'none', indentLevel: 0 })
  })

  it('fills in listType/indentLevel defaults on a partial entry', () => {
    const node = { paragraphs: [{ indentLevel: 2 }] }
    expect(getParagraphAttrs(node, 0)).toEqual({ listType: 'none', indentLevel: 2 })
  })

  it('clamps indentLevel to [0, MAX_INDENT_LEVEL]', () => {
    expect(getParagraphAttrs({ paragraphs: [{ indentLevel: -3 }] }, 0).indentLevel).toBe(0)
    expect(getParagraphAttrs({ paragraphs: [{ indentLevel: 999 }] }, 0).indentLevel).toBe(MAX_INDENT_LEVEL)
  })
})

describe('normalizeParagraphs', () => {
  it('pads short arrays with defaults', () => {
    expect(normalizeParagraphs([{ listType: 'bullet' }], 3)).toEqual([{ listType: 'bullet' }, {}, {}])
  })

  it('truncates long arrays', () => {
    expect(normalizeParagraphs([{}, {}, { listType: 'number' }], 2)).toEqual([{}, {}])
  })

  it('is a no-op copy when the length already matches', () => {
    const input = [{ listType: 'bullet' as const }]
    const result = normalizeParagraphs(input, 1)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })
})

describe('getBulletGlyph', () => {
  it('cycles through glyphs by indent level', () => {
    expect(getBulletGlyph(0)).toBe('•')
    expect(getBulletGlyph(1)).toBe('◦')
    expect(getBulletGlyph(2)).toBe('▪')
    expect(getBulletGlyph(3)).toBe('•') // wraps around
  })
})

describe('hasActiveList', () => {
  it('is false with no paragraphs field', () => {
    expect(hasActiveList({ text: 'a\nb', paragraphs: undefined })).toBe(false)
  })

  it('is false when every paragraph is listType none', () => {
    expect(hasActiveList({ text: 'a\nb', paragraphs: [{}, { listType: 'none' }] })).toBe(false)
  })

  it('is true when any paragraph has an active list', () => {
    expect(hasActiveList({ text: 'a\nb', paragraphs: [{}, { listType: 'bullet' }] })).toBe(true)
  })
})
