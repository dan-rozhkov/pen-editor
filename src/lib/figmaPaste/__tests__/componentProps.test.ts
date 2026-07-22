// Component-property resolution: an instance's componentPropAssignment (or a
// nested symbolOverrides[].componentPropAssignment) drives a TEXT/VISIBLE/
// INSTANCE_SWAP field on a node inside the master via componentPropRef.
// These fixtures build FigPasteData directly (no kiwi round-trip needed —
// convertFigmaPasteToSceneNodes only cares about the decoded shape).

import { describe, expect, it } from 'vitest'
import type { FrameNode, TextNode } from '@/types/scene'
import { convertFigmaPasteToSceneNodes } from '../figmaToScene'
import type { FigNodeChange, FigPasteData } from '../figTypes'
import { guid, identityTransform, solidPaint } from './figFixture'

function data(nodeChanges: FigNodeChange[]): FigPasteData {
  return { meta: {}, version: 0, message: { nodeChanges } }
}

describe('component-property resolution', () => {
  it('resolves TEXT_DATA, VISIBLE and OVERRIDDEN_SYMBOL_ID props from the instance root', () => {
    const internalCanvas: FigNodeChange = {
      guid: guid(50),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0, 0), position: '"' },
    }
    const masterA: FigNodeChange = {
      guid: guid(51),
      type: 'SYMBOL',
      name: 'Card',
      parentIndex: { guid: guid(50), position: '!' },
      size: { x: 200, y: 100 },
      transform: identityTransform(),
      componentPropDef: [
        { id: guid(10), name: 'Title', type: 'TEXT', initialValue: { textValue: 'Default title' } },
        { id: guid(11), name: 'Show badge', type: 'BOOL', initialValue: { boolValue: true } },
        { id: guid(12), name: 'Icon', type: 'INSTANCE_SWAP', initialValue: { guidValue: guid(70) } },
      ],
    }
    const titleText: FigNodeChange = {
      guid: guid(52),
      type: 'TEXT',
      name: 'Title',
      parentIndex: { guid: guid(51), position: '!' },
      size: { x: 180, y: 20 },
      transform: identityTransform(10, 10),
      fontSize: 14,
      fontName: { family: 'Inter', style: 'Regular' },
      textData: { characters: 'Default title' },
      componentPropRef: [{ defID: guid(10), componentPropNodeField: 'TEXT_DATA' }],
    }
    const badge: FigNodeChange = {
      guid: guid(53),
      type: 'RECTANGLE',
      name: 'Badge',
      parentIndex: { guid: guid(51), position: '"' },
      size: { x: 20, y: 20 },
      transform: identityTransform(10, 40),
      fillPaints: [solidPaint(1, 0, 0)],
      visible: true,
      componentPropRef: [{ defID: guid(11), componentPropNodeField: 'VISIBLE' }],
    }
    const iconSlot: FigNodeChange = {
      guid: guid(54),
      type: 'INSTANCE',
      name: 'Icon slot',
      parentIndex: { guid: guid(51), position: '#' },
      size: { x: 16, y: 16 },
      transform: identityTransform(10, 70),
      symbolData: { symbolID: guid(70) },
      componentPropRef: [
        { defID: guid(12), componentPropNodeField: 'OVERRIDDEN_SYMBOL_ID' },
        // An unresolvable ref (unset sentinel) must be ignored, not crash.
        { defID: guid(0, 0), componentPropNodeField: 'VISIBLE' },
        // A prop-node field the editor has no equivalent for must be ignored.
        { defID: guid(13), componentPropNodeField: 'INHERIT_FILL_STYLE_ID' },
      ],
    }
    const iconMasterDefault: FigNodeChange = {
      guid: guid(70),
      type: 'SYMBOL',
      name: 'StarIcon',
      parentIndex: { guid: guid(50), position: '$' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      fillPaints: [solidPaint(0, 0, 0)],
    }
    const iconMasterSwap: FigNodeChange = {
      guid: guid(71),
      type: 'SYMBOL',
      name: 'HeartIcon',
      parentIndex: { guid: guid(50), position: '%' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      fillPaints: [solidPaint(1, 0, 1)],
    }
    const instance: FigNodeChange = {
      guid: guid(60),
      type: 'INSTANCE',
      name: 'Card instance',
      size: { x: 200, y: 100 },
      transform: identityTransform(500, 600),
      symbolData: { symbolID: guid(51) },
      componentPropAssignment: [
        { defID: guid(10), value: { textValue: 'Custom title' } },
        { defID: guid(11), value: { boolValue: false } },
        { defID: guid(12), value: { guidValue: guid(71) } },
      ],
    }

    const result = convertFigmaPasteToSceneNodes(
      data([internalCanvas, masterA, titleText, badge, iconSlot, iconMasterDefault, iconMasterSwap, instance]),
    )

    expect(result.nodes).toHaveLength(1)
    const frame = result.nodes[0] as FrameNode
    expect(frame.children).toHaveLength(3)

    const title = frame.children.find((n) => n.type === 'text') as TextNode
    expect(title.text).toBe('Custom title')

    const rectBadge = frame.children.find((n) => n.name === 'Badge')!
    expect(rectBadge.visible).toBe(false)

    const swappedIcon = frame.children.find((n) => n.name === 'Icon slot') as FrameNode
    expect(swappedIcon.fill).toBe('#ff00ff')
  })

  it('resolves a componentPropAssignment nested in symbolOverrides (not just the instance root)', () => {
    const internalCanvas: FigNodeChange = {
      guid: guid(100),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0, 0), position: '"' },
    }
    const master: FigNodeChange = {
      guid: guid(80),
      type: 'SYMBOL',
      name: 'Field',
      parentIndex: { guid: guid(100), position: '!' },
      size: { x: 100, y: 20 },
      transform: identityTransform(),
    }
    const label: FigNodeChange = {
      guid: guid(81),
      type: 'TEXT',
      name: 'Label',
      parentIndex: { guid: guid(80), position: '!' },
      size: { x: 100, y: 20 },
      transform: identityTransform(),
      textData: { characters: 'Placeholder' },
      componentPropRef: [{ defID: guid(20), componentPropNodeField: 'TEXT_DATA' }],
    }
    const instance: FigNodeChange = {
      guid: guid(90),
      type: 'INSTANCE',
      name: 'Field instance',
      size: { x: 100, y: 20 },
      transform: identityTransform(0, 0),
      symbolData: {
        symbolID: guid(80),
        symbolOverrides: [
          {
            guidPath: { guids: [guid(90)] },
            componentPropAssignment: [{ defID: guid(20), value: { textValue: 'From symbolOverrides' } }],
          },
        ],
      },
    }

    const result = convertFigmaPasteToSceneNodes(data([internalCanvas, master, label, instance]))
    const frame = result.nodes[0] as FrameNode
    const text = frame.children[0] as TextNode
    expect(text.text).toBe('From symbolOverrides')
  })

  it('is a no-op for a plain Figma paste that never sets componentPropRef/Assignment', () => {
    const rect: FigNodeChange = {
      guid: guid(1),
      type: 'RECTANGLE',
      size: { x: 10, y: 10 },
      transform: identityTransform(),
      fillPaints: [solidPaint(0, 1, 0)],
    }
    const result = convertFigmaPasteToSceneNodes(data([rect]))
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].fill).toBe('#00ff00')
  })

  it('falls back to the master componentPropDef initialValue when the instance never assigns the prop', () => {
    // Real Pixso/Figma payloads only carry a componentPropAssignment entry
    // for a prop a user actually changed — an untouched prop (the common
    // case) must still resolve through the master's own declared default,
    // not silently stay unresolved.
    const internalCanvas: FigNodeChange = {
      guid: guid(200),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0, 0), position: '"' },
    }
    const master: FigNodeChange = {
      guid: guid(201),
      type: 'SYMBOL',
      name: 'Card',
      parentIndex: { guid: guid(200), position: '!' },
      size: { x: 100, y: 100 },
      transform: identityTransform(),
      componentPropDef: [
        { id: guid(30), name: 'Icon', type: 'INSTANCE_SWAP', initialValue: { guidValue: guid(203) } },
      ],
    }
    const iconSlot: FigNodeChange = {
      guid: guid(202),
      type: 'INSTANCE',
      name: 'Icon slot',
      parentIndex: { guid: guid(201), position: '!' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      // Authored default target is a "no icon" placeholder; the real default
      // lives on componentPropDef.initialValue instead.
      symbolData: { symbolID: guid(204) },
      componentPropRef: [{ defID: guid(30), componentPropNodeField: 'OVERRIDDEN_SYMBOL_ID' }],
    }
    const placeholderIcon: FigNodeChange = {
      guid: guid(204),
      type: 'SYMBOL',
      name: 'PlaceholderIcon',
      parentIndex: { guid: guid(200), position: '$' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      fillPaints: [solidPaint(0, 0, 0)],
    }
    const realDefaultIcon: FigNodeChange = {
      guid: guid(203),
      type: 'SYMBOL',
      name: 'StarIcon',
      parentIndex: { guid: guid(200), position: '%' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      fillPaints: [solidPaint(1, 1, 0)],
    }
    const instance: FigNodeChange = {
      guid: guid(210),
      type: 'INSTANCE',
      name: 'Card instance',
      size: { x: 100, y: 100 },
      transform: identityTransform(0, 0),
      symbolData: { symbolID: guid(201) },
      // No componentPropAssignment at all — the instance never touched the
      // Icon prop.
    }

    const result = convertFigmaPasteToSceneNodes(
      data([internalCanvas, master, iconSlot, placeholderIcon, realDefaultIcon, instance]),
    )
    const frame = result.nodes[0] as FrameNode
    const icon = frame.children[0] as FrameNode
    expect(icon.fill).toBe('#ffff00')
  })

  it('ignores an OVERRIDDEN_SYMBOL_ID value of the {0,0} unset sentinel', () => {
    const internalCanvas: FigNodeChange = {
      guid: guid(220),
      type: 'CANVAS',
      internalOnly: true,
      parentIndex: { guid: guid(0, 0), position: '"' },
    }
    const master: FigNodeChange = {
      guid: guid(221),
      type: 'SYMBOL',
      name: 'Card',
      parentIndex: { guid: guid(220), position: '!' },
      size: { x: 100, y: 100 },
      transform: identityTransform(),
    }
    const iconSlot: FigNodeChange = {
      guid: guid(222),
      type: 'INSTANCE',
      name: 'Icon slot',
      parentIndex: { guid: guid(221), position: '!' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      symbolData: { symbolID: guid(224) },
      componentPropRef: [{ defID: guid(31), componentPropNodeField: 'OVERRIDDEN_SYMBOL_ID' }],
    }
    const authoredDefaultIcon: FigNodeChange = {
      guid: guid(224),
      type: 'SYMBOL',
      name: 'AuthoredDefaultIcon',
      parentIndex: { guid: guid(220), position: '$' },
      size: { x: 16, y: 16 },
      transform: identityTransform(),
      fillPaints: [solidPaint(0, 1, 1)],
    }
    const instance: FigNodeChange = {
      guid: guid(230),
      type: 'INSTANCE',
      name: 'Card instance',
      size: { x: 100, y: 100 },
      transform: identityTransform(0, 0),
      symbolData: { symbolID: guid(221) },
      componentPropAssignment: [{ defID: guid(31), value: { guidValue: guid(0, 0) } }],
    }

    const result = convertFigmaPasteToSceneNodes(data([internalCanvas, master, iconSlot, authoredDefaultIcon, instance]))
    const frame = result.nodes[0] as FrameNode
    const icon = frame.children[0] as FrameNode
    // {0,0} is the unset sentinel: the slot must keep its own authored
    // default master, not fail trying to resolve guid "0:0".
    expect(icon.fill).toBe('#00ffff')
  })
})
