import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'

/** What `policy:stop` answers; `none` is no decision (an unbound session). */
export type StopVerdict = { decision: 'allow' | 'continue' | 'none'; reason?: string; runId?: string; stage?: string }

/**
 * The `stop-gate` block: each Stop asks the daemon's shared continuation
 * policy afresh and holds the turn with its reason on `continue`. The
 * mattstack plugin's `pipeline-gate-stop.sh` stays installed and runs
 * beneath it on every stop, so a failed call or a cleared block never leaves
 * a pipeline run's turn unguarded; nothing here ever holds a turn the
 * policy did not ask to continue.
 */
export function registerStopGate(hub: Hub, link: Link): void {
  let api: ModApi | null = null

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change the decision.
    }
  }

  hub.block('stop-gate', async (started, scope) => {
    api = started
    scope.onStop(async a => {
      const sessionId = await a.session.id()
      const out = await link.call<StopVerdict>('policy:stop', { sessionId })
      if (!out.ok) {
        if (out.error.code !== 'no-link') log(`policy:stop had no decision (${out.error.code}: ${out.error.message}); the shell hook decides`)
        return
      }
      if (out.data.decision === 'continue' && typeof out.data.reason === 'string') return { block: out.data.reason }
    })
  })
}
