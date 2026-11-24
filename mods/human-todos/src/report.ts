import type { EngineInterface, PromptSubmitInput, PromptSubmitResult } from 'claude-code'

import type { Todo } from '../types'
import { TITLE, tail } from './items'
import { writeRunLog } from './logs'
import { syncSpinner } from './spinner'
import { addNotice, dropNotices, listNotices, patchTodo } from './store'

// `spill` is the output a local run held before `outputTail`, as writeRunLog takes it.
export type Outcome =
  | { kind: 'done' | 'skipped' }
  | { kind: 'message'; text: string; done: boolean }
  | { kind: 'ran'; exitCode: number; outputTail: string; spill?: string | null }
  | { kind: 'stopped'; outputTail: string; spill?: string | null }
  | { kind: 'ended'; outputTail: string }

const SETTLED = { liveTail: undefined, isStopping: false }

// Where a run's whole output went, for the agent to Read: one line in the timeline, not a fenced dump.
// `log` is the file's path, `undefined` for no output, and `null` when there was output but it could not be saved.
const outputLine = (log: string | null | undefined) => (log === undefined ? '(no output)' : (log ?? '(the output could not be saved)'))

export function settle(todo: Todo, outcome: Outcome, log?: string | null): { patch: Partial<Todo>; text: string } {
  // The agent wrote these words, so they are escaped: none can close its quote and read as the user's.
  const who = `#${todo.id} ${JSON.stringify(todo.title)}`
  const output = `Output: ${outputLine(log)}`
  switch (outcome.kind) {
    case 'done':
      return { patch: { status: 'done' }, text: todo.kind !== 'run' && todo.doneLabel ? `${who}: the user pressed ${JSON.stringify(todo.doneLabel)} (done).` : `${who}: the user marked it done.` }
    case 'skipped':
      return { patch: { status: 'skipped' }, text: `${who}: the user dismissed it.` }
    case 'message':
      return outcome.done
        ? { patch: { status: 'done' }, text: `${who}: the user marked it done and says: ${outcome.text}` }
        : { patch: {}, text: `${who}: the user says: ${outcome.text}` }
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
    return await writeRunLog($, todo.id, outcome.outputTail, 'spill' in outcome ? outcome.spill : undefined)
  } catch {
    return null
  }
}

// Dismissals reach the agent on the next prompt, the person's or the pane's own, so a dismissal never starts a turn.
// Each waits until a prompt carrying it is accepted. A slash command leaves them waiting: its context would ride the
// command, not reach the model as a turn's own words.
export function submitWithNotices(
  $: EngineInterface,
  e: PromptSubmitInput,
  next: (e: PromptSubmitInput) => Promise<PromptSubmitResult>,
): Promise<PromptSubmitResult> {
  if (e.command) return next(e)
  return carrying($, waiting => next(waiting.length ? { ...e, context: [...(e.context ?? []), ...waiting] } : e))
}

// The pane's own prompt skips its own submit hook, and a plugin's submit takes no context, so waiting dismissals join its text.
function submit($: EngineInterface, text: string): Promise<PromptSubmitResult> {
  return carrying($, waiting => $.prompt.submit({ text: [`[${TITLE}] ${text}`, ...waiting].join('\n') }))
}

// The notices a prompt still on its way carries. A pane prompt waits for a busy turn to end, so another prompt can
// overlap it; neither may carry the same notice. A refused or failed prompt hands its notices back.
const inFlight = new Set<string>()

async function carrying($: EngineInterface, send: (waiting: string[]) => Promise<PromptSubmitResult>): Promise<PromptSubmitResult> {
  const waiting = (await listNotices($)).filter(n => !inFlight.has(n))
  for (const n of waiting) inFlight.add(n)
  try {
    const result = await send(waiting)
    if (result.drop === undefined) await dropNotices($, waiting)
    return result
  } finally {
    for (const n of waiting) inFlight.delete(n)
  }
}

// False when a message did not reach the agent: the item is then left as it was, so the person can send it again.
export async function report($: EngineInterface, todo: Todo, outcome: Outcome): Promise<boolean> {
  const session = await $.session.id()
  const log = await savedOutput($, todo, outcome)
  // patchTodo matches by id alone, so after a session switch it would settle the new session's item of the same number.
  if ((await $.session.id()) !== session) return false
  const { patch, text } = settle(todo, outcome, log)
  const warn = () => {
    $.ui.log(`could not send #${todo.id} to the agent`, { to: 'debug' })
    $.ui.toast(`Could not tell the agent about #${todo.id}`)
  }
  // A message is the person's own words, so it settles the item only once the prompt entered.
  if (outcome.kind === 'message') {
    const sent = await submit($, text).catch(() => ({ drop: 'failed' }))
    if ('drop' in sent && sent.drop !== undefined) {
      warn()
      return false
    }
    await patchTodo($, todo.id, patch)
    await syncSpinner($)
    return true
  }
  await patchTodo($, todo.id, patch)
  await syncSpinner($)
  if (outcome.kind === 'skipped') {
    await addNotice($, `[${TITLE}] ${text}`)
    return true
  }
  void submit($, text)
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
  return true
}
