import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { SESSION, startSession, world } from './test-world'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'human-todos',
  component: 'Pane',
  requestId: 'human-todos',
  props: { title: 'Human Todos', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const BAND = {
  plugin: 'human-todos',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 } },
} as const

const MESSAGE = (text: string, over: Record<string, unknown> = {}) =>
  ({
    plugin: 'human-todos',
    component: 'UserMessage',
    props: { text, origin: { kind: 'plugin', name: 'human-todos' }, isExpanded: false, ...over },
  }) as const

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'task', title: 'Do it', status: 'open', ...over })

async function seeded($: Engine, on: Parameters<typeof world>[0], list: Todo[]) {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: list, nextId: 20, savedAt: 1_000_000 } } })
  await startSession($)
  return w
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const buttons = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key)

test('the header shows the title and Close, which closes the pane and lets the band return', async ($, on) => {
  await seeded($, on, [todo({})])
  for (const surface of SURFACES) {
    await $.command.run({ command: 'todos', args: '' })
    const pane = await $.ui.mount({ ...PANE, surface })
    expect((await texts(pane))[0]).toBe('Human Todos')
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'open-pane' })).toBeUndefined()

    await pane.press({ key: 'close' })
    expect(await band.find({ key: 'open-pane' })).toBeDefined()
    await pane.unmount()
    await band.unmount()
  }
})

test('an open run item draws title, detail, a clipped script and its buttons in order', async ($, on) => {
  await seeded($, on, [todo({ kind: 'run', title: 'Deploy', detail: 'To staging', script: 'one\ntwo\nthree\nfour' })])
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const rows = await texts(pane)

    expect(rows).toContain('○ Deploy')
    expect(rows).toContain('To staging')
    expect(rows).toContain('$ one')
    expect(rows).toContain('two')
    expect(rows).not.toContain('three')
    expect(rows).toContain('… +2 more')
    expect(await buttons(pane)).toEqual(['close', 'more-1', 'run-1', 'copy-1', 'done-1', 'skip-1'])
    expect((await pane.find({ key: 'more-1' }))?.text).toBe('Show all')

    await pane.press({ key: 'more-1' })
    expect(await texts(pane)).toContain('four')
    expect(await texts(pane)).not.toContain('… +2 more')
    expect((await pane.find({ key: 'more-1' }))?.text).toBe('Show less')

    await pane.press({ key: 'more-1' })
    expect((await pane.find({ key: 'more-1' }))?.text).toBe('Show all')
    await pane.unmount()
  }
})

test('every kind draws the buttons the spec lists, each keyed button-id', async ($, on) => {
  await seeded($, on, [
    todo({ id: '1', kind: 'task' }),
    todo({ id: '2', kind: 'terminal', script: 'sudo ls' }),
    todo({ id: '3', kind: 'link', url: 'https://example.com' }),
    todo({ id: '4', kind: 'run', script: 'ls' }),
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await buttons(pane)).toEqual([
    'close',
    'done-1',
    'skip-1',
    'copy-2',
    'done-2',
    'skip-2',
    'open-3',
    'done-3',
    'skip-3',
    'run-4',
    'copy-4',
    'done-4',
    'skip-4',
  ])
  expect((await pane.find({ key: 'open-3' }))?.props.variant).toBe('primary')
  expect((await pane.find({ key: 'run-4' }))?.props.variant).toBe('primary')
  expect(await texts(pane)).toContain('https://example.com')
  await pane.unmount()
})

test('pressing a button leaves the list as it was and the pane drawn', async ($, on) => {
  await seeded($, on, [todo({ kind: 'run', script: 'ls' })])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'done-1' })
  expect(await pane.find({ key: 'done-1' })).toBeDefined()
  expect((await $.tool.call({ tool: 'mcp__human-todos__list' })).result).toBe('#1 [open] Do it\n    script: ls')
  await pane.unmount()
})

test('a note draws under the detail', async ($, on) => {
  await seeded($, on, [todo({ detail: 'Detail', note: 'Stopped' })])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const rows = await texts(pane)
  expect(rows.indexOf('Stopped')).toBe(rows.indexOf('Detail') + 1)
  expect((await pane.find({ type: 'Text', text: 'Stopped' }))?.props.color).toBe('warning')
  await pane.unmount()
})

