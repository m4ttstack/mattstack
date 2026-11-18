import type { Register } from 'claude-code'

import { register as enterWorktreeCheck } from './enter-worktree-check.ts'
import { register as loadSkill } from './load-skill.ts'
import { register as slackDeliveryRow } from './slack-delivery-row.tsx'
import { register as slackSupport } from './slack-support.ts'
import { register as worktreeLeave } from './worktree-leave.ts'

// Claude Code loads one hooks module per plugin, so every mod joins here.
export const register: Register = (on, options) => {
  enterWorktreeCheck(on, options)
  loadSkill(on, options)
  slackSupport(on, options)
  slackDeliveryRow(on, options)
  worktreeLeave(on, options)
}
