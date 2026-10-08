import type { Color, TextProps } from 'claude-code'
import type { ModApi } from '../core/hub.ts'
import {
  looksLikeObject,
  parseGateCtx,
  type CarryoverCall,
  type FindingEntry,
  type FindingSeverity,
  type PlanCtx,
  type PostCtx,
  type ReviewCtx,
  type Severity,
  type VerdictCall,
} from './gate-ctx.ts'

// The drawing parts of the gate pane and band: what a gate's context, a
// question's context and a choice's subtext look like. The board's gate
// sheets are the information design these mirror.

export type El = ReturnType<ModApi['ui']['elements']>
export type Node = ReturnType<El['Box']>

/** Cells a Box with a round border and one cell of padding each side takes from its row. */
const BOXED = 4
const GATE_PROSE_ROWS = 8
const QUESTION_PROSE_ROWS = 6
const SUBJECT_CELLS = 32

export const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()

export function clip(text: string, cells: number): string {
  if (cells <= 1) return text.slice(0, Math.max(cells, 0))
  return text.length <= cells ? text : `${text.slice(0, cells - 1).trimEnd()}…`
}

export const text = (el: El, color: Color, children: string, style: Omit<TextProps, 'color'> = {}): Node => el.Text({ color, ...style, children: [children] })

/** Interleaves `items` with a subtle separator. */
function joined(el: El, items: Node[], separator = ' · '): Node[] {
  return items.flatMap((item, i) => (i === 0 ? [item] : [text(el, 'subtle', separator), item]))
}

const row = (el: El, children: Node[]): Node => el.Box({ flexDirection: 'row', flexWrap: 'wrap', children })

/** `!<iid>` for an MR or PR subject, the id for a run, else the subject clipped. */
export function subjectTail(subject: string | undefined): string {
  const s = oneLine(subject ?? '')
  if (s.startsWith('mr:')) {
    const iid = /\/(?:merge_requests|pull|pulls)\/(\d+)/.exec(s)?.[1] ?? /!(\d+)$/.exec(s)?.[1]
    if (iid) return `!${iid}`
  }
  if (s.startsWith('run:') && s.length > 4) return clip(s.slice(4), SUBJECT_CELLS)
  return clip(s, SUBJECT_CELLS)
}

/** A path's last segment with its `:line`, led by `…/` when a directory was dropped. */
export function fileTail(file: string): string {
  const parts = file.split('/')
  return parts.length > 1 ? `…/${parts.at(-1)}` : file
}

const RECOMMENDED = /\s*\(\s*recommended\s*\)\s*$/i

/** The label without a trailing `(recommended)`, which the pane draws as a tag instead (gate-kit's stripRecommended). */
export function stripRecommended(label: string): { label: string; recommended: boolean } {
  const stripped = label.replace(RECOMMENDED, '')
  if (stripped === label || stripped.length === 0) return { label, recommended: false }
  return { label: stripped.trimEnd(), recommended: true }
}

/**
 * `prose` word-wrapped to `width` cells, at most `max` rows, the last ending
 * in `…` when rows were dropped. Blank lines between paragraphs are kept once.
 */
export function wrapLines(prose: string, width: number, max: number): string[] {
  const w = Math.max(Math.floor(width), 1)
  const lines: string[] = []
  for (const paragraph of prose
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .split('\n')) {
    let line = ''
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > w) {
        if (line) lines.push(line)
        line = ''
        lines.push(word.slice(0, w))
        word = word.slice(w)
      }
      if (!word) continue
      if (!line) line = word
      else if (line.length + 1 + word.length <= w) line += ` ${word}`
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  const kept = lines.filter((l, i) => l !== '' || (i > 0 && lines[i - 1] !== ''))
  while (kept[0] === '') kept.shift()
  while (kept.at(-1) === '') kept.pop()
  if (kept.length <= max) return kept
  const out = kept.slice(0, max)
  const last = out[max - 1]!
  out[max - 1] = last.length < w ? `${last}…` : `${last.slice(0, w - 1)}…`
  return out
}

