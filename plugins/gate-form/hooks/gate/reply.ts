import type { Form } from '../../types'

export type Outcome = { status: 'answered'; answers: Record<string, unknown> } | { status: 'chat'; draft: Record<string, unknown> }

const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``

export function agentReply(form: Form, outcome: Outcome): string {
  if (outcome.status === 'answered') return `[gate-form] The user answered form ${form.id} ("${form.title}"):\n${json(outcome.answers)}`
  return `[gate-form] The user wants to chat about form ${form.id} ("${form.title}") before answering. The form is closed; any gate it stands for stays open. Talk it through with them, then ask again. What they had answered so far:\n${json(outcome.draft)}`
}

export function toastReply(outcome: Outcome): string {
  return outcome.status === 'answered' ? `Answers: ${JSON.stringify(outcome.answers)}` : `Chat instead; draft: ${JSON.stringify(outcome.draft)}`
}
