import { describe, expect, test } from 'claude-code/testing'
import { chunkGroupKey, collapseChunks, joinChunks, splitAnswers, splitChunkSelections, type ChunkQuestion } from '../src/blocks/gate-chunks.ts'
import { parseGateCtx } from '../src/blocks/gate-ctx.ts'

// The first three describes port packages/gate-kit/test/chunks.test.ts case for case.

const q = (id: string, options: string[], multi = true): ChunkQuestion => ({
  id,
  label: `Post which findings? (${id})`,
  multi,
  options,
})

describe('chunkGroupKey', () => {
  test('matches <base>-<n> and nothing else', () => {
    expect(chunkGroupKey('findings-1')).toBe('findings')
    expect(chunkGroupKey('findings-12')).toBe('findings')
    expect(chunkGroupKey('findings')).toBeNull()
    expect(chunkGroupKey('outcome')).toBeNull()
    expect(chunkGroupKey('fix-up-2x')).toBeNull()
  })
})

describe('collapseChunks', () => {
  test('merges adjacent numbered multis and keeps others in place', () => {
    const questions = [q('findings-1', ['f1', 'f2', 'f3', 'f4']), q('findings-2', ['f5', 'f6']), q('outcome', ['approve', 'comment'], false)]
    const { questions: out, groups } = collapseChunks(questions)
    expect(out.map(x => x.id)).toEqual(['findings', 'outcome'])
    expect(out[0]!.options).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'])
    expect(out[0]!.label).toBe('Post which findings? (findings-1)')
    expect(groups.get('findings')).toEqual(['findings-1', 'findings-2'])
  })

  test('a single unchunked question set passes through untouched', () => {
    const questions = [q('tiers', ['Minor'], true)]
    const { questions: out, groups } = collapseChunks(questions)
    expect(out).toEqual(questions)
    expect(groups.size).toBe(0)
  })

  test('non-adjacent chunks sharing a base throw instead of mis-grouping', () => {
    expect(() => collapseChunks([q('findings-1', ['f1']), q('outcome', ['approve'], false), q('findings-2', ['f2'])])).toThrow()
  })

  test('a lone -1 chunk still collapses to its base id', () => {
    const { questions: out, groups } = collapseChunks([q('findings-1', ['f1'])])
    expect(out[0]!.id).toBe('findings')
    expect(groups.get('findings')).toEqual(['findings-1'])
  })
})

describe('splitChunkSelections', () => {
  test('splits the union back by option membership', () => {
    const questions = [q('findings-1', ['f1', 'f2', 'f3', 'f4']), q('findings-2', ['f5', 'f6'])]
    const { groups } = collapseChunks(questions)
    expect(splitChunkSelections(groups, questions, { findings: ['f2', 'f5'] })).toEqual({ 'findings-1': ['f2'], 'findings-2': ['f5'] })
  })

  test('empty union answers every chunk with an explicit empty array', () => {
    const questions = [q('findings-1', ['f1']), q('findings-2', ['f2'])]
    const { groups } = collapseChunks(questions)
    expect(splitChunkSelections(groups, questions, { findings: [] })).toEqual({ 'findings-1': [], 'findings-2': [] })
  })

  test('a value in no chunk throws', () => {
    const questions = [q('findings-1', ['f1'])]
    const { groups } = collapseChunks(questions)
    expect(() => splitChunkSelections(groups, questions, { findings: ['zz'] })).toThrow()
  })
})

const finding = (id: string) => ({ id, severity: 'minor', title: `title ${id}`, body: `body ${id}` })
const withFindings = (question: ChunkQuestion, ids: string[]): ChunkQuestion => ({
  ...question,
  context: JSON.stringify({ 'gate-ctx': 'findings@1', findings: ids.map(finding) }),
})

describe('joinChunks', () => {
  test("a joined page carries every chunk's findings, so each option still finds its own", () => {
    const questions = [withFindings(q('findings-1', ['f1', 'f2']), ['f1', 'f2']), withFindings(q('findings-2', ['f3']), ['f3']), q('outcome', ['comment'], false)]
    const { questions: out } = joinChunks(questions)
    expect(out.map(x => x.id)).toEqual(['findings', 'outcome'])
    const ctx = parseGateCtx(out[0]!.context)
    expect(ctx?.shape === 'findings@1' && ctx.findings.map(f => f.id)).toEqual(['f1', 'f2', 'f3'])
  })

  test('a malformed group (non-adjacent chunks) draws the questions unjoined, and does not throw', () => {
    const questions = [q('findings-1', ['f1']), q('outcome', ['approve'], false), q('findings-2', ['f2'])]
    const { questions: out, groups } = joinChunks(questions)
    expect(out).toEqual(questions)
    expect(groups.size).toBe(0)
  })

  test("answers go back in the per-chunk shape; a group's note rides its first chunk", () => {
    const questions = [q('findings-1', ['f1', 'f2']), q('findings-2', ['f3']), q('findings-3', ['f4']), q('outcome', ['comment'], false)]
    const { groups } = joinChunks(questions)
    expect(splitAnswers(groups, questions, { findings: { value: ['f3', 'f1'], note: 'only these' }, outcome: 'comment' })).toEqual({
      'findings-1': { value: ['f1'], note: 'only these' },
      'findings-2': ['f3'],
      'findings-3': [],
      outcome: 'comment',
    })
    expect(splitAnswers(groups, questions, { findings: ['f4'], outcome: 'comment' })).toEqual({
      'findings-1': [],
      'findings-2': [],
      'findings-3': ['f4'],
      outcome: 'comment',
    })
    expect(splitAnswers(new Map(), questions, { outcome: 'comment' })).toEqual({ outcome: 'comment' })
  })
})

