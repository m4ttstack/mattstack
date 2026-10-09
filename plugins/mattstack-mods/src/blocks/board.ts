import type { ToolSpec } from 'claude-code'
import type { Hub, ModApi, PermitNext } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'
import { STATUS_TOOL, STATUS_TOOL_NAME, STATUS_VERBS, type StatusVerb } from './board-names.ts'

export { STATUS_TOOL_NAME, STATUS_VERBS }

/** How long one status write may run; status-bin opens the board db and emits one signal. */
export const STATUS_TIMEOUT_MS = 30_000
const MAX_ARGS = 32

export const NOT_LIVE =
  "The mattstack status tool is not live in this session. Run the same write with the board's status-bin in Bash instead: `<status-bin> <verb> <args...>`."

export type StandDownState = 'stood-down' | 'stood-down-background' | 'background-finished'

const STATUS_TOOL_SPEC: ToolSpec = {
  name: STATUS_TOOL,
  description:
    "Writes this board pane's status to the mr-board, exactly as running `<status-bin> <verb> <args...>` would. " +
    'Use it in place of every `<status-bin> review-status`, `respond-status` or `doctor-status` Bash call. ' +
    'Pass the words after the verb, in order, as `args`; a message of several words is one string.',
  inputSchema: {
    type: 'object',
    properties: {
      verb: { type: 'string', enum: [...STATUS_VERBS], description: 'The status-bin verb: review-status, respond-status or doctor-status.' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'The arguments after the verb, in order: the state handle, the status, then the optional message and flags (for example --outcome comment).',
      },
    },
    required: ['verb', 'args'],
    additionalProperties: false,
  },
  isDeferred: false,
}

type StatusCall = { verb: StatusVerb; args: string[] }

function statusCall(e: unknown): StatusCall | string {
  const input = (e ?? {}) as { verb?: unknown; args?: unknown }
  if (typeof input.verb !== 'string' || !(STATUS_VERBS as readonly string[]).includes(input.verb)) {
    return `verb must be one of ${STATUS_VERBS.join(', ')}`
  }
  const args = input.args
  if (!Array.isArray(args) || !args.every(a => typeof a === 'string')) return 'args must be a list of strings'
  if (args.length === 0) return 'args must start with the state handle'
  if (args.length > MAX_ARGS) return `args takes at most ${MAX_ARGS} strings`
  if (args.some(a => a.includes('\u0000'))) return 'args must not contain a NUL character'
  return { verb: input.verb as StatusVerb, args: args as string[] }
}

const standDownText = (cmd: Command): string | null => {
  const text = (cmd.data as { text?: unknown } | null)?.text
  return typeof text === 'string' && text.trim().length > 0 ? text : null
}

/**
 * The `board` block, live only in a pane the mr-board launched (it sets
 * MATTSTACK_BOARD_STATUS_BIN to its status writer):
 *
 * - the `status` tool runs that status writer, so a status write is no Bash
 *   call; the writer itself does the write, its validation and its signal.
 * - a pushed `stand-down` ends the running turn with `$.turn.abort`, then
 *   tells rt `stood-down`, or `stood-down-background` while work the turn
 *   left running is still finishing, and `background-finished` once a turn
 *   ends with none left.
 */
