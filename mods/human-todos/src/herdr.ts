import type { EngineInterface, Timer } from 'claude-code'

import type { Todo } from '../types'
import { LIVE_LINES_HERDR, TITLE, clipLines, fileName, newToken, quote } from './items'
import { report } from './report'
import type { Outcome } from './report'
import { getWorkspace, listTodos, patchTodo, setWorkspace } from './store'

const POLL_MS = 1000
const SCAN_LINES = 400
const LABEL_MAX = 40
const POLLS_TO_END = 2
const HERDR_MS = 15_000

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

function sh($: EngineInterface, command: string) {
  return $.process.run(['/bin/zsh', '-lc', command], { timeoutMs: HERDR_MS })
}

async function herdrJson($: EngineInterface, args: string): Promise<Made | null> {
  const ran = await sh($, `herdr ${args}`)
  if (ran.exitCode !== 0) return null
  try {
    return (JSON.parse(ran.stdout) as { result?: Made }).result ?? null
  } catch {
    return null
  }
}

// Every session's runs share the one workspace named TITLE: a stored id herdr no longer knows, or none yet, falls back to the one already there.
async function sharedWorkspace($: EngineInterface): Promise<string | undefined> {
  const known = await getWorkspace($)
  if (known && (await herdrJson($, `workspace get ${quote(known)}`))) return known
  const found = (await herdrJson($, 'workspace list'))?.workspaces?.find(w => w.label === TITLE)?.workspace_id
  if (found) await setWorkspace($, found)
  return found
}

// Tabs from several sessions share the workspace, so each names the session's repo; a run's own cwd is not its session's.
async function tabLabel($: EngineInterface, todo: Todo): Promise<string> {
  const repo = fileName((await $.session.cwd()).replace(/\/+$/, ''))
  return quote(`${repo ? `${repo} ` : ''}#${todo.id} ${todo.title}`.slice(0, LABEL_MAX))
}

async function paneFor($: EngineInterface, todo: Todo, cwd: string): Promise<Placed | null> {
  if (todo.paneId && (await herdrJson($, `pane get ${quote(todo.paneId)}`))) return { paneId: todo.paneId, tabId: todo.tabId }
  const label = await tabLabel($, todo)
  const shared = await sharedWorkspace($)
  if (shared) {
    const made = await herdrJson($, `tab create --workspace ${quote(shared)} --cwd ${quote(cwd)} --label ${label} --no-focus`)
    if (made?.root_pane?.pane_id) return { paneId: made.root_pane.pane_id, tabId: made.tab?.tab_id ?? made.root_pane.tab_id }
  }
  const made = await herdrJson($, `workspace create --cwd ${quote(cwd)} --label ${quote(TITLE)} --no-focus`)
  if (!made?.root_pane?.pane_id || !made.workspace?.workspace_id) return null
  await setWorkspace($, made.workspace.workspace_id)
  if (made.root_pane.tab_id) await sh($, `herdr tab rename ${quote(made.root_pane.tab_id)} ${label}`)
  return { paneId: made.root_pane.pane_id, tabId: made.root_pane.tab_id }
}

function placeTab($: EngineInterface, todo: Todo, cwd: string): Promise<Placed | null> {
  const placed = placing.then(() => paneFor($, todo, cwd))
  placing = placed.catch(() => undefined)
  return placed
}

async function paneIsIdle($: EngineInterface, paneId: string): Promise<boolean> {
  const info = (await herdrJson($, `pane process-info --pane ${quote(paneId)}`))?.process_info
  return Boolean(info?.shell_pid && info.foreground_process_group_id === info.shell_pid)
}

async function readPane($: EngineInterface, paneId: string): Promise<string | null> {
  try {
    const ran = await sh($, `herdr pane read ${quote(paneId)} --source recent-unwrapped --lines ${SCAN_LINES}`)
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
  if (!todo || todo.status !== 'running' || todo.token !== token || !todo.paneId) return end(token)

  const text = await readPane($, todo.paneId)
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

  const isIdle = scan.isEchoed && (await paneIsIdle($, todo.paneId))
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
  let token = ''
  do token = newToken()
  while (runs.has(token))
  const run: Run = { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] }
  runs.set(token, run)
  try {
    const placed = await placeTab($, todo, todo.cwd ?? (await $.session.cwd()))
    if (!placed) throw new Error('herdr made no tab')
    const still = run.isGone ? undefined : (await listTodos($)).find(t => t.id === todo.id)
    if (run.isGone || still?.status !== 'running') {
      run.isGone = true
      if (placed.tabId) await sh($, `herdr tab close ${quote(placed.tabId)}`)
      return end(token)
    }
    await patchTodo($, todo.id, { token, paneId: placed.paneId, tabId: placed.tabId, liveTail: [], isStopping: false })
    const wrapper = `trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?`
    const typed = await sh($, `herdr pane run ${quote(placed.paneId)} ${quote(`zsh -c ${quote(wrapper)} todo ${quote(todo.script ?? '')}`)}`)
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
    isSent = todo.paneId !== undefined && (await sh($, `herdr pane send-keys ${quote(todo.paneId)} ctrl+c`)).exitCode === 0
  } catch {
    isSent = false
  }
  if (isSent) return
  await patchTodo($, todo.id, { isStopping: false })
  $.ui.toast(`Could not stop #${todo.id}`)
}

export async function showHerdr($: EngineInterface, todo: Todo): Promise<void> {
  let isShown = true
  try {
    const workspace = await getWorkspace($)
    if (workspace) isShown = (await sh($, `herdr workspace focus ${quote(workspace)}`)).exitCode === 0
    if (todo.tabId) isShown = (await sh($, `herdr tab focus ${quote(todo.tabId)}`)).exitCode === 0 && isShown
    // rt also raises the terminal window, but it is only a nicety.
    if (todo.paneId && (await sh($, 'command -v rt')).exitCode === 0) await sh($, `rt pane focus ${quote(todo.paneId)}`)
  } catch {
    isShown = false
  }
  if (!isShown) $.ui.toast('Could not bring that tab forward')
}

// The tab outlives the run until the item is cleared or withdrawn.
export async function cleanupHerdr($: EngineInterface, todo: Todo): Promise<void> {
  const run = todo.token ? runs.get(todo.token) : undefined
  if (todo.token && run) {
    run.isGone = true
    end(todo.token)
  }
  if (todo.tabId) await sh($, `herdr tab close ${quote(todo.tabId)}`)
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
    if (todo.status !== 'running' || todo.runner !== 'herdr' || !todo.token || !todo.paneId || runs.has(todo.token)) continue
    runs.set(todo.token, { id: todo.id, isGone: false, isBusy: false, idlePolls: 0, unreadPolls: 0, output: [] })
    watch($, todo.token)
  }
}
