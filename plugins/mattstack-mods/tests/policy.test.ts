import { describe, expect, test } from 'claude-code/testing'
import { registerPolicy } from '../src/blocks/policy.ts'
import { registerStopGate } from '../src/blocks/stop-gate.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder, type Respond } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerPolicy(hub, link)
  registerStopGate(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

/** The daemon's defaults, with `policy:*` answered by `policy`. */
function daemon(h: ReturnType<typeof stub>, policy: Respond): Respond {
  return (verb, body) => (verb.startsWith('policy:') ? policy(verb, body) : h.defaults(verb, body))
}

const ASK = {
  tool: 'AskUserQuestion',
  tool_use_id: 'tu-1',
  questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false }],
}
const RUN_DB = '/home/u/.mattstack/runs/repo-a/r-1/state.db'
const RUN = (tool: string, extra: Record<string, unknown> = {}) => ({ tool: `mcp__plugin_mattstack_mattstack__${tool}`, tool_use_id: 'tu-2', runDb: RUN_DB, ...extra })
const STOP = { session_id: 'sess-1', transcript_path: '/t.jsonl', cwd: '/repo', hook_event_name: 'Stop', stop_hook_active: false }
const REASON = 'Run `r-1` is `running` in stage `ship`. A turn cannot end here in prose.'

/** The settings Stop hook beneath the mod: the shell backstop. */
const shell = (block?: string) => recorder(block === undefined ? {} : { block })

describe('policy guard', () => {
  test('mod guard refuses a foreign gate answer with its reason', async () => {
    const h = harness()
    const refusal = 'Blocking forks go through the gate protocol first: run `rt gate ask --questions <json>` ...'
    h.script.respond = daemon(h, () => ({ ok: true, data: { decision: 'refuse', reason: refusal } }))
    await h.start()

    const engine = recorder({ result: 'asked' })
    const result = await h.fire('tool.call', ASK, engine.next)

    expect(result).toEqual({ deny: refusal })
    expect(engine.seen).toHaveLength(0)
    // The daemon resolves the gate subject from the session's binding: the call names no subject and no directory.
    expect(h.verbs('policy:authorize').map(s => s.body)).toEqual([{ sessionId: 'sess-1', action: 'ask', cwd: '/repo', linkId: 'ml-1' }])
  })

  test("a question carries the session's directory now, after EnterWorktree moved it from where the link registered", async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { decision: 'allow' } }))
    await h.start()
    h.$.session.cwd = async () => '/repo/.wt/x'

    await h.fire('tool.call', ASK, recorder({ result: 'asked' }).next)
    await h.fire('tool.call', RUN('run_stage'), recorder({ result: 'ok' }).next)

    expect(h.verbs('session:register')[0]?.body.cwd).toBe('/repo')
    expect(h.verbs('policy:authorize').map(s => s.body)).toEqual([
      { sessionId: 'sess-1', action: 'ask', cwd: '/repo/.wt/x', linkId: 'ml-1' },
      { sessionId: 'sess-1', action: 'continue', subject: RUN_DB, linkId: 'ml-1' },
    ])
  })

  test('an allowed question goes on to the engine untouched', async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { decision: 'allow' } }))
    await h.start()

    const engine = recorder({ result: 'asked' })
    expect(await h.fire('tool.call', ASK, engine.next)).toEqual({ result: 'asked' })
    expect(engine.seen).toEqual([ASK])
  })

  test('run tools ask continue or complete with their run store as the subject', async () => {
    const h = harness()
    h.script.respond = daemon(h, (_verb, body) =>
      body.action === 'complete' ? { ok: true, data: { decision: 'refuse', reason: 'run r-1 belongs to another session' } } : { ok: true, data: { decision: 'allow' } })
    await h.start()

    for (const tool of ['run_stage', 'run_field_set', 'run_decision']) {
      const engine = recorder({ result: 'ok' })
      expect(await h.fire('tool.call', RUN(tool), engine.next)).toEqual({ result: 'ok' })
    }
    const engine = recorder({ result: 'ok' })
    expect(await h.fire('tool.call', RUN('run_status', { status: 'done' }), engine.next)).toEqual({ deny: 'run r-1 belongs to another session' })
    expect(engine.seen).toHaveLength(0)

    expect(h.verbs('policy:authorize').map(s => [s.body.action, s.body.subject])).toEqual([
      ['continue', RUN_DB], ['continue', RUN_DB], ['continue', RUN_DB], ['complete', RUN_DB],
    ])
  })

  test('a run tool with no run store, a read-only run tool and any other tool are not asked about', async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { decision: 'refuse', reason: 'no' } }))
    await h.start()

    const { runDb: _runDb, ...noStore } = RUN('run_stage')
    for (const call of [noStore, RUN('run_snapshot'), RUN('run_field_get'), { tool: 'Bash', command: 'ls' }]) {
      expect(await h.fire('tool.call', call, recorder({ result: 'ok' }).next)).toEqual({ result: 'ok' })
    }
    expect(h.verbs('policy:authorize')).toHaveLength(0)
  })

  test('no decision, an unavailable policy or a lost call lets the call through', async () => {
    const answers: (Record<string, unknown> | Error)[] = [
      { ok: true, data: { decision: 'none', reason: 'session sess-1 is not bound' } },
      { ok: false, error: 'unavailable', failure: { code: 'transient', message: 'the gate service gave no verdict' } },
      new Error('connection refused'),
    ]
    for (const answer of answers) {
      const h = harness()
      h.script.respond = daemon(h, () => answer)
      await h.start()
      const engine = recorder({ result: 'asked' })
      expect(await h.fire('tool.call', ASK, engine.next)).toEqual({ result: 'asked' })
      expect(h.hub.liveBlocks()).toContain('policy')
    }
  })

  test('without the block live nothing is asked', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: ['stop-gate'] } } : h.defaults(verb, body)
    await h.start()

    expect(await h.fire('tool.call', ASK, recorder({ result: 'asked' }).next)).toEqual({ result: 'asked' })
    expect(h.verbs('policy:authorize')).toHaveLength(0)
  })
})

