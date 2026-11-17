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
  error?: { code?: unknown; message?: unknown; next?: unknown }
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

const isRenderError = (env: Envelope) => typeof env.error?.code === 'string' && env.error.code.startsWith('render-')

// Claude Code's own environment often has no rt on PATH, so the installed
// copy is tried next. Only the verb's own envelope settles it: an rt too old
// for the verb also prints an error, so anything else tries the next rt.
async function render($: EngineInterface, skill: string, dir: string): Promise<Envelope | null> {
  const home = await $.env.get('HOME')
  for (const rt of ['rt', `${home ?? ''}/.local/bin/rt`]) {
    try {
      const { stdout } = await $.process.run([rt, 'skills', 'render', skill, '--dir', dir, '--json'], { timeoutMs: 60_000 })
      const env = parse(stdout)
      if (env && (env.ok === true || isRenderError(env))) return env
    } catch {
      // rt not found under this name
    }
  }
  return null
}

async function loadSkill($: EngineInterface, input: { skill?: unknown; dir?: unknown }): Promise<ToolCallResult> {
  const { skill, dir } = input
  if (typeof skill !== 'string' || typeof dir !== 'string' || skill === '' || dir === '') {
    return { deny: "Pass skill as <plugin>:<unit> and dir as the skill's own folder." }
  }
  const env = await render($, skill, dir)
  if (env === null) {
    return { deny: `${skill} isn't loaded: rt isn't on PATH or at ~/.local/bin/rt. Open mattstack.app to install rt, then call load_skill again.` }
  }
  if (env.ok !== true || typeof env.body !== 'string') {
    const message = typeof env.error?.message === 'string' ? env.error.message : `${skill} didn't render.`
    const fix = typeof env.error?.next === 'string' ? ` Run ${env.error.next}, then call load_skill again.` : ''
    return { deny: `${message}${fix}` }
  }
  const pieces = splitPieces(env.body)
  return {
    result: `Loaded ${String(env.id)} (pack ${String(env.packVersion)}, mattstack ${String(env.mattstack)}): ${env.body.length} characters in ${pieces.length} parts`,
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
