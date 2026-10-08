import { describe, expect, test } from 'claude-code/testing'
import { createDisplay, FORM_PANE_ID, type FormGate } from '../src/blocks/display.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { byKey, flush, harness as stub, texts, walk } from './stub.ts'

const j = (v: unknown) => JSON.stringify(v)

/** A review-post gate as rt lists it: review@1 on the gate, findings@1 on a findings question. */
const REVIEW: FormGate = {
  id: 'g-r',
  kind: 'review-post',
  subject: 'mr:https://gitlab.example.com/acme/web/-/merge_requests/146045',
  context: j({ 'gate-ctx': 'review@1', readiness: 'with-fixes', summary: 'The badge works; two states read wrong.', findings: { critical: 1, important: 3, minor: 0 } }),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings?',
      multi: true,
      context: j({
        'gate-ctx': 'findings@1',
        findings: [
          {
            id: 'f1',
            severity: 'critical',
            title: 'The badge is invisible in dark mode',
            body: 'It draws a fixed grey.',
            file: 'apps/web/src/widgets/RetryBadge.tsx:92',
            fix: 'use the theme stroke token',
          },
        ],
      }),
      options: [
        { value: 'f1', label: 'The badge is invisible in dark mode', description: 'apps/…/RetryBadge.tsx:92 · use the theme stroke token · kind:a11y' },
        { value: 'f9', label: 'Something else', description: 'a finding the context does not carry' },
      ],
    },
    {
      id: 'outcome',
      label: 'Post the review as',
      options: [
        { value: 'comment', label: 'Comment (recommended)', description: 'leave the MR open for the author' },
        { value: 'approve', label: 'Approve', description: 'approve with the findings as comments' },
      ],
    },
  ],
}

const SHIP: FormGate = { id: 'g-1', questions: [{ id: 'ship', label: 'Ship the release?', options: [{ value: 'yes', label: 'Yes' }, 'no', 'later'] }] }

const PROSE = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')

function kit(bodyColumns = 40) {
  const h = stub()
  const hub = createHub()
  const display = createDisplay(hub)
  attachHub(h.on, hub)
  const opened: any[] = []
  const closed: string[] = []
  h.$.ui.open = async (pane: unknown) => (opened.push(pane), { isPlaced: true })
  h.$.ui.close = async ({ id }: { id: string }) => {
    closed.push(id)
    await h.fire('ui.close', { id, origin: { kind: 'plugin' } }, async () => {})
  }
  h.$.ui.invalidate = () => {}
  // The engine hands out frozen plain data, so an element keeps the children it was built with.
  const built = (element: string) => (props: any) => ({
    element,
    props: Array.isArray(props.children) ? { ...props, children: [...props.children] } : { ...props },
  })
  h.$.ui.resolve = () => ({ Box: built('Box'), Text: built('Text'), Button: built('Button'), Input: built('Input') })
  const focused: { requestId: string; key: string }[] = []
  h.$.ui.focus = async (args: { requestId: string; key: string }) => (focused.push(args), {})
  const scrolled: unknown[] = []
  h.$.ui.scroll = async (args: unknown) => (scrolled.push(args), {})
  const api = {
    ui: {
      open: h.$.ui.open,
      close: (id: string) => h.$.ui.close({ id }),
      redraw: h.$.ui.invalidate,
      log: () => {},
      focus: (requestId: string, key: string) => h.$.ui.focus({ requestId, key }),
      scroll: (args: unknown) => h.$.ui.scroll(args),
    },
    clock: { now: () => h.$.clock.now() },
  } as any
  const draw = async (): Promise<any> =>
    h.fire('ui.render', { surface: 'terminal', component: 'Pane', requestId: FORM_PANE_ID, props: { bodyColumns } }, async () => ({ element: 'Box', props: { children: [] } }))
  const press = async (key: string) => {
    byKey(await draw(), key).props.onPress({})
    await flush()
  }
  const ask = async (gate: FormGate, terminalColumns?: number) => {
    const answered = display.formPane(api, gate, terminalColumns)
    await flush()
    return answered
  }
  const buttons = async () => walk(await draw()).filter(e => e.element === 'Button')
  /** A press as the engine raises it (hotkey, Enter or click alike): `ui.press`, then the Button's own onPress. */
  const enginePress = async (key: string) => {
    const tree = await draw()
    const reached: string[] = []
    await h.fire('ui.press', { plugin: 'mattstack-mods', element: key, component: 'Pane', requestId: FORM_PANE_ID, surface: 'terminal' }, async (e: any) => {
      reached.push(e.element)
      byKey(tree, e.element).props.onPress(e)
      return { element: e.element }
    })
    await flush()
    return reached.length > 0
  }
  /** The ring landing on `key`, moved by the person (Tab, a click) or by a plugin. */
  const ring = (key: string, by: 'person' | 'plugin' = 'person') =>
    h.fire(
      'ui.focus',
      { component: 'Pane', requestId: FORM_PANE_ID, plugin: 'mattstack-mods', element: key, origin: by === 'person' ? { kind: 'person' } : { kind: 'plugin', name: 'mattstack-mods' } },
      async () => ({}),
    )
  /** A window move on the pane; resolves to whether the engine's move went ahead. */
  const scroll = async (by: number, over: Record<string, unknown> = {}) => {
    let moved = false
    await h.fire(
      'ui.scroll',
      { component: 'Pane', requestId: FORM_PANE_ID, offset: 0, by, bodyRows: 10, contentRows: 30, origin: { kind: 'person' }, ...over },
      async () => ((moved = true), {}),
    )
    await flush()
    return moved
  }
  return { h, display, api, opened, closed, focused, scrolled, draw, press, enginePress, ring, scroll, ask, buttons }
}

