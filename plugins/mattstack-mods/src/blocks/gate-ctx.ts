// gate-ctx@1, ported from the board's parser (apps/board/src/client/board/gate-ctx.ts),
// which this plugin cannot import. Keep the two in step: a shape or a rule
// changed there changes here.
//
// Structured context rides a gate's or a question's `context` string as a
// JSON object whose `"gate-ctx"` key names the shape and its version.
// Anything that is not a conforming object of a known shape parses as null:
// there are no partial parses, and unknown keys are ignored.

export type Severity = 'blocking' | 'non-blocking' | 'question' | 'none'
export type VerdictCall = 'valid' | 'valid-low-value' | 'pushback' | 'needs-clarification' | 'no-ask'
export type Readiness = 'yes' | 'no' | 'with-fixes'
export type FindingSeverity = 'critical' | 'important' | 'minor'
export type Disposition = 'new' | 'still-open' | 'addressed-check'
export type CarryoverCall = 'fixed' | 'not-fixed' | 'pushback-accepted' | 'pushback-rejected'

export type PlanCtx = { shape: 'plan@1'; reviewer: string; round?: number; adjudication?: string; threads: { total: number; blocking: number } }
export type PostCtx = { shape: 'post@1'; reviewer: string; round?: number; adjudication?: string; replies: number; fixes: { sha: string }[] }
export type ThreadReply = { kind: 'verbatim' | 'direction'; text: string } | { kind: 'none' }
export type ThreadCtx = {
  shape: 'thread@1'
  author: string
  severity: Severity
  claim: { summary: string; points: string[] }
  verdict: { call: VerdictCall; note?: string }
  reply: ThreadReply
}
export type ReplyEntry = { thread: string; file: string; verb: 'reply' | 'fix'; sha?: string; text: string }
export type ReplyCtx = ReplyEntry & { shape: 'reply@1' }
export type RepliesCtx = { shape: 'replies@1'; replies: ReplyEntry[] }
export type ReviewCtx = {
  shape: 'review@1'
  reviewer?: string
  readiness: Readiness
  summary: string
  findings: Record<FindingSeverity, number>
  round?: number
  re_review: boolean
  prior?: { addressed: number; still_open: number }
}
export type FindingEntry = {
  id: string
  severity: FindingSeverity
  title: string
  body: string
  file?: string
  fix?: string
  evidence?: string
  disposition?: Disposition
}
export type FindingsCtx = { shape: 'findings@1'; findings: FindingEntry[] }
export type CarryoverCtx = {
  shape: 'carryover@1'
  thread: string
  file?: string
  round: number
  call: CarryoverCall
  original: string
  authorReply?: string
  note?: string
  reply: string
}
export type SkippedEntry = { id: string; round: number; severity: FindingSeverity; title: string; file?: string; changed: boolean }
export type SkippedCtx = { shape: 'skipped@1'; skipped: SkippedEntry[] }

export type GateCtx = PlanCtx | PostCtx | ThreadCtx | ReplyCtx | RepliesCtx | ReviewCtx | FindingsCtx | CarryoverCtx | SkippedCtx

type Obj = Record<string, unknown>

const SEVERITIES = ['blocking', 'non-blocking', 'question', 'none'] as const
const VERDICT_CALLS = ['valid', 'valid-low-value', 'pushback', 'needs-clarification', 'no-ask'] as const
const REPLY_KINDS = ['verbatim', 'direction', 'none'] as const
const VERBS = ['reply', 'fix'] as const
const READINESS = ['yes', 'no', 'with-fixes'] as const
const FINDING_SEVERITIES = ['critical', 'important', 'minor'] as const
const DISPOSITIONS = ['new', 'still-open', 'addressed-check'] as const
const CARRYOVER_CALLS = ['fixed', 'not-fixed', 'pushback-accepted', 'pushback-rejected'] as const

class Reject extends Error {}

function reject(): never {
  throw new Reject()
}

const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : reject())
const str = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : reject())
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : reject())
const round = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : reject())
const optRound = (v: unknown): number | undefined => (v === undefined ? undefined : round(v))
const optCount = (v: unknown): number => (v === undefined ? 0 : count(v))

function optStr(v: unknown): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') reject()
  return v.trim() === '' ? undefined : v
}

function optFlag(v: unknown): boolean {
  if (v === undefined) return false
  return typeof v === 'boolean' ? v : reject()
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : reject()
}

function optList<T>(v: unknown, item: (x: unknown) => T): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v.map(item) : reject()
}

function list<T>(v: unknown, item: (x: unknown) => T): T[] {
  return Array.isArray(v) ? v.map(item) : reject()
}

function header(o: Obj): { reviewer: string; round?: number; adjudication?: string } {
  const r = optRound(o.round)
  const adjudication = optStr(o.adjudication)
  return { reviewer: str(o.reviewer), ...(r !== undefined && { round: r }), ...(adjudication !== undefined && { adjudication }) }
}

function readPlan(o: Obj): PlanCtx {
  const threads = obj(o.threads)
  return { shape: 'plan@1', ...header(o), threads: { total: count(threads.total), blocking: optCount(threads.blocking) } }
}

