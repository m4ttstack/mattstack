import { expect, test } from 'bun:test'

import { bellArgs } from './bell'
import { addBoardGate, boardAddress, boardText, boardUrl, kindTitle, readBoardOnly } from './board'

test('board-only kinds have titles, and any other kind reads as words', () => {
  expect(kindTitle('review-post')).toBe('Review findings')
  expect(kindTitle('respond-plan')).toBe('Respond plan')
  expect(kindTitle('respond-post')).toBe('Respond replies')
  expect(kindTitle('plan-review')).toBe('Plan review')
  expect(kindTitle('')).toBe('A gate')
})

test('the board address is the board row’s port on localhost, from JSON', () => {
  expect(boardAddress(JSON.stringify({ apps: [{ name: 'deck', port: 7940 }, { name: 'board', port: 11006 }] }))).toBe('http://localhost:11006')
  expect(boardAddress(JSON.stringify([{ name: 'board', port: 11007 }]))).toBe('http://localhost:11007')
})

test('the board address is read from deck’s table when deck prints one', () => {
  const table = ['mantine-kit              11003  up    user', 'deck                     7940   up    deck', 'board                    11006  up    rt', ''].join('\n')
  expect(boardAddress(table)).toBe('http://localhost:11006')
})

test('no board row, or a board with no port, is no address', () => {
  expect(boardAddress(JSON.stringify({ apps: [{ name: 'deck', port: 7940 }] }))).toBeUndefined()
  expect(boardAddress(JSON.stringify({ apps: [{ name: 'board', port: null }] }))).toBeUndefined()
  expect(boardAddress('board                    -      -     rt')).toBeUndefined()
  expect(boardAddress('')).toBeUndefined()
})

test('the link opens the gate on the board', () => {
  expect(boardUrl('http://localhost:11006', 'g 1')).toBe('http://localhost:11006/?gate=g%201')
})

test('the band names the newest gate and how many more wait', () => {
  expect(boardText([{ gateId: 'g1', kind: 'review-post' }])).toBe('Review findings is waiting on the board')
  expect(boardText([{ gateId: 'g1', kind: 'review-post' }, { gateId: 'g2', kind: 'respond-plan' }, { gateId: 'g3', kind: 'respond-post' }])).toBe(
    'Respond replies is waiting on the board, 2 more',
  )
})

test('a board-only wait result is read; anything else is not', () => {
  expect(readBoardOnly(JSON.stringify({ id: 'g1', boardOnly: true, paneAction: 'wait', supersededId: 'g0' }))).toEqual({ gateId: 'g1', supersededId: 'g0' })
  expect(readBoardOnly(JSON.stringify({ id: 'g1', boardOnly: true, paneAction: 'form' }))).toBeUndefined()
  expect(readBoardOnly(JSON.stringify({ id: 'g1', boardOnly: false, paneAction: 'wait' }))).toBeUndefined()
  expect(readBoardOnly('spilled to a file')).toBeUndefined()
})

test('a board gate joins the list once, and takes the place of the gate it supersedes', () => {
  const one = addBoardGate([], { gateId: 'g1', kind: 'review-post' })
  expect(addBoardGate(one, { gateId: 'g1', kind: 'review-post' })).toEqual(one)
  expect(addBoardGate(one, { gateId: 'g2', kind: 'review-post' }, 'g1')).toEqual([{ gateId: 'g2', kind: 'review-post' }])
})

test('the bell is herdr’s request notification, named after the working directory, as herdr-doorbell.sh rings it', () => {
  const long = 'x'.repeat(200)
  expect(bellArgs('/Users/t/repo/', [{ label: 'Plan  tier\nnow' }, { label: 'b' }], 'request')).toEqual([
    'notification',
    'show',
    'repo needs you',
    '--body',
    'Plan tier now  (+1 more)',
    '--sound',
    'request',
  ])
  expect(bellArgs('/', [{ label: long }], 'request')[4]).toBe(`${'x'.repeat(137)}...`)
  expect(bellArgs('/', [{ label: '' }], 'request')[2]).toBe('claude needs you')
  expect(bellArgs('/', [{ label: '' }], 'request')[4]).toBe('needs an answer')
})

test('a bell can show without a sound', () => {
  expect(bellArgs('/Users/t/repo', [{ label: 'Plan tier' }], 'none').slice(-2)).toEqual(['--sound', 'none'])
})
