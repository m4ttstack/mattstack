import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'

export async function startHerdr($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`herdr.start #${todo.id}`, { to: 'debug' })
}

export async function stopHerdr($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`herdr.stop #${todo.id}`, { to: 'debug' })
}

export async function showHerdr($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`herdr.show #${todo.id}`, { to: 'debug' })
}

export async function cleanupHerdr($: EngineInterface, todo: Todo): Promise<void> {
  $.ui.log(`herdr.cleanup #${todo.id}`, { to: 'debug' })
}
