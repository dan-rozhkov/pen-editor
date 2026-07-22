import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import textHtml from './fixtures/text.html?raw'
import { convertPixsoClipboardHtml } from '../index'

describe('convertPixsoClipboardHtml', () => {
  it('returns null for non-Pixso html', async () => {
    expect(await convertPixsoClipboardHtml('<p>x</p>')).toBeNull()
  })
  it('converts the rect capture to a red 200x100 rect scene node', async () => {
    const res = await convertPixsoClipboardHtml(rectHtml)
    expect(res).not.toBeNull()
    expect(res!.nodes).toHaveLength(1)
    const node = res!.nodes[0]
    expect(node.type).toBe('rect')
    expect(Math.round(node.width)).toBe(200)
    expect(Math.round(node.height)).toBe(100)
    expect(node.fill).toBe('#ff0000')
  })
  it('converts the text capture to a text node with the characters', async () => {
    const res = await convertPixsoClipboardHtml(textHtml)
    const text = res!.nodes.find((n) => n.type === 'text') as { text?: string } | undefined
    expect(text?.text?.startsWith('Карточка товара')).toBe(true)
  })
})
