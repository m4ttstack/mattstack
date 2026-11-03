import type { EngineInterface, Register } from 'claude-code'

// Claude Code asks before EnterWorktree moves the session into a tree outside
// .claude/worktrees, and no allow rule or classic hook can answer that ask.
// rt keeps its trees elsewhere, so this answers the ask itself, so no agent
// ever waits on a person for it: an allow for a path rt's worktree registry
// holds, and a deny whose reason tells the agent what to do instead for a
// path that is missing or not an rt tree. Only a failure to ask rt leaves
// the engine's own decision standing.
export const register: Register = on => {
  on('tool.check', { tool: 'EnterWorktree' }, async ($, e, next) => {
    const core = await next(e)
    if (core.decision !== 'ask') return core
    const path = (e.input as { path?: unknown } | null)?.path
    if (typeof path !== 'string') return core
    const state = await worktreeState($, path)
    if (state === 'registered') return { decision: 'allow', reason: `${path} is an rt worktree` }
    if (state === 'missing') {
      return {
        decision: 'deny',
        reason: `No worktree at ${path}. It was likely removed after its PR merged. Provision a new tree with worktree_provision, or branch in the current tree with git switch -c.`,
      }
    }
    if (state === 'unregistered') {
      return {
        decision: 'deny',
        reason: `${path} isn't an rt worktree. Enter one from rt worktree list, or provision one with worktree_provision.`,
      }
    }
    return core
  }).catch(($, e, next) => next(e))
}

// Only the verb's own stdout word settles it: an rt too old for the verb, or
// one not set up, also exits nonzero, so anything else tries the next rt.
async function worktreeState($: EngineInterface, path: string): Promise<'registered' | 'unregistered' | 'missing' | null> {
  const home = await $.env.get('HOME')
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    try {
      const { stdout } = await $.process.run([rt, 'worktree', 'is-registered', path], { timeoutMs: 10_000 })
      const word = stdout.trim()
      if (word === 'registered' || word === 'unregistered' || word === 'missing') return word
    } catch {
      // rt not found under this name
    }
  }
  return null
}
