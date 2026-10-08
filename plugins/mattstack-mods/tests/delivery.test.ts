import { describe, expect, test } from 'claude-code/testing'
import { registerDelivery, type DeliveryEdit } from '../src/blocks/delivery.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder, type Respond } from './stub.ts'

function harness(options: Parameters<typeof stub>[0] & { edits?: DeliveryEdit[] } = {}) {
  const h = stub(options)
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerDelivery(hub, link, options.edits ? { edits: options.edits } : {})
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

const BODY = '[#general] max #17: ship it\nreply via rt chat post <room> "..." or rt chat dm max.k3f9 "..." (never SendMessage; this arrived through rt chat)'
/** wrapCrossSession's bytes, as lib/daemon/inbox.ts writes them. */
const envelope = (body = BODY, id = 'd-17-remy', from = 'max (#general)') =>
  `<cross-session-message from-name="${from}" delivery-id="${id}">\n${body}\n</cross-session-message>`
const peer = (text: string) => ({ origin: { kind: 'peer' }, text })

/** The engine beneath the hook: queues what it is handed and answers with that text. */
function engine() {
  const seen: any[] = []
  return { seen, next: async (e: any) => { seen.push(e); return { text: e.text } } }
}

function row(text: string, isExpanded = false, origin: { kind: string } = { kind: 'peer' }) {
  return {
    surface: 'terminal', component: 'UserMessage', requestId: `m-${text.length}-${isExpanded}`,
    props: { text, origin, from: { name: 'max (#general)' }, isExpanded },
  }
}

const HIDDEN = { element: 'Box', props: { children: [] } }

describe('delivery', () => {
  test('an rt delivery is reported delivered once under its delivery id', async () => {
    const h = harness()
    await h.start()
    expect(h.hub.liveBlocks()).toEqual(['delivery'])

    const delivery = peer(envelope())
    const below = engine()
    const result = await h.fire('session.receive', delivery, below.next)
    await flush()

    expect(result).toEqual({ text: delivery.text })
    expect(below.seen).toHaveLength(1)
    expect(h.verbs('session:delivered').map(s => s.body)).toEqual([{ linkId: 'ml-1', deliveryId: 'd-17-remy' }])

    await h.fire('session.receive', peer(envelope()), below.next)
    await flush()
    expect(below.seen).toHaveLength(2)
    expect(h.verbs('session:delivered')).toHaveLength(1)
  })

  test('a non-rt delivery passes through untouched', async () => {
    const h = harness()
    await h.start()

    const others = [
      peer('hello from a peer'),
      peer('<cross-session-message from-name="gate-facility">\nA gate is waiting for you.\n</cross-session-message>'),
      peer(`please look at this: ${envelope()}`),
      { origin: { kind: 'task-notification' }, text: 'a background task finished' },
    ]
    for (const delivery of others) {
      const below = recorder({ text: delivery.text })
      const result = await h.fire('session.receive', delivery, below.next)
      expect(below.seen).toHaveLength(1)
      expect(below.seen[0]).toBe(delivery)
      expect(result).toEqual({ text: delivery.text })
    }
    await flush()
    expect(h.verbs('session:delivered')).toHaveLength(0)

    const drawn = recorder({ element: 'Box', props: { children: ['hello from a peer'] } })
    const shown = row('hello from a peer')
    expect(await h.fire('ui.render', shown, drawn.next)).toEqual({ element: 'Box', props: { children: ['hello from a peer'] } })
    expect(drawn.seen[0]).toBe(shown)
  })

  test('a chat delivery row renders hidden and the model text is unchanged', async () => {
    const h = harness()
    await h.start()

    const delivery = peer(envelope())
    const below = engine()
    await h.fire('session.receive', delivery, below.next)
    expect(below.seen[0]).toBe(delivery)
    expect(below.seen[0].text).toBe(envelope())

    const drawn = recorder({ element: 'Box', props: { children: [BODY] } })
    expect(await h.fire('ui.render', row(BODY), drawn.next)).toEqual(HIDDEN)
    expect(drawn.seen).toHaveLength(0)

    const expanded = row(BODY, true)
    expect(await h.fire('ui.render', expanded, drawn.next)).toEqual({ element: 'Box', props: { children: [BODY] } })
    expect(drawn.seen).toEqual([expanded])

    const typed = row(BODY, false, { kind: 'prompt' })
    expect(await h.fire('ui.render', typed, drawn.next)).toEqual({ element: 'Box', props: { children: [BODY] } })
    expect(drawn.seen).toEqual([expanded, typed])
  })

  test('with the block off nothing is reported', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:register': [{ ok: true, data: { linkId: 'ml-1', blocks: [] } }] })
    await h.start()
    expect(h.hub.liveBlocks()).toEqual([])

    const delivery = peer(envelope())
    const below = recorder({ text: delivery.text })
    await h.fire('session.receive', delivery, below.next)
    await flush()

    expect(below.seen[0]).toBe(delivery)
    expect(h.verbs('session:delivered')).toHaveLength(0)
    const drawn = recorder({ element: 'Box', props: { children: [BODY] } })
    expect(await h.fire('ui.render', row(BODY), drawn.next)).toEqual({ element: 'Box', props: { children: [BODY] } })

    const old = harness({ version: '2.1.292' })
    await old.start()
    await old.fire('session.receive', peer(envelope()), recorder({ text: '' }).next)
    await flush()
    expect(old.sent).toHaveLength(0)
  })

  test('a delivery that a hook beneath consumed is neither reported nor hidden', async () => {
    const h = harness()
    await h.start()

    const result = await h.fire('session.receive', peer(envelope()), async () => ({ consumed: 'another plugin took it' }))
    await flush()

    expect(result).toEqual({ consumed: 'another plugin took it' })
    expect(h.verbs('session:delivered')).toHaveLength(0)
    const drawn = recorder({ element: 'Box', props: { children: [BODY] } })
    expect(await h.fire('ui.render', row(BODY), drawn.next)).toEqual({ element: 'Box', props: { children: [BODY] } })
  })

  test('a report answered unknown-link re-registers and reports once more on the new link', async () => {
    const unknownLink = { ok: false, error: 'unknown link', failure: { code: 'unknown-link', message: 'no live link has that id; register again' } }
    const h = harness()
    h.script.respond = scripted(h, { 'session:delivered': [unknownLink] })
    await h.start()

    await h.fire('session.receive', peer(envelope()), engine().next)
    await flush()

    expect(h.verbs('session:delivered').map(s => s.body)).toEqual([
      { linkId: 'ml-1', deliveryId: 'd-17-remy' },
      { linkId: 'ml-2', deliveryId: 'd-17-remy' },
    ])
  })

  test('a report that never reached rt is sent again when the delivery arrives again', async () => {
    const h = harness()
    h.script.respond = scripted(h, { 'session:delivered': [new Error('ECONNREFUSED')] })
    await h.start()

    await h.fire('session.receive', peer(envelope()), engine().next)
    await flush()
    await h.fire('session.receive', peer(envelope()), engine().next)
    await flush()

    expect(h.verbs('session:delivered')).toHaveLength(2)
  })
})