const proseRows = (el: El, prose: string, width: number, max: number, color: Color) =>
  wrapLines(prose, width, max).map(line => text(el, color, line, { wrap: 'truncate-end' }))

export const SEVERITY: Record<FindingSeverity, { label: string; color: Color }> = {
  critical: { label: 'Critical', color: 'error' },
  important: { label: 'Important', color: 'warning' },
  minor: { label: 'Minor', color: 'subtle' },
}

const READINESS: Record<ReviewCtx['readiness'], { label: string; color: Color }> = {
  'with-fixes': { label: 'With fixes', color: 'warning' },
  yes: { label: 'Ready', color: 'success' },
  no: { label: 'Not ready', color: 'error' },
}

const THREAD_SEVERITY: Record<Severity, { label: string; color: Color }> = {
  blocking: { label: 'blocking', color: 'error' },
  'non-blocking': { label: 'non-blocking', color: 'subtle' },
  question: { label: 'question', color: 'warning' },
  none: { label: 'no ask', color: 'subtle' },
}

// The board's words for a verdict and a carried-over thread (RespondCards.tsx, ReviewRoundParts.tsx).
const CALL_TEXT: Record<VerdictCall, string> = {
  valid: 'valid',
  'valid-low-value': 'valid, low value',
  pushback: 'pushback',
  'needs-clarification': 'needs clarification',
  'no-ask': 'no ask',
}

