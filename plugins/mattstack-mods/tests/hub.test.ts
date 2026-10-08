import { describe, expect, test } from 'claude-code/testing'
import { attachHub, createHub, START_TIMEOUT_MS } from '../src/core/hub.ts'
import { flush, harness as stub, recorder } from './stub.ts'

function harness(version = '2.1.293') {
  const h = stub({ version })
  const hub = createHub()
  attachHub(h.on, hub)
  return { ...h, hub }
}

const BASH = { tool: 'Bash', command: 'ls' }

describe('hub', () => {
  test('a throwing block is cleared and the call passes through', async () => {
    const h = harness()
    h.hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('boom') } })
    })
    await h.start()
    expect(h.hub.liveBlocks()).toEqual(['policy'])

    const engine = recorder({ result: 'ran' })
    const result = await h.fire('tool.call', BASH, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(engine.seen[0]).toBe(BASH)
    expect(result).toEqual({ result: 'ran' })
    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.logs.filter(l => l.to === 'debug' && l.text.includes('policy guard rule on Bash threw'))).toHaveLength(1)
    expect(h.logs.filter(l => l.to !== 'debug')).toHaveLength(0)
  })

  test('a throwing ui.log never fails session start, whichever way start declines', async () => {
    for (const [version, interactive] of [['2.1.293', false], ['2.1.200', true], ['2.1.293', true]] as const) {
      const h = harness(version)
      h.hub.block('delivery', async () => {})
      h.$.ui.log = () => {
        throw new Error('log sink gone')
      }
      const started = await h.start(interactive)
      expect(started, `${version} ${interactive}`).toEqual({ cwd: '/repo' })
      expect(h.hub.liveBlocks()).toEqual(version === '2.1.293' && interactive ? ['delivery'] : [])
    }
  })

  test('rules run fill, guard, permit, call, tap', async () => {
    const h = harness()
    const order: string[] = []
    h.hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'tap', tool: 'Bash', run: () => { order.push('tap') } })
      b.onToolCall({
        stage: 'permit',
        tool: /^Ba/,
        run: (_api, e, next) => {
          order.push('permit')
          return next(e)
        },
      })
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { order.push('guard') } })
      b.onToolCall({
        stage: 'fill',
        tool: 'Bash',
        run: (_api, e) => {
          order.push('fill')
          return { ...e, filled: true }
        },
      })
    })
    await h.start()

    const engine = recorder({ result: 'ran' })
    const result = await h.fire('tool.call', BASH, async e => {
      order.push('call')
      return engine.next(e)
    })

    expect(order).toEqual(['fill', 'guard', 'permit', 'call', 'tap'])
    expect(engine.seen[0]).toEqual({ ...BASH, filled: true })
    expect(result).toEqual({ result: 'ran' })
  })

  test('a guard refusal returns its reason', async () => {
    const h = harness()
    h.hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => ({ refuse: 'not in this worktree' }) })
    })
    await h.start()

    const engine = recorder({ result: 'ran' })
    const result = await h.fire('tool.call', BASH, engine.next)

    expect(result).toEqual({ deny: 'not in this worktree' })
    expect(engine.seen).toHaveLength(0)
    expect(h.hub.liveBlocks()).toEqual(['policy'])
  })

  test('an unmatched delivery reaches next unchanged', async () => {
    const h = harness()
    h.hub.block('delivery', async (_api, b) => {
      b.onReceive('rt-delivery', () => undefined)
    })
    await h.start()

    const delivery = { origin: { kind: 'peer' }, text: 'hello from a peer' }
    const engine = recorder({ text: delivery.text })
    const result = await h.fire('session.receive', delivery, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(engine.seen[0]).toBe(delivery)
    expect(result).toEqual({ text: delivery.text })
  })

  test('a receiver can pass an edited delivery down through next and gets back what was queued', async () => {
    const h = harness()
    h.hub.block('delivery', async (_api, b) => {
      b.onReceive('rt-delivery', async (_api, e, next) => {
        const queued = await next({ ...e, text: `${e.text} (edited)` })
        return queued
      })
    })
    await h.start()

    const seen: unknown[] = []
    const result = await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'hello' }, async e => {
      seen.push(e)
      return { text: e.text }
    })

    expect(seen).toEqual([{ origin: { kind: 'peer' }, text: 'hello (edited)' }])
    expect(result).toEqual({ text: 'hello (edited)' })
    expect(h.hub.liveBlocks()).toEqual(['delivery'])
  })

  test('a receiver that answers nothing after calling next still returns what was queued', async () => {
    const h = harness()
    h.hub.block('delivery', async (_api, b) => {
      b.onReceive('rt-delivery', async (_api, e, next) => {
        await next({ ...e, text: 'edited' })
      })
    })
    await h.start()

    const engine = recorder({ text: 'edited' })
    const result = await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'x' }, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(result).toEqual({ text: 'edited' })
  })

  test('a rejection from next beneath a receiver keeps the block', async () => {
    const h = harness()
    h.hub.block('delivery', async (_api, b) => {
      b.onReceive('rt-delivery', (_api, e, next) => next({ ...e, text: 'edited' }))
    })
    await h.start()

    const interrupted = new Error('interrupted')
    let thrown: unknown
    try {
      await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'x' }, async () => {
        throw interrupted
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(interrupted)
    expect(h.hub.liveBlocks()).toEqual(['delivery'])
  })

  test('a receiver that throws after passing an edit is cleared and the queued delivery stands', async () => {
    const h = harness()
    h.hub.block('delivery', async (_api, b) => {
      b.onReceive('rt-delivery', async (_api, e, next) => {
        await next({ ...e, text: 'edited' })
        throw new Error('boom')
      })
    })
    await h.start()

    const engine = recorder({ text: 'edited' })
    const result = await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'x' }, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(result).toEqual({ text: 'edited' })
    expect(h.hub.liveBlocks()).toEqual([])
  })

  test('liveBlocks lists only blocks whose start resolved', async () => {
    const h = harness()
    h.hub.block('delivery', async () => {})
    h.hub.block('presence', async (_api, b) => {
      b.onReceive('presence', () => ({ consumed: 'presence' }))
      throw new Error('no daemon')
    })
    await h.start()

    expect(h.hub.liveBlocks()).toEqual(['delivery'])
    const engine = recorder({ text: 'x' })
    await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'x' }, engine.next)
    expect(engine.seen).toHaveLength(1)
  })

  test('an engine below MIN_CLAUDE_CODE starts no block', async () => {
    const h = harness('2.1.292')
    let started = false
    h.hub.block('delivery', async () => {
      started = true
    })
    await h.start()

    expect(started).toBe(false)
    expect(h.hub.liveBlocks()).toEqual([])
  })

  test('a non-interactive session (claude -p) starts no block', async () => {
    const h = harness()
    let started = false
    h.hub.block('delivery', async () => {
      started = true
    })
    await h.start(false)

    expect(started).toBe(false)
    expect(h.hub.liveBlocks()).toEqual([])
  })

  test('a rejection from next under a pass-through permit keeps the block', async () => {
    const h = harness()
    h.hub.block('gate-form', async (_api, b) => {
      b.onToolCall({ stage: 'permit', tool: 'AskUserQuestion', run: (_api, e, next) => next(e) })
    })
    await h.start()

    const interrupted = new Error('interrupted')
    let thrown: unknown
    try {
      await h.fire('tool.call', { tool: 'AskUserQuestion', questions: [] }, async () => {
        throw interrupted
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(interrupted)
    expect(h.hub.liveBlocks()).toEqual(['gate-form'])
    expect(h.logs.filter(l => !l.text.includes('live blocks after start'))).toHaveLength(0)
  })

  test('a permit rule can race next(e) against its own promise and return the first result', async () => {
    const h = harness()
    const tapped: unknown[] = []
    h.hub.block('gate-form', async (_api, b) => {
      b.onToolCall({
        stage: 'permit',
        tool: 'AskUserQuestion',
        run: (_api, e, next) => Promise.race([next(e), Promise.resolve({ result: 'answered on the board' })]),
      })
      b.onToolCall({ stage: 'tap', tool: 'AskUserQuestion', run: (_api, _e, result) => { tapped.push(result) } })
    })
    await h.start()

    const shown: unknown[] = []
    const ask = { tool: 'AskUserQuestion', questions: [] }
    const result = await h.fire('tool.call', ask, e => {
      shown.push(e)
      return new Promise(() => {})
    })

    expect(shown).toHaveLength(1)
    expect(result).toEqual({ result: 'answered on the board' })
    expect(tapped).toEqual([{ result: 'answered on the board' }])
  })

  test('tool.check with no check rule passes through unchanged', async () => {
    const h = harness()
    h.hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => ({ refuse: 'never at check' }) })
    })
    await h.start()

    const check = { tool: 'Bash', input: { command: 'ls' } }
    const engine = recorder({ decision: 'ask' })
    const result = await h.fire('tool.check', check, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(engine.seen[0]).toBe(check)
    expect(result).toEqual({ decision: 'ask' })
  })

  test('the first check rule with a decision answers tool.check', async () => {
    const h = harness()
    h.hub.block('relocation', async (_api, b) => {
      b.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => undefined })
      b.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => ({ decision: 'allow', reason: 'registered tree' }) })
      b.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => ({ decision: 'deny' }) })
    })
    await h.start()

    const engine = recorder({ decision: 'ask' })
    const result = await h.fire('tool.check', { tool: 'EnterWorktree', input: {} }, engine.next)

    expect(result).toEqual({ decision: 'allow', reason: 'registered tree' })
    expect(engine.seen).toHaveLength(0)
  })
  test('a start that never settles times out, and the blocks after it still start', async () => {
    const h = harness()
    h.hub.block('gate-form', () => new Promise(() => {}))
    h.hub.block('delivery', async () => {})

    const started = h.start()
    await h.clock.advance(START_TIMEOUT_MS)
    await started

    expect(h.hub.liveBlocks()).toEqual(['delivery'])
    expect(h.logs.filter(l => l.to === 'debug' && l.text.includes('gate-form start'))).toHaveLength(1)
  })

  test('a subscription made outside any start belongs to the core, even while a start is pending', async () => {
    const h = harness()
    let release: () => void = () => {}
    h.hub.block('gate-form', () => new Promise<void>(resolve => { release = resolve }))

    const started = h.start()
    await flush()
    h.hub.onReceive('core', () => ({ consumed: 'core' }))
    await h.clock.advance(START_TIMEOUT_MS)
    await started
    release()

    expect(h.hub.liveBlocks()).toEqual([])
    const engine = recorder({ text: 'x' })
    const result = await h.fire('session.receive', { origin: { kind: 'peer' }, text: 'x' }, engine.next)
    expect(result).toEqual({ consumed: 'core' })
    expect(engine.seen).toHaveLength(0)
  })

  test('classic.SessionStart source clear reaches session-clear handlers; other sources do not', async () => {
    const h = harness()
    const seen: string[] = []
    h.hub.onLifecycle('session-clear', (_api, e) => {
      seen.push(e.session_id)
    })
    await h.start()

    await h.fire('classic.SessionStart', { session_id: 'sess-r', source: 'resume' }, async () => ({}))
    await h.clear('sess-2')

    expect(seen).toEqual(['sess-2'])
  })

  test('session.end with reason clear is not reported as session-end; other reasons are', async () => {
    const h = harness()
    const reasons: string[] = []
    h.hub.onLifecycle('session-end', (_api, e) => {
      reasons.push(e.reason)
    })
    await h.start()

    await h.end('clear')
    await h.end('prompt_input_exit')

    expect(reasons).toEqual(['prompt_input_exit'])
  })

  test('after start, one debug line lists the live blocks', async () => {
    const h = harness()
    h.hub.block('delivery', async () => {})
    h.hub.block('presence', async () => {
      throw new Error('no daemon')
    })
    await h.start()

    const lines = h.logs.filter(l => l.text.includes('live blocks after start'))
    expect(lines).toEqual([{ text: 'mattstack-mods: live blocks after start: delivery', to: 'debug' }])
  })

  test('keep clears every live block it does not name', async () => {
    const h = harness()
    h.hub.block('delivery', async () => {})
    h.hub.block('presence', async () => {})
    await h.start()

    h.hub.keep(['presence', 'observe'])

    expect(h.hub.liveBlocks()).toEqual(['presence'])
    expect(h.hub.engaged()).toBe(true)
  })

  test('restore brings back every started block a failure has not cleared', async () => {
    const h = harness()
    h.hub.block('delivery', async () => {})
    h.hub.block('policy', async (_api, b) => {
      b.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('boom') } })
    })
    h.hub.block('presence', async () => {})
    h.hub.block('observe', async () => { throw new Error('never started') })
    await h.start()
    await h.fire('tool.call', BASH, recorder({ result: 'ran' }).next)

    h.hub.keep([])
    h.hub.restore()

    expect(h.hub.liveBlocks()).toEqual(['delivery', 'presence'])
  })
})
