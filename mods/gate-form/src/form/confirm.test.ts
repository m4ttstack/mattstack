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

test("a confirm's Client draws only its head: title, context and the rail's end, with no answers, hint or question line", () => {
  const lines = linesOf(form, initial(form)).map(textOf)
  const at = (word: string) => lines.findIndex(l => l.includes(word))
  expect(at('MR !267 merged')).toBeLessThan(at('rt is cleaning up'))
  expect(at('rt is cleaning up')).toBeLessThan(lines.findIndex(l => l.trim() === '└'))
  const text = lines.join('\n')
  for (const gone of ['Exit worktree', 'Close session', 'choose', '○', '●', 'Submit', 'Cancel', 'What should', '├']) expect(text).not.toContain(gone)
})

test('with no context, the title is followed straight by the rail end, with no separator', () => {
  const lines = linesOf(bare, initial(bare)).map(textOf)
  const title = lines.findIndex(l => l.includes('MR !267 merged'))
  expect(lines[title + 1]!.trim()).toBe('│')
  expect(lines[title + 2]!.trim()).toBe('└')
  expect(lines.join('\n')).not.toContain('├')
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

test('the rail is one colour from top to bottom, with or without context', () => {
  for (const f of [form, bare]) {
    const rails = linesOf(f, initial(f))
      .map(line => line.find(span => /^[┌│└]$/.test(span.t)))
      .filter(span => span !== undefined)
    expect(rails.length).toBeGreaterThan(2)
    expect(new Set(rails.map(span => span!.color)).size).toBe(1)
  }
})
