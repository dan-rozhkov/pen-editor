import { describe, expect, it } from 'vitest'
import type { FrameNode, ShadowEffect, TextNode } from '@/types/scene'
import { calculateFrameLayout } from '@/utils/yogaLayout'
import { convertH2dToSceneNodes } from '../h2dToScene'
import { parseH2dClipboardHtml } from '../parseH2dClipboard'
import { H2D_FIXTURE_HTML } from './h2dFixtureHtml'
import { buildDocument, el, rect, text } from './h2dFixture'

function convertFixture() {
  const { document } = parseH2dClipboardHtml(H2D_FIXTURE_HTML)
  return convertH2dToSceneNodes(document)
}

function findByName(node: FrameNode, name: string): FrameNode | undefined {
  if (node.name === name) return node
  for (const child of node.children) {
    if (child.type === 'frame') {
      const found = findByName(child as FrameNode, name)
      if (found) return found
    }
  }
  return undefined
}

function collectTexts(node: FrameNode, out: TextNode[] = []): TextNode[] {
  for (const child of node.children) {
    if (child.type === 'text') out.push(child as TextNode)
    else if (child.type === 'frame') collectTexts(child as FrameNode, out)
  }
  return out
}

describe('convertH2dToSceneNodes (real fixture)', () => {
  it('produces a single root frame named after the document title, sized like BODY', () => {
    const { nodes } = convertFixture()
    expect(nodes).toHaveLength(1)
    const root = nodes[0] as FrameNode
    expect(root.type).toBe('frame')
    expect(root.name).toBe('Capture test page')
    expect(root.x).toBe(0)
    expect(root.y).toBe(0)
    expect(root.width).toBeCloseTo(1920, 0)
    expect(root.height).toBeCloseTo(534, 0)
  })

  it('excludes the PLASMO-CSUI extension node and the react-scan toast overlay', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    const texts = collectTexts(root)
    expect(texts.some((t) => t.text.includes('Copied to clipboard'))).toBe(false)
    expect(findByName(root, 'PLASMO-CSUI')).toBeUndefined()
  })

  it('converts the hero SECTION into a frame with a linear gradient fill and bottom corner radii', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    // The hero is the first frame child of the root.
    const hero = root.children.find((c) => c.type === 'frame') as FrameNode
    expect(hero).toBeTruthy()
    expect(hero.x).toBe(0)
    expect(hero.y).toBe(0)
    expect(hero.gradientFill).toBeTruthy()
    expect(hero.gradientFill!.stops).toHaveLength(2)
    expect(hero.gradientFill!.stops[0].color.toLowerCase()).toBe('#4f46e5')
    expect(hero.gradientFill!.stops[1].color.toLowerCase()).toBe('#9333ea')
    expect(hero.cornerRadiusPerCorner?.bottomLeft).toBe(24)
    expect(hero.cornerRadiusPerCorner?.bottomRight).toBe(24)
  })

  it('converts H1 into a text node with the resolved typography, positioned relative to its parent', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    const hero = root.children.find((c) => c.type === 'frame') as FrameNode
    const h1 = hero.children.find((c) => c.type === 'text' && (c as TextNode).text === 'Capture me') as TextNode
    expect(h1).toBeTruthy()
    expect(h1.fontSize).toBe(40)
    expect(h1.fontWeight).toBe('700')
    expect(h1.fill?.toLowerCase()).toBe('#ffffff')
    // H1 abs x=48,y=48; SECTION abs x=0,y=0 => relative 48,48
    expect(h1.x).toBeCloseTo(48, 0)
    expect(h1.y).toBeCloseTo(48, 0)
  })

  it('converts BUTTON into a white pill frame containing a text node', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    const hero = root.children.find((c) => c.type === 'frame') as FrameNode
    const button = hero.children.find(
      (c) => c.type === 'frame' && collectTexts(c as FrameNode).some((t) => t.text === 'Get started'),
    ) as FrameNode
    expect(button).toBeTruthy()
    expect(button.fill?.toLowerCase()).toBe('#ffffff')
    expect(button.cornerRadius).toBeGreaterThanOrEqual(9999)
    const label = collectTexts(button).find((t) => t.text === 'Get started')
    expect(label).toBeTruthy()
  })

  it('converts IMG into a node with an image fill resolved to a data: URL', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode

    function findImage(node: FrameNode): FrameNode | undefined {
      for (const child of node.children) {
        if (child.type === 'frame') {
          const f = child as FrameNode
          if (f.imageFill) return f
          const nested = findImage(f)
          if (nested) return nested
        }
      }
      return undefined
    }

    const image = findImage(root)
    expect(image).toBeTruthy()
    expect(image!.imageFill!.url.startsWith('data:')).toBe(true)
  })

  it('infers auto-layout on the hero SECTION (flex column, gap 16, padding 48) and preserves child positions exactly', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    const hero = root.children.find((c) => c.type === 'frame') as FrameNode
    expect(hero.layout).toBeTruthy()
    expect(hero.layout?.autoLayout).toBe(true)
    expect(hero.layout?.flexDirection).toBe('column')
    expect(hero.layout?.gap).toBe(16)
    expect(hero.layout?.paddingTop).toBe(48)
    expect(hero.layout?.paddingRight).toBe(48)
    expect(hero.layout?.paddingBottom).toBe(48)
    expect(hero.layout?.paddingLeft).toBe(48)

    // Paste fidelity: replaying the engine over the applied layout must
    // reproduce the exact captured x/y of every flow child.
    const results = calculateFrameLayout(hero)
    expect(results.length).toBe(hero.children.length)
    const byId = new Map(results.map((r) => [r.id, r]))
    for (const child of hero.children) {
      const r = byId.get(child.id)
      expect(r).toBeTruthy()
      expect(r!.x).toBeCloseTo(child.x, 0)
      expect(r!.y).toBeCloseTo(child.y, 0)
    }
  })

  it('infers auto-layout on the cards row DIV (flex row, gap 20, padding 32/48) and preserves child positions exactly', () => {
    const { nodes } = convertFixture()
    const root = nodes[0] as FrameNode
    // The cards row is the root's second frame child (after the hero SECTION).
    const frameChildren = root.children.filter((c): c is FrameNode => c.type === 'frame')
    const cardsRow = frameChildren[1]
    expect(cardsRow).toBeTruthy()
    expect(cardsRow.layout).toBeTruthy()
    expect(cardsRow.layout?.autoLayout).toBe(true)
    expect(cardsRow.layout?.flexDirection).toBe('row')
    expect(cardsRow.layout?.gap).toBe(20)
    expect(cardsRow.layout?.paddingTop).toBe(32)
    expect(cardsRow.layout?.paddingBottom).toBe(32)
    expect(cardsRow.layout?.paddingLeft).toBe(48)
    expect(cardsRow.layout?.paddingRight).toBe(48)

    const results = calculateFrameLayout(cardsRow)
    expect(results.length).toBe(cardsRow.children.length)
    const byId = new Map(results.map((r) => [r.id, r]))
    for (const child of cardsRow.children) {
      const r = byId.get(child.id)
      expect(r).toBeTruthy()
      expect(r!.x).toBeCloseTo(child.x, 0)
      expect(r!.y).toBeCloseTo(child.y, 0)
    }
  })
})

