import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { splitPieces } from './load-skill.ts'

const TOOL = 'mcp__mattstack__load_skill'
const HOME = '/home/alex'
const DIR = `${HOME}/.claude/plugins/cache/acme-market/acme/0.1.0/skills/work`
const BODY = '---\nname: work\n---\n\nDo the work.\n'
const ENVELOPE = {
  ok: true,
  id: 'acme:work',
  packVersion: '0.1.0',
  mattstack: '0.32.76',
  rtBuild: 'v1.2.3',
  treeDir: `${HOME}/.mattstack/rt/rendered/acme/acme/0.1.0/0.32.76`,
  path: `${HOME}/.mattstack/rt/rendered/acme/acme/0.1.0/0.32.76/skills/work/SKILL.md`,
  body: BODY,
}
const MISSING = {
  error: { code: 'render-missing', message: "acme 0.1.0 isn't rendered on this Mac.", next: 'rt setup' },
  contract: 1,
  at: '2026-11-17T00:00:00.000Z',
}

// 'hang' runs past the 60 s deadline and rejects, as a timed-out run does.
type Reply = { exitCode: number; stdout: string; stderr?: string } | 'missing' | 'hang'

function world(on: On, replies: Record<string, Reply>, env: Record<string, string> = { HOME }) {
  const runs: { argv: readonly string[]; timeoutMs?: number }[] = []
  const registered: Record<string, unknown>[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    registered.push(e as unknown as Record<string, unknown>)
    return { value: { tool: `mcp__mattstack__${e.name}` } }
  })
  on('process.run', async (_, e) => {
    runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
    const reply = replies[e.argv[0] ?? ''] ?? 'missing'
    if (reply === 'missing') throw new Error(`cannot start ${e.argv[0]}`)
    if (reply === 'hang') {
      await clock.sleep(60_000)
      throw new Error('timed out')
    }
    return { value: { exitCode: reply.exitCode, stdout: reply.stdout, stderr: reply.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { runs, registered, clock }
}

const start = ($: Parameters<Parameters<typeof test>[1]>[0]) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })

test('splitPieces keeps lines whole and pieces under the limit', () => {
  const text = `${'x'.repeat(99)}\n`.repeat(2000) + 'y'
  expect(text.length).toBe(200_001)
  const pieces = splitPieces(text)
  expect(pieces).toHaveLength(3)
  expect(pieces.every(p => p.length <= 99_000)).toBe(true)
  expect(pieces.slice(0, 2).every(p => p.endsWith('\n'))).toBe(true)
  expect(pieces.join('')).toBe(text)
})

test('splitPieces cuts a single line longer than the limit', () => {
  const text = 'z'.repeat(150_000)
  const pieces = splitPieces(text)
  expect(pieces.map(p => p.length)).toEqual([99_000, 51_000])
  expect(pieces.join('')).toBe(text)
})

test('session.start registers load_skill, not deferred, and its check allows', async ($, on) => {
  const w = world(on, {})
  on('tool.check', () => ({ decision: 'ask' }))
  await start($)
  const mine = w.registered.find(t => t.name === 'load_skill')
  expect(mine?.isDeferred).toBe(false)
  expect((mine?.inputSchema as { required: string[] }).required).toEqual(['skill', 'dir'])
  expect(await $.tool.check({ tool: TOOL, input: { skill: 'acme:work', dir: DIR } })).toMatchObject({ decision: 'allow' })
})

test('tool.call returns result and context', async ($, on) => {
  const w = world(on, { rt: { exitCode: 0, stdout: `${JSON.stringify(ENVELOPE)}\n` } })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toMatchObject({
    result: `Loaded acme:work (pack 0.1.0, mattstack 0.32.76): ${BODY.length} characters in 1 parts. Its full text follows as context: follow it as the skill. Where it says this skill's directory, use ${DIR}.`,
    context: [BODY],
  })
  expect(w.runs).toEqual([{ argv: ['rt', 'skills', 'render', 'acme:work', '--dir', DIR, '--json'], timeoutMs: 60_000 }])
})

test('a stale render says so in the result', async ($, on) => {
  world(on, { rt: { exitCode: 0, stdout: JSON.stringify({ ...ENVELOPE, staleBecause: 'bindings.jsonc: acme:nope cannot be filled' }) } })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toMatchObject({
    result: `Loaded acme:work (pack 0.1.0, mattstack 0.32.76): ${BODY.length} characters in 1 parts; served the last good render: bindings.jsonc: acme:nope cannot be filled. Its full text follows as context: follow it as the skill. Where it says this skill's directory, use ${DIR}.`,
    context: [BODY],
  })
})

test("a failed render's deny carries its first compile error", async ($, on) => {
  const failed = { error: { code: 'render-failed', message: "acme 0.1.0 didn't render on this Mac.", why: 'bindings.jsonc: acme:nope cannot be filled' } }
  world(on, { rt: { exitCode: 2, stdout: JSON.stringify(failed) } })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toEqual({ deny: "acme 0.1.0 didn't render on this Mac. bindings.jsonc: acme:nope cannot be filled" })
})

test('falls back to ~/.local/bin/rt when rt is missing', async ($, on) => {
  const w = world(on, { [`${HOME}/.local/bin/rt`]: { exitCode: 0, stdout: JSON.stringify(ENVELOPE) } })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called.context).toEqual([BODY])
  expect(w.runs.map(r => r.argv[0])).toEqual(['rt', `${HOME}/.local/bin/rt`])
})

