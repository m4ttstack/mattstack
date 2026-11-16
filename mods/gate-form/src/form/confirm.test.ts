import { expect, test } from 'bun:test'

import { FILL } from '@mattstack/mod-kit'

import type { Form } from '../../types'
import { pluginForm } from '../gate/parse'
import { keyEffect, perform } from './input'
import { initial, type State } from './state'
import { visibleLines } from './view'

const ARGS = {
  title: 'MR !267 merged',
  kind: 'confirm',
  context: 'rt is cleaning up this worktree. No answer in 2 minutes moves this session out.',
  options: [
    { value: 'leave', label: 'Exit worktree and continue' },
    { value: 'close', label: 'Close session' },
  ],
  timeoutMs: 120_000,
}
const form = pluginForm(ARGS) as Form
const bare = pluginForm({ ...ARGS, context: undefined }) as Form

const textOf = (line: { t: string }[]) => line.map(s => s.t).join('')
const linesOf = (f: Form, s: State) => visibleLines(f, s, { width: 70, focused: true }, 80)
const buttonRow = (f: Form, s: State) => linesOf(f, s).find(line => textOf(line).includes('Close session'))!
const answer = (value: string) => ({ type: 'answer', formId: form.id, answers: { choice: value } })

test('a confirm draws the title, the context and the options as one row of buttons, with no question line or radio rows', () => {
  const lines = linesOf(form, initial(form)).map(textOf)
  const text = lines.join('\n')
  expect(lines.findIndex(l => l.includes('MR !267 merged'))).toBeLessThan(lines.findIndex(l => l.includes('rt is cleaning up')))
  expect(textOf(buttonRow(form, initial(form)))).toContain('Exit worktree and continue')
  for (const gone of ['○', '●', 'Submit', 'Cancel', 'What should', '├']) expect(text).not.toContain(gone)
  expect(text).toContain('←→ choose   enter presses')
})

test('the finishing option sits on the right in solid, the other on the left in solidMuted, and it has focus', () => {
  const row = buttonRow(form, initial(form))
  const exit = row.findIndex(span => span.t.includes('Exit worktree'))
  const close = row.findIndex(span => span.t.includes('Close session'))
  expect(initial(form).cursor[0]).toBe(0)
  expect(close).toBeLessThan(exit)
  expect(row[exit]?.bg).toBe(FILL.solid.bg)
  expect(row[close]?.bg).toBe(FILL.solidMuted.bg)
  expect(row.slice(close + 1, exit).some(span => span.t.includes('▎'))).toBe(true)
  expect(row.slice(0, close).some(span => span.t.includes('▎'))).toBe(false)
})

test('focus moves the ▎ mark, not the colours', () => {
  const row = buttonRow(form, keyEffect({ key: 'left' }, form, initial(form))!.state)
  const exit = row.findIndex(span => span.t.includes('Exit worktree'))
  const close = row.findIndex(span => span.t.includes('Close session'))
  expect(row[exit]?.bg).toBe(FILL.solid.bg)
  expect(row[close]?.bg).toBe(FILL.solidMuted.bg)
  expect(row.slice(0, close).some(span => span.t.includes('▎'))).toBe(true)
  expect(row.slice(close + 1, exit).some(span => span.t.includes('▎'))).toBe(false)
})

test('the order is title, context, buttons, then the hint', () => {
  const lines = linesOf(form, initial(form)).map(textOf)
  const at = (word: string) => lines.findIndex(l => l.includes(word))
  expect(at('MR !267 merged')).toBeLessThan(at('rt is cleaning up'))
  expect(at('rt is cleaning up')).toBeLessThan(at('Close session'))
  expect(at('Close session')).toBeLessThan(at('←→ choose'))
})

test('with no context, the title is followed straight by the rail end, with no separator', () => {
  const lines = linesOf(bare, initial(bare)).map(textOf)
  const title = lines.findIndex(l => l.includes('MR !267 merged'))
  expect(lines[title + 1]!.trim()).toBe('│')
  expect(lines[title + 2]!.trim()).toBe('└')
  expect(lines.join('\n')).not.toContain('├')
})

test('arrows and Tab move focus left to right as drawn and stop at the ends', () => {
  const left = keyEffect({ key: 'left' }, form, initial(form))!.state
  expect(left.cursor[0]).toBe(1)
  expect(keyEffect({ key: 'left' }, form, left)!.state.cursor[0]).toBe(1)
  expect(keyEffect({ key: 'right' }, form, left)!.state.cursor[0]).toBe(0)
  expect(keyEffect({ key: 'right' }, form, initial(form))!.state.cursor[0]).toBe(0)
  expect(keyEffect({ key: 'tab', shift: true }, form, initial(form))!.state.cursor[0]).toBe(1)
  expect(keyEffect({ key: 'tab' }, form, left)!.state.cursor[0]).toBe(0)
})

test('Enter presses the focused button and sends its value', () => {
  expect(keyEffect({ key: 'return' }, form, initial(form))?.post).toEqual(answer('leave'))
  const left = keyEffect({ key: 'left' }, form, initial(form))!.state
  const pressed = keyEffect({ key: 'return' }, form, left)
  expect(pressed?.post).toEqual(answer('close'))
  expect(pressed?.state.phase).toBe('submitted')
})

test('a click on a button presses it', () => {
  const action = buttonRow(form, initial(form)).find(span => span.t.includes('Close session'))?.action
  expect(action).toEqual({ type: 'option', idx: 1 })
  expect(perform(action!, form, initial(form))?.post).toEqual(answer('close'))
})

test('a confirm takes 2 or 3 options and an optional label; kind is checked', () => {
  expect(form.confirm).toBe(true)
  expect(pluginForm({ ...ARGS, options: ARGS.options.slice(0, 1) })).toBeString()
  expect(pluginForm({ ...ARGS, options: [...ARGS.options, { value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })).toBeString()
  expect(pluginForm({ ...ARGS, kind: 'dialog' })).toBeString()
  expect((pluginForm({ ...ARGS, kind: undefined, label: 'Pick' }) as Form).confirm).toBeUndefined()
})

test('the rail is one colour from top to bottom, with or without context', () => {
  for (const f of [form, bare]) {
    const rails = linesOf(f, initial(f))
      .map(line => line.find(span => /^[┌│└]$/.test(span.t)))
      .filter(span => span !== undefined)
    expect(rails.length).toBeGreaterThan(2)
    expect(new Set(rails.map(span => span!.color)).size).toBe(1)
  }
})
