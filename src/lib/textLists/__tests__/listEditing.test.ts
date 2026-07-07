import { describe, expect, it } from 'vitest'
import { changeIndentLevel, continueListOnEnter, toggleListType } from '../listEditing'
import { MAX_INDENT_LEVEL } from '../paragraphs'

describe('continueListOnEnter', () => {
  it('continues the list: new paragraph inherits listType/indentLevel', () => {
    const result = continueListOnEnter([{ listType: 'bullet', indentLevel: 1 }], 1, 0, false)
    expect(result.exitedList).toBe(false)
    expect(result.paragraphs).toEqual([
      { listType: 'bullet', indentLevel: 1 },
      { listType: 'bullet', indentLevel: 1 },
    ])
  })

  it('exits the list when Enter is pressed on an empty list paragraph', () => {
    const result = continueListOnEnter([{ listType: 'bullet', indentLevel: 2 }], 1, 0, true)
    expect(result.exitedList).toBe(true)
    expect(result.paragraphs).toEqual([
      { listType: 'none', indentLevel: 0 },
      {},
    ])
  })

  it('plain (non-list) paragraphs just split with no list formatting', () => {
    const result = continueListOnEnter([{}], 1, 0, false)
    expect(result.exitedList).toBe(false)
    expect(result.paragraphs).toEqual([{}, { listType: 'none', indentLevel: 0 }])
  })

  it('splits in the middle of a multi-paragraph array at the right index', () => {
    const paragraphs = [{ listType: 'number' as const }, { listType: 'number' as const }, {}]
    const result = continueListOnEnter(paragraphs, 3, 1, false)
    expect(result.paragraphs).toEqual([
      { listType: 'number' },
      { listType: 'number' },
      { listType: 'number', indentLevel: 0 },
      {},
    ])
  })
})

describe('changeIndentLevel', () => {
  it('indents (Tab) by one level', () => {
    const result = changeIndentLevel([{ listType: 'bullet' }], 1, 0, 1)
    expect(result).toEqual([{ listType: 'bullet', indentLevel: 1 }])
  })

  it('outdents (Shift+Tab) by one level', () => {
    const result = changeIndentLevel([{ listType: 'bullet', indentLevel: 2 }], 1, 0, -1)
    expect(result).toEqual([{ listType: 'bullet', indentLevel: 1 }])
  })

  it('clamps at 0 (cannot outdent past the root)', () => {
    const result = changeIndentLevel([{}], 1, 0, -1)
    expect(result[0].indentLevel).toBe(0)
  })

  it('clamps at MAX_INDENT_LEVEL', () => {
    const result = changeIndentLevel([{ indentLevel: MAX_INDENT_LEVEL }], 1, 0, 1)
    expect(result[0].indentLevel).toBe(MAX_INDENT_LEVEL)
  })
})

describe('toggleListType', () => {
  it('turns bullet on for a plain paragraph', () => {
    const result = toggleListType([{}], 1, 0, 0, 'bullet')
    expect(result).toEqual([{ listType: 'bullet', indentLevel: 0 }])
  })

  it('turns bullet off when already bulleted (single paragraph)', () => {
    const result = toggleListType([{ listType: 'bullet' }], 1, 0, 0, 'bullet')
    expect(result).toEqual([{ listType: 'none' }])
  })

  it('turns on for a whole range when not all match', () => {
    const result = toggleListType([{ listType: 'bullet' }, {}], 2, 0, 1, 'bullet')
    expect(result).toEqual([
      { listType: 'bullet', indentLevel: 0 },
      { listType: 'bullet', indentLevel: 0 },
    ])
  })

  it('switching listType (bullet -> number) replaces rather than toggling off', () => {
    const result = toggleListType([{ listType: 'bullet' }], 1, 0, 0, 'number')
    expect(result).toEqual([{ listType: 'number', indentLevel: 0 }])
  })
})
