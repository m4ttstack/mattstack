import type { On } from 'claude-code'

import { registerCommand, registerCommandDef } from './command'
import { registerReset, resumeCarry } from './reset'
import { registerTool, registerToolDef } from './tool'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await registerToolDef($)
    await registerCommandDef($)
    const started = await next(e)
    await resumeCarry($)
    return started
  })
  registerTool(on)
  registerCommand(on)
  registerReset(on)
}
