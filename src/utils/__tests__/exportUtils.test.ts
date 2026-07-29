import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Rectangle } from 'pixi.js'
import {
  toExtractFrame,
  getNodeExportSize,
  getFrameDescriptor,
  getTopLevelFrames,
  resolvePageExportBaseName,
  renderNodeToCanvas,
  nodeContainsEmbed,
  type PdfFrameDescriptor,
} from '@/utils/exportUtils'
import type { PixiExportRefs } from '@/store/canvasRefStore'
import { useSceneStore } from '@/store/sceneStore'
import type { FlatSceneNode } from '@/types/scene'
import { resetStores, seedScene } from '@/test/fixtures'
import { captureEmbedCanvas } from '@/lib/embedScreenshot'

vi.mock('@/lib/embedScreenshot', () => ({
  captureEmbedCanvas: vi.fn(),
}))

const mockedCaptureEmbedCanvas = vi.mocked(captureEmbedCanvas)

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

describe('renderNodeToCanvas (FIR-63: embed nodes render via HTML, not Pixi extract)', () => {
  beforeEach(() => {
    resetStores()
    mockedCaptureEmbedCanvas.mockReset()
  })

  /** A fake Pixi container tree: `sceneRoot` with one labeled child, matching what `findContainerByLabel` expects. */
  function makeFakePixiRefs(extractCanvas: (...args: unknown[]) => unknown, nodeId: string) {
    const container: Record<string, unknown> = { label: nodeId, renderable: true, parent: null, children: [] }
    const sceneRoot: Record<string, unknown> = { label: 'stage', renderable: true, parent: null, children: [container] }
    container.parent = sceneRoot
    const pixiRefs = {
      app: { renderer: { extract: { canvas: vi.fn(extractCanvas) } } },
      sceneRoot,
      overlayContainer: {},
      selectionContainer: {},
      viewport: {},
    }
    return pixiRefs as unknown as PixiExportRefs
  }

  it('an embed node renders via captureEmbedCanvas, never touching Pixi extract', async () => {
    const embedCanvas = { width: 80, height: 40 }
    mockedCaptureEmbedCanvas.mockResolvedValue(embedCanvas as unknown as HTMLCanvasElement)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        emb1: {
          id: 'emb1',
          type: 'embed',
          name: 'Embed',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
      },
      rootIds: [...s.rootIds, 'emb1'],
      _cachedTree: null,
    }))

    const extractCanvas = vi.fn()
    const pixiRefs = makeFakePixiRefs(extractCanvas, 'emb1')

    const result = await renderNodeToCanvas(pixiRefs, 'emb1', { width: 80, height: 40 }, 2)

    expect(result).toBe(embedCanvas)
    expect(mockedCaptureEmbedCanvas).toHaveBeenCalledWith(
      { htmlContent: '<div>hi</div>', width: 80, height: 40 },
      2,
      'emb1',
    )
    expect(extractCanvas).not.toHaveBeenCalled()
  })

  it('rejects (does not resolve a blank canvas) when the embed has no renderable content', async () => {
    mockedCaptureEmbedCanvas.mockResolvedValue(null)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        emb1: {
          id: 'emb1',
          type: 'embed',
          name: 'Broken embed',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
      },
      rootIds: [...s.rootIds, 'emb1'],
      _cachedTree: null,
    }))

    const pixiRefs = makeFakePixiRefs(vi.fn(), 'emb1')

    await expect(renderNodeToCanvas(pixiRefs, 'emb1', { width: 80, height: 40 }, 1)).rejects.toThrow(
      /Broken embed/,
    )
  })

  it('composites a nested embed descendant on top of the Pixi-rendered frame background at its resolved position', async () => {
    const backgroundCanvas: Record<string, unknown> = {
      width: 200,
      height: 100,
    }
    const drawImage = vi.fn()
    backgroundCanvas.getContext = vi.fn(() => ({ drawImage }))

    const embedCanvas = { width: 80, height: 40 }
    mockedCaptureEmbedCanvas.mockResolvedValue(embedCanvas as unknown as HTMLCanvasElement)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: {
          id: 'frame1',
          type: 'frame',
          name: 'Page',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        } as unknown as FlatSceneNode,
        bgRect: { id: 'bgRect', type: 'rect', name: 'Bg', x: 0, y: 0, width: 200, height: 100 } as unknown as FlatSceneNode,
        emb1: {
          id: 'emb1',
          type: 'embed',
          name: 'Embed',
          x: 50,
          y: 20,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, frame1: ['bgRect', 'emb1'] },
      parentById: { ...s.parentById, bgRect: 'frame1', emb1: 'frame1' },
      rootIds: [...s.rootIds, 'frame1'],
      _cachedTree: null,
    }))

    const extractCanvas = vi.fn(() => backgroundCanvas)
    const pixiRefs = makeFakePixiRefs(extractCanvas, 'frame1')

    const result = await renderNodeToCanvas(pixiRefs, 'frame1', { width: 200, height: 100 }, 1)

    expect(result).toBe(backgroundCanvas)
    expect(extractCanvas).toHaveBeenCalledTimes(1)
    expect(mockedCaptureEmbedCanvas).toHaveBeenCalledWith(
      { htmlContent: '<div>hi</div>', width: 80, height: 40 },
      1,
      'emb1',
    )
    // Drawn at the embed's own absolute position within the frame (50,20), scaled by 1.
    expect(drawImage).toHaveBeenCalledWith(embedCanvas, 0, 0, 80, 40, 50, 20, 80, 40)
  })

  it('composites a nested embed at scale ≠ 1: capture uses the embed’s own logical size/scale, draw uses scaled coordinates', async () => {
    const backgroundCanvas: Record<string, unknown> = { width: 400, height: 200 }
    const drawImage = vi.fn()
    backgroundCanvas.getContext = vi.fn(() => ({ drawImage }))

    const embedCanvas = { width: 160, height: 80 }
    mockedCaptureEmbedCanvas.mockResolvedValue(embedCanvas as unknown as HTMLCanvasElement)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: {
          id: 'frame1',
          type: 'frame',
          name: 'Page',
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        } as unknown as FlatSceneNode,
        emb1: {
          id: 'emb1',
          type: 'embed',
          name: 'Embed',
          x: 50,
          y: 20,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, frame1: ['emb1'] },
      parentById: { ...s.parentById, emb1: 'frame1' },
      rootIds: [...s.rootIds, 'frame1'],
      _cachedTree: null,
    }))

    const extractCanvas = vi.fn(() => backgroundCanvas)
    const pixiRefs = makeFakePixiRefs(extractCanvas, 'frame1')

    // Requested size is already the caller-scaled design size (200x100), same
    // as scale=1 — `scale` only affects the resolution `captureEmbedCanvas`
    // is asked to rasterize at, and the coordinates `drawImage` is given.
    const result = await renderNodeToCanvas(pixiRefs, 'frame1', { width: 200, height: 100 }, 2)

    expect(result).toBe(backgroundCanvas)
    // Still asked to rasterize the embed at its own logical (unscaled) size —
    // `scale` is passed through as the resolution multiplier, not baked into
    // the requested width/height.
    expect(mockedCaptureEmbedCanvas).toHaveBeenCalledWith(
      { htmlContent: '<div>hi</div>', width: 80, height: 40 },
      2,
      'emb1',
    )
    // Destination coordinates/size are scaled by `scale` (50*2, 20*2, 80*2, 40*2).
    expect(drawImage).toHaveBeenCalledWith(embedCanvas, 0, 0, 160, 80, 100, 40, 160, 80)
  })

  it('a container with a nested embed that fails to rasterize rejects instead of silently omitting it', async () => {
    const backgroundCanvas: Record<string, unknown> = { width: 200, height: 100 }
    backgroundCanvas.getContext = vi.fn(() => ({ drawImage: vi.fn() }))
    mockedCaptureEmbedCanvas.mockResolvedValue(null)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: { id: 'frame1', type: 'frame', name: 'Page', x: 0, y: 0, width: 200, height: 100 } as unknown as FlatSceneNode,
        emb1: {
          id: 'emb1',
          type: 'embed',
          name: 'Broken embed',
          x: 50,
          y: 20,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, frame1: ['emb1'] },
      parentById: { ...s.parentById, emb1: 'frame1' },
      rootIds: [...s.rootIds, 'frame1'],
      _cachedTree: null,
    }))

    const pixiRefs = makeFakePixiRefs(vi.fn(() => backgroundCanvas), 'frame1')

    await expect(renderNodeToCanvas(pixiRefs, 'frame1', { width: 200, height: 100 }, 1)).rejects.toThrow(
      /Broken embed/,
    )
  })

  it('rejects with a clear message when the node has no Pixi container (vanished mid-export)', async () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        rect1: { id: 'rect1', type: 'rect', name: 'Gone', x: 0, y: 0, width: 10, height: 10 } as unknown as FlatSceneNode,
      },
      rootIds: [...s.rootIds, 'rect1'],
      _cachedTree: null,
    }))

    // sceneRoot has no children at all, so findContainerByLabel finds nothing.
    const pixiRefs = makeFakePixiRefs(vi.fn(), 'some-other-id')

    await expect(renderNodeToCanvas(pixiRefs, 'rect1', { width: 10, height: 10 }, 1)).rejects.toThrow(
      /not found in the canvas/,
    )
  })

  it('composites an embed nested inside a `ref` (component instance) instead of leaving a transparent hole (review #1)', async () => {
    const backgroundCanvas: Record<string, unknown> = { width: 200, height: 100 }
    const drawImage = vi.fn()
    backgroundCanvas.getContext = vi.fn(() => ({ drawImage }))

    const embedCanvas = { width: 80, height: 40 }
    mockedCaptureEmbedCanvas.mockResolvedValue(embedCanvas as unknown as HTMLCanvasElement)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        // The reusable component master: a frame with one embed child.
        component1: {
          id: 'component1',
          type: 'frame',
          name: 'Component',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          reusable: true,
        } as unknown as FlatSceneNode,
        compEmbed: {
          id: 'compEmbed',
          type: 'embed',
          name: 'Embed',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
        // The page being exported: a plain frame containing one `ref` instance.
        page: { id: 'page', type: 'frame', name: 'Page', x: 0, y: 0, width: 200, height: 100 } as unknown as FlatSceneNode,
        instance1: {
          id: 'instance1',
          type: 'ref',
          name: 'Instance',
          componentId: 'component1',
          x: 50,
          y: 20,
          width: 80,
          height: 40,
        } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, component1: ['compEmbed'], page: ['instance1'] },
      parentById: { ...s.parentById, compEmbed: 'component1', instance1: 'page' },
      rootIds: [...s.rootIds, 'component1', 'page'],
      _cachedTree: null,
    }))

    const extractCanvas = vi.fn(() => backgroundCanvas)
    const pixiRefs = makeFakePixiRefs(extractCanvas, 'page')

    const result = await renderNodeToCanvas(pixiRefs, 'page', { width: 200, height: 100 }, 1)

    expect(result).toBe(backgroundCanvas)
    // The instance's embed is composited at the instance's absolute position
    // (50,20) — the component's own embed is at (0,0) relative to it.
    expect(drawImage).toHaveBeenCalledWith(embedCanvas, 0, 0, 80, 40, 50, 20, 80, 40)
  })

  it('a `ref` exported as the root itself composites its embed content too', async () => {
    const backgroundCanvas: Record<string, unknown> = { width: 80, height: 40 }
    const drawImage = vi.fn()
    backgroundCanvas.getContext = vi.fn(() => ({ drawImage }))

    const embedCanvas = { width: 80, height: 40 }
    mockedCaptureEmbedCanvas.mockResolvedValue(embedCanvas as unknown as HTMLCanvasElement)

    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        component1: {
          id: 'component1',
          type: 'frame',
          name: 'Component',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          reusable: true,
        } as unknown as FlatSceneNode,
        compEmbed: {
          id: 'compEmbed',
          type: 'embed',
          name: 'Embed',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
          htmlContent: '<div>hi</div>',
        } as unknown as FlatSceneNode,
        instance1: {
          id: 'instance1',
          type: 'ref',
          name: 'Instance',
          componentId: 'component1',
          x: 0,
          y: 0,
          width: 80,
          height: 40,
        } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, component1: ['compEmbed'] },
      parentById: { ...s.parentById, compEmbed: 'component1' },
      rootIds: [...s.rootIds, 'component1', 'instance1'],
      _cachedTree: null,
    }))

    const extractCanvas = vi.fn(() => backgroundCanvas)
    const pixiRefs = makeFakePixiRefs(extractCanvas, 'instance1')

    const result = await renderNodeToCanvas(pixiRefs, 'instance1', { width: 80, height: 40 }, 1)

    expect(result).toBe(backgroundCanvas)
    expect(drawImage).toHaveBeenCalledWith(embedCanvas, 0, 0, 80, 40, 0, 0, 80, 40)
  })
})

