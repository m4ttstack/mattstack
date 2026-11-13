import { expect, test } from 'claude-code/testing'

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

const MESSAGE = (text: string, name: string) => ({ plugin: 'gate-form', component: 'UserMessage', props: { text, origin: { kind: 'plugin', name }, isExpanded: false } }) as const

type Body = Parameters<Parameters<typeof test>[1]>
type On = Body[1]
type Node = { children?: unknown[] }

// What sits beneath the plugin: the pane list the engine would keep.
function stubPanes(on: On): Map<string, string> {
  const open = new Map<string, string>()
  on('ui.open', (_, e) => {
    open.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    open.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...open].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  return open
}

const runDemo = ($: Body[0]) => $.command.run({ command: 'gate-form-demo', args: '', origin: { kind: 'plugin', name: 'test' } } as never)

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
    await runDemo($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    const client = await band.find({ type: 'Client' })
    expect(client).toBeDefined()
    expect(String(client!.props.module)).toMatch(/band\.js$/)
    await band.unmount()
  })

  test(`no band is drawn while the pane is placed (${surface})`, async ($, on) => {
    stubPanes(on)
    await runDemo($)
    const band = await $.ui.mount({ ...ABOVE, surface })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    await band.unmount()
  })

  test(`a reopen message opens the pane (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await runDemo($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    const formId = ((await band.find({ type: 'Client' }))!.props.props as { formId: string }).formId
    await band.post({ type: 'reopen', formId })
    expect([...panes.keys()]).toEqual(['gate-form'])
    await band.unmount()
  })

  test(`a reopen for another form opens nothing (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await runDemo($)
    panes.clear()
    const band = await $.ui.mount({ ...ABOVE, surface })
    await band.post({ type: 'reopen', formId: 'someone-else' })
    expect(panes.size).toBe(0)
    await band.unmount()
  })

  test(`a hide message closes the pane and the band takes its place above the prompt (${surface})`, async ($, on) => {
    const panes = stubPanes(on)
    await runDemo($)
    const band = await $.ui.mount({ ...ABOVE, surface })
    expect(await band.find({ type: 'Client' })).toBeUndefined()
    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.post({ type: 'hide', formId: 'any' })
    expect(panes.size).toBe(0)
    expect(await band.find({ type: 'Client' })).toBeDefined()
    await pane.unmount()
    await band.unmount()
  })

  test(`a gate row is summarised and another plugin's row is untouched (${surface})`, async ($, on) => {
    const rows: string[] = []
    on('ui.render', { component: 'UserMessage' }, async (_, e, next) => {
      rows.push(e.props.text)
      return next(e)
    })
    const text = '[gate-form] The user answered "T" (1 of 1 questions).\nForm f1.\n```json\n{"a": 1}\n```'
    for (const name of ['gate-form', 'other']) {
      const row = await $.ui.mount({ ...MESSAGE(text, name), surface })
      await row.unmount()
    }
    expect(rows[0]).toContain('mattstack gate')
    expect(rows[0]).not.toContain('"a": 1')
    expect(rows[1]).toBe(text)
  })

  test(`pointer: pressing Next, dragging off and releasing leaves the page; releasing on it moves on (${surface})`, async ($, on) => {
    stubPanes(on)
    await runDemo($)
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
    await runDemo($)
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
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('ui.focus', () => ({}))
    await runDemo($)
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