test('a running item draws the live tail, a spinner frame and its own buttons', async ($, on) => {
  await seeded($, on, [
    todo({ id: '1', kind: 'run', script: 'ls', status: 'running', runner: 'herdr', token: 't', liveTail: ['a', 'b', 'c', 'd'] }),
    todo({ id: '2', kind: 'run', script: 'ls', status: 'running', runner: 'herdr', token: 't', isStopping: true }),
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const rows = await texts(pane)

  expect(rows).toContain('⠋ Do it')
  expect(rows).not.toContain('a')
  expect(rows).toEqual(expect.arrayContaining(['b', 'c', 'd', '⠋ Running ', '⠋ Stopping… ']))
  expect(await buttons(pane)).toEqual(['close', 'show-1', 'stop-1', 'show-2'])
  await pane.unmount()
})

test('finished items draw a mark and a dimmed title, then Clear finished removes them', async ($, on) => {
  await seeded($, on, [
    todo({ id: '1', title: 'Fine', status: 'done' }),
    todo({ id: '2', title: 'Broke', status: 'failed', exitCode: 2 }),
    todo({ id: '3', title: 'Passed over', status: 'skipped' }),
    todo({ id: '4', title: 'Zero', status: 'failed', exitCode: 0 }),
    todo({ id: '5', title: 'Still open' }),
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await pane.find({ type: 'Text', text: '✓ ' }))?.props.color).toBe('success')
  expect((await pane.find({ type: 'Text', text: '✗ ' }))?.props.color).toBe('error')
  expect((await pane.find({ type: 'Text', text: '– ' }))?.props.color).toBe('inactive')
  expect((await pane.find({ type: 'Text', text: 'Fine' }))?.props.dimColor).toBe(true)
  const rows = await texts(pane)
  expect(rows).toContain(' (exit 2)')
  expect(rows.filter(r => r.includes('(exit'))).toHaveLength(1)
  const spacer = rows.indexOf(' ')
  expect(spacer).toBeGreaterThan(rows.indexOf('Zero'))
  expect(await buttons(pane)).toContain('clear')

  await pane.press({ key: 'clear' })
  expect((await $.tool.call({ tool: 'mcp__human-todos__list' })).result).toBe('#5 [open] Still open')
  expect(await pane.find({ key: 'clear' })).toBeUndefined()
  await pane.unmount()
})

test('the band counts open and confirming items and yields to an open pane', async ($, on) => {
  const { opened } = await seeded($, on, [todo({ id: '1' })])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await band.find({ type: 'Text', text: /Human Todo/ }))?.text).toBe('○ 1 Human Todo')
  expect((await band.find({ key: 'open-pane' }))?.text).toBe('Open')

  await $.tool.call({ tool: 'mcp__human-todos__withdraw', id: '1' })
  await $.tool.call({ tool: 'mcp__human-todos__add', kind: 'task', title: 'a' })
  await $.tool.call({ tool: 'mcp__human-todos__add', kind: 'run', title: 'b', script: 'ls' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'close' })
  await pane.unmount()
  expect((await band.find({ type: 'Text', text: /Human Todo/ }))?.text).toBe('○ 2 Human Todos')

  await band.press({ key: 'open-pane' })
  expect(opened.length).toBeGreaterThan(0)
  expect(await band.find({ key: 'open-pane' })).toBeUndefined()
  await band.unmount()
})

test('a band with only finished or running items draws nothing', async ($, on) => {
  await seeded($, on, [todo({ id: '1', status: 'done' }), todo({ id: '2', kind: 'run', script: 'ls', status: 'running', runner: 'herdr', token: 't' })])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await band.find({ key: 'open-pane' })).toBeUndefined()
  await band.unmount()
})

test('a plugin row from this plugin draws one compact line; expanded and other rows pass', async ($, on) => {
  await seeded($, on, [])
  const row = await $.ui.mount({
    ...MESSAGE('[Human Todos] The user marked #1 done.\nsecond\nthird'),
    surface: 'terminal',
  })
  expect(await texts(row)).toEqual(['Human Todos ', 'The user marked #1 done.  (+2 lines, ctrl+o)'])
  expect((await row.find({ type: 'Text', text: 'Human Todos ' }))?.props.color).toBe('suggestion')
  await row.unmount()

  const one = await $.ui.mount({ ...MESSAGE('[Human Todos] The user skipped #2.'), surface: 'terminal' })
  expect(await texts(one)).toEqual(['Human Todos ', 'The user skipped #2.'])
  await one.unmount()

  const fenced = await $.ui.mount({ ...MESSAGE('[Human Todos] Ran #3: exit 0.\n```\nout\n```'), surface: 'terminal' })
  expect(await texts(fenced)).toEqual(['Human Todos ', 'Ran #3: exit 0.  (+1 line, ctrl+o)'])
  await fenced.unmount()

  const expanded = await $.ui.mount({ ...MESSAGE('[Human Todos] x\ny', { isExpanded: true }), surface: 'terminal' })
  expect(await expanded.find({ type: 'Text', text: 'Human Todos ' })).toBeUndefined()
  await expanded.unmount()

  const other = await $.ui.mount({ ...MESSAGE('[Human Todos] x\ny', { origin: { kind: 'plugin', name: 'other' } }), surface: 'terminal' })
  expect(await other.find({ type: 'Text', text: 'Human Todos ' })).toBeUndefined()
  await other.unmount()
})

test('/todos opens the pane', async ($, on) => {
  const { opened } = world(on)
  await startSession($)

  const ran = await $.command.run({ command: 'todos', args: '' })
  expect(opened).toEqual(['human-todos'])
  expect(JSON.stringify(ran)).toContain('Human Todos')
})
