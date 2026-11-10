import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import { report } from './report'

export async function startLocal($: EngineInterface, todo: Todo): Promise<void> {
  const ran = await $.process.run(['/bin/zsh', '-lc', todo.script ?? ''], { cwd: todo.cwd })
  await report($, todo, { kind: 'ran', exitCode: ran.exitCode, outputTail: `${ran.stdout}${ran.stderr}` })
}

export async function stopLocal($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`local.stop #${todo.id}`, { to: 'debug' })
}

export async function showLocal($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`local.show #${todo.id}`, { to: 'debug' })
}

export async function cleanupLocal($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`local.cleanup #${todo.id}`, { to: 'debug' })
}
