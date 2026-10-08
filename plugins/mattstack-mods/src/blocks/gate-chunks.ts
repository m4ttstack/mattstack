// Chunked multi questions, ported from gate-kit (packages/gate-kit/src/chunks.ts),
// which this plugin cannot import. Keep the two in step. A skill splits one
// multi question into `<base>-1`, `<base>-2`, ... only because the native
// dialog caps a question at four options; the board and this pane join
// adjacent chunks back into one question and split the picks per chunk.

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

/**
 * The questions the pane draws: adjacent chunks joined into one, which keeps
 * the first chunk's label and carries every chunk's findings@1 entries, so
 * each option still finds its own. A malformed group (chunks that are not
 * adjacent) draws the questions unjoined.
 */
export function joinChunks<Q extends ChunkQuestion>(questions: Q[]): { questions: Q[]; groups: Map<string, string[]> } {
  let collapsed: { questions: Q[]; groups: Map<string, string[]> }
  try {
    collapsed = collapseChunks(questions)
  } catch {
    return { questions, groups: new Map() }
  }
  const byId = new Map(questions.map(question => [question.id, question]))
  const joined = collapsed.questions.map(question => {
    const chunkIds = collapsed.groups.get(question.id)
    if (!chunkIds || chunkIds.length < 2) return question
    const findings = chunkIds.flatMap(id => questionFindings(byId.get(id)?.context))
    return findings.length > 0 ? { ...question, context: JSON.stringify({ 'gate-ctx': 'findings@1', findings }) } : question
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
