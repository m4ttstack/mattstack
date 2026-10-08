import { describe, expect, test } from 'claude-code/testing'
import { parseGateCtx } from '../src/blocks/gate-ctx.ts'

// Fixtures copied from the board's parser tests
// (apps/board/src/client/board/__tests__/gate-ctx.test.ts and, for carryover@1
// and skipped@1, review-gate-sheet-dom.test.tsx), so the two parsers agree.

const PLAN = { 'gate-ctx': 'plan@1', reviewer: 'renee', round: 1, threads: { total: 2, blocking: 1 }, adjudication: 'both valid · fresh-context adjudicated' }
const POST = { 'gate-ctx': 'post@1', reviewer: 'renee', round: 1, replies: 2, fixes: [{ sha: 'ab12cd3' }] }
const THREAD = {
  'gate-ctx': 'thread@1',
  author: 'renee',
  severity: 'blocking',
  claim: {
    summary: 'the retry queue re-enqueues a job that already failed permanently.',
    points: ['permanent failures carry retryable: false, but enqueue() never reads it', 'the other three callers all check it'],
  },
  verdict: { call: 'valid', note: 'confirmed against the checkout' },
  reply: { kind: 'verbatim', text: 'fixed. enqueue() now drops non-retryable jobs; added a test.' },
}
const REPLIES = {
  'gate-ctx': 'replies@1',
  replies: [
    { thread: 't-1', file: 'queue/enqueue.ts:88', verb: 'fix', sha: 'ab12cd3', text: 'good call. enqueue() now drops non-retryable jobs.' },
    { thread: 't-2', file: 'queue/README.md:12', verb: 'reply', text: 'agreed on the wording; noted the contract in the doc.' },
  ],
}
const REPLY = { 'gate-ctx': 'reply@1', thread: 't-1', file: 'queue/enqueue.ts:88', verb: 'fix', sha: 'ab12cd3', text: 'Fixed -- enqueue() now drops non-retryable jobs.' }
const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'mechanism verified against the pinned deps; tests substantiate both criteria.',
  findings: { critical: 0, important: 1, minor: 4 },
  round: 2,
  re_review: true,
  prior: { addressed: 3, still_open: 1 },
}
const FINDING = {
  id: 'f1',
  severity: 'important',
  title: 'retry fix is parity wiring, not a live fix',
  file: 'queue/enqueue.ts:81',
  body: 'the guard only runs on the parity path; the live path still re-enqueues.',
  fix: 'note it is parity wiring in the doc comment',
  evidence: 'enqueue.test.ts: 4 pass, 0 fail',
  disposition: 'new',
}
const FINDINGS = {
  'gate-ctx': 'findings@1',
  findings: [FINDING, { id: 'f2', severity: 'minor', title: 'test over-specifies the ordering', body: 'asserts exact call order where the contract only promises the set.' }],
}
const CARRYOVER = {
  'gate-ctx': 'carryover@1',
  thread: 'd-errors',
  file: 'lib/errors.ts:15',
  round: 2,
  call: 'pushback-accepted',
  original: 'two of the new messages end in a period.',
  authorReply: "These copy the upstream API's strings word for word.",
  reply: 'Makes sense, matching the API is the better call. Resolving.',
}
const SKIPPED = {
  'gate-ctx': 'skipped@1',
  skipped: [
    { id: 'r1-f4', round: 1, severity: 'minor', title: 'Unused import', file: 'lib/utils.ts:3', changed: false },
    { id: 'r2-f3', round: 2, severity: 'important', title: 'Config defaults live in two files', changed: false },
  ],
}

const j = (v: unknown) => JSON.stringify(v)

