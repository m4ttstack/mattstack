import type { EngineInterface, Timer } from 'claude-code'

import type { Todo } from '../types'
import { LIVE_LINES_HERDR, TITLE, clipLines, fileName, newToken, quote } from './items'
import { logFolder } from './local'
import { report } from './report'
import type { Outcome } from './report'
import { getWorkspace, listTodos, patchTodo, setWorkspace } from './store'

const POLL_MS = 1000
const SCAN_LINES = 400
const SHOW_LINES = 5000
const LABEL_MAX = 40
const POLLS_TO_END = 2
const HERDR_MS = 15_000
// mattstack's background server takes runs when it is up; otherwise this plugin's own, started on demand. Neither is the
// server a person has on screen, so no tab of a run appears there.
const BG_SESSION = 'mattstack-bg'
const OWN_SESSION = 'human-todos'
const START_MS = 10_000
const START_POLL_MS = 250

type Run = { id: string; poller?: Timer; isGone: boolean; isBusy: boolean; idlePolls: number; unreadPolls: number; output: string[] }
type Made = {
  workspace?: { workspace_id?: string }
  workspaces?: { workspace_id?: string; label?: string }[]
  tab?: { tab_id?: string }
  root_pane?: { pane_id?: string; tab_id?: string }
  process_info?: { shell_pid?: number; foreground_process_group_id?: number }
}
type Placed = { paneId: string; tabId?: string }

// One entry per watched run, keyed by its token, so two runs never share a poller or a count.
const runs = new Map<string, Run>()

// Tab placement is one at a time, or two runs started together would each create the workspace.
let placing: Promise<unknown> = Promise.resolve()

// Two runs confirmed together share one look for the server, so the plugin never starts its own twice.
let picking: Promise<string | null> | undefined

function sh($: EngineInterface, command: string) {
  return $.process.run(['/bin/zsh', '-lc', command], { timeoutMs: HERDR_MS })
}

// Every command for a server names it and drops HERDR_SOCKET_PATH: herdr hands that to the panes of the server on screen,
// Claude Code runs in one, and it outranks HERDR_SESSION, so leaving it would reach the visible server instead.
function herdrCommand(session: string, args: string): string {
  return `env -u HERDR_SOCKET_PATH HERDR_SESSION=${quote(session)} herdr ${args}`
}

function herdr($: EngineInterface, session: string, args: string) {
  return sh($, herdrCommand(session, args))
}

async function herdrJson($: EngineInterface, session: string, args: string): Promise<Made | null> {
  const ran = await herdr($, session, args)
  if (ran.exitCode !== 0) return null
  try {
    return (JSON.parse(ran.stdout) as { result?: Made }).result ?? null
  } catch {
    return null
  }
}

// The servers that run now, by name; null when herdr cannot be asked (not installed, or broken).
async function runningSessions($: EngineInterface): Promise<string[] | null> {
  try {
    const ran = await sh($, 'env -u HERDR_SOCKET_PATH herdr session list --json')
    if (ran.exitCode !== 0) return null
    const listed = (JSON.parse(ran.stdout) as { sessions?: { name?: string; running?: boolean }[] }).sessions ?? []
    return listed.flatMap(s => (s.running && s.name ? [s.name] : []))
  } catch {
    return null
  }
}

async function pickSession($: EngineInterface): Promise<string | null> {
  const running = await runningSessions($)
  if (!running) return null
  if (running.includes(BG_SESSION)) return BG_SESSION
  if (running.includes(OWN_SESSION)) return OWN_SESSION
  // Detached with its output closed, so the server outlives this call and the call does not wait on it.
  await sh($, `env -u HERDR_SOCKET_PATH HERDR_SESSION=${quote(OWN_SESSION)} nohup herdr --session ${quote(OWN_SESSION)} server >/dev/null 2>&1 </dev/null &!`)
  for (let waited = 0; ; waited += START_POLL_MS) {
    if ((await runningSessions($))?.includes(OWN_SESSION)) return OWN_SESSION
    if (waited >= START_MS) return null
    await $.clock.sleep(START_POLL_MS)
  }
}

