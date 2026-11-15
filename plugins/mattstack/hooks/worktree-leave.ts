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
// A wait the engine cut off at its 10 s limit is retried; this many in a row means gate-form is gone.
const WAIT_REJECTIONS = 3
const REUSED = 'This worktree was reused'

type AwaitLeave =
  | { state: 'leaving'; why: string; mainCheckout: string }
  | { state: 'reclaimed'; mainCheckout: string }
  | { state: 'none' }
  | { state: 'timeout' }

type Choice = 'close' | 'leave'

// A reloaded module registers again; a loop from an earlier registration sees a newer generation and stops.
let generation = 0

export const register: Register = on => {
  const mine = ++generation
  let watching = false

  // A module takes one bare hook per event and slack-support.ts holds session.start's; a matcher every start meets keeps this one beside it.
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    if (!watching) {
      watching = true
      const since = new Date().toISOString()
      // The session's start refuses commands from inside its hook, so the loop starts from a timer.
      $.clock.after(0, () => void watch($, since, () => generation === mine).catch(() => undefined))
    }
    return started
  })
}

async function watch($: EngineInterface, since: string, current: () => boolean): Promise<void> {
  const session = await $.session.id()
  let leftTree: string | null = null
  while (current()) {
    const cwd = await $.session.cwd()
    if (leftTree !== null && within(cwd, leftTree)) {
      await wait($, IDLE_POLL_MS)
      continue
    }
    leftTree = null
    const answer = await awaitLeave($, cwd, session, since)
    if (!current()) return
    if (answer === null || answer.state === 'none') {
      await wait($, IDLE_POLL_MS)
      continue
    }
    if (answer.state === 'timeout') continue
    if (answer.state === 'leaving' && (await ask($, answer.why)) === 'close') {
      await $.command.run({ command: 'exit' })
      return
    }
    const why = answer.state === 'leaving' ? answer.why : REUSED
    await leave($, cwd, answer.mainCheckout, why)
    leftTree = cwd
  }
}

// Only a parsed answer counts: an rt too old for the verb, or one not on this name, tries the next rt.
async function awaitLeave($: EngineInterface, cwd: string, session: string, since: string): Promise<AwaitLeave | null> {
  const home = await $.env.get('HOME')
  const args = ['worktree', 'await-leave', cwd, '--session', session, '--started', since, '--timeout', String(VERB_TIMEOUT_S)]
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
    const value = JSON.parse(stdout.trim()) as Partial<{ state: string; why: string; mainCheckout: string }>
    if (value.state === 'none' || value.state === 'timeout') return { state: value.state }
    if (typeof value.mainCheckout !== 'string') return null
    if (value.state === 'reclaimed') return { state: 'reclaimed', mainCheckout: value.mainCheckout }
    if (value.state === 'leaving' && typeof value.why === 'string') return { state: 'leaving', why: value.why, mainCheckout: value.mainCheckout }
  } catch {
    // not this verb's line
  }
  return null
}

// A gate-form without the noun (missing, or older than 0.6.0) makes the call throw, which leaves without asking.
async function ask($: EngineInterface, why: string): Promise<Choice> {
  let id: string
  try {
    ;({ id } = await $.gateForm.ask({
      title: why,
      label: 'Your worktree is being cleaned up.',
      options: [
        { value: 'close', label: 'Close session' },
        { value: 'leave', label: 'Exit worktree and continue' },
      ],
      timeoutMs: QUESTION_TIMEOUT_MS,
    }))
  } catch {
    return 'leave'
  }
  let rejections = 0
  while (rejections < WAIT_REJECTIONS) {
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
async function leave($: EngineInterface, cwd: string, mainCheckout: string, why: string): Promise<void> {
  await $.tool.call({ tool: 'ExitWorktree', action: 'keep' }).catch(() => undefined)
  if (within(await $.session.cwd(), cwd)) await $.command.run({ command: 'cd', args: mainCheckout })
  const note = `${why}: left the worktree; now in ${mainCheckout}`
  await $.ui.log(note)
  await $.session.append({
    message: {
      type: 'user',
      content: [{ type: 'text', text: `${note}. Your working directory is now ${mainCheckout}; run your next commands from there.` }],
    },
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
