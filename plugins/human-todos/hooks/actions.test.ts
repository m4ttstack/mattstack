import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { settle } from './report'
import { SESSION, startSession, world } from './test-world'

type On = Parameters<typeof world>[0]
type Result = { exitCode: number; stdout: string; stderr: string }

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

const LIST = 'mcp__human-todos__list'
const WITHDRAW = 'mcp__human-todos__withdraw'

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'run', title: 'T', script: 'ls -la', status: 'open', ...over })

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const buttons = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key)

type Setup = {
  env?: Record<string, string>
  probeExit?: number
  // Answers a script run beneath the plugin; may hold on the test's clock.
  script?: (argv: readonly string[]) => Promise<Partial<Result>> | Partial<Result>
}

// The world plus recorders for everything the actions reach beneath the plugin.
async function seeded($: Engine, on: On, list: Todo[], { env = {}, probeExit = 0, script }: Setup = {}) {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: list, nextId: 20, savedAt: 1_000_000 } } })
  const events: string[] = []
  const ran: string[][] = []
  const copied: { text: string; surface?: string }[] = []
  on('ui.toast', (_, e) => {
    events.push(`toast: ${e.text}`)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    events.push(`log: ${e.text}`)
    return { value: undefined }
  })
  on('ui.copy', (_, e) => {
    copied.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true as const } }
  })
  on('process.run', async (_, e) => {
    ran.push([...e.argv])
    if (e.argv.join(' ').includes('herdr workspace list')) return { value: { exitCode: probeExit, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'open') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (script === undefined) return { deny: 'no script stand-in' }
    const answer = await script(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  mock.env(on, env)
  await startSession($)
  return { ...w, events, ran, copied }
}

// A session start settles a confirming item back to open, so a test reaches confirming the way a person does.
const confirming = async (pane: { press: (q: { key: string }) => Promise<unknown> }, id = '1') => pane.press({ key: `run-${id}` })

const logs = (events: string[]) => events.filter(e => e.startsWith('log: ')).map(e => e.slice(5))
const toasts = (events: string[]) => events.filter(e => e.startsWith('toast: ')).map(e => e.slice(7))
const state = async ($: Engine) => (await $.tool.call({ tool: LIST })).result

test('Run asks first: the item is confirming, nothing starts and the agent hears nothing', async ($, on) => {
  const { sent, ran, events } = await seeded($, on, [todo({})])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'run-1' })

  expect(await state($)).toMatch(/^#1 \[confirming\]/)
  expect(ran).toEqual([])
  expect(events).toEqual([])
  expect(sent).toEqual([])
  await pane.unmount()
})

test('a confirming item draws Confirm (primary) and Cancel, and the band counts it', async ($, on) => {
  await seeded($, on, [todo({ id: '1' }), todo({ id: '2' })])
  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: 'run-2' })
  await first.unmount()
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await buttons(pane)).toEqual(['close', 'run-1', 'copy-1', 'done-1', 'skip-1', 'confirm-2', 'cancel-2'])
    expect((await pane.find({ key: 'confirm-2' }))?.props.variant).toBe('primary')
    expect((await pane.find({ key: 'cancel-2' }))?.props.variant).toBeUndefined()
    await pane.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Human Todo/ }))?.text).toBe('○ 2 Human Todos')
  await band.unmount()
})

