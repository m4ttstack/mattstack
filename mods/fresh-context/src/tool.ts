import type { EngineInterface, On } from 'claude-code'

import type { Carry, Mode } from './carry'
import { busyNow, claim, queue, release } from './reset'

export const TOOL = 'mcp__fresh-context__fresh_context'

const DESCRIPTION = `Clear or compact this session and pick up where it left off.
Write your ledger first: the one your current skill keeps, or a short note of the goal, where things are, what is done, what is next and what you are waiting on.
mode "clear" starts a brand-new conversation holding only the ledger; "compact" runs compaction steered by the ledger.
then (optional) is the instruction the fresh context starts on, submitted on its own (a slash command works). Leave it out to let a pending wakeup or a chat message start the next turn.
The reset runs right after this turn ends; end your turn after calling it. A clear is refused while a subagent, background shell, monitor or workflow is running.`

export async function registerToolDef($: EngineInterface): Promise<void> {
  await $.tool.register({
      name: 'fresh_context',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['clear', 'compact'], description: 'clear: a brand-new conversation. compact: a summary plus recent turns.' },
          ledger: { type: 'string', description: 'Free text carried into the fresh context as is.' },
          then: { type: 'string', description: 'The instruction the fresh context starts on.' },
        },
        required: ['mode', 'ledger'],
      },
    })
}

export function registerTool(on: On): void {
  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' as const }))

  // The engine's row draws a call's whole input, ledger and all. ctrl+o still has it all.
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, ($, e, next) => {
    const { mode } = (e.props.input ?? {}) as { mode?: unknown }
    if (e.props.isExpanded || typeof mode !== 'string') return next(e)
    return next({ ...e, props: { ...e.props, input: { mode } } })
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId) return { deny: 'Only the main session can reset itself; a subagent cannot.' }
    const { mode, ledger, then } = e as unknown as { mode?: unknown; ledger?: unknown; then?: unknown }
    if (mode !== 'clear' && mode !== 'compact') return { deny: 'mode must be "clear" or "compact".' }
    if (typeof ledger !== 'string' || ledger.trim() === '') return { deny: 'Write a ledger first: the reset carries nothing else.' }
    if (then !== undefined && typeof then !== 'string') return { deny: 'then must be text.' }
    // Claimed before the first await, so a second call in the same message is refused.
    if (!claim()) return { deny: 'A reset is already queued for the end of this turn.' }
    try {
      if (mode === 'clear') {
        const busy = await busyNow($)
        if (busy.length > 0) {
          release()
          return { deny: `Not now: still running\n${busy.join('\n')}` }
        }
      }
      const oldSessionId = await $.session.id()
      const carry: Carry = { mode: mode as Mode, ledger, oldSessionId, createdAt: await $.clock.now(), ...(then ? { then } : {}) }
      await queue($, carry)
    } catch (err) {
      release()
      throw err
    }
    return { result: `Reset queued: ${mode} after this turn.` }
  })
}
