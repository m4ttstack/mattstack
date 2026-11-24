import type { EngineInterface, ProcessRunResult } from 'claude-code'

// A command that cannot start rejects at once; one that rejects later overran its timeout, and may have done its work.
const START_FAILURE_MS = 2_000

export class Overran extends Error {}

// Only a name that could not start moves on to the next: a run that overran is never sent again.
export async function runFirst($: EngineInterface, names: readonly string[], args: readonly string[], timeoutMs: number): Promise<ProcessRunResult> {
  let failure: unknown
  for (const name of names) {
    const started = await $.clock.now()
    try {
      return await $.process.run([name, ...args], { timeoutMs })
    } catch (error) {
      if ((await $.clock.now()) - started >= START_FAILURE_MS) throw new Overran(`${name} overran`)
      failure = error
    }
  }
  throw failure
}
