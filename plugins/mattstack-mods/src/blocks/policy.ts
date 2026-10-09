import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'
import { RUN_TOOL } from './tool-names.ts'

/** What `policy:authorize` answers; `none` is no decision (an unbound session), which passes like an allow. */
export type Authorization = { decision: 'allow' | 'refuse' | 'none'; reason?: string }

const ASK_TOOL = 'AskUserQuestion'

/**
 * The `policy` block: guard rules that ask the daemon's shared policy before
 * a native question (AskUserQuestion) or a run tool that moves a run. Only a
 * `refuse` stops the call. No decision, an unavailable policy or a lost call
 * lets it through: the AskUserQuestion hook every `rt agent` launch installs
 * and the run tools' own checks still apply.
 */
export function registerPolicy(hub: Hub, link: Link): void {
  let api: ModApi | null = null

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change the decision.
    }
  }

  async function authorize(a: ModApi, action: 'ask' | 'continue' | 'complete', subject?: string): Promise<{ refuse: string } | void> {
    const sessionId = await a.session.id()
    // A question's run gate may be filed from the worktree the session moved into since its link registered.
    const where = action === 'ask' ? { cwd: await a.session.cwd() } : { subject }
    const out = await link.call<Authorization>('policy:authorize', { sessionId, action, ...where })
    if (!out.ok) {
      if (out.error.code !== 'no-link') log(`policy:authorize ${action} had no decision (${out.error.code}: ${out.error.message}); passing`)
      return
    }
    if (out.data.decision === 'refuse' && typeof out.data.reason === 'string') return { refuse: out.data.reason }
  }

  hub.block('policy', async (started, scope) => {
    api = started
    scope.onToolCall({ stage: 'guard', tool: ASK_TOOL, run: a => authorize(a, 'ask') })
    scope.onToolCall({
      stage: 'guard',
      tool: RUN_TOOL,
      run: (a, e) => {
        const runDb = (e as { runDb?: unknown }).runDb
        if (typeof runDb !== 'string' || runDb === '') return
        return authorize(a, e.tool.endsWith('__run_status') ? 'complete' : 'continue', runDb)
      },
    })
  })
}
