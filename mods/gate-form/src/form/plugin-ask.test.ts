import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { pluginForm } from '../gate/parse'
import { keyEffect, perform } from './input'
import { goTo, initial, type State } from './state'
import { visibleLines } from './view'

const ARGS = {
  title: 'PR #1144 merged',
  context: 'PR #1144 merged, so rt is cleaning up this worktree. Choose what this session does next.',
  label: 'What should this session do?',
  options: [
    { value: 'close', label: 'Close session' },
    { value: 'leave', label: 'Exit worktree and continue', description: 'Move to the main checkout' },
  ],
  timeoutMs: 120_000,
}
const form = pluginForm(ARGS) as Form

const textOf = (line: { t: string }[]) => line.map(s => s.t).join('')
const screen = (s: State) => visibleLines(form, s, { width: 70, focused: true }, 80).map(textOf).join('\n')

test('a plugin form is one single-pick question with no Something else row', () => {
  expect(form.source).toBe('plugin')
  expect(form.title).toBe('PR #1144 merged')
  expect(form.questions).toHaveLength(1)
  expect(form.questions[0]).toMatchObject({ multi: false, other: false, label: 'What should this session do?' })
  const page = screen(initial(form))
  expect(page).toContain('Close session')
  expect(page).toContain('Exit worktree and continue')
  expect(page).not.toContain('Something else')
})

test('a plugin form offers no More actions and no Chat about this', () => {
  for (const page of [0, 1]) {
    const shown = screen(goTo(form, initial(form), page))
    expect(shown).not.toContain('More actions')
    expect(shown).not.toContain('Chat about this')
  }
  expect(keyEffect({ key: 'x', ctrl: true }, form, initial(form))).toBeUndefined()
})

test('clicking an option sends it at once', () => {
  const picked = perform({ type: 'option', idx: 1 }, form, initial(form))
  expect(picked?.post).toEqual({ type: 'answer', formId: form.id, answers: { choice: 'leave' } })
  expect(picked?.state.phase).toBe('submitted')
})

test('Enter on an option sends it at once', () => {
  const down = keyEffect({ key: 'down' }, form, initial(form))!.state
  const picked = keyEffect({ key: 'return' }, form, down)
  expect(picked?.post).toEqual({ type: 'answer', formId: form.id, answers: { choice: 'leave' } })
})

test('ask arguments a form cannot draw are refused with the reason', () => {
  expect(pluginForm({ ...ARGS, options: [] })).toBeString()
  expect(pluginForm({ ...ARGS, options: [{ value: '', label: 'Blank' }] })).toBeString()
  expect(pluginForm({ ...ARGS, title: '' })).toBeString()
  expect(pluginForm({ ...ARGS, timeoutMs: 0 })).toBeString()
  expect(pluginForm(null)).toBeString()
})

test('a plugin form is one page: no tab strip, no review page, no nav row, no page hint', () => {
  const page = screen(initial(form))
  for (const gone of ['Submit', 'Choice', 'Review', 'Back', '←→', 'pages']) expect(page).not.toContain(gone)
  expect(page).toContain('↑↓ move  enter picks')
  expect(page).toContain('rt is cleaning up this worktree')
  expect(keyEffect({ key: 'right' }, form, initial(form))!.state.page).toBe(0)
  expect(keyEffect({ key: 'tab' }, form, initial(form))!.state).toEqual(initial(form))
})

test('up and down move between the options only', () => {
  const down = keyEffect({ key: 'down' }, form, initial(form))!.state
  expect(down.cursor[0]).toBe(1)
  expect(down.onNav).toBeUndefined()
  expect(keyEffect({ key: 'down' }, form, down)!.state.cursor[0]).toBe(1)
  expect(keyEffect({ key: 'up' }, form, down)!.state.cursor[0]).toBe(0)
})

test('with no context, nothing sits between the title and the question, and no divider is drawn', () => {
  const bare = pluginForm({ ...ARGS, context: undefined }) as Form
  const lines = visibleLines(bare, initial(bare), { width: 70, focused: true }, 80).map(textOf)
  const title = lines.findIndex(line => line.includes('PR #1144 merged'))
  expect(lines[title + 1]!.trim()).toBe('│')
  expect(lines[title + 2]).toContain('What should this session do?')
  expect(lines.join('\n')).not.toContain('├')
})