// The server a run goes to, or null when herdr is missing or its server would not come up. The plugin never stops or deletes a server.
export function herdrSession($: EngineInterface): Promise<string | null> {
  if (!picking) {
    picking = pickSession($).finally(() => {
      picking = undefined
    })
  }
  return picking
}

// Every session's runs on a server share the one workspace named TITLE: a stored id that server no longer knows, or none yet,
// falls back to the one already there.
async function sharedWorkspace($: EngineInterface, session: string): Promise<string | undefined> {
  const known = await getWorkspace($, session)
  if (known && (await herdrJson($, session, `workspace get ${quote(known)}`))) return known
  // Two sessions placing their first runs at once can each create one; `find` then picks the first herdr lists, and both go on there.
  const found = (await herdrJson($, session, 'workspace list'))?.workspaces?.find(w => w.label === TITLE)?.workspace_id
  if (found) await setWorkspace($, session, found)
  return found
}

// The repo the session works in: a worktree's folder is not its repo's name, the folder holding the shared git dir is.
// Outside git, or when git cannot answer, the session's folder.
async function repoName($: EngineInterface): Promise<string> {
  const cwd = (await $.session.cwd()).replace(/\/+$/, '')
  try {
    // Through the login shell, as herdr is, so git resolves on the person's PATH.
    const ran = await sh($, `cd ${quote(cwd)} && git rev-parse --path-format=absolute --git-common-dir`)
    const common = ran.stdout.trim().replace(/\/+$/, '')
    if (ran.exitCode === 0 && common.startsWith('/')) return fileName(common.slice(0, common.lastIndexOf('/')))
  } catch {
    // no git to ask: the folder name stands
  }
  return fileName(cwd)
}

// Tabs from several sessions share the workspace, so each names the session's repo; a run's own cwd is not its session's.
async function tabLabel($: EngineInterface, todo: Todo): Promise<string> {
  const repo = await repoName($)
  return quote(`${repo ? `${repo} ` : ''}#${todo.id} ${todo.title}`.slice(0, LABEL_MAX))
}

async function paneFor($: EngineInterface, session: string, todo: Todo, cwd: string): Promise<Placed | null> {
  if (todo.paneId && todo.herdrSession === session && (await herdrJson($, session, `pane get ${quote(todo.paneId)}`))) return { paneId: todo.paneId, tabId: todo.tabId }
  const label = await tabLabel($, todo)
  const shared = await sharedWorkspace($, session)
  if (shared) {
    const made = await herdrJson($, session, `tab create --workspace ${quote(shared)} --cwd ${quote(cwd)} --label ${label} --no-focus`)
    if (made?.root_pane?.pane_id) return { paneId: made.root_pane.pane_id, tabId: made.tab?.tab_id ?? made.root_pane.tab_id }
  }
  const made = await herdrJson($, session, `workspace create --cwd ${quote(cwd)} --label ${quote(TITLE)} --no-focus`)
  if (!made?.root_pane?.pane_id || !made.workspace?.workspace_id) return null
  await setWorkspace($, session, made.workspace.workspace_id)
  if (made.root_pane.tab_id) await herdr($, session, `tab rename ${quote(made.root_pane.tab_id)} ${label}`)
  return { paneId: made.root_pane.pane_id, tabId: made.root_pane.tab_id }
}

function placeTab($: EngineInterface, session: string, todo: Todo, cwd: string): Promise<Placed | null> {
  const placed = placing.then(() => paneFor($, session, todo, cwd))
  placing = placed.catch(() => undefined)
  return placed
}

async function paneIsIdle($: EngineInterface, session: string, paneId: string): Promise<boolean> {
  const info = (await herdrJson($, session, `pane process-info --pane ${quote(paneId)}`))?.process_info
  return Boolean(info?.shell_pid && info.foreground_process_group_id === info.shell_pid)
}