describe('nodeContainsEmbed (FIR-63 review #2: PPTX raster-fallback hard/soft-fail classification)', () => {
  beforeEach(() => {
    resetStores()
  })

  it('is true for an embed node itself', () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        emb1: { id: 'emb1', type: 'embed', name: 'Embed', x: 0, y: 0, width: 10, height: 10, htmlContent: '<div/>' } as unknown as FlatSceneNode,
      },
      rootIds: [...s.rootIds, 'emb1'],
      _cachedTree: null,
    }))
    expect(nodeContainsEmbed('emb1')).toBe(true)
  })

  it('is false for a plain shape with no embed descendants', () => {
    seedScene()
    expect(nodeContainsEmbed('frame1')).toBe(false)
  })

  it('is true for a frame containing an embed descendant', () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: { id: 'frame1', type: 'frame', name: 'Page', x: 0, y: 0, width: 100, height: 100 } as unknown as FlatSceneNode,
        emb1: { id: 'emb1', type: 'embed', name: 'Embed', x: 0, y: 0, width: 10, height: 10, htmlContent: '<div/>' } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, frame1: ['emb1'] },
      parentById: { ...s.parentById, emb1: 'frame1' },
      rootIds: [...s.rootIds, 'frame1'],
      _cachedTree: null,
    }))
    expect(nodeContainsEmbed('frame1')).toBe(true)
  })

  it('is true for a `ref` instance whose resolved component contains an embed', () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        component1: { id: 'component1', type: 'frame', name: 'Component', x: 0, y: 0, width: 80, height: 40, reusable: true } as unknown as FlatSceneNode,
        compEmbed: { id: 'compEmbed', type: 'embed', name: 'Embed', x: 0, y: 0, width: 80, height: 40, htmlContent: '<div/>' } as unknown as FlatSceneNode,
        instance1: { id: 'instance1', type: 'ref', name: 'Instance', componentId: 'component1', x: 0, y: 0, width: 80, height: 40 } as unknown as FlatSceneNode,
      },
      childrenById: { ...s.childrenById, component1: ['compEmbed'] },
      parentById: { ...s.parentById, compEmbed: 'component1' },
      rootIds: [...s.rootIds, 'component1', 'instance1'],
      _cachedTree: null,
    }))
    expect(nodeContainsEmbed('instance1')).toBe(true)
  })

  it('is false for an unknown node id', () => {
    expect(nodeContainsEmbed('does-not-exist')).toBe(false)
  })
})
