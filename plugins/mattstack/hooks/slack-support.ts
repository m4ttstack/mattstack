import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import {
  isRefusalLine,
  parseAssignment,
  parseStart,
  parseSupportArgs,
  parseWatchLine,
  renderDelivery,
  findOpenGate,
  slackOpenGate,
  touchesSlackSupport,
  type SlackOpenGate,
  type SlackStart,
  type SlackWatchLine,
} from './slack-support-text.ts'

const COMMAND = 'slack-support'
const SKILL = 'rt:slack-support'
const USAGE = 'Usage: /slack-support <person> <problem>. Put a full name in quotes.'
const ORIGIN_REFUSAL = 'Only a person at the prompt can open a Slack chat.'
const SHELL_REFUSAL = 'Only a person can open a Slack chat, by typing /slack-support at the prompt. The mod runs the rest.'
const HOOK_FAILURE = 'The Slack chat did not open: the /slack-support hook failed.'
const FORM_REFUSAL = 'The Slack chat form could not be checked, so the question was not asked.'
const NOT_RECORDED = 'The Slack chat answer was not recorded, so it stays open until it expires. Answer it in the console.'
const WATCH_ARGS = ['chat', 'slack-watch', '--json']

// Matches the refusals of both the CLI and the daemon; a change of their words
// makes a sign-out read as a failure to retry.
const SIGNED_OUT = /isn't signed in/

const SKILL_DELAY_MS = 200
const START_TIMEOUT_MS = 120_000
const LOOKUP_TIMEOUT_MS = 5_000
// The daemon records a support agent's assignment only once the agent has
// started, so its session can ask before the row exists.
const ASSIGNMENT_WAIT_MS = 20_000
const ASSIGNMENT_RETRY_MS = 500
const ASSIGNMENT_RETRY_MAX_MS = 4_000
const BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

// A chat this session never saw may not exist, and this rt may not know the
// verb, so a watcher gives up where an open chat keeps trying.
const RESUME_TRIES = 3

interface Watch {
  running: boolean
  held: boolean
}

interface WatchEnd {
  end: 'finished' | 'signed-out' | 'refused' | 'failed'
  delivered: boolean
}

export const register: Register = on => {
  const watch: Watch = { running: false, held: false }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Open a Slack support chat with a teammate',
      argumentHint: '<person> <problem>',
    })
    const started = await next(e)
    // A `claude -p` run inside the pane resolves to the pane's identity, and
    // would take the teammate's messages away from the session holding the chat.
    // The lookup waits on the daemon, and Claude Code refuses a command from
    // inside this hook, so both run from a timer.
    if (e.isInteractive) $.clock.after(SKILL_DELAY_MS, () => void startAssigned($, watch))
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.origin.kind !== 'composer') return { text: ORIGIN_REFUSAL }
    const request = parseSupportArgs(e.args)
    if (!request) return { text: USAGE }
    const started = await startChat($, request)
    if (!started.ok) return { text: `The Slack chat did not open: ${started.error}` }
    return { text: `Slack chat starting with ${request.person}; I'll hear when it opens.` }
  }).catch(() => ({ text: HOOK_FAILURE }))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => (touchesSlackSupport(e.command) ? { deny: SHELL_REFUSAL } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : { deny: SHELL_REFUSAL }),
  )

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const gates = e.questions.map(q => slackOpenGate(q.question))
    if (gates.every(gate => gate === null)) return next(e)
    const result = await next(withoutAnswers(e))
    if (result.deny === undefined && !result.isError) await recordAnswers($, e.questions, gates, result.result.answers)
    return result
  }).catch(($, e, next) => (next.called ? next(withoutAnswers(e)) : { deny: FORM_REFUSAL }))

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
async function rt($: EngineInterface, args: readonly string[], timeoutMs?: number, stdin?: string): Promise<ProcessRunResult> {
  const [onPath, installed] = await rtNames($)
  const init = { env: await childEnv($), ...(timeoutMs ? { timeoutMs } : {}), ...(stdin === undefined ? {} : { stdin }) }
  return $.process.run([onPath, ...args], init).catch(() => $.process.run([installed, ...args], init))
}

async function startChat($: EngineInterface, { person, problem }: { person: string; problem: string }): Promise<SlackStart> {
  const pane = await $.env.get('HERDR_PANE_ID')
  const args = ['chat', 'slack-start', person, '--brief', '-', ...(pane ? ['--requester-pane', pane] : []), '--json']
  const { stdout, stderr } = await rt($, args, START_TIMEOUT_MS, problem)
  return parseStart(stdout, stderr)
}

async function startAssigned($: EngineInterface, watch: Watch): Promise<void> {
  let waited = 0
  let delay = ASSIGNMENT_RETRY_MS
  for (;;) {
    const conversation = await assignedConversation($)
    if (conversation !== null) {
      watch.held = true
      void startSkill($, String(conversation))
      startWatcher($, watch)
      return
    }
    if (waited === 0) startWatcher($, watch)
    if (waited >= ASSIGNMENT_WAIT_MS) return
    await wait($, delay)
    waited += delay
    delay = Math.min(delay * 2, ASSIGNMENT_RETRY_MAX_MS)
  }
}

async function assignedConversation($: EngineInterface): Promise<number | null> {
  const found = await rt($, ['chat', 'slack-assignment', '--session', await $.session.id(), '--json'], LOOKUP_TIMEOUT_MS).catch(() => null)
  return found ? parseAssignment(found.stdout) : null
}

// A model could pre-fill the answers it wants recorded as the person's.
function withoutAnswers<E extends { answers?: unknown }>(e: E): E {
  const { answers: _prefilled, ...rest } = e
  return rest as E
}

async function openGate($: EngineInterface, id: string): Promise<SlackOpenGate | null> {
  const listed = await rt($, ['gate', 'list', '--open', '--kind', 'slack-open', '--json'], LOOKUP_TIMEOUT_MS).catch(() => null)
  return listed?.exitCode === 0 ? findOpenGate(listed.stdout, id) : null
}

async function recordAnswers(
  $: EngineInterface,
  questions: readonly { question: string }[],
  gates: readonly (string | null)[],
  answers: unknown,
): Promise<void> {
  try {
    const given = (answers ?? {}) as Record<string, unknown>
    for (const [i, { question }] of questions.entries()) {
      const id = gates[i]
      const said = given[question]
      // A dismissed form is no answer, and the gate stays open for the console.
      if (!id || typeof said !== 'string') continue
      // The marker is text any model can write, so only the gate's own form and options count.
      const gate = await openGate($, id)
      const picked = gate?.question === question ? gate.options.find(o => o.label.toLowerCase() === said.toLowerCase() || o.value.toLowerCase() === said.toLowerCase()) : undefined
      if (!gate || !picked) {
        $.ui.log(NOT_RECORDED)
        continue
      }
      const args = ['gate', 'answer', id, '--answers', JSON.stringify({ [gate.questionId]: picked.value }), '--by', 'slack-mod']
      const recorded = await rt($, args).catch(() => null)
      if (recorded?.exitCode !== 0) $.ui.log(NOT_RECORDED)
    }
  } catch (err) {
    $.ui.log(NOT_RECORDED)
    $.ui.log(`slack-open answer failed: ${String(err)}`, { to: 'debug' })
  }
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
      const { end, delivered } = await watchOnce($, watch)
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
