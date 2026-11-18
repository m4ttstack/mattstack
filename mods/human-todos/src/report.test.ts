import { expect, mock, test } from 'bun:test'

import type { Todo } from '../types'

// The engine package exists only inside Claude Code; report.ts reaches it through the store.
mock.module('claude-code', () => ({ atom: () => ({}), read: async () => undefined, update: async () => undefined }))
const { settle } = await import('./report')

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'run', title: 'T', script: 'ls -la', status: 'open', ...over })

test('settle turns each outcome into the item change and the message to the agent', () => {
  const t = todo({ liveTail: ['x'], isStopping: true })

  expect(settle(t, { kind: 'ran', exitCode: 0, outputTail: 'ok' }, '/logs/run.log')).toEqual({
    patch: { status: 'done', exitCode: 0, outputTail: 'ok', liveTail: undefined, isStopping: false },
    text: 'The user ran #1 "T" from the pane: exit 0. Output: /logs/run.log',
  })
  const failed = settle(t, { kind: 'ran', exitCode: 3, outputTail: '' })
  expect(failed.patch.status).toBe('failed')
  expect(failed.patch.exitCode).toBe(3)
  expect(failed.text).toBe('The user ran #1 "T" from the pane: exit 3. Output: (no output)')
  expect(settle(t, { kind: 'ran', exitCode: 0, outputTail: 'ok' }, null).text).toBe('The user ran #1 "T" from the pane: exit 0. Output: (the output could not be saved)')

  expect(settle(t, { kind: 'stopped', outputTail: 'half' }, '/logs/half.log')).toEqual({
    patch: { status: 'open', outputTail: 'half', note: 'Stopped', liveTail: undefined, isStopping: false },
    text: 'The user stopped #1 "T" before it finished. It is open again. Output: /logs/half.log',
  })
  expect(settle(t, { kind: 'ended', outputTail: '' })).toEqual({
    patch: { status: 'open', outputTail: '', note: 'Ended without an exit code.', liveTail: undefined, isStopping: false },
    text: '#1 "T" ended in its tab without reporting an exit code (most likely stopped). It is open again. Output: (no output)',
  })

  const long = Array.from({ length: 40 }, (_, n) => `line ${n}`).join('\n')
  const kept = settle(t, { kind: 'ran', exitCode: 0, outputTail: long }).patch.outputTail?.split('\n')
  expect(kept).toHaveLength(30)
  expect(kept?.[0]).toBe('line 10')
})

test('a message from the pane reaches the agent; Send & mark done also finishes the item', () => {
  const t = todo({ title: 'Sign in' })
  expect(settle(t, { kind: 'message', text: 'use the staging account', done: false })).toEqual({ patch: {}, text: '#1 "Sign in": the user says: use the staging account' })
  expect(settle(t, { kind: 'message', text: 'all set', done: true })).toEqual({ patch: { status: 'done' }, text: '#1 "Sign in": the user marked it done and says: all set' })
})
