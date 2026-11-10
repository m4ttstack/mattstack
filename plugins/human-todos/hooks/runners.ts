import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import { cleanupHerdr, releaseHerdr, showHerdr, startHerdr, stopHerdr } from './herdr'
import { cleanupLocal, forceStopLocal, releaseLocal, showLocal, startLocal, stopLocal } from './local'

// The host follows `$` into a call only through a function imported by name, never through a
// runner object or a lookup table, so each verb spells out both runners.
export function startRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? startHerdr($, todo) : startLocal($, todo)
}

export function stopRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? stopHerdr($, todo) : stopLocal($, todo)
}

// herdr has no stronger signal than the ctrl+c Stop sent, so it sends it again.
export function forceStopRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? stopHerdr($, todo) : forceStopLocal($, todo)
}

export function showRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? showHerdr($, todo) : showLocal($, todo)
}

export function cleanupRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? cleanupHerdr($, todo) : cleanupLocal($, todo)
}

export function releaseRun($: EngineInterface, todo: Todo): Promise<void> {
  return todo.runner === 'herdr' ? releaseHerdr($, todo) : releaseLocal($, todo)
}