describe('delivery edits', () => {
  test('an edit changes only the body, keeps the envelope and its closing tag last, and hides the queued row', async () => {
    const h = harness({ edits: [(_api, d) => d.body.replace('ship it', 'ship it now')] })
    await h.start()

    const below = engine()
    const result = await h.fire('session.receive', peer(envelope()), below.next)
    await flush()

    const edited = envelope(BODY.replace('ship it', 'ship it now'))
    expect(below.seen.map(e => e.text)).toEqual([edited])
    expect(below.seen[0].origin).toEqual({ kind: 'peer' })
    expect(result).toEqual({ text: edited })
    expect(edited.endsWith('</cross-session-message>')).toBe(true)
    expect(h.verbs('session:delivered').map(s => s.body.deliveryId)).toEqual(['d-17-remy'])

    const drawn = recorder({ element: 'Box', props: { children: [] } })
    expect(await h.fire('ui.render', row(BODY.replace('ship it', 'ship it now')), drawn.next)).toEqual(HIDDEN)
    expect(drawn.seen).toHaveLength(0)
  })

  test('edits see the sender and delivery id and run in order', async () => {
    const seen: unknown[] = []
    const h = harness({
      edits: [
        (_api, d) => { seen.push({ from: d.from, deliveryId: d.deliveryId }); return `${d.body} one` },
        async (_api, d) => `${d.body} two`,
      ],
    })
    await h.start()

    const below = engine()
    await h.fire('session.receive', peer(envelope()), below.next)

    expect(seen).toEqual([{ from: 'max (#general)', deliveryId: 'd-17-remy' }])
    expect(below.seen[0].text).toBe(envelope(`${BODY} one two`))
  })

  test('an edit that leaves the body as it was passes the original event on', async () => {
    const h = harness({ edits: [(_api, d) => d.body] })
    await h.start()

    const delivery = peer(envelope())
    const below = engine()
    await h.fire('session.receive', delivery, below.next)

    expect(below.seen[0]).toBe(delivery)
  })

  test('an edit that throws passes the original through and clears the block', async () => {
    const h = harness({ edits: [() => { throw new Error('boom') }] })
    await h.start()

    const delivery = peer(envelope())
    const below = engine()
    const result = await h.fire('session.receive', delivery, below.next)
    await flush()

    expect(below.seen).toEqual([delivery])
    expect(result).toEqual({ text: delivery.text })
    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.verbs('session:delivered')).toHaveLength(0)
  })
})
