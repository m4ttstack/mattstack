import { expect, test } from 'bun:test'

import { busyTasks } from './busy.ts'

test('a running background shell is busy', () => {
  expect(busyTasks([], [{ type: 'shell', status: 'running', description: 'npm run dev' }])).toEqual(['shell: npm run dev'])
})

test('a pending wakeup is not busy', () => {
  expect(busyTasks([], [{ type: 'wakeup', status: 'pending', description: 'next tick' }])).toEqual([])
})

test('a running subagent is busy', () => {
  expect(busyTasks([{ id: 'a1', description: 'Review group A', status: 'running' }], [])).toEqual(['subagent: Review group A'])
})

test('finished work is not busy', () => {
  expect(busyTasks(
    [{ id: 'a1', description: 'done reviewer', status: 'completed' }],
    [{ type: 'monitor', status: 'completed', description: 'tail' }, { type: 'workflow', status: 'pending', description: 'wf' }],
  )).toEqual(['workflow: wf'])
})