const CARRYOVER_TEXT: Record<CarryoverCall, string> = {
  fixed: 'fixed by author',
  'not-fixed': 'waiting on author',
  'pushback-accepted': 'author pushed back · accept',
  'pushback-rejected': 'author pushed back · hold firm',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function reviewRows(el: El, ctx: ReviewCtx): Node[] {
  const readiness = READINESS[ctx.readiness]
  const head = [text(el, readiness.color, readiness.label, { bold: true })]
  const counts = (['critical', 'important', 'minor'] as const)
    .filter(s => ctx.findings[s] > 0)
    .map(s => text(el, SEVERITY[s].color, `${ctx.findings[s]} ${s}`))
  if (counts.length > 0) head.push(text(el, 'subtle', '  ·  '), ...joined(el, counts))
  if (ctx.round !== undefined && (ctx.round > 1 || ctx.re_review)) head.push(text(el, 'subtle', ` · round ${ctx.round}`))
  return [row(el, head), text(el, 'text', ctx.summary, { wrap: 'wrap' })]
}

function respondRows(el: El, ctx: PlanCtx | PostCtx): Node[] {
  const head = [text(el, 'text', ctx.reviewer, { bold: true })]
  if (ctx.round !== undefined) head.push(text(el, 'subtle', ` · round ${ctx.round}`))
  const counts =
    ctx.shape === 'plan@1'
      ? [text(el, 'text', plural(ctx.threads.total, 'thread', 'threads')), ...(ctx.threads.blocking > 0 ? [text(el, 'warning', `${ctx.threads.blocking} blocking`)] : [])]
      : [text(el, 'text', plural(ctx.replies, 'reply', 'replies')), ...(ctx.fixes.length > 0 ? [text(el, 'text', plural(ctx.fixes.length, 'fix', 'fixes'))] : [])]
  head.push(text(el, 'subtle', '  ·  '), ...joined(el, counts))
  return [row(el, head), ...(ctx.adjudication ? [text(el, 'text', ctx.adjudication, { wrap: 'wrap' })] : [])]
}

/**
 * The gate's context in a round box: review@1, plan@1 and post@1 drawn as
 * their facts, prose clipped to eight rows. Null for no context, or for a
 * JSON object of any other shape, which would only read as noise.
 */
export function gateContext(el: El, context: unknown, width: number): Node | null {
  if (typeof context !== 'string' || !context.trim()) return null
  const ctx = parseGateCtx(context)
  let body: Node[]
  if (ctx?.shape === 'review@1') body = reviewRows(el, ctx)
  else if (ctx?.shape === 'plan@1' || ctx?.shape === 'post@1') body = respondRows(el, ctx)
  else if (ctx || looksLikeObject(context)) return null
  else body = proseRows(el, context, width - BOXED, GATE_PROSE_ROWS, 'text')
  if (body.length === 0) return null
  return el.Box({ key: 'context', flexDirection: 'column', borderStyle: 'round', borderColor: 'subtle', paddingX: 1, children: body })
}

/** The rows a question's context adds under its label, or null when it adds none. */
export function questionContext(el: El, context: unknown, width: number): Node | null {
  if (typeof context !== 'string' || !context.trim()) return null
  const ctx = parseGateCtx(context)
  let rows: Node[] = []
  if (!ctx) {
    if (looksLikeObject(context)) return null
    rows = proseRows(el, context, width, QUESTION_PROSE_ROWS, 'subtle')
  } else if (ctx.shape === 'thread@1') {
    const tag = THREAD_SEVERITY[ctx.severity]
    rows = [
      row(el, [text(el, 'text', ctx.author, { bold: true }), text(el, 'subtle', '  '), text(el, tag.color, tag.label)]),
      text(el, 'text', ctx.claim.summary, { wrap: 'wrap' }),
      text(el, 'subtle', `verdict · ${CALL_TEXT[ctx.verdict.call]}`, { wrap: 'wrap' }),
    ]
  } else if (ctx.shape === 'reply@1') {
    rows = [text(el, 'subtle', `${ctx.verb} · ${fileTail(ctx.file)}`, { wrap: 'truncate-start' }), text(el, 'text', ctx.text, { wrap: 'wrap' })]
  } else if (ctx.shape === 'carryover@1') {
    rows = [text(el, 'subtle', `round ${ctx.round} · ${CARRYOVER_TEXT[ctx.call]}`), text(el, 'text', ctx.original, { wrap: 'wrap' })]
  } else if (ctx.shape === 'skipped@1') {
    rows = ctx.skipped.map(s => text(el, 'subtle', `${SEVERITY[s.severity].label} ${s.title}`, { wrap: 'truncate-end' }))
  } else if (ctx.shape === 'replies@1') {
    rows = ctx.replies.map(r => text(el, 'subtle', `${r.thread} ${r.verb}`, { wrap: 'truncate-end' }))
  }
  if (rows.length === 0) return null
  return el.Box({ key: 'question-context', flexDirection: 'column', children: rows })
}

/** The findings a question's findings@1 context carries, matched to its options by value. */
export function questionFindings(context: unknown): FindingEntry[] {
  const ctx = typeof context === 'string' ? parseGateCtx(context) : null
  return ctx?.shape === 'findings@1' ? ctx.findings : []
}

/**
 * What a choice says under its label: a recommended tag, then its finding
 * (severity, file and fix) or else its own description.
 */
export function choiceSubtext(el: El, recommended: boolean, finding: FindingEntry | undefined, description: string | undefined): Node[] {
  const rows: Node[] = []
  if (recommended) rows.push(text(el, 'success', 'recommended', { bold: true }))
  if (finding) {
    const severity = SEVERITY[finding.severity]
    const head = [text(el, severity.color, severity.label, { bold: true })]
    if (finding.file) head.push(text(el, 'subtle', '  ·  '), text(el, 'subtle', fileTail(finding.file), { wrap: 'truncate-start' }))
    rows.push(el.Box({ flexDirection: 'row', children: head }))
    if (finding.fix) rows.push(text(el, 'subtle', finding.fix, { wrap: 'wrap' }))
  } else if (description?.trim()) {
    rows.push(text(el, 'subtle', description, { wrap: 'wrap' }))
  }
  return rows
}
