import { expect, test } from 'claude-code/testing'

import { startSession, world } from './test-world'

const LEDGER = 'Write your ledger now: the one your current skill keeps, or if none does, these sections: Goal, Where, Done, In progress, Next step, Decisions, Learned, Waiting on the user. Then call mcp__fresh-context__fresh_context with mode'

test('/fresh is registered with its description', async ($, on) => {
  const w = world(on)
  await startSession($)
  expect(w.commandsRegistered).toEqual([{ name: 'fresh', description: 'Write your ledger, then start fresh (clear by default)' }])
})

test('a bare /fresh asks for a clear with no then', async ($, on) => {
  const w = world(on)
  await startSession($)
  const ran = await $.command.run({ command: 'fresh', args: '', origin: 'user' } as never)
  await w.clock.settle()
  expect(ran).toMatchObject({ text: 'Asked the session to write its ledger and reset (clear).' })
  expect(w.submitted).toEqual([`${LEDGER} "clear", the ledger, and no then.`])
})

test('/fresh compact with a note passes the note as then', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.command.run({ command: 'fresh', args: 'compact pick up the review', origin: 'user' } as never)
  await w.clock.settle()
  expect(w.submitted).toEqual([`${LEDGER} "compact", the ledger, and then "pick up the review".`])
})

test('/fresh with no mode word treats it all as the note', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.command.run({ command: 'fresh', args: 'nonsense', origin: 'user' } as never)
  await w.clock.settle()
  expect(w.submitted).toEqual([`${LEDGER} "clear", the ledger, and then "nonsense".`])
})

test('/fresh reads its mode word in any case and keeps quotes in the note intact', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.command.run({ command: 'fresh', args: 'Compact say "done"', origin: 'user' } as never)
  await w.clock.settle()
  expect(w.submitted).toEqual([`${LEDGER} "compact", the ledger, and then ${JSON.stringify('say "done"')}.`])
})
