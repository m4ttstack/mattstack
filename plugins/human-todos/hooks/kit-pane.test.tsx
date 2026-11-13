import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { SESSION, children, pid, press, startSession, world } from './test-world'
import type { Child } from './test-world'

type On = Parameters<typeof world>[0]
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type Drawing = { find: (q: { type: string }) => Promise<{ key?: string; props: Record<string, unknown> } | undefined>; drawn: (scope?: { in?: string }) => Promise<unknown> }

const SURFACES = ['terminal', 'desktop'] as const
const LIST = 'mcp__human-todos__list'
const END = "You've reached the end of the list."
const THUMB = '#707070'

const PANE = {
  plugin: 'human-todos',
  component: 'Pane',
  requestId: 'human-todos',
  props: { title: 'Human Todos', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BAND = {
  plugin: 'human-todos',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const paneAt = (over: { isFocused?: boolean; bodyColumns?: number; bodyRows?: number } = {}) => ({
  ...PANE.props,
  ...(over.isFocused !== undefined && { isFocused: over.isFocused }),
  ...(over.bodyColumns !== undefined && { bodyColumns: over.bodyColumns }),
  scroll: { offset: 0, bodyRows: over.bodyRows ?? 20 },
})

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'run', title: 'Deploy', script: 'make deploy', status: 'open', ...over })

async function seeded($: Engine, on: On, list: Todo[]) {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: list, nextId: 50, savedAt: 1_000_000 } } })
  await startSession($)
  return w
}

const state = async ($: Engine) => (await $.tool.call({ tool: LIST })).result

const shown = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(shown).join(''))

async function clientOf(ui: Drawing) {
  const client = await ui.find({ type: 'Client' })
  if (!client?.key) throw new Error('no Client drawn')
  return client
}

// The rows the pane's Client drew, one string each.
async function rowsOf(ui: Drawing): Promise<string[]> {
  const { key } = await clientOf(ui)
  return (((await ui.drawn({ in: key })) as Node).children ?? []).map(shown)
}

// The rows whose spans include one drawn in the scroll bar's thumb colour.
async function thumbRows(ui: Drawing): Promise<number[]> {
  const { key } = await clientOf(ui)
  const lines = ((await ui.drawn({ in: key })) as Node).children ?? []
  const has = (node: unknown): boolean => typeof node === 'object' && node !== null && ((node as Node).props?.backgroundColor === THUMB || ((node as Node).children ?? []).some(has))
  return lines.flatMap((line, n) => (has(line) ? [n] : []))
}

const propsOf = async (ui: Drawing) => (await clientOf(ui)).props.props as { focused: boolean; width: number; offset: number; bodyRows: number }

const cellOf = (rows: string[], word: string) => {
  const y = rows.findIndex(r => r.includes(word))
  return { y, x: y < 0 ? -1 : rows[y]!.indexOf(word) + 1 }
}

async function click(ui: Drawing & { pointer: (e: { type: 'down' | 'up'; x: number; y: number; button: 'left' }) => Promise<void> }, word: string) {
  const at = cellOf(await rowsOf(ui), word)
  if (at.y < 0) throw new Error(`no ${word} drawn`)
  await ui.pointer({ type: 'down', ...at, button: 'left' })
  await ui.pointer({ type: 'up', ...at, button: 'left' })
}

// Terminal cells, as a terminal draws them: emoji and East Asian wide characters take two.
const WIDE = /\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿＀-｠￠-￦]/u
const cells = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), s => (WIDE.test(s.segment) ? 2 : 1)).reduce((a, b) => a + b, 0)

const scrollBy = ($: Engine, by: number, rows = { bodyRows: 20, contentRows: 20 }) =>
  $.ui.scroll({ component: 'Pane', requestId: 'human-todos', offset: 0, by, ...rows, origin: { kind: 'person' } })

