import type { Register } from 'claude-code'

import { register as enterWorktreeCheck } from './enter-worktree-check.ts'
import { register as slackDeliveryRow } from './slack-delivery-row.tsx'
import { register as slackSupport } from './slack-support.ts'

// Claude Code loads one hooks module per plugin, so every mod joins here.
export const register: Register = (on, options) => {
  enterWorktreeCheck(on, options)
  slackSupport(on, options)
  slackDeliveryRow(on, options)
}
