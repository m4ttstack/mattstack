import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

// A team pack commits husks: a skill's frontmatter and one line telling the
// agent to call this tool. It runs rt skills render, which renders the pack
// on this Mac when needed, and hands the body back as attached context,
// which Claude Code keeps whole up to 100,000 characters a piece. A plain
// MCP result past about 25 KB is cut to a preview, which is why this is a
// mod tool.

const TOOL = 'mcp__mattstack__load_skill'
const MAX_PIECE = 99_000

const DESCRIPTION =
  "Load the full text of a team pack skill. Call it when a skill's SKILL.md tells you to: pass the skill's id as <plugin>:<unit> and the skill's own folder as dir. The text arrives as context after the result; follow it as the skill's instructions."

type Envelope = {
  ok?: unknown
  id?: unknown
  packVersion?: unknown
  mattstack?: unknown
  body?: unknown
  staleBecause?: unknown
  error?: { code?: unknown; message?: unknown; why?: unknown; next?: unknown }
}

/** Pieces of at most `max` characters, cut at line ends; a line longer than `max` is cut at `max`. */
export function splitPieces(text: string, max = MAX_PIECE): string[] {
  const pieces: string[] = []
  let current = ''
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (current.length + line.length > max && current !== '') {
      pieces.push(current)
      current = ''
    }
    let rest = line
    while (rest.length > max) {
      pieces.push(rest.slice(0, max))
      rest = rest.slice(max)
    }
    current += rest
  }
  if (current !== '') pieces.push(current)
  return pieces
}

function parse(stdout: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim())
    return parsed !== null && typeof parsed === 'object' ? (parsed as Envelope) : null
  } catch {
    return null
  }
}

const RENDER_TIMEOUT_MS = 60_000

// What an rt older than the verb prints, on stderr with nothing on stdout.
const NO_VERB_RE = /has no command called render/

type Outcome = { kind: 'envelope'; env: Envelope } | { kind: 'failed' } | { kind: 'timeout' } | { kind: 'no-rt' }

// Claude Code's own environment often has no rt on PATH, so the installed
// copy is tried next. Only an rt that cannot start, or one older than the
// verb, gives way to the next: any other answer is rt's, and a second rt
// would only render again.
async function render($: EngineInterface, skill: string, dir: string): Promise<Outcome> {
  const home = await $.env.get('HOME')
  const rts = home ? ['rt', `${home}/.local/bin/rt`] : ['rt']
  for (const rt of rts) {
    const started = await $.clock.now()
    let ran: { stdout: string; stderr: string }
    try {
      ran = await $.process.run([rt, 'skills', 'render', skill, '--dir', dir, '--json'], { timeoutMs: RENDER_TIMEOUT_MS })
    } catch {
      // A run cut off at the deadline rejects just as one that cannot start does; only the time taken tells them apart.
      if ((await $.clock.now()) - started >= RENDER_TIMEOUT_MS) return { kind: 'timeout' }
      continue
    }
    const env = parse(ran.stdout)
    if (env) return { kind: 'envelope', env }
    if (ran.stdout.trim() === '' && NO_VERB_RE.test(ran.stderr)) continue
    return { kind: 'failed' }
  }
  return { kind: 'no-rt' }
}

async function loadSkill($: EngineInterface, input: { skill?: unknown; dir?: unknown }): Promise<ToolCallResult> {
  const { skill, dir } = input
  if (typeof skill !== 'string' || typeof dir !== 'string' || skill === '' || dir === '') {
    return { deny: "Pass skill as <plugin>:<unit> and dir as the skill's own folder." }
  }
  const outcome = await render($, skill, dir)
  if (outcome.kind === 'no-rt') {
    return { deny: `${skill} isn't loaded: rt isn't on PATH or at ~/.local/bin/rt. Open mattstack.app to install rt, then call load_skill again.` }
  }
  if (outcome.kind === 'timeout') {
    return { deny: `${skill} isn't loaded: rendering it took longer than ${RENDER_TIMEOUT_MS / 1000} seconds. Run rt setup to render it, then call load_skill again.` }
  }
  if (outcome.kind === 'failed') {
    return { deny: `${skill} isn't loaded: rt failed without saying why. See the rt log with rt daemon logs, then call load_skill again.` }
  }
  const env = outcome.env
  if (env.ok !== true || typeof env.body !== 'string') {
    const message = typeof env.error?.message === 'string' ? env.error.message : `${skill} didn't render.`
    const why = typeof env.error?.why === 'string' ? ` ${env.error.why}` : ''
    const fix = typeof env.error?.next === 'string' ? ` Run ${env.error.next}, then call load_skill again.` : ''
    return { deny: `${message}${why}${fix}` }
  }
  const pieces = splitPieces(env.body)
  const stale = typeof env.staleBecause === 'string' ? `; served the last good render: ${env.staleBecause}` : ''
  return {
    result: `Loaded ${String(env.id)} (pack ${String(env.packVersion)}, mattstack ${String(env.mattstack)}): ${env.body.length} characters in ${pieces.length} parts${stale}`,
    context: pieces,
  }
}

export const register: Register = on => {
  // The plugin's one hooks module takes a single matcherless session.start
  // (slack-support's); this matcher matches every session.
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    await $.tool.register({
      name: 'load_skill',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: "The skill's id, as <plugin>:<unit>" },
          dir: { type: 'string', description: "The skill's own folder, the one holding its SKILL.md" },
        },
        required: ['skill', 'dir'],
      },
    }).catch(() => undefined)
    // A refused registration must not skip the rest of the plugin's session start.
    return next(e)
  })

  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' as const })).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, ($, e) => loadSkill($, e as unknown as { skill?: unknown; dir?: unknown })).catch(() => ({
    deny: "The skill didn't load because load_skill hit an unexpected error. Call load_skill again.",
  }))
}
