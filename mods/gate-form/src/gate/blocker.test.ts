import { expect, test } from 'bun:test'

import { BLOCKER_MESSAGE_MAX, clearArgs, raiseArgs } from './blocker'

test('raiseArgs reports the gate blocker on the pane with its message', () => {
  expect(raiseArgs('p-1', 'plan-review, 1 more waiting')).toEqual(['pane', 'report-blocker', 'p-1', '--source', 'mattstack:gate', '--message', 'plan-review, 1 more waiting'])
})

test('clearArgs clears the gate blocker on the pane', () => {
  expect(clearArgs('p-1')).toEqual(['pane', 'clear-blocker', 'p-1', '--source', 'mattstack:gate'])
})

test('the message cap is the one herdr cuts a blocker message at', () => {
  expect(BLOCKER_MESSAGE_MAX).toBe(80)
})