function readPost(o: Obj): PostCtx {
  return { shape: 'post@1', ...header(o), replies: count(o.replies), fixes: optList(o.fixes, f => ({ sha: str(obj(f).sha) })) }
}

function readReply(r: Obj): ThreadReply {
  const kind = oneOf(r.kind, REPLY_KINDS)
  if (kind !== 'none') return { kind, text: str(r.text) }
  optStr(r.text)
  return { kind }
}

function readThread(o: Obj): ThreadCtx {
  const claim = obj(o.claim)
  const verdict = obj(o.verdict)
  const note = optStr(verdict.note)
  return {
    shape: 'thread@1',
    author: str(o.author),
    severity: oneOf(o.severity, SEVERITIES),
    claim: { summary: str(claim.summary), points: optList(claim.points, str) },
    verdict: { call: oneOf(verdict.call, VERDICT_CALLS), ...(note !== undefined && { note }) },
    reply: readReply(obj(o.reply)),
  }
}

function readEntry(v: unknown): ReplyEntry {
  const e = obj(v)
  const sha = optStr(e.sha)
  return { thread: str(e.thread), file: str(e.file), verb: oneOf(e.verb, VERBS), ...(sha !== undefined && { sha }), text: str(e.text) }
}

function readReview(o: Obj): ReviewCtx {
  const findings = obj(o.findings)
  const reviewer = optStr(o.reviewer)
  const r = optRound(o.round)
  const prior = o.prior === undefined ? undefined : obj(o.prior)
  return {
    shape: 'review@1',
    ...(reviewer !== undefined && { reviewer }),
    readiness: oneOf(o.readiness, READINESS),
    summary: str(o.summary),
    findings: { critical: optCount(findings.critical), important: optCount(findings.important), minor: optCount(findings.minor) },
    ...(r !== undefined && { round: r }),
    re_review: optFlag(o.re_review),
    ...(prior && { prior: { addressed: count(prior.addressed), still_open: count(prior.still_open) } }),
  }
}

function readFinding(v: unknown): FindingEntry {
  const e = obj(v)
  const file = optStr(e.file)
  const fix = optStr(e.fix)
  const evidence = optStr(e.evidence)
  const disposition = e.disposition === undefined ? undefined : oneOf(e.disposition, DISPOSITIONS)
  return {
    id: str(e.id),
    severity: oneOf(e.severity, FINDING_SEVERITIES),
    title: str(e.title),
    body: str(e.body),
    ...(file !== undefined && { file }),
    ...(fix !== undefined && { fix }),
    ...(evidence !== undefined && { evidence }),
    ...(disposition !== undefined && { disposition }),
  }
}

function readCarryover(o: Obj): CarryoverCtx {
  const file = optStr(o.file)
  const authorReply = optStr(o.authorReply)
  const note = optStr(o.note)
  return {
    shape: 'carryover@1',
    thread: str(o.thread),
    ...(file !== undefined && { file }),
    round: round(o.round),
    call: oneOf(o.call, CARRYOVER_CALLS),
    original: str(o.original),
    ...(authorReply !== undefined && { authorReply }),
    ...(note !== undefined && { note }),
    reply: str(o.reply),
  }
}

function readSkippedEntry(v: unknown): SkippedEntry {
  const e = obj(v)
  const file = optStr(e.file)
  return {
    id: str(e.id),
    round: round(e.round),
    severity: oneOf(e.severity, FINDING_SEVERITIES),
    title: str(e.title),
    ...(file !== undefined && { file }),
    changed: optFlag(e.changed),
  }
}

const READERS = new Map<string, (o: Obj) => GateCtx>([
  ['plan@1', readPlan],
  ['post@1', readPost],
  ['thread@1', readThread],
  ['reply@1', o => ({ shape: 'reply@1', ...readEntry(o) })],
  ['replies@1', o => ({ shape: 'replies@1', replies: list(o.replies, readEntry) })],
  ['review@1', readReview],
  ['findings@1', o => ({ shape: 'findings@1', findings: list(o.findings, readFinding) })],
  ['carryover@1', readCarryover],
  ['skipped@1', o => ({ shape: 'skipped@1', skipped: list(o.skipped, readSkippedEntry) })],
])

/** Whether `context` is a JSON object at all: one of an unknown shape is shown as nothing, never as prose. */
export function looksLikeObject(context: string | null | undefined): boolean {
  if (!context || context.trimStart()[0] !== '{') return false
  try {
    const raw: unknown = JSON.parse(context)
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
  } catch {
    return false
  }
}

export function parseGateCtx(context: string | null | undefined): GateCtx | null {
  if (!context || context.trimStart()[0] !== '{') return null
  let raw: unknown
  try {
    raw = JSON.parse(context)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const tag = (raw as Obj)['gate-ctx']
  const read = typeof tag === 'string' ? READERS.get(tag) : undefined
  if (!read) return null
  try {
    return read(raw as Obj)
  } catch (err) {
    if (err instanceof Reject) return null
    throw err
  }
}
