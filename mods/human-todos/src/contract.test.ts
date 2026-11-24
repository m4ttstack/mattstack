import { expect, mock, test } from 'bun:test'

// The engine package exists only inside Claude Code; contract.ts reaches it through the store.
mock.module('claude-code', () => ({ atom: () => ({}), read: async () => undefined, update: async () => undefined }))
const { addDescription, guidance } = await import('./contract')

test('the add description names every kind and forbids asking for "done"', () => {
  const text = addDescription('Human Todos')
  for (const kind of ['task', 'run', 'terminal', 'link', 'image']) expect(text).toContain(kind)
  expect(text).toContain('never ask them to type "done"')
})

test('neither text offers the pane as a way past a refused command', () => {
  const guide = guidance({ add: 'add', list: 'list', withdraw: 'withdraw' })
  expect(addDescription('Human Todos')).not.toContain('(denied')
  for (const text of [addDescription('Human Todos'), guide]) expect(text).toContain('Never use it to get a refused command run')
})
