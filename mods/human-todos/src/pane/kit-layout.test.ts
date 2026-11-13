import { expect, test } from 'bun:test'

import { BRAND, SCROLL, SYMBOL, cellWidth } from '@mattstack/mod-kit'

import type { Todo } from '../../types'
import { BAR_ROWS, isButtonInView, kitLayout, kitView, maxOffset, modelWidth, revealButtonOffset, revealOffset, viewLines } from './kit-layout'
import type { KitFocus } from './kit-layout'
import { paneModel } from './model'
import type { PaneModel } from './model'

type L = ReturnType<typeof viewLines>[number]

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'task', title: 'Do it', status: 'open', ...over })
const modelAt = (list: Todo[], width: number) => paneModel({ list, expanded: [], spin: '⠋', width: modelWidth(width) })
const textOf = (line: L) => line.map(s => s.t).join('')
const many = (n: number) => Array.from({ length: n }, (_, k) => todo({ id: String(k + 1), title: `Item ${k + 1}` }))
// What the Client draws for the hook's view of `model`.
const draw = (model: PaneModel, width: number, bodyRows: number, offset: number, focus?: KitFocus) => viewLines(kitView(model, width, bodyRows, offset), width, focus)
const rangeOf = (model: PaneModel, width: number, bodyRows: number, index: number) => {
  const stop = kitView(model, width, bodyRows, 0).stops[index]!
  return { first: stop.first, last: stop.last }
}

test('every row of the window is exactly the pane wide, scroll bar column included, at 30 columns too', () => {
  const list = [
    todo({ id: '1', kind: 'run', title: '🚀 Deploy 日本 build', detail: '日本語の説明 with a 🚀', script: 'npm run build -- --filter=@scope/a-very-long-package-name' }),
    todo({ id: '2', title: 'Finished with a title far too long for the pane', status: 'failed', exitCode: 2 }),
  ]
  for (const width of [30, 40, 60]) {
    for (const line of draw(modelAt(list, width), width, 40, 0)) expect(cellWidth(textOf(line)), textOf(line)).toBe(width)
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

test('a running row leads with its status, and a carried-on row starts at the indent with every label whole', () => {
  const model = modelAt([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'herdr', isStopping: true })], 30)
  const layout = kitLayout(model, 30, 40)
  const lines = layout.lines.filter(line => line.some(s => s.action !== undefined) || textOf(line).includes('Stopping'))
  expect(textOf(lines[0]!)).toContain('⠋ Stopping…')
  const labels = layout.lines.flatMap(line => line.filter(s => s.action !== undefined).map(s => s.t.trim()))
  expect(labels).toEqual(['Show', 'Force stop'])
  const carried = lines.at(-1)!
  const firstButtonAt = cellWidth(carried.slice(0, carried.findIndex(s => s.action !== undefined)).map(s => s.t).join(''))
  expect(firstButtonAt).toBeLessThanOrEqual(2 + 1)
  for (const line of draw(model, 30, 40, 0)) expect(cellWidth(textOf(line))).toBe(30)
})

test('a lead with no room for a button beside it takes a row of its own', () => {
  const layout = kitLayout(modelAt([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'herdr', isStopping: true })], 22), 22, 40)
  const stoppingRow = layout.lines.find(line => textOf(line).includes('Stopping'))!
  expect(stoppingRow.some(s => s.action !== undefined)).toBe(false)
  const labels = layout.lines.flatMap(line => line.filter(s => s.action !== undefined).map(s => s.t.trim()))
  expect(labels).toEqual(['Show', 'Force stop'])
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
  const model = modelAt(many(30), 40)
  const long = kitLayout(model, 40, 20)
  expect(long.lines.map(textOf).at(-1)).toBe("You've reached the end of the list.")
  expect(long.windowRows).toBe(20 - BAR_ROWS)
  const shown = draw(model, 40, 20, 5).map(textOf)
  expect(shown).toHaveLength(long.windowRows)
  expect(shown.some(t => /[↑↓] \d+ more/.test(t))).toBe(false)
  expect(shown[0]).toContain(textOf(long.lines[5]!).trim())
})

test('the view carries only the rows its window touches, and the Client draws the same lines the whole layout has there', () => {
  const model = modelAt(many(30), 40)
  const layout = kitLayout(model, 40, 20)
  for (const offset of [0, 5, 7, 50, maxOffset(layout)]) {
    const view = kitView(model, 40, 20, offset)
    expect(view.rows.length).toBeLessThanOrEqual(view.windowRows + 1)
    const fromView = viewLines(view, 40).map(line => textOf(line).slice(2, -3).trimEnd())
    const fromLayout = layout.lines.slice(view.top, view.top + view.windowRows).map(line => textOf(line).trimEnd())
    expect(fromView).toEqual(fromLayout)
  }
})