test('denies naming the fix when both rts fail', async ($, on) => {
  world(on, {})
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toEqual({
    deny: "acme:work isn't loaded: rt isn't on PATH or at ~/.local/bin/rt. Open mattstack.app to install rt, then call load_skill again.",
  })
})

test("denies with the envelope's sentence on ok:false", async ($, on) => {
  const w = world(on, { rt: { exitCode: 2, stdout: `${JSON.stringify(MISSING)}\n` } })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toEqual({ deny: "acme 0.1.0 isn't rendered on this Mac. Run rt setup, then call load_skill again." })
  expect(w.runs).toHaveLength(1)
})

test('an rt without the verb gives way to the next rt', async ($, on) => {
  const w = world(on, {
    rt: { exitCode: 1, stdout: '', stderr: 'rt skills has no command called render\n' },
    [`${HOME}/.local/bin/rt`]: { exitCode: 0, stdout: JSON.stringify(ENVELOPE) },
  })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called.context).toEqual([BODY])
  expect(w.runs).toHaveLength(2)
})

test("any other envelope is rt's answer, never a reason to try the next rt", async ($, on) => {
  const usage = { error: { code: 'usage', message: 'Name the skill as <plugin>:<unit> and pass its own folder with --dir.', next: 'rt skills render <plugin>:<unit> --dir <skill dir>' } }
  const w = world(on, {
    rt: { exitCode: 2, stdout: JSON.stringify(usage) },
    [`${HOME}/.local/bin/rt`]: { exitCode: 0, stdout: JSON.stringify(ENVELOPE) },
  })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toEqual({ deny: 'Name the skill as <plugin>:<unit> and pass its own folder with --dir. Run rt skills render <plugin>:<unit> --dir <skill dir>, then call load_skill again.' })
  expect(w.runs).toHaveLength(1)
})

test('an rt that ran and printed nothing is a failed rt, not a missing one', async ($, on) => {
  const w = world(on, {
    rt: { exitCode: 1, stdout: '', stderr: 'rt hit an unexpected error\n' },
    [`${HOME}/.local/bin/rt`]: { exitCode: 0, stdout: JSON.stringify(ENVELOPE) },
  })
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(called).toEqual({ deny: "acme:work isn't loaded: rt failed without saying why. See the rt log with rt daemon logs, then call load_skill again." })
  expect(w.runs).toHaveLength(1)
})

test('a render past the deadline is denied as slow, and no second rt starts it again', async ($, on) => {
  const w = world(on, { rt: 'hang', [`${HOME}/.local/bin/rt`]: { exitCode: 0, stdout: JSON.stringify(ENVELOPE) } })
  await start($)
  const call = $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  await w.clock.advance(60_000)
  expect(await call).toEqual({ deny: "acme:work isn't loaded: rendering it took longer than 60 seconds. Run rt setup to render it, then call load_skill again." })
  expect(w.runs).toHaveLength(1)
})

test('with no HOME, only rt on PATH is tried', async ($, on) => {
  const w = world(on, {}, {})
  await start($)
  await $.tool.call({ tool: TOOL, skill: 'acme:work', dir: DIR })
  expect(w.runs.map(r => r.argv[0])).toEqual(['rt'])
})

test('denies a call missing its skill or dir', async ($, on) => {
  const w = world(on, {})
  await start($)
  const called = await $.tool.call({ tool: TOOL, skill: 'acme:work' })
  expect(called).toEqual({ deny: 'Pass skill as <plugin>:<unit> and dir as the skill\'s own folder.' })
  expect(w.runs).toEqual([])
})
