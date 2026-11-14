import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import { TITLE, tail } from './items'
import { syncSpinner } from './spinner'
import { patchTodo } from './store'

export type Outcome =
  | { kind: 'done' | 'skipped' }
  | { kind: 'ran'; exitCode: number; outputTail: string }
  | { kind: 'stopped'; outputTail: string }
  | { kind: 'ended'; outputTail: string }

const SETTLED = { liveTail: undefined, isStopping: false }

export function settle(todo: Todo, outcome: Outcome): { patch: Partial<Todo>; text: string } {
  const who = `#${todo.id} "${todo.title}"`
  switch (outcome.kind) {
    case 'done':
      return { patch: { status: 'done' }, text: `${who}: the user marked it done.` }
    case 'skipped':
      return { patch: { status: 'skipped' }, text: `${who}: the user skipped it.` }
    case 'ran': {
      const outputTail = tail(outcome.outputTail)
      return {
        patch: { ...SETTLED, status: outcome.exitCode === 0 ? 'done' : 'failed', exitCode: outcome.exitCode, outputTail },
        text: `The user ran ${who} from the pane: exit ${outcome.exitCode}.\n\`\`\`\n${outputTail || '(no output)'}\n\`\`\``,
      }
    }
    case 'stopped':
      return {
        patch: { ...SETTLED, status: 'open', outputTail: tail(outcome.outputTail), note: 'Stopped' },
        text: `The user stopped ${who} before it finished. It is open again.`,
      }
    case 'ended':
      return {
        patch: { ...SETTLED, status: 'open', outputTail: tail(outcome.outputTail), note: 'Ended without an exit code.' },
        text: `${who} ended in its tab without reporting an exit code (most likely stopped). It is open again.`,
      }
  }
}

export async function report($: EngineInterface, todo: Todo, outcome: Outcome): Promise<void> {
  const { patch, text } = settle(todo, outcome)
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
