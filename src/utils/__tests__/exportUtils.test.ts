import { describe, it, expect, beforeEach } from 'vitest'
import { Rectangle } from 'pixi.js'
import {
  toExtractFrame,
  getNodeExportSize,
  getFrameDescriptor,
  getTopLevelFrames,
  resolvePageExportBaseName,
  type PdfFrameDescriptor,
} from '@/utils/exportUtils'
import { useSceneStore } from '@/store/sceneStore'
import type { FlatSceneNode } from '@/types/scene'
import { resetStores, seedScene } from '@/test/fixtures'

describe('toExtractFrame', () => {
  it('builds a (0,0,width,height) region from a declared size, for use as extract.canvas({ frame })', () => {
    // Bug repro: an 800x600 frame exported at 1x must come out exactly
    // 800x600 px. `extract.canvas`'s implicit `getLocalBounds(target)`
    // fallback measures rendered content, not declared size, and can be
    // smaller for frames with no full-covering background — pinning this
    // frame region is what makes the output size deterministic.
    expect(toExtractFrame(800, 600)).toEqual(new Rectangle(0, 0, 800, 600))
  })

  it('scales independently: the caller multiplies frame size by `scale`, not this helper', () => {
    // toExtractFrame always returns the *unscaled* design-px region; Pixi's
    // `resolution: scale` (passed alongside `frame` at each call site) is
    // what multiplies it up to scale*width x scale*height output pixels.
    expect(toExtractFrame(100, 50)).toEqual(new Rectangle(0, 0, 100, 50))
  })

  it('falls back to undefined (implicit content bounds) for degenerate sizes', () => {
    expect(toExtractFrame(0, 600)).toBeUndefined()
    expect(toExtractFrame(800, 0)).toBeUndefined()
    expect(toExtractFrame(-10, 600)).toBeUndefined()
    expect(toExtractFrame(800, -1)).toBeUndefined()
  })
})

describe('getNodeExportSize', () => {
  beforeEach(() => {
    resetStores()
  })

  it('resolves a plain node\'s declared width/height', () => {
    seedScene()
    expect(getNodeExportSize('frame1')).toEqual({ width: 400, height: 300 })
  })

  it('resolves the effective (hug-content) size for a fit_content auto-layout frame, not the stale stored size', () => {
    const frame = {
      id: 'hug',
      type: 'frame',
      name: 'hug',
      x: 0,
      y: 0,
      width: 100,
      height: 200, // stale
      layout: {
        autoLayout: true,
        flexDirection: 'column',
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
      sizing: { widthMode: 'fixed', heightMode: 'fit_content' },
    } as never

    const child = {
      id: 'hug-child',
      type: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      sizing: { widthMode: 'fixed', heightMode: 'fixed' },
    } as never

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, hug: frame, 'hug-child': child },
      parentById: { ...s.parentById, hug: null, 'hug-child': 'hug' },
      childrenById: { ...s.childrenById, hug: ['hug-child'] },
      rootIds: [...s.rootIds, 'hug'],
      _cachedTree: null,
    }))

    expect(getNodeExportSize('hug')).toEqual({ width: 100, height: 40 })
  })

  it('falls back to {0,0} for an unknown node id', () => {
    expect(getNodeExportSize('does-not-exist')).toEqual({ width: 0, height: 0 })
  })
})

describe('getFrameDescriptor / getTopLevelFrames (page-export frame sizing & order)', () => {
  /** Column auto-layout frame, height=fit_content, stored height stale/wrong. */
  function seedHugContentFrame(id: string, stored: { width: number; height: number }): void {
    const frame = {
      id,
      type: 'frame',
      name: id,
      x: 0,
      y: 0,
      width: stored.width,
      height: stored.height,
      layout: {
        autoLayout: true,
        flexDirection: 'column',
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
      sizing: { widthMode: 'fixed', heightMode: 'fit_content' },
    } as unknown as FlatSceneNode

    const child = {
      id: `${id}-child`,
      type: 'rect',
      x: 0,
      y: 0,
      width: stored.width,
      height: 40,
      sizing: { widthMode: 'fixed', heightMode: 'fixed' },
    } as unknown as FlatSceneNode

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, [id]: frame, [`${id}-child`]: child },
      parentById: { ...s.parentById, [id]: null, [`${id}-child`]: id },
      childrenById: { ...s.childrenById, [id]: [`${id}-child`] },
      rootIds: [...s.rootIds, id],
      _cachedTree: null,
    }))
  }

  beforeEach(() => {
    resetStores()
  })

  it('resolves the effective (hug-content) size instead of the raw stored width/height', () => {
    // Stored height (200) is stale; the frame actually hugs its one 40px-tall child.
    seedHugContentFrame('f1', { width: 100, height: 200 })

    const descriptor = getFrameDescriptor('f1', 'f1')

    expect(descriptor.width).toBe(100)
    expect(descriptor.height).toBe(40)
  })

  it('orders top-level frames to match the Layers panel (reverse of rootIds)', () => {
    seedHugContentFrame('first', { width: 50, height: 50 })
    seedHugContentFrame('second', { width: 50, height: 50 })

    expect(useSceneStore.getState().rootIds).toEqual(['first', 'second'])

    const frames = getTopLevelFrames()

    expect(frames.map((f) => f.id)).toEqual(['second', 'first'])
  })
})

describe('resolvePageExportBaseName', () => {
  it('uses the sanitized single frame name when there is exactly one frame', () => {
    const frames: PdfFrameDescriptor[] = [{ id: 'f1', name: 'Cover', width: 10, height: 10 }]
    expect(resolvePageExportBaseName(frames)).toBe('Cover')
  })

  it('falls back to the frame id when the single frame has no name', () => {
    const frames: PdfFrameDescriptor[] = [{ id: 'f1', width: 10, height: 10 }]
    expect(resolvePageExportBaseName(frames)).toBe('f1')
  })

  it('sanitizes the single-frame name', () => {
    const frames: PdfFrameDescriptor[] = [{ id: 'f1', name: 'My Frame / v2', width: 10, height: 10 }]
    expect(resolvePageExportBaseName(frames)).toBe('My_Frame___v2')
  })

  it('falls back to "canvas" for a multi-frame export', () => {
    const frames: PdfFrameDescriptor[] = [
      { id: 'f1', name: 'A', width: 10, height: 10 },
      { id: 'f2', name: 'B', width: 10, height: 10 },
    ]
    expect(resolvePageExportBaseName(frames)).toBe('canvas')
  })
})
