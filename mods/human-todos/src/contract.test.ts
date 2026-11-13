import { expect, mock, test } from 'bun:test'

// The engine package exists only inside Claude Code; contract.ts reaches it through the store.
mock.module('claude-code', () => ({ atom: () => ({}), read: async () => undefined, update: async () => undefined }))
const { addDescription } = await import('./contract')

test('the add description names every kind and forbids asking for "done"', () => {
  const text = addDescription('Human Todos')
  for (const kind of ['task', 'run', 'terminal', 'link', 'image']) expect(text).toContain(kind)
  expect(text).toContain('never ask them to type "done"')
})
