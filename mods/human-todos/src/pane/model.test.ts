import { expect, test } from 'bun:test'

import type { Todo } from '../../types'
import { bandModel, endRows, outOfView, paneModel } from './model'
import type { PaneRow, Tone } from './model'

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'task', title: 'Do it', status: 'open', ...over })
const build = (list: Todo[], expanded: string[] = [], width = 38) => paneModel({ list, expanded, spin: '⠋', width })
const text = (t: string, tone: Tone, indent = false): PaneRow => ({ kind: 'text', text: t, tone, indent })
const spinning = (t: string): PaneRow => ({ kind: 'text', text: t, tone: 'title', indent: false, spin: true })
const BLANK: PaneRow = { kind: 'blank' }
const script5 = 'one\ntwo\nthree\nfour\nfive'

test('an open run item clips the script to two rows, then offers Show all, the cwd and its buttons', () => {
  const { rows } = build([todo({ kind: 'run', title: 'Deploy', detail: 'To staging', script: script5, cwd: '/tmp' })])

  expect(rows).toEqual([
    text('○ Deploy', 'title'),
    text('To staging', 'dim', true),
    text('$ one', 'script', true),
    text('two', 'script', true),
    { kind: 'buttons', lead: { text: '… +3 more', tone: 'dim' }, buttons: [{ id: 'more', label: 'Show all', tone: 'neutral', todoId: '1' }] },
    text('in /tmp', 'dim', true),
    BLANK,
    {
      kind: 'buttons',
      buttons: [
        { id: 'run', label: 'Run', tone: 'primary', todoId: '1' },
        { id: 'copy', label: 'Copy', tone: 'neutral', todoId: '1' },
        { id: 'done', label: 'Done', tone: 'secondary', todoId: '1' },
        { id: 'skip', label: 'Skip', tone: 'secondary', todoId: '1' },
      ],
    },
    BLANK,
  ])
})

test('an expanded item shows every script row and Show less', () => {
  const { rows } = build([todo({ kind: 'run', script: script5 })], ['1'])

  expect(rows.filter(r => r.kind === 'text' && r.tone === 'script')).toHaveLength(5)
  const more = rows.find(r => r.kind === 'buttons' && r.buttons[0]?.id === 'more')
  expect(more).toEqual({ kind: 'buttons', buttons: [{ id: 'more', label: 'Show less', tone: 'neutral', todoId: '1' }] })
})

test('a confirming item shows the whole script and the confirm prompt, with no more button', () => {
  const { rows } = build([todo({ kind: 'run', script: script5, status: 'confirming' })], [], 60)

  expect(rows.filter(r => r.kind === 'text' && r.tone === 'script')).toHaveLength(5)
  expect(rows.some(r => r.kind === 'buttons' && r.buttons.some(b => b.id === 'more'))).toBe(false)
  expect(rows).toContainEqual(text('Are you sure you want to run this script?', 'plain', true))
  expect(rows.at(-2)).toEqual({
    kind: 'buttons',
    buttons: [
      { id: 'confirm', label: 'Confirm', tone: 'primary', todoId: '1' },
      { id: 'cancel', label: 'Cancel', tone: 'neutral', todoId: '1' },
    ],
  })
})

test('a note shows under the detail, link and image rows are cyan, and a long title wraps at word breaks', () => {
  const { rows } = build([
    todo({ id: '1', title: 'Store the token for the replay workspace before the pilot runs', detail: 'D', note: 'Stopped' }),
    todo({ id: '2', kind: 'link', url: 'https://example.com' }),
    todo({ id: '3', kind: 'image', paths: ['/shots/light.png', '/shots/dark.png'] }),
  ])

  expect(rows.slice(0, 4)).toEqual([
    text('○ Store the token for the replay', 'title'),
    text('workspace before the pilot runs', 'title'),
    text('D', 'dim', true),
    text('Stopped', 'warning', true),
  ])
  expect(rows).toContainEqual(text('https://example.com', 'link', true))
  expect(rows).toContainEqual(text('light.png, dark.png', 'link', true))
})

test('a running item starts with the spin frame, caps its tail by runner, and leads its buttons with Running', () => {
  const tail = Array.from({ length: 20 }, (_, n) => `l${n}`)
  const local = build([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'local', liveTail: tail })]).rows
  const herdr = build([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'herdr', liveTail: tail })]).rows
  const tailRows = (rows: PaneRow[]) => rows.filter(r => r.kind === 'text' && r.tone === 'dim')

  expect(local[0]).toEqual(spinning('⠋ Do it'))
  expect(tailRows(local).map(r => (r as { text: string }).text)).toEqual(tail.slice(-15))
  expect(tailRows(herdr).map(r => (r as { text: string }).text)).toEqual(['l17', 'l18', 'l19'])
  expect(herdr.at(-2)).toEqual({
    kind: 'buttons',
    lead: { text: '⠋ Running', tone: 'warning', spin: true, pad: true },
    buttons: [
      { id: 'show', label: 'Show', tone: 'primary', todoId: '1' },
      { id: 'stop', label: 'Stop', tone: 'caution', todoId: '1' },
    ],
  })
  expect(local.at(-2)).toMatchObject({ buttons: [{ id: 'openLog', tone: 'neutral' }, { id: 'stop' }] })
})

test('only the first row of a wrapped running title carries spin', () => {
  const { rows } = build([todo({ title: 'Store the token for the replay workspace before the pilot runs', status: 'running', runner: 'herdr' })])

  expect(rows.slice(0, 2)).toEqual([spinning('⠋ Store the token for the replay'), text('workspace before the pilot runs', 'title')])
})

