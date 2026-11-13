import type { EngineInterface, ProcessRunResult } from 'claude-code'

const RT_TIMEOUT_MS = 15_000

// rt on PATH first, then where mattstack installs it; a run rejects only when the command cannot start or overruns,
// never on a nonzero exit, so only a missing rt moves on to the next name.
export async function runRt($: EngineInterface, args: readonly string[]): Promise<ProcessRunResult> {
  const home = await $.env.get('HOME')
  const names = ['rt', `${home ?? ''}/.local/bin/rt`]
  let failure: unknown
  for (const rt of names) {
    try {
      return await $.process.run([rt, ...args], { timeoutMs: RT_TIMEOUT_MS })
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

// What a failed rt run said, without the `rt gate: ` lead every gate verb's failure starts with.
export function rtError(ran: ProcessRunResult): string {
  const said = (ran.stderr.trim() || ran.stdout.trim()).replace(/^rt gate: /, '')
  return said || `rt exited ${ran.exitCode}`
}
