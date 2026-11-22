import { expect, test } from 'claude-code/testing'

import { NEW, OLD, startSession, stop, world } from './test-world'

const TOOL = 'mcp__fresh-context__fresh_context'

test('the tool is registered, not deferred, and allowed', async ($, on) => {
  const w = world(on)
  on('tool.check', () => ({ decision: 'ask' }))
  await startSession($)

  expect(w.registered.map(t => t.name)).toEqual(['fresh_context'])
  expect(w.registered[0]?.isDeferred).toBe(false)
  const schema = w.registered[0]?.inputSchema as { required: string[]; properties: { mode: { enum: string[] } } }
  expect(schema.required).toEqual(['mode', 'ledger'])
  expect(schema.properties.mode.enum).toEqual(['clear', 'compact'])
  expect(await $.tool.check({ tool: TOOL, input: {} })).toMatchObject({ decision: 'allow' })
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).toMatchObject({ decision: 'ask' })
})

test('clear mode begins the chat hand-off and queues the reset', async ($, on) => {
  const w = world(on)
  await startSession($)

  const called = await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'Goal: x' })
  expect(called.result).toBe('Reset queued: clear after this turn.')
  expect(w.verbs()).toEqual(['begin'])
  expect(w.rt[0]?.sessionId).toBe(OLD)
  expect(w.commands).toEqual([])

  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

test('a running subagent refuses a clear and names it', async ($, on) => {
  const w = world(on)
  w.agents.push({ id: 'a1', type: 'general-purpose', description: 'Review group A', status: 'running' })
  await startSession($)

  const refused = await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  expect(refused).toMatchObject({ deny: 'Not now: still running\nsubagent: Review group A' })
  expect(w.verbs()).toEqual([])
})

test('a background shell at turn end abandons the reset', async ($, on) => {
  const w = world(on)
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  await stop($, [{ id: 't1', type: 'shell', status: 'running', description: 'npm run dev' }])
  await w.clock.settle()
  expect(w.commands).toEqual([])
  expect(w.verbs()).toEqual(['begin', 'cancel --from sess-old'])
  expect(w.submitted).toEqual(['fresh_context did not run: still running\nshell: npm run dev'])
})

test('after the clear, complete runs and the ledger is appended before then is submitted', async ($, on) => {
  const w = world(on)
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'Goal: x', then: 'carry on' })
  await stop($)
  await w.clock.settle()
  await $.session.end({ reason: 'clear', sessionId: OLD, resume: undefined as never })
  w.state.sessionId = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW })
  await w.clock.settle()

  expect(w.verbs()).toEqual(['begin', 'complete --from sess-old'])
  expect(w.rt[1]?.sessionId).toBe(NEW)
  expect(w.appended()).toEqual(['Ledger carried from before the reset:\n\nGoal: x'])
  expect(w.submitted).toEqual(['carry on'])
})

test('a then starting with / runs as a command', async ($, on) => {
  const w = world(on)
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x', then: '/mattstack:pr-usher tick' })
  await stop($)
  await w.clock.settle()
  w.state.sessionId = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW })
  await w.clock.settle()
  expect(w.commands).toEqual(['clear', 'mattstack:pr-usher tick'])
  expect(w.submitted).toEqual([])
})

test('no then: the ledger is appended and no turn is started', async ($, on) => {
  const w = world(on, { signedIn: false })
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  await stop($)
  await w.clock.settle()
  w.state.sessionId = NEW
  await $.classic.SessionStart({ source: 'clear', session_id: NEW })
  await w.clock.settle()
  expect(w.verbs()).toEqual(['begin'])
  expect(w.appended()).toHaveLength(1)
  expect(w.submitted).toEqual([])
})

test('compact mode passes the ledger as compaction instructions and does no hand-off', async ($, on) => {
  const w = world(on)
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'compact', ledger: 'Keep the PR list', then: 'next' })
  await stop($, [{ id: 't1', type: 'shell', status: 'running', description: 'npm run dev' }])
  await w.clock.settle()
  expect(w.compactions).toEqual(['Keep the PR list'])
  expect(w.commands).toEqual([])
  expect(w.verbs()).toEqual([])
  expect(w.appended()).toEqual(['Ledger carried from before the reset:\n\nKeep the PR list'])
  expect(w.submitted).toEqual(['next'])
})

test('a skipped compaction is reported and nothing is handed over', async ($, on) => {
  const w = world(on)
  w.state.compact.skip = 'nothing to compact'
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'compact', ledger: 'x', then: 'next' })
  await stop($)
  await w.clock.settle()
  expect(w.appended()).toEqual([])
  expect(w.submitted).toEqual(['fresh_context did not run: the compaction was skipped (nothing to compact)'])
})

test('an exit with a queued reset cancels the hand-off', async ($, on) => {
  const w = world(on)
  await startSession($)

  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: OLD, resume: undefined as never })
  expect(w.verbs()).toEqual(['begin', 'cancel --from sess-old'])
})

test('a reset queued before a reload of the mod is handed over at session.start', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'Goal: x', then: 'go' })

  w.state.sessionId = NEW
  await startSession($)
  await w.clock.settle()
  expect(w.verbs()).toEqual(['begin', 'complete --from sess-old'])
  expect(w.appended()).toEqual(['Ledger carried from before the reset:\n\nGoal: x'])
  expect(w.submitted).toEqual(['go'])
})

test('a second call in the same turn is refused', async ($, on) => {
  world(on)
  await startSession($)
  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  expect(await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })).toMatchObject({ deny: 'A reset is already queued for the end of this turn.' })
})

test('rt runs by argv with no shell, rt on PATH first', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  expect(w.argv0).toEqual(['rt'])
})

test('a Stop hook that keeps the turn going holds the reset for the real end of the turn', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  w.state.stopBlocks = true
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual([])
  w.state.stopBlocks = false
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])
})

test('a clear that never happens is abandoned at the next turn end, and the tool works again', async ($, on) => {
  const w = world(on)
  await startSession($)
  await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'x' })
  await stop($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear'])

  await stop($)
  await w.clock.settle()
  expect(w.verbs()).toEqual(['begin', 'cancel --from sess-old'])
  expect(w.submitted).toEqual(['fresh_context did not run: the clear did not happen'])
  expect((await $.tool.call({ tool: TOOL, mode: 'clear', ledger: 'y' })).result).toBe('Reset queued: clear after this turn.')
})
