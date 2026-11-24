import type { EngineInterface, ProcessRunResult } from 'claude-code'

import { runFirst } from './run'

export const RT_TIMEOUT_MS = 15_000

// rt on PATH first, then where mattstack installs it. `gate answer` is a write, which is why an overrun is never sent again.
export async function runRt($: EngineInterface, args: readonly string[], timeoutMs = RT_TIMEOUT_MS): Promise<ProcessRunResult> {
  const home = await $.env.get('HOME')
  return runFirst($, ['rt', `${home ?? ''}/.local/bin/rt`], args, timeoutMs)
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
