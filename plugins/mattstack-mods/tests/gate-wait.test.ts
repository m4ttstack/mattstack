import { describe, expect, test } from 'claude-code/testing'
import { registerGateWait, type WaitedGate } from '../src/blocks/gate-wait.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder } from './stub.ts'

function gate(over: Partial<WaitedGate> = {}): WaitedGate {
  return {
    id: 'g-1',
    subject: 'run:r-1',
    kind: 'plan',
    status: 'open',
    questions: [{ id: 'ship', label: 'Ship the release?', multi: false, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
    context: 'a long quoted context the model already holds',
    answer: null,
    closedReason: null,
    supersededBy: null,
    ...over,
  }
}

const BY_BOARD = { answers: { ship: 'yes' }, by: 'board', answeredAt: 5 }

/**
 * A scripted daemon: `rows` is the registry gate:wait reads (a terminal row
 * answers at once, an open one times out), and each events:wait round waits
 * on `rounds`.
 */
function harness(rows: Record<string, WaitedGate> = { 'g-1': gate() }) {
  const h = stub()
  const rounds: { body: any; answer: (events: unknown[]) => void; fail: (code: string) => void }[] = []
  h.script.respond = (verb, body) => {
    if (verb === 'events:head') return { ok: true, data: { cursor: 41 } }
    if (verb === 'gate:wait') {
      const row = rows[body.id]
      if (!row) return { ok: false, error: 'not-found' }
      return row.status === 'answered' || row.status === 'closed' ? { ok: true, data: { status: row.status, row } } : { ok: true, data: { status: 'timeout' } }
    }
    if (verb === 'events:wait') {
      return new Promise(resolve => {
        rounds.push({
          body,
          answer: events => resolve({ ok: true, data: { events, cursor: body.after + events.length } }),
          fail: code => resolve({ ok: false, error: code, failure: { code, message: `round failed: ${code}` } }),
        })
      })
    }
    return h.defaults(verb, body)
  }
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerGateWait(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link, rows, rounds }
}

function command(id: string, data: unknown, link = 'ml-1') {
  return { origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="gate-wait" link="${link}">${JSON.stringify(data)}</rt-mod-command>` }
}

async function handOver(h: ReturnType<typeof harness>, id = 'g-1', cmd = 'c-1') {
  const engine = recorder({ text: 'unused' })
  const out = await h.fire('session.receive', command(cmd, { id }), engine.next)
  await flush()
  return { out, engine }
}

const answeredEvent = (id: string) => ({ id: 42, topic: `gate/answered/${id}`, payload: { id }, emittedAt: 6 })
const closedEvent = (id: string) => ({ id: 42, topic: `gate/closed/${id}`, payload: { id }, emittedAt: 6 })

describe('gate-wait', () => {
  test('the handover is acked, then the block waits on the gate from the head of the bus', async () => {
    const h = harness()
    await h.start()
    expect(h.hub.liveBlocks()).toContain('gate-wait')

    const { out, engine } = await handOver(h)

    expect(out).toEqual({ consumed: 'mattstack-mods command gate-wait c-1' })
    expect(engine.seen).toHaveLength(0)
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'c-1' }])
    expect(h.verbs('gate:wait').map(s => s.body)).toEqual([{ id: 'g-1', waitMs: 0 }])
    expect(h.rounds.map(r => r.body)).toEqual([{ pattern: 'gate/{answered,closed}/g-1', after: 41, waitMs: 20_000 }])
    expect(h.submitted).toHaveLength(0)
  })

  test('a handover with no readable gate id is not acked', async () => {
    const h = harness()
    await h.start()
    const engine = recorder({ text: 'unused' })
    await h.fire('session.receive', command('c-1', { gate: 'g-1' }), engine.next)
    await h.fire('session.receive', command('c-2', { id: 'g 1; rm' }), engine.next)
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.rounds).toHaveLength(0)
  })

  test('an answer starts one turn with the answer', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()

    expect(h.submitted).toHaveLength(1)
    const text = h.submitted[0]!.text
    expect(text.startsWith('[gate] gate g-1 was answered by board.')).toBe(true)
    const json = JSON.parse(text.slice(text.indexOf('{')))
    expect(json).toEqual({
      ok: true,
      status: 'answered',
      row: {
        id: 'g-1',
        subject: 'run:r-1',
        kind: 'plan',
        status: 'answered',
        questions: gate().questions,
        answer: BY_BOARD,
        closedReason: null,
        supersededBy: null,
      },
    })
    expect((h.submitted[0] as { asUser?: true }).asUser).toBeUndefined()

    await h.clock.advance(60_000)
    expect(h.rounds).toHaveLength(1)
    expect(h.submitted).toHaveLength(1)
  })

  test('a withdrawn gate starts one turn saying so', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rows['g-1'] = gate({ status: 'closed', closedReason: 'superseded', supersededBy: 'g-2' })
    h.rounds[0]!.answer([closedEvent('g-1')])
    await flush()

    expect(h.submitted.map(s => s.text)).toEqual(['[gate] gate g-1 was withdrawn (superseded by g-2). Its gate wait status is closed.'])
    await h.clock.advance(60_000)
    expect(h.submitted).toHaveLength(1)
  })

  test('an answer that landed before the wait began still starts one turn, with no round', async () => {
    const h = harness({ 'g-1': gate({ status: 'answered', answer: BY_BOARD }) })
    await h.start()
    await handOver(h)

    expect(h.rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(1)
    expect(h.submitted[0]!.text.startsWith('[gate] gate g-1 was answered by board.')).toBe(true)
  })

  test('events for other gates do not end the wait', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rounds[0]!.answer([answeredEvent('g-10')])
    await flush()
    expect(h.submitted).toHaveLength(0)
    expect(h.rounds.map(r => r.body.after)).toEqual([41, 42])
  })

  test('an answer this session gave itself starts no turn', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rows['g-1'] = gate({ status: 'answered', answer: { ...BY_BOARD, by: 'pane', session: 'sess-1' } })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()

    expect(h.submitted).toHaveLength(0)
  })

  test('/clear while waiting keeps the wait through the link continuation', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    await h.clear('sess-2')

    expect(h.verbs('session:register')[1]!.body).toMatchObject({ sessionId: 'sess-2', previousSessionId: 'sess-1', previousLinkId: 'ml-1', blocks: ['gate-wait'] })
    expect(h.link.linkId()).toBe('ml-2')

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()

    expect(h.rounds).toHaveLength(1)
    expect(h.submitted).toHaveLength(1)
    expect(h.submitted[0]!.text.startsWith('[gate] gate g-1 was answered by board.')).toBe(true)
  })

  test('after /clear, an answer the continued session gave itself starts no turn', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    await h.clear('sess-2')

    h.rows['g-1'] = gate({ status: 'answered', answer: { ...BY_BOARD, by: 'pane', session: 'sess-2' } })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()

    expect(h.submitted).toHaveLength(0)
  })

  test('a second handover for a gate already waited on starts no second wait', async () => {
    const h = harness()
    await h.start()
    await handOver(h, 'g-1', 'c-1')
    await handOver(h, 'g-1', 'c-2')

    expect(h.verbs('session:ack').map(s => s.body.id)).toEqual(['c-1', 'c-2'])
    expect(h.rounds).toHaveLength(1)
  })

  test('a session end stops the wait and starts no turn', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    await h.end('prompt_input_exit')

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()
    await h.clock.advance(60_000)

    expect(h.submitted).toHaveLength(0)
    expect(h.rounds).toHaveLength(1)
  })

  test('a submit the engine refuses is tried again, so the answer is not lost', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    let tries = 0
    h.script.submit = input => (++tries === 1 ? new Error('busy') : tries === 2 ? { drop: 'a hook refused it' } : { text: input.text })

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()
    expect(h.submitted).toHaveLength(1)

    await h.clock.advance(10_000)
    expect(h.submitted).toHaveLength(3)
    expect(new Set(h.submitted.map(s => s.text)).size).toBe(1)
    await h.clock.advance(60_000)
    expect(h.submitted).toHaveLength(3)
  })

  test('a wait the daemon will not serve hands the session back to rt gate wait', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rounds[0]!.fail('invalid')
    await flush()

    expect(h.submitted.map(s => s.text)).toEqual([
      '[gate] The wait on gate g-1 was lost (events:wait on gate/{answered,closed}/g-1 failed (invalid): round failed: invalid). Run `rt gate wait g-1` as a background task and end the turn.',
    ])
  })

  test('a gate that no longer exists starts one turn saying so', async () => {
    const h = harness({})
    await h.start()
    await handOver(h, 'g-gone')

    expect(h.rounds).toHaveLength(0)
    expect(h.submitted.map(s => s.text)).toEqual(['[gate] gate g-gone was not found in the registry. Its gate wait status is not found.'])
  })

  test('a gate read that keeps failing hands the session back to rt gate wait', async () => {
    const h = harness()
    await h.start()
    const respond = h.script.respond
    h.script.respond = (verb, body) => (verb === 'gate:wait' ? new Error('connect ECONNREFUSED') : respond(verb, body))
    await handOver(h)
    await h.clock.advance(60_000)

    expect(h.rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(1)
    expect(h.submitted[0]!.text).toContain('Run `rt gate wait g-1` as a background task and end the turn.')
  })
})