describe('gate-ctx', () => {
  test('plan@1, and its minimal form', () => {
    expect(parseGateCtx(j(PLAN))).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      round: 1,
      adjudication: 'both valid · fresh-context adjudicated',
      threads: { total: 2, blocking: 1 },
    })
    expect(parseGateCtx(j({ 'gate-ctx': 'plan@1', reviewer: 'renee', threads: { total: 3 } }))).toEqual({
      shape: 'plan@1',
      reviewer: 'renee',
      threads: { total: 3, blocking: 0 },
    })
  })

  test('post@1, and its minimal form', () => {
    expect(parseGateCtx(j(POST))).toEqual({ shape: 'post@1', reviewer: 'renee', round: 1, replies: 2, fixes: [{ sha: 'ab12cd3' }] })
    expect(parseGateCtx(j({ 'gate-ctx': 'post@1', reviewer: 'renee', replies: 1 }))).toEqual({ shape: 'post@1', reviewer: 'renee', replies: 1, fixes: [] })
  })

  test('thread@1, with a none reply dropping its text', () => {
    expect(parseGateCtx(j(THREAD))).toEqual({
      shape: 'thread@1',
      author: 'renee',
      severity: 'blocking',
      claim: THREAD.claim,
      verdict: { call: 'valid', note: 'confirmed against the checkout' },
      reply: THREAD.reply,
    })
    expect(parseGateCtx(j({ ...THREAD, reply: { kind: 'none', text: 'later' } }))).toMatchObject({ reply: { kind: 'none' } })
  })

  test('reply@1 and replies@1', () => {
    expect(parseGateCtx(j(REPLY))).toEqual({ shape: 'reply@1', thread: 't-1', file: 'queue/enqueue.ts:88', verb: 'fix', sha: 'ab12cd3', text: REPLY.text })
    expect(parseGateCtx(j(REPLIES))).toEqual({ shape: 'replies@1', replies: REPLIES.replies })
  })

  test('review@1, and its minimal form', () => {
    expect(parseGateCtx(j(REVIEW))).toEqual({
      shape: 'review@1',
      reviewer: 'renee',
      readiness: 'with-fixes',
      summary: REVIEW.summary,
      findings: { critical: 0, important: 1, minor: 4 },
      round: 2,
      re_review: true,
      prior: { addressed: 3, still_open: 1 },
    })
    expect(parseGateCtx(j({ 'gate-ctx': 'review@1', readiness: 'yes', summary: 'clean.', findings: {} }))).toEqual({
      shape: 'review@1',
      readiness: 'yes',
      summary: 'clean.',
      findings: { critical: 0, important: 0, minor: 0 },
      re_review: false,
    })
  })

  test('findings@1, an absent optional string staying absent', () => {
    expect(parseGateCtx(j(FINDINGS))).toEqual({ shape: 'findings@1', findings: FINDINGS.findings })
    const parsed = parseGateCtx(j({ ...FINDINGS, findings: [{ ...FINDING, file: '  ' }] }))
    expect(parsed?.shape === 'findings@1' && 'file' in parsed.findings[0]!).toBe(false)
  })

  test('carryover@1 and skipped@1', () => {
    expect(parseGateCtx(j(CARRYOVER))).toEqual({
      shape: 'carryover@1',
      thread: 'd-errors',
      file: 'lib/errors.ts:15',
      round: 2,
      call: 'pushback-accepted',
      original: CARRYOVER.original,
      authorReply: CARRYOVER.authorReply,
      reply: CARRYOVER.reply,
    })
    expect(parseGateCtx(j(SKIPPED))).toEqual({ shape: 'skipped@1', skipped: SKIPPED.skipped })
  })

  test('unknown keys are dropped and leading whitespace is fine', () => {
    const parsed = parseGateCtx(`\n  ${j({ ...THREAD, extra: 1, claim: { ...THREAD.claim, extra: true } })}`)
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('extra')
    expect((parsed as { claim: object }).claim).not.toHaveProperty('extra')
  })

  test('anything non-conforming is null', () => {
    const cases: (string | undefined | null)[] = [
      undefined,
      null,
      '',
      'MR 87 has 2 unresolved threads. Recommendation below.',
      '{"gate-ctx": "plan@1", "reviewer":',
      j([PLAN]),
      j('plan@1'),
      j({ reviewer: 'renee', threads: { total: 1 } }),
      j({ ...PLAN, 'gate-ctx': 'plan@2' }),
      j({ ...PLAN, 'gate-ctx': 'toString' }),
      j({ ...PLAN, reviewer: '  ' }),
      j({ ...PLAN, threads: { total: -1 } }),
      j({ ...PLAN, round: 0 }),
      j({ ...POST, fixes: ['ab12cd3'] }),
      j({ ...THREAD, verdict: { call: 'invalid' } }),
      j({ ...THREAD, reply: { kind: 'verbatim' } }),
      j({ ...REPLY, verb: 'skip' }),
      j({ ...REVIEW, readiness: 'ready' }),
      j({ ...REVIEW, findings: { minor: 1.5 } }),
      j({ ...REVIEW, prior: null }),
      j({ ...FINDINGS, findings: [{ ...FINDING, severity: 'Important' }] }),
      j({ ...FINDINGS, findings: [{ ...FINDING, fix: null }] }),
      j({ ...CARRYOVER, call: 'maybe' }),
      j({ ...SKIPPED, skipped: [{ id: 'x', round: 0, severity: 'minor', title: 't' }] }),
    ]
    for (const input of cases) expect(parseGateCtx(input)).toBeNull()
  })
})
