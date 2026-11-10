import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { settle } from './report'
import { SESSION, children, exits, hangs, herdrFake, startSession, world } from './test-world'
import type { Child } from './test-world'

type On = Parameters<typeof world>[0]
type Result = { exitCode: number; stdout: string; stderr: string }

const PID_PREFIX = 'print -u2 "__human_todo_pid__$$"; '

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
  // Holds the herdr probe on the test's clock for this long, or refuses it outright.
  probeHold?: number
  probeDeny?: boolean
  // Answers the child started for a script; omitted, nothing can start. It may hold on the test's clock.
  script?: (script: string) => Child
  // Answers any other command run beneath the plugin (the kill, the log removal); omitted, it is refused.
  run?: (argv: readonly string[]) => Partial<Result>
}

// The world plus recorders for everything the actions reach beneath the plugin.
async function seeded($: Engine, on: On, list: Todo[], { env = {}, probeExit = 0, probeHold = 0, probeDeny = false, script, run }: Setup = {}) {
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
    if (e.argv.join(' ').includes('herdr workspace list')) {
      if (probeDeny) return { deny: 'no herdr' }
      if (probeHold > 0) await w.clock.sleep(probeHold)
    }
    if (e.argv.join(' ').includes('herdr workspace list')) return { value: { exitCode: probeExit, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'open') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (run === undefined) return { deny: 'no command stand-in' }
    return { value: { exitCode: 0, stdout: '', stderr: '', ...run(e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const spawned = children(on, ({ argv }) => (script ? script((argv.at(-1) ?? '').replace(PID_PREFIX, '')) : undefined))
  const written = new Map<string, string>()
  on('fs.write', (_, e) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/u', ...env })
  await startSession($)
  return { ...w, events, ran, copied, spawned, written }
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
    expect((await texts(pane)).filter(row => row === 'Are you sure you want to run this script?')).toHaveLength(1)
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
  const { sent, spawned } = await seeded($, on, [todo({})], { script: () => exits([{ stream: 'stdout', text: 'hello\n' }]) })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(spawned.map(s => s.argv)).toEqual([['/bin/zsh', '-lc', 'print -u2 "__human_todo_pid__$$"; ls -la']])
  expect(await state($)).toMatch(/^#1 \[done\]/)
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nhello\n```'])
  await pane.unmount()
})

test('a script that exits non-zero fails the item and reports the exit code and tail', async ($, on) => {
  const { sent } = await seeded($, on, [todo({})], {
    script: () =>
      exits(
        [
          { stream: 'stdout', text: 'a\n' },
          { stream: 'stderr', text: 'boom\n' },
        ],
        3,
      ),
  })
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
    script: async function* () {
      await clock.sleep(500)
      return yield* exits([{ stream: 'stdout', text: 'late\n' }])
    },
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)

  await pane.press({ key: 'confirm-1' })

  expect(await state($)).toMatch(/^#1 \[running\]/)
  expect(sent).toEqual([])
  await clock.sleeping()
  await clock.advance(500)
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
  await $.tool.call({ tool: WITHDRAW, id: '1' })
  expect(logs(events)).toEqual([])
  await pane.unmount()
})

test('Done and Skip mark the item and tell the agent', async ($, on) => {
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

const herdrItem = (over: Partial<Todo> = {}) => todo({ status: 'running', runner: 'herdr', token: 't', paneId: 'pane1', tabId: 'tab1', ...over })

// A herdr that already holds the tab the seeded running item points at.
function herdrWithTab() {
  const fake = herdrFake()
  fake.panes.set('pane1', { tab: 'tab1', lines: [], isIdle: false, isAlive: true })
  return { fake, run: (argv: readonly string[]) => fake.run(argv.at(-1) ?? '') ?? {} }
}

test('Stop shows a toast, marks the item stopping, then asks the runner to stop', async ($, on) => {
  const { fake, run } = herdrWithTab()
  const { events } = await seeded($, on, [herdrItem()], { run })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'stop-1' })

  expect(events).toEqual(['toast: Stopping #1'])
  expect(fake.ran('herdr pane send-keys')).toEqual(["herdr pane send-keys 'pane1' ctrl+c"])
  expect(await texts(pane)).toContain('⠋ Stopping… ')
  expect(await buttons(pane)).toEqual(['close', 'show-1', 'forceStop-1'])
  await pane.unmount()
})

test('Force stop on a herdr item sends ctrl+c to the tab again', async ($, on) => {
  const { fake, run } = herdrWithTab()
  const { events } = await seeded($, on, [herdrItem({ isStopping: true })], { run })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'forceStop-1' })

  expect(events).toEqual(['toast: Force stopping #1'])
  expect(fake.ran('herdr pane send-keys')).toEqual(["herdr pane send-keys 'pane1' ctrl+c"])
  await pane.unmount()
})

test('Force stop does nothing for an item that is not stopping', async ($, on) => {
  const { fake, run } = herdrWithTab()
  const { events } = await seeded($, on, [herdrItem()], { run })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'forceStop-1' }).catch(() => undefined)

  expect(events).toEqual([])
  expect(fake.ran('herdr pane send-keys')).toEqual([])
  await pane.unmount()
})

test('Show goes to the runner the item ran under', async ($, on) => {
  const { fake, run } = herdrWithTab()
  await seeded($, on, [herdrItem()], { run })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'show-1' })

  expect(fake.ran('herdr tab focus')).toEqual(["herdr tab focus 'tab1'"])
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

test('Open log opens the log file the run writes', async ($, on) => {
  const { ran, written } = await seeded($, on, [todo({})], { script: hangs })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  expect(await buttons(pane)).toEqual(['close', 'openLog-1', 'stop-1'])
  await pane.press({ key: 'openLog-1' })

  const [log] = [...written.keys()]
  expect(log).toMatch(/^\/home\/u\/Library\/Caches\/human-todos\/sess-1-1-[a-z0-9]+\.log$/)
  expect(ran.filter(argv => argv[0] === 'open')).toEqual([['open', '-t', log]])
  await pane.unmount()
})

test('withdrawing, clearing and /clear hand each item that ran to its runner, and skip those that never did', async ($, on) => {
  const fake = herdrFake()
  const { ran } = await seeded(
    $,
    on,
    [
      herdrItem({ id: '1', tabId: 'tabA' }),
      todo({ id: '2', status: 'done', runner: 'local', logPath: '/log/2' }),
      todo({ id: '3', status: 'failed', runner: 'herdr', exitCode: 1, tabId: 'tabC' }),
      todo({ id: '4', kind: 'task', script: undefined }),
      todo({ id: '5', status: 'running', runner: 'local', logPath: '/log/5' }),
      herdrItem({ id: '6', token: 'u', tabId: 'tabF' }),
    ],
    { run: argv => fake.run(argv.at(-1) ?? '') ?? {} },
  )
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const removed = () => ran.filter(argv => argv[0] === 'rm').map(argv => argv[3])
  const closed = () => fake.ran('herdr tab close')

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  expect(closed()).toEqual(["herdr tab close 'tabA'"])

  await $.tool.call({ tool: WITHDRAW, id: '4' })
  expect(closed()).toEqual(["herdr tab close 'tabA'"])
  expect(removed()).toEqual([])

  await pane.press({ key: 'clear' })
  expect(closed()).toEqual(["herdr tab close 'tabA'", "herdr tab close 'tabC'"])
  expect(removed()).toEqual(['/log/2'])

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  expect(closed()).toEqual(["herdr tab close 'tabA'", "herdr tab close 'tabC'", "herdr tab close 'tabF'"])
  expect(removed()).toEqual(['/log/2', '/log/5'])
  expect(await state($)).toBe('No to-dos.')
  await pane.unmount()
})

test('a local cleanup that fails at /clear is told to the person', async ($, on) => {
  const { events } = await seeded($, on, [todo({ status: 'done', runner: 'local', logPath: '/log/1' })])

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })

  expect(toasts(events)).toEqual(['Could not tidy up after the cleared items'])
  expect(await state($)).toBe('No to-dos.')
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
    const fake = herdrFake()
    const { ran, spawned } = await seeded($, on, [todo({})], { script: () => exits([]), run: argv => fake.run(argv.at(-1) ?? '') ?? {}, ...setup })
    if (pin) await $.command.run({ command: 'todos-runner', args: pin })
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await confirming(pane)
    await pane.press({ key: 'confirm-1' })

    expect(fake.ran('herdr pane run').length === 1).toBe(started === 'herdr')
    expect(spawned.some(s => s.argv.at(-1)?.includes('ls -la'))).toBe(started === 'local')
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
    script: async function* (script) {
      await clock.sleep(script === 'first' ? 450 : 10_000)
      return yield* exits([])
    },
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })

  await confirming(pane)
  await pane.press({ key: 'confirm-1' })
  expect(await texts(pane)).toContain('⠋ T')
  await clock.sleeping(1)
  await clock.advance(400)
  expect(await texts(pane)).toContain('⠼ T')
  await clock.advance(50)
  expect(await state($)).toMatch(/^#1 \[done\]/)

  await clock.advance(1000)
  await confirming(pane, '2')
  await pane.press({ key: 'confirm-2' })
  await clock.sleeping(2)
  await clock.advance(100)
  expect(await texts(pane)).toContain('⠴ T')
  await pane.unmount()
})

test('a second Confirm during a slow herdr probe starts the run once', async ($, on) => {
  const fake = herdrFake()
  const { clock } = await seeded($, on, [todo({})], { env: { HERDR_SOCKET_PATH: '/s' }, probeHold: 1000, run: argv => fake.run(argv.at(-1) ?? '') ?? {} })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirming(pane)

  await pane.press({ key: 'confirm-1' })
  expect(await state($)).toMatch(/^#1 \[running\]/)
  expect(await texts(pane)).toContain('⠋ Running ')
  await clock.sleeping()
  await pane.press({ key: 'confirm-1' }).catch(() => undefined)
  await clock.advance(1000)

  expect(fake.ran('herdr pane run')).toHaveLength(1)
  expect(fake.ran('herdr workspace create')).toHaveLength(1)
  await pane.unmount()
})

test('a probe that fails to run falls back to the local runner', async ($, on) => {
  const { spawned, events } = await seeded($, on, [todo({})], { env: { HERDR_SOCKET_PATH: '/s' }, probeDeny: true, script: () => exits([]) })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirming(pane)

  await pane.press({ key: 'confirm-1' })

  expect(spawned).toHaveLength(1)
  expect(await state($)).toMatch(/^#1 \[done\]/)
  expect(events).toEqual([])
  await pane.unmount()
})

test('a run starts clean: the last run\'s exit code, output and note are gone', async ($, on) => {
  const { store } = await seeded($, on, [todo({ exitCode: 3, outputTail: 'old', note: 'Stopped' })], { script: hangs })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)

  await pane.press({ key: 'confirm-1' })

  const [item] = (store.get(`list:${SESSION}`) as { todos: Todo[] }).todos
  expect(item).toMatchObject({ status: 'running', runner: 'local' })
  expect(item?.exitCode).toBeUndefined()
  expect(item?.outputTail).toBeUndefined()
  expect(item?.note).toBeUndefined()
  await pane.unmount()
})

test('a refused message to the agent is told to the person, not dropped', async ($, on) => {
  const { events, sent, fail } = await seeded($, on, [todo({})])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  fail.submit = true

  await pane.press({ key: 'done-1' })

  expect(sent).toEqual([])
  expect(toasts(events)).toEqual(['Could not tell the agent about #1'])
  expect(logs(events)).toEqual(['could not send #1 to the agent'])
  await pane.unmount()
})

test('with the pane closed and nothing drawn, a finished run is still reported', async ($, on) => {
  const { clock, sent } = await seeded($, on, [todo({})], {
    script: async function* () {
      await clock.sleep(1000)
      return yield* exits([{ stream: 'stdout', text: 'ok\n' }])
    },
  })
  await $.command.run({ command: 'todos', args: '' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  await confirming(pane)
  await pane.press({ key: 'confirm-1' })
  await pane.press({ key: 'close' })
  await pane.unmount()

  await clock.sleeping()
  await clock.advance(1000)

  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nok\n```'])
})

test('Stop during the herdr probe cancels the run: the item is open again and nothing launches', async ($, on) => {
  const fake = herdrFake()
  const { clock } = await seeded($, on, [todo({})], { env: { HERDR_SOCKET_PATH: '/s' }, probeHold: 1000, run: argv => fake.run(argv.at(-1) ?? '') ?? {} })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirming(pane)
  await pane.press({ key: 'confirm-1' })
  expect(await state($)).toMatch(/^#1 \[running\]/)
  await clock.sleeping()

  await pane.press({ key: 'stop-1' })
  await clock.advance(1000)

  expect(await state($)).toMatch(/^#1 \[open\]/)
  expect(await texts(pane)).toContain('Stopped')
  expect(fake.ran('herdr pane run')).toEqual([])
  expect(fake.ran('herdr workspace create')).toEqual([])
  await pane.unmount()
})

test('two Confirm presses in the same tick start the run once', async ($, on) => {
  const { clock, spawned } = await seeded($, on, [todo({})], { script: () => exits([]), run: () => ({}) })
  await $.command.run({ command: 'todos-runner', args: 'local' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirming(pane)

  await Promise.all([pane.press({ key: 'confirm-1' }), pane.press({ key: 'confirm-1' })])
  await clock.settle()

  expect(spawned).toHaveLength(1)
  await pane.unmount()
})

test('a herdr run that cannot be typed closes its tab and clears the item\'s pane and tab', async ($, on) => {
  const fake = herdrFake()
  fake.state.isRunRefused = true
  const { events, store } = await seeded($, on, [todo({})], { run: argv => fake.run(argv.at(-1) ?? '') ?? {} })
  await $.command.run({ command: 'todos-runner', args: 'herdr' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await confirming(pane)
  await pane.press({ key: 'confirm-1' })

  const saved = (store.get(`list:${SESSION}`) as { todos: Todo[] }).todos[0]
  expect(saved).toMatchObject({ status: 'open', note: 'Could not start' })
  expect(saved?.paneId).toBeUndefined()
  expect(saved?.tabId).toBeUndefined()
  expect(fake.ran('herdr tab close')).toHaveLength(1)
  expect(toasts(events)).toEqual(['Could not start #1'])
  await pane.unmount()
})

test('withdrawing an item that now runs locally still closes the herdr tab it once held', async ($, on) => {
  const fake = herdrFake()
  const { ran } = await seeded($, on, [todo({ status: 'done', runner: 'local', logPath: '/log/1', tabId: 'tabZ' })], { run: argv => fake.run(argv.at(-1) ?? '') ?? {} })

  await $.tool.call({ tool: WITHDRAW, id: '1' })

  expect(fake.ran('herdr tab close')).toEqual(["herdr tab close 'tabZ'"])
  expect(ran.filter(argv => argv[0] === 'rm').map(argv => argv[3])).toEqual(['/log/1'])
})
