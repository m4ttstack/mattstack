import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import {
  isRefusalLine,
  parseOpen,
  parseSupportArgs,
  parseWatchLine,
  renderDelivery,
  touchesSlackSupport,
  type SlackOpen,
  type SlackWatchLine,
} from './slack-support-text.ts'

const COMMAND = 'slack-support'
const SKILL = 'rt:slack-support'
const USAGE = 'Usage: /slack-support <person> <problem>'
const ORIGIN_REFUSAL = 'Only a person at the prompt can open a Slack chat.'
const SHELL_REFUSAL = 'Only a person can open a Slack chat, by typing /slack-support at the prompt. The mod runs the rest.'
const HOOK_FAILURE = 'The Slack chat did not open: the /slack-support hook failed.'
const WATCH_ARGS = ['chat', 'slack-watch', '--json']

// Matches the refusals of both the CLI and the daemon; a change of their words
// costs the sign-in, and the operator then reads the refusal.
const SIGNED_OUT = /isn't signed in/

const SKILL_DELAY_MS = 200
const OPEN_TIMEOUT_MS = 60_000
const BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

// A chat this session never saw may not exist, and this rt may not know the
// verb, so a resume gives up where an open chat keeps trying.
const RESUME_TRIES = 3

interface Watch {
  running: boolean
  held: boolean
  opens: number
}

interface WatchEnd {
  end: 'finished' | 'signed-out' | 'refused' | 'failed'
  delivered: boolean
}

export const register: Register = on => {
  const watch: Watch = { running: false, held: false, opens: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Open a Slack support chat with a teammate',
      argumentHint: '<person> <problem>',
    })
    const started = await next(e)
    // A `claude -p` run inside the pane resolves to the pane's identity, and
    // would take the teammate's messages away from the session holding the chat.
    if (e.isInteractive) startWatcher($, watch)
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.origin.kind !== 'composer') return { text: ORIGIN_REFUSAL }
    const request = parseSupportArgs(e.args)
    if (!request) return { text: USAGE }
    const opened = await openChat($, request.person)
    if (!opened.ok) return { text: `The Slack chat did not open: ${opened.error}` }

    watch.held = true
    watch.opens += 1
    startWatcher($, watch)
    // Claude Code refuses a command from inside this hook.
    $.clock.after(SKILL_DELAY_MS, () => void startSkill($, `${opened.handle} ${request.problem}`))
    return { text: `Slack chat open with ${opened.name}.` }
  }).catch(() => ({ text: HOOK_FAILURE }))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => (touchesSlackSupport(e.command) ? { deny: SHELL_REFUSAL } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : { deny: SHELL_REFUSAL }),
  )

  on('tool.call', { tool: 'Monitor' }, ($, e, next) => (touchesSlackSupport(e.command ?? '') ? { deny: SHELL_REFUSAL } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : { deny: SHELL_REFUSAL }),
  )
}

async function childEnv($: EngineInterface): Promise<Record<string, string>> {
  const pane = await $.env.get('HERDR_PANE_ID')
  return { CLAUDE_CODE_SESSION_ID: await $.session.id(), ...(pane ? { HERDR_PANE_ID: pane } : {}) }
}

async function rtNames($: EngineInterface): Promise<[string, string]> {
  return ['rt', `${(await $.env.get('HOME')) ?? ''}/.local/bin/rt`]
}

// A run rejects only when it can't start or passes its timeout, never on a nonzero exit.
async function rt($: EngineInterface, args: readonly string[], timeoutMs?: number): Promise<ProcessRunResult> {
  const [onPath, installed] = await rtNames($)
  const init = { env: await childEnv($), ...(timeoutMs ? { timeoutMs } : {}) }
  return $.process.run([onPath, ...args], init).catch(() => $.process.run([installed, ...args], init))
}

async function runOpen($: EngineInterface, person: string): Promise<SlackOpen> {
  const { stdout, stderr } = await rt($, ['chat', 'slack-open', person, '--json'], OPEN_TIMEOUT_MS)
  return parseOpen(stdout, stderr)
}