export function registerBoard(hub: Hub, link: Link): void {
  let api: ModApi | null = null
  let statusBin: string | null = null
  let turnId: string | null = null
  // Bash calls the engine is running; an abort moves each one to the background instead of stopping it.
  let runningBash = 0
  // What the last Stop listed as background work: null when it said nothing.
  let stopBackground: number | null = null
  let standing: { id: string; state: StandDownState } | null = null
  let reports: Promise<void> = Promise.resolve()

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  function report(commandId: string, state: StandDownState): Promise<void> {
    reports = reports
      .then(async () => {
        const out = await link.call('session:stood-down', { commandId, state })
        if (!out.ok && out.error.code !== 'no-link') log(`stand-down ${commandId} ${state} was not reported (${out.error.code}: ${out.error.message})`)
      })
      .catch(err => log(`stand-down ${commandId} ${state} was not reported: ${err instanceof Error ? err.message : String(err)}`))
    return reports
  }

  async function runStatus(a: ModApi, e: Parameters<PermitNext>[0]) {
    const call = statusCall(e)
    if (typeof call === 'string') return { deny: call }
    if (statusBin === null) return { deny: NOT_LIVE }
    let out
    try {
      out = await a.process.run([statusBin, call.verb, ...call.args], {
        env: { CLAUDE_CODE_SESSION_ID: await a.session.id() },
        timeoutMs: STATUS_TIMEOUT_MS,
      })
    } catch (err) {
      log(`${call.verb} did not run: ${err instanceof Error ? err.message : String(err)}`)
      return { deny: `${call.verb} did not run here. ${NOT_LIVE}` }
    }
    const said = [out.stdout.trim(), out.stderr.trim()].filter(s => s.length > 0).join('\n')
    if (out.exitCode !== 0) return { deny: `${call.verb} exited ${out.exitCode}${said ? `: ${said}` : ''}` }
    return { result: said || `${call.verb} recorded` }
  }

  /**
   * What follows the abort while the turn's background work runs on. The work
   * is left to finish and the session is told it stood down, so the turn its
   * completion starts reads that first; ending or absorbing the work belongs here.
   */
  async function afterAbort(a: ModApi, text: string | null): Promise<void> {
    if (text === null) return
    try {
      await a.prompt.submit({ text })
    } catch (err) {
      log(`the stand-down notice was not submitted: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function standDown(cmd: Command, a: ModApi): Promise<void> {
    const background = runningBash > 0 || (stopBackground ?? 0) > 0
    const running = turnId
    if (running !== null) {
      try {
        await a.turn.abort(running)
      } catch (err) {
        log(`stand-down ${cmd.id} could not end turn ${running}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const state: StandDownState = background ? 'stood-down-background' : 'stood-down'
    standing = { id: cmd.id, state }
    await report(cmd.id, state)
    await afterAbort(a, standDownText(cmd))
  }

  link.onCommand('stand-down', standDown, 'board')

  // Owned by the core, so a call that reaches a cleared block is still answered.
  hub.onToolCall({
    stage: 'permit',
    tool: STATUS_TOOL_NAME,
    run: async (_a, e, next) => (hub.liveBlocks().includes('board') ? next(e) : { deny: NOT_LIVE }),
  })

  hub.block('board', async (started, scope) => {
    api = started
    const bin = await started.env.boardStatusBin()
    if (bin === undefined || !bin.startsWith('/')) throw new Error('not a board pane: MATTSTACK_BOARD_STATUS_BIN is not an absolute path')
    statusBin = bin
    await started.tool.register(STATUS_TOOL_SPEC)
    scope.onToolCall({ stage: 'permit', tool: STATUS_TOOL_NAME, run: runStatus })
    scope.onToolCall({
      stage: 'permit',
      tool: 'Bash',
      run: async (_a, e, next) => {
        runningBash++
        try {
          return await next(e)
        } finally {
          runningBash--
        }
      },
    })
    scope.onLifecycle('turn-start', (_a, e) => {
      turnId = e.turnId
      stopBackground = null
    })
    scope.onStop((_a, e) => {
      const tasks = (e as { background_tasks?: unknown }).background_tasks
      if (Array.isArray(tasks)) stopBackground = tasks.length
    })
    scope.onLifecycle('turn-end', (_a, e) => {
      // A subagent's run ends in a turn.complete of its own, inside the session's turn.
      if (e.agentId !== undefined) return
      turnId = null
      if (standing?.state === 'stood-down-background' && stopBackground === 0) {
        standing = { ...standing, state: 'background-finished' }
        void report(standing.id, 'background-finished')
      }
    })
  })
}
