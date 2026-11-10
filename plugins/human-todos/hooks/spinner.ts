import type { EngineInterface, Timer } from 'claude-code'

import { bumpFrame, peekTodos } from './store'

const FRAME_MS = 100

let timer: Timer | undefined

function stop(): void {
  timer?.cancel()
  timer = undefined
}

// A tick reads what is loaded and never loads, or a tick just after leaving a session would load it back.
async function hasRunning($: EngineInterface): Promise<boolean> {
  return (await peekTodos($)).some(t => t.status === 'running')
}

// The pane reads the frame atom, so a timer must advance it while an item runs and rest otherwise.
export async function syncSpinner($: EngineInterface): Promise<void> {
  if (!(await hasRunning($))) return stop()
  if (timer) return
  timer = $.clock.every(FRAME_MS, () => {
    void (async () => {
      try {
        if (await hasRunning($)) await bumpFrame($)
        else stop()
      } catch {
        // the next tick tries again
      }
    })()
  })
}
