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
  h.$.ui.resolve = () => ({
    Box: (props: any) => ({ element: 'Box', props }),
    Text: (props: any) => ({ element: 'Text', props }),
    Button: (props: any) => ({ element: 'Button', props }),
    Input: (props: any) => ({ element: 'Input', props }),
  })
  const api = { ui: { open: h.$.ui.open, close: (id: string) => h.$.ui.close({ id }), redraw: h.$.ui.invalidate, log: () => {} } } as any
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
  return { h, display, api, opened, closed, draw, press, ask, buttons }
}

describe('display kit', () => {
  test('a single question: a letter answers it, s skips, and no digit is a hotkey', async () => {
    const k = kit()
    const answered = k.ask(SHIP)
    await flush()
    const all = await k.buttons()
    expect(all.map(b => [b.props.key, b.props.label, b.props.hotkey])).toEqual([
      ['option-0', 'Yes', 'a'],
      ['option-1', 'no', 'b'],
      ['option-2', 'later', 'c'],
      ['skip', 'Skip', 's'],
    ])
    expect(all.every(b => b.props.plain === true)).toBe(true)
    expect(all.filter(b => /^\d$/.test(b.props.hotkey ?? ''))).toEqual([])
    expect(all[0].props.autoFocus).toBe(true)
    expect(byKey(await k.draw(), 'skip').props.role).toBe('dismiss')
    expect(texts(await k.draw())).toContain('one choice · a letter answers')
    expect(texts(await k.draw())).toContain('↑↓ move · ⏎ or a letter answers · esc back')

    await k.press('option-1')
    expect(await answered).toEqual({ ship: 'no' })
    expect(k.closed).toEqual([FORM_PANE_ID])
  })

  test('choice letters run past s without taking it', async () => {
    const k = kit()
    void k.ask({ id: 'g-1', questions: [{ id: 'q', label: 'Pick one', options: Array.from({ length: 27 }, (_, i) => `o${i}`) }] })
    await flush()
    const hotkeys = (await k.buttons()).filter(b => b.props.key.startsWith('option-')).map(b => b.props.hotkey ?? '')
    expect(hotkeys.join('')).toBe('abcdefghijklmnopqrtuvwxyz')
    expect(hotkeys.slice(25)).toEqual(['', ''])
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
    expect(texts(first)).toContain('↑↓ move · letter ticks · ⏎ on Next continues · esc back')
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
    const actions = walk(second).filter(e => e.element === 'Button' && ['back', 'skip'].includes(e.props.key))
    expect(actions.map(b => b.props.key)).toEqual(['back', 'skip'])

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
    expect(dots.map(d => d.props.color)).toEqual(['suggestion', 'subtle'])
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
      ['  ·  ', 'subtle', false],
      ['1 critical', 'error', false],
      [' · ', 'subtle', false],
      ['3 important', 'warning', false],
    ])
    expect(texts(box)).not.toContain('0 minor')
    expect(texts(box).at(-1)).toBe('The badge works; two states read wrong.')

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
    expect(walk(byKey(tree, 'question-context')).filter(e => e.element === 'Text').every(t => t.props.color === 'subtle')).toBe(true)

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
      ['  ', 'subtle'],
      ['blocking', 'error'],
      ['the retry queue re-enqueues a failed job.', 'text'],
      ['verdict · valid, low value', 'subtle'],
    ])
  })

  test('every Text names its color', async () => {
    const k = kit()
    void k.ask({ ...REVIEW, context: j({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'ok', findings: { minor: 2 }, re_review: true, round: 3 }) })
    await flush()
    const seen = [...walk(await k.draw())]
    await k.press('option-0')
    await k.press('next')
    seen.push(...walk(await k.draw()))
    const bare = seen.filter(e => e.element === 'Text' && !e.props.color)
    expect(bare).toEqual([])
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
