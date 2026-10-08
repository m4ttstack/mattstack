import { describe, expect, test } from 'claude-code/testing'
import { answeredText, registerGateWait, type WaitedGate } from '../src/blocks/gate-wait.ts'
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
    origin: { presentation: 'wait', session: 'sess-1' },
    answer: null,
    closedReason: null,
    supersededBy: null,
    consumedAt: null,
    ...over,
  }
}

/** A gate rt stamped as the mod's to wake, the way gate:ask does once the handover is acked. */
const stamped = (over: Partial<WaitedGate> = {}) => gate({ origin: { presentation: 'wait', session: 'sess-1', wake: 'mod' }, ...over })

const BY_BOARD = { answers: { ship: 'yes' }, by: 'board', answeredAt: 5 }
const terminal = (row: WaitedGate) => row.status === 'answered' || row.status === 'closed'

/**
 * A scripted daemon over one registry, `rows`:
 * - gate:wait answers a terminal row at once and times an open one out, and
 *   consumes a woken gate re-read under its asking session's id, as rt does;
 * - gate:list answers the session's own wait gates, in one page;
 * - each events:wait round waits on `rounds`.
 */
function daemon(h: ReturnType<typeof stub>, rows: Record<string, WaitedGate>) {
  const rounds: { body: any; answer: (events: unknown[]) => void; fail: (code: string) => void }[] = []
  h.script.respond = (verb, body) => {
    if (verb === 'events:head') return { ok: true, data: { cursor: 41 } }
    if (verb === 'gate:wait') {
      const row = rows[body.id]
      if (!row) return { ok: false, error: 'not-found' }
      if (!terminal(row)) return { ok: true, data: { status: 'timeout' } }
      if (body.sessionId && row.origin?.wake === 'mod' && row.origin.session === body.sessionId) row.consumedAt ??= 99
      return { ok: true, data: { status: row.status, row } }
    }
    if (verb === 'gate:list') {
      const gates = Object.values(rows).filter(r => r.origin?.session === body.session && r.origin?.presentation === body.presentation)
      return { ok: true, data: { gates, cursor: 0 } }
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
  return rounds
}

/** One plugin process: a fresh hub, link and block over the stub's engine. */
function plugin(h: ReturnType<typeof stub>) {
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerGateWait(hub, link)
  attachHub(h.on, hub)
  return { hub, link }
}

function harness(rows: Record<string, WaitedGate> = { 'g-1': gate() }) {
  const h = stub()
  const rounds = daemon(h, rows)
  const { hub, link } = plugin(h)
  return { ...h, hub, link, rows, rounds }
}

const DEADLINE = 1_000_000 + 5_000

function command(id: string, data: unknown, link = 'ml-1') {
  return { origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="gate-wait" link="${link}">${JSON.stringify(data)}</rt-mod-command>` }
}

async function handOver(h: ReturnType<typeof harness>, id = 'g-1', cmd = 'c-1', deadline: number = DEADLINE) {
  const engine = recorder({ text: 'unused' })
  const out = await h.fire('session.receive', command(cmd, { id, deadline }), engine.next)
  await flush()
  return { out, engine }
}

const answeredEvent = (id: string) => ({ id: 42, topic: `gate/answered/${id}`, payload: { id }, emittedAt: 6 })
const closedEvent = (id: string) => ({ id: 42, topic: `gate/closed/${id}`, payload: { id }, emittedAt: 6 })
const consumes = (h: ReturnType<typeof harness>) => h.verbs('gate:wait').filter(s => s.body.sessionId !== undefined).map(s => s.body)

describe('gate-wait', () => {
  test('the handover is acked, then the block waits on the gate from the head of the bus', async () => {
    const h = harness()
    await h.start()
    expect(h.hub.liveBlocks()).toContain('gate-wait')

    const { out, engine } = await handOver(h)

    expect(out).toEqual({ consumed: 'mattstack-mods command gate-wait c-1' })
    expect(engine.seen).toHaveLength(0)
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'c-1' }])
    expect(h.rounds.map(r => r.body)).toEqual([{ pattern: 'gate/{answered,closed}/g-1', after: 41, waitMs: 20_000 }])
    expect(h.submitted).toHaveLength(0)
  })

  test('a handover with no readable gate id or no deadline is not acked', async () => {
    const h = harness()
    await h.start()
    const engine = recorder({ text: 'unused' })
    await h.fire('session.receive', command('c-1', { gate: 'g-1', deadline: DEADLINE }), engine.next)
    await h.fire('session.receive', command('c-2', { id: 'g 1; rm', deadline: DEADLINE }), engine.next)
    await h.fire('session.receive', command('c-3', { id: 'g-1' }), engine.next)
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.rounds).toHaveLength(0)
  })

  test('a gate-wait command delivered after its deadline is not acked and starts no wait', async () => {
    const h = harness()
    await h.start()
    await handOver(h, 'g-1', 'c-late', 1_000_000 - 1)
    await handOver(h, 'g-1', 'c-at-the-wire', 1_000_000 + 500)

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.rounds).toHaveLength(0)
    expect(h.verbs('events:head')).toHaveLength(0)
  })

  test('a failed ack starts no wait', async () => {
    const h = harness()
    await h.start()
    const respond = h.script.respond
    h.script.respond = (verb, body) => (verb === 'session:ack' ? new Error('connect ECONNREFUSED') : respond(verb, body))
    await handOver(h)
    await h.clock.advance(60_000)

    expect(h.verbs('session:ack')).toHaveLength(1)
    expect(h.verbs('events:head')).toHaveLength(0)
    expect(h.rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(0)
  })

  test("a handover for another session's gate starts no wait", async () => {
    const h = harness({ 'g-1': gate({ origin: { presentation: 'wait', session: 'sess-9' } }) })
    await h.start()
    await handOver(h)
    await h.clock.advance(60_000)

    expect(h.rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(0)
  })

  test('an answer starts one turn with the answer, and the gate is then read as delivered', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()

    expect(h.submitted).toHaveLength(1)
    const text = h.submitted[0]!.text
    expect(text.startsWith('[gate] gate g-1 was answered by board: ship = yes. Its gate wait result: {')).toBe(true)
    const json = JSON.parse(text.slice(text.indexOf('Its gate wait result: ') + 'Its gate wait result: '.length))
    // No questions: the session asked them itself, and the gate protocol reads only the answer.
    expect(json).toEqual({
      ok: true,
      status: 'answered',
      row: {
        id: 'g-1',
        subject: 'run:r-1',
        kind: 'plan',
        status: 'answered',
        answer: BY_BOARD,
        closedReason: null,
        supersededBy: null,
      },
    })
    expect((h.submitted[0] as { asUser?: true }).asUser).toBeUndefined()
    expect(consumes(h)).toEqual([{ id: 'g-1', waitMs: 0, sessionId: 'sess-1' }])

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
    expect(h.submitted[0]!.text.startsWith('[gate] gate g-1 was answered by board: ship = yes. Its gate wait result: {')).toBe(true)
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
    expect(consumes(h)).toEqual([{ id: 'g-1', waitMs: 0, sessionId: 'sess-1' }])
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
    expect(h.submitted[0]!.text.startsWith('[gate] gate g-1 was answered by board: ship = yes. Its gate wait result: {')).toBe(true)
    expect(consumes(h)).toEqual([{ id: 'g-1', waitMs: 0, sessionId: 'sess-1' }])
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

  test('a submit the engine refuses keeps being asked again, at most 30 s apart, until it goes through', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    let tries = 0
    h.script.submit = input => (++tries < 8 ? (tries % 2 ? new Error('busy') : { drop: 'a hook refused it' }) : { text: input.text })

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await flush()
    expect(h.submitted).toHaveLength(1)

    // 1, 2, 4, 8, 16, then 30 and 30 s apart.
    await h.clock.advance(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000 - 1)
    expect(h.submitted).toHaveLength(6)
    await h.clock.advance(1)
    expect(h.submitted).toHaveLength(7)
    await h.clock.advance(30_000)
    expect(h.submitted).toHaveLength(8)
    expect(new Set(h.submitted.map(s => s.text)).size).toBe(1)
    expect(consumes(h)).toHaveLength(1)

    await h.clock.advance(600_000)
    expect(h.submitted).toHaveLength(8)
  })

  test('a submit that keeps failing stops being asked at session end', async () => {
    const h = harness()
    await h.start()
    await handOver(h)
    h.script.submit = () => new Error('busy')

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[0]!.answer([answeredEvent('g-1')])
    await h.clock.advance(600_000)
    const asked = h.submitted.length
    expect(asked).toBeGreaterThan(20)

    await h.end('prompt_input_exit')
    await h.clock.advance(600_000)
    expect(h.submitted).toHaveLength(asked)
    expect(consumes(h)).toHaveLength(0)
  })

  test('a wait the daemon will not serve is retried from the head of the bus', async () => {
    const h = harness()
    await h.start()
    await handOver(h)

    h.rounds[0]!.fail('invalid')
    await flush()
    expect(h.submitted).toHaveLength(0)
    await h.clock.advance(1_000)
    expect(h.verbs('events:head')).toHaveLength(2)
    expect(h.rounds).toHaveLength(2)

    h.rows['g-1'] = gate({ status: 'answered', answer: BY_BOARD })
    h.rounds[1]!.answer([answeredEvent('g-1')])
    await flush()
    expect(h.submitted).toHaveLength(1)
  })

  test('a gate read that keeps failing is retried until it is read', async () => {
    const h = harness()
    await h.start()
    const respond = h.script.respond
    let down = true
    h.script.respond = (verb, body) => (down && verb === 'gate:list' ? new Error('connect ECONNREFUSED') : respond(verb, body))
    await handOver(h)
    await h.clock.advance(120_000)
    expect(h.rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(0)

    down = false
    await h.clock.advance(20_000)
    expect(h.rounds.map(r => r.body.pattern)).toEqual(['gate/{answered,closed}/g-1'])
  })

  test('a gate that no longer exists starts one turn saying so', async () => {
    const h = harness({})
    await h.start()
    await handOver(h, 'g-gone')

    expect(h.rounds).toHaveLength(0)
    expect(h.submitted.map(s => s.text)).toEqual(['[gate] gate g-gone was not found in the registry. Its gate wait status is not found.'])
  })

  test('waits resume after a block restart for wake-mod gates only', async () => {
    const h = stub()
    const rows: Record<string, WaitedGate> = {
      'g-mod': stamped({ id: 'g-mod' }),
      'g-own-wait': gate({ id: 'g-own-wait' }),
      'g-read': stamped({ id: 'g-read', status: 'answered', answer: BY_BOARD, consumedAt: 7 }),
      'g-other': stamped({ id: 'g-other', origin: { presentation: 'wait', session: 'sess-9', wake: 'mod' } }),
    }
    const rounds = daemon(h, rows)
    plugin(h)
    await h.start()
    await flush()

    expect(h.verbs('gate:list').every(s => s.body.session === 'sess-1' && s.body.presentation === 'wait')).toBe(true)
    expect(rounds.map(r => r.body.pattern)).toEqual(['gate/{answered,closed}/g-mod'])
    expect(h.submitted).toHaveLength(0)

    rows['g-mod'] = stamped({ id: 'g-mod', status: 'answered', answer: BY_BOARD })
    rounds[0]!.answer([answeredEvent('g-mod')])
    await flush()
    expect(h.submitted).toHaveLength(1)
    expect(h.submitted[0]!.text.startsWith('[gate] gate g-mod was answered by board: ship = yes. Its gate wait result: {')).toBe(true)
  })

  test('an answer that landed during the gap is delivered once on resume', async () => {
    const h = stub()
    const rows: Record<string, WaitedGate> = { 'g-1': stamped({ status: 'answered', answer: BY_BOARD }) }
    const rounds = daemon(h, rows)
    plugin(h)
    await h.start()
    await flush()

    expect(rounds).toHaveLength(0)
    expect(h.submitted).toHaveLength(1)
    expect(rows['g-1']!.consumedAt).not.toBeNull()

    // Another reload of the plugin in the same session, then a re-register.
    plugin(h)
    await h.start()
    await flush()
    expect(h.submitted).toHaveLength(1)
  })
})

describe('the answered wake text', () => {
  const answered = (answers: Record<string, unknown>) => answeredText(gate({ status: 'answered', answer: { answers, by: 'pane-person', answeredAt: 5 } }))

  test('one summary line names each answer: values joined, a note on one line, then the result with no questions', () => {
    const text = answered({
      'findings-1': ['f1', 'f3'],
      'findings-2': [],
      outcome: { value: 'comment', note: 'post after\nthe tag ships' },
    })
    const [summary, json] = text.split('. Its gate wait result: ')
    expect(summary).toBe(
      "[gate] gate g-1 was answered by this session's pane, by a person: findings-1 = f1, f3; findings-2 = ; outcome = comment (note: post after the tag ships)",
    )
    expect(JSON.parse(json!).row).not.toHaveProperty('questions')
    expect(JSON.parse(json!).row.answer.answers['findings-1']).toEqual(['f1', 'f3'])

    const long = answered({ q: { value: 'yes', note: 'n'.repeat(300) } })
    expect(long.split('. Its gate wait result: ')[0]!.endsWith(`(note: ${'n'.repeat(119)}…)`)).toBe(true)
  })

  test('the summary is clipped near 400 characters, and an answer with no answers says only who', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`question-${i}`, `value-${i}`]))
    const [summary] = answered(many).split('. Its gate wait result: ')
    expect(summary!.length).toBeLessThanOrEqual(400)
    expect(summary!.endsWith('…')).toBe(true)

    expect(answered({}).startsWith("[gate] gate g-1 was answered by this session's pane, by a person. Its gate wait result: {")).toBe(true)
  })
})
