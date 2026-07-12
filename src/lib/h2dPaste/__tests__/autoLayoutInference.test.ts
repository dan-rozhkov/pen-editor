import { describe, expect, it } from 'vitest'
import type { FrameNode, SceneNode } from '@/types/scene'
import { inferAutoLayout, maybeApplyAutoLayout, verifyAutoLayout } from '../autoLayoutInference'

function frame(id: string, x: number, y: number, width: number, height: number): FrameNode {
  return { id, type: 'frame', name: id, x, y, width, height, children: [] }
}

function container(id: string, width: number, height: number, children: SceneNode[]): FrameNode {
  return { id, type: 'frame', name: id, x: 0, y: 0, width, height, children }
}

describe('inferAutoLayout + verifyAutoLayout + maybeApplyAutoLayout', () => {
  it('column flex: gap 16, padding 48, three children exactly matching the flow -> layout applied', () => {
    // frame content width 200 (296 - 48*2); three 200x50 children stacked
    // with a 16px gap and 48px padding on every side.
    const c1 = frame('c1', 48, 48, 200, 50)
    const c2 = frame('c2', 48, 114, 200, 50) // 48 + 50 + 16
    const c3 = frame('c3', 48, 180, 200, 50) // 114 + 50 + 16
    const f = container('f', 296, 278, [c1, c2, c3]) // 180 + 50 + 48

    const styles = {
      display: 'flex',
      flexDirection: 'column',
      rowGap: '16px',
      columnGap: '16px',
      paddingTop: '48px',
      paddingRight: '48px',
      paddingBottom: '48px',
      paddingLeft: '48px',
      alignItems: 'flex-start',
    }
    const childStyles = [{}, {}, {}]

    maybeApplyAutoLayout(f, styles, childStyles)

    expect(f.layout).toBeTruthy()
    expect(f.layout?.autoLayout).toBe(true)
    expect(f.layout?.flexDirection).toBe('column')
    expect(f.layout?.gap).toBe(16)
    expect(f.layout?.paddingTop).toBe(48)
    expect(f.layout?.paddingRight).toBe(48)
    expect(f.layout?.paddingBottom).toBe(48)
    expect(f.layout?.paddingLeft).toBe(48)
    expect(f.layout?.alignItems).toBe('flex-start')
    // positions themselves must be untouched by applying the layout
    expect(c1.x).toBe(48)
    expect(c3.y).toBe(180)
  })

  it('column flex with one child shifted 5px off the flow position -> no layout applied', () => {
    const c1 = frame('c1', 48, 48, 200, 50)
    const c2 = frame('c2', 48, 114, 200, 50)
    const c3 = frame('c3', 48, 185, 200, 50) // shifted +5 from the exact 180
    const f = container('f', 296, 283, [c1, c2, c3])

    const styles = {
      display: 'flex',
      flexDirection: 'column',
      rowGap: '16px',
      columnGap: '16px',
      paddingTop: '48px',
      paddingRight: '48px',
      paddingBottom: '48px',
      paddingLeft: '48px',
    }
    const childStyles = [{}, {}, {}]

    const candidate = inferAutoLayout(styles, f, childStyles)
    expect(candidate).toBeTruthy()
    expect(verifyAutoLayout(f, candidate!)).toBe(false)

    maybeApplyAutoLayout(f, styles, childStyles)
    expect(f.layout).toBeUndefined()
  })

  it('row flex with justify-content: space-between -> verified and applied', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 300, 0, 100, 100) // 400 - 100 - 100 free space, single gap
    const f = container('f', 400, 100, [c1, c2])

    const styles = { display: 'flex', justifyContent: 'space-between' }
    const childStyles = [{}, {}]

    maybeApplyAutoLayout(f, styles, childStyles)

    expect(f.layout).toBeTruthy()
    expect(f.layout?.flexDirection).toBe('row')
    expect(f.layout?.justifyContent).toBe('space-between')
  })

  it('display:flex but a child has position:absolute -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 100, 0, 100, 100)
    const f = container('f', 200, 100, [c1, c2])

    const styles = { display: 'flex' }
    const childStyles: Record<string, string>[] = [{}, { position: 'absolute' }]

    const candidate = inferAutoLayout(styles, f, childStyles)
    expect(candidate).toBeNull()

    maybeApplyAutoLayout(f, styles, childStyles)
    expect(f.layout).toBeUndefined()
  })

  it('non-px gap values (normal, percentage) -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 100, 0, 100, 100)
    const f = container('f', 200, 100, [c1, c2])
    const childStyles = [{}, {}]

    expect(inferAutoLayout({ display: 'flex', columnGap: 'normal' }, f, childStyles)).toBeNull()
    expect(inferAutoLayout({ display: 'flex', columnGap: '10%' }, f, childStyles)).toBeNull()
    expect(inferAutoLayout({ display: 'flex', rowGap: 'normal' }, f, childStyles)).toBeNull()
  })

  it('align-items: baseline -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 100, 0, 100, 100)
    const f = container('f', 200, 100, [c1, c2])
    const childStyles = [{}, {}]

    expect(inferAutoLayout({ display: 'flex', alignItems: 'baseline' }, f, childStyles)).toBeNull()
  })

  it('non-flex display -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const f = container('f', 200, 100, [c1])
    expect(inferAutoLayout({ display: 'block' }, f, [{}])).toBeNull()
    expect(inferAutoLayout({}, f, [{}])).toBeNull()
  })

  it('reversed flex directions and wrap-reverse -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 100, 0, 100, 100)
    const f = container('f', 200, 100, [c1, c2])
    const childStyles = [{}, {}]

    expect(inferAutoLayout({ display: 'flex', flexDirection: 'row-reverse' }, f, childStyles)).toBeNull()
    expect(inferAutoLayout({ display: 'flex', flexDirection: 'column-reverse' }, f, childStyles)).toBeNull()
    expect(inferAutoLayout({ display: 'flex', flexWrap: 'wrap-reverse' }, f, childStyles)).toBeNull()
  })

  it('frame with no children -> no candidate', () => {
    const f = container('f', 200, 100, [])
    expect(inferAutoLayout({ display: 'flex' }, f, [])).toBeNull()
  })

  it('non-wrap row flex with asymmetric rowGap/columnGap -> collapses to a single gap = main-axis (columnGap)', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 120, 0, 100, 100) // 100 + columnGap(20)
    const f = container('f', 220, 100, [c1, c2])

    const styles = { display: 'flex', rowGap: '5px', columnGap: '20px' }
    const childStyles = [{}, {}]

    const candidate = inferAutoLayout(styles, f, childStyles)
    expect(candidate).toBeTruthy()
    expect(candidate?.gap).toBe(20)
    expect(candidate?.rowGap).toBeUndefined()
    expect(candidate?.columnGap).toBeUndefined()
    expect(candidate?.flexWrap).toBeUndefined()

    maybeApplyAutoLayout(f, styles, childStyles)
    expect(f.layout?.gap).toBe(20)
  })

  it('non-wrap column flex with asymmetric rowGap/columnGap -> collapses to a single gap = main-axis (rowGap)', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 0, 130, 100, 100) // 100 + rowGap(30)
    const f = container('f', 100, 230, [c1, c2])

    const styles = { display: 'flex', flexDirection: 'column', rowGap: '30px', columnGap: '5px' }
    const childStyles = [{}, {}]

    const candidate = inferAutoLayout(styles, f, childStyles)
    expect(candidate).toBeTruthy()
    expect(candidate?.gap).toBe(30)
    expect(candidate?.rowGap).toBeUndefined()
    expect(candidate?.columnGap).toBeUndefined()
  })

  it('wrapped row flex with asymmetric rowGap/columnGap -> keeps rowGap/columnGap split', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const c2 = frame('c2', 120, 0, 100, 100) // 100 + columnGap(20)
    const f = container('f', 220, 100, [c1, c2])

    const styles = { display: 'flex', flexWrap: 'wrap', rowGap: '5px', columnGap: '20px' }
    const childStyles = [{}, {}]

    const candidate = inferAutoLayout(styles, f, childStyles)
    expect(candidate).toBeTruthy()
    expect(candidate?.flexWrap).toBe(true)
    expect(candidate?.rowGap).toBe(5)
    expect(candidate?.columnGap).toBe(20)
    expect(candidate?.gap).toBeUndefined()
  })

  it('non-px padding value (present but unparseable) -> no candidate', () => {
    const c1 = frame('c1', 0, 0, 100, 100)
    const f = container('f', 100, 100, [c1])
    const childStyles = [{}]

    expect(inferAutoLayout({ display: 'flex', paddingTop: '5%' }, f, childStyles)).toBeNull()
  })
})
