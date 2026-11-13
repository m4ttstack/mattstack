import { expect, test } from 'bun:test'

import { BRAND, SCROLL, SYMBOL, cellWidth } from '@mattstack/mod-kit'

import type { Todo } from '../../types'
import { BAR_ROWS, keyStops, kitLayout, kitWindow, maxOffset, modelWidth, revealOffset, stopLines } from './kit-layout'
import { paneModel } from './model'

type L = ReturnType<typeof kitWindow>[number]

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'task', title: 'Do it', status: 'open', ...over })
const modelAt = (list: Todo[], width: number) => paneModel({ list, expanded: [], spin: '⠋', width: modelWidth(width) })
const textOf = (line: L) => line.map(s => s.t).join('')
const many = (n: number) => Array.from({ length: n }, (_, k) => todo({ id: String(k + 1), title: `Item ${k + 1}` }))

test('every row of the window is exactly the pane wide, scroll bar column included, at 30 columns too', () => {
  const list = [
    todo({ id: '1', kind: 'run', title: '🚀 Deploy 日本 build', detail: '日本語の説明 with a 🚀', script: 'npm run build -- --filter=@scope/a-very-long-package-name' }),
    todo({ id: '2', title: 'Finished with a title far too long for the pane', status: 'failed', exitCode: 2 }),
  ]
  for (const width of [30, 40, 60]) {
    const layout = kitLayout(modelAt(list, width), width, 40)
    for (const line of kitWindow(layout, width, 0)) expect(cellWidth(textOf(line)), textOf(line)).toBe(width)
  }
})

test('buttons that do not fit side by side carry on to a row of their own, every one of them kept', () => {
  const layout = kitLayout(modelAt([todo({ kind: 'run', script: 'ls' })], 30), 30, 40)
  const rows = layout.lines.filter(line => line.some(s => s.action !== undefined))
  const labels = rows.map(line => line.filter(s => s.action !== undefined).map(s => s.t.trim()))
  expect(labels.length).toBeGreaterThan(1)
  expect(labels.flat()).toEqual(['Run', 'Copy', 'Done', 'Skip'])
  const roomy = kitLayout(modelAt([todo({ kind: 'run', script: 'ls' })], 60), 60, 40)
  expect(roomy.lines.filter(line => line.some(s => s.action !== undefined))).toHaveLength(1)
})

test('a running row leads with its status, and a carried-on row lines up under the first button', () => {
  const layout = kitLayout(modelAt([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'local' })], 26), 26, 40)
  const rows = layout.lines.filter(line => line.some(s => s.action !== undefined))
  expect(textOf(rows[0]!)).toContain('⠋ Running')
  if (rows.length > 1) {
    const firstButtonAt = (line: L) => cellWidth(line.slice(0, line.findIndex(s => s.action !== undefined)).map(s => s.t).join(''))
    expect(firstButtonAt(rows[1]!)).toBe(firstButtonAt(rows[0]!))
  }
})

test('a finished title too long for the room is cut with an ellipsis and keeps its exit code', () => {
  const layout = kitLayout(modelAt([todo({ title: 'A very long finished title indeed', status: 'failed', exitCode: 3 })], 30), 30, 40)
  const row = layout.lines.map(textOf).find(t => t.includes('(exit 3)'))
  expect(row).toContain('…')
  expect(cellWidth(row ?? '')).toBeLessThanOrEqual(30 - 2 - 3)
})

test('the end line follows the list only when it overflows the window, and there are no hint rows', () => {
  const short = kitLayout(modelAt(many(2), 40), 40, 20)
  expect(short.lines.map(textOf)).not.toContain("You've reached the end of the list.")
  const long = kitLayout(modelAt(many(30), 40), 40, 20)
  expect(long.lines.map(textOf).at(-1)).toBe("You've reached the end of the list.")
  expect(long.windowRows).toBe(20 - BAR_ROWS)
  const shown = kitWindow(long, 40, 5).map(textOf)
  expect(shown).toHaveLength(long.windowRows)
  expect(shown.some(t => /[↑↓] \d+ more/.test(t))).toBe(false)
  expect(shown[0]).toContain(textOf(long.lines[5]!).trim())
})

test('the window clamps an offset past the end, or below zero, to the list as it is', () => {
  const layout = kitLayout(modelAt(many(30), 40), 40, 20)
  const most = maxOffset(layout)
  expect(most).toBe(layout.lines.length - layout.windowRows)
  expect(kitWindow(layout, 40, 10_000).map(textOf)).toEqual(kitWindow(layout, 40, most).map(textOf))
  expect(kitWindow(layout, 40, -5).map(textOf)).toEqual(kitWindow(layout, 40, 0).map(textOf))
})

