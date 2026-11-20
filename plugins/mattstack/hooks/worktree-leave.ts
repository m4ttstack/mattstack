import type { EngineInterface, Register } from 'claude-code'

// When the daemon marks this session's rt tree as leaving (its PR merged), ask
// the person whether to close the session or move it out; when the tree was
// already reused by someone else, move out at once. The daemon kills the
// session itself after a grace period, so every failure here falls through to
// leaving rather than waiting.

const VERB_TIMEOUT_S = 60
// Above the verb's own timeout, so the child is killed only if the verb hangs past it.
const RUN_TIMEOUT_MS = (VERB_TIMEOUT_S + 10) * 1000
const IDLE_POLL_MS = 60_000
const QUESTION_TIMEOUT_MS = 120_000
// How long past the question's own timeout a wait may still answer pending before it counts as timed out.
const PENDING_GRACE_MS = 30_000
// A wait the engine cut off at its 10 s limit is retried; this many in a row means gate-form is gone.
const WAIT_REJECTIONS = 3
const REUSED = 'This worktree was reused'

// `tree` is the tree's root; an rt older than the field leaves it out.
type AwaitLeave =
  | { state: 'leaving'; why: string; mainCheckout: string; tree?: string }
  | { state: 'reclaimed'; mainCheckout: string; tree?: string }
  | { state: 'none' }
  | { state: 'timeout' }

type Choice = 'close' | 'leave' | 'stale'

// In `$.state`, which outlives a reload while module variables start over: each start (a reload raises one) writes a fresh
// token, and a watch whose token is no longer the stored one stops without acting.
const WATCH = { plugin: 'mattstack', key: 'worktreeLeaveWatch' } as const

// When and where the latest start found the session. Not kept in `$.state`: a reload restarts both later, which can only
// miss a reused tree, never wrongly call a tree reused.
let origin: { started: string; cwd: string | null } = { started: new Date().toISOString(), cwd: null }

export const register: Register = on => {
  // A module takes one bare hook per event and slack-support.ts holds session.start's; a matcher every start meets keeps this one beside it.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const result = await next(e)
    origin = { started: new Date().toISOString(), cwd: await $.session.cwd().catch(() => null) }
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    await $.state.set(WATCH, token)
    // The session's start refuses commands from inside its hook, so the watch starts from a timer.
    $.clock.after(0, () => void watch($, token).catch(() => undefined))
    return result
  })
}

async function isCurrent($: EngineInterface, token: string): Promise<boolean> {
  return (await $.state.get(WATCH)).value === token
}

async function watch($: EngineInterface, token: string): Promise<void> {
  const left = { tree: null as string | null }
  for (;;) {
    try {
      if (!(await isCurrent($, token))) return
      if ((await pass($, token, left)) === 'stop') return
    } catch {
      await wait($, IDLE_POLL_MS)
    }
  }
}

async function pass($: EngineInterface, token: string, left: { tree: string | null }): Promise<'again' | 'stop'> {
  const cwd = await $.session.cwd()
  if (left.tree !== null && within(cwd, left.tree)) {
    await wait($, IDLE_POLL_MS)
    return 'again'
  }
  left.tree = null
  // A /clear or an in-process /resume changes the id without raising a start.
  const session = await $.session.id()
  const answer = await awaitLeave($, cwd, session)
  if (!(await isCurrent($, token))) return 'stop'
  if (answer === null || answer.state === 'none') {
    await wait($, IDLE_POLL_MS)
    return 'again'
  }
  if (answer.state === 'timeout') return 'again'
  const tree = answer.tree ?? cwd
  // The verb can wait a minute and the question two: a session that moved away meanwhile is answered for where it is now.
  if (!within(await $.session.cwd(), tree)) return 'again'
  const choice = answer.state === 'leaving' ? await ask($, answer.why, token) : 'leave'
  if (choice === 'stale' || !(await isCurrent($, token))) return 'stop'
  if (!within(await $.session.cwd(), tree)) return 'again'
  if (choice === 'close') {
    // /exit from an EnterWorktree session asks keep or remove; rt removes the tree, so the session drops it first.
    await $.tool.call({ tool: 'ExitWorktree', action: 'keep' }).catch(() => undefined)
    const exited = await $.command.run({ command: 'exit' }).then(
      () => true,
      () => false,
    )
    if (exited) return 'stop'
  }
  await leave($, tree, answer.mainCheckout, answer.state === 'leaving' ? answer.why : REUSED)
  left.tree = tree
  return 'again'
}

