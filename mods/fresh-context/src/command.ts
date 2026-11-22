import type { EngineInterface, On } from 'claude-code'

import type { Mode } from './carry'
import { TOOL } from './tool'

export async function registerCommandDef($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'fresh', description: 'Write your ledger, then start fresh (clear by default)', argumentHint: '[clear|compact] [note]' })
}

export function freshPrompt(mode: Mode, note: string): string {
  const then = note ? `and then ${JSON.stringify(note)}.` : 'and no then.'
  return `Write your ledger now: the one your current skill keeps, or if none does, these sections: Goal, Where, Done, In progress, Next step, Decisions, Learned, Waiting on the user. Then call ${TOOL} with mode "${mode}", the ledger, ${then}`
}

function parse(args: string): { mode: Mode; note: string } {
  const [first = '', ...rest] = args.trim().split(/\s+/)
  const word = first.toLowerCase()
  if (word === 'clear' || word === 'compact') return { mode: word, note: rest.join(' ') }
  return { mode: 'clear', note: args.trim() }
}

export function registerCommand(on: On): void {
  on('command.run', { command: 'fresh' }, async ($, e) => {
    const { mode, note } = parse(e.args ?? '')
    // A prompt submitted inside command.run would wait on the turn this hook holds.
    $.clock.after(0, () => {
      void $.prompt.submit({ text: freshPrompt(mode, note) })
    })
    return { text: `Asked the session to write its ledger and reset (${mode}).` }
  })
}