test('Cancel returns a confirming item to open and tells the agent nothing', async ($, on) => {
  const { sent, ran } = await seeded($, on, [todo({})])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await confirming(pane)
  await pane.press({ key: 'cancel-1' })

  expect(await state($)).toMatch(/^#1 \[open\]/)
  expect(sent).toEqual([])
  expect(ran).toEqual([])
  await pane.unmount()
})

test('Confirm on the local runner runs the script and reports exit 0 with its output', async ($, on) => {
  const { sent, ran } = await seeded($, on, [todo({})], { script: () => ({ stdout: 'hello\n' }) })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(ran).toEqual([['/bin/zsh', '-lc', 'ls -la']])
  expect(await state($)).toMatch(/^#1 \[done\]/)
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nhello\n```'])
  await pane.unmount()
})

test('a script that exits non-zero fails the item and reports the exit code and tail', async ($, on) => {
  const { sent } = await seeded($, on, [todo({})], { script: () => ({ exitCode: 3, stdout: 'a\n', stderr: 'boom\n' }) })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(await state($)).toMatch(/^#1 \[failed\]/)
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 3.\n```\na\nboom\n```'])
  await pane.unmount()
})

test('Confirm shows the item running at once and the report follows when the runner finishes', async ($, on) => {
  const { clock, sent } = await seeded($, on, [todo({})], {
    script: async () => {
      await clock.sleep(60_000)
      return { stdout: 'late\n' }
    },
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)

  await pane.press({ key: 'confirm-1' })

  expect(await state($)).toMatch(/^#1 \[running\]/)
  expect(sent).toEqual([])
  await clock.advance(60_000)
  expect(await state($)).toMatch(/^#1 \[done\]/)
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nlate\n```'])
  await pane.unmount()
})

test('a runner that cannot start puts the item back to open with a note and a toast', async ($, on) => {
  const { events, sent } = await seeded($, on, [todo({})])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(await state($)).toMatch(/^#1 \[open\]/)
  expect(await texts(pane)).toContain('Could not start')
  expect(toasts(events)).toEqual(['Could not start #1'])
  expect(sent).toEqual([])
  await pane.unmount()
})

test('Done and Skip mark the item and tell the agent, with the pane never opened', async ($, on) => {
  const { sent } = await seeded($, on, [todo({ id: '1' }), todo({ id: '2', kind: 'task', title: 'U', script: undefined })])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'done-1' })
  await pane.press({ key: 'skip-2' })

  expect(await state($)).toBe('#1 [done] T\n    script: ls -la\n#2 [skipped] U')
  expect(sent).toEqual(['[Human Todos] #1 "T": the user marked it done.', '[Human Todos] #2 "U": the user skipped it.'])
  await pane.unmount()
})

test('settle turns each outcome into the item change and the message to the agent', () => {
  const t = todo({ liveTail: ['x'], isStopping: true })

  expect(settle(t, { kind: 'ran', exitCode: 0, outputTail: 'ok' })).toEqual({
    patch: { status: 'done', exitCode: 0, outputTail: 'ok', liveTail: undefined, isStopping: false },
    text: 'The user ran #1 "T" from the pane: exit 0.\n```\nok\n```',
  })
  const failed = settle(t, { kind: 'ran', exitCode: 3, outputTail: '' })
  expect(failed.patch.status).toBe('failed')
  expect(failed.patch.exitCode).toBe(3)
  expect(failed.text).toBe('The user ran #1 "T" from the pane: exit 3.\n```\n(no output)\n```')

  expect(settle(t, { kind: 'stopped', outputTail: 'half' })).toEqual({
    patch: { status: 'open', outputTail: 'half', note: 'Stopped', liveTail: undefined, isStopping: false },
    text: 'The user stopped #1 "T" before it finished. It is open again.',
  })
  expect(settle(t, { kind: 'ended', outputTail: '' })).toEqual({
    patch: { status: 'open', outputTail: '', note: 'Ended without an exit code.', liveTail: undefined, isStopping: false },
    text: '#1 "T" ended in its tab without reporting an exit code (most likely stopped). It is open again.',
  })

  const long = Array.from({ length: 40 }, (_, n) => `line ${n}`).join('\n')
  const kept = settle(t, { kind: 'ran', exitCode: 0, outputTail: long }).patch.outputTail?.split('\n')
  expect(kept).toHaveLength(30)
  expect(kept?.[0]).toBe('line 10')
})

test('Stop shows a toast, marks the item stopping, then asks the runner to stop', async ($, on) => {
  const { events } = await seeded($, on, [todo({ status: 'running', runner: 'herdr', token: 't' })])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'stop-1' })

  expect(events).toEqual(['toast: Stopping #1', 'log: herdr.stop #1'])
  expect(await texts(pane)).toContain('⠋ Stopping… ')
  expect(await buttons(pane)).toEqual(['close', 'show-1'])
  await pane.unmount()
})

test('Show goes to the runner the item ran under', async ($, on) => {
  const { events } = await seeded($, on, [todo({ status: 'running', runner: 'herdr', token: 't' })])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'show-1' })

  expect(logs(events)).toEqual(['herdr.show #1'])
  await pane.unmount()
})

test('Open runs open for http(s) links only', async ($, on) => {
  const { ran, events } = await seeded($, on, [
    todo({ id: '1', kind: 'link', script: undefined, url: 'https://example.com/a' }),
    todo({ id: '2', kind: 'link', script: undefined, url: 'file:///etc/passwd' }),
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'open-1' })
  expect(ran).toEqual([['open', 'https://example.com/a']])
  await pane.press({ key: 'open-2' })
  expect(ran).toHaveLength(1)
  expect(toasts(events)).toEqual(['Only http and https links open from here'])
  await pane.unmount()
})

test('Copy puts the script on the clipboard of the surface that was pressed', async ($, on) => {
  const { copied } = await seeded($, on, [todo({ script: 'sudo ls' })])
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.press({ key: 'copy-1' })
    await pane.unmount()
  }

  expect(copied).toEqual([
    { text: 'sudo ls', surface: 'terminal' },
    { text: 'sudo ls', surface: 'desktop' },
  ])
})