describe('convertH2dToSceneNodes (synthetic cases)', () => {
  it('falls back to converting root when no BODY is present', () => {
    const doc = {
      documentTitle: 'No body',
      root: el('DIV', rect(0, 0, 50, 50), { backgroundColor: 'rgb(1, 2, 3)' }),
      documentRect: { x: 0, y: 0, width: 50, height: 50 },
      version: 2,
      assets: {},
    }
    const { nodes } = convertH2dToSceneNodes(doc)
    expect(nodes).toHaveLength(1)
    expect((nodes[0] as FrameNode).width).toBe(50)
  })

  it('skips whitespace-only text nodes and zero-size elements with no visible descendants', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      text('   \n  ', rect(0, 0, 0, 0)),
      el('DIV', rect(0, 0, 0, 0), {}, [el('SPAN', rect(0, 0, 0, 0))]),
      el('DIV', rect(0, 0, 30, 30), { backgroundColor: 'rgb(10, 20, 30)' }),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    expect(root.children).toHaveLength(1)
  })

  it('keeps a zero-size wrapper that has a visible descendant', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('DIV', rect(0, 0, 0, 0), {}, [text('hidden but present', rect(0, 0, 10, 10))]),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    expect(root.children).toHaveLength(1)
  })

  it('skips SCRIPT/STYLE/display:none elements', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('SCRIPT', rect(0, 0, 100, 100), {}, [text('alert(1)', rect(0, 0, 10, 10))]),
      el('DIV', rect(0, 0, 30, 30), { display: 'none' }),
      el('DIV', rect(0, 0, 30, 30), { backgroundColor: 'rgb(10, 20, 30)' }),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    expect(root.children).toHaveLength(1)
  })

  it('keeps inline text alongside a nested element (mixed children are not dropped)', () => {
    // <p>Hello <a>world</a></p>
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('P', rect(0, 0, 100, 20), {}, [
        text('Hello ', rect(0, 0, 40, 20)),
        el('A', rect(40, 0, 40, 20), {}, [text('world', rect(40, 0, 40, 20))]),
      ]),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const p = root.children[0] as FrameNode
    expect(p.type).toBe('frame')
    const texts = p.children.filter((c): c is TextNode => c.type === 'text').map((t) => t.text)
    expect(texts).toContain('Hello ')
    expect(texts).toContain('world')
  })

  it('removes source-formatting whitespace around captured text', () => {
    const body = el('BODY', rect(0, 0, 200, 40), {}, [
      el('BUTTON', rect(0, 0, 100, 40), { backgroundColor: 'rgb(0, 0, 0)' }, [
        text('\n        В корзину\n      ', rect(10, 10, 80, 20)),
      ]),
    ])
    const { nodes } = convertH2dToSceneNodes(buildDocument(body))
    const button = (nodes[0] as FrameNode).children[0] as FrameNode
    const label = button.children[0] as TextNode

    expect(label.text).toBe('В корзину')
  })

  it('uses a fixed text box for content captured on multiple rendered lines', () => {
    const capturedText = text(
      'Заключайте сделки без посредников и комиссий напрямую с производителями',
      rect(10, 10, 180, 40),
    )
    capturedText.lineCount = 2
    const body = el('BODY', rect(0, 0, 200, 60), {}, [
      el('P', rect(10, 10, 180, 40), { fontSize: '16px', lineHeight: '20px' }, [capturedText]),
    ])
    const { nodes } = convertH2dToSceneNodes(buildDocument(body))
    const paragraph = (nodes[0] as FrameNode).children[0] as TextNode

    expect(paragraph.textWidthMode).toBe('fixed-height')
    expect(paragraph.width).toBe(180)
    expect(paragraph.height).toBe(40)
  })

  it('converts a captured search input with placeholder, icon, and solid background', () => {
    const input = el(
      'INPUT',
      rect(520, 82, 802, 48),
      {
        backgroundColor: 'rgb(255, 255, 255)',
        backgroundImage: 'url("https://example.com/search.svg")',
        backgroundPositionX: '16px',
        backgroundPositionY: '50%',
        backgroundRepeat: 'no-repeat',
        fontFamily: 'Onest, sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        lineHeight: '20px',
        paddingLeft: '48px',
        paddingRight: '16px',
      },
      [],
      { type: 'search', placeholder: 'Искать среди тысяч товаров...' },
    )
    input.pseudoElementStyles = {
      placeholder: {
        color: 'rgb(133, 143, 163)',
        fontFamily: 'Onest, sans-serif',
        fontSize: '14px',
        fontWeight: '500',
        height: '18px',
        width: '734px',
      },
    }
    const doc = {
      ...buildDocument(input, {
        assets: {
          'https://example.com/search.svg': {
            url: 'https://example.com/search.svg',
            blob: {
              type: 'image/svg+xml',
              base64Blob: `data:application/octet-stream;base64,${btoa('<svg width="17" height="16"></svg>')}`,
            },
          },
        },
      }),
      root: input,
      documentTitle: 'Search field',
    }

    const { nodes } = convertH2dToSceneNodes(doc)
    const field = nodes[0] as FrameNode
    const placeholder = field.children.find((child): child is TextNode => child.type === 'text')
    const icon = field.children.find((child): child is FrameNode => child.type === 'frame' && !!child.imageFill)

    expect(field.fill?.toLowerCase()).toBe('#ffffff')
    expect(field.imageFill).toBeUndefined()
    expect(placeholder).toMatchObject({ text: 'Искать среди тысяч товаров...', x: 48, fontFamily: 'Onest' })
    expect(placeholder?.fill?.toLowerCase()).toBe('#858fa3')
    expect(icon).toMatchObject({ x: 16, y: 16, width: 17, height: 16 })
    expect(icon?.imageFill?.mode).toBe('fit')
  })

  it('parses a Tailwind-style two-layer box-shadow into sane (non-garbage) offsets', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('DIV', rect(0, 0, 30, 30), {
        backgroundColor: 'rgb(255, 255, 255)',
        boxShadow: 'rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px',
      }),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const div = root.children[0] as FrameNode
    expect(div.effects).toBeTruthy()
    expect(div.effects).toHaveLength(2)
    for (const effect of div.effects ?? []) {
      expect(effect.type).toBe('shadow')
      if (effect.type !== 'shadow') continue
      expect(Number.isFinite(effect.offset.x)).toBe(true)
      expect(Number.isFinite(effect.offset.y)).toBe(true)
      expect(Number.isFinite(effect.blur)).toBe(true)
      expect(Number.isFinite(effect.spread)).toBe(true)
    }
    // The two offsetY values (10 and 4) must survive distinctly, not collapse/garble.
    const offsetYs = (div.effects ?? [])
      .filter((e): e is ShadowEffect => e.type === 'shadow')
      .map((e) => e.offset.y)
      .sort((a, b) => a - b)
    expect(offsetYs).toEqual([4, 10])
  })

  it('does not crash and produces no garbage numbers for an oklch() box-shadow color under the happy-dom canvas stub', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('DIV', rect(0, 0, 30, 30), {
        boxShadow: '0px 10px 15px -3px oklch(0.5 0.1 200 / 0.4)',
      }),
    ])
    const doc = buildDocument(body)
    expect(() => convertH2dToSceneNodes(doc)).not.toThrow()
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const div = root.children[0] as FrameNode
    if (div.effect) {
      expect(div.effect.type).toBe('shadow')
      expect(Number.isFinite(div.effect.offset.x)).toBe(true)
      expect(Number.isFinite(div.effect.offset.y)).toBe(true)
      expect(Number.isNaN(div.effect.offset.x)).toBe(false)
      expect(Number.isNaN(div.effect.offset.y)).toBe(false)
    }
  })

  it('defaults an empty asset blob.type to a generic MIME type instead of an invalid data: URL', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el(
        'IMG',
        rect(0, 0, 40, 40),
        {},
        [],
        { src: 'https://example.com/icon.png' },
      ),
    ])
    const doc = buildDocument(body, {
      assets: {
        'https://example.com/icon.png': {
          url: 'https://example.com/icon.png',
          blob: { type: '', base64Blob: 'data:application/octet-stream;base64,AAAA' },
        },
      },
    })
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const img = root.children[0] as FrameNode
    expect(img.imageFill?.url).toBe('data:application/octet-stream;base64,AAAA')
  })

  it('does not compute a bogus lineHeight ratio when fontSize resolves to 0', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el('SPAN', rect(0, 0, 50, 20), { fontSize: '0px', lineHeight: '20px' }, [
        text('tiny', rect(0, 0, 50, 20)),
      ]),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const span = root.children[0] as TextNode
    expect(span.type).toBe('text')
    expect(span.fontSize).toBeUndefined()
    expect(span.lineHeight).toBeUndefined()
  })

  it('carries letterSpacing and underline through applyTextProps reuse', () => {
    const body = el('BODY', rect(0, 0, 100, 100), {}, [
      el(
        'SPAN',
        rect(0, 0, 50, 20),
        { letterSpacing: '0.5px', textDecorationLine: 'underline' },
        [text('spaced', rect(0, 0, 50, 20))],
      ),
    ])
    const doc = buildDocument(body)
    const { nodes } = convertH2dToSceneNodes(doc)
    const root = nodes[0] as FrameNode
    const span = root.children[0] as TextNode
    expect(span.type).toBe('text')
    expect(span.letterSpacing).toBe(0.5)
    expect(span.underline).toBe(true)
  })
})
