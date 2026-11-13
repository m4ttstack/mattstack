import { describe, expect, test } from 'bun:test'

import { widthOf } from '../draw/text'
import { ICON } from '../draw/theme'
import { brandBar } from './brand-bar'
import { buttonRow, type Button } from './buttons'
import { tabStrip, type Tab } from './tab-strip'

const WIDTH = 30

describe('narrow panes', () => {
  test('brandBar fills the width exactly, with or without a hide button', () => {
    expect(widthOf(brandBar('Questions', WIDTH))).toBe(WIDTH)
    expect(widthOf(brandBar('Questions', WIDTH, 'hide'))).toBe(WIDTH)
  })

  test('tabStrip with 10 tabs fits', () => {
    const tabs: Tab<number>[] = Array.from({ length: 10 }, (_, k) => ({ label: `Q${k}`, isDone: false, action: k }))
    for (const current of [0, 5, 9]) expect(widthOf(tabStrip({ tabs, current, width: WIDTH, from: 0, scrollTo: n => n }))).toBeLessThanOrEqual(WIDTH)
  })

  test('buttonRow with Back, Next and Chat fits', () => {
    const left: Button<string>[] = [{ label: 'Back', action: 'back' }, { label: 'Next', action: 'next' }]
    expect(widthOf(buttonRow(left, { label: 'Chat', action: 'chat' }, WIDTH))).toBeLessThanOrEqual(WIDTH)
  })

  test('buttonRow with the real labels fits and its buttons stay clickable', () => {
    const left: Button<string>[] = [{ label: `${ICON.back} Back`, action: 'back' }, { label: `Next ${ICON.next}`, action: 'next' }]
    const line = buttonRow(left, { label: `${ICON.chat} Chat about this`, action: 'chat' }, WIDTH)
    expect(widthOf(line)).toBeLessThanOrEqual(WIDTH)
    expect(line.flatMap(span => (span.action ? [span.action] : []))).toEqual(['back', 'next', 'chat'])
  })

  test('buttonRow keeps its roomy layout when there is room', () => {
    const line = buttonRow([{ label: 'Back', action: 'back' }], { label: 'Chat', action: 'chat' }, 60)
    expect(widthOf(line)).toBe(60)
  })
})
