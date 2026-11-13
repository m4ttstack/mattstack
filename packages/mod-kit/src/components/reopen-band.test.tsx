import { describe, expect, test } from 'bun:test'
import type { ClientElements } from 'claude-code'

import { cellWidth } from '../draw/cells'
import { BRAND } from '../draw/theme'
import { bandClient } from '../patterns/band-client'
import { drawKit } from './core'
import { Panel } from './panel'
import { ReopenBand } from './reopen-band'

const ELEMENTS = { Box: 'Box', Text: 'Text' } as unknown as ClientElements
const draw = (tree: () => unknown) => drawKit({ elements: ELEMENTS, look: { focused: true }, width: 60, focused: true }, tree)
const textOf = (line: { t: string }[]) => line.map(span => span.t).join('')

describe('ReopenBand', () => {
  test('draws the mark and label, the title, and a brand Show button on one row', () => {
    const { lines } = draw(() => (
      <Panel width={60}>
        <ReopenBand label="mattstack waiting" title="Kit gallery" onOpen={() => {}} />
      </Panel>
    ))
    expect(lines.map(textOf)).toEqual([`${BRAND.glyph} mattstack waiting  Kit gallery    Show  `])
    expect(lines[0]!.find(span => span.t === '  Show  ')?.bg).toBe(BRAND.pink)
  })

  test('in a narrow band the Show button stays whole and the words before it give way, the title first', () => {
    const at = (width: number) =>
      drawKit({ elements: ELEMENTS, look: { focused: true }, width, focused: true }, () => (
        <Panel width={width}>
          <ReopenBand label="Human Todos waiting" title="1 to-do" onOpen={() => {}} />
        </Panel>
      )).lines[0]!
    for (const width of [30, 24, 12]) {
      const line = at(width)
      expect(cellWidth(textOf(line)), `${width}`).toBeLessThanOrEqual(width)
      expect(line.at(-1)).toMatchObject({ t: '  Show  ', bg: BRAND.pink })
      expect(line.at(-1)?.action).toBeDefined()
    }
    expect(textOf(at(60))).toBe(`${BRAND.glyph} Human Todos waiting  1 to-do    Show  `)
    expect(textOf(at(30))).toBe(`${BRAND.glyph} Human Todos waiti…    Show  `)
    expect(textOf(at(12))).toBe(`${BRAND.glyph}…    Show  `)
  })

  test('the Show button runs onOpen', () => {
    let opened = 0
    const { lines, handlers } = draw(() => (
      <Panel width={60}>
        <ReopenBand label="l" title="t" onOpen={() => (opened += 1)} />
      </Panel>
    ))
    handlers.get(lines[0]!.find(span => span.t.includes('Show'))!.action!)!()
    expect(opened).toBe(1)
  })
})

describe('bandClient', () => {
  test('draws the same row as ReopenBand and posts reopen on a press of Show', () => {
    const posts: unknown[] = []
    let state: unknown
    let pointer: ((event: { type: string; x: number; y: number; button: string }) => void) | undefined
    const surface = {
      elements: ELEMENTS,
      get state() {
        return state
      },
      setState: (next: unknown) => {
        state = next
      },
      columns: 60,
      onKey: () => () => {},
      onPointer: (fn: typeof pointer) => {
        pointer = fn
        return () => {}
      },
      post: (message: unknown) => posts.push(message),
    }
    const render = () => bandClient({ formId: 'f1', title: 'Kit gallery', label: 'mattstack waiting' }, surface as never)
    expect(JSON.stringify(render())).toContain(`${BRAND.glyph} mattstack waiting  `)
    const x = `${BRAND.glyph} mattstack waiting  Kit gallery    Show  `.indexOf('Show')
    for (const type of ['down', 'up']) {
      pointer!({ type, x, y: 0, button: 'left' })
      render()
    }
    expect(posts).toEqual([{ type: 'reopen', formId: 'f1' }])
  })
})
