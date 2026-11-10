import type { EngineInterface, On, RenderSurface } from 'claude-code'

import type { Todo } from '../types'
import type { ButtonId } from './items'
import { report } from './report'
import { cleanupRun, showRun, startRun, stopRun } from './runners'
import { syncSpinner } from './spinner'
import { getRunnerPref, listTodos, patchTodo, setRunnerPref } from './store'

export { report } from './report'
export type { Outcome } from './report'

const HERDR_PROBE_MS = 15_000

export async function chooseRunner($: EngineInterface): Promise<'herdr' | 'local'> {
  const pref = await getRunnerPref($)
  if (pref !== 'auto') return pref
  if (!(await $.env.get('HERDR_SOCKET_PATH'))) return 'local'
  const probe = await $.process.run(['/bin/zsh', '-lc', 'herdr workspace list'], { timeoutMs: HERDR_PROBE_MS })
  return probe.exitCode === 0 ? 'herdr' : 'local'
}

async function confirm($: EngineInterface, todo: Todo): Promise<void> {
  const runner = await chooseRunner($)
  const running: Todo = { ...todo, status: 'running', runner, liveTail: [], isStopping: false, note: undefined }
  await patchTodo($, todo.id, running)
  await syncSpinner($)
  void startRun($, running).catch(async () => {
    await patchTodo($, todo.id, { status: 'open', liveTail: undefined, note: 'Could not start' })
    await syncSpinner($)
    $.ui.toast(`Could not start #${todo.id}`)
  })
}

async function stop($: EngineInterface, todo: Todo): Promise<void> {
  if (!todo.runner || todo.isStopping) return
  await patchTodo($, todo.id, { isStopping: true })
  $.ui.toast(`Stopping #${todo.id}`)
  await stopRun($, { ...todo, isStopping: true })
}

async function openLink($: EngineInterface, url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) return $.ui.toast('Only http and https links open from here')
  await $.process.run(['open', url])
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
      if (current.status === 'confirming') await confirm($, current)
      return
    case 'done':
    case 'skip':
      if (current.status === 'open') await report($, current, { kind: button === 'done' ? 'done' : 'skipped' })
      return
    case 'stop':
      if (current.status === 'running') await stop($, current)
      return
    case 'show':
      if (current.status === 'running' && current.runner) await showRun($, current)
      return
    case 'open':
      return openLink($, current.url ?? '')
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
    if (!t.runner) continue
    try {
      await cleanupRun($, t)
    } catch {
      isFailed = true
    }
  }
  await syncSpinner($)
  if (isFailed) throw new Error('A runner could not tidy up')
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