async function readPane($: EngineInterface, session: string, paneId: string, lines = SCAN_LINES): Promise<string | null> {
  try {
    const ran = await herdr($, session, `pane read ${quote(paneId)} --source recent-unwrapped --lines ${lines}`)
    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

// The typed command echoes first, one terminal line per line of the script, so output starts after those.
function scanPane(text: string, token: string, script: string): { isEchoed: boolean; output: string[]; exitCode?: number } {
  const lines = text.split('\n')
  const marker = `__todo_exit_${token}`
  const echoed = lines.findLastIndex(line => line.includes(marker) && line.includes('%s'))
  const body = lines.slice(echoed === -1 ? 0 : echoed + script.split('\n').length)
  const end = body.findIndex(line => line.trimStart().startsWith(`${marker} `))
  const output = (end === -1 ? body : body.slice(0, end)).filter(line => line.trim() !== '')
  if (end === -1) return { isEchoed: echoed !== -1, output }
  const code = Number.parseInt((body[end] ?? '').trimStart().slice(marker.length + 1), 10)
  return { isEchoed: echoed !== -1, output, exitCode: Number.isNaN(code) ? -1 : code }
}

function end(token: string): void {
  runs.get(token)?.poller?.cancel()
  runs.delete(token)
}

async function conclude($: EngineInterface, token: string, todo: Todo, outcome: Outcome): Promise<void> {
  await report($, todo, outcome)
  end(token)
}

async function pollOnce($: EngineInterface, token: string, run: Run): Promise<void> {
  const todo = (await listTodos($)).find(t => t.id === run.id)
  if (!todo || todo.status !== 'running' || todo.token !== token || !todo.paneId || !todo.herdrSession) return end(token)

  const text = await readPane($, todo.herdrSession, todo.paneId)
  if (run.isGone) return
  if (text === null) {
    run.unreadPolls += 1
    if (run.unreadPolls >= POLLS_TO_END) await conclude($, token, todo, { kind: 'ended', outputTail: run.output.join('\n') })
    return
  }
  run.unreadPolls = 0

  const scan = scanPane(text, token, todo.script ?? '')
  run.output = scan.output
  const outputTail = scan.output.join('\n')
  if (scan.exitCode !== undefined) {
    await conclude($, token, todo, todo.isStopping ? { kind: 'stopped', outputTail } : { kind: 'ran', exitCode: scan.exitCode, outputTail })
    return
  }

  const isIdle = scan.isEchoed && (await paneIsIdle($, todo.herdrSession, todo.paneId))
  if (run.isGone) return
  run.idlePolls = isIdle ? run.idlePolls + 1 : 0
  if (run.idlePolls >= POLLS_TO_END) {
    await conclude($, token, todo, { kind: 'ended', outputTail })
    return
  }
  const liveTail = clipLines(scan.output.slice(-LIVE_LINES_HERDR))
  if (JSON.stringify(liveTail) !== JSON.stringify(todo.liveTail)) await patchTodo($, todo.id, { liveTail })
}

// A failed poll leaves the item running and tries again a second later.
async function poll($: EngineInterface, token: string): Promise<void> {
  const run = runs.get(token)
  if (!run || run.isBusy) return
  run.isBusy = true
  try {
    await pollOnce($, token, run)
  } catch {
    // next tick retries
  } finally {
    run.isBusy = false
  }
}

function watch($: EngineInterface, token: string): void {
  const run = runs.get(token)
  if (!run || run.poller) return
  run.poller = $.clock.every(POLL_MS, () => {
    void poll($, token)
  })
}

export async function startHerdr($: EngineInterface, todo: Todo): Promise<void> {
  const session = todo.herdrSession
  if (!session) throw new Error('no herdr server for the run')
  let token = ''
  do token = newToken()
  while (runs.has(token))
  const run: Run = { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] }
  runs.set(token, run)
  try {
    const placed = await placeTab($, session, todo, todo.cwd ?? (await $.session.cwd()))
    if (!placed) throw new Error('herdr made no tab')
    const still = run.isGone ? undefined : (await listTodos($)).find(t => t.id === todo.id)
    if (run.isGone || still?.status !== 'running') {
      run.isGone = true
      if (placed.tabId) await herdr($, session, `tab close ${quote(placed.tabId)}`)
      return end(token)
    }
    await patchTodo($, todo.id, { token, paneId: placed.paneId, tabId: placed.tabId, herdrSession: session, liveTail: [], isStopping: false })
    const wrapper = `trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?`
    const typed = await herdr($, session, `pane run ${quote(placed.paneId)} ${quote(`zsh -c ${quote(wrapper)} todo ${quote(todo.script ?? '')}`)}`)
    if (typed.exitCode !== 0) throw new Error('herdr would not run the script')
  } catch (err) {
    end(token)
    if (run.isGone) return
    await patchTodo($, todo.id, { token: undefined }).catch(() => undefined)
    throw err
  }
  if (!run.isGone) watch($, token)
}

export async function stopHerdr($: EngineInterface, todo: Todo): Promise<void> {
  let isSent = false
  try {
    isSent = todo.paneId !== undefined && todo.herdrSession !== undefined && (await herdr($, todo.herdrSession, `pane send-keys ${quote(todo.paneId)} ctrl+c`)).exitCode === 0
  } catch {
    isSent = false
  }
  if (isSent) return
  await patchTodo($, todo.id, { isStopping: false })
  $.ui.toast(`Could not stop #${todo.id}`)
}

async function showLog($: EngineInterface, todo: Todo): Promise<string> {
  return `${await logFolder($)}/${await $.session.id()}-${todo.id}-herdr.log`
}

// The run's tab is on a server no one has on screen, so Show writes what its pane shows to a log and opens that, as Open log does.
export async function showHerdr($: EngineInterface, todo: Todo): Promise<void> {
  try {
    if (!todo.paneId || !todo.herdrSession) throw new Error('no pane to read')
    const text = await readPane($, todo.herdrSession, todo.paneId, SHOW_LINES)
    if (text === null) throw new Error('herdr would not read the pane')
    const path = await showLog($, todo)
    await $.fs.write(path, text)
    // Kept on the item, so clearing it removes the file Show wrote.
    if (todo.logPath !== path) await patchTodo($, todo.id, { logPath: path })
    if ((await $.process.run(['open', '-t', path])).exitCode !== 0) throw new Error('open failed')
  } catch {
    $.ui.toast(`Could not show the output of #${todo.id}`)
  }
}

// The tab outlives the run until the item is cleared or withdrawn.
export async function cleanupHerdr($: EngineInterface, todo: Todo): Promise<void> {
  const run = todo.token ? runs.get(todo.token) : undefined
  if (todo.token && run) {
    run.isGone = true
    end(todo.token)
  }
  if (todo.tabId && todo.herdrSession) await herdr($, todo.herdrSession, `tab close ${quote(todo.tabId)}`)
  // A local run's log is the local runner's to remove; this is the one Show wrote.
  if (todo.runner === 'herdr' && todo.logPath) await $.process.run(['rm', '-f', '--', todo.logPath]).catch(() => undefined)
}

// Each script keeps running in its tab, and resuming the session watches it again.
export function releaseHerdr(): void {
  for (const [token, run] of [...runs]) {
    run.isGone = true
    end(token)
  }
}

export async function resumeWatching($: EngineInterface): Promise<void> {
  for (const todo of await listTodos($)) {
    if (todo.status !== 'running' || todo.runner !== 'herdr' || !todo.token || !todo.paneId || !todo.herdrSession || runs.has(todo.token)) continue
    runs.set(todo.token, { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] })
    watch($, todo.token)
  }
}
