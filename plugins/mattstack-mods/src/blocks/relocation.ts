import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'

/** What `worktree:registered` answers: whether rt's worktree registry holds the path. */
export type Registered = { registered: boolean }

const ENTER_TOOL = 'EnterWorktree'

/** How long the prompt waits on rt's answer before it shows anyway; well under the link's own 25 s cap. */
export const REGISTERED_DEADLINE_MS = 2_500

/** `call`'s result, or null once `REGISTERED_DEADLINE_MS` passes first; a late result is dropped. */
function withinDeadline<T>(api: ModApi, call: Promise<T>): Promise<T | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = api.clock.after(REGISTERED_DEADLINE_MS, () => {
      if (settled) return
      settled = true
      resolve(null)
    })
    call.then(
      value => {
        if (settled) return
        settled = true
        timer.cancel()
        resolve(value)
      },
      error => {
        if (settled) return
        settled = true
        timer.cancel()
        reject(error)
      },
    )
  })
}

/**
 * The `relocation` block: answers EnterWorktree's permission-root relocation
 * prompt inside the session, so no daemon seam reads the screen or presses a
 * key for it.
 *
 * Its check rule allows a path-mode call only when the engine would ask and
 * the daemon says the path is a worktree rt manages for this session. Any
 * other answer, a refusal (auto-accept off, another session's tree), a lost
 * call, or name mode, leaves the engine's verdict, so the person's prompt
 * shows. Its tap reports where a call that ran moved the session, so rt
 * records the move only once it happened.
 */
export function registerRelocation(hub: Hub, link: Link): void {
  let api: ModApi | null = null

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change the decision.
    }
  }

  hub.block('relocation', async (started, scope) => {
    api = started
    scope.onToolCall({
      stage: 'check',
      tool: ENTER_TOOL,
      run: async (a, e, beneath) => {
        const path = (e.input as { path?: unknown } | null)?.path
        if (typeof path !== 'string' || path === '') return
        const verdict = await beneath()
        if (verdict.decision !== 'ask') return verdict
        const out = await withinDeadline(a, link.call<Registered>('worktree:registered', { sessionId: await a.session.id(), path, cwd: await a.session.cwd() }))
        if (out === null) {
          log(`worktree:registered gave no answer within ${REGISTERED_DEADLINE_MS} ms; the prompt shows`)
          return verdict
        }
        if (!out.ok) {
          if (out.error.code !== 'no-link') log(`worktree:registered gave no answer (${out.error.code}: ${out.error.message}); the prompt shows`)
          return verdict
        }
        return out.data?.registered === true ? { decision: 'allow', reason: 'rt manages this worktree' } : verdict
      },
    })
    scope.onToolCall({
      stage: 'tap',
      tool: ENTER_TOOL,
      run: async (a, _e, result) => {
        if (result.deny !== undefined || result.isError) return
        const path = (result.result as { worktreePath?: unknown } | undefined)?.worktreePath
        if (typeof path !== 'string' || path === '') return
        const out = await link.call('worktree:entered', { sessionId: await a.session.id(), path })
        if (!out.ok && out.error.code !== 'no-link') log(`worktree:entered was not recorded (${out.error.code}: ${out.error.message})`)
      },
    })
  })
}
