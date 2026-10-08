import { describe, expect, test } from 'claude-code/testing'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink, ROUND_MS } from '../src/core/link.ts'
import { PLUGIN_VERSION } from '../src/core/version.ts'
import { flush, harness as stub, recorder, type Respond } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  hub.block('delivery', async () => {})
  hub.block('presence', async () => {})
  attachHub(h.on, hub)
  return { ...h, hub, link }
}

/** Answers each verb from its own queue first, then from the stub's defaults. */
function scripted(h: ReturnType<typeof stub>, queues: Record<string, (Respond | Record<string, unknown> | Error)[]>): Respond {
  return (verb, body) => {
    const next = queues[verb]?.shift()
    if (next === undefined) return h.defaults(verb, body)
    return typeof next === 'function' ? next(verb, body) : next
  }
}

const unknownLink = { ok: false, error: 'unknown link', failure: { code: 'unknown-link', message: 'no live link has that id; register again' } }
const never = () => new AbortController().signal

describe('link', () => {
  test('registers on start with the live blocks', async () => {
    const h = harness({ env: { RT_DAEMON_SOCK: '/sbx/rt.sock', HERDR_PANE_ID: 'w1:p1' } })
    await h.start()

    const registers = h.verbs('session:register')
    expect(registers).toHaveLength(1)
    expect(registers[0]!.socketPath).toBe('/sbx/rt.sock')
    expect(registers[0]!.body).toEqual({
      sessionId: 'sess-1', cwd: '/repo', root: '/repo', pane: 'w1:p1',
      claudeCode: '2.1.293', plugin: PLUGIN_VERSION, blocks: ['delivery', 'presence'],
    })
    expect(h.link.linkId()).toBe('ml-1')
    expect(h.state.get('linkId')).toBe('ml-1')
    expect(h.state.get('context')).toEqual({
      sessionId: 'sess-1', linkId: 'ml-1', cwd: '/repo', root: '/repo', pane: 'w1:p1', blocks: ['delivery', 'presence'],
    })
  })

  test('without RT_DAEMON_SOCK the socket is the one under HOME', async () => {
    const h = harness()
    await h.start()

    expect(h.verbs('session:register')[0]!.socketPath).toBe('/home/u/.mattstack/rt/rt.sock')
    expect(h.verbs('session:register')[0]!.body.pane).toBeUndefined()
  })

  test('re-registers after classic.SessionStart source clear with previousSessionId', async () => {
    const h = harness()
    await h.start()
    await h.clear('sess-2')

    const registers = h.verbs('session:register')
    expect(registers).toHaveLength(2)
    expect(registers[1]!.body).toMatchObject({
      sessionId: 'sess-2', previousSessionId: 'sess-1', previousLinkId: 'ml-1', blocks: ['delivery', 'presence'],
    })
    expect(h.link.linkId()).toBe('ml-2')
    expect(h.state.get('context')).toMatchObject({ sessionId: 'sess-2', linkId: 'ml-2' })
  })

  test('heartbeats every 10 s from $.clock.every', async () => {
    const h = harness()
    await h.start()

    expect(h.clock.intervals()).toEqual([10_000])
    await h.clock.advance(9_999)
    expect(h.verbs('session:heartbeat')).toHaveLength(0)
    await h.clock.advance(1)
    expect(h.verbs('session:heartbeat').map(s => s.body)).toEqual([{ linkId: 'ml-1' }])
    await h.clock.advance(10_000)
    expect(h.verbs('session:heartbeat')).toHaveLength(2)
  })

  test('ends on session end, except reason clear', async () => {
    const h = harness()
    await h.start()
    await h.end('prompt_input_exit')

    expect(h.verbs('session:end').map(s => s.body)).toEqual([{ linkId: 'ml-1' }])
    expect(h.link.linkId()).toBeNull()
    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.state.get('linkId')).toBeNull()
    expect(h.clock.intervals()).toEqual([])
    await h.clock.advance(30_000)
    expect(h.verbs('session:heartbeat')).toHaveLength(0)

    const cleared = harness()
    await cleared.start()
    await cleared.end('clear')
    expect(cleared.verbs('session:end')).toHaveLength(0)
    expect(cleared.link.linkId()).toBe('ml-1')
  })

  test('session.end with reason clear keeps the link and heartbeat until the classic.SessionStart source clear re-registration', async () => {
    const h = harness()
    await h.start()
    await h.end('clear')

    await h.clock.advance(10_000)
    expect(h.verbs('session:heartbeat').map(s => s.body)).toEqual([{ linkId: 'ml-1' }])

    await h.clear('sess-2')
    expect(h.verbs('session:register')[1]!.body).toMatchObject({ sessionId: 'sess-2', previousSessionId: 'sess-1', previousLinkId: 'ml-1' })
    await h.clock.advance(10_000)
    expect(h.verbs('session:heartbeat').map(s => s.body)).toEqual([{ linkId: 'ml-1' }, { linkId: 'ml-2' }])
    expect(h.verbs('session:end')).toHaveLength(0)
    expect(h.clock.intervals()).toEqual([10_000])
  })

  test('reports resume and compact for its own session with session:report', async () => {
    const h = harness({ env: { HERDR_PANE_ID: 'w1:p1' } })
    await h.start()
    await h.sessionStart('resume')
    await h.sessionStart('compact')
    await h.sessionStart('startup')
    await h.sessionStart('fork')

    expect(h.verbs('session:report').map(s => s.body)).toEqual([
      { linkId: 'ml-1', event: 'resume', context: { cwd: '/repo', root: '/repo', pane: 'w1:p1' } },
      { linkId: 'ml-1', event: 'compact', context: { cwd: '/repo', root: '/repo', pane: 'w1:p1' } },
    ])
  })

  test('sends no report for another session id, before a link, or after the session ended', async () => {
    const h = harness()
    await h.sessionStart('resume')
    await h.start()
    await h.sessionStart('resume', 'sess-other')
    await h.end('other')
    await h.sessionStart('compact')

    expect(h.verbs('session:report')).toHaveLength(0)
  })

  test('a report answered unknown-link re-registers and reports once more on the new link', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:report': [unknownLink] })
    await h.start()
    await h.sessionStart('compact')

    expect(h.verbs('session:register')).toHaveLength(2)
    expect(h.verbs('session:report').map(s => s.body.linkId)).toEqual(['ml-1', 'ml-2'])
    expect(h.link.linkId()).toBe('ml-2')
  })

  test('a wait chains rounds of at most 25 s and passes the cursor', async () => {
    const h = harness()
    h.script.respond = scripted(h, {
      'events:wait': [
        { ok: true, data: { events: [], cursor: 105 } },
        { ok: true, data: { events: [{ id: 106, topic: 'gate/g1' }], cursor: 106 } },
        { ok: true, data: { events: [{ id: 107, topic: 'gate/g1' }], cursor: 107 } },
      ],
    })
    await h.start()

    const got = await h.link.wait('gate/g1', 100, events => events.length >= 2, never())

    expect(got).toEqual({ cursor: 107, events: [{ id: 106, topic: 'gate/g1' }, { id: 107, topic: 'gate/g1' }] })
    const rounds = h.verbs('events:wait').map(s => s.body)
    expect(rounds.map(r => r.after)).toEqual([100, 105, 106])
    for (const round of rounds) {
      expect(round.pattern).toBe('gate/g1')
      expect(round.waitMs).toBeLessThanOrEqual(25_000)
    }
    expect(ROUND_MS).toBeLessThanOrEqual(25_000)
  })

  test('ECONNRESET retries the round with the same cursor', async () => {
    const h = harness()
    h.script.respond = scripted(h, {
      'events:wait': [
        new Error('ECONNRESET: socket hang up'),
        { ok: true, data: { events: [{ id: 101, topic: 'gate/g1' }], cursor: 101 } },
      ],
    })
    await h.start()

    const waiting = h.link.wait('gate/g1', 100, events => events.length > 0, never())
    await h.clock.advance(5_000)
    const got = await waiting

    expect(got).toEqual({ cursor: 101, events: [{ id: 101, topic: 'gate/g1' }] })
    expect(h.verbs('events:wait').map(s => s.body.after)).toEqual([100, 100])
  })

  test('an unknown-link answer to a heartbeat or a wait re-registers with the same session id and blocks', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:heartbeat': [unknownLink] })
    await h.start()
    await h.clock.advance(10_000)

    const registers = h.verbs('session:register').map(s => s.body)
    expect(registers).toHaveLength(2)
    expect(registers[1]).toEqual(registers[0])
    expect(h.link.linkId()).toBe('ml-2')
    await h.clock.advance(10_000)
    expect(h.verbs('session:heartbeat').map(s => s.body)).toEqual([{ linkId: 'ml-1' }, { linkId: 'ml-2' }])

    const w = harness()
    w.script.respond = scripted(w, {
      'events:wait': [unknownLink, { ok: true, data: { events: [{ id: 9 }], cursor: 9 } }],
    })
    await w.start()
    const got = await w.link.wait('gate/g1', 8, events => events.length > 0, never())

    expect(got).toEqual({ cursor: 9, events: [{ id: 9 }] })
    expect(w.verbs('events:wait').map(s => s.body.after)).toEqual([8, 8])
    const again = w.verbs('session:register').map(s => s.body)
    expect(again).toHaveLength(2)
    expect(again[1]).toEqual(again[0])
    expect(w.link.linkId()).toBe('ml-2')
  })

  test('a refused register leaves every block off', async () => {
    const h = harness()
    h.script.respond = scripted(h, {
      'session:register': [{ ok: false, error: 'agent integrations are off', failure: { code: 'refused', message: 'agent integrations are off' } }],
    })
    await h.start()

    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.link.linkId()).toBeNull()
    await h.clock.advance(30_000)
    expect(h.verbs('session:register')).toHaveLength(1)
    expect(h.verbs('session:heartbeat')).toHaveLength(0)
  })

  test('the blocks the daemon answers are the ones kept live', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:register': [{ ok: true, data: { linkId: 'ml-9', blocks: [] } }] })
    await h.start()

    expect(h.link.linkId()).toBe('ml-9')
    expect(h.hub.liveBlocks()).toEqual([])
  })

  test('a register the daemon could not take retries on the next beat with the same payload', async () => {
    const h = harness()
    h.script.respond = scripted(h, {
      'session:register': [
        new Error('ENOENT: no such file or directory'),
        { ok: false, error: 'busy', failure: { code: 'transient', message: 'busy' } },
      ],
    })
    await h.start()
    expect(h.link.linkId()).toBeNull()

    await h.clock.advance(10_000)
    await h.clock.advance(10_000)

    const registers = h.verbs('session:register').map(s => s.body)
    expect(registers).toHaveLength(3)
    expect(registers[1]).toEqual(registers[0])
    expect(registers[2]).toEqual(registers[0])
    expect(h.link.linkId()).toBe('ml-1')
    expect(h.verbs('session:heartbeat')).toHaveLength(0)
  })

  test('a session with no blocks started never registers', async () => {
    const h = harness()
    await h.start(false)
    await h.clock.advance(30_000)

    expect(h.sent).toHaveLength(0)
  })

  test('a command delivery is consumed, routed to its handler and acked with session:ack', async () => {
    const h = harness()
    let acked: () => void = () => {}
    const ackArrived = new Promise<void>(resolve => { acked = resolve })
    h.script.respond = scripted(h, {
      'session:ack': [(verb, body) => (acked(), h.defaults(verb, body))],
    })
    const handled: unknown[] = []
    const ackedBeforeHandler: number[] = []
    h.link.onCommand('gate.complete', async cmd => {
      ackedBeforeHandler.push(h.verbs('session:ack').length)
      handled.push(cmd)
    })
    await h.start()

    const engine = recorder({ text: 'unused' })
    const result = await h.fire(
      'session.receive',
      { origin: { kind: 'peer' }, text: '<rt-mod-command id="cmd-1" kind="gate.complete" link="ml-1">{"gate":"g1"}</rt-mod-command>' },
      engine.next,
    )
    await ackArrived

    expect(result.consumed).toBeDefined()
    expect(engine.seen).toHaveLength(0)
    await flush()
    expect(handled).toEqual([{ id: 'cmd-1', kind: 'gate.complete', data: { gate: 'g1' } }])
    expect(ackedBeforeHandler).toEqual([1])
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'cmd-1' }])
  })

  test('a command with no handler, or whose block is not live, is consumed and never acked', async () => {
    const h = harness()
    let ran = false
    h.link.onCommand('gate.complete', async () => {
      ran = true
    }, 'gate-form')
    await h.start()

    for (const kind of ['gate.complete', 'unheard-of']) {
      const engine = recorder({ text: 'unused' })
      const result = await h.fire(
        'session.receive',
        { origin: { kind: 'peer' }, text: `<rt-mod-command id="c-${kind}" kind="${kind}" link="ml-1">{}</rt-mod-command>` },
        engine.next,
      )
      expect(result.consumed).toBeDefined()
      expect(engine.seen).toHaveLength(0)
    }
    await flush()

    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(ran).toBe(false)
  })

  test('a command whose handler fails was still acked when it was accepted', async () => {
    const h = harness()
    h.link.onCommand('nudge', async () => {
      throw new Error('boom')
    })
    await h.start()

    const engine = recorder({ text: 'unused' })
    const result = await h.fire('session.receive', { origin: { kind: 'peer' }, text: '<rt-mod-command id="n-1" kind="nudge" link="ml-1">{}</rt-mod-command>' }, engine.next)
    await flush()

    expect(result.consumed).toBeDefined()
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'n-1' }])
    expect(h.logs.some(l => l.to === 'debug' && l.text.includes('nudge n-1 failed after its ack: boom'))).toBe(true)
  })

  test('a block cleared mod-side is dropped daemon-side by a re-register with the remaining blocks', async () => {
    const h = stub()
    const hub = createHub()
    const link = createLink(hub)
    link.start()
    hub.block('delivery', async () => {})
    hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('boom') } })
    })
    hub.block('presence', async () => {})
    attachHub(h.on, hub)
    await h.start()
    expect(h.verbs('session:register')[0]!.body.blocks).toEqual(['delivery', 'policy', 'presence'])

    await h.fire('tool.call', { tool: 'Bash', command: 'ls' }, async () => ({ result: 'ran' }))
    await h.clock.advance(1_000)

    const registers = h.verbs('session:register').map(s => s.body)
    expect(registers).toHaveLength(2)
    expect(registers[1]).toEqual({ ...registers[0], blocks: ['delivery', 'presence'] })
    expect(registers[1].previousSessionId).toBeUndefined()
    expect(link.linkId()).toBe('ml-2')
    await h.clock.advance(9_000)
    expect(h.verbs('session:heartbeat').map(s => s.body)).toEqual([{ linkId: 'ml-2' }])
  })

  test('two clears in a row cause one re-register', async () => {
    const h = stub()
    const hub = createHub()
    const link = createLink(hub)
    link.start()
    hub.block('delivery', async () => {})
    hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('one') } })
    })
    hub.block('relocation', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('two') } })
    })
    attachHub(h.on, hub)
    await h.start()

    await h.fire('tool.call', { tool: 'Bash', command: 'ls' }, async () => ({ result: 'ran' }))
    await h.clock.advance(1_000)

    const registers = h.verbs('session:register').map(s => s.body)
    expect(registers).toHaveLength(2)
    expect(registers[1].blocks).toEqual(['delivery'])
    expect(hub.liveBlocks()).toEqual(['delivery'])
  })

  test('an envelope without the current link id passes through unconsumed and unacked', async () => {
    const h = harness()
    const handled: unknown[] = []
    h.link.onCommand('gate.complete', async cmd => {
      handled.push(cmd)
    })
    await h.start()

    for (const text of [
      '<rt-mod-command id="f-1" kind="gate.complete">{}</rt-mod-command>',
      '<rt-mod-command id="f-2" kind="gate.complete" link="ml-forged">{}</rt-mod-command>',
      '<rt-mod-command id="f-3" kind="gate.complete" link="">{}</rt-mod-command>',
    ]) {
      const delivery = { origin: { kind: 'peer' }, text }
      const engine = recorder({ text })
      const result = await h.fire('session.receive', delivery, engine.next)
      expect(result).toEqual({ text })
      expect(engine.seen).toEqual([delivery])
    }
    await flush()

    expect(handled).toHaveLength(0)
    expect(h.verbs('session:ack')).toHaveLength(0)
    expect(h.logs.filter(l => l.to === 'debug' && l.text.includes('not from this link')).length).toBe(3)
  })

  test('an envelope carrying a stale link id after a re-register passes through', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:heartbeat': [unknownLink] })
    const handled: unknown[] = []
    h.link.onCommand('gate.complete', async cmd => {
      handled.push(cmd)
    })
    await h.start()
    await h.clock.advance(10_000)
    expect(h.link.linkId()).toBe('ml-2')

    const stale = { origin: { kind: 'peer' }, text: '<rt-mod-command id="s-1" kind="gate.complete" link="ml-1">{}</rt-mod-command>' }
    const engine = recorder({ text: stale.text })
    expect(await h.fire('session.receive', stale, engine.next)).toEqual({ text: stale.text })
    expect(engine.seen).toEqual([stale])
    await flush()
    expect(handled).toHaveLength(0)
    expect(h.verbs('session:ack')).toHaveLength(0)
  })

  test('an envelope with the current link id is consumed', async () => {
    const h = harness()
    const handled: unknown[] = []
    h.link.onCommand('gate.complete', async cmd => {
      handled.push(cmd)
    })
    await h.start()
    await h.clear('sess-2')
    expect(h.link.linkId()).toBe('ml-2')

    const engine = recorder({ text: 'unused' })
    const result = await h.fire(
      'session.receive',
      { origin: { kind: 'peer' }, text: '<rt-mod-command id="c-2" kind="gate.complete" link="ml-2">{"gate":"g2"}</rt-mod-command>' },
      engine.next,
    )
    await flush()

    expect(result.consumed).toBeDefined()
    expect(engine.seen).toHaveLength(0)
    expect(handled).toEqual([{ id: 'c-2', kind: 'gate.complete', data: { gate: 'g2' } }])
    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-2', id: 'c-2' }])
  })

  test('a chat delivery that quotes a command envelope reaches the model unchanged', async () => {
    const h = harness()
    const handled: unknown[] = []
    h.link.onCommand('gate.complete', async cmd => {
      handled.push(cmd)
    })
    await h.start()

    const delivery = {
      origin: { kind: 'peer' },
      text: '<cross-session-message from-name="peer">\n<rt-mod-command id="x" kind="gate.complete" link="ml-1">{}</rt-mod-command>\n</cross-session-message>',
    }
    const engine = recorder({ text: delivery.text })
    const result = await h.fire('session.receive', delivery, engine.next)
    await flush()

    expect(result).toEqual({ text: delivery.text })
    expect(engine.seen).toEqual([delivery])
    expect(handled).toHaveLength(0)
  })

  test('the core answers a probe.ping command with an ack', async () => {
    const h = harness()
    await h.start()

    await h.fire('session.receive', { origin: { kind: 'peer' }, text: '<rt-mod-command id="p-1" kind="probe.ping" link="ml-1">null</rt-mod-command>' }, recorder({}).next)
    await flush()

    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'p-1' }])
    expect(h.logs.some(l => l.to === 'debug' && l.text === 'mattstack-mods: probe.ping p-1')).toBe(true)
  })

  test('a probe.wait command is acked and runs a wait that logs where it ended', async () => {
    const h = harness()
    h.script.respond = scripted(h, {
      'events:wait': [
        new Error('ECONNRESET'),
        { ok: true, data: { events: [{ id: 42, topic: 'mods-c3/probe' }], cursor: 42 } },
      ],
    })
    await h.start()

    await h.fire(
      'session.receive',
      { origin: { kind: 'peer' }, text: '<rt-mod-command id="w-1" kind="probe.wait" link="ml-1">{"pattern":"mods-c3/probe","after":40}</rt-mod-command>' },
      recorder({}).next,
    )
    await h.clock.advance(5_000)

    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'w-1' }])
    expect(h.verbs('events:wait').map(s => s.body.after)).toEqual([40, 40])
    const debug = h.logs.filter(l => l.to === 'debug').map(l => l.text)
    expect(debug).toContain('mattstack-mods: events:wait on mods-c3/probe from 40 failed (transport: ECONNRESET); retrying from the same cursor')
    expect(debug).toContain('mattstack-mods: probe.wait on mods-c3/probe from 40 ended at cursor 42 with 1 event(s)')
  })

  test('an aborted wait rejects and sends no further round', async () => {
    const h = harness()
    let release: (reply: Record<string, unknown>) => void = () => {}
    h.script.respond = scripted(h, {
      'events:wait': [() => new Promise(resolve => { release = resolve })],
    })
    await h.start()

    const abort = new AbortController()
    const waiting = h.link.wait('gate/g1', 1, () => true, abort.signal)
    await flush()
    abort.abort(new Error('answered in the dialog'))
    let thrown: unknown
    try {
      await waiting
    } catch (err) {
      thrown = err
    }
    release({ ok: true, data: { events: [], cursor: 1 } })
    await flush()

    expect((thrown as Error).message).toBe('answered in the dialog')
    expect(h.verbs('events:wait')).toHaveLength(1)
  })
})
