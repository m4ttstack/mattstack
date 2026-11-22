import type { On } from 'claude-code'

import { registerReset, resumeCarry } from './reset'
import { registerTool, registerToolDef } from './tool'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerToolDef($)
    const started = await next(e)
    await resumeCarry($)
    return started
  })
  registerTool(on)
  registerReset(on)
}
