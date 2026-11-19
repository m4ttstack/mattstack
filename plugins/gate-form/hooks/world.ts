import { mock, test } from 'claude-code/testing'

type Body = Parameters<Parameters<typeof test>[1]>
export type Engine = Body[0]
export type On = Body[1]
type Node = { children?: unknown[] }

export const ASK = 'mcp__plugin_mattstack_mattstack__gate_ask'
export const OPEN = 'mcp__plugin_mattstack_mattstack__gate_open'
export const PRESENT = 'mcp__plugin_mattstack_mattstack__herd_gate_present'
export const SESSION = 'sess-kit'
export const HOME = '/home/tester'

export const QUESTIONS = [
  { id: 'tier', label: 'Plan tier', multi: false, options: [{ value: 'std', label: 'Standard' }, { value: 'light', label: 'Light' }] },
  { id: 'why', label: 'Anything to add?', multi: false, writeIn: true, options: [{ value: 'no', label: 'No' }] },
]
const CONTROLS = { pause: true, goBack: ['plan', 'provision'] }

export const kitResult = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  presentation: 'kit',
  boardOnly: false,
  subject: 'run:1',
  supersededId: null,
  paneAction: 'kit',
  formChunks: [],
  kitForm: { questions: QUESTIONS, context: 'Pick a tier.', controls: CONTROLS },
  ...over,
})

// What herd_gate_present returns: a herd worker's gate, in gate_ask's kit shape, for the shepherd's form.
export const relayResult = (id: string) => ({
  id,
  kind: 'plan',
  subject: 'herd:hd-1:j',
  presentation: 'kit',
  paneAction: 'kit',
  boardOnly: false,
  relay: true,
  kitForm: { questions: QUESTIONS, context: 'Pick a tier.', controls: { pause: false, goBack: [] } },
})

export const boardResult = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  presentation: 'wait',
  boardOnly: true,
  subject: 'mr:1',
  supersededId: null,
  paneAction: 'wait',
  formChunks: [],
  ...over,
})

