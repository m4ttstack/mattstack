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
// A spill outlives its run when the module unloads or Claude exits mid-run; one untouched this long is pruned.
const STALE_SPILL_MS = 24 * 60 * 60 * 1000
// As long as a saved list is kept (store.ts), so no log outlives the list that names it.
const STALE_LOG_MS = 30 * 24 * 60 * 60 * 1000

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
  await pruneLogs($)
  return path
}

// Runs at session start too, so old logs go even when nothing runs again.
export async function pruneLogs($: EngineInterface): Promise<void> {
  try {
    const root = await logFolder($)
    const folder = `${root}/runs`
    const logs = (await $.fs.list(folder).catch(() => [])).filter(entry => entry.kind === 'file' && entry.name.endsWith('.log'))
    const now = await $.clock.now()
    const newest = [...logs].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    const old = newest.filter((entry, n) => n >= KEPT_RUN_LOGS || now - entry.mtimeMs > STALE_LOG_MS)
    const maxAge = (name: string) => (name.endsWith('.spill') ? STALE_SPILL_MS : name.endsWith('.log') ? STALE_LOG_MS : Number.POSITIVE_INFINITY)
    const stale = (await $.fs.list(root)).filter(entry => entry.kind === 'file' && now - entry.mtimeMs > maxAge(entry.name))
    const gone = [...old.map(entry => `${folder}/${entry.name}`), ...stale.map(entry => `${root}/${entry.name}`)]
    if (gone.length > 0) await $.process.run(['rm', '-f', '--', ...gone])
  } catch {
    // A prune that fails leaves extra files; the next session start or report tries again.
  }
}
