import { describe, expect, it } from 'vitest'
import { computeParagraphMarkerInfos } from '../markers'

describe('computeParagraphMarkerInfos', () => {
  it('returns null for every paragraph on plain text', () => {
    const node = { text: 'a\nb\nc', paragraphs: undefined }
    expect(computeParagraphMarkerInfos(node)).toEqual([null, null, null])
  })

  it('bullets every paragraph marked bullet at its own indent level', () => {
    const node = {
      text: 'a\nb',
      paragraphs: [{ listType: 'bullet' as const }, { listType: 'bullet' as const, indentLevel: 1 }],
    }
    expect(computeParagraphMarkerInfos(node)).toEqual([
      { listType: 'bullet', indentLevel: 0, text: '•' },
      { listType: 'bullet', indentLevel: 1, text: '◦' },
    ])
  })

  it('numbers a flat numbered list sequentially, 1-based', () => {
    const node = {
      text: 'a\nb\nc',
      paragraphs: [{ listType: 'number' as const }, { listType: 'number' as const }, { listType: 'number' as const }],
    }
    expect(computeParagraphMarkerInfos(node)).toEqual([
      { listType: 'number', indentLevel: 0, text: '1.' },
      { listType: 'number', indentLevel: 0, text: '2.' },
      { listType: 'number', indentLevel: 0, text: '3.' },
    ])
  })

  it('restarts numbering per nested indent level and resumes the parent level after', () => {
    // 1. a
    //    1. b   (nested)
    //    2. c   (nested continues)
    // 2. d      (back to level 0, continues from 1.)
    const node = {
      text: 'a\nb\nc\nd',
      paragraphs: [
        { listType: 'number' as const, indentLevel: 0 },
        { listType: 'number' as const, indentLevel: 1 },
        { listType: 'number' as const, indentLevel: 1 },
        { listType: 'number' as const, indentLevel: 0 },
      ],
    }
    expect(computeParagraphMarkerInfos(node)).toEqual([
      { listType: 'number', indentLevel: 0, text: '1.' },
      { listType: 'number', indentLevel: 1, text: '1.' },
      { listType: 'number', indentLevel: 1, text: '2.' },
      { listType: 'number', indentLevel: 0, text: '2.' },
    ])
  })

  it('a bullet/plain paragraph at a shallower level resets a deeper numbered run', () => {
    // 1. a (number, level 0)
    //    1. b (number, level 1)
    // - c   (bullet, level 0) -- resets level-1 counter
    //    1. d (number, level 1) -- restarts at 1
    const node = {
      text: 'a\nb\nc\nd',
      paragraphs: [
        { listType: 'number' as const, indentLevel: 0 },
        { listType: 'number' as const, indentLevel: 1 },
        { listType: 'bullet' as const, indentLevel: 0 },
        { listType: 'number' as const, indentLevel: 1 },
      ],
    }
    const result = computeParagraphMarkerInfos(node)
    expect(result[3]).toEqual({ listType: 'number', indentLevel: 1, text: '1.' })
  })

  it('mixes list and plain paragraphs, leaving plain ones null', () => {
    const node = {
      text: 'title\na\nb',
      paragraphs: [{}, { listType: 'number' as const }, { listType: 'number' as const }],
    }
    expect(computeParagraphMarkerInfos(node)).toEqual([
      null,
      { listType: 'number', indentLevel: 0, text: '1.' },
      { listType: 'number', indentLevel: 0, text: '2.' },
    ])
  })
})
