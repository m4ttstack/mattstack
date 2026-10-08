import { describe, expect, test } from 'claude-code/testing'
import { PANEL_BY, PANEL_PANE_ID, registerGatePanel } from '../src/blocks/gate-panel.ts'
import { registerGateForm } from '../src/blocks/gate-form.ts'
import { registerGateWait, type WaitedGate } from '../src/blocks/gate-wait.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'
import { byKey, flush, harness as stub, recorder, texts, walk } from './stub.ts'

const QUESTION = 'Ship the release?'

function gate(over: Partial<WaitedGate> = {}): WaitedGate {
  return {
    id: 'g-1',
    subject: 'herd:h-1/j1',
    kind: 'question',
    status: 'open',
    questions: [{ id: 'ship', label: QUESTION, multi: false, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
    context: 'why the worker asks',
    origin: { presentation: 'wait', session: 'sess-1' },
    answer: null,
    closedReason: null,
    supersededBy: null,
    consumedAt: null,
    ...over,
  }
}

/** Bun.Glob's `*` and `{a,b}`, as rt's event bus matches a topic. */
function matches(pattern: string, topic: string): boolean {
  const source = pattern
    .replace(/[.+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]*)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${source}$`).test(topic)
}

type Options = { filters?: boolean }

/**
 * A scripted daemon over one registry, `rows`:
 * - gate:list narrows on open, session and presentation, as C9's rt does
 *   (`filters: false` is a daemon that ignores them);
 * - gate:answer records the answer and emits gate/answered/<id>;
 * - gate:wait answers a terminal row at once and times an open one out;
 * - each events:wait round waits until a topic its pattern matches is emitted.
 */
function daemon(h: ReturnType<typeof stub>, rows: Record<string, WaitedGate>, options: Options = {}) {
  const rounds: { body: any; settled: boolean; answer: (events: unknown[]) => void }[] = []
  let seq = 41
  function emit(topic: string): void {
    seq += 1
    for (const round of rounds) {
      if (round.settled || !matches(round.body.pattern, topic)) continue
      round.settled = true
      round.answer([{ id: seq, topic, payload: {}, emittedAt: seq }])
    }
  }
  h.script.respond = (verb, body) => {
    if (verb === 'events:head') return { ok: true, data: { cursor: seq } }
    if (verb === 'gate:list') {
      const filtered = options.filters === false
      const gates = Object.values(rows).filter(
        r =>
          filtered ||
          ((!body.open || r.status === 'open') &&
            (body.session === undefined || r.origin?.session === body.session) &&
            (body.presentation === undefined || r.origin?.presentation === body.presentation)),
      )
      return { ok: true, data: { gates, cursor: 0 } }
    }
    if (verb === 'gate:answer') {
      const row = rows[body.id]
      if (!row) return { ok: false, error: 'not-found' }
      if (row.status === 'closed') return { ok: false, error: 'gate-closed' }
      if (row.status === 'answered') return { ok: true, data: { row, conflict: true } }
      row.status = 'answered'
      row.answer = { answers: body.answers, by: body.by, answeredAt: 7, ...(body.session && { session: body.session }) }
      emit(`gate/answered/${row.id}`)
      return { ok: true, data: { row } }
    }
    if (verb === 'gate:wait') {
      const row = rows[body.id]
      if (!row) return { ok: false, error: 'not-found' }
      if (row.status !== 'answered' && row.status !== 'closed') return { ok: true, data: { status: 'timeout' } }
      return { ok: true, data: { status: row.status, row } }
    }
    if (verb === 'events:wait') {
      return new Promise(resolve => {
        rounds.push({
          body,
          settled: false,
          answer: events => resolve({ ok: true, data: { events, cursor: body.after + events.length } }),
        })
      })
    }
    return h.defaults(verb, body)
  }
  return { rounds, emit }
}

function harness(rows: Record<string, WaitedGate> = { 'g-1': gate() }, options: Options & { wait?: boolean; form?: boolean } = {}) {
  const h = stub()
  const bus = daemon(h, rows, options)
  const opened: any[] = []
  const closed: string[] = []
  h.$.ui.open = async (pane: unknown) => (opened.push(pane), { isPlaced: true })
  h.$.ui.close = async ({ id }: { id: string }) => {
    closed.push(id)
    await h.fire('ui.close', { id, origin: { kind: 'plugin' } }, async () => {})
  }
  h.$.ui.invalidate = () => {}
  h.$.ui.focus = async () => ({})
  h.$.ui.scroll = async () => ({})
  h.$.ui.resolve = () => ({
    Box: (props: any) => ({ element: 'Box', props }),
    Text: (props: any) => ({ element: 'Text', props }),
    Button: (props: any) => ({ element: 'Button', props }),
    Input: (props: any) => ({ element: 'Input', props }),
  })
  const hub = createHub()
  const link = createLink(hub)
  link.start()
  const dialogs = options.form ? registerGateForm(hub, link) : undefined
  if (options.wait) registerGateWait(hub, link)
  registerGatePanel(hub, link, dialogs)
  attachHub(h.on, hub)

  const engineBand = { element: 'Box', props: { children: ['engine band'] } }
  /** A band render; `envelope` adds event fields beside the props, such as `viewport`. */
  const band = (over: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) =>
    h.fire(
      'ui.render',
      {
        surface: 'terminal',
        component: 'AbovePrompt',
        requestId: 'band',
        ...envelope,
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, ...over },
      },
      async () => engineBand,
    )
  /** The band row's Button, or null when the block passed the band through. */
  const rowButton = async (): Promise<any | null> => {
    const drawn = await band()
    if (drawn === engineBand) return null
    return walk(drawn).find((c: any) => c.element === 'Button') ?? null
  }
  /** The band row's summary of the gate it names: the text after the title. */
  const summary = async (): Promise<string | undefined> => texts(await band())[1]
  const pane = async (): Promise<any> =>
    h.fire('ui.render', { surface: 'terminal', component: 'Pane', requestId: PANEL_PANE_ID, props: { bodyColumns: 40 } }, async () => ({
      element: 'Box',
      props: { children: [] },
    }))
  const press = async (key: string) => {
    byKey(await pane(), key).props.onPress({})
    await flush()
  }
  const turnEnd = async () => {
    await h.fire('turn.complete', { sessionId: h.session.id }, async () => ({}))
    await flush()
  }
  /** Esc in the focused pane: a person's close, as `closeOnEscape` makes it. */
  const escape = async () => {
    await h.fire('ui.close', { id: PANEL_PANE_ID, origin: { kind: 'person' } }, async () => {})
    await flush()
  }
  return { ...h, hub, link, rows, ...bus, opened, closed, band, rowButton, summary, pane, press, escape, turnEnd, engineBand }
}

const answers = (h: ReturnType<typeof harness>) => h.verbs('gate:answer').map(s => s.body)

describe('gate-panel', () => {
  test("the row shows only the session's own open quiet gates", async () => {
    const h = harness({
      'g-1': gate(),
      'g-done': gate({ id: 'g-done', status: 'answered', answer: { answers: { ship: 'no' }, by: 'board', answeredAt: 1 } }),
    })
    await h.start()
    await flush()

    expect(h.hub.liveBlocks()).toContain('gate-panel')
    expect(h.verbs('gate:list').map(s => s.body)).toEqual([{ open: true, session: 'sess-1' }])
    const button = await h.rowButton()
    expect(button.props).toMatchObject({ label: 'Answer', hotkey: '1', plain: true })
    const drawn = walk(await h.band()).filter((e: any) => e.element === 'Text')
    expect(drawn.map((t: any) => [t.props.children[0], t.props.color, t.props.bold ?? false])).toEqual([
      ['Waiting on your answer', 'suggestion', true],
      [`question herd:h-1/j1 · ${QUESTION}`, 'text', false],
    ])
    expect(JSON.stringify(await h.band())).not.toContain('more waiting')

    await h.band({ hasSurvey: true }).then(out => expect(out).toBe(h.engineBand))
    expect(texts(await h.band({ bodyColumns: 40 }))).toEqual(['Waiting on your answer', 'ques…'])
    const narrow = await h.band({ bodyColumns: 30 })
    expect(texts(narrow)).toEqual(['Waiting on your answer'])
    expect(walk(narrow).find((e: any) => e.element === 'Button').props.hotkey).toBe('1')

    // One gate of several questions counts them; a review gate names its MR.
    h.rows['g-1']!.kind = 'review-post'
    h.rows['g-1']!.subject = 'mr:https://gitlab.example.com/acme/web/-/merge_requests/146045'
    h.rows['g-1']!.questions = [...h.rows['g-1']!.questions, { id: 'more', label: 'And then?', options: ['a'] }]
    await h.turnEnd()
    expect(texts(await h.band({ bodyColumns: 120 }))[1]).toBe(`review-post !146045 · 2 questions · ${QUESTION}`)
  })

  test("a herd worker's herd_ask gate shows in its band row", async () => {
    // What herd:ask opens for a worker with a pane and at most 4 options: a
    // form presentation stamped with the worker's session, never drawn as a dialog.
    const herdGate = gate({
      id: 'g-herd',
      subject: 'herd:h-1/job-a',
      kind: 'question',
      origin: { paneId: 'w9:p1', presentation: 'form', session: 'sess-1' } as WaitedGate['origin'],
    })
    const h = harness({ 'g-herd': herdGate }, { form: true })
    await h.start()
    await flush()

    expect(await h.summary()).toBe(`question herd:h-1/job-a · ${QUESTION}`)
    ;(await h.rowButton()).props.onPress({})
    await flush()
    await h.press('option-1')
    expect(answers(h)).toEqual([{ id: 'g-herd', answers: { ship: 'no' }, by: 'pane-person' }])
  })

  test('a form gate that was never drawn is listed', async () => {
    const h = harness({ 'g-form': gate({ id: 'g-form', origin: { presentation: 'form', session: 'sess-1' } }) }, { form: true })
    await h.start()
    await flush()

    expect(await h.summary()).toBe(`question herd:h-1/j1 · ${QUESTION}`)
  })

  test('a gate whose form dialog is up is not listed', async () => {
    const h = harness(
      {
        'g-form': gate({ id: 'g-form', origin: { presentation: 'form', session: 'sess-1' } }),
        'g-wait': gate({ id: 'g-wait', questions: [{ id: 'q', label: 'Rename the branch?', multi: false, options: ['a', 'b'] }] }),
      },
      { form: true },
    )
    await h.start()
    await flush()
    expect(await h.summary()).toBe(`question herd:h-1/j1 · ${QUESTION}`)

    let dismiss!: (out: unknown) => void
    const shown = new Promise(resolve => (dismiss = resolve))
    const next = Object.assign(async () => shown, { signal: new AbortController().signal })
    const ask = {
      tool: 'AskUserQuestion',
      tool_use_id: 'tu-1',
      questions: [{ question: QUESTION, header: 'Ship', options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }], multiSelect: false }],
    }
    const call = h.fire('tool.call', ask, next)
    await flush()

    expect(await h.summary()).toBe('question herd:h-1/j1 · Rename the branch?')
    expect(JSON.stringify(await h.band())).not.toContain('more waiting')

    dismiss({ isError: true, result: 'User declined to answer questions' })
    await call
    await flush()
    expect(await h.summary()).toBe(`question herd:h-1/j1 · ${QUESTION}`)
  })

  test('a gate asked by another session on a reused pane id is not shown', async () => {
    const other = gate({ id: 'g-other', origin: { presentation: 'wait', session: 'sess-9', paneId: 'w1:p1' } as WaitedGate['origin'] })
    const h = harness({ 'g-other': other }, { filters: false })
    await h.start()
    await flush()

    const asked = h.verbs('gate:list').map(s => s.body)
    expect(asked).toEqual([{ open: true, session: 'sess-1' }])
    expect(JSON.stringify(asked)).not.toContain('pane')
    expect(await h.rowButton()).toBeNull()
  })

  test('a gate the session opens shows once its turn ends', async () => {
    const h = harness({})
    await h.start()
    await flush()
    expect(await h.rowButton()).toBeNull()

    h.rows['g-1'] = gate()
    await h.turnEnd()

    expect(await h.summary()).toBe(`question herd:h-1/j1 · ${QUESTION}`)
  })

  test('the row disappears when the gate is answered elsewhere or withdrawn', async () => {
    const h = harness({ 'g-1': gate(), 'g-2': gate({ id: 'g-2', questions: [{ id: 'q', label: 'Rename the branch?', multi: false, options: ['a', 'b'] }] }) })
    await h.start()
    await flush()
    expect(h.rounds.map(r => r.body.pattern).sort()).toEqual(['gate/*/g-1', 'gate/*/g-2'])
    expect(await h.summary()).toBe(`question herd:h-1/j1 · ${QUESTION}`)
    const both = await h.band()
    expect(both.props.children[1].props).toEqual({ color: 'inactive', children: ['1 more waiting after this one'] })

    // The pane is open on g-1 when the board answers it.
    ;(await h.rowButton()).props.onPress({})
    await flush()
    expect(h.opened).toEqual([{ id: PANEL_PANE_ID, title: 'Gate', focus: true, closeOnEscape: true, columns: 34 }])
    h.rows['g-1']!.status = 'answered'
    h.rows['g-1']!.answer = { answers: { ship: 'no' }, by: 'board', answeredAt: 3 }
    h.emit('gate/answered/g-1')
    await flush()

    expect(h.closed).toEqual([PANEL_PANE_ID])
    expect(await h.summary()).toBe('question herd:h-1/j1 · Rename the branch?')

    h.rows['g-2']!.status = 'closed'
    h.rows['g-2']!.closedReason = 'superseded'
    h.emit('gate/closed/g-2')
    await flush()

    expect(await h.rowButton()).toBeNull()
    expect(answers(h)).toEqual([])
    // Refreshed by the gates' own events, never by a timer.
    const lists = h.verbs('gate:list').length
    await h.clock.advance(600_000)
    expect(h.verbs('gate:list').length).toBe(lists)
  })

  test('an answer in the pane records by pane-person and wakes the session through its usual path', async () => {
    const h = harness({ 'g-1': gate({ origin: { presentation: 'wait', session: 'sess-1', wake: 'mod' } }) }, { wait: true })
    await h.start()
    await flush()
    // gate-wait resumed its wait on the stamped gate; gate-panel watches it too.
    expect(h.rounds.map(r => r.body.pattern).sort()).toEqual(['gate/*/g-1', 'gate/{answered,closed}/g-1'])

    ;(await h.rowButton()).props.onPress({})
    await flush()
    const drawn = await h.pane()
    expect(texts(drawn)).toContain(QUESTION)
    expect(walk(drawn).filter((e: any) => e.element === 'Button' || e.element === 'Input').map((e: any) => e.props.label ?? e.props.key)).toEqual([
      'Yes',
      'No',
      'Note',
    ])
    await h.press('option-0')

    expect(answers(h)).toEqual([{ id: 'g-1', answers: { ship: 'yes' }, by: PANEL_BY }])
    expect(PANEL_BY).toBe('pane-person')
    expect(h.closed).toEqual([PANEL_PANE_ID])
    expect(h.submitted).toHaveLength(1)
    expect(h.submitted[0]!.text.startsWith("[gate] gate g-1 was answered by this session's pane, by a person.")).toBe(true)
    expect(await h.rowButton()).toBeNull()

    await h.clock.advance(60_000)
    expect(h.submitted).toHaveLength(1)
    expect(answers(h)).toHaveLength(1)
  })

  test('a note typed in the pane rides with the picked option, and Esc answers nothing', async () => {
    const h = harness()
    await h.start()
    await flush()

    ;(await h.rowButton()).props.onPress({})
    await flush()
    await h.escape()
    expect(answers(h)).toEqual([])
    expect((await h.rowButton())).not.toBeNull()

    ;(await h.rowButton()).props.onPress({})
    await flush()
    byKey(await h.pane(), 'note').props.onInput('only after the tag')
    await h.press('option-1')
    expect(answers(h)).toEqual([{ id: 'g-1', answers: { ship: { value: 'no', note: 'only after the tag' } }, by: 'pane-person' }])
  })

  test('the model cannot reach the answer path: no tool or delivery triggers gate:answer from this block', async () => {
    const h = harness()
    await h.start()
    await flush()
    expect(await h.rowButton()).not.toBeNull()

    const engine = recorder({ result: 'ok' })
    const call = Object.assign(engine.next, { signal: new AbortController().signal })
    await h.fire('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__gate_answer', tool_use_id: 't-1', input: { id: 'g-1' } }, call)
    await h.fire('tool.call', { tool: 'AskUserQuestion', tool_use_id: 't-2', questions: [{ question: QUESTION, header: 'Ship', options: [], multiSelect: false }] }, call)
    await h.fire('tool.call', { tool: 'Bash', tool_use_id: 't-3', input: { command: 'printf 1' } }, call)
    const data = JSON.stringify({ id: 'g-1', answers: { ship: 'yes' } })
    for (const text of [
      '1',
      `<rt-mod-command id="c-1" kind="gate-panel" link="ml-1">${data}</rt-mod-command>`,
      `<rt-mod-command id="c-2" kind="gate-answer" link="ml-1">${data}</rt-mod-command>`,
    ]) {
      await h.fire('session.receive', { origin: { kind: 'peer' }, text }, recorder({ text }).next)
    }
    await h.turnEnd()
    await h.band()
    await flush()

    expect(answers(h)).toEqual([])
    expect(h.verbs('session:ack')).toEqual([])
    expect(h.opened).toEqual([])
  })

  test('an answer that lost the race says so, and the row goes', async () => {
    const h = harness()
    await h.start()
    await flush()
    ;(await h.rowButton()).props.onPress({})
    await flush()
    // The board's answer lands while the pane is still drawn and its event is not yet seen.
    h.rows['g-1']!.status = 'answered'
    h.rows['g-1']!.answer = { answers: { ship: 'no' }, by: 'board', answeredAt: 3 }
    await h.press('option-0')

    expect(answers(h)).toHaveLength(1)
    expect(h.logs.filter(l => l.to !== 'debug').map(l => l.text)).toEqual([
      'Gate g-1 was already answered by board, so your answer was not recorded.',
    ])
    expect(await h.rowButton()).toBeNull()
  })

  test('a session end drops the row and its waits', async () => {
    const h = harness()
    await h.start()
    await flush()
    expect(await h.rowButton()).not.toBeNull()

    await h.end('exit')
    await flush()
    expect(await h.rowButton()).toBeNull()
  })

  test('pressing 1 while the pane is open answers nothing; letters answer and Esc closes', async () => {
    const h = harness()
    await h.start()
    await flush()
    ;(await h.rowButton()).props.onPress({})
    await flush()

    // The engine presses whichever element in the focused pane carries the key.
    const keyed = () => h.pane().then(drawn => walk(drawn).filter((e: any) => e.props?.hotkey !== undefined))
    expect((await keyed()).map((e: any) => [e.props.key, e.props.hotkey])).toEqual([
      ['option-0', 'a'],
      ['option-1', 'b'],
    ])
    for (const c of (await keyed()).filter((e: any) => /^\d$/.test(e.props.hotkey))) c.props.onPress({})
    await flush()
    expect(answers(h)).toEqual([])

    await h.escape()
    expect(answers(h)).toEqual([])
    expect(texts(await h.band())[0]).toBe('Waiting on your answer')

    ;(await h.rowButton()).props.onPress({})
    await flush()
    for (const c of (await keyed()).filter((e: any) => e.props.hotkey === 'b')) c.props.onPress({})
    await flush()
    expect(answers(h)).toEqual([{ id: 'g-1', answers: { ship: 'no' }, by: 'pane-person' }])
  })

  test('while the pane is open the band says so, with no Button, and follows the question', async () => {
    const two = gate({
      questions: [
        { id: 'ship', label: QUESTION, multi: false, options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { id: 'when', label: 'When?', multi: false, options: ['now', 'later'] },
      ],
    })
    const h = harness({ 'g-1': two })
    await h.start()
    await flush()
    ;(await h.rowButton()).props.onPress({})
    await flush()

    const open = await h.band({ bodyColumns: 140 })
    expect(walk(open).filter((e: any) => e.element === 'Button')).toEqual([])
    const shown = walk(open).filter((e: any) => e.element === 'Text')
    expect(shown.map((t: any) => [t.props.children[0], t.props.color])).toEqual([
      ['Answering in the panel  →', 'suggestion'],
      [`question herd:h-1/j1 · 2 questions · ${QUESTION}`, 'inactive'],
      [' · question 1 of 2', 'inactive'],
      ['esc back to the prompt', 'inactive'],
    ])
    expect(shown[0].props.bold).toBe(true)

    await h.press('option-0')
    expect(texts(await h.band())[2]).toBe(' · question 2 of 2')

    await h.escape()
    expect(texts(await h.band())[0]).toBe('Waiting on your answer')
    expect((await h.rowButton()).props.hotkey).toBe('1')
    expect(answers(h)).toEqual([])
  })

  test('the pane asks for 40% of the terminal the band last saw', async () => {
    const h = harness()
    await h.start()
    await flush()
    await h.band({ bodyColumns: 145 })
    ;(await h.rowButton()).props.onPress({})
    await flush()
    // rowButton drew the band at 80 columns, the most recent render: 85 across.
    expect(h.opened.map(o => o.columns)).toEqual([34])

    await h.escape()
    const button = walk(await h.band({ bodyColumns: 245 })).find((e: any) => e.element === 'Button')
    button.props.onPress({})
    await flush()
    expect(h.opened.map(o => o.columns)).toEqual([34, 80])
  })

  test("the terminal's width comes from the render's viewport first, beside another pane's dock too", async () => {
    const h = harness()
    await h.start()
    await flush()
    // Another pane holds the dock: the band's column is the transcript's, 75, in a 150-column terminal.
    const button = walk(await h.band({ bodyColumns: 70 }, { viewport: { columns: 150, rows: 40 } })).find((e: any) => e.element === 'Button')
    button.props.onPress({})
    await flush()
    expect(h.opened.map(o => o.columns)).toEqual([60])

    await h.escape()
    // No viewport measured: the band's own width plus the engine's five.
    const fallback = walk(await h.band({ bodyColumns: 95 })).find((e: any) => e.element === 'Button')
    fallback.props.onPress({})
    await flush()
    expect(h.opened.map(o => o.columns)).toEqual([60, 40])
  })

  test('on a narrow band the right end truncates rather than wraps', async () => {
    const h = harness()
    await h.start()
    await flush()
    const closed = walk(await h.band({ bodyColumns: 6 }))
    expect(closed.find((e: any) => e.element === 'Button').props.label).toBe('A…')
    expect(closed.find((e: any) => e.element === 'Text').props.wrap).toBe('truncate-end')

    ;(await h.rowButton()).props.onPress({})
    await flush()
    const open = walk(await h.band({ bodyColumns: 10 })).filter((e: any) => e.element === 'Text')
    const esc = open.at(-1)
    expect(esc.props).toMatchObject({ color: 'inactive', wrap: 'truncate-end' })
    expect(esc.props.children[0]).toBe('esc back')
  })

  test('a docked pane narrows the open band: the summary still shows, clipped, with the counter', async () => {
    const five = gate({ questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, label: i === 0 ? QUESTION : `Q${i}`, multi: false, options: ['a', 'b'] })) })
    const h = harness({ 'g-1': five })
    await h.start()
    await flush()
    ;(await h.rowButton()).props.onPress({})
    await flush()

    const docked = texts(await h.band({ bodyColumns: 71 }))
    expect(docked[0]).toBe('Answering in the panel  →')
    expect(docked[1]!.startsWith('question herd:h')).toBe(true)
    expect(docked[1]!.endsWith('…')).toBe(true)
    expect(docked[1]!.length).toBeGreaterThanOrEqual(12)
    expect(docked.slice(2)).toEqual([' · question 1 of 5', 'esc back'])
    expect(docked.join('').length + 3 + 1).toBeLessThanOrEqual(71)

    const tighter = texts(await h.band({ bodyColumns: 55 }))
    expect(tighter[1]!.length).toBeGreaterThanOrEqual(12)
    expect(tighter.slice(2)).toEqual([' · 1/5', 'esc back'])
    expect(tighter.join('').length + 3 + 1).toBeLessThanOrEqual(55)
  })

  test("the pane draws the listed gate's kind, subject and context", async () => {
    const review = gate({
      kind: 'review-post',
      subject: 'mr:https://gitlab.example.com/acme/web/-/merge_requests/146045',
      context: JSON.stringify({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'Ready to post.', findings: { minor: 2 } }),
    })
    const h = harness({ 'g-1': review })
    await h.start()
    await flush()
    ;(await h.rowButton()).props.onPress({})
    await flush()

    const drawn = await h.pane()
    expect(texts(byKey(drawn, 'header'))).toEqual(['review-post · !146045'])
    expect(texts(byKey(drawn, 'context'))).toEqual(['Ready', '  ·  ', '2 minor', 'Ready to post.'])
  })

  // The second press is a band click: the pane holds the keys once it is open.
  test('a second press while the pane is open keeps the open pane tracked, so an answer elsewhere still closes it', async () => {
    const h = harness()
    await h.start()
    await flush()

    // The band draws no Button while the pane is open, so the second press is one already drawn.
    const button = await h.rowButton()
    button.props.onPress({})
    await flush()
    expect(await h.rowButton()).toBeNull()
    button.props.onPress({})
    await flush()
    expect(h.opened).toHaveLength(2)
    expect(h.closed).toEqual([])

    h.rows['g-1']!.status = 'answered'
    h.rows['g-1']!.answer = { answers: { ship: 'no' }, by: 'board', answeredAt: 3 }
    h.emit('gate/answered/g-1')
    await flush()

    expect(h.closed).toEqual([PANEL_PANE_ID])
    expect(answers(h)).toEqual([])
  })

  test('a load in flight when the block is cleared arms no new watch', async () => {
    const h = harness({ 'g-1': gate() })
    await h.start()
    await flush()
    expect(h.rounds).toHaveLength(1)

    const respond = h.script.respond
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    h.script.respond = async (verb, body) => {
      if (verb === 'gate:list') await held
      return respond(verb, body)
    }
    h.rows['g-2'] = gate({ id: 'g-2' })
    await h.turnEnd()
    expect(h.verbs('gate:list')).toHaveLength(2)

    // A draw that throws clears the block while that list is still out.
    h.$.ui.resolve = () => {
      throw new Error('surface gone')
    }
    expect(await h.band()).toBe(h.engineBand)
    expect(h.hub.liveBlocks()).not.toContain('gate-panel')

    release()
    await flush()
    expect(h.rounds).toHaveLength(1)
    h.emit('gate/answered/g-1')
    await flush()
    expect(h.verbs('gate:list')).toHaveLength(2)
    expect(h.rounds).toHaveLength(1)
  })
})
