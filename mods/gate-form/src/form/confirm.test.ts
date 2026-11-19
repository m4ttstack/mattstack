import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { pluginForm } from '../gate/parse'
import { keyEffect, pressesButton } from './input'
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

test("a confirm's Client draws only its head: the brand bar title and the context, with no answers, hint or question line", () => {
  const lines = linesOf(form, initial(form)).map(textOf)
  const at = (word: string) => lines.findIndex(l => l.includes(word))
  expect(at('mattstack · MR !267 merged')).toBeGreaterThan(-1)
  expect(at('MR !267 merged')).toBeLessThan(at('rt is cleaning up'))
  const text = lines.join('\n')
  for (const gone of ['Exit worktree', 'Close session', 'choose', '○', '●', 'Submit', 'Cancel', 'What should', '├', '└']) expect(text).not.toContain(gone)
})

test('with no context, the brand bar title is all that is drawn', () => {
  const lines = linesOf(bare, initial(bare)).map(textOf).filter(l => l.trim() !== '')
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('mattstack · MR !267 merged')
})

test("the Client leaves a confirm's keys alone: its engine Buttons take them", () => {
  for (const key of ['return', 'up', 'down', 'left', 'right', 'tab', '1', '2']) {
    expect(keyEffect({ key }, form, initial(form))).toBeUndefined()
    expect(pressesButton({ key }, form, initial(form))).toBe(false)
  }
})

test('a confirm takes 2 or 3 options and an optional label; kind is checked', () => {
  expect(form.confirm).toBe(true)
  expect(pluginForm({ ...ARGS, options: ARGS.options.slice(0, 1) })).toBeString()
  expect(pluginForm({ ...ARGS, options: [...ARGS.options, { value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })).toBeString()
  expect(pluginForm({ ...ARGS, kind: 'dialog' })).toBeString()
  expect((pluginForm({ ...ARGS, kind: undefined, label: 'Pick' }) as Form).confirm).toBeUndefined()
})

test('a confirm draws no rail, with or without context', () => {
  for (const f of [form, bare]) {
    const rails = linesOf(f, initial(f)).flatMap(line => line.filter(span => /[┌│└├]/.test(span.t)))
    expect(rails).toEqual([])
  }
})