// Per-thread questions are each their own question, never a chunk (gate-protocol's
// gate-ctx table); the board's postPicks and readReviewGate never collapse them.
const threadPair = (n: number, context: unknown): ChunkQuestion => ({
  id: `thread-${n}`,
  label: `queue/enqueue.ts:${n}`,
  multi: true,
  options: [
    { value: `post:t${n}`, label: 'Post the reply (recommended)' },
    { value: `resolve:t${n}`, label: 'Resolve the thread' },
  ],
  context: typeof context === 'string' ? context : JSON.stringify(context),
})

describe('joinChunks leaves per-thread questions alone', () => {
  test('a respond-post gate: thread-1..3 with reply@1 stay three questions under their own ids', () => {
    const questions = [1, 2, 3].map(n => threadPair(n, { 'gate-ctx': 'reply@1', thread: `t${n}`, file: 'queue/enqueue.ts:88', verb: 'reply', text: `reply ${n}` }))
    const { questions: out, groups } = joinChunks(questions)
    expect(out).toEqual(questions)
    expect(groups.size).toBe(0)
  })

  test('a lone respond-post thread keeps its id, and a pair whose context fell back to prose is still a thread', () => {
    const lone = [threadPair(1, { 'gate-ctx': 'reply@1', thread: 't1', file: 'a.ts:1', verb: 'fix', sha: 'ab12cd3', text: 'Fixed.' })]
    expect(joinChunks(lone).questions.map(x => x.id)).toEqual(['thread-1'])
    const prose = [threadPair(1, 'Reply to renee about the 204.'), threadPair(2, 'Reply to renee about the retry.')]
    expect(joinChunks(prose).questions).toEqual(prose)
  })

  test('a re-review: carryover@1 threads stay unjoined while findings-1..4 still join', () => {
    const carry = (n: number) => threadPair(n, { 'gate-ctx': 'carryover@1', thread: `t${n}`, round: 1, call: 'not-fixed', original: `original ${n}`, reply: `reply ${n}` })
    const findings = [1, 2, 3, 4].map(n => withFindings(q(`findings-${n}`, [`f${n}`]), [`f${n}`]))
    const questions = [carry(1), carry(2), ...findings, q('outcome', ['comment', 'approve'], false)]
    const { questions: out, groups } = joinChunks(questions)
    expect(out.map(x => x.id)).toEqual(['thread-1', 'thread-2', 'findings', 'outcome'])
    expect(out[0]).toEqual(questions[0]!)
    expect(out[1]).toEqual(questions[1]!)
    expect([...groups.keys()]).toEqual(['findings'])
    expect(groups.get('findings')).toEqual(['findings-1', 'findings-2', 'findings-3', 'findings-4'])
  })

  test('a thread@1, reply@1 or carryover@1 context marks a thread even without the post/resolve pair', () => {
    const asThread = (n: number, context: unknown): ChunkQuestion => ({ ...q(`thread-${n}`, ['fix', 'reply']), context: JSON.stringify(context) })
    const thread = { 'gate-ctx': 'thread@1', author: 'renee', severity: 'blocking', claim: { summary: 's' }, verdict: { call: 'valid' }, reply: { kind: 'none' } }
    const reply = { 'gate-ctx': 'reply@1', thread: 't1', file: 'a.ts:1', verb: 'reply', text: 'ok' }
    const carry = { 'gate-ctx': 'carryover@1', thread: 't1', round: 1, call: 'fixed', original: 'o', reply: 'r' }
    for (const context of [thread, reply, carry]) {
      const questions = [asThread(1, context), asThread(2, context)]
      expect(joinChunks(questions).questions).toEqual(questions)
    }
  })
})

describe('joinChunks merges skipped@1', () => {
  test("a joined skipped page carries every chunk's skipped entries", () => {
    const skippedChunk = (n: number, ids: string[]): ChunkQuestion => ({
      ...q(`skipped-${n}`, ids.map(id => `restore:${id}`)),
      context: JSON.stringify({ 'gate-ctx': 'skipped@1', skipped: ids.map(id => ({ id, round: 1, severity: 'minor', title: `title ${id}`, changed: false })) }),
    })
    const { questions: out, groups } = joinChunks([skippedChunk(1, ['r1-f1', 'r1-f2']), skippedChunk(2, ['r1-f3'])])
    expect(out.map(x => x.id)).toEqual(['skipped'])
    expect(groups.get('skipped')).toEqual(['skipped-1', 'skipped-2'])
    const ctx = parseGateCtx(out[0]!.context)
    expect(ctx?.shape === 'skipped@1' && ctx.skipped.map(s => s.id)).toEqual(['r1-f1', 'r1-f2', 'r1-f3'])
  })
})
