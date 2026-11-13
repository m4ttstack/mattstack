import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'kit-gallery',
  component: 'Pane',
  requestId: 'kit-gallery',
  props: { title: 'Kit gallery', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

type Body = Parameters<Parameters<typeof test>[1]>
type On = Body[1]
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

type Opened = { id: string; title?: string }

// What sits beneath the plugin: the pane list the engine would keep. A Client's post reaches only the plugin's own ui.message hooks,
// so a post shows here by what the gallery's hook does with it: { type: 'hide' } closes the pane, { type: 'reopen' } opens it.
function stubEngine(on: On): { opened: Opened[]; closed: string[] } {
  const seen = { opened: [] as Opened[], closed: [] as string[] }
  on('ui.open', (_, e) => {
    seen.opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  return seen
}

const run = ($: Body[0]) => $.command.run({ command: 'kit-gallery', args: '', origin: { kind: 'plugin', name: 'test' } } as never)

const shown = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(shown).join(''))

type Mounted = { drawn: (scope?: { in?: string }) => Promise<unknown>; find: (q: { type?: string }) => Promise<{ key?: string } | undefined> }

const lineNodes = async (ui: Mounted, key: string): Promise<Node[]> => ((await ui.drawn({ in: key })) as Node).children as Node[]

// The rows a Client drew, one string each.
async function rowsOf(ui: Mounted, key: string): Promise<string[]> {
  return (await lineNodes(ui, key)).map(shown)
}

// The fill behind the first span on the row that shows `word`, or undefined for an unfilled one.
async function fillOf(ui: Mounted, key: string, row: string, word: string): Promise<unknown> {
  const line = (await lineNodes(ui, key)).find(n => shown(n).includes(row))
  const span = (line?.children as Node[] | undefined)?.find(s => shown(s).includes(word))
  return span?.props?.backgroundColor
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`running /kit-gallery opens the pane (${surface})`, async ($, on) => {
    const seen = stubEngine(on)
    const result = await run($)
    expect(seen.opened).toEqual([{ id: 'kit-gallery', title: 'Kit gallery' }])
    expect(JSON.stringify(result)).toContain('Kit gallery')
  })

  test(`the pane draws the gallery as a Client on the gallery module (${surface})`, async ($, on) => {
    stubEngine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    const client = await ui.find({ type: 'Client' })
    expect(client).toBeDefined()
    expect(String((client as { props: { module: unknown } }).props.module)).toMatch(/gallery\.js$/)
    await ui.unmount()
  })

  test(`pressing the primary button and releasing it posts nothing and leaves it unpressed (${surface})`, async ($, on) => {
    const seen = stubEngine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const rows = await rowsOf(ui, key)
    const y = rows.findIndex(r => r.includes('primary') && r.includes('Save'))
    expect(y).toBeGreaterThan(-1)
    const cell = { x: rows[y]!.indexOf('Save') + 1, y }
    const at = () => fillOf(ui, key, 'primary', 'Save')
    const resting = await at()
    expect(resting).toBeDefined()

    await ui.pointer({ type: 'move', ...cell })
    const hovering = await at()
    expect(hovering).not.toBe(resting)

    await ui.pointer({ type: 'down', ...cell, button: 'left' })
    const held = await at()
    expect(held).not.toBe(hovering)
    expect(held).not.toBe(resting)

    await ui.pointer({ type: 'up', ...cell, button: 'left' })
    expect(await at()).toBe(hovering)
    expect(seen).toEqual({ opened: [], closed: [] })
    expect((await rowsOf(ui, key)).some(r => r.includes('pressed 1 time'))).toBe(true)

    await ui.pointer({ type: 'leave', ...cell })
    expect(await at()).toBe(resting)
    await ui.unmount()
  })

  test(`dragging off the primary button before releasing cancels the press (${surface})`, async ($, on) => {
    stubEngine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const rows = await rowsOf(ui, key)
    const y = rows.findIndex(r => r.includes('primary') && r.includes('Save'))
    const cell = { x: rows[y]!.indexOf('Save') + 1, y }

    await ui.pointer({ type: 'down', ...cell, button: 'left' })
    await ui.pointer({ type: 'move', x: 0, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left' })
    expect((await rowsOf(ui, key)).some(r => r.includes('pressed 0 times'))).toBe(true)
    await ui.unmount()
  })

  test(`a tab in the strip moves the gallery to its page (${surface})`, async ($, on) => {
    stubEngine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const rows = await rowsOf(ui, key)
    const tab = { y: rows.findIndex(r => r.includes('Long list')), x: 0 }
    tab.x = rows[tab.y]!.indexOf('Long list') + 1
    expect((await rowsOf(ui, key)).some(r => r.includes('more'))).toBe(false)

    await ui.pointer({ type: 'down', ...tab, button: 'left' })
    await ui.pointer({ type: 'up', ...tab, button: 'left' })
    const after = await rowsOf(ui, key)
    expect(after.some(r => r.includes('↑ 1 more'))).toBe(true)
    expect(after.some(r => r.includes('↓ 1 more'))).toBe(true)
    await ui.unmount()
  })

  test(`the Hide button on the bars page asks the hooks module to close the pane (${surface})`, async ($, on) => {
    const seen = stubEngine(on)
    const ui = await $.ui.mount({ ...PANE, surface })
    const key = (await ui.find({ type: 'Client' }))!.key!
    const tabRow = await rowsOf(ui, key)
    const tab = { y: tabRow.findIndex(r => r.includes('Bars')), x: 0 }
    tab.x = tabRow[tab.y]!.indexOf('Bars') + 1
    await ui.pointer({ type: 'down', ...tab, button: 'left' })
    await ui.pointer({ type: 'up', ...tab, button: 'left' })

    const rows = await rowsOf(ui, key)
    const button = `Hide \u{EAB4}`
    const hide = { y: rows.findIndex(r => r.includes(button)), x: 0 }
    expect(hide.y).toBeGreaterThan(-1)
    hide.x = rows[hide.y]!.indexOf(button) + 2
    await ui.pointer({ type: 'down', ...hide, button: 'left' })
    await ui.pointer({ type: 'up', ...hide, button: 'left' })
    expect(seen.closed).toEqual(['kit-gallery'])
    await ui.unmount()
  })
}
