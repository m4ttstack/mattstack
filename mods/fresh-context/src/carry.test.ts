import { expect, test } from 'bun:test'

import { ledgerMessage, skillIn, thenPrompt } from './carry.ts'

test('skillIn reads a named skill and what follows it, and leaves text and paths alone', () => {
  expect(skillIn('/mattstack:pr-usher tick now')).toEqual({ name: 'mattstack:pr-usher', args: 'tick now' })
  expect(skillIn('/clear')).toEqual({ name: 'clear', args: '' })
  expect(skillIn('/tmp/notes.md has the plan')).toBeUndefined()
  expect(skillIn('carry on')).toBeUndefined()
})

test('thenPrompt never starts with a slash, so it cannot run a command', () => {
  expect(thenPrompt('/mattstack:pr-usher tick')).toBe('Use the mattstack:pr-usher skill with: tick')
  expect(thenPrompt('/mattstack:pr-usher')).toBe('Use the mattstack:pr-usher skill')
  expect(thenPrompt('/tmp/notes.md has the plan')).toBe('Next step from before the reset: /tmp/notes.md has the plan')
  expect(thenPrompt('carry on')).toBe('carry on')
  for (const space of [' ', '\n', '\u00a0']) {
    expect(thenPrompt(`${space}/clear`)).toBe('Use the clear skill')
    expect(skillIn(`${space}/clear`)).toEqual({ name: 'clear', args: '' })
  }
})

test('ledgerMessage says where the text came from', () => {
  expect(ledgerMessage('Goal: x')).toBe('Ledger carried from before the reset:\n\nGoal: x')
})
