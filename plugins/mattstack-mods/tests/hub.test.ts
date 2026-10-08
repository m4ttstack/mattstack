import { describe, expect, test } from 'claude-code/testing'
import { attachHub, createHub } from '../src/core/hub.ts'

type Hook = (...args: any[]) => Promise<any>

function harness(version = '2.1.293') {
  const hooks = new Map<string, Hook>()
  const on: any = (event: string, hook: Hook) => {
    hooks.set(event, hook)
  }
  const logs: { text: string; to: string | undefined }[] = []
  const $: any = {
    ui: { log: (text: string, options?: { to?: string }) => logs.push({ text, to: options?.to }) },
    session: { version: async () => ({ version, base: version, builtAt: '2026-10-07T00:00:00.000Z' }) },
    http: { fetch: async () => { throw new Error('no network in tests') } },
  }
  const hub = createHub()
  attachHub(on, hub)
  const fire = (event: string, e: unknown, next: Hook): Promise<any> => {
    const hook = hooks.get(event)
    if (!hook) throw new Error(`the hub registered no ${event} hook`)
    return hook($, e, next)
  }
  const start = (isInteractive = true) =>
    fire('session.start', { cwd: '/repo', surface: isInteractive ? 'terminal' : null, isInteractive }, async () => ({}))
  return { hub, logs, fire, start }
}

function recorder(answer: unknown) {
  const seen: unknown[] = []
  const next: Hook = async e => {
    seen.push(e)
    return answer
  }
  return { seen, next }
}

const BASH = { tool: 'Bash', command: 'ls' }

describe('hub', () => {
  test('a throwing block is cleared and the call passes through', async () => {
    const h = harness()
    h.hub.block('policy', async () => {
      h.hub.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { throw new Error('boom') } })
    })
    await h.start()
    expect(h.hub.liveBlocks()).toEqual(['policy'])

    const engine = recorder({ result: 'ran' })
    const result = await h.fire('tool.call', BASH, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(engine.seen[0]).toBe(BASH)
    expect(result).toEqual({ result: 'ran' })
    expect(h.hub.liveBlocks()).toEqual([])
    expect(h.logs.filter(l => l.to === 'debug' && l.text.includes('policy'))).toHaveLength(1)
    expect(h.logs.filter(l => l.to !== 'debug')).toHaveLength(0)
  })

  test('rules run fill, guard, permit, call, tap', async () => {
    const h = harness()
    const order: string[] = []
    h.hub.block('policy', async () => {
      h.hub.onToolCall({ stage: 'tap', tool: 'Bash', run: () => { order.push('tap') } })
      h.hub.onToolCall({
        stage: 'permit',
        tool: /^Ba/,
        run: (_api, e, next) => {
          order.push('permit')
          return next(e)
        },
      })
      h.hub.onToolCall({ stage: 'guard', tool: 'Bash', run: () => { order.push('guard') } })
      h.hub.onToolCall({
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
    h.hub.block('policy', async () => {
      h.hub.onToolCall({ stage: 'guard', tool: 'Bash', run: () => ({ refuse: 'not in this worktree' }) })
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
    h.hub.block('delivery', async () => {
      h.hub.onReceive('rt-delivery', () => undefined)
    })
    await h.start()

    const delivery = { origin: { kind: 'peer' }, text: 'hello from a peer' }
    const engine = recorder({ text: delivery.text })
    const result = await h.fire('session.receive', delivery, engine.next)

    expect(engine.seen).toHaveLength(1)
    expect(engine.seen[0]).toBe(delivery)
    expect(result).toEqual({ text: delivery.text })
  })

  test('liveBlocks lists only blocks whose start resolved', async () => {
    const h = harness()
    h.hub.block('delivery', async () => {})
    h.hub.block('presence', async () => {
      h.hub.onReceive('presence', () => ({ consumed: 'presence' }))
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
    h.hub.block('gate-form', async () => {
      h.hub.onToolCall({ stage: 'permit', tool: 'AskUserQuestion', run: (_api, e, next) => next(e) })
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
    expect(h.logs).toHaveLength(0)
  })

  test('a permit rule can race next(e) against its own promise and return the first result', async () => {
    const h = harness()
    const tapped: unknown[] = []
    h.hub.block('gate-form', async () => {
      h.hub.onToolCall({
        stage: 'permit',
        tool: 'AskUserQuestion',
        run: (_api, e, next) => Promise.race([next(e), Promise.resolve({ result: 'answered on the board' })]),
      })
      h.hub.onToolCall({ stage: 'tap', tool: 'AskUserQuestion', run: (_api, _e, result) => { tapped.push(result) } })
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
    h.hub.block('policy', async () => {
      h.hub.onToolCall({ stage: 'guard', tool: 'Bash', run: () => ({ refuse: 'never at check' }) })
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
    h.hub.block('relocation', async () => {
      h.hub.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => undefined })
      h.hub.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => ({ decision: 'allow', reason: 'registered tree' }) })
      h.hub.onToolCall({ stage: 'check', tool: 'EnterWorktree', run: () => ({ decision: 'deny' }) })
    })
    await h.start()

    const engine = recorder({ decision: 'ask' })
    const result = await h.fire('tool.check', { tool: 'EnterWorktree', input: {} }, engine.next)

    expect(result).toEqual({ decision: 'allow', reason: 'registered tree' })
    expect(engine.seen).toHaveLength(0)
  })
})
