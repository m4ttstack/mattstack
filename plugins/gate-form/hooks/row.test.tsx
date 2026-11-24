import { expect, test } from 'claude-code/testing'

import { ASK, OPEN, QUESTIONS, drawOn, world } from './world'

const FORM_ASK = 'mcp__gate-form__ask'
const CONTEXT = `**Draft**\n\n${'every word of the draft. '.repeat(80)}`

const row = (tool: string, input: unknown, over: Record<string, unknown> = {}) =>
  ({
    plugin: 'gate-form',
    component: 'ToolUse',
    requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, isExpanded: false, ...over },
  }) as const

// What reaches the engine's own row beneath the plugin.
function rows(on: Parameters<typeof world>[0]) {
  const seen: unknown[] = []
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    seen.push(e.props.input)
    return next(e)
  })
  return seen
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const tool of [FORM_ASK, ASK, OPEN]) {
    test(`the ${tool} row leaves out the questions and the context on ${surface}`, async ($, on) => {
      const seen = rows(on)
      world(on)
      await drawOn($, surface)
      const ui = await $.ui.mount({ ...row(tool, { title: 'Next steps', context: CONTEXT, questions: QUESTIONS }), surface } as never)
      expect(seen.at(-1)).toEqual({ title: 'Next steps', questions: 2 })
      await ui.unmount()
    })
  }
}

test('ctrl+o shows the whole call', async ($, on) => {
  const seen = rows(on)
  world(on)
  await drawOn($, 'terminal')
  const input = { title: 'Next steps', context: CONTEXT, questions: QUESTIONS }
  const ui = await $.ui.mount({ ...row(FORM_ASK, input, { isExpanded: true }), surface: 'terminal' } as never)
  expect(seen.at(-1)).toEqual(input)
  await ui.unmount()
})

test('with rt.gates.kitForm off, a gate row is untouched', async ($, on) => {
  const seen = rows(on)
  world(on, { setting: 'off' })
  await drawOn($, 'terminal')
  const input = { kind: 'plan', context: CONTEXT, questions: QUESTIONS }
  const ui = await $.ui.mount({ ...row(ASK, input), surface: 'terminal' } as never)
  expect(seen.at(-1)).toEqual(input)
  await ui.unmount()
})

test('a gate row on a surface the form does not draw on is untouched', async ($, on) => {
  const seen = rows(on)
  world(on)
  await drawOn($, 'vscode')
  const input = { kind: 'plan', context: CONTEXT, questions: QUESTIONS }
  const ui = await $.ui.mount({ ...row(ASK, input), surface: 'vscode' } as never)
  expect(seen.at(-1)).toEqual(input)
  await ui.unmount()
})
