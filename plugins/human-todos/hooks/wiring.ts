import type { EngineInterface } from 'claude-code'

import type { Todo } from '../types'

// The host follows `$` only into functions of the module's own files, never through an object
// passed in, so the contract reaches the pane and the cleanup through these imports.
export async function openPane(_$: EngineInterface): Promise<void> {}

export async function cleanup(_$: EngineInterface, _gone: readonly Todo[]): Promise<void> {}