test('the scroll bar column shows a thumb only when the list overflows', () => {
  const thumb = (lines: L[]) => lines.filter(line => line.some(s => s.bg === SCROLL.thumb)).length
  expect(thumb(kitWindow(kitLayout(modelAt(many(2), 40), 40, 20), 40, 0))).toBe(0)
  expect(thumb(kitWindow(kitLayout(modelAt(many(30), 40), 40, 20), 40, 0))).toBeGreaterThan(0)
})

test('the key stops are each item with its buttons in order, then Clear finished', () => {
  const stops = keyStops(modelAt([todo({ id: '1', kind: 'run', script: 'ls' }), todo({ id: '2' }), todo({ id: '3', status: 'done' })], 40))
  expect(stops.map(s => `${s.key}:${s.buttons.map(b => b.id).join(',')}`)).toEqual(['1:run,copy,done,skip', '2:done,skip', 'clear:clear'])
})

test("a stop covers its item's whole span, or Clear finished's one row", () => {
  const model = modelAt([todo({ id: '1' }), todo({ id: '2', status: 'done' })], 40)
  const layout = kitLayout(model, 40, 40)
  const stops = keyStops(model)
  expect(stopLines(layout, stops, 0)).toEqual(layout.spans[0])
  const clear = stopLines(layout, stops, 1)!
  expect(clear.first).toBe(clear.last)
  expect(textOf(layout.lines[clear.first]!)).toContain('Clear finished')
})

test('revealing a stop moves the window as little as it can, and not at all while the stop shows', () => {
  const model = modelAt(many(30), 40)
  const layout = kitLayout(model, 40, 20)
  const stops = keyStops(model)
  expect(revealOffset(layout, stops, 0, 0)).toBe(0)
  const tenth = stopLines(layout, stops, 9)!
  expect(revealOffset(layout, stops, 9, 0)).toBe(tenth.last - layout.windowRows + 1)
  expect(revealOffset(layout, stops, 0, 20)).toBe(0)
  expect(revealOffset(layout, stops, 9, tenth.first)).toBe(tenth.first)
})

test('an item taller than the window is revealed from its top', () => {
  const tall = todo({ id: '2', kind: 'run', title: 'Tall', script: Array.from({ length: 30 }, (_, n) => `line ${n}`).join('\n') })
  const model = paneModel({ list: [todo({ id: '1' }), tall], expanded: ['2'], spin: '⠋', width: modelWidth(40) })
  const layout = kitLayout(model, 40, 12)
  const stops = keyStops(model)
  const range = stopLines(layout, stops, 1)!
  expect(range.last - range.first + 1).toBeGreaterThan(layout.windowRows)
  expect(revealOffset(layout, stops, 1, 0)).toBe(range.first)
})

test('in keyboard mode the selected item carries the pink rail in its gutter and a pink mark; the button its pink edge', () => {
  const model = modelAt(many(3), 40)
  const layout = kitLayout(model, 40, 40)
  const stops = keyStops(model)
  const range = stopLines(layout, stops, 1)!
  const selected = { type: 'press' as const, id: '2', button: 'done' as const }
  const lines = kitWindow(layout, 40, 0, { selected, range, marked: true })
  lines.forEach((line, n) => {
    const inItem = n >= range.first && n <= range.last
    expect(line[0]!.t === SYMBOL.bar && line[0]!.color === BRAND.pink, `row ${n}`).toBe(inItem)
  })
  expect(lines[range.first]!.find(s => s.t === '○')?.color).toBe(BRAND.pink)
  const edge = lines.flat().find(s => s.t === SYMBOL.selectEdge)
  expect(edge).toMatchObject({ color: BRAND.pink, action: selected })
  for (const line of lines) expect(cellWidth(textOf(line))).toBe(40)
})

test('out of keyboard mode nothing is marked, and a pressing selection draws pressed', () => {
  const model = modelAt(many(2), 40)
  const layout = kitLayout(model, 40, 40)
  const range = stopLines(layout, keyStops(model), 0)!
  const selected = { type: 'press' as const, id: '1', button: 'done' as const }
  const plain = kitWindow(layout, 40, 0, { selected, range, marked: false })
  expect(plain.flat().some(s => s.t === SYMBOL.selectEdge || (s.t === SYMBOL.bar && s.color === BRAND.pink))).toBe(false)
  const resting = kitWindow(layout, 40, 0).flat().find(s => s.t.trim() === 'Done')!
  const pressing = kitWindow(layout, 40, 0, { selected, range, marked: true, pressing: true }).flat().find(s => s.t.trim() === 'Done')!
  expect(pressing.bg).not.toBe(resting.bg)
})