describe('display kit', () => {
  test('a single question: a letter answers it, there is no pane Skip, and no digit is a hotkey', async () => {
    const k = kit()
    const answered = k.ask(SHIP)
    await flush()
    const all = await k.buttons()
    expect(all.map(b => [b.props.key, b.props.label, b.props.hotkey])).toEqual([
      ['option-0', 'Yes', 'a'],
      ['option-1', 'no', 'b'],
      ['option-2', 'later', 'c'],
    ])
    expect(all.every(b => b.props.plain === true)).toBe(true)
    expect(all.filter(b => /^\d$/.test(b.props.hotkey ?? ''))).toEqual([])
    expect(all[0].props.autoFocus).toBe(true)
    expect(byKey(await k.draw(), 'skip')).toBeUndefined()
    expect(texts(await k.draw())).toContain('one choice · a letter answers')
    expect(texts(await k.draw())).toContain('↑↓ move · ⏎ or a letter answers · esc closes')

    await k.press('option-1')
    expect(await answered).toEqual({ ship: 'no' })
    expect(k.closed).toEqual([FORM_PANE_ID])
  })

  test('choice letters run a to z with no hole at s', async () => {
    const k = kit()
    void k.ask({ id: 'g-1', questions: [{ id: 'q', label: 'Pick one', options: Array.from({ length: 28 }, (_, i) => `o${i}`) }] })
    await flush()
    const hotkeys = (await k.buttons()).filter(b => b.props.key.startsWith('option-')).map(b => b.props.hotkey ?? '')
    expect(hotkeys.join('')).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(hotkeys.slice(26)).toEqual(['', ''])
  })

  test('a multi question: a letter ticks, Next refuses an empty pick, and the last question says Done', async () => {
    const k = kit()
    const answered = k.ask({
      id: 'g-2',
      questions: [
        { id: 'targets', label: 'Which targets?', multi: true, options: ['mac', 'linux', 'win'] },
        { id: 'more', label: 'And the docs?', multi: true, options: ['site', 'readme'] },
      ],
    })
    await flush()
    const first = await k.draw()
    expect(byKey(first, 'option-0').props.label).toBe('[ ] mac')
    expect(byKey(first, 'next').props).toMatchObject({ label: 'Next: 0 picked →', variant: 'primary' })
    expect(byKey(first, 'next').props.hotkey).toBeUndefined()
    expect(texts(first)).toContain('pick any · a letter ticks or unticks · Next moves on')
    expect(texts(first)).toContain('↑↓ move · letter ticks · ⏎ on Next continues · esc closes')
    expect(byKey(first, 'note').props.placeholder).toBe('optional, posted with your picks')

    await k.press('next')
    expect(byKey(await k.draw(), 'option-0').props.label).toBe('[ ] mac')
    await k.press('option-0')
    await k.press('option-2')
    expect(byKey(await k.draw(), 'option-0').props.label).toBe('[x] mac')
    expect(byKey(await k.draw(), 'next').props.label).toBe('Next: 2 picked →')
    await k.press('next')
    await k.press('option-1')
    expect(byKey(await k.draw(), 'next').props.label).toBe('Done: 1 picked')
    await k.press('next')
    expect(await answered).toEqual({ targets: ['mac', 'win'], more: ['readme'] })
  })

  test('Back returns to the last question with its picks and note kept', async () => {
    const k = kit()
    const answered = k.ask({
      id: 'g-2',
      questions: [
        { id: 'targets', label: 'Which targets?', multi: true, options: ['mac', 'linux', 'win'] },
        { id: 'ship', label: 'Ship it?', options: ['yes', 'no'] },
      ],
    })
    await flush()
    expect(byKey(await k.draw(), 'back')).toBeUndefined()
    await k.press('option-0')
    await k.press('option-2')
    byKey(await k.draw(), 'note').props.onInput('only after the tag')
    await k.press('next')

    const second = await k.draw()
    expect(byKey(second, 'back').props).toMatchObject({ label: '← Back', dimColor: true })
    expect(byKey(second, 'back').props.hotkey).toBeUndefined()
    expect(byKey(second, 'note').props.value).toBe('')
    const actions = walk(second).filter(e => e.element === 'Button' && !e.props.key.startsWith('option-'))
    expect(actions.map(b => b.props.key)).toEqual(['back'])

    await k.press('back')
    const again = await k.draw()
    expect(byKey(again, 'option-0').props.label).toBe('[x] mac')
    expect(byKey(again, 'option-1').props.label).toBe('[ ] linux')
    expect(byKey(again, 'option-2').props.label).toBe('[x] win')
    expect(byKey(again, 'note').props.value).toBe('only after the tag')

    await k.press('next')
    await k.press('option-1')
    expect(await answered).toEqual({ targets: { value: ['mac', 'win'], note: 'only after the tag' }, ship: 'no' })
  })

  test('the header names the kind, the subject and where the form stands', async () => {
    const k = kit()
    void k.ask(REVIEW)
    await flush()
    const header = byKey(await k.draw(), 'header')
    expect(texts(header)).toEqual(['review-post · !146045', 'question 1 of 2', '●', '○'])
    const dots = walk(header).filter(e => e.element === 'Text' && ['●', '○'].includes(e.props.children[0]))
    expect(dots.map(d => d.props.color)).toEqual(['suggestion', 'inactive'])
    expect(k.display.progress()).toEqual({ index: 0, count: 2 })

    await k.press('option-0')
    await k.press('next')
    const next = byKey(await k.draw(), 'header')
    expect(texts(next).slice(1)).toEqual(['question 2 of 2', '●', '●'])
    expect(walk(next).filter(e => e.props?.children?.[0] === '●').map(d => d.props.color)).toEqual(['success', 'suggestion'])
    expect(k.display.progress()).toEqual({ index: 1, count: 2 })

    const one = kit()
    void one.ask(SHIP)
    await flush()
    expect(byKey(await one.draw(), 'header')).toBeUndefined()
    expect(texts(await one.draw())).not.toContain('question 1 of 1')
  })

  test('review@1 draws its readiness, counts and summary in a box on the first question only', async () => {
    const k = kit()
    void k.ask(REVIEW)
    await flush()
    const box = byKey(await k.draw(), 'context')
    expect(box.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle', paddingX: 1 })
    const row = walk(box).filter(e => e.element === 'Text')
    expect(row.slice(0, 5).map(t => [t.props.children[0], t.props.color, t.props.bold ?? false])).toEqual([
      ['With fixes', 'warning', true],
      ['  ·  ', 'inactive', false],
      ['1 critical', 'error', false],
      [' · ', 'inactive', false],
      ['3 important', 'warning', false],
    ])
    expect(texts(box)).not.toContain('0 minor')
    expect(texts(box).at(-1)).toBe('The badge works; two states read wrong.')

    // A wrapping row whose items are the readiness, then each separator with
    // the count after it, so a line never ends on a separator.
    const first = box.props.children[0]
    expect(first.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
    const items = first.props.children
    expect(items[0].element).toBe('Text')
    expect(items.slice(1).map((i: any) => [i.element, i.props.flexShrink, texts(i)])).toEqual([
      ['Box', 0, ['  ·  ', '1 critical']],
      ['Box', 0, [' · ', '3 important']],
    ])

    await k.press('option-0')
    await k.press('next')
    expect(byKey(await k.draw(), 'context')).toBeUndefined()

    const again = kit()
    void again.ask({ ...REVIEW, context: j({ 'gate-ctx': 'review@1', readiness: 'no', summary: 'Not yet.', findings: {}, round: 2 }) })
    await flush()
    expect(texts(byKey(await again.draw(), 'context'))).toEqual(['Not ready', ' · round 2', 'Not yet.'])
  })

  test('a findings@1 choice shows its finding by option value, not its description', async () => {
    const k = kit()
    void k.ask(REVIEW)
    await flush()
    const choice = byKey(await k.draw(), 'choice-0')
    const shown = walk(choice).filter(e => e.element === 'Text')
    expect(shown.map(t => t.props.children[0])).toEqual(['Critical', '  ·  ', '…/RetryBadge.tsx:92', 'use the theme stroke token'])
    expect(shown[0].props).toMatchObject({ bold: true, color: 'error' })
    expect(shown[2].props.wrap).toBe('truncate-start')
    expect(JSON.stringify(choice)).not.toContain('kind:a11y')

    expect(texts(byKey(await k.draw(), 'choice-1'))).toEqual(['a finding the context does not carry'])
  })

  test('the severity word never shrinks; a long file tail is clipped from its start instead', async () => {
    const k = kit(40)
    const long = 'apps/web/src/widgets/very/deep/AnExtremelyLongComponentFileName.tsx:120'
    const findings = j({ 'gate-ctx': 'findings@1', findings: [{ id: 'f1', severity: 'important', title: 't', body: 'b', file: long, fix: 'f' }] })
    void k.ask({ id: 'g-l', questions: [{ id: 'q', label: 'Post?', multi: true, context: findings, options: [{ value: 'f1', label: 't' }] }] })
    await flush()
    const choice = byKey(await k.draw(), 'choice-0')
    const fixed = walk(choice).find(e => e.element === 'Box' && e.props.flexShrink === 0)
    expect(texts(fixed)).toEqual(['Important', '  ·  '])
    const tail = walk(choice).find(e => e.element === 'Text' && e.props.wrap === 'truncate-start')
    expect(tail.props.children[0].startsWith('…')).toBe(true)
    expect(tail.props.children[0].endsWith('FileName.tsx:120')).toBe(true)
    // The pane's 40 cells, less the 3 of the choice's indent and the severity's 14.
    expect(tail.props.children[0].length).toBeLessThanOrEqual(40 - 3 - 14)
  })

  test('a matched finding with no fix shows its body, clipped to three rows', async () => {
    const k = kit(40)
    const body = Array.from({ length: 30 }, (_, i) => `drop${i}`).join(' ')
    const findings = j({
      'gate-ctx': 'findings@1',
      findings: [
        { id: 'f1', severity: 'minor', title: 't', body, file: 'a/b.tsx:3' },
        { id: 'f2', severity: 'minor', title: 'u', body: 'Drop the override.' },
      ],
    })
    void k.ask({
      id: 'g-b',
      questions: [{ id: 'q', label: 'Post?', multi: true, context: findings, options: [{ value: 'f1', label: 't', description: 'not this' }, { value: 'f2', label: 'u' }] }],
    })
    await flush()
    const tree = await k.draw()
    const rows = walk(byKey(tree, 'choice-0')).filter(e => e.element === 'Text').slice(3)
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.props.color === 'inactive')).toBe(true)
    // The pane's 40 cells less the choice's indent of 3.
    expect(rows.every(r => r.props.children[0].length <= 37)).toBe(true)
    expect(rows.at(-1).props.children[0].endsWith('…')).toBe(true)
    expect(rows[0].props.children[0].startsWith('drop0 drop1')).toBe(true)
    expect(JSON.stringify(byKey(tree, 'choice-0'))).not.toContain('not this')
    expect(texts(byKey(tree, 'choice-1'))).toEqual(['Minor', 'Drop the override.'])
  })

  test("a matched finding's label drops the severity tags its subtext already shows", async () => {
    const k = kit()
    const tagged = {
      ...REVIEW,
      questions: [
        {
          ...REVIEW.questions[0]!,
          options: [
            { value: 'f1', label: '[Critical] [important]  The badge is invisible in dark mode' },
            { value: 'f9', label: '[NON-BLOCKING] Something else' },
          ],
        },
      ],
    }
    void k.ask(tagged)
    await flush()
    const tree = await k.draw()
    expect(byKey(tree, 'option-0').props.label).toBe('[ ] The badge is invisible in dark mode')
    expect(byKey(tree, 'option-1').props.label).toBe('[ ] [NON-BLOCKING] Something else')
  })

  test('a recommended label is stripped and drawn as a tag', async () => {
    const k = kit()
    void k.ask({ ...REVIEW, questions: [REVIEW.questions[1]!] })
    await flush()
    const tree = await k.draw()
    expect(byKey(tree, 'option-0').props.label).toBe('Comment')
    const tag = walk(byKey(tree, 'choice-0')).find(e => e.element === 'Text' && e.props.children[0] === 'recommended')
    expect(tag.props).toMatchObject({ color: 'success', bold: true })
    expect(texts(byKey(tree, 'choice-0'))).toEqual(['recommended', 'leave the MR open for the author'])
    expect(byKey(tree, 'option-1').props.label).toBe('Approve')
    expect(texts(byKey(tree, 'choice-1'))).toEqual(['approve with the findings as comments'])
  })

  test('prose context is clipped: eight rows for the gate, six for a question', async () => {
    const k = kit(40)
    void k.ask({ id: 'g-p', context: PROSE, questions: [{ id: 'q', label: 'Go on?', context: PROSE, options: ['yes', 'no'] }] })
    await flush()
    const tree = await k.draw()
    const gateRows = texts(byKey(tree, 'context'))
    expect(gateRows).toHaveLength(8)
    expect(gateRows.every(r => r.length <= 36)).toBe(true)
    expect(gateRows.at(-1)!.endsWith('…')).toBe(true)
    const questionRows = texts(byKey(tree, 'question-context'))
    expect(questionRows).toHaveLength(6)
    expect(questionRows.every(r => r.length <= 40)).toBe(true)
    expect(questionRows.at(-1)!.endsWith('…')).toBe(true)
    expect(walk(byKey(tree, 'question-context')).filter(e => e.element === 'Text').every(t => t.props.color === 'inactive')).toBe(true)

    const short = kit(40)
    void short.ask({ id: 'g-p', context: 'Two lines\nof context.', questions: [{ id: 'q', label: 'Go on?', options: ['yes'] }] })
    await flush()
    expect(texts(byKey(await short.draw(), 'context'))).toEqual(['Two lines', 'of context.'])
  })

  test('a JSON context of an unknown gate-ctx shape is not shown', async () => {
    const k = kit()
    const unknown = j({ 'gate-ctx': 'plan@9', reviewer: 'renee', threads: { total: 2 } })
    void k.ask({ id: 'g-u', context: unknown, questions: [{ id: 'q', label: 'Go on?', context: unknown, options: ['yes'] }] })
    await flush()
    const tree = await k.draw()
    expect(byKey(tree, 'context')).toBeUndefined()
    expect(byKey(tree, 'question-context')).toBeUndefined()
    expect(JSON.stringify(tree)).not.toContain('gate-ctx')
  })

  test('respond shapes: plan@1 on the gate, thread@1 on the question', async () => {
    const k = kit()
    void k.ask({
      id: 'g-t',
      kind: 'respond-plan',
      subject: 'run:r-42',
      context: j({ 'gate-ctx': 'plan@1', reviewer: 'renee', round: 2, threads: { total: 3, blocking: 1 }, adjudication: 'both valid' }),
      questions: [
        {
          id: 't-1',
          label: 'Reply to renee on enqueue.ts?',
          context: j({
            'gate-ctx': 'thread@1',
            author: 'renee',
            severity: 'blocking',
            claim: { summary: 'the retry queue re-enqueues a failed job.' },
            verdict: { call: 'valid-low-value' },
            reply: { kind: 'none' },
          }),
          options: ['post', 'skip'],
        },
      ],
    })
    await flush()
    const tree = await k.draw()
    expect(texts(byKey(tree, 'header'))).toEqual(['respond-plan · r-42'])
    expect(texts(byKey(tree, 'context'))).toEqual(['renee', ' · round 2', '  ·  ', '3 threads', ' · ', '1 blocking', 'both valid'])
    const thread = walk(byKey(tree, 'question-context')).filter(e => e.element === 'Text')
    expect(thread.map(t => [t.props.children[0], t.props.color])).toEqual([
      ['renee', 'text'],
      ['  ', 'inactive'],
      ['blocking', 'error'],
      ['the retry queue re-enqueues a failed job.', 'text'],
      ['verdict · valid, low value', 'inactive'],
    ])
  })

  test('Back to a single question marks the earlier pick, moves the focus onto it, and keeps the note', async () => {
    const k = kit()
    const answered = k.ask({
      id: 'g-s',
      questions: [
        { id: 'ship', label: 'Ship it?', options: ['yes', 'no', 'later'] },
        { id: 'when', label: 'When?', options: ['now', 'friday'] },
      ],
    })
    await flush()
    byKey(await k.draw(), 'note').props.onInput('after the tag')
    await k.press('option-1')

    await k.press('back')
    const again = await k.draw()
    expect(texts(byKey(again, 'choice-1'))).toEqual(['your answer'])
    expect(texts(byKey(again, 'choice-0'))).toEqual([])
    expect(byKey(again, 'option-1').props.autoFocus).toBe(true)
    expect(byKey(again, 'option-0').props.autoFocus).toBeUndefined()
    expect(byKey(again, 'note').props.value).toBe('after the tag')
    // Back is a redraw inside a pane that already holds the keys, where autoFocus no longer applies.
    expect(k.focused.map(f => f.key)).toEqual(['option-0', 'option-1'])
    expect(k.focused.every(f => f.requestId === FORM_PANE_ID)).toBe(true)

    await k.press('option-2')
    await k.press('option-0')
    expect(await answered).toEqual({ ship: { value: 'later', note: 'after the tag' }, when: 'now' })
  })

  test('every question change scrolls the pane to the top and focuses the first choice, or the earlier single pick', async () => {
    const k = kit()
    void k.ask({
      id: 'g-m',
      questions: [
        { id: 'targets', label: 'Which?', multi: true, options: ['mac', 'win'] },
        { id: 'ship', label: 'Ship it?', options: ['yes', 'no'] },
        { id: 'when', label: 'When?', options: ['now', 'later'] },
      ],
    })
    await flush()
    expect(k.focused).toEqual([])
    expect(k.scrolled).toEqual([])

    await k.press('option-1')
    await k.press('next')
    await k.press('option-1')
    await k.press('back')
    await k.press('back')
    expect(k.focused.map(f => f.key)).toEqual(['option-0', 'option-0', 'option-1', 'option-0'])
    expect(k.scrolled).toEqual(Array.from({ length: 4 }, () => ({ in: FORM_PANE_ID, to: 'start' })))

    // A question with no options focuses its field.
    const free = kit()
    void free.ask({ id: 'g-f', questions: [{ id: 'a', label: 'Pick', options: ['x'] }, { id: 'b', label: 'Why?', options: [] }] })
    await flush()
    await free.press('option-0')
    expect(free.focused.map(f => f.key)).toEqual(['answer'])
  })

  test('the arrows move between the controls while a question has choices, and scroll otherwise', async () => {
    const k = kit()
    void k.ask({
      id: 'g-a',
      questions: [
        { id: 'targets', label: 'Which?', multi: true, options: ['mac', 'linux', 'win'] },
        { id: 'ship', label: 'Ship it?', options: ['yes'] },
      ],
    })
    await flush()
    await k.draw()
    await k.ring('option-0', 'plugin')

    expect(await k.scroll(1)).toBe(false)
    expect(k.focused.at(-1)).toEqual({ requestId: FORM_PANE_ID, key: 'option-1' })
    expect(k.scrolled.at(-1)).toEqual({ in: FORM_PANE_ID, to: { key: 'option-1' } })
    await k.ring('option-1', 'plugin')
    expect(await k.scroll(1)).toBe(false)
    await k.ring('option-2', 'plugin')
    expect(await k.scroll(1)).toBe(false)
    expect(k.focused.at(-1)!.key).toBe('note')
    await k.ring('note', 'plugin')
    expect(await k.scroll(1)).toBe(false)
    expect(k.focused.at(-1)!.key).toBe('next')
    await k.ring('next', 'plugin')
    // Past the last control the window moves, so the person can still read the end.
    expect(await k.scroll(1)).toBe(true)
    expect(await k.scroll(-1)).toBe(false)
    expect(k.focused.at(-1)!.key).toBe('note')

    await k.ring('option-0', 'plugin')
    expect(await k.scroll(-1)).toBe(true)
    const moves = k.focused.length
    expect(await k.scroll(1, { pointer: { column: 3, row: 2 } })).toBe(true)
    expect(await k.scroll(5)).toBe(true)
    expect(await k.scroll(1, { origin: { kind: 'plugin', name: 'other' } })).toBe(true)
    expect(await k.scroll(1, { requestId: 'someone-else' })).toBe(true)
    expect(k.focused.length).toBe(moves)

    const free = kit()
    void free.ask({ id: 'g-f', questions: [{ id: 'q', label: 'Why?', options: [] }] })
    await flush()
    expect(await free.scroll(1)).toBe(true)
  })

  test('a choice press within 700 ms of the pane opening or the question changing is ignored, unless the person moved onto it', async () => {
    const k = kit()
    const answered = k.ask({
      id: 'g-q',
      questions: [
        { id: 'ship', label: 'Ship it?', options: ['yes', 'no'] },
        { id: 'when', label: 'When?', options: ['now', 'later'] },
      ],
    })
    await flush()
    // `1` then a letter typed straight on: the letter lands as the pane opens.
    await k.h.clock.advance(500)
    expect(await k.enginePress('option-0')).toBe(false)
    expect(k.display.progress()).toEqual({ index: 0, count: 2 })

    await k.h.clock.advance(201)
    expect(await k.enginePress('option-1')).toBe(true)
    expect(k.display.progress()).toEqual({ index: 1, count: 2 })

    // The question changed: quiet again, but Tab (or a click) onto a choice and Enter go through.
    expect(await k.enginePress('option-0')).toBe(false)
    await k.ring('option-1', 'person')
    expect(await k.enginePress('option-0')).toBe(false)
    expect(await k.enginePress('option-1')).toBe(true)
    expect(await answered).toEqual({ ship: 'no', when: 'later' })
  })

  test('two arrow steps in a row advance twice, before either focus move lands', async () => {
    const k = kit()
    void k.ask({ id: 'g-a', questions: [{ id: 'q', label: 'Which?', multi: true, options: ['mac', 'linux', 'win'] }] })
    await flush()
    await k.draw()
    await k.ring('option-0', 'plugin')
    // The stub's ui.focus raises no ui.focus event, as a move still in flight would not have yet.
    expect(await k.scroll(1)).toBe(false)
    expect(await k.scroll(1)).toBe(false)
    expect(k.focused.map(f => f.key)).toEqual(['option-1', 'option-2'])
    expect(await k.scroll(-1)).toBe(false)
    expect(k.focused.at(-1)!.key).toBe('option-1')
  })

  test('a clock that fails lets a choice press through, without the hook throwing', async () => {
    const k = kit()
    const answered = k.ask({ id: 'g-c', questions: [{ id: 'ship', label: 'Ship it?', options: ['yes', 'no'] }] })
    await flush()
    k.h.$.clock.now = async () => {
      throw new Error('clock gone')
    }
    expect(await k.enginePress('option-1')).toBe(true)
    expect(await answered).toEqual({ ship: 'no' })
    expect(k.h.logs.filter(l => l.text.includes('threw'))).toEqual([])
  })

  test('an arrow move onto a choice counts as the person moving onto it', async () => {
    const k = kit()
    const answered = k.ask({ id: 'g-q', questions: [{ id: 'ship', label: 'Ship it?', options: ['yes', 'no'] }] })
    await flush()
    await k.draw()
    await k.ring('option-0', 'plugin')
    expect(await k.scroll(1)).toBe(false)
    await k.ring('option-1', 'plugin')
    expect(await k.enginePress('option-1')).toBe(true)
    expect(await answered).toEqual({ ship: 'no' })
  })

  test('post@1 on the gate: reviewer, round, replies and fixes', async () => {
    const k = kit()
    void k.ask({
      id: 'g-p',
      context: j({ 'gate-ctx': 'post@1', reviewer: 'renee', replies: 1, fixes: [{ sha: 'ab12cd3' }, { sha: 'ef45ab6' }], adjudication: 'both conceded' }),
      questions: [{ id: 'q', label: 'Post them?', options: ['yes'] }],
    })
    await flush()
    expect(texts(byKey(await k.draw(), 'context'))).toEqual(['renee', '  ·  ', '1 reply', ' · ', '2 fixes', 'both conceded'])
  })

  /** The rows a question's context adds under its label, as `[text, color]`. */
  async function questionRows(context: unknown): Promise<[string, string][]> {
    const k = kit()
    void k.ask({ id: 'g-q', questions: [{ id: 'q', label: 'Go on?', context: j(context), options: ['yes'] }] })
    await flush()
    return walk(byKey(await k.draw(), 'question-context'))
      .filter(e => e.element === 'Text')
      .map(t => [t.props.children[0], t.props.color])
  }

  test('reply@1 on a question: verb and file tail, then the reply', async () => {
    expect(await questionRows({ 'gate-ctx': 'reply@1', thread: 't-1', file: 'queue/enqueue.ts:88', verb: 'fix', sha: 'ab12cd3', text: 'Fixed, with a test.' })).toEqual([
      ['fix · …/enqueue.ts:88', 'inactive'],
      ['Fixed, with a test.', 'text'],
    ])
  })

  test('carryover@1 on a question: round and call, then the original', async () => {
    const carry = { 'gate-ctx': 'carryover@1', thread: 'd-1', round: 2, call: 'not-fixed', original: 'a 204 returns no body.', reply: 'Still open.' }
    expect(await questionRows(carry)).toEqual([
      ['round 2 · waiting on author', 'inactive'],
      ['a 204 returns no body.', 'text'],
    ])
  })

  test('skipped@1 and replies@1 on a question: one quiet line per entry', async () => {
    const skipped = {
      'gate-ctx': 'skipped@1',
      skipped: [
        { id: 'r1-f4', round: 1, severity: 'minor', title: 'Unused import', changed: false },
        { id: 'r2-f3', round: 2, severity: 'important', title: 'Config defaults live in two files' },
      ],
    }
    expect(await questionRows(skipped)).toEqual([
      ['Minor Unused import', 'inactive'],
      ['Important Config defaults live in two files', 'inactive'],
    ])
    const replies = {
      'gate-ctx': 'replies@1',
      replies: [
        { thread: 't-1', file: 'queue/enqueue.ts:88', verb: 'fix', text: 'fixed.' },
        { thread: 't-2', file: 'queue/README.md:12', verb: 'reply', text: 'agreed.' },
      ],
    }
    expect(await questionRows(replies)).toEqual([
      ['t-1 fix', 'inactive'],
      ['t-2 reply', 'inactive'],
    ])
  })

  test('every Text names its color, and secondary text is inactive: subtle is for borders only', async () => {
    const k = kit()
    void k.ask({ ...REVIEW, context: j({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'ok', findings: { minor: 2 }, re_review: true, round: 3 }) })
    await flush()
    const seen = [...walk(await k.draw())]
    await k.press('option-0')
    await k.press('next')
    seen.push(...walk(await k.draw()))
    const bare = seen.filter(e => e.element === 'Text' && !e.props.color)
    expect(bare).toEqual([])
    expect(seen.filter(e => e.element === 'Text' && e.props.color === 'subtle')).toEqual([])
    expect(seen.some(e => e.element === 'Text' && e.props.color === 'inactive')).toBe(true)
    expect(seen.filter(e => e.element === 'Box' && e.props.borderStyle).every(b => b.props.borderColor === 'subtle')).toBe(true)
  })

  test('the pane asks for 40% of the terminal, at most 80 columns', async () => {
    const k = kit()
    void k.ask(SHIP, 150)
    void k.ask(SHIP, 300)
    void k.ask(SHIP)
    await flush()
    expect(k.opened.map(o => o.columns)).toEqual([60, 80, 32])
    expect(k.opened[0]).toEqual({ id: FORM_PANE_ID, title: 'Gate', focus: true, closeOnEscape: true, columns: 60 })
  })

  test('a question with no options keeps the free-text field, and a person close resolves null', async () => {
    const k = kit()
    const typed = k.ask({ id: 'g-3', questions: [{ id: 'q', label: 'Anything?', options: [] }] })
    await flush()
    const field = byKey(await k.draw(), 'answer')
    expect(field.props).toMatchObject({ autoFocus: true, placeholder: 'Type your answer' })
    field.props.onSubmit('  a reason  ')
    expect(await typed).toEqual({ q: 'a reason' })

    const skipped = k.ask({ id: 'g-4', questions: [{ id: 'q', label: 'Anything?', options: [] }] })
    await flush()
    await k.h.fire('ui.close', { id: FORM_PANE_ID, origin: { kind: 'person' } }, async () => {})
    expect(await skipped).toBeNull()
    expect(k.display.progress()).toBeNull()
  })
})
