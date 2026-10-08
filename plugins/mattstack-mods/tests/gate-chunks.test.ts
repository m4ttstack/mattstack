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
