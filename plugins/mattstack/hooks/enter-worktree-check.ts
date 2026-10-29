import type { EngineInterface, Register } from 'claude-code'

// Claude Code asks before EnterWorktree moves the session into a tree outside
// .claude/worktrees, and no allow rule or classic hook can answer that ask.
// rt keeps its trees elsewhere, so this lifts the ask to an allow only for a
// path rt's worktree registry holds; anything else, or any failure to ask rt,
// leaves the engine's own decision standing.
export const register: Register = on => {
  on('tool.check', { tool: 'EnterWorktree' }, async ($, e, next) => {
    const core = await next(e)
    if (core.decision !== 'ask') return core
    const path = (e.input as { path?: unknown } | null)?.path
    if (typeof path !== 'string') return core
    return (await isRtWorktree($, path))
      ? { decision: 'allow', reason: `${path} is an rt worktree` }
      : core
  }).catch(($, e, next) => next(e))
}

// Only the verb's own stdout word settles it: an rt too old for the verb, or
// one not set up, also exits nonzero, so anything else tries the next rt.
async function isRtWorktree($: EngineInterface, path: string): Promise<boolean> {
  const home = await $.env.get('HOME')
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    try {
      const { stdout } = await $.process.run([rt, 'worktree', 'is-registered', path], { timeoutMs: 10_000 })
      const word = stdout.trim()
      if (word === 'registered') return true
      if (word === 'unregistered') return false
    } catch {
      // rt not found under this name
    }
  }
  return false
}
