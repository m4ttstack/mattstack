import { describe, expect, test } from 'claude-code/testing'
import { createDisplay, FORM_PANE_ID } from '../src/blocks/display.ts'
import { matchGate, registerGateForm, type GateRow } from '../src/blocks/gate-form.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { flush, harness as stub, recorder } from './stub.ts'

const QUESTION = 'Ship the release?'
const ASK = {
  tool: 'AskUserQuestion',
  tool_use_id: 'tu-1',
  questions: [
    {
      question: QUESTION,
      header: 'Ship',
      options: [
        { label: 'Yes', description: 'tag and publish' },
        { label: 'No', description: 'hold' },
      ],
      multiSelect: false,
    },
  ],
}

function gate(over: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g-1',
    status: 'open',
    questions: [{ id: 'ship', label: QUESTION, multi: false, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
    answer: null,
    closedReason: null,
    ...over,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A scripted daemon: `open` is what gate:list answers with open: true, `rows`
 * what it answers otherwise, and each events:wait round waits on `rounds`.
 */
function harness(daemon: { open?: GateRow[]; rows?: GateRow[] } = {}) {
  const h = stub()
  const state = { open: daemon.open ?? [gate()], rows: daemon.rows ?? [gate()] }
  const rounds: { body: any; answer: (events: unknown[]) => void }[] = []
  h.script.respond = (verb, body) => {
    if (verb === 'events:head') return { ok: true, data: { cursor: 41 } }
    if (verb === 'gate:list') return { ok: true, data: { gates: body.open ? state.open : state.rows, cursor: 0 } }
    if (verb === 'events:wait') {
      return new Promise(resolve => {
        rounds.push({ body, answer: events => resolve({ ok: true, data: { events, cursor: body.after + events.length } }) })
      })
    }
    return h.defaults(verb, body)
  }
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  registerGateForm(hub, link)
  attachHub(h.on, hub)
  return { ...h, hub, link, state, rounds }
}

/** The engine beneath: the dialog, settled by the test, with the call's own abort signal. */
function dialog() {
  const shown: any[] = []
  const answer = deferred<any>()
  const abort = new AbortController()
  const next = Object.assign(
    async (e: any) => {
      shown.push(e)
      return answer.promise
    },
    { signal: abort.signal },
  )
  return { shown, answer, abort, next }
}

const ANSWERED_BY_PANE = { result: { questions: ASK.questions, answers: { [QUESTION]: 'Yes' } } }

function command(id: string, data: unknown) {
  return { origin: { kind: 'peer' }, text: `<rt-mod-command id="${id}" kind="gate-complete" link="ml-1">${JSON.stringify(data)}</rt-mod-command>` }
}

function row(text: string, isExpanded = false) {
  return {
    surface: 'terminal',
    component: 'UserMessage',
    requestId: `m-${text.length}`,
    props: { text, origin: { kind: 'peer' }, from: { name: 'gate-facility' }, isExpanded },
  }
}

describe('gate-form', () => {
  test('an AskUserQuestion with no matching live form gate passes through untouched', async () => {
    const h = harness({ open: [gate({ questions: [{ id: 'other', label: 'Rename the branch?', options: ['a', 'b'] }] })] })
    await h.start()
    expect(h.hub.liveBlocks()).toContain('gate-form')

    const engine = recorder(ANSWERED_BY_PANE)
    const result = await h.fire('tool.call', ASK, engine.next)

    expect(result).toEqual(ANSWERED_BY_PANE)
    expect(engine.seen).toEqual([ASK])
    expect(h.verbs('gate:list').map(s => s.body)).toEqual([{ open: true, session: 'sess-1', presentation: 'form' }])
    expect(h.verbs('events:wait')).toHaveLength(0)
  })

  test('two open form gates with overlapping labels each link to their own question', async () => {
    const ship = gate({ id: 'g-ship' })
    const short = gate({ id: 'g-short', questions: [{ id: 'q', label: 'Ship', options: ['a', 'b'] }] })
    const wider = gate({
      id: 'g-wider',
      questions: [
        { id: 'ship', label: QUESTION, options: ['yes', 'no'] },
        { id: 'targets', label: 'Which targets?', multi: true, options: ['mac', 'linux'] },
      ],
    })
    const gates = [ship, short, wider]
    expect(matchGate(gates, [{ question: QUESTION }])?.id).toBe('g-ship')
    expect(matchGate(gates, [{ question: 'Ship' }])?.id).toBe('g-short')
    expect(matchGate(gates, [{ question: 'Ship the release?' }, { question: 'Which targets?' }])?.id).toBe('g-wider')
    expect(matchGate(gates, [{ question: 'Ship it now, after the freeze?' }])?.id).toBe('g-short')
    expect(matchGate([ship, short], [{ question: `Context: the freeze ends today. ${QUESTION}` }])?.id).toBe('g-ship')
    expect(matchGate(gates, [{ question: QUESTION }, { question: QUESTION }])).toBeNull()

    const h = harness({ open: gates })
    await h.start()
    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    expect(h.rounds.map(r => r.body.pattern)).toEqual(['gate/{answered,closed}/g-ship'])
    d.answer.resolve(ANSWERED_BY_PANE)
    await call
  })

  test('a pane answer goes through and is recorded as a pane answer', async () => {
    const h = harness()
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    expect(d.shown).toEqual([ASK])
    expect(h.rounds.map(r => r.body)).toEqual([{ pattern: 'gate/{answered,closed}/g-1', after: 41, waitMs: 20_000 }])

    d.answer.resolve(ANSWERED_BY_PANE)
    expect(await call).toEqual(ANSWERED_BY_PANE)
    await flush()
    // The block records nothing: the model's own gate_answer after the form, by pane, is the one record.
    expect(h.sent.filter(s => s.verb.startsWith('gate:') && s.verb !== 'gate:list')).toHaveLength(0)
    expect(h.verbs('gate:list')).toHaveLength(1)
  })

  test('a board answer committed first closes the dialog with that answer', async () => {
    const answered = gate({ status: 'answered', answer: { answers: { ship: 'no' }, by: 'board' } })
    const h = harness({ rows: [answered] })
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    h.rounds[0]!.answer([{ id: 42, topic: 'gate/answered/g-1', payload: { id: 'g-1' }, emittedAt: 1 }])

    expect(await call).toEqual({
      result: { questions: ASK.questions, answers: { [QUESTION]: 'No' } },
      context: ['[gate] g-1 was answered by board while this form was open: the answers above are its recorded answers, and the gate is already answered.'],
    })
    expect(h.verbs('gate:list').map(s => s.body)).toEqual([
      { open: true, session: 'sess-1', presentation: 'form' },
      { session: 'sess-1', presentation: 'form' },
    ])
    expect(h.hub.liveBlocks()).toContain('gate-form')
  })

  test("racing answers: the dialog shows the row's winner", async () => {
    // The event names the board; the gate service committed the console's answer first.
    const winner = gate({ status: 'answered', answer: { answers: { ship: { value: 'yes', note: 'after the freeze' } }, by: 'console' } })
    const h = harness({ rows: [winner] })
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    h.rounds[0]!.answer([{ id: 42, topic: 'gate/answered/g-1', payload: { id: 'g-1', answer: { by: 'board', answers: { ship: 'no' } } }, emittedAt: 1 }])
    await flush()
    // The person's pick lands after the event: it lost the gate service's race.
    d.answer.resolve(ANSWERED_BY_PANE)

    const result = await call
    expect(result.result.answers).toEqual({ [QUESTION]: 'Yes (after the freeze)' })
    expect(result.context[0]).toContain('answered by console')
  })

  test('a superseded gate closes the dialog as withdrawn', async () => {
    const h = harness({ rows: [gate({ status: 'closed', closedReason: 'superseded' })] })
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    h.rounds[0]!.answer([{ id: 42, topic: 'gate/closed/g-1', payload: { id: 'g-1', reason: 'superseded' }, emittedAt: 1 }])

    expect(await call).toEqual({
      result: { questions: ASK.questions, answers: {} },
      context: ['[gate] g-1 was superseded by a newer gate while this form was open; nothing was answered here. Re-read the registry and proceed.'],
    })
  })

  test('an interrupt during the dialog stops the gate wait', async () => {
    const h = harness()
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    expect(h.rounds).toHaveLength(1)

    const interrupted = new Error('interrupted')
    d.abort.abort(interrupted)
    d.answer.reject(interrupted)
    let thrown: unknown
    try {
      await call
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBe(interrupted)

    // The pending round comes back with nothing; no further round is asked for.
    h.rounds[0]!.answer([])
    await h.clock.advance(5_000)
    expect(h.rounds).toHaveLength(1)
    expect(h.verbs('gate:list')).toHaveLength(1)
    expect(h.hub.liveBlocks()).toContain('gate-form')
  })

  test('a gate whose dialog the person dismissed is not acked, so rt rings its doorbell, which shows', async () => {
    const h = harness()
    await h.start()
    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    const dismissed = new Error('dismissed')
    d.abort.abort(dismissed)
    d.answer.reject(dismissed)
    await call.catch(() => {})

    const engine = recorder({ text: 'unused' })
    await h.fire('session.receive', command('c-1', { id: 'g-1' }), engine.next)
    await flush()
    expect(h.verbs('session:ack')).toHaveLength(0)

    const drawn = recorder({ element: 'Box', props: { children: ['drawn'] } })
    await h.fire('ui.render', row('[gate] g-1 answered by board; re-read the registry and proceed on the recorded answer.'), drawn.next)
    expect(drawn.seen).toHaveLength(1)
  })

  test('a dialog the engine resolves as declined counts as dismissed: not acked, and its doorbell shows', async () => {
    // Claude Code 2.1.293 resolves next(e) on Escape ("User declined to answer
    // questions"); it does not reject. Both resolved shapes count as declined.
    const declined = [
      { isError: true, result: 'User declined to answer questions', text: 'User declined to answer questions' },
      { result: { questions: ASK.questions, answers: {} } },
      { deny: 'declined' },
    ]
    for (const shape of declined) {
      const h = harness()
      await h.start()
      const d = dialog()
      const call = h.fire('tool.call', ASK, d.next)
      await flush()
      d.answer.resolve(shape)
      expect(await call).toEqual(shape)

      const engine = recorder({ text: 'unused' })
      await h.fire('session.receive', command('c-1', { id: 'g-1' }), engine.next)
      await flush()
      expect(h.verbs('session:ack'), JSON.stringify(shape)).toHaveLength(0)

      const drawn = recorder({ element: 'Box', props: { children: ['drawn'] } })
      await h.fire('ui.render', row('[gate] g-1 answered by board; re-read the registry and proceed on the recorded answer.'), drawn.next)
      expect(drawn.seen, JSON.stringify(shape)).toHaveLength(1)
    }
  })

  test('once the dialog settles the block asks for no further wait round', async () => {
    const h = harness()
    await h.start()
    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    expect(h.rounds).toHaveLength(1)
    d.answer.resolve(ANSWERED_BY_PANE)
    await call
    // The round in flight cannot be cut ($.http.fetch takes no signal); when it
    // comes back, nothing follows it.
    h.rounds[0]!.answer([])
    await h.clock.advance(30_000)
    expect(h.rounds).toHaveLength(1)
  })

  test('gate-complete is acked for a linked gate even after its dialog closed', async () => {
    const h = harness()
    await h.start()

    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    d.answer.resolve(ANSWERED_BY_PANE)
    await call

    const engine = recorder({ text: 'unused' })
    expect(await h.fire('session.receive', command('c-1', { id: 'g-1' }), engine.next)).toEqual({ consumed: 'mattstack-mods command gate-complete c-1' })
    await h.fire('session.receive', command('c-2', { id: 'g-unlinked' }), engine.next)
    await h.fire('session.receive', command('c-3', { gate: 'g-1' }), engine.next)
    await flush()

    expect(h.verbs('session:ack').map(s => s.body)).toEqual([{ linkId: 'ml-1', id: 'c-1' }])
    expect(engine.seen).toHaveLength(0)
  })

  test('leftover "[gate] answered" rows are hidden', async () => {
    const h = harness()
    await h.start()
    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    d.answer.resolve(ANSWERED_BY_PANE)
    await call

    const HIDDEN = { element: 'Box', props: { children: [] } }
    const drawn = recorder({ element: 'Box', props: { children: ['drawn'] } })
    const linked = [
      '[gate] g-1 answered by board; re-read the registry and proceed on the recorded answer.',
      '[gate] g-1 answered by another surface; re-read the registry and proceed on the recorded answer.',
      '[gate] g-1 superseded by a newer gate; re-read the registry and proceed.',
    ]
    for (const text of linked) expect(await h.fire('ui.render', row(text), drawn.next)).toEqual(HIDDEN)
    expect(drawn.seen).toHaveLength(0)

    const shown = [
      row('[gate] g-other answered by board; re-read the registry and proceed on the recorded answer.'),
      row(linked[0]!, true),
      { ...row(linked[0]!), props: { ...row(linked[0]!).props, origin: { kind: 'prompt' } } },
      row('[gate] g-1 is now answered by board (form, owner human); re-read the gate registry.'),
    ]
    for (const r of shown) await h.fire('ui.render', r, drawn.next)
    expect(drawn.seen).toHaveLength(shown.length)
  })

  test("a linked gate's doorbell is handed to the model and then recorded read, so the sweep does not re-ring", async () => {
    const h = harness()
    await h.start()
    const d = dialog()
    const call = h.fire('tool.call', ASK, d.next)
    await flush()
    d.answer.resolve({ isError: true, result: 'User declined to answer questions' })
    await call

    const phrase = '[gate] g-1 answered by board; re-read the registry and proceed on the recorded answer.'
    const doorbell = { origin: { kind: 'peer' }, text: `<cross-session-message from-name="gate-facility">\n${phrase}\n</cross-session-message>` }
    const engine = recorder({ text: doorbell.text })
    expect(await h.fire('session.receive', doorbell, engine.next)).toEqual({ text: doorbell.text })
    await flush()
    expect(engine.seen).toEqual([doorbell])
    expect(h.verbs('gate:wait').map(s => s.body)).toEqual([{ id: 'g-1', waitMs: 0, sessionId: 'sess-1' }])

    // Not linked, not a doorbell, or consumed beneath: nothing is recorded.
    const other = { origin: { kind: 'peer' }, text: doorbell.text.replace('g-1', 'g-other') }
    await h.fire('session.receive', other, recorder({ text: other.text }).next)
    await h.fire('session.receive', { origin: { kind: 'peer' }, text: '[gate] g-1 is now answered by board (form, owner human); re-read the gate registry.' }, recorder({ text: 'x' }).next)
    await h.fire('session.receive', doorbell, recorder({ consumed: 'muted' }).next)
    await flush()
    expect(h.verbs('gate:wait')).toHaveLength(1)
  })

  test('the display kit asks a gate in a focused pane and answers it', async () => {
    const h = stub()
    const hub = createHub()
    const display = createDisplay(hub)
    attachHub(h.on, hub)
    const opened: unknown[] = []
    const closed: string[] = []
    let redraws = 0
    h.$.ui.open = async (pane: unknown) => (opened.push(pane), { isPlaced: true })
    h.$.ui.close = async ({ id }: { id: string }) => {
      closed.push(id)
      await h.fire('ui.close', { id, origin: { kind: 'plugin' } }, async () => {})
    }
    h.$.ui.invalidate = () => void redraws++
    h.$.ui.resolve = () => ({
      Box: (props: any) => ({ element: 'Box', props }),
      Text: (props: any) => ({ element: 'Text', props }),
      Button: (props: any) => ({ element: 'Button', props }),
      Input: (props: any) => ({ element: 'Input', props }),
    })
    const api = { ui: { open: h.$.ui.open, close: (id: string) => h.$.ui.close({ id }), redraw: h.$.ui.invalidate, log: () => {} } } as any
    const pane = { surface: 'terminal', component: 'Pane', requestId: FORM_PANE_ID, props: {} }
    const draw = async () => (await h.fire('ui.render', pane, async () => ({ element: 'Box', props: { children: [] } }))).props.children
    const press = async (key: string) => (await draw()).find((c: any) => c.props.key === key).props.onPress({})

    const asked = display.formPane(api, {
      id: 'g-2',
      questions: [
        { id: 'ship', label: QUESTION, options: [{ value: 'yes', label: 'Yes' }, 'no'] },
        { id: 'targets', label: 'Which targets?', multi: true, options: ['mac', 'linux', 'win'] },
      ],
    })
    await flush()
    expect(opened).toEqual([{ id: FORM_PANE_ID, title: 'Gate', focus: true, closeOnEscape: true }])
    const first = await draw()
    expect(first.map((c: any) => c.props.label ?? c.props.children?.[0] ?? c.props.key)).toEqual([
      `${QUESTION} (1 of 2)`,
      'Yes',
      'no',
      'note',
      'Skip',
    ])
    expect(first[1].props.hotkey).toBe('1')

    await press('option-0')
    await press('option-0')
    await press('option-2')
    await press('done')

    expect(await asked).toEqual({ ship: 'yes', targets: ['mac', 'win'] })
    expect(closed).toEqual([FORM_PANE_ID])
    expect(redraws).toBe(3)

    const skipped = display.formPane(api, { id: 'g-3', questions: [{ id: 'q', label: 'Anything?', options: [] }] })
    await flush()
    await h.fire('ui.close', { id: FORM_PANE_ID, origin: { kind: 'person' } }, async () => {})
    expect(await skipped).toBeNull()
  })
})
