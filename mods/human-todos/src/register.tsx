import type { On } from 'claude-code'

import { registerActions } from './actions'
import { registerContract } from './contract'
import { registerPane } from './pane'

export function register(on: On): void {
  registerContract(on)
  registerPane(on)
  registerActions(on)
}
