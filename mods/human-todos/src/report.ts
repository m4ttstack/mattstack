import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import { TITLE, tail } from './items'
import { writeRunLog } from './logs'
import { syncSpinner } from './spinner'
import { patchTodo } from './store'

export type Outcome =
  | { kind: 'done' | 'skipped' }
  | { kind: 'ran'; exitCode: number; outputTail: string }
  | { kind: 'stopped'; outputTail: string }
  | { kind: 'ended'; outputTail: string }

const SETTLED = { liveTail: undefined, isStopping: false }

// Where a run's whole output went, for the agent to Read: one line in the timeline, not a fenced dump.
// `log` is the file's path, `undefined` for no output, and `null` when there was output but it could not be saved.
const outputLine = (log: string | null | undefined) => (log === undefined ? '(no output)' : (log ?? '(the output could not be saved)'))

export function settle(todo: Todo, outcome: Outcome, log?: string | null): { patch: Partial<Todo>; text: string } {
  const who = `#${todo.id} "${todo.title}"`
  const output = `Output: ${outputLine(log)}`
  switch (outcome.kind) {
    case 'done':
      return { patch: { status: 'done' }, text: `${who}: the user marked it done.` }
    case 'skipped':
      return { patch: { status: 'skipped' }, text: `${who}: the user skipped it.` }
    case 'ran': {
      const outputTail = tail(outcome.outputTail)
      return {
        patch: { ...SETTLED, status: outcome.exitCode === 0 ? 'done' : 'failed', exitCode: outcome.exitCode, outputTail },
        text: `The user ran ${who} from the pane: exit ${outcome.exitCode}. ${output}`,
      }
    }
    case 'stopped':
      return {
        patch: { ...SETTLED, status: 'open', outputTail: tail(outcome.outputTail), note: 'Stopped' },
        text: `The user stopped ${who} before it finished. It is open again. ${output}`,
      }
    case 'ended':
      return {
        patch: { ...SETTLED, status: 'open', outputTail: tail(outcome.outputTail), note: 'Ended without an exit code.' },
        text: `${who} ended in its tab without reporting an exit code (most likely stopped). It is open again. ${output}`,
      }
  }
}

async function savedOutput($: EngineInterface, todo: Todo, outcome: Outcome): Promise<string | null | undefined> {
  if (!('outputTail' in outcome)) return undefined
  try {
    return await writeRunLog($, todo.id, outcome.outputTail)
  } catch {
    return null
  }
}

export async function report($: EngineInterface, todo: Todo, outcome: Outcome): Promise<void> {
  const { patch, text } = settle(todo, outcome, await savedOutput($, todo, outcome))
  await patchTodo($, todo.id, patch)
  await syncSpinner($)
  const warn = () => {
    $.ui.log(`could not send #${todo.id} to the agent`, { to: 'debug' })
    $.ui.toast(`Could not tell the agent about #${todo.id}`)
  }
  void $.prompt
    .submit({ text: `[${TITLE}] ${text}` })
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
}
