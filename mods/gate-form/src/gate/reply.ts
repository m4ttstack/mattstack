import type { Form } from '../../types'

export type Outcome = { status: 'answered'; answers: Record<string, unknown> } | { status: 'chat'; draft: Record<string, unknown> }

export const REPLY_TAG = '[gate-form] '

// On one line: the terminal draws this message whole, since it does not run a mod's render hooks on a prompt that mod sent.
const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

export function agentReply(form: Form, outcome: Outcome): string {
  if (outcome.status === 'answered') {
    const count = Object.keys(outcome.answers).length
    return [`${REPLY_TAG}The user answered "${form.title}" (form ${form.id}, ${count} of ${form.questions.length} questions):`, json(outcome.answers)].join('\n')
  }
  const aside = `${REPLY_TAG}The user set "${form.title}" aside to chat about it first. Form ${form.id} is closed; any gate it stands for stays open. Talk it through with them, then ask again.`
  return Object.keys(outcome.draft).length === 0 ? aside : [`${aside} Answered so far:`, json(outcome.draft)].join('\n')
}

// The agent's result for a gate the kit form took over; the compiled gate-protocol skill reads the answer as its next input.
export const GATE_INSTRUCTION = (gateId: string) =>
  `The gate is open in the kit form. Open any boards first (per \`boards_to_open\`), then end your turn holding at gate \`${gateId}\`. The answer arrives as your next input.`

export const RELAY_INSTRUCTION = (gateId: string) =>
  `Gate \`${gateId}\` is queued in your kit form. Present any other open gates, then end your turn. The answer is recorded as the shepherd's and wakes its worker; don't wait on it or reconcile it.`

export const BOARD_INSTRUCTION = (gateId: string) =>
  `The kit form can't draw this gate, so it waits on the board. Run \`rt gate wait ${gateId}\` as a background Bash task, then end your turn holding at gate \`${gateId}\`.`

// The toast for a gate the form can't draw; the band above the prompt links to it on the board.
export const BOARD_TOAST = (title: string, reason: string) => `${title} can't show in the form: ${reason} Answer it on the board.`

export const GATE_ANSWERED =(gateId: string) => `Gate ${gateId} was answered in the kit form. Call gate_reconcile for it.`

export const GATE_ASIDE = (gateId: string) => `The user set gate ${gateId} aside to talk about it first. Don't present it again; it stays open in the kit form.`
