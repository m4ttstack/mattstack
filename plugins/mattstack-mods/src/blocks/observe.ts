import type { Hub, ModApi, PermitNext } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'

type Execution = 'working' | 'idle' | 'blocked'
type Background = 'active' | 'inactive' | 'unknown'

/**
 * The `observe` block: reports the session's own state to rt as
 * `session:report { event: "observation" }`, for the herd watchdog to read
 * ahead of the pane: a turn running, a turn ended (with the background work
 * the Stop saw still running), and a question form on screen. The session's
 * end reaches rt through the link's own `session:end`, which runs before any
 * block hears of it. It also takes the watchdog's `nudge` command and starts
 * a turn with its text, so nothing is typed into the pane.
 */
export function registerObserve(hub: Hub, link: Link): void {
  let api: ModApi | null = null
  // Reports go out in order, and a turn never waits on the daemon for one.
  let reports: Promise<void> = Promise.resolve()
  // What the last Stop said of background work; a turn's end reports it, and a new turn forgets it.
  let background: Background = 'unknown'

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  function report(execution: Execution, bg: Background): void {
    reports = reports
      .then(async () => {
        const out = await link.call('session:report', { event: 'observation', observation: { execution, background: bg } })
        if (!out.ok && out.error.code !== 'no-link') log(`${execution} was not reported (${out.error.code}: ${out.error.message})`)
      })
      .catch(err => log(`${execution} was not reported: ${err instanceof Error ? err.message : String(err)}`))
  }

  async function asked(_a: ModApi, e: Parameters<PermitNext>[0], next: PermitNext) {
    report('blocked', 'unknown')
    try {
      return await next(e)
    } finally {
      report('working', 'unknown')
    }
  }

  const nudgeText = (cmd: Command): string | null => {
    const text = (cmd.data as { text?: unknown } | null)?.text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
  }

  async function nudge(cmd: Command, a: ModApi): Promise<void> {
    const text = nudgeText(cmd)
    if (text === null) throw new Error(`nudge ${cmd.id} carried no text`)
    await a.prompt.submit({ text })
    log(`nudge ${cmd.id} submitted`)
  }

  link.onCommand('nudge', nudge, 'observe', cmd => nudgeText(cmd) !== null)

  hub.block('observe', async (started, scope) => {
    api = started
    scope.onLifecycle('turn-start', () => {
      background = 'unknown'
      report('working', 'unknown')
    })
    scope.onStop((_a, e) => {
      const tasks = (e as { background_tasks?: unknown }).background_tasks
      if (Array.isArray(tasks)) background = tasks.length > 0 ? 'active' : 'inactive'
    })
    scope.onLifecycle('turn-end', (_a, e) => {
      // A subagent's run ends in a turn.complete of its own, inside the session's turn.
      if (e.agentId === undefined) report('idle', background)
    })
    scope.onToolCall({ stage: 'permit', tool: 'AskUserQuestion', run: asked })
  })
}