// Only a parsed answer counts: an rt too old for the verb, or one not on this name, tries the next rt.
async function awaitLeave($: EngineInterface, cwd: string, session: string): Promise<AwaitLeave | null> {
  const home = await $.env.get('HOME')
  const startCwd = origin.cwd === null ? [] : ['--start-cwd', origin.cwd]
  const args = ['worktree', 'await-leave', cwd, '--session', session, '--started', origin.started, ...startCwd, '--timeout', String(VERB_TIMEOUT_S)]
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    try {
      const { stdout } = await $.process.run([rt, ...args], { timeoutMs: RUN_TIMEOUT_MS })
      const answer = parse(stdout)
      if (answer) return answer
    } catch {
      // rt not found under this name, or it ran past its timeout
    }
  }
  return null
}

function parse(stdout: string): AwaitLeave | null {
  try {
    const value = JSON.parse(stdout.trim()) as Partial<{ state: string; why: string; mainCheckout: string; tree: unknown }>
    if (value.state === 'none' || value.state === 'timeout') return { state: value.state }
    if (typeof value.mainCheckout !== 'string') return null
    const tree = typeof value.tree === 'string' ? { tree: value.tree } : {}
    if (value.state === 'reclaimed') return { state: 'reclaimed', mainCheckout: value.mainCheckout, ...tree }
    if (value.state === 'leaving' && typeof value.why === 'string') return { state: 'leaving', why: value.why, mainCheckout: value.mainCheckout, ...tree }
  } catch {
    // not this verb's line
  }
  return null
}

// A gate-form without the noun, or without confirm (older than 0.6.1), makes the call throw, which leaves without asking.
async function ask($: EngineInterface, why: string, token: string): Promise<Choice> {
  let id: string
  try {
    ;({ id } = await $.gateForm.ask({
      title: why,
      context: 'rt is cleaning up this worktree. No answer in 2 minutes moves this session out.',
      kind: 'confirm',
      options: [
        { value: 'leave', label: 'Exit worktree and continue' },
        { value: 'close', label: 'Close session' },
      ],
      timeoutMs: QUESTION_TIMEOUT_MS,
    }))
  } catch {
    return 'leave'
  }
  const deadline = (await $.clock.now()) + QUESTION_TIMEOUT_MS + PENDING_GRACE_MS
  let rejections = 0
  while (rejections < WAIT_REJECTIONS && (await $.clock.now()) < deadline) {
    if (!(await isCurrent($, token))) return 'stale'
    try {
      const outcome = await $.gateForm.wait({ id })
      rejections = 0
      if ('pending' in outcome) continue
      return 'value' in outcome && outcome.value === 'close' ? 'close' : 'leave'
    } catch {
      rejections += 1
    }
  }
  return 'leave'
}

// ExitWorktree does nothing for a session that started or resumed inside the tree, so a /cd follows it.
// A /cd waits for the session to be idle, so the note names where the session is only once it is there.
async function leave($: EngineInterface, tree: string, mainCheckout: string, why: string): Promise<void> {
  await $.tool.call({ tool: 'ExitWorktree', action: 'keep' }).catch(() => undefined)
  if (within(await $.session.cwd(), tree)) await $.command.run({ command: 'cd', args: mainCheckout })
  const now = await $.session.cwd()
  const moved = !within(now, tree)
  const note = moved ? `${why}: left the worktree; now in ${now}` : `${why}: leaving the worktree; moving to ${mainCheckout}`
  const where = moved ? `Your working directory is now ${now}` : `Your working directory is moving to ${mainCheckout}`
  await $.ui.log(note)
  await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: `${note}. ${where}; run your next commands from there.` }] },
  })
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)
}

function wait($: EngineInterface, ms: number): Promise<void> {
  // $.clock.sleep runs on the hook's budget, and this loop outlives its hook.
  return new Promise(resolve => {
    $.clock.after(ms, resolve)
  })
}
