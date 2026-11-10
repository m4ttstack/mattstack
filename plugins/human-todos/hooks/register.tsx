import type { Register } from 'claude-code'

import { registerContract } from './contract'

export const register: Register = on => {
  registerContract(on)
}
