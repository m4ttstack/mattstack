import { describe, expect, test } from 'bun:test'

import { widthOf } from '../draw/text'
import { ICON } from '../draw/theme'
import { brandBar } from './brand-bar'
import { buttonRow, type Button } from './buttons'
import { inputField } from './input-field'
import { tabStrip, type Tab } from './tab-strip'

const WIDTH = 30

describe('narrow panes', () => {
  test('brandBar fills the width exactly, with or without a hide button', () => {
    expect(widthOf(brandBar('Questions', WIDTH))).toBe(WIDTH)
    expect(widthOf(brandBar('Questions', WIDTH, 'hide'))).toBe(WIDTH)
  })

  test('brandBar with the real label cuts the label and keeps Hide whole', () => {
    const line = brandBar('mattstack decision gate', WIDTH, 'hide')
    expect(widthOf(line)).toBe(WIDTH)
    expect(line.find(span => span.action === 'hide')?.t).toBe(` ${ICON.minimize} Hide `)
    expect(widthOf(brandBar('mattstack decision gate', 20))).toBe(20)
  })

  test('brandBar with emoji and CJK text fills the width in cells', () => {
    expect(widthOf(brandBar('🚀 mattstack 日本語 gate', WIDTH, 'hide'))).toBe(WIDTH)
    expect(widthOf(brandBar('🚀 mattstack 日本語 gate', WIDTH))).toBe(WIDTH)
    expect(widthOf(brandBar('日本語日本語日本語日本語日本語日本語', WIDTH, 'hide'))).toBe(WIDTH)
  })

  test('tabStrip with an emoji label stays within the width', () => {
    const tabs: Tab<number>[] = [{ label: '🚀 Feature flags', isDone: false, action: 0 }, { label: '日本語のタブ', isDone: false, action: 1 }, { label: 'Q2', isDone: false, action: 2 }]
    for (const current of [0, 1, 2]) expect(widthOf(tabStrip({ tabs, current, width: WIDTH, from: 0, scrollTo: n => n }))).toBeLessThanOrEqual(WIDTH)
  })

  test('buttonRow with a wide label stays within the width', () => {
    const left: Button<string>[] = [{ label: '🚀 Back', action: 'back' }, { label: '日本 Next', action: 'next' }]
    expect(widthOf(buttonRow(left, { label: '🚀🚀🚀 Chat about this', action: 'chat' }, WIDTH))).toBeLessThanOrEqual(WIDTH)
  })

  test('inputField with wide text keeps the box at its width', () => {
    for (const value of ['', '日本語日本語日本語日本語日本語', '🚀🚀🚀']) expect(widthOf(inputField(value, '🚀 placeholder 日本語 text here', 20, true))).toBe(20)
  })

  test('tabStrip with a label wider than the room fits and keeps the right mark at the edge', () => {
    const tabs: Tab<number>[] = [{ label: 'Feature flag strategy', isDone: false, action: 0 }, ...Array.from({ length: 3 }, (_, k) => ({ label: `Q${k}`, isDone: false, action: k + 1 }))]
    for (const current of [0, 2]) {
      const line = tabStrip({ tabs, current, width: WIDTH, from: 0, scrollTo: n => n })
      expect(widthOf(line)).toBe(WIDTH)
      expect(line.at(-1)?.t.length).toBe(5)
    }
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
