import type { EngineInterface } from 'claude-code'

// The mods API has no plugin data folder, so logs go in the user's cache folder, where the agent can Read them.
export async function logFolder($: EngineInterface): Promise<string> {
  const cache = await $.env.get('XDG_CACHE_HOME')
  if (cache) return `${cache}/human-todos`
  const home = await $.env.get('HOME')
  if (!home) throw new Error('no home folder for the log')
  return `${home}/Library/Caches/human-todos`
}

// How many run reports keep their output file; older ones are removed as new ones are written.
export const KEPT_RUN_LOGS = 20

export const DROPPED = '[earlier output was dropped]\n'

// Joining a capped spill is quick, but well past `$.process.run`'s 30 s default on a slow disk.
const JOIN_TIMEOUT_MS = 120_000

async function joinSpill($: EngineInterface, spill: string, text: string, path: string): Promise<boolean> {
  const argv = ['/bin/sh', '-c', 'mkdir -p -- "$(dirname -- "$2")" && cat -- "$1" - > "$2"', 'sh', spill, path]
  try {
    return (await $.process.run(argv, { stdin: text, timeoutMs: JOIN_TIMEOUT_MS })).exitCode === 0
  } catch {
    return false
  }
}

// Writes a finished run's whole output for the agent's report and returns its path; undefined when there was no output.
// `spill` is a file holding the output that came before `output`, or null when that earlier output was lost.
// `$.fs` has no append or remove, so a spill is joined with `cat` and older reports go with `rm`.
// A join that fails keeps the window, marked as cut. A failed write or prune is reported by the caller, never thrown.
export async function writeRunLog($: EngineInterface, todoId: string, output: string, spill?: string | null): Promise<string | undefined> {
  if (output.trim() === '' && spill === undefined) return undefined
  const folder = `${await logFolder($)}/runs`
  const path = `${folder}/${await $.session.id()}-${todoId}-${await $.clock.now()}.log`
  const text = output.endsWith('\n') ? output : `${output}\n`
  if (typeof spill !== 'string' || !(await joinSpill($, spill, text, path))) {
    await $.fs.write(path, spill === undefined ? text : `${DROPPED}${text}`)
  }
  try {
    const logs = (await $.fs.list(folder)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.log'))
    const old = [...logs].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)).slice(KEPT_RUN_LOGS)
    if (old.length > 0) await $.process.run(['rm', '-f', '--', ...old.map(entry => `${folder}/${entry.name}`)])
  } catch {
    // A prune that fails leaves extra files; the next report tries again.
  }
  return path
}
