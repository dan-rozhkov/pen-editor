import { describe, expect, it } from 'vitest'
import { convertFigmaClipboardHtml, isFigmaClipboardHtml } from '..'
import { calculateFrameLayout } from '@/utils/yogaLayout'
import { decodePathCommandsBlob } from '../pathBlobs'
import type { FigNodeChange, FigTextData } from '../figTypes'
import type { FrameNode, GroupNode, PathNode, TextNode } from '@/types/scene'
import {
  buildFigmaClipboardHtml,
  encodePathCommandsBlob,
  encodeVectorNetworkBlob,
  guid,
  identityTransform,
  solidPaint,
} from './figFixture'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

/** Wrap node changes in DOCUMENT → CANVAS the way Figma structures the payload. */
function clipboardWith(
  changes: FigNodeChange[],
  blobs: Uint8Array[] = [],
  extraChanges: FigNodeChange[] = [],
): string {
  const document: FigNodeChange = { guid: guid(0, 0), type: 'DOCUMENT' }
  const canvas: FigNodeChange = {
    guid: guid(1, 0),
    type: 'CANVAS',
    parentIndex: { guid: guid(0, 0), position: '!' },
    name: 'Page 1',
  }
  return buildFigmaClipboardHtml({
    type: 'NODE_CHANGES',
    nodeChanges: [document, canvas, ...changes, ...extraChanges],
    blobs: blobs.map((bytes) => ({ bytes })),
  })
}

function onCanvas(change: FigNodeChange, position = '!'): FigNodeChange {
  return { ...change, parentIndex: { guid: guid(1, 0), position } }
}

describe('isFigmaClipboardHtml', () => {
  it('detects Figma clipboard markers', async () => {
    const html = clipboardWith([])
    expect(isFigmaClipboardHtml(html)).toBe(true)
  })

  it('rejects regular html', async () => {
    expect(isFigmaClipboardHtml('<div>hello</div>')).toBe(false)
    expect(await convertFigmaClipboardHtml('<div>hello</div>')).toBeNull()
  })
})

