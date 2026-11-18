import type { EngineInterface, RenderSurface } from 'claude-code'

import { TITLE, isActionable } from '../items'
import type { ButtonId } from '../items'
import { closeComposing, peekTodos, removeTodos, toggleComposing, toggleExpanded } from '../store'
import { report } from '../report'
import { clampScroll, cleanup, press } from '../wiring'
import { LABELS } from './model'
import type { PaneMessage } from './model'

async function pressTodo($: EngineInterface, todoId: string, button: ButtonId, surface: RenderSurface): Promise<void> {
  const todo = (await peekTodos($)).find(t => t.id === todoId)
  if (!todo) return
  try {
    await press($, todo, button, surface)
  } catch {
    $.ui.toast(`Could not ${LABELS[button].toLowerCase()} #${todo.id}`)
  }
}

// A message goes to the agent through the same channel as Done and Skip; Send & mark done also finishes the item.
async function sendMessage($: EngineInterface, todoId: string, text: string, done: boolean): Promise<void> {
  const todo = (await peekTodos($)).find(t => t.id === todoId)
  await closeComposing($)
  if (!todo || todo.status !== 'open' || text.trim() === '') return
  await report($, todo, { kind: 'message', text: text.trim(), done })
}

async function clearFinished($: EngineInterface): Promise<void> {
  const gone = await removeTodos($, t => !isActionable(t))
  await clampScroll($)
  void cleanup($, gone).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
}

// Both drawers land here: the plain one from a Button's onPress, the kit one from its Client's post.
// Neither caller awaits it, so it says what failed instead of rejecting.
export async function act($: EngineInterface, message: PaneMessage, surface: RenderSurface): Promise<void> {
  try {
    if (message.type === 'press' && message.button === 'message') return await toggleComposing($, message.id)
    if (message.type === 'press' && message.button === 'cancelMessage') return await closeComposing($)
    if (message.type === 'send') return await sendMessage($, message.id, message.text, message.done)
    if (message.type === 'press') return await pressTodo($, message.id, message.button, surface)
    if (message.type === 'toggle') return await toggleExpanded($, message.id)
    if (message.type === 'clear') return await clearFinished($)
  } catch {
    $.ui.toast(`Could not update ${TITLE}`)
  }
}