export const PANE = {
  plugin: 'gate-form',
  component: 'Pane',
  requestId: 'gate-form',
  props: { title: 'Gate', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

export const ABOVE = {
  plugin: 'gate-form',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

export const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
export const failed = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

type ToolReply = { text: string; result?: unknown }
type Ran = ReturnType<typeof ok> | { deny: string }
type Answer = (argv: readonly string[]) => Ran | Promise<Ran>
type Setting = 'on' | 'off' | 'unreadable' | 'missing'
export type Wait = { argv: readonly string[]; env?: Record<string, string>; end: (stdout: string, code?: number) => Promise<void> }

const SETTING_ARGS = ['settings', 'get', 'rt.gates.kitForm', '--json']
const isSettingRead = (argv: readonly string[]) => argv.slice(1).join(' ') === SETTING_ARGS.join(' ')
const isGateList = (argv: readonly string[]) => argv.slice(1).join(' ') === 'gate list --json'

function settingReply(setting: Setting): Ran {
  if (setting === 'missing') return failed('No setting is called rt.gates.kitForm')
  if (setting === 'unreadable') return ok('not json')
  return ok(JSON.stringify({ ok: true, key: 'rt.gates.kitForm', value: setting === 'on', provenance: { scope: 'machine' } }))
}

export const DECK_TABLE = ['deck                     7940   up    deck', 'board                    11006  up    rt', ''].join('\n')

export type WorldOptions = {
  reply?: (input: Record<string, unknown>) => ToolReply
  rt?: Answer
  openFails?: boolean
  setting?: Setting
  // What `rt gate list --json` lists on a session start.
  gates?: () => unknown[]
  // What `deck list --json` prints; null is a deck that cannot start.
  deck?: string | null
  env?: Record<string, string>
  // `rt gate wait` children wait for the test to end them; otherwise each fails at once, as a wait for a gate rt can't find.
  holdWaits?: boolean
  // Files `$.fs.read` finds, by absolute path; any other read rejects as missing.
  files?: Record<string, string>
}

// What sits beneath the plugin: the pane list, the mattstack tool, `rt`, `deck`, `open`, herdr, the prompt and the session.
// With `holdWaits`, `rt gate wait` children run until the test ends them through `waits`.
export function world(on: On, opts: WorldOptions = {}) {
  const panes = new Map<string, string>()
  const calls: Record<string, unknown>[] = []
  const ran: string[][] = []
  const sent: string[] = []
  const opened: string[] = []
  const bells: string[][] = []
  const deckRuns: string[][] = []
  const waits: Wait[] = []
  const toasts: string[] = []
  const registered: string[] = []
  const state = { setting: opts.setting ?? 'on', settingReads: 0, lists: 0, listFails: false, sessionIdFails: false, submitDrops: false, deck: opts.deck === undefined ? DECK_TABLE : opts.deck }
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/tester/repo' }))
  on('fs.read', (_, e) => {
    const text = opts.files?.[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('tool.register', (_, e) => {
    registered.push(`tool:${e.name}`)
    return { value: { tool: `mcp__gate-form__${e.name}` } }
  })
  on('command.register', (_, e) => {
    registered.push(`command:${e.name}`)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    if (opts.openFails) throw new Error('no room for a pane')
    panes.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.id', () => {
    if (state.sessionIdFails) throw new Error('no session bound')
    return { value: SESSION }
  })
  mock.env(on, { HOME, ...opts.env })
  on('prompt.submit', (_, e) => {
    if (state.submitDrops) return { drop: 'the session is not taking prompts' }
    sent.push(e.text)
    return { text: e.text }
  })
  on('tool.call', (_, e) => {
    calls.push(e as Record<string, unknown>)
    const reply = opts.reply?.(e as Record<string, unknown>) ?? { text: JSON.stringify(kitResult('g1')) }
    return { result: reply.result ?? [{ type: 'text', text: reply.text }], text: reply.text }
  })
  on('process.run', async (_, e) => {
    if (isSettingRead(e.argv)) {
      state.settingReads += 1
      return settingReply(state.setting)
    }
    if (isGateList(e.argv)) {
      state.lists += 1
      if (state.listFails) return failed('rt could not reach the daemon')
      return ok(JSON.stringify({ ok: true, gates: opts.gates?.() ?? [], cursor: null }))
    }
    if (e.argv[0] === 'deck' || e.argv[0]?.endsWith('/deck')) {
      deckRuns.push([...e.argv])
      return state.deck === null ? { deny: 'no such command' } : ok(state.deck)
    }
    if (e.argv[0] === 'open') {
      opened.push(e.argv[1] ?? '')
      return ok('')
    }
    if (e.argv[0] === 'herdr') {
      bells.push([...e.argv])
      return ok('')
    }
    ran.push([...e.argv])
    return (await opts.rt?.(e.argv)) ?? ok(JSON.stringify({ ok: true, conflict: false }))
  })
  on('process.spawn', async function* (_, e) {
    let end!: (exit: { stdout: string; code: number }) => void
    const ended = new Promise<{ stdout: string; code: number }>(resolve => (end = resolve))
    waits.push({
      argv: [...e.argv],
      ...(e.env && { env: { ...e.env } }),
      end: async (stdout, code = 0) => end({ stdout, code }),
    })
    if (!opts.holdWaits) end({ stdout: '', code: 1 })
    const { stdout, code } = await ended
    if (stdout) yield { stream: 'stdout' as const, text: stdout }
    return { value: { code, signal: null } }
  })
  return { panes, calls, ran, sent, opened, bells, deckRuns, waits, toasts, registered, state, clock }
}

export const startSession = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

// The session starts, which reads the setting, and the band records the surface the session draws on; tool.call carries none.
export async function drawOn($: Engine, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') {
  await startSession($)
  const band = await $.ui.mount({ ...ABOVE, surface })
  await band.unmount()
}

export const ask = ($: Engine, over: Record<string, unknown> = {}) => $.tool.call({ tool: ASK, questions: QUESTIONS, kind: 'plan-review', ...over } as never)

export const shown = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(shown).join(''))
export async function rowsOf(ui: { drawn: (scope?: { in?: string }) => Promise<unknown> }, key: string): Promise<string[]> {
  return (((await ui.drawn({ in: key })) as Node).children ?? []).map(shown)
}
export const formOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown>; key?: string } | undefined> }) =>
  ((await ui.find({ type: 'Client' }))?.props.props as { form: { id: string; gateId?: string; status: string; error?: string; note?: string } } | undefined)?.form
export const resultText = (out: unknown) => {
  const result = (out as { result?: unknown }).result
  if (typeof result === 'string') return result
  return ((result as { text: string }[] | undefined) ?? []).map(block => block.text).join('')
}

// Work the plugin starts detached (a watcher's ending, a session start's restore) lands a few turns later.
// It never waits on the mock clock: the plugin's detached work sleeps on none, and a settle waits out a held child.
export async function eventually(check: () => boolean | Promise<boolean>, tries = 200): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  return check()
}
