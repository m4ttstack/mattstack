import { expect, test } from 'claude-code/testing'

const MESSAGE = (text: string, name = 'gate-form', isExpanded = false) =>
  ({
    plugin: 'gate-form',
    component: 'UserMessage',
    props: { text, origin: { kind: 'plugin', name }, isExpanded },
  }) as const

const ANSWERED = '[gate-form] The user answered "Write-in test" (3 of 3 questions).\nForm f1. Answers by question id; an unanswered question is left out:\n```json\n{"approach": "identity"}\n```'

for (const surface of ['terminal', 'desktop'] as const) {
  // The mod rewrites the row's text and leaves the drawing to the engine, so a hook beneath it reads what the row will show.
  test(`the answer row shows one summary line, never the answers (${surface})`, async ($, on) => {
    const shown: string[] = []
    on('ui.render', { component: 'UserMessage' }, async (_, e, next) => {
      shown.push(e.props.text)
      return next(e)
    })
    for (const isExpanded of [false, true]) {
      const row = await $.ui.mount({ ...MESSAGE(ANSWERED, 'gate-form', isExpanded), surface })
      await row.unmount()
    }
    expect(shown.length).toBe(2)
    for (const text of shown) {
      expect(text).toContain('mattstack gate  Answered "Write-in test" (3 of 3 questions).')
      expect(text).not.toContain('identity')
    }
  })

  test(`another plugin's row is left alone (${surface})`, async ($, on) => {
    const shown: string[] = []
    on('ui.render', { component: 'UserMessage' }, async (_, e, next) => {
      shown.push(e.props.text)
      return next(e)
    })
    const row = await $.ui.mount({ ...MESSAGE(ANSWERED, 'other'), surface })
    await row.unmount()
    expect(shown).toEqual([ANSWERED])
  })
}