test('Open log waits for the run to have a log file', async ($, on) => {
  const { ran } = await seeded($, on, [todo({})], { script: () => new Promise(() => {}) })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(await buttons(pane)).toEqual(['close', 'openLog-1', 'stop-1'])
  await pane.press({ key: 'openLog-1' })
  expect(ran.filter(argv => argv[0] === 'open')).toEqual([])
  await pane.unmount()
})

test('withdrawing, clearing and /clear hand each item that ran to its runner, and skip those that never did', async ($, on) => {
  const { events } = await seeded($, on, [
    todo({ id: '1', status: 'running', runner: 'herdr', token: 't' }),
    todo({ id: '2', status: 'done', runner: 'local' }),
    todo({ id: '3', status: 'failed', runner: 'herdr', exitCode: 1 }),
    todo({ id: '4', kind: 'task', script: undefined }),
    todo({ id: '5', status: 'running', runner: 'local' }),
    todo({ id: '6', status: 'running', runner: 'herdr', token: 'u' }),
  ])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  expect(logs(events)).toEqual(['herdr.cleanup #1'])

  await $.tool.call({ tool: WITHDRAW, id: '4' })
  expect(logs(events)).toEqual(['herdr.cleanup #1'])

  await pane.press({ key: 'clear' })
  expect(logs(events)).toEqual(['herdr.cleanup #1', 'local.cleanup #2', 'herdr.cleanup #3'])

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  expect(logs(events)).toEqual(['herdr.cleanup #1', 'local.cleanup #2', 'herdr.cleanup #3', 'local.cleanup #5', 'herdr.cleanup #6'])
  expect(await state($)).toBe('No to-dos.')
  await pane.unmount()
})

const CHOICES: { name: string; setup: Setup; pin?: string; started: 'herdr' | 'local' }[] = [
  { name: 'auto picks herdr when its socket is set and herdr answers', setup: { env: { HERDR_SOCKET_PATH: '/s' }, probeExit: 0 }, started: 'herdr' },
  { name: 'auto picks local when herdr does not answer', setup: { env: { HERDR_SOCKET_PATH: '/s' }, probeExit: 1 }, started: 'local' },
  { name: 'auto picks local without a herdr socket, and never probes', setup: { env: {}, probeExit: 0 }, started: 'local' },
  { name: 'a pinned herdr wins without a socket', setup: { env: {}, probeExit: 1 }, pin: 'herdr', started: 'herdr' },
  { name: 'a pinned local wins over a live herdr', setup: { env: { HERDR_SOCKET_PATH: '/s' }, probeExit: 0 }, pin: 'local', started: 'local' },
]

for (const { name, setup, pin, started } of CHOICES) {
  test(name, async ($, on) => {
    const { events, ran } = await seeded($, on, [todo({})], { script: () => ({}), ...setup })
    if (pin) await $.command.run({ command: 'todos-runner', args: pin })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await confirming(pane)
    await pane.press({ key: 'confirm-1' })

    expect(logs(events).includes('herdr.start #1')).toBe(started === 'herdr')
    expect(ran.some(argv => argv.includes('ls -la'))).toBe(started === 'local')
    const probed = ran.some(argv => argv.join(' ').includes('herdr workspace list'))
    expect(probed).toBe(!pin && Boolean(setup.env?.HERDR_SOCKET_PATH))
    await pane.unmount()
  })
}

test('/todos-runner sets the choice and, with no argument, reports it', async ($, on) => {
  world(on)
  await startSession($)

  expect(JSON.stringify(await $.command.run({ command: 'todos-runner', args: '' }))).toContain('Runner is auto.')
  expect(JSON.stringify(await $.command.run({ command: 'todos-runner', args: ' local ' }))).toContain('Run now uses local.')
  expect(JSON.stringify(await $.command.run({ command: 'todos-runner', args: '' }))).toContain('Runner is local.')
  expect(JSON.stringify(await $.command.run({ command: 'todos-runner', args: 'tmux' }))).toContain('Runner is local.')
  expect(JSON.stringify(await $.command.run({ command: 'todos-runner', args: 'auto' }))).toContain('Run now uses herdr when it is available')
})

test('the spinner advances every 100 ms while an item runs and rests when none does', async ($, on) => {
  const { clock } = await seeded($, on, [todo({ id: '1', script: 'first' }), todo({ id: '2' })], {
    script: async argv => {
      await clock.sleep(argv.includes('first') ? 450 : 10_000)
      return {}
    },
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })
  expect(await texts(pane)).toContain('⠋ T')
  await clock.advance(400)
  expect(await texts(pane)).toContain('⠼ T')
  await clock.advance(50)
  expect(await state($)).toMatch(/^#1 \[done\]/)

  await clock.advance(1000)
  await confirming(pane, '2')
  await pane.press({ key: 'confirm-2' })
  await clock.advance(100)
  expect(await texts(pane)).toContain('⠴ T')
  await pane.unmount()
})
