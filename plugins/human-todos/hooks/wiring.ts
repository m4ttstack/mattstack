import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'
import type { ButtonId } from './items'

export { openPane } from './pane'

// The host follows `$` only into functions of the module's own files, never through an object
// passed in, so the pane and the contract reach the actions and the cleanup through these imports.
export async function press(_$: EngineInterface, _todo: Todo, _button: ButtonId, _surface: string): Promise<void> {}

export async function cleanup(_$: EngineInterface, _gone: readonly Todo[]): Promise<void> {}
