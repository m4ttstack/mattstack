// Chunked multi questions, ported from gate-kit (packages/gate-kit/src/chunks.ts),
// which this plugin cannot import. Keep the two in step. A skill splits one
// multi question into `<base>-1`, `<base>-2`, ... only because the native
// dialog caps a question at four options; the board and this pane join
// adjacent chunks back into one question and split the picks per chunk.

import { parseGateCtx } from './gate-ctx.ts'
import type { GateOption } from './gate-form.ts'
import { questionFindings } from './gate-view.ts'

export type ChunkQuestion = { id: string; label: string; multi?: boolean; options: GateOption[]; context?: string | null }

const CHUNK_RE = /^(.*)-(\d+)$/

const optionValue = (o: GateOption) => (typeof o === 'string' ? o : o.value)

export function chunkGroupKey(id: string): string | null {
  const m = CHUNK_RE.exec(id)
  return m ? m[1]! : null
}

export function collapseChunks<Q extends ChunkQuestion>(questions: Q[]): { questions: Q[]; groups: Map<string, string[]> } {
  const out: Q[] = []
  const groups = new Map<string, string[]>()
  for (const question of questions) {
    const base = question.multi ? chunkGroupKey(question.id) : null
    if (base === null) {
      out.push(question)
      continue
    }
    const prior = groups.get(base)
    if (prior && out.length > 0 && out[out.length - 1]!.id === base) {
      const merged = out[out.length - 1]!
      out[out.length - 1] = { ...merged, options: [...merged.options, ...question.options] }
      prior.push(question.id)
    } else {
      if (groups.has(base)) throw new Error(`non-adjacent chunks for ${base}: ${question.id}`)
      out.push({ ...question, id: base })
      groups.set(base, [question.id])
    }
  }
  return { questions: out, groups }
}

export function splitChunkSelections(groups: Map<string, string[]>, questions: ChunkQuestion[], selections: Record<string, string[]>): Record<string, string[]> {
  const byId = new Map(questions.map(question => [question.id, question]))
  const out: Record<string, string[]> = {}
  for (const [base, chunkIds] of groups) {
    const picked = new Set(selections[base] ?? [])
    for (const chunkId of chunkIds) {
      const question = byId.get(chunkId)
      if (!question) throw new Error(`unknown chunk question ${chunkId}`)
      out[chunkId] = question.options.map(optionValue).filter(value => picked.delete(value))
    }
    if (picked.size > 0) throw new Error(`selection values outside ${base} chunks: ${[...picked].join(', ')}`)
  }
  return out
}

const THREAD_SHAPES = new Set(['thread@1', 'reply@1', 'carryover@1'])

/**
 * A per-thread question (respond-plan's thread@1, respond-post's reply@1,
 * a re-review's carryover@1) is its own question and never a chunk, even
 * when its id reads `thread-<n>`. Its `post:<id>` / `resolve:<id>` pair
 * marks it when its context fell back to prose, as the board's postPicks reads it.
 */
function perThread(question: ChunkQuestion): boolean {
  const shape = parseGateCtx(question.context)?.shape
  if (shape && THREAD_SHAPES.has(shape)) return true
  if (question.options.length !== 2) return false
  const values = question.options.map(optionValue)
  const thread = values.find(v => v.startsWith('post:'))?.slice('post:'.length)
  return !!thread && values.includes(`resolve:${thread}`)
}

/** One findings@1 or skipped@1 context carrying every chunk's entries, or null when the chunks carry neither. */
function mergedContext(chunks: (ChunkQuestion | undefined)[]): string | null {
  const findings = chunks.flatMap(chunk => questionFindings(chunk?.context))
  if (findings.length > 0) return JSON.stringify({ 'gate-ctx': 'findings@1', findings })
  const skipped = chunks.flatMap(chunk => {
    const ctx = parseGateCtx(chunk?.context)
    return ctx?.shape === 'skipped@1' ? ctx.skipped : []
  })
  return skipped.length > 0 ? JSON.stringify({ 'gate-ctx': 'skipped@1', skipped }) : null
}

/**
 * The questions the pane draws: adjacent chunks joined into one, which keeps
 * the first chunk's label and carries every chunk's findings@1 or skipped@1
 * entries, so each option still finds its own. Per-thread questions are
 * never joined. A malformed group (chunks that are not adjacent) draws the
 * questions unjoined.
 */
export function joinChunks<Q extends ChunkQuestion>(questions: Q[]): { questions: Q[]; groups: Map<string, string[]> } {
  // A per-thread question goes through collapseChunks as a single, which never groups; the original is drawn.
  const held = new Map<Q, Q>()
  const marked = questions.map(question => {
    if (!question.multi || !perThread(question)) return question
    const single = { ...question, multi: false }
    held.set(single, question)
    return single
  })
  let collapsed: { questions: Q[]; groups: Map<string, string[]> }
  try {
    collapsed = collapseChunks(marked)
  } catch {
    return { questions, groups: new Map() }
  }
  const byId = new Map(questions.map(question => [question.id, question]))
  const joined = collapsed.questions.map(question => {
    const original = held.get(question)
    if (original) return original
    const chunkIds = collapsed.groups.get(question.id)
    if (!chunkIds || chunkIds.length < 2) return question
    const context = mergedContext(chunkIds.map(id => byId.get(id)))
    return context ? { ...question, context } : question
  })
  return { questions: joined, groups: collapsed.groups }
}

type AnswerValue = string | string[] | { value: string | string[]; note: string }

/**
 * Answers keyed by the drawn questions, back in the per-chunk shape rt takes:
 * each chunk its own picks (`[]` when none), and a group's note on its first chunk.
 */
export function splitAnswers(groups: Map<string, string[]>, questions: ChunkQuestion[], answers: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {}
  for (const [id, answer] of Object.entries(answers)) {
    const chunkIds = groups.get(id)
    if (!chunkIds) {
      out[id] = answer
      continue
    }
    const wrapped = typeof answer === 'object' && !Array.isArray(answer)
    const picked = wrapped ? answer.value : answer
    const split = splitChunkSelections(new Map([[id, chunkIds]]), questions, { [id]: Array.isArray(picked) ? picked : [picked] })
    for (const chunkId of chunkIds) out[chunkId] = split[chunkId]!
    if (wrapped) out[chunkIds[0]!] = { value: split[chunkIds[0]!]!, note: answer.note }
  }
  return out
}
