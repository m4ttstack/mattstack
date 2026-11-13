import type { Form } from '../../types'

export type Outcome = { status: 'answered'; answers: Record<string, unknown> } | { status: 'chat'; draft: Record<string, unknown> }

export const REPLY_TAG = '[gate-form] '

const json = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``

export function agentReply(form: Form, outcome: Outcome): string {
  const total = form.questions.length
  if (outcome.status === 'answered') {
    const count = Object.keys(outcome.answers).length
    return [
      `${REPLY_TAG}The user answered "${form.title}" (${count} of ${total} questions).`,
      `Form ${form.id}. Answers by question id; an unanswered question is left out:`,
      json(outcome.answers),
    ].join('\n')
  }
  return [
    `${REPLY_TAG}The user set "${form.title}" aside to chat about it first.`,
    `Form ${form.id} is closed; any gate it stands for stays open. Talk it through with them, then ask again. What they had answered so far:`,
    json(outcome.draft),
  ].join('\n')
}

// The demo's reply: what happened in words, since nobody reads the answers but the person who gave them.
export function toastReply(form: Form, outcome: Outcome): string {
  if (outcome.status === 'chat') return `Set "${form.title}" aside to chat about it`
  return `Submitted "${form.title}": ${Object.keys(outcome.answers).length} of ${form.questions.length} questions answered`
}