/** The daemon's defaults, with `runs:owned` answered by `owned` and every `policy:*` allowed. */
function ownedBy(h: ReturnType<typeof stub>, owned: Respond): Respond {
  return (verb, body) => {
    if (verb === 'runs:owned') return owned(verb, body)
    if (verb.startsWith('policy:')) return { ok: true, data: { decision: 'allow' } }
    return h.defaults(verb, body)
  }
}

const bare = (tool: string, extra: Record<string, unknown> = {}) => {
  const { runDb: _runDb, ...call } = RUN(tool, extra)
  return call
}

describe('run store fill', () => {
  test('run_* without runDb resolves the owned run', async () => {
    const h = harness()
    h.script.respond = ownedBy(h, () => ({ ok: true, data: { runDb: RUN_DB } }))
    await h.start()
    h.$.session.cwd = async () => '/repo/.wt/x'

    for (const tool of ['run_stage', 'run_field_set', 'run_field_get', 'run_decision', 'run_status', 'run_snapshot']) {
      const engine = recorder({ result: 'ok' })
      expect(await h.fire('tool.call', bare(tool), engine.next)).toEqual({ result: 'ok' })
      expect(engine.seen).toEqual([{ ...bare(tool), runDb: RUN_DB }])
    }
    // The session's own id and current directory; the daemon proves the caller from the link.
    expect(h.verbs('runs:owned').map(s => s.body)).toEqual(Array(6).fill({ sessionId: 'sess-1', cwd: '/repo/.wt/x', linkId: 'ml-1' }))
    // The filled store is the one the guard then asks about.
    expect(h.verbs('policy:authorize').map(s => [s.body.action, s.body.subject])).toEqual([
      ['continue', RUN_DB], ['continue', RUN_DB], ['continue', RUN_DB], ['complete', RUN_DB],
    ])
  })

  test('a foreign run is never filled', async () => {
    const h = harness()
    const answers: (Record<string, unknown> | Error)[] = [
      { ok: true, data: { runDb: null, reason: 'run r-2 belongs to another session' } },
      { ok: true, data: {} },
      { ok: true, data: { runDb: '' } },
      { ok: false, error: 'refused', failure: { code: 'refused', message: 'link ml-1 carries no live policy block' } },
      new Error('connection refused'),
    ]
    h.script.respond = ownedBy(h, () => answers.shift() ?? new Error('no more answers'))
    await h.start()

    for (let i = 0; i < 5; i++) {
      const engine = recorder({ result: 'ok' })
      expect(await h.fire('tool.call', bare('run_stage'), engine.next)).toEqual({ result: 'ok' })
      expect(engine.seen).toEqual([bare('run_stage')])
    }
    expect(h.verbs('runs:owned')).toHaveLength(5)
    expect(h.verbs('policy:authorize')).toHaveLength(0)
  })

  test("a caller's own runDb is never replaced, and run_start, run_list and other tools are never filled", async () => {
    const h = harness()
    h.script.respond = ownedBy(h, () => ({ ok: true, data: { runDb: '/home/u/.mattstack/runs/repo-a/r-mine/state.db' } }))
    await h.start()

    const theirs = RUN('run_stage', { runDb: '/elsewhere/state.db' })
    const empty = RUN('run_stage', { runDb: '' })
    for (const call of [theirs, empty, bare('run_start'), bare('run_list'), { tool: 'Bash', command: 'ls' }]) {
      const engine = recorder({ result: 'ok' })
      await h.fire('tool.call', call, engine.next)
      expect(engine.seen).toEqual([call])
    }
    expect(h.verbs('runs:owned')).toHaveLength(0)
  })

  test('a write or a read that names its own cwd is left for the run tool to resolve from that cwd', async () => {
    const h = harness()
    h.script.respond = ownedBy(h, () => ({ ok: true, data: { runDb: RUN_DB } }))
    await h.start()

    for (const call of [bare('run_stage', { cwd: '/repo/.wt/b', action: 'start', stage: 'ship' }), bare('run_snapshot', { cwd: '/repo/.wt/b' })]) {
      const engine = recorder({ result: 'ok' })
      await h.fire('tool.call', call, engine.next)
      expect(engine.seen).toEqual([call])
    }
    expect(h.verbs('runs:owned')).toHaveLength(0)
    expect(h.verbs('policy:authorize')).toHaveLength(0)
  })

  test('without the block live nothing is filled', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: ['stop-gate'] } }
        : verb === 'runs:owned' ? { ok: true, data: { runDb: RUN_DB } } : h.defaults(verb, body)
    await h.start()

    const engine = recorder({ result: 'ok' })
    await h.fire('tool.call', bare('run_stage'), engine.next)
    expect(engine.seen).toEqual([bare('run_stage')])
    expect(h.verbs('runs:owned')).toHaveLength(0)
  })
})

