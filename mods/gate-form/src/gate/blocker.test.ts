import { expect, test } from 'bun:test'

import { clearArgs, raiseArgs } from './blocker'

test('raiseArgs reports the gate blocker on the pane with its message', () => {
  expect(raiseArgs('p-1', 'plan-review, 1 more waiting')).toEqual(['herdr', 'pane', 'report-blocker', 'p-1', '--source', 'mattstack:gate', '--message', 'plan-review, 1 more waiting'])
})

test('clearArgs clears the gate blocker on the pane', () => {
  expect(clearArgs('p-1')).toEqual(['herdr', 'pane', 'clear-blocker', 'p-1', '--source', 'mattstack:gate'])
})
