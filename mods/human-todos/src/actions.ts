import type { EngineInterface, On, RenderSurface } from 'claude-code'

import type { Todo } from '../types'
import type { ButtonId } from './items'
import { fileName, isImageName } from './items'
import { report } from './report'
import { cleanupHerdr, herdrSession, releaseHerdr } from './herdr'
import { releaseLocal } from './local'
import { cleanupRun, forceStopRun, showRun, startRun, stopRun } from './runners'
import { syncSpinner } from './spinner'
import { getRunnerPref, listTodos, patchTodo, setRunnerPref } from './store'

// Two presses read the item before either has marked it running, so the check and the add share one synchronous step.
const confirmingIds = new Set<string>()

type Chosen = { runner: 'local' } | { runner: 'herdr'; session: string }

// `auto` runs on a herdr server when one is up or the plugin can start its own, else in Claude Code; a pinned `herdr`
// has no fallback, so it is null when no server can be had.
export async function chooseRunner($: EngineInterface): Promise<Chosen | null> {
  const pref = await getRunnerPref($)
  if (pref === 'local') return { runner: 'local' }
  const session = await herdrSession($)
  if (session) return { runner: 'herdr', session }
  return pref === 'herdr' ? null : { runner: 'local' }
}

// Never rejects: it runs detached, and the item must not be left running with nothing behind it.
async function launch($: EngineInterface, todo: Todo): Promise<void> {
  try {
    await startRun($, todo)
    return
  } catch {
    // fall through to put the item back
  }
  try {
    const held = (await listTodos($)).find(t => t.id === todo.id)
    if (held?.tabId) await cleanupHerdr($, held).catch(() => undefined)
    const gone = { runner: undefined, token: undefined, paneId: undefined, tabId: undefined }
    await patchTodo($, todo.id, { ...gone, status: 'open', liveTail: undefined, note: 'Could not start' })
    await syncSpinner($)
  } catch {
    // the toast below still tells the person
  }
  $.ui.toast(`Could not start #${todo.id}`)
}

// The item turns running before the runner is chosen, so a second Confirm during a slow probe finds nothing to confirm.
async function confirm($: EngineInterface, todo: Todo): Promise<void> {
  const fresh = { runner: undefined, liveTail: [], isStopping: false, note: undefined, exitCode: undefined, outputTail: undefined }
  await patchTodo($, todo.id, { ...fresh, status: 'running' })
  await syncSpinner($)
  const chosen = await chooseRunner($)
  const still = (await listTodos($)).find(t => t.id === todo.id)
  if (still?.status !== 'running') return
  if (!chosen) {
    await patchTodo($, todo.id, { status: 'open', liveTail: undefined, note: 'herdr is not running' })
    await syncSpinner($)
    $.ui.toast(`herdr is not running and could not be started, so #${todo.id} did not run`)
    return
  }
  // A local run keeps the server of a tab the item once had on herdr, so clearing it can still close that tab.
  const where = chosen.runner === 'herdr' ? { runner: chosen.runner, herdrSession: chosen.session } : { runner: chosen.runner }
  await patchTodo($, todo.id, where)
  void launch($, { ...still, ...where })
}

async function stop($: EngineInterface, todo: Todo): Promise<void> {
  if (todo.isStopping) return
  if (!todo.runner) {
    await patchTodo($, todo.id, { status: 'open', liveTail: undefined, note: 'Stopped' })
    await syncSpinner($)
    return
  }
  await patchTodo($, todo.id, { isStopping: true })
  $.ui.toast(`Stopping #${todo.id}`)
  await stopRun($, { ...todo, isStopping: true })
}

async function forceStop($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.toast(`Force stopping #${todo.id}`)
  await forceStopRun($, todo)
}

async function openLink($: EngineInterface, url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return $.ui.toast('Only http and https links open from here')
  await $.process.run(['open', url])
}

// open launches whatever a path lands on, so each must resolve, links followed, to a plain file named as an image.
async function openImages($: EngineInterface, todo: Todo): Promise<void> {
  const real: string[] = []
  for (const path of todo.paths ?? []) {
    const stat = path.startsWith('/') ? await $.fs.stat(path, { resolve: true }).catch(() => undefined) : undefined
    const landed = stat?.realPath
    if (stat?.kind !== 'file' || landed === undefined || !landed.startsWith('/') || !isImageName(landed)) {
      return $.ui.toast(`Could not open #${todo.id}: ${fileName(path)} is not an image file`)
    }
    real.push(landed)
  }
  if (real.length === 0) return $.ui.toast(`#${todo.id} has no images to open`)
  const opened = await $.process.run(['open', ...real])
  if (opened.exitCode !== 0) $.ui.toast(`Could not open the images for #${todo.id}`)
}

export async function press($: EngineInterface, todo: Todo, button: ButtonId, surface: RenderSurface): Promise<void> {
  const current = (await listTodos($)).find(t => t.id === todo.id)
  if (!current) return

  switch (button) {
    case 'run':
      if (current.status === 'open') await patchTodo($, current.id, { status: 'confirming' })
      return
    case 'cancel':
      if (current.status === 'confirming') await patchTodo($, current.id, { status: 'open' })
      return
    case 'confirm':
      if (current.status !== 'confirming' || confirmingIds.has(current.id)) return
      confirmingIds.add(current.id)
      try {
        await confirm($, current)
      } finally {
        confirmingIds.delete(current.id)
      }
      return
    case 'done':
    case 'skip':
      if (current.status === 'open') await report($, current, { kind: button === 'done' ? 'done' : 'skipped' })
      return
    case 'stop':
      if (current.status === 'running') await stop($, current)
      return
    case 'forceStop':
      if (current.status === 'running' && current.isStopping && current.runner) await forceStop($, current)
      return
    case 'show':
      if (current.status === 'running' && current.runner) await showRun($, current)
      return
    case 'open':
      return current.kind === 'image' ? openImages($, current) : openLink($, current.url ?? '')
    case 'copy':
      if (current.script) await $.ui.copy({ text: current.script, surface })
      return
    case 'openLog':
      if (current.logPath) await $.process.run(['open', '-t', current.logPath])
      return
  }
}

export async function cleanup($: EngineInterface, gone: readonly Todo[]): Promise<void> {
  let isFailed = false
  for (const t of gone) {
    try {
      if (t.runner) await cleanupRun($, t)
    } catch {
      isFailed = true
    }
    try {
      if (t.tabId && t.runner !== 'herdr') await cleanupHerdr($, t)
    } catch {
      isFailed = true
    }
  }
  await syncSpinner($)
  if (isFailed) throw new Error('A runner could not tidy up')
}

// The list stays saved under the session being left, so its logs and tabs stay for when it is resumed.
// Every run goes, including one still being set up that no saved item names yet.
export async function release($: EngineInterface): Promise<void> {
  let isFailed = false
  releaseHerdr()
  try {
    await releaseLocal($)
  } catch {
    isFailed = true
  }
  await syncSpinner($)
  if (isFailed) throw new Error('A runner could not let go')
}

export function registerActions(on: On): void {
  on('command.run', { command: 'todos-runner' }, async ($, e) => {
    const choice = e.args.trim()
    if (choice !== 'auto' && choice !== 'herdr' && choice !== 'local') {
      return { text: `Runner is ${await getRunnerPref($)}. Use /todos-runner auto, herdr or local.` }
    }
    await setRunnerPref($, choice)
    return { text: `Run now uses ${choice === 'auto' ? 'herdr when it is available, else the plugin itself' : choice}.` }
  })
}