describe('stop gate', () => {
  test('mod stop blocks an open running stage and allows a held or waiting one', async () => {
    const h = harness()
    const verdicts = [
      { decision: 'continue', runId: 'r-1', stage: 'ship', reason: REASON },
      { decision: 'allow' },
      { decision: 'allow' },
    ]
    h.script.respond = daemon(h, () => ({ ok: true, data: verdicts.shift() }))
    await h.start()

    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({ block: REASON })
    // Held, then waiting on a gate: the daemon allows, and so does the mod.
    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    expect(h.verbs('policy:stop').map(s => s.body)).toEqual([
      { sessionId: 'sess-1', linkId: 'ml-1' }, { sessionId: 'sess-1', linkId: 'ml-1' }, { sessionId: 'sess-1', linkId: 'ml-1' },
    ])
  })

  test('a mod stop hook that throws leaves the shell hook holding', async () => {
    const h = harness()
    h.script.respond = daemon(h, () => ({ ok: true, data: { decision: 'continue', runId: 'r-1', stage: 'ship', reason: REASON } }))
    await h.start()
    h.$.session.id = async () => {
      throw new Error('session gone')
    }

    // The shell hook beneath has no run to hold: the throw passes the stop through and clears the block.
    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    expect(h.hub.liveBlocks()).not.toContain('stop-gate')
    expect(h.logs.filter(l => l.to === 'debug' && l.text.includes('stop-gate stop handler threw'))).toHaveLength(1)

    // With the block cleared, the shell hook alone still holds the turn.
    const backstop = shell('Run `r-1` is `running` (shell)')
    expect(await h.fire('classic.Stop', STOP, backstop.next)).toEqual({ block: 'Run `r-1` is `running` (shell)' })
    expect(backstop.seen).toHaveLength(1)
    expect(h.verbs('policy:stop')).toHaveLength(0)
  })

  test('the shell hook holds whatever the daemon answers, and an unavailable policy never holds a turn itself', async () => {
    const h = harness()
    const answers: (Record<string, unknown> | Error)[] = [
      new Error('connection refused'),
      { ok: false, error: 'unavailable', failure: { code: 'transient', message: 'runs unreadable' } },
      { ok: true, data: { decision: 'none', reason: 'session sess-1 is not bound' } },
    ]
    h.script.respond = daemon(h, () => answers.shift() ?? new Error('no more answers'))
    await h.start()

    expect(await h.fire('classic.Stop', STOP, shell('held by shell').next)).toEqual({ block: 'held by shell' })
    for (let i = 0; i < 3; i++) expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    expect(h.hub.liveBlocks()).toContain('stop-gate')
  })

  test('a second stop shortly after a first is evaluated afresh', async () => {
    const h = harness()
    let open = true
    h.script.respond = daemon(h, () => ({ ok: true, data: open ? { decision: 'continue', runId: 'r-1', stage: 'ship', reason: REASON } : { decision: 'allow' } }))
    await h.start()

    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({ block: REASON })
    await h.clock.advance(50)
    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({ block: REASON })
    open = false
    await h.clock.advance(50)
    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    await flush()
    expect(h.verbs('policy:stop')).toHaveLength(3)
  })

  test('without the block live the stop goes to the shell hook alone', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: ['policy'] } } : h.defaults(verb, body)
    await h.start()

    expect(await h.fire('classic.Stop', STOP, shell().next)).toEqual({})
    expect(h.verbs('policy:stop')).toHaveLength(0)
  })
})
