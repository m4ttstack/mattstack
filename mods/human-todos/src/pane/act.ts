import type { EngineInterface, RenderSurface } from 'claude-code'

import { isActionable } from '../items'
import type { ButtonId } from '../items'
import { peekTodos, removeTodos } from '../store'
import { cleanup, press } from '../wiring'
import { LABELS } from './model'

// Both drawers land here: the plain one from a Button's onPress, the kit one from its Client's post.
export async function pressTodo($: EngineInterface, todoId: string, button: ButtonId, surface: RenderSurface): Promise<void> {
  const todo = (await peekTodos($)).find(t => t.id === todoId)
  if (!todo) return
  try {
    await press($, todo, button, surface)
  } catch {
    $.ui.toast(`Could not ${LABELS[button].toLowerCase()} #${todo.id}`)
  }
}

export async function clearFinished($: EngineInterface): Promise<void> {
  const gone = await removeTodos($, t => !isActionable(t))
  void cleanup($, gone).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
}
