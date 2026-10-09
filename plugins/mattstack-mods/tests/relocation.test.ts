import { describe, expect, test } from 'claude-code/testing'
import { registerRelocation } from '../src/blocks/relocation.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { harness as stub, recorder, type Respond } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerRelocation(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

/** The daemon's defaults, with `worktree:*` answered by `worktree`. */
function daemon(h: ReturnType<typeof stub>, worktree: Respond): Respond {
  return (verb, body) => (verb.startsWith('worktree:') ? worktree(verb, body) : h.defaults(verb, body))
}

const ENTER = (input: Record<string, unknown>) => ({ tool: 'EnterWorktree', tool_use_id: 'tu-1', input })
const RELOCATION_ASK = { decision: 'ask', reason: 'permission-root relocation' }
const ENTERED = { ref: 1, text: 'Switched', result: { worktreePath: '/pool/r/fred', message: 'Switched' } }

describe('relocation permit', () => {
  test('a registered path enters with no prompt and no key press', async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { registered: true } }))
    await h.start()

    const engine = recorder(RELOCATION_ASK)
    const result = await h.fire('tool.check', ENTER({ path: '../pool/r/fred' }), engine.next)

    expect(result).toEqual({ decision: 'allow', reason: 'rt manages this worktree' })
    expect(h.verbs('worktree:registered').map(s => s.body)).toEqual([{ sessionId: 'sess-1', path: '../pool/r/fred', cwd: '/repo', linkId: 'ml-1' }])

    // The move into the tree is reported only once EnterWorktree has run.
    expect(h.verbs('worktree:entered')).toHaveLength(0)
    const call = { tool: 'EnterWorktree', tool_use_id: 'tu-1', path: '../pool/r/fred' }
    expect(await h.fire('tool.call', call, recorder(ENTERED).next)).toEqual(ENTERED)
    expect(h.verbs('worktree:entered').map(s => s.body)).toEqual([{ sessionId: 'sess-1', path: '/pool/r/fred', linkId: 'ml-1' }])
  })

  test('an unregistered path keeps the prompt', async () => {
    const answers: (Record<string, unknown> | Error)[] = [
      { ok: true, data: { registered: false } },
      { ok: false, error: 'refused', failure: { code: 'refused', message: 'fred belongs to another session' } },
      { ok: false, error: 'refused', failure: { code: 'refused', message: 'relocation auto-accept is off' } },
      new Error('connection refused'),
    ]
    for (const answer of answers) {
      const h = harness()
      h.script.respond = daemon(h, () => answer)
      await h.start()
      const result = await h.fire('tool.check', ENTER({ path: '/elsewhere/wt' }), recorder(RELOCATION_ASK).next)
      expect(result).toEqual(RELOCATION_ASK)
      expect(h.hub.liveBlocks()).toContain('relocation')
    }
  })

  test('name mode, an allow or a deny beneath, and other tools are never asked about', async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { registered: true } }))
    await h.start()

    expect(await h.fire('tool.check', ENTER({ name: 'feature-x' }), recorder(RELOCATION_ASK).next)).toEqual(RELOCATION_ASK)
    expect(await h.fire('tool.check', ENTER({ path: '/pool/r/fred' }), recorder({ decision: 'deny', reason: 'a rule' }).next)).toEqual({ decision: 'deny', reason: 'a rule' })
    expect(await h.fire('tool.check', ENTER({ path: '/pool/r/fred' }), recorder({ decision: 'allow' }).next)).toEqual({ decision: 'allow' })
    expect(await h.fire('tool.check', { tool: 'Bash', input: { command: 'ls' } }, recorder(RELOCATION_ASK).next)).toEqual(RELOCATION_ASK)
    expect(h.verbs('worktree:registered')).toHaveLength(0)
  })

  test('a declined or failed EnterWorktree reports no move', async () => {
    const h = harness()
    await h.start()
    const call = { tool: 'EnterWorktree', tool_use_id: 'tu-1', path: '/pool/r/fred' }
    await h.fire('tool.call', call, recorder({ deny: 'The user declined' }).next)
    await h.fire('tool.call', call, recorder({ isError: true, result: 'not a worktree', text: 'not a worktree' }).next)
    expect(h.verbs('worktree:entered')).toHaveLength(0)
  })

  test('without the block live nothing is asked', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: [] } } : h.defaults(verb, body)
    await h.start()

    expect(await h.fire('tool.check', ENTER({ path: '/pool/r/fred' }), recorder(RELOCATION_ASK).next)).toEqual(RELOCATION_ASK)
    await h.fire('tool.call', { tool: 'EnterWorktree', tool_use_id: 'tu-1', path: '/pool/r/fred' }, recorder(ENTERED).next)
    expect(h.verbs('worktree:registered')).toHaveLength(0)
    expect(h.verbs('worktree:entered')).toHaveLength(0)
  })
})
