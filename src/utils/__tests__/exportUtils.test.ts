import { describe, it, expect, beforeEach } from 'vitest'
import { Rectangle } from 'pixi.js'
import { toExtractFrame, getNodeExportSize } from '@/utils/exportUtils'
import { useSceneStore } from '@/store/sceneStore'
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
