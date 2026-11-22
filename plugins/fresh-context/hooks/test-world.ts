import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]
type Registered = { name: string; inputSchema?: Record<string, unknown>; isDeferred?: unknown }
type Agent = { id: string; type: string; description: string; status: 'running' | 'completed' }

export const OLD = 'sess-old'
export const NEW = 'sess-new'

// Stands for the engine beneath the mod, and for rt: each `rt chat handoff` call is recorded and
// answered as a signed-in session's would be.
export function world(on: On, { signedIn = true }: { signedIn?: boolean } = {}) {
  const registered: Registered[] = []
  const rt: { args: string[]; sessionId?: string }[] = []
  const commands: string[] = []
  const compactions: (string | undefined)[] = []
  const submitted: string[] = []
  const order: string[] = []
  const agents: Agent[] = []
  const commandsRegistered: { name: string; description: string }[] = []
  const argv0: string[] = []
  const state = { sessionId: OLD, compact: { skip: undefined as string | undefined }, stopBlocks: false, rtOverruns: false, overrunMs: 10_000 }

  on('session.id', () => ({ value: state.sessionId }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('tool.register', (_, e) => {
    registered.push(e as Registered)
    return { value: { tool: `mcp__fresh-context__${e.name}` } }
  })
  on('classic.Stop', () => (state.stopBlocks ? { block: 'keep going' } : {}))
  on('classic.SessionStart', () => ({}))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: agents }))
  on('process.run', async (_, e) => {
    argv0.push(e.argv[0] ?? '')
    const args = e.argv.slice(3, -1)
    rt.push({ args, sessionId: e.init?.env?.CLAUDE_CODE_SESSION_ID })
    if (state.rtOverruns) {
      await clock.advance(state.overrunMs)
      throw new Error('timed out')
    }
    order.push(`rt ${args[0]} after ${session.appended().length} appended`)
    const verb = args[0]
    const reply =
      verb === 'begin' ? (signedIn ? { ok: true, handle: 'pansy.ab12' } : { ok: false, code: 'not-signed-in', error: 'x' })
      : verb === 'complete' ? { ok: true, handle: 'pansy.ab12', name: 'pansy' }
      : { ok: true, signedOut: false }
    return { value: { exitCode: reply.ok ? 0 : 2, stdout: `${JSON.stringify(reply)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_, e) => {
    commandsRegistered.push({ name: e.name, description: e.description })
    return { value: { command: e.name } }
  })
  on('command.run', (_, e) => {
    commands.push(e.args ? `${e.command} ${e.args}` : e.command)
    return { text: '' }
  })
  on('session.compact', (_, e) => {
    compactions.push(e.instructions)
    return state.compact.skip ? { skip: state.compact.skip } : { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  mock.env(on, { HOME: '/home/me' })
  const session = mock.session(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  return {
    registered,
    order,
    commandsRegistered,
    argv0,
    rt,
    commands,
    compactions,
    submitted,
    agents,
    state,
    clock,
    appended: () => session.appended().map(row => (row.message.content[0] as { text?: string }).text),
    verbs: () => rt.map(c => c.args.join(' ')),
  }
}

export const startSession = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

// The turn ends: the Stop hook runs with whatever background work the engine reports.
export const stop = ($: Engine, tasks: { id: string; type: string; status: string; description: string }[] = []) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: tasks })
