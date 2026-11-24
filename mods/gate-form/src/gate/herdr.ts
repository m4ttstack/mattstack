import type { EngineInterface, ProcessRunResult } from 'claude-code'

import { runFirst } from './run'

const HERDR_TIMEOUT_MS = 5_000

// herdr names its own binary to its panes; a pane whose binary has since moved has PATH and mattstack's install left.
export function herdrBins(from: { bin: string | undefined; home: string | undefined }): string[] {
  const names = [from.bin, 'herdr', from.home && `${from.home}/.local/bin/herdr`]
  return [...new Set(names.filter((name): name is string => !!name))]
}

export async function runHerdr($: EngineInterface, args: readonly string[]): Promise<ProcessRunResult> {
  const names = herdrBins({ bin: await $.env.get('HERDR_BIN_PATH'), home: await $.env.get('HOME') })
  return runFirst($, names, args, HERDR_TIMEOUT_MS)
}
