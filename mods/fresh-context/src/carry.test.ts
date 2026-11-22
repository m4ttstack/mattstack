import { expect, test } from 'bun:test'

import { carryPath, ledgerMessage, parseCarry, type Carry } from './carry.ts'

test('parseCarry round-trips a carry', () => {
  const carry: Carry = { mode: 'clear', ledger: 'Goal: ship it', then: '/mattstack:pr-usher', oldSessionId: 's-old', chatHandle: 'pansy.ab12', createdAt: 1 }
  expect(parseCarry(JSON.stringify(carry))).toEqual(carry)
  const bare: Carry = { mode: 'compact', ledger: 'x', oldSessionId: 's', createdAt: 2 }
  expect(parseCarry(JSON.stringify(bare))).toEqual(bare)
})

test('parseCarry rejects bad JSON and a carry missing its fields', () => {
  expect(parseCarry('{}')).toBeNull()
  expect(parseCarry('not json')).toBeNull()
  expect(parseCarry(JSON.stringify({ mode: 'wipe', ledger: 'x', oldSessionId: 's', createdAt: 1 }))).toBeNull()
  expect(parseCarry(JSON.stringify({ mode: 'clear', ledger: 'x', oldSessionId: 's', createdAt: 1, then: 3 }))).toBeNull()
})

test('ledgerMessage wraps the ledger in its fixed header', () => {
  expect(ledgerMessage('x')).toBe('Ledger carried from before the reset:\n\nx')
})

test('carryPath names one file per old session', () => {
  expect(carryPath('/data', 'abc')).toBe('/data/carry-abc.json')
})
