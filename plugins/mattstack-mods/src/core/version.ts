export const MIN_CLAUDE_CODE = '2.1.293'

/** plugin.json's version, which the engine does not expose; an rt-side test keeps the two equal. */
export const PLUGIN_VERSION = '0.2.3'

function release(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function supportedEngine(version: string): boolean {
  const have = release(version)
  const need = release(MIN_CLAUDE_CODE)
  if (!have || !need) return false
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return (have[i] ?? 0) > (need[i] ?? 0)
  }
  return true
}