for (const surface of SURFACES) {
  test(`the pane draws a Client on the kit drawer (${surface})`, async ($, on) => {
    await seeded($, on, [todo({})])
    const pane = await $.ui.mount({ ...PANE, surface })
    const client = await clientOf(pane)
    expect(String(client.props.module)).toMatch(/pane\/kit-view\.js$/)
    const rows = await rowsOf(pane)
    expect(rows[0]).toContain('Human Todos')
    expect(rows[0]).toContain('Hide')
    expect(rows.some(r => r.includes('○ Deploy'))).toBe(true)
    await pane.unmount()
  })

  test(`a pointer down and up on Run asks to confirm (${surface})`, async ($, on) => {
    await seeded($, on, [todo({})])
    const pane = await $.ui.mount({ ...PANE, surface })
    await click(pane, 'Run')
    expect(await state($)).toMatch(/^#1 \[confirming\]/)
    expect((await rowsOf(pane)).some(r => r.includes('Confirm'))).toBe(true)
    await pane.unmount()
  })

  test(`the first click on an unfocused pane only focuses it; the next one acts (${surface})`, async ($, on) => {
    await seeded($, on, [todo({})])
    const pane = await $.ui.mount({ ...PANE, props: paneAt({ isFocused: false }), surface })
    expect((await propsOf(pane)).focused).toBe(false)

    await click(pane, 'Run')
    expect(await state($)).toMatch(/^#1 \[open\]/)
    expect((await propsOf(pane)).focused).toBe(true)

    await click(pane, 'Run')
    expect(await state($)).toMatch(/^#1 \[confirming\]/)
    await pane.unmount()
  })

  test(`typing, submitting and a focus move each take the focus back (${surface})`, async ($, on) => {
    on('prompt.edit', (_, e) => ({ text: e.text, cursor: e.cursor }))
    on('ui.focus', () => ({}))
    await seeded($, on, [todo({})])
    const pane = await $.ui.mount({ ...PANE, props: paneAt({ isFocused: false }), surface })
    const clears: [string, () => Promise<unknown>][] = [
      ['prompt.edit', () => $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' } as never)],
      ['prompt.submit', () => $.prompt.submit({ text: 'hi', wait: false } as never)],
      ['ui.focus', () => $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } } as never)],
    ]
    for (const [name, fire] of clears) {
      await pane.post({ type: 'engaged' })
      expect((await propsOf(pane)).focused, `after engaged, before ${name}`).toBe(true)
      await fire()
      expect((await propsOf(pane)).focused, `after ${name}`).toBe(false)
    }
    await pane.unmount()
  })

  test(`Hide closes the pane and the band's Open brings it back (${surface})`, async ($, on) => {
    const { opened } = await seeded($, on, [todo({})])
    await $.command.run({ command: 'todos', args: '' })
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    const pane = await $.ui.mount({ ...PANE, surface })

    await click(pane, 'Hide')
    const shownBand = await rowsOf(band)
    expect(shownBand[0]).toContain('Human Todos waiting')
    expect(shownBand[0]).toContain('1 to-do')

    const before = opened.length
    await click(band, 'Open')
    expect(opened.slice(before)).toEqual(['human-todos'])
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    await pane.unmount()
    await band.unmount()
  })

  test(`at 30 columns no row is wider than the pane, and Done still reports (${surface})`, async ($, on) => {
    const { sent } = await seeded($, on, [
      todo({ title: '🚀 Deploy 日本 build', detail: '日本語の説明 with a 🚀 in it', script: 'npm run build -- --filter=@scope/a-package-with-a-very-long-name && ./scripts/deploy.sh production' }),
    ])
    const pane = await $.ui.mount({ ...PANE, props: paneAt({ bodyColumns: 30 }), surface })
    const rows = await rowsOf(pane)
    for (const row of rows) expect(cells(row), row).toBeLessThanOrEqual(30)
    expect(rows.some(r => r.includes('🚀'))).toBe(true)

    await click(pane, 'Done')
    expect(await state($)).toMatch(/^#1 \[done\]/)
    expect(sent.at(-1)).toContain('#1')
    await pane.unmount()
  })
}

test('on vscode the plain drawer draws, with no Client, and its buttons press', async ($, on) => {
  await seeded($, on, [todo({})])
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  expect(await pane.find({ key: 'run-1' })).toBeDefined()
  await pane.press({ key: 'run-1' })
  expect(await state($)).toMatch(/^#1 \[confirming\]/)
  await pane.unmount()
})

test('on mobile the band is the plain one', async ($, on) => {
  await seeded($, on, [todo({})])
  const band = await $.ui.mount({ ...BAND, surface: 'mobile' })
  expect(await band.find({ type: 'Client' })).toBeUndefined()
  expect((await band.find({ key: 'open-pane' }))?.text).toBe('Open')
  await band.unmount()
})

// `still`: the pointer stays where it went down while the rows move under it. `follows`: it moves onto Stop where Stop now is.
for (const release of ['still', 'follows'] as const) test(`a press on Stop holds while output streams in, and a release (${release}) stops the run`, async ($, on) => {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: [todo({})], nextId: 50, savedAt: 1_000_000 } } })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.write', () => ({ value: undefined }))
  mock.env(on, { HOME: '/home/u' })
  children(on, () =>
    (async function* (): Child {
      yield pid(4242)
      for (const n of [1, 2]) {
        await w.clock.sleep(400)
        yield { stream: 'stdout', text: `line ${n}\n` }
      }
      await new Promise<void>(() => {})
      return { code: 0, signal: null }
    })(),
  )
  await startSession($)
  await $.command.run({ command: 'todos-runner', args: 'local' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press(pane, '1', 'run')
  await press(pane, '1', 'confirm')
  await w.clock.settle()

  const before = await rowsOf(pane)
  const down = cellOf(before, 'Stop')
  expect(down.y).toBeGreaterThan(-1)
  await pane.pointer({ type: 'down', ...down, button: 'left' })

  // The live tail flushes once a second, and the spinner ticks every 100 ms in between.
  await w.clock.sleeping()
  const tailRows = async () => (await rowsOf(pane)).filter(r => r.includes('line ')).length
  for (let ms = 0; ms < 3000 && (await tailRows()) < 2; ms += 100) await w.clock.advance(100)
  const streamed = await rowsOf(pane)
  await w.clock.advance(100)
  const after = await rowsOf(pane)
  expect(after.find(r => r.includes('Deploy'))).not.toBe(streamed.find(r => r.includes('Deploy')))
  expect(after.filter(r => r.includes('line '))).toHaveLength(2)
  expect(after.join('\n')).not.toBe(before.join('\n'))
  const moved = cellOf(after, 'Stop')
  expect(moved.y).not.toBe(down.y)
  expect(after[down.y]).not.toContain('Stop')

  if (release === 'follows') await pane.pointer({ type: 'move', ...moved, button: 'left' })
  await pane.pointer({ type: 'up', ...(release === 'still' ? down : moved), button: 'left' })
  const items = (w.store.get(`list:${SESSION}`) as { todos: Todo[] }).todos
  expect(items.find(t => t.id === '1')).toMatchObject({ status: 'running', isStopping: true })
  expect(toasts).toContain('Stopping #1')
  await pane.unmount()
})

const many = (n: number, over: Partial<Todo> = {}) => Array.from({ length: n }, (_, k) => todo({ id: String(k + 1), kind: 'task', title: `Item ${k + 1}`, script: undefined, ...over }))

test('the mod scrolls the kit drawer: the brand bar stays, the window moves, hints and the thumb follow', async ($, on) => {
  const beneath: number[] = []
  on('ui.scroll', (_, e) => {
    beneath.push(e.by)
    return {}
  })
  await seeded($, on, many(30))
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const top = await rowsOf(pane)
  expect(top).toHaveLength(20)
  expect(top[2]).toContain('○ Item 1')
  expect(await thumbRows(pane)).toContain(2)

  expect(await scrollBy($, 5)).toEqual({})
  expect(beneath).toEqual([])
  const rows = await rowsOf(pane)
  expect(rows).toHaveLength(20)
  expect(rows[0]).toContain('Human Todos')
  expect(rows[0]).toContain('Hide')
  // Body row 0 is model row 5 under the ↑ hint; rows 6 and 8 follow it: Item 2's buttons, then Item 3's title.
  expect(rows[2]?.trim().startsWith('↑ 2 more')).toBe(true)
  expect(rows[3]).toContain('Done')
  expect(rows[5]).toContain('○ Item 3')
  expect(rows[19]?.trim().startsWith('↓ 24 more')).toBe(true)
  expect((await propsOf(pane)).offset).toBe(5)
  const thumb = await thumbRows(pane)
  expect(thumb.length).toBeGreaterThan(0)
  expect(thumb).not.toContain(2)

  await scrollBy($, -100)
  expect((await propsOf(pane)).offset).toBe(0)
  expect((await rowsOf(pane))[2]).toContain('○ Item 1')

  await scrollBy($, 1000)
  const bottom = await rowsOf(pane)
  expect(bottom.at(-1)).toContain(END)
  expect(bottom.some(r => r.includes('↓'))).toBe(false)
  expect(await thumbRows(pane)).toContain(19)
  await pane.unmount()
})

test('Clear finished while scrolled to the bottom clamps the window to the shorter list', async ($, on) => {
  const done = many(8).map(t => ({ ...t, id: `d${t.id}`, title: `Finished ${t.id}`, status: 'done' as const }))
  await seeded($, on, [...many(10), ...done])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await scrollBy($, 1000)
  expect((await rowsOf(pane)).at(-1)).toContain(END)

  await click(pane, 'Clear finished')
  expect(await state($)).not.toContain('Finished')
  const rows = await rowsOf(pane)
  expect(rows).toHaveLength(20)
  expect(rows.at(-1)).toContain(END)
  expect(rows.slice(2).filter(r => r.trim() !== '').length).toBeGreaterThan(5)
  expect(rows.some(r => r.includes('Finished'))).toBe(false)
  await pane.unmount()
})

test('a shrink writes the clamped offset back, so a list that grows again is not left scrolled to the old depth', async ($, on) => {
  const done = many(8).map(t => ({ ...t, id: `d${t.id}`, title: `Finished ${t.id}`, status: 'done' as const }))
  await seeded($, on, [...many(10), ...done])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await scrollBy($, 1000)
  // 10 items of 4 rows, 8 finished, a blank, Clear finished, then a blank and the end line: 52 rows in an 18-row window.
  expect((await propsOf(pane)).offset).toBe(34)

  await click(pane, 'Clear finished')
  // 40 rows and the end line.
  expect((await propsOf(pane)).offset).toBe(23)

  for (const title of ['New 1', 'New 2', 'New 3']) await $.tool.call({ tool: 'mcp__human-todos__add', kind: 'task', title })
  expect((await propsOf(pane)).offset).toBe(23)
  expect((await rowsOf(pane)).some(r => r.includes(END))).toBe(false)

  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '1' })
  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '2' })
  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '3' })
  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '4' })
  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '5' })
  // 8 items of 4 rows and the end line.
  expect((await propsOf(pane)).offset).toBe(15)
  await pane.unmount()
})

test('the plain drawer keeps the engine scroll: the move passes beneath and the kit window stays put', async ($, on) => {
  const beneath: number[] = []
  on('ui.scroll', (_, e) => {
    beneath.push(e.by)
    return {}
  })
  await seeded($, on, many(30))
  const plain = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await scrollBy($, 3, { bodyRows: 20, contentRows: 125 })).toEqual({})
  expect(beneath).toEqual([3])
  await plain.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await propsOf(pane)).offset).toBe(0)
  expect((await rowsOf(pane))[2]).toContain('○ Item 1')
  await pane.unmount()
})
