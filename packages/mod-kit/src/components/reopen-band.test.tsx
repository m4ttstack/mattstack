import { describe, expect, test } from 'bun:test'
import type { ClientElements } from 'claude-code'

import { BRAND } from '../draw/theme'
import { bandClient } from '../patterns/band-client'
import { drawKit } from './core'
import { Panel } from './panel'
import { ReopenBand } from './reopen-band'

const ELEMENTS = { Box: 'Box', Text: 'Text' } as unknown as ClientElements
const draw = (tree: () => unknown) => drawKit({ elements: ELEMENTS, look: { focused: true }, width: 60, focused: true }, tree)
const textOf = (line: { t: string }[]) => line.map(span => span.t).join('')

describe('ReopenBand', () => {
  test('draws the mark and label, the title, and a brand Open button on one row', () => {
    const { lines } = draw(() => (
      <Panel width={60}>
        <ReopenBand label="mattstack waiting" title="Kit gallery" onOpen={() => {}} />
      </Panel>
    ))
    expect(lines.map(textOf)).toEqual([`${BRAND.glyph} mattstack waiting  Kit gallery    Open  `])
    expect(lines[0]!.find(span => span.t === '  Open  ')?.bg).toBe(BRAND.pink)
  })

  test('the Open button runs onOpen', () => {
    let opened = 0
    const { lines, handlers } = draw(() => (
      <Panel width={60}>
        <ReopenBand label="l" title="t" onOpen={() => (opened += 1)} />
      </Panel>
    ))
    handlers.get(lines[0]!.find(span => span.t.includes('Open'))!.action!)!()
    expect(opened).toBe(1)
  })
})

describe('bandClient', () => {
  test('draws the same row as ReopenBand and posts reopen on a press of Open', () => {
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
    const x = `${BRAND.glyph} mattstack waiting  Kit gallery    Open  `.indexOf('Open')
    for (const type of ['down', 'up']) {
      pointer!({ type, x, y: 0, button: 'left' })
      render()
    }
    expect(posts).toEqual([{ type: 'reopen', formId: 'f1' }])
  })
})
