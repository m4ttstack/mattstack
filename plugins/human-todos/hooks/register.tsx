import type { Register } from 'claude-code'

import { registerContract } from './contract'
import { registerPane } from './pane'

export const register: Register = on => {
  registerContract(on)
  registerPane(on)
}