test('the window clamps an offset past the end, or below zero, to the list as it is', () => {
  const model = modelAt(many(30), 40)
  const layout = kitLayout(model, 40, 20)
  const most = maxOffset(layout)
  expect(most).toBe(layout.lines.length - layout.windowRows)
  expect(kitView(model, 40, 20, 10_000).top).toBe(most)
  expect(kitView(model, 40, 20, -5).top).toBe(0)
  expect(draw(model, 40, 20, 10_000).map(textOf)).toEqual(draw(model, 40, 20, most).map(textOf))
})

test('the scroll bar column shows a thumb only when the list overflows', () => {
  const thumb = (lines: L[]) => lines.filter(line => line.some(s => s.bg === SCROLL.thumb)).length
  expect(thumb(draw(modelAt(many(2), 40), 40, 20, 0))).toBe(0)
  expect(thumb(draw(modelAt(many(30), 40), 40, 20, 0))).toBeGreaterThan(0)
})

test('the key stops are each item with its button ids and its filled one, then Clear finished', () => {
  const view = kitView(modelAt([todo({ id: '1', kind: 'run', script: 'ls' }), todo({ id: '2' }), todo({ id: '3', status: 'done' })], 40), 40, 40, 0)
    expect(view.stops.map(s => `${s.key}:${s.ids.join(',')}:${s.main}:${s.isItem}`)).toEqual(['1:run,copy,done,skip:0:true', '2:done,skip:0:true', 'clear:clear:0:false'])
  const running = kitView(modelAt([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'local' })], 40), 40, 40, 0)
  expect(running.stops[0]).toMatchObject({ main: 1 })
})

test("a stop covers its item's whole span, or Clear finished's one row", () => {
  const model = modelAt([todo({ id: '1' }), todo({ id: '2', status: 'done' })], 40)
  const layout = kitLayout(model, 40, 40)
  const [item, clear] = kitView(model, 40, 40, 0).stops
  expect({ first: item!.first, last: item!.last }).toEqual(layout.spans[0]!)
  expect(clear!.first).toBe(clear!.last)
  expect(textOf(layout.lines[clear!.first]!)).toContain('Clear finished')
})

test('revealing a stop moves the window as little as it can, and not at all while the stop shows', () => {
  const model = modelAt(many(30), 40)
  const at = (offset: number) => kitView(model, 40, 20, offset)
  const tenth = at(0).stops[9]!
  expect(revealOffset(at(0), 0)).toBe(0)
  expect(revealOffset(at(0), 9)).toBe(tenth.last - at(0).windowRows + 1)
  expect(revealOffset(at(20), 0)).toBe(0)
  expect(revealOffset(at(tenth.first), 9)).toBe(tenth.first)
  expect(isButtonInView(at(0), 0, 0)).toBe(true)
  expect(isButtonInView(at(0), 9, 0)).toBe(false)
  expect(isButtonInView(at(tenth.first), 9, 0)).toBe(true)
})

test('an item taller than the window is revealed from its top', () => {
  const tall = todo({ id: '2', kind: 'run', title: 'Tall', script: Array.from({ length: 30 }, (_, n) => `line ${n}`).join('\n') })
  const model = paneModel({ list: [todo({ id: '1' }), tall], expanded: ['2'], spin: '⠋', width: modelWidth(40) })
  const view = kitView(model, 40, 12, 0)
  const stop = view.stops[1]!
  expect(stop.last - stop.first + 1).toBeGreaterThan(view.windowRows)
  expect(revealOffset(view, 1)).toBe(stop.first)
})

