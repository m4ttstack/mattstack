import type { Hub, ModApi } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'

type Execution = 'turn-start' | 'turn-end'

/**
 * The `presence` block: reports the session's turns to rt, so the buddy list
 * reads working or idle from the session itself, and signs the session in
 * when rt sends `chat-sign-in`. A session's end reaches rt through the link's
 * own `session:end`.
 */
export function registerPresence(hub: Hub, link: Link): void {
  let api: ModApi | null = null
  // Reports go out in order, and a turn never waits on the daemon for one.
  let reports: Promise<void> = Promise.resolve()

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  function report(event: Execution): void {
    reports = reports
      .then(async () => {
        const out = await link.call('session:report', { event })
        if (!out.ok && out.error.code !== 'no-link') log(`${event} was not reported (${out.error.code}: ${out.error.message})`)
      })
      .catch(err => log(`${event} was not reported: ${err instanceof Error ? err.message : String(err)}`))
  }

  async function signIn(cmd: Command): Promise<void> {
    const a = api
    if (!a) throw new Error('chat-sign-in arrived before the presence block started')
    const input = (cmd.data ?? {}) as { room?: unknown }
    const [sessionId, root] = await Promise.all([a.session.id(), a.session.root()])
    const out = await link.call<{ name?: string; room?: string | null }>('chat:sign-in', {
      sessionId,
      cwd: root,
      commandId: cmd.id,
      ...(typeof input.room === 'string' && { room: input.room }),
    })
    if (out.ok) log(`signed in to rt chat as ${out.data.name ?? 'an identity'}${out.data.room ? ` in #${out.data.room}` : ''}`)
    else log(`chat-sign-in ${cmd.id} failed (${out.error.code}: ${out.error.message})`)
  }

  link.onCommand('chat-sign-in', signIn, 'presence')

  hub.block('presence', async (started, scope) => {
    api = started
    scope.onLifecycle('turn-start', () => report('turn-start'))
    scope.onLifecycle('turn-end', (_api, e) => {
      // A subagent's run ends in a turn.complete of its own, inside the session's turn.
      if (e.agentId === undefined) report('turn-end')
    })
  })
}
