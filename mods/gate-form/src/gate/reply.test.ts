import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { agentReply } from './reply'

const form = { id: 'f1', title: 'Next steps', questions: [{}, {}, {}] } as unknown as Form

test('answers reach the agent as one line under the form’s title', () => {
  expect(agentReply(form, { status: 'answered', answers: { scope: 'all', picks: ['a', 'b'] } })).toBe(
    '[gate-form] The user answered "Next steps" (form f1, 2 of 3 questions):\n```json\n{"scope":"all","picks":["a","b"]}\n```',
  )
})

test('a form set aside names what was answered only when something was', () => {
  const empty = agentReply(form, { status: 'chat', draft: {} })
  expect(empty).toContain('The user set "Next steps" aside to chat about it first. Form f1 is closed')
  expect(empty).not.toContain('\n')
  expect(agentReply(form, { status: 'chat', draft: { scope: 'all' } })).toBe(`${empty} Answered so far:\n\`\`\`json\n{"scope":"all"}\n\`\`\``)
})
