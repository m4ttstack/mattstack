import type { EngineInterface, ProcessRunResult } from 'claude-code'

export const RT_TIMEOUT_MS = 15_000
// A command that cannot start rejects at once; one that rejects later overran its timeout, and may have done its work.
const START_FAILURE_MS = 2_000

export const RT_OVERRAN = 'rt overran'

// rt on PATH first, then where mattstack installs it. Only a name that could not start moves on to the next:
// a run that overran is never sent again, since `gate answer` is a write. It rejects with RT_OVERRAN then.
export async function runRt($: EngineInterface, args: readonly string[], timeoutMs = RT_TIMEOUT_MS): Promise<ProcessRunResult> {
  const home = await $.env.get('HOME')
  const names = ['rt', `${home ?? ''}/.local/bin/rt`]
  let failure: unknown
  for (const rt of names) {
    const started = await $.clock.now()
    try {
      return await $.process.run([rt, ...args], { timeoutMs })
    } catch (error) {
      if ((await $.clock.now()) - started >= START_FAILURE_MS) throw new Error(RT_OVERRAN)
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

// `rt settings get --json` prints `{ ok, key, value, ... }`; anything else, an rt without the key included, reads as off.
export function settingIsOn(ran: ProcessRunResult): boolean {
  if (ran.exitCode !== 0) return false
  try {
    const parsed = JSON.parse(ran.stdout) as { ok?: unknown; value?: unknown }
    return parsed.ok === true && parsed.value === true
  } catch {
    return false
  }
}