// slack-open is the one verb that knows every way a session counts as signed
// in, so it is asked first: `rt chat sign-in` in a forked session makes a second identity.
async function openChat($: EngineInterface, person: string): Promise<SlackOpen> {
  const first = await runOpen($, person)
  if (first.ok || !SIGNED_OUT.test(first.error)) return first
  const signIn = await rt($, ['chat', 'sign-in', '--json'])
  return signIn.exitCode === 0 ? runOpen($, person) : first
}

async function startSkill($: EngineInterface, args: string): Promise<void> {
  try {
    await $.command.run({ command: SKILL, args })
  } catch (err) {
    await abandonChat($, err)
  }
}

async function abandonChat($: EngineInterface, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err)
  const closed = await rt($, ['chat', 'slack-close']).catch(() => null)
  $.ui.log(
    closed?.exitCode === 0
      ? `The Slack chat was closed because its skill did not start: ${reason}`
      : `The Slack chat's skill did not start (${reason}), and the chat could not be closed. To close it, run rt chat slack-close`,
  )
}

function startWatcher($: EngineInterface, watch: Watch): void {
  if (watch.running) return
  watch.running = true
  void runWatcher($, watch)
}

function wait($: EngineInterface, ms: number): Promise<void> {
  // $.clock.sleep runs on the hook's budget, and this loop outlives its hook.
  return new Promise(resolve => {
    $.clock.after(ms, resolve)
  })
}

async function runWatcher($: EngineInterface, watch: Watch): Promise<void> {
  let failures = 0
  try {
    for (;;) {
      const opens = watch.opens
      const { end, delivered } = await watchOnce($, watch)
      if (watch.opens !== opens) {
        failures = 0
        continue
      }
      // A sign-out closes the session's chat, so nothing is left to come back to.
      if (end === 'finished' || end === 'signed-out') {
        watch.held = false
        return
      }
      if (!watch.held && (end === 'refused' || failures + 1 >= RESUME_TRIES)) return
      failures = delivered ? 0 : failures + 1
      await wait($, Math.min(BACKOFF_MS * 2 ** Math.max(failures - 1, 0), MAX_BACKOFF_MS))
    }
  } finally {
    watch.running = false
  }
}

async function watchOnce($: EngineInterface, watch: Watch): Promise<WatchEnd> {
  for (const name of await rtNames($)) {
    const ended = await watchWith($, watch, name)
    if (ended) return ended
  }
  return { end: 'failed', delivered: false }
}

/** Null when this rt can't start: a spawn rejects its first pull, before any output. */
async function watchWith($: EngineInterface, watch: Watch, name: string): Promise<WatchEnd | null> {
  let started = false
  let delivered = false
  let heard = false
  let refused: WatchEnd['end'] | undefined
  let lastKind: SlackWatchLine['kind'] | undefined
  try {
    const child = $.process.spawn({ argv: [name, ...WATCH_ARGS], env: await childEnv($) })
    const exited = child.result.catch(() => null)
    let partial = ''
    for await (const { stream, text } of child) {
      started = true
      if (stream !== 'stdout') continue
      const lines = (partial + text).split('\n')
      partial = lines.pop() ?? ''
      for (const raw of lines) {
        if (isRefusalLine(raw)) refused = SIGNED_OUT.test(raw) ? 'signed-out' : 'refused'
        const line = parseWatchLine(raw)
        if (!line) continue
        heard = true
        watch.held = true
        // Leaving the loop kills the child: a new one prints what is still waiting.
        if (!(await deliver($, line))) return { end: 'failed', delivered }
        delivered = true
        lastKind = line.kind
      }
    }
    const exit = await exited
    if (refused) return { end: refused, delivered }
    const nothingLeft = exit?.code === 0 && (!heard || lastKind === 'closed')
    return { end: nothingLeft ? 'finished' : 'failed', delivered }
  } catch (err) {
    $.ui.log(`slack-watch stopped: ${String(err)}`, { to: 'debug' })
    return started ? { end: 'failed', delivered } : null
  }
}

async function deliver($: EngineInterface, line: SlackWatchLine): Promise<boolean> {
  try {
    const entered = await $.prompt.submit({ text: renderDelivery(line) })
    if (entered.drop !== undefined) return false
    const confirmed = await rt($, ['chat', 'slack-delivered', String(line.id)])
    return confirmed.exitCode === 0
  } catch (err) {
    $.ui.log(`Slack item ${line.id} did not reach the session: ${String(err)}`, { to: 'debug' })
    return false
  }
}