test("each stop knows its buttons' lines, so a tall item's button can be brought into view by itself, moving the least", () => {
  const tall = todo({ id: '2', kind: 'run', title: 'Tall', script: Array.from({ length: 30 }, (_, n) => `line ${n}`).join('\n') })
  const model = paneModel({ list: [todo({ id: '1' }), tall], expanded: ['2'], spin: '⠋', width: modelWidth(40) })
  const layout = kitLayout(model, 40, 12)
  const view = kitView(model, 40, 12, 0)
  const stop = view.stops[1]!
  stop.ids.forEach((id, col) => {
    const line = layout.lines[stop.lines[col]!]!
    expect(line.some(s => s.action !== undefined && JSON.stringify(s.action).includes(`"${id === 'more' ? 'toggle' : id}"`)), id).toBe(true)
  })
  const run = stop.ids.indexOf('run')
  expect(isButtonInView(view, 1, run)).toBe(false)
  const offset = revealButtonOffset(view, 1, run)
  expect(offset).toBe(stop.lines[run]! - view.windowRows + 1)
  const there = kitView(model, 40, 12, offset)
  expect(isButtonInView(there, 1, run)).toBe(true)
  expect(revealButtonOffset(there, 1, run)).toBe(offset)
  const above = kitView(model, 40, 12, view.total)
  expect(isButtonInView(above, 0, 0)).toBe(false)
  expect(revealButtonOffset(above, 0, 0)).toBe(view.stops[0]!.lines[0]!)
})

test('in keyboard mode the selected item carries the pink rail in its gutter and a pink mark; the button its pink edge', () => {
  const model = modelAt(many(3), 40)
  const range = rangeOf(model, 40, 40, 1)
  const selected = { type: 'press' as const, id: '2', button: 'done' as const }
  const lines = draw(model, 40, 40, 0, { selected, range, marked: true })
  lines.forEach((line, n) => {
    const inItem = n >= range.first && n <= range.last
    expect(line[0]!.t === SYMBOL.bar && line[0]!.color === BRAND.pink, `row ${n}`).toBe(inItem)
  })
  expect(lines[range.first]!.find(s => s.t === '○')?.color).toBe(BRAND.pink)
  const edge = lines.flat().find(s => s.t === SYMBOL.selectEdge)
  expect(edge).toMatchObject({ color: BRAND.pink, action: selected })
  for (const line of lines) expect(cellWidth(textOf(line))).toBe(40)
})

test('scrolled, the rail marks the selected item where the window shows it', () => {
  const model = modelAt(many(30), 40)
  const range = rangeOf(model, 40, 20, 5)
  const top = range.first - 3
  const lines = draw(model, 40, 20, top, { selected: { type: 'press', id: '6', button: 'done' }, range, marked: true })
  const railed = lines.flatMap((line, n) => (line[0]!.t === SYMBOL.bar ? [n + top] : []))
  expect(railed).toEqual(Array.from({ length: range.last - range.first + 1 }, (_, n) => range.first + n))
})

test('out of keyboard mode nothing is marked, and a pressing selection draws pressed', () => {
  const model = modelAt(many(2), 40)
  const range = rangeOf(model, 40, 40, 0)
  const selected = { type: 'press' as const, id: '1', button: 'done' as const }
  const plain = draw(model, 40, 40, 0, { selected, range, marked: false })
  expect(plain.flat().some(s => s.t === SYMBOL.selectEdge || (s.t === SYMBOL.bar && s.color === BRAND.pink))).toBe(false)
  const resting = draw(model, 40, 40, 0).flat().find(s => s.t.trim() === 'Done')!
  const pressing = draw(model, 40, 40, 0, { selected, range, marked: true, pressing: true }).flat().find(s => s.t.trim() === 'Done')!
  expect(pressing.bg).not.toBe(resting.bg)
})

// The engine refuses a Client's props past 100,000 serialized characters, and the pane sends them on every spinner tick.
test("the Client's props stay well under the engine's cap for a long list with a long confirming script", () => {
  const list: Todo[] = Array.from({ length: 200 }, (_, k) =>
    todo({ id: String(k), kind: 'run', title: `A step with a fairly ordinary title ${k}`, detail: 'Some detail that explains the step in a sentence or two.', script: 'make build && make test', cwd: '/Users/someone/projects/repo' }),
  )
  list.push(todo({ id: 'big', kind: 'run', title: 'Big', status: 'confirming', script: Array.from({ length: 2000 }, (_, n) => `echo line number ${n} of a long script`).join('\n') }))
  for (const width of [30, 80, 200]) {
    for (const bodyRows of [20, 120]) {
      const model = paneModel({ list, expanded: [], spin: '⠋', width: modelWidth(width) })
      const whole = JSON.stringify({ model, focused: true, width })
      const sent = JSON.stringify({ view: kitView(model, width, bodyRows, 1_000_000), focused: true, width })
      expect(whole.length).toBeGreaterThan(100_000)
      expect(sent.length, `${width}x${bodyRows}`).toBeLessThan(50_000)
    }
  }
})
