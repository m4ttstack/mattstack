import { describe, expect, test } from 'claude-code/testing'
import { registerPresence } from '../src/blocks/presence.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerPresence(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

const turnStart = (h: ReturnType<typeof stub>, turnId = 't-1') => h.fire('turn.start', { text: 'go', turnId }, async () => ({ turnId }))
const turnEnd = (h: ReturnType<typeof stub>, extra: Record<string, unknown> = {}) =>
  h.fire('turn.complete', { answer: '', durationMs: 5, isAborted: false, turnId: 't-1', reason: 'answer', ...extra }, async () => ({ text: '' }))
const command = (id: string, link: string, data: unknown = {}) =>
  ({ origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="chat-sign-in" link="${link}">${JSON.stringify(data)}</rt-mod-command>` })

describe('presence', () => {
  test('turn start and end report working and idle over the link', async () => {
    const h = harness()
    await h.start()
    expect(h.hub.liveBlocks()).toEqual(['presence'])

    await turnStart(h)
    await flush()
    await turnEnd(h)
    await flush()

    expect(h.verbs('session:report').map(s => s.body)).toEqual([
      { event: 'turn-start', linkId: 'ml-1' },
      { event: 'turn-end', linkId: 'ml-1' },
    ])
  })

  test("a subagent's turn end is not the session's", async () => {
    const h = harness()
    await h.start()
    await turnStart(h)
    await turnEnd(h, { agentId: 'a-1' })
    await flush()

    expect(h.verbs('session:report').map(s => s.body.event)).toEqual(['turn-start'])
  })

  test('a turn report waits for nothing: the turn goes on while the daemon is slow', async () => {
    const h = harness()
    await h.start()
    let release: () => void = () => {}
    h.script.respond = (verb, body) =>
      verb === 'session:report' ? new Promise(resolve => { release = () => resolve({ ok: true, data: { outcome: 'unbound' } }) }) : h.defaults(verb, body)
    const engine = recorder({ turnId: 't-1' })

    const started = await h.fire('turn.start', { text: 'go', turnId: 't-1' }, engine.next)
    expect(started).toEqual({ turnId: 't-1' })
    expect(engine.seen).toHaveLength(1)
    release()
  })

  test("sign-in through the mod uses the session's own id and root", async () => {
    const h = harness()
    h.$.session.root = async () => '/repo/.worktrees/feature'
    await h.start()

    const engine = recorder({ text: 'unused' })
    const result = await h.fire('session.receive', command('cmd-1', 'ml-1', { room: 'build' }), engine.next)
    await flush()

    expect(result.consumed).toBeDefined()
    expect(engine.seen).toHaveLength(0)
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'cmd-1' }])
    expect(h.verbs('chat:sign-in').map(s => s.body)).toEqual([
      { sessionId: 'sess-1', cwd: '/repo/.worktrees/feature', commandId: 'cmd-1', room: 'build', linkId: 'ml-1' },
    ])
  })

  test('sign-in survives /clear through the link continuation: the command for the new link signs in the new id', async () => {
    const h = harness()
    await h.start()
    await h.clear('sess-2')

    await h.fire('session.receive', command('cmd-2', 'ml-2'), recorder({ text: 'unused' }).next)
    await flush()

    expect(h.verbs('chat:sign-in').map(s => s.body)).toEqual([
      { sessionId: 'sess-2', cwd: '/repo', commandId: 'cmd-2', linkId: 'ml-2' },
    ])
  })

  test('without the block live the sign-in command is not acked, so rt signs in its own way', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: [] } } : h.defaults(verb, body)
    await h.start()

    await h.fire('session.receive', command('cmd-3', 'ml-1'), recorder({ text: 'unused' }).next)
    await turnStart(h)
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.verbs('chat:sign-in')).toHaveLength(0)
    expect(h.verbs('session:report')).toHaveLength(0)
  })

  test('session end reaches rt through session:end only', async () => {
    const h = harness()
    await h.start()
    await h.end('prompt_input_exit')
    await flush()

    expect(h.verbs('session:end').map(s => s.body)).toEqual([{ linkId: 'ml-1' }])
    expect(h.verbs('session:report')).toHaveLength(0)
  })
})
