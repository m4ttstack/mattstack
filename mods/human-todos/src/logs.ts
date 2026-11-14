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

// Writes a finished run's whole output for the agent's report and returns its path; undefined when there was no output.
// `$.fs` has no remove, so older reports go with `rm`. A failed write or prune is reported by the caller, never thrown.
export async function writeRunLog($: EngineInterface, todoId: string, output: string): Promise<string | undefined> {
  if (output.trim() === '') return undefined
  const folder = `${await logFolder($)}/runs`
  const path = `${folder}/${await $.session.id()}-${todoId}-${await $.clock.now()}.log`
  await $.fs.write(path, output.endsWith('\n') ? output : `${output}\n`)
  try {
    const logs = (await $.fs.list(folder)).filter(entry => entry.kind === 'file' && entry.name.endsWith('.log'))
    const old = [...logs].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name)).slice(KEPT_RUN_LOGS)
    if (old.length > 0) await $.process.run(['rm', '-f', '--', ...old.map(entry => `${folder}/${entry.name}`)])
  } catch {
    // A prune that fails leaves extra files; the next report tries again.
  }
  return path
}
