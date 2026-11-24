import { expect, test } from 'bun:test'

import { rowInput } from './row'

test('the row keeps the short fields and counts the questions', () => {
  expect(rowInput({ title: 'Next steps', context: '**Background**\n- one', questions: [{ id: 'a' }, { id: 'b' }] })).toEqual({ title: 'Next steps', questions: 2 })
  expect(rowInput({ kind: 'plan-review', sourcePath: '/x.json', handBack: true })).toEqual({ kind: 'plan-review', sourcePath: '/x.json', handBack: true })
})

test('long text is cut to one line, and nested values are left out', () => {
  const { title, modes } = rowInput({ title: `a\n  ${'b'.repeat(200)}`, modes: { reach: [1] } }) as Record<string, unknown>
  expect(title).toBe(`a ${'b'.repeat(77)}…`)
  expect(modes).toBeUndefined()
})

test('an input that is no object, or an empty one, is left as it is', () => {
  expect(rowInput('raw')).toBe('raw')
  expect(rowInput(null)).toBeNull()
  expect(rowInput([1])).toEqual([1])
  expect(rowInput({})).toEqual({})
})