test('a running item with no tail has no tail padding, and a stopping one reads Stopping with Force stop', () => {
  const { rows } = build([todo({ kind: 'run', script: 'ls', status: 'running', runner: 'herdr', isStopping: true })])

  expect(rows.slice(-3, -1)).toEqual([
    BLANK,
    {
      kind: 'buttons',
      lead: { text: '⠋ Stopping…', tone: 'error', spin: true, pad: true },
      buttons: [
        { id: 'show', label: 'Show', tone: 'primary', todoId: '1' },
        { id: 'forceStop', label: 'Force stop', tone: 'caution', todoId: '1' },
      ],
    },
  ])
})

test('finished items show only the last 8, with marks and exit codes, then a Clear finished button', () => {
  const finished: Todo[] = Array.from({ length: 10 }, (_, n) => todo({ id: `f${n}`, title: `F${n}`, status: 'done' }))
  const { rows, hasFinished } = build([
    ...finished,
    todo({ id: 'x', title: 'Broke', status: 'failed', exitCode: 2 }),
    todo({ id: 'y', title: 'Zero', status: 'failed', exitCode: 0 }),
    todo({ id: 'z', title: 'Passed over', status: 'skipped' }),
    todo({ id: 'o', title: 'Open' }),
  ])
  const marks = rows.filter(r => r.kind === 'finished')

  expect(hasFinished).toBe(true)
  expect(marks).toHaveLength(8)
  expect(marks.map(r => r.title)).not.toContain('F0')
  expect(marks.at(-3)).toEqual({ kind: 'finished', mark: '✗', tone: 'error', title: 'Broke', exit: 2 })
  expect(marks.at(-2)).toEqual({ kind: 'finished', mark: '✗', tone: 'error', title: 'Zero' })
  expect(marks.at(-1)).toEqual({ kind: 'finished', mark: '–', tone: 'inactive', title: 'Passed over' })
  expect(marks[0]).toEqual({ kind: 'finished', mark: '✓', tone: 'success', title: 'F5' })
  expect(rows.slice(-2)).toEqual([BLANK, { kind: 'buttons', flush: true, buttons: [{ id: 'clear', label: 'Clear finished', tone: 'neutral' }] }])
})

test('with nothing to do, the notice, a blank, the finished rows, a blank and Clear finished', () => {
  const { rows, spans } = build([todo({ title: 'Fine', status: 'done' })])

  expect(rows).toEqual([
    text('Nothing for you right now.', 'dim'),
    BLANK,
    { kind: 'finished', mark: '✓', tone: 'success', title: 'Fine' },
    BLANK,
    { kind: 'buttons', flush: true, buttons: [{ id: 'clear', label: 'Clear finished', tone: 'neutral' }] },
  ])
  expect(spans).toEqual([{ first: 2, last: 2 }])
})

test('the notice has no blank after it when nothing finished either', () => {
  const { rows, hasFinished } = build([])
  expect(rows).toEqual([text('Nothing for you right now.', 'dim')])
  expect(hasFinished).toBe(false)
})

test('Clear finished beside a running item carries no todo id and comes after the running rows', () => {
  const { rows } = build([todo({ id: '1', kind: 'run', script: 'ls', status: 'running', runner: 'herdr' }), todo({ id: '2', status: 'done' })])
  const clear = rows.findIndex(r => r.kind === 'buttons' && r.buttons.some(b => b.id === 'clear'))
  const running = rows.findIndex(r => r.kind === 'buttons' && r.lead?.text === '⠋ Running')
  const fin = rows.findIndex(r => r.kind === 'finished')
  const button = (rows[clear] as { buttons: { todoId?: string }[] }).buttons[0]

  expect(running).toBeLessThan(fin)
  expect(fin).toBeLessThan(clear)
  expect(button && 'todoId' in button).toBe(false)
})

test('spans cover each actionable item without its trailing blank, then one row per finished item', () => {
  const { rows, spans } = build([todo({ id: '1', title: 'One' }), todo({ id: '2', title: 'Two' }), todo({ id: '3', title: 'Old', status: 'done' })])

  // per item: title, blank, buttons, then a blank that no span covers
  expect(spans).toEqual([
    { first: 0, last: 2 },
    { first: 4, last: 6 },
    { first: 8, last: 8 },
  ])
  expect(rows[8]).toMatchObject({ kind: 'finished', title: 'Old' })
  expect(rows[3]).toEqual(BLANK)
})

test('bandModel counts open and confirming items and has nothing when none wait', () => {
  expect(bandModel([todo({ id: '1' }), todo({ id: '2', status: 'confirming' }), todo({ id: '3', status: 'done' })])).toEqual({ waiting: 2, title: '2 to-dos' })
  expect(bandModel([todo({})])).toEqual({ waiting: 1, title: '1 to-do' })
  expect(bandModel([todo({ status: 'done' }), todo({ id: '2', status: 'running' })])).toBeUndefined()
  expect(bandModel([])).toBeUndefined()
})

test('endRows close an overflowing list: a blank first only after the finished list', () => {
  const end = text("You've reached the end of the list.", 'dim')
  expect(endRows(build([todo({})]))).toEqual([end])
  expect(endRows(build([todo({}), todo({ id: '2', status: 'done' })]))).toEqual([BLANK, end])
})

test('outOfView counts the items that start above the window and end below it', () => {
  const spans = [
    { first: 0, last: 2 },
    { first: 4, last: 6 },
    { first: 8, last: 8 },
  ]
  expect(outOfView(spans, 0, 8)).toEqual({ above: 0, below: 0 })
  expect(outOfView(spans, 1, 5)).toEqual({ above: 1, below: 2 })
  expect(outOfView(spans, 5, 7)).toEqual({ above: 2, below: 1 })
})
