import { expect, test } from 'bun:test'
import type { EngineInterface, ProcessSpawnRequest } from 'claude-code'

import { endNote, isSelf, rowEnd, waitEnd, waitFor } from './watch'

const answered = (by: string, session?: string) =>
  JSON.stringify({ ok: true, status: 'answered', row: { id: 'g1', status: 'answered', answer: { answers: {}, by, answeredAt: 1, ...(session ? { session } : {}) } } })

test('a wait that ends answered names who answered', () => {
  expect(waitEnd(answered('board'))).toEqual({ status: 'answered', by: 'board', answers: {} })
  expect(waitEnd(answered('pane', 's1'))).toEqual({ status: 'answered', by: 'pane', session: 's1', answers: {} })
})

test('a wait that ends closed says why', () => {
  const closed = JSON.stringify({ ok: true, status: 'closed', row: { id: 'g1', status: 'closed', answer: null, closedReason: 'superseded' } })
  expect(waitEnd(closed)).toEqual({ status: 'closed', reason: 'superseded' })
})

test('output that is not a finished wait reads as nothing', () => {
  expect(waitEnd('not json')).toBeUndefined()
  expect(waitEnd(JSON.stringify({ ok: true, timedOut: true }))).toBeUndefined()
})

test('a listed row ends only once it is answered or closed', () => {
  expect(rowEnd({ id: 'g1', status: 'open' })).toBeUndefined()
  expect(rowEnd({ id: 'g1', status: 'parked' })).toBeUndefined()
  expect(rowEnd({ id: 'g1', status: 'answered', answer: { by: 'console' } })).toEqual({ status: 'answered', by: 'console' })
  expect(rowEnd({ id: 'g1', status: 'closed', closedReason: 'abandoned' })).toEqual({ status: 'closed', reason: 'abandoned' })
})

test('the note names the surface that answered', () => {
  expect(endNote({ status: 'answered', by: 'board' })).toBe('Answered on the board')
  expect(endNote({ status: 'answered', by: 'console' })).toBe('Answered in the console')
  expect(endNote({ status: 'answered', by: 'shepherd' })).toBe('Answered by the shepherd')
  expect(endNote({ status: 'answered', by: 'pane', session: 'other' })).toBe('Answered in another pane')
  expect(endNote({ status: 'answered', by: 'slack' })).toBe('Answered elsewhere')
  expect(endNote({ status: 'closed', reason: 'superseded' })).toBe('Replaced by a newer gate')
  expect(endNote({ status: 'closed', reason: 'abandoned' })).toBe('Closed elsewhere')
})

test('an answer by this pane, or by a pane with no session, is the pane’s own', () => {
  expect(isSelf({ status: 'answered', by: 'pane', session: 's1' }, 's1')).toBe(true)
  expect(isSelf({ status: 'answered', by: 'pane' }, 's1')).toBe(true)
  expect(isSelf({ status: 'answered', by: 'pane', session: 's2' }, 's1')).toBe(false)
  expect(isSelf({ status: 'answered', by: 'board' }, 's1')).toBe(false)
  expect(isSelf({ status: 'closed' }, 's1')).toBe(false)
})

type Child = AsyncGenerator<{ stream: 'stdout' | 'stderr'; text: string }, { code: number | null; signal: string | null }>

function fakeEngine(child: (argv: readonly string[]) => Child | undefined) {
  const spawned: ProcessSpawnRequest[] = []
  const $ = {
    env: { get: async (name: string) => (name === 'HOME' ? '/home/t' : undefined) },
    process: {
      spawn: (request: ProcessSpawnRequest) => {
        spawned.push(request)
        const made = child(request.argv)
        if (made) return made
        return (async function* (): Child {
          throw new Error('no such command')
        })()
      },
    },
  } as unknown as EngineInterface
  return { $, spawned }
}

async function* exits(text: string, code = 0): Child {
  yield { stream: 'stdout', text: text.slice(0, 5) }
  yield { stream: 'stdout', text: text.slice(5) }
  return { code, signal: null }
}

test('the watcher runs rt gate wait with the session id empty, so the wait never stamps the gate consumed', async () => {
  const { $, spawned } = fakeEngine(() => exits(answered('board')))
  expect(await waitFor($, 'g1')).toEqual({ status: 'answered', by: 'board', answers: {} })
  expect(spawned).toEqual([{ argv: ['rt', 'gate', 'wait', 'g1'], env: { CLAUDE_CODE_SESSION_ID: '' } }])
})

test('an rt that cannot start moves on to the one under ~/.local/bin', async () => {
  const { $, spawned } = fakeEngine(argv => (argv[0] === 'rt' ? undefined : exits(answered('board'))))
  expect(await waitFor($, 'g1')).toEqual({ status: 'answered', by: 'board', answers: {} })
  expect(spawned.map(s => s.argv[0])).toEqual(['rt', '/home/t/.local/bin/rt'])
})

test('a wait that started and then failed is never started again', async () => {
  const { $, spawned } = fakeEngine(() => exits('rt gate: gate not found: g1', 1))
  expect(await waitFor($, 'g1')).toBeUndefined()
  expect(spawned).toHaveLength(1)
})

test('a wait killed from outside reads as nothing', async () => {
  const { $ } = fakeEngine(() =>
    (async function* (): Child {
      return { code: null, signal: 'SIGTERM' }
    })(),
  )
  expect(await waitFor($, 'g1')).toBeUndefined()
})
