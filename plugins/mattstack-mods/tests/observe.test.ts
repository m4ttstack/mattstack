import { describe, expect, test } from 'claude-code/testing'
import { registerObserve } from '../src/blocks/observe.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerObserve(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

const ASK = { tool: 'AskUserQuestion', tool_use_id: 'tu-1', questions: [{ question: 'Ship it?', header: 'Ship', options: [], multiSelect: false }] }
const STOP = { session_id: 'sess-1', transcript_path: '/t.jsonl', cwd: '/repo', hook_event_name: 'Stop', stop_hook_active: false }
const SHELL_TASK = { id: 'b-1', type: 'shell', status: 'running', description: 'sleep 600', command: 'sleep 600' }

const turnStart = (h: ReturnType<typeof stub>) => h.fire('turn.start', { text: 'go', turnId: 't-1' }, async () => ({ turnId: 't-1' }))
const turnEnd = (h: ReturnType<typeof stub>, extra: Record<string, unknown> = {}) =>
  h.fire('turn.complete', { answer: '', durationMs: 5, isAborted: false, turnId: 't-1', reason: 'answer', ...extra }, async () => ({ text: '' }))
const stop = (h: ReturnType<typeof stub>, tasks?: unknown[]) =>
  h.fire('classic.Stop', { ...STOP, ...(tasks && { background_tasks: tasks }) }, async () => ({}))
const nudge = (id: string, link: string, data: unknown) =>
  ({ origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="nudge" link="${link}">${JSON.stringify(data)}</rt-mod-command>` })
const observations = (h: ReturnType<typeof stub>) =>
  h.verbs('session:report').filter(s => s.body.event === 'observation').map(s => s.body.observation)

describe('observe', () => {
  test('turn start reports working, and a turn end reports idle with the background work its Stop saw', async () => {
    const h = harness()
    await h.start()
    expect(h.hub.liveBlocks()).toEqual(['observe'])

    await turnStart(h)
    await stop(h, [SHELL_TASK])
    await turnEnd(h)
    await flush()
    await turnStart(h)
    await stop(h, [])
    await turnEnd(h)
    await flush()

    expect(h.verbs('session:report').map(s => s.body)).toEqual([
      { event: 'observation', observation: { execution: 'working', background: 'unknown' }, linkId: 'ml-1' },
      { event: 'observation', observation: { execution: 'idle', background: 'active' }, linkId: 'ml-1' },
      { event: 'observation', observation: { execution: 'working', background: 'unknown' }, linkId: 'ml-1' },
      { event: 'observation', observation: { execution: 'idle', background: 'inactive' }, linkId: 'ml-1' },
    ])
  })

  test('a turn end whose Stop said nothing of background work reports it unknown', async () => {
    const h = harness()
    await h.start()
    await turnStart(h)
    await turnEnd(h)
    await flush()

    expect(observations(h)).toEqual([
      { execution: 'working', background: 'unknown' },
      { execution: 'idle', background: 'unknown' },
    ])
  })

  test("a subagent's turn end is not the session's", async () => {
    const h = harness()
    await h.start()
    await turnStart(h)
    await turnEnd(h, { agentId: 'a-1' })
    await flush()

    expect(observations(h)).toEqual([{ execution: 'working', background: 'unknown' }])
  })

  test('a question form on screen reports blocked, and working again once it is answered', async () => {
    const h = harness()
    await h.start()
    await turnStart(h)
    let answer: (v: unknown) => void = () => {}
    const shown = new Promise(resolve => { answer = resolve })
    const call = h.fire('tool.call', ASK, () => shown)
    await flush()
    expect(observations(h)).toEqual([
      { execution: 'working', background: 'unknown' },
      { execution: 'blocked', background: 'unknown' },
    ])

    answer({ result: { answers: { 'Ship it?': 'Yes' } } })
    expect(await call).toEqual({ result: { answers: { 'Ship it?': 'Yes' } } })
    await flush()
    expect(observations(h).at(-1)).toEqual({ execution: 'working', background: 'unknown' })
  })

  test('the session end is left to the link: rt reads it from session:end', async () => {
    const h = harness()
    await h.start()
    await h.end('prompt_input_exit')
    await flush()

    expect(observations(h)).toEqual([])
    expect(h.verbs('session:end').map(s => s.body)).toEqual([{ linkId: 'ml-1' }])
  })

  test('a nudge is acked and starts a turn with its text as this plugin\'s message', async () => {
    const h = harness()
    await h.start()

    const engine = recorder({ text: 'unused' })
    const result = await h.fire('session.receive', nudge('cmd-1', 'ml-1', { text: 'watchdog: idle 3m. Consume it or post status.' }), engine.next)
    await flush()

    expect(result.consumed).toBeDefined()
    expect(engine.seen).toHaveLength(0)
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'cmd-1' }])
    expect(h.submitted).toEqual([{ text: 'watchdog: idle 3m. Consume it or post status.' }])
  })

  test('a nudge with no text is not acked, so rt falls back', async () => {
    const h = harness()
    await h.start()

    await h.fire('session.receive', nudge('cmd-2', 'ml-1', {}), recorder({ text: 'unused' }).next)
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.submitted).toHaveLength(0)
  })

  test('without the block live nothing is reported and a nudge is not acked', async () => {
    const h = harness()
    h.script.respond = (verb, body) =>
      verb === 'session:register' ? { ok: true, data: { linkId: 'ml-1', blocks: [] } } : h.defaults(verb, body)
    await h.start()

    await turnStart(h)
    await h.fire('session.receive', nudge('cmd-3', 'ml-1', { text: 'hi' }), recorder({ text: 'unused' }).next)
    await flush()

    expect(h.verbs('session:report')).toHaveLength(0)
    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.submitted).toHaveLength(0)
  })
})
