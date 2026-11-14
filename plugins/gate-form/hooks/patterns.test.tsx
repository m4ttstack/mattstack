import { expect, test } from 'claude-code/testing'

import { SAMPLE } from './sample-form'
import { startSession, world } from './world'

const PANE = {
  plugin: 'gate-form',
  component: 'Pane',
  requestId: 'gate-form',
  props: { title: 'Gate', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const ABOVE = {
  plugin: 'gate-form',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type Body = Parameters<Parameters<typeof test>[1]>
type On = Body[1]
type Node = { children?: unknown[] }

// What sits beneath the plugin, with rt.gates.kitForm on: the pane list the engine would keep.
const stubPanes = (on: On): Map<string, string> => world(on).panes

// The ask tool opens the sample form, as an agent's call would.
async function openSample($: Body[0]) {
  await startSession($)
  await $.tool.call({ tool: 'mcp__gate-form__ask', title: SAMPLE.title, context: SAMPLE.context, questions: SAMPLE.questions } as never)
}

const shown = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(shown).join(''))

// The rows a Client drew, one string each.
async function rowsOf(ui: { drawn: (scope?: { in?: string }) => Promise<unknown> }, key: string): Promise<string[]> {
  return (((await ui.drawn({ in: key })) as Node).children ?? []).map(shown)
}

const cellOf = (rows: string[], word: string) => {
  const y = rows.findIndex(r => r.includes(word))
  return { y, x: y < 0 ? -1 : rows[y]!.indexOf(word) + 1 }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band is a Client on the band module while a form waits and its pane is closed (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await openSample($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    const client = await band.find({ type: 'Client' })
    expect(client).toBeDefined()
    expect(String(client!.props.module)).toMatch(/band\.js$/)
    await band.unmount()
  })

  test(`no band is drawn while the pane is placed (${surface})`, async ($, on) => {
    stubPanes(on)
    await openSample($)
    const band = await $.ui.mount({ ...ABOVE, surface })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    await band.unmount()
  })

  test(`a reopen message opens the pane (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await openSample($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    const formId = ((await band.find({ type: 'Client' }))!.props.props as { formId: string }).formId
    await band.post({ type: 'reopen', formId })
    expect([...panes.keys()]).toEqual(['gate-form'])
    await band.unmount()
  })

  test(`the band draws one row of words, and the engine's Show button beside it reopens the pane (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await openSample($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    const client = (await band.find({ type: 'Client' }))!
    const { title, label } = client.props.props as { title: string; label: string }
    const rows = await rowsOf(band, client.key!)
    expect(rows).toEqual([`\u{EBD2} ${label}  ${title}`])

    await band.press({ key: 'open-gate-form' })
    expect([...panes.keys()]).toEqual(['gate-form'])
    await band.unmount()
  })

  test(`a reopen for another form opens nothing (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await openSample($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    await band.post({ type: 'reopen', formId: 'someone-else' })
    expect(panes.size).toBe(0)
    await band.unmount()
  })

  test(`a hide message closes the pane and the band takes its place above the prompt (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await openSample($)
    const band = await $.ui.mount({ ...ABOVE, surface })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.post({ type: 'hide', formId: 'any' })
    expect(panes.size).toBe(0)
    expect(await band.find({ type: 'Client' })).toBeDefined()
    await pane.unmount()
    await band.unmount()
  })

  test(`pointer: pressing Next, dragging off and releasing leaves the page; releasing on it moves on (${surface})`, async ($, on) => {
    stubPanes(on)
    await openSample($)
    const ui = await $.ui.mount({ ...PANE, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const next = cellOf(await rowsOf(ui, key), 'Next')
    expect(next.y).toBeGreaterThan(-1)
    const onFirstPage = async () => (await rowsOf(ui, key)).some(r => r.includes('Which threads'))
    expect(await onFirstPage()).toBe(true)

    await ui.pointer({ type: 'down', ...next, button: 'left' })
    await ui.pointer({ type: 'move', x: 0, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left' })
    expect(await onFirstPage()).toBe(true)

    await ui.pointer({ type: 'down', ...next, button: 'left' })
    await ui.pointer({ type: 'up', ...next, button: 'left' })
    expect(await onFirstPage()).toBe(false)
    await ui.unmount()
  })

  test(`pointer: the first click on an unfocused form posts engaged and answers nothing (${surface})`, async ($, on) => {
    stubPanes(on)
    await openSample($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: false }, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const rows = await rowsOf(ui, key)
    const option = cellOf(rows, 'Rename fetchAll')
    const before = rows[option.y]
    const focused = async () => ((await ui.find({ type: 'Client' }))!.props.props as { focused: boolean }).focused
    expect(await focused()).toBe(false)

    await ui.pointer({ type: 'down', ...option, button: 'left' })
    await ui.pointer({ type: 'up', ...option, button: 'left' })
    expect(await focused()).toBe(true)
    expect((await rowsOf(ui, key))[option.y]).toBe(before)

    await ui.pointer({ type: 'down', ...option, button: 'left' })
    await ui.pointer({ type: 'up', ...option, button: 'left' })
    expect((await rowsOf(ui, key))[option.y]).not.toBe(before)
    await ui.unmount()
  })

  test(`focus: a post marks the form focused; typing, submitting and a focus move each clear it (${surface})`, async ($, on) => {
    stubPanes(on)
    on('prompt.edit', (_, e) => ({ text: e.text, cursor: e.cursor }))
    on('ui.focus', () => ({}))
    await openSample($)
    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: false }, surface })
    const focused = async () => ((await ui.find({ type: 'Client' }))!.props.props as { focused: boolean }).focused
    expect(await focused()).toBe(false)

    const clears: [string, () => Promise<unknown>][] = [
      ['prompt.edit', () => $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a' } as never)],
      ['prompt.submit', () => $.prompt.submit({ text: 'hi', wait: false } as never)],
      ['ui.focus', () => $.ui.focus({ component: 'AbovePrompt', requestId: 'band', origin: { kind: 'person' } } as never)],
    ]
    for (const [name, fire] of clears) {
      await ui.post({ type: 'engaged', formId: 'x' })
      expect(await focused(), `after engaged, before ${name}`).toBe(true)
      await fire()
      expect(await focused(), `after ${name}`).toBe(false)
    }
    await ui.unmount()
  })
}

// A test cannot write another plugin's value, so the older tag comes from beneath the plugin, as the engine would hand it back.
test('a form stored under an older shape tag is declined, and the pane says so', async ($, on) => {
  stubPanes(on)
  const old = { id: 'f', title: 'Old', questions: [], status: 'open', replyTo: 'toast' }
  on('state.get', (_, e) => ({ value: { value: e.key === 'form' ? { shape: 'form-2', value: old } : undefined, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No questions right now.')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('a form stored under form-3 loads as the one form in the list', async ($, on) => {
  stubPanes(on)
  const old = { id: 'f-old', title: 'Old', questions: [{ id: 'q', header: 'q', label: 'Pick one', multi: false, writeIn: false, options: [{ value: 'a', label: 'Alpha' }] }], status: 'open', replyTo: 'agent' }
  on('state.get', (_, e) => ({ value: { value: e.key === 'form' ? { shape: 'form-3', value: old } : undefined, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const client = await ui.find({ type: 'Client' })
  expect((client!.props.props as { form: { id: string; source: string } }).form).toMatchObject({ id: 'f-old', source: 'ask' })
  expect((await rowsOf(ui, client!.key!)).join('\n')).toContain('Something else')
  await ui.unmount()
})
