import type { Register } from 'claude-code'

import { registerActions } from './actions'
import { registerContract } from './contract'
import { registerPane } from './pane'

export const register: Register = on => {
  registerContract(on)
  registerPane(on)
  registerActions(on)
}
