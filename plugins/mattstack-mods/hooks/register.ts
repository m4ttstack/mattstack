import type { Register } from 'claude-code'
import { attachHub, createHub } from '../src/core/hub.ts'

export const register: Register = on => {
  attachHub(on, createHub())
}