describe('convertFigmaClipboardHtml', () => {
  it('converts a frame with a rectangle child 1:1', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        name: 'Card',
        size: { x: 200, y: 100 },
        transform: identityTransform(300, 400),
        fillPaints: [solidPaint(1, 1, 1)],
        cornerRadius: 12,
      }),
      {
        guid: guid(3),
        type: 'ROUNDED_RECTANGLE',
        name: 'Chip',
        parentIndex: { guid: guid(2), position: '!' },
        size: { x: 50, y: 20 },
        transform: identityTransform(10, 16),
        fillPaints: [solidPaint(1, 0, 0, 0.5)],
        strokePaints: [solidPaint(0, 0, 1)],
        strokeWeight: 2,
        strokeAlign: 'INSIDE',
      },
    ])

    const result = (await convertFigmaClipboardHtml(html))!
    expect(result.nodes).toHaveLength(1)
    const frame = result.nodes[0] as FrameNode
    expect(frame.type).toBe('frame')
    expect(frame.name).toBe('Card')
    expect(frame).toMatchObject({ x: 300, y: 400, width: 200, height: 100 })
    expect(frame.fill).toBe('#ffffff')
    expect(frame.cornerRadius).toBe(12)
    expect(frame.clip).toBe(true)

    expect(frame.children).toHaveLength(1)
    const rect = frame.children[0]
    expect(rect.type).toBe('rect')
    expect(rect).toMatchObject({ x: 10, y: 16, width: 50, height: 20 })
    expect(rect.fill).toBe('#ff0000')
    expect(rect.fillOpacity).toBeCloseTo(0.5)
    expect(rect.stroke).toBe('#0000ff')
    expect(rect.strokeWidth).toBe(2)
    expect(rect.strokeAlign).toBe('inside')
  })

  it('keeps z-order from fractional position strings (bottom first)', async () => {
    const html = clipboardWith([
      onCanvas({ guid: guid(2), type: 'FRAME', name: 'Root', size: { x: 10, y: 10 }, transform: identityTransform() }),
      // intentionally listed out of order
      { guid: guid(4), type: 'RECTANGLE', name: 'Top', parentIndex: { guid: guid(2), position: '#' }, size: { x: 1, y: 1 }, transform: identityTransform() },
      { guid: guid(3), type: 'RECTANGLE', name: 'Bottom', parentIndex: { guid: guid(2), position: '!' }, size: { x: 1, y: 1 }, transform: identityTransform() },
    ])

    const frame = (await convertFigmaClipboardHtml(html))!.nodes[0] as FrameNode
    expect(frame.children.map((child) => child.name)).toEqual(['Bottom', 'Top'])
  })

  it('maps text styles', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'TEXT',
        name: 'Title',
        size: { x: 120, y: 30 },
        transform: identityTransform(5, 6),
        fontSize: 20,
        fontName: { family: 'Inter', style: 'Bold Italic', postscript: 'Inter-BoldItalic' },
        textData: { characters: 'Hello Figma' },
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'CENTER',
        textCase: 'UPPER',
        textDecoration: 'UNDERLINE',
        textAutoResize: 'WIDTH_AND_HEIGHT',
        lineHeight: { value: 150, units: 'PERCENT' },
        letterSpacing: { value: 2, units: 'PIXELS' },
        fillPaints: [solidPaint(0, 0, 0)],
      }),
    ])

    const text = (await convertFigmaClipboardHtml(html))!.nodes[0] as TextNode
    expect(text.type).toBe('text')
    expect(text.text).toBe('Hello Figma')
    expect(text.fontSize).toBe(20)
    expect(text.fontFamily).toBe('Inter')
    expect(text.fontWeight).toBe('700')
    expect(text.fontStyle).toBe('italic')
    expect(text.lineHeight).toBeCloseTo(1.5)
    expect(text.letterSpacing).toBe(2)
    expect(text.textAlign).toBe('center')
    expect(text.textAlignVertical).toBe('middle')
    expect(text.textTransform).toBe('uppercase')
    expect(text.underline).toBe(true)
    expect(text.textWidthMode).toBe('auto')
    expect(text.fill).toBe('#000000')
  })

  /** A TEXT node-change clipboard varying only in text data and base font. */
  function textClipboard(textData: FigTextData, baseFamily = 'Inter'): string {
    return clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'TEXT',
        size: { x: 120, y: 30 },
        transform: identityTransform(),
        fontSize: 14,
        fontName: { family: baseFamily, style: 'Regular', postscript: `${baseFamily}-Regular` },
        textData,
        fillPaints: [solidPaint(0, 0, 0)],
      }),
    ])
  }

  it('resolves the font from a character style override covering the whole text', async () => {
    // A text created with the default font and re-fonted afterwards keeps the
    // stale base fontName (Inter) and carries the real font as an override.
    const html = textClipboard({
      characters: 'Hello',
      characterStyleIDs: [5, 5, 5, 5, 5],
      styleOverrideTable: [
        {
          styleID: 5,
          fontSize: 24,
          fontName: { family: 'Playfair Display', style: 'Bold', postscript: 'PlayfairDisplay-Bold' },
        },
      ],
    })

    const result = (await convertFigmaClipboardHtml(html))!
    const text = result.nodes[0] as TextNode
    expect(text.fontFamily).toBe('Playfair Display')
    expect(text.fontWeight).toBe('700')
    expect(text.fontSize).toBe(24)
    // A uniform override is not mixed styling — no warning
    expect(result.warnings).toEqual([])
  })

  it('applies the dominant style and warns when styles are truly mixed', async () => {
    const html = textClipboard({
      characters: 'Hello world',
      // 8 chars use style 5, the remaining 3 keep the base style
      characterStyleIDs: [5, 5, 5, 5, 5, 5, 5, 5],
      styleOverrideTable: [
        { styleID: 5, fontName: { family: 'Roboto', style: 'Medium', postscript: 'Roboto-Medium' } },
      ],
    })

    const result = (await convertFigmaClipboardHtml(html))!
    const text = result.nodes[0] as TextNode
    expect(text.fontFamily).toBe('Roboto')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('mixed styles')
  })

  it('keeps the base style when most characters use it', async () => {
    const html = textClipboard(
      {
        characters: 'Hello world',
        // Only the first 2 chars are overridden
        characterStyleIDs: [5, 5],
        styleOverrideTable: [
          { styleID: 5, fontName: { family: 'Roboto', style: 'Bold', postscript: 'Roboto-Bold' } },
        ],
      },
      'Lato',
    )

    const result = (await convertFigmaClipboardHtml(html))!
    const text = result.nodes[0] as TextNode
    expect(text.fontFamily).toBe('Lato')
    expect(text.fontSize).toBe(14)
    expect(result.warnings).toHaveLength(1)
  })

  it('converts vectors through fill geometry blobs', async () => {
    const blob = encodePathCommandsBlob(['M', 0, 0, 'L', 24, 0, 'L', 24, 24, 'Z'])
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'VECTOR',
          name: 'Arrow',
          size: { x: 24, y: 24 },
          transform: identityTransform(),
          fillPaints: [solidPaint(0, 1, 0)],
          strokePaints: [solidPaint(0, 0, 0)],
          strokeWeight: 1.5,
          fillGeometry: [{ windingRule: 'ODD', commandsBlob: 0, styleID: 0 }],
        }),
      ],
      [blob],
    )

    const path = (await convertFigmaClipboardHtml(html))!.nodes[0] as PathNode
    expect(path.type).toBe('path')
    expect(path.geometry).toBe('M 0 0 L 24 0 L 24 24 Z')
    expect(path.fillRule).toBe('evenodd')
    expect(path.fill).toBe('#00ff00')
    expect(path.pathStroke).toMatchObject({ thickness: 1.5, fill: '#000000' })
    expect(path.stroke).toBeUndefined()
  })

  it('builds vector geometry from the vector network when fillGeometry is absent', async () => {
    // Real clipboard payloads carry only the editing topology. Triangle in
    // normalized 1x1 space, node sized 24x24 → coordinates scale by 24.
    const blob = encodeVectorNetworkBlob({
      vertices: [[0, 0], [1, 0], [1, 1]],
      segments: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
        { start: 2, end: 0 },
      ],
      regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }],
    })
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'VECTOR',
          name: 'Triangle',
          size: { x: 24, y: 24 },
          transform: identityTransform(),
          fillPaints: [solidPaint(1, 0, 0)],
          vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 1, y: 1 } },
        }),
      ],
      [blob],
    )

    const path = (await convertFigmaClipboardHtml(html))!.nodes[0] as PathNode
    expect(path.type).toBe('path')
    expect(path.geometry).toBe('M 0 0 L 24 0 L 24 24 L 0 0 Z')
    expect(path.fill).toBe('#ff0000')
  })

  it('builds open stroke-only paths with curves from the vector network', async () => {
    const blob = encodeVectorNetworkBlob({
      vertices: [[0, 10], [10, 0]],
      segments: [{ start: 0, end: 1, t1: [4, 0], t2: [-4, 0] }],
    })
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'VECTOR',
          name: 'Curve',
          size: { x: 10, y: 10 },
          transform: identityTransform(),
          strokePaints: [solidPaint(0, 0, 0)],
          strokeWeight: 2,
          vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 10, y: 10 } },
        }),
      ],
      [blob],
    )

    const path = (await convertFigmaClipboardHtml(html))!.nodes[0] as PathNode
    expect(path.geometry).toBe('M 0 10 C 4 10 6 0 10 0')
    expect(path.geometry).not.toContain('Z')
    expect(path.fill).toBeUndefined()
    expect(path.pathStroke).toMatchObject({ thickness: 2, fill: '#000000' })
  })

  it('falls back to stroke geometry for unfilled open paths', async () => {
    const blob = encodePathCommandsBlob(['M', 0, 0, 'L', 10, 10, 'L', 10, 9, 'Z'])
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'VECTOR',
          size: { x: 10, y: 10 },
          transform: identityTransform(),
          strokePaints: [solidPaint(1, 0, 1)],
          strokeWeight: 1,
          strokeGeometry: [{ windingRule: 'NONZERO', commandsBlob: 0, styleID: 0 }],
        }),
      ],
      [blob],
    )

    const path = (await convertFigmaClipboardHtml(html))!.nodes[0] as PathNode
    expect(path.geometry).toContain('M 0 0')
    expect(path.fill).toBe('#ff00ff')
    expect(path.pathStroke).toBeUndefined()
  })

  it('embeds image fills from clipboard blobs as data URLs', async () => {
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'RECTANGLE',
          name: 'Photo',
          size: { x: 80, y: 60 },
          transform: identityTransform(),
          fillPaints: [
            {
              type: 'IMAGE',
              visible: true,
              opacity: 1,
              image: { hash: new Uint8Array([1, 2, 3, 4]), name: 'photo.png', dataBlob: 0 },
              imageScaleMode: 'FILL',
            },
          ],
        }),
      ],
      [PNG_BYTES],
    )

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.imageFill).toBeDefined()
    expect(rect.imageFill!.mode).toBe('fill')
    expect(rect.imageFill!.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('warns when image bytes are not embedded', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 80, y: 60 },
        transform: identityTransform(),
        fillPaints: [
          {
            type: 'IMAGE',
            visible: true,
            opacity: 1,
            image: { hash: new Uint8Array([1, 2, 3, 4]), name: 'remote.png' },
            imageScaleMode: 'FILL',
          },
        ],
      }),
    ])

    const result = (await convertFigmaClipboardHtml(html))!
    expect(result.nodes[0].imageFill).toBeUndefined()
    expect(result.nodes[0].fill).toBe('#cccccc')
    expect(result.warnings.some((warning) => warning.includes('remote.png'))).toBe(true)
  })

  it('converts linear gradients with handle positions', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 100, y: 100 },
        transform: identityTransform(),
        fillPaints: [
          {
            type: 'GRADIENT_LINEAR',
            visible: true,
            opacity: 1,
            transform: identityTransform(),
            stops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 0.5 }, position: 1 },
            ],
          },
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    const gradient = rect.gradientFill!
    expect(gradient.type).toBe('linear')
    expect(gradient.startX).toBeCloseTo(0)
    expect(gradient.startY).toBeCloseTo(0.5)
    expect(gradient.endX).toBeCloseTo(1)
    expect(gradient.endY).toBeCloseTo(0.5)
    expect(gradient.stops).toHaveLength(2)
    expect(gradient.stops[0].color).toBe('#ff0000')
    expect(gradient.stops[1].opacity).toBeCloseTo(0.5)
  })

  it('decomposes rotation from the transform matrix', async () => {
    const angle = Math.PI / 2 // 90° clockwise on screen
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 10, y: 10 },
        transform: {
          m00: Math.cos(angle),
          m01: -Math.sin(angle),
          m02: 40,
          m10: Math.sin(angle),
          m11: Math.cos(angle),
          m12: 50,
        },
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.x).toBeCloseTo(40)
    expect(rect.y).toBeCloseTo(50)
    expect(rect.rotation).toBeCloseTo(90)
  })

  it('maps resize-to-fit frames to groups', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        name: 'Group 1',
        resizeToFit: true,
        size: { x: 100, y: 100 },
        transform: identityTransform(),
      }),
      {
        guid: guid(3),
        type: 'RECTANGLE',
        parentIndex: { guid: guid(2), position: '!' },
        size: { x: 10, y: 10 },
        transform: identityTransform(2, 3),
      },
    ])

    const group = (await convertFigmaClipboardHtml(html))!.nodes[0] as GroupNode
    expect(group.type).toBe('group')
    expect(group.children).toHaveLength(1)
    expect(group.children[0]).toMatchObject({ x: 2, y: 3 })
  })

  it('maps auto-layout stacks to flexbox layout with child sizing', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        name: 'Stack',
        size: { x: 200, y: 300 },
        transform: identityTransform(),
        stackMode: 'VERTICAL',
        stackSpacing: 8,
        stackVerticalPadding: 10,
        stackHorizontalPadding: 20,
        stackPaddingRight: 24,
        stackPaddingBottom: 12,
        stackPrimaryAlignItems: 'CENTER',
        stackCounterAlignItems: 'MAX',
        stackPrimarySizing: 'RESIZE_TO_FIT',
      }),
      {
        guid: guid(3),
        type: 'RECTANGLE',
        name: 'Fill child',
        parentIndex: { guid: guid(2), position: '!' },
        size: { x: 100, y: 40 },
        transform: identityTransform(20, 10),
        stackChildPrimaryGrow: 1,
        stackChildAlignSelf: 'STRETCH',
      },
      {
        guid: guid(4),
        type: 'TEXT',
        name: 'Hug text',
        parentIndex: { guid: guid(2), position: '"' },
        size: { x: 80, y: 20 },
        transform: identityTransform(20, 58),
        textData: { characters: 'Hi' },
        textAutoResize: 'WIDTH_AND_HEIGHT',
      },
      {
        guid: guid(5),
        type: 'RECTANGLE',
        name: 'Floating',
        parentIndex: { guid: guid(2), position: '#' },
        size: { x: 10, y: 10 },
        transform: identityTransform(150, 5),
        stackPositioning: 'ABSOLUTE',
      },
    ])

    const frame = (await convertFigmaClipboardHtml(html))!.nodes[0] as FrameNode
    expect(frame.layout).toEqual({
      autoLayout: true,
      flexDirection: 'column',
      gap: 8,
      paddingTop: 10,
      paddingRight: 24,
      paddingBottom: 12,
      paddingLeft: 20,
      alignItems: 'flex-end',
      justifyContent: 'center',
    })
    // VERTICAL stack with hug on the primary axis → height hugs content
    expect(frame.sizing).toEqual({ heightMode: 'fit_content' })

    const [fill, hugText, floating] = frame.children
    expect(fill.sizing).toEqual({ widthMode: 'fill_container', heightMode: 'fill_container' })
    expect(hugText.sizing).toEqual({ widthMode: 'fit_content', heightMode: 'fit_content' })
    expect(floating.absolutePosition).toBe(true)
    expect(floating.sizing).toBeUndefined()
  })

  it('reproduces Figma stack coordinates through the layout engine', async () => {
    // VERTICAL stack 90x76, padding t10/r20/b10/l20, gap 8, two fixed 50x20
    // children. Figma computes their positions as (20,10) and (20,38) —
    // the editor's layout engine must arrive at the same coordinates.
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        name: 'Stack',
        size: { x: 90, y: 76 },
        transform: identityTransform(),
        stackMode: 'VERTICAL',
        stackSpacing: 8,
        stackVerticalPadding: 10,
        stackHorizontalPadding: 20,
        stackPaddingRight: 20,
        stackPaddingBottom: 10,
      }),
      {
        guid: guid(3),
        type: 'RECTANGLE',
        name: 'A',
        parentIndex: { guid: guid(2), position: '!' },
        size: { x: 50, y: 20 },
        transform: identityTransform(20, 10),
      },
      {
        guid: guid(4),
        type: 'RECTANGLE',
        name: 'B',
        parentIndex: { guid: guid(2), position: '"' },
        size: { x: 50, y: 20 },
        transform: identityTransform(20, 38),
      },
    ])

    const frame = (await convertFigmaClipboardHtml(html))!.nodes[0] as FrameNode
    const results = calculateFrameLayout(frame)
    const byId = new Map(results.map((r) => [r.id, r]))
    const a = byId.get(frame.children[0].id)!
    const b = byId.get(frame.children[1].id)!
    expect({ x: a.x, y: a.y }).toEqual({ x: 20, y: 10 })
    expect({ x: b.x, y: b.y }).toEqual({ x: 20, y: 38 })
  })

  it('zeroes the gap in space-between stacks', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        size: { x: 200, y: 50 },
        transform: identityTransform(),
        stackMode: 'HORIZONTAL',
        stackSpacing: 119,
        stackPrimaryAlignItems: 'SPACE_EVENLY',
      }),
    ])

    const frame = (await convertFigmaClipboardHtml(html))!.nodes[0] as FrameNode
    expect(frame.layout!.justifyContent).toBe('space-between')
    expect(frame.layout!.gap).toBe(0)
  })

  it('does not enable auto-layout for plain frames', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'FRAME',
        size: { x: 100, y: 100 },
        transform: identityTransform(),
      }),
    ])

    const frame = (await convertFigmaClipboardHtml(html))!.nodes[0] as FrameNode
    expect(frame.layout).toBeUndefined()
    expect(frame.sizing).toBeUndefined()
  })

  it('maps drop shadows to shadow effects', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 10, y: 10 },
        transform: identityTransform(),
        effects: [
          {
            type: 'DROP_SHADOW',
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 0.25 },
            offset: { x: 0, y: 4 },
            radius: 8,
            spread: 2,
          },
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.effect).toEqual({
      type: 'shadow',
      shadowType: 'outer',
      color: '#00000040',
      offset: { x: 0, y: 4 },
      blur: 8,
      spread: 2,
    })
  })

  it('preserves the full paint stack for multiple fills', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 100, y: 100 },
        transform: identityTransform(),
        fillPaints: [
          solidPaint(1, 0, 0), // bottom: red
          solidPaint(0, 0, 1, 1, 0.5), // top: blue at 50% layer opacity
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.fills).toHaveLength(2)
    expect(rect.fills![0]).toMatchObject({ type: 'solid', color: '#ff0000' })
    expect(rect.fills![1]).toMatchObject({ type: 'solid', color: '#0000ff' })
    expect(rect.fills![1].opacity).toBeCloseTo(0.5)
    expect(rect.fills![0].id).toBeTruthy()
    expect(rect.fills![1].id).toBeTruthy()
    // When fills is the source of truth the legacy single fields stay unset
    expect(rect.fill).toBeUndefined()
  })

  it('preserves a mixed solid + gradient fill stack', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 100, y: 100 },
        transform: identityTransform(),
        fillPaints: [
          solidPaint(1, 1, 1), // bottom solid
          {
            type: 'GRADIENT_LINEAR',
            visible: true,
            opacity: 1,
            transform: identityTransform(),
            stops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
            ],
          },
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.fills).toHaveLength(2)
    expect(rect.fills![0]).toMatchObject({ type: 'solid', color: '#ffffff' })
    expect(rect.fills![1].type).toBe('gradient')
    expect(rect.gradientFill).toBeUndefined()
    expect(rect.fill).toBeUndefined()
  })

  it('drops hidden paints from the fill stack', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 10, y: 10 },
        transform: identityTransform(),
        fillPaints: [
          solidPaint(1, 0, 0),
          { ...solidPaint(0, 1, 0), visible: false },
          solidPaint(0, 0, 1),
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.fills).toHaveLength(2)
    expect(rect.fills!.map((p) => (p.type === 'solid' ? p.color : p.type))).toEqual(['#ff0000', '#0000ff'])
  })

  it('preserves multiple shadow effects as an effect stack', async () => {
    const html = clipboardWith([
      onCanvas({
        guid: guid(2),
        type: 'RECTANGLE',
        size: { x: 10, y: 10 },
        transform: identityTransform(),
        effects: [
          { type: 'DROP_SHADOW', visible: true, color: { r: 0, g: 0, b: 0, a: 0.25 }, offset: { x: 0, y: 4 }, radius: 8, spread: 2 },
          { type: 'INNER_SHADOW', visible: true, color: { r: 1, g: 1, b: 1, a: 0.5 }, offset: { x: 0, y: 1 }, radius: 2, spread: 0 },
        ],
      }),
    ])

    const rect = (await convertFigmaClipboardHtml(html))!.nodes[0]
    expect(rect.effects).toHaveLength(2)
    expect(rect.effects![0]).toMatchObject({ type: 'shadow', shadowType: 'outer', color: '#00000040' })
    expect(rect.effects![1]).toMatchObject({ type: 'shadow', shadowType: 'inner', color: '#ffffff80' })
    expect(rect.effects![0].id).toBeTruthy()
    expect(rect.effects![1].id).toBeTruthy()
    expect(rect.effect).toBeUndefined()
  })

  it('expands component instances using the embedded master and overrides', async () => {
    const internalCanvas: FigNodeChange = {
      guid: guid(50),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0, 0), position: '"' },
    }
    const symbol: FigNodeChange = {
      guid: guid(51),
      type: 'SYMBOL',
      name: 'Button',
      parentIndex: { guid: guid(50), position: '!' },
      size: { x: 120, y: 40 },
      transform: identityTransform(),
      fillPaints: [solidPaint(0, 0, 1)],
      cornerRadius: 8,
    }
    const symbolLabel: FigNodeChange = {
      guid: guid(52),
      type: 'TEXT',
      name: 'Label',
      parentIndex: { guid: guid(51), position: '!' },
      size: { x: 100, y: 20 },
      transform: identityTransform(10, 10),
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Regular', postscript: 'Inter-Regular' },
      textData: { characters: 'Default' },
    }
    const instance: FigNodeChange = onCanvas({
      guid: guid(60),
      type: 'INSTANCE',
      name: 'Button instance',
      size: { x: 120, y: 40 },
      transform: identityTransform(500, 600),
      symbolData: { symbolID: guid(51) },
      derivedSymbolData: [
        {
          guidPath: { guids: [guid(52)] },
          textData: { characters: 'Click me' },
        },
      ],
    })

    const result = (await convertFigmaClipboardHtml(
      clipboardWith([instance], [], [internalCanvas, symbol, symbolLabel]),
    ))!

    // The internal canvas (symbol master) must not be pasted as a root
    expect(result.nodes).toHaveLength(1)
    const frame = result.nodes[0] as FrameNode
    expect(frame.type).toBe('frame')
    expect(frame).toMatchObject({ x: 500, y: 600, width: 120, height: 40 })
    expect(frame.fill).toBe('#0000ff')
    expect(frame.cornerRadius).toBe(8)
    expect(frame.children).toHaveLength(1)
    const label = frame.children[0] as TextNode
    expect(label.type).toBe('text')
    expect(label.text).toBe('Click me')
  })

  it('applies the avatar-mask workaround (image fill onto the mask shape)', async () => {
    const html = clipboardWith(
      [
        onCanvas({
          guid: guid(2),
          type: 'FRAME',
          name: 'Avatar',
          resizeToFit: true,
          size: { x: 40, y: 40 },
          transform: identityTransform(),
        }),
        {
          guid: guid(3),
          type: 'ELLIPSE',
          name: 'Mask',
          mask: true,
          parentIndex: { guid: guid(2), position: '!' },
          size: { x: 40, y: 40 },
          transform: identityTransform(),
          fillPaints: [solidPaint(1, 1, 1)],
        },
        {
          guid: guid(4),
          type: 'RECTANGLE',
          name: 'Photo',
          parentIndex: { guid: guid(2), position: '"' },
          size: { x: 48, y: 48 },
          transform: identityTransform(-4, -4),
          fillPaints: [
            {
              type: 'IMAGE',
              visible: true,
              opacity: 1,
              image: { hash: new Uint8Array([9]), name: 'avatar.png', dataBlob: 0 },
              imageScaleMode: 'FILL',
            },
          ],
        },
      ],
      [PNG_BYTES],
    )

    const group = (await convertFigmaClipboardHtml(html))!.nodes[0] as GroupNode
    expect(group.children).toHaveLength(1)
    const shape = group.children[0]
    expect(shape.type).toBe('ellipse')
    expect(shape.imageFill).toBeDefined()
    expect(shape.visible).not.toBe(false)
  })
})

describe('decodePathCommandsBlob', () => {
  it('round-trips an encoded command stream', async () => {
    const blob = encodePathCommandsBlob(['M', 1.5, 2, 'Q', 3, 4, 5, 6, 'C', 1, 2, 3, 4, 5, 6, 'Z'])
    expect(decodePathCommandsBlob(blob)).toBe('M 1.5 2 Q 3 4 5 6 C 1 2 3 4 5 6 Z')
  })

  it('stops at unknown command bytes', async () => {
    const blob = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 99, 1, 2])
    expect(decodePathCommandsBlob(blob)).toBe('M 0 0')
  })
})
