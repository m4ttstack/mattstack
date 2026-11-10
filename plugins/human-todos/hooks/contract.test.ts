import { expect, test } from 'claude-code/testing'

import { addDescription } from './contract'
import { startSession, world } from './test-world'

const ADD = 'mcp__human-todos__add'
const LIST = 'mcp__human-todos__list'
const WITHDRAW = 'mcp__human-todos__withdraw'

test('session.start registers three tools that are not deferred', async ($, on) => {
  const { registered } = world(on)
  await startSession($)

  expect(registered.map(t => t.name)).toEqual(['add', 'list', 'withdraw'])
  expect(registered.every(t => t.isDeferred === false)).toBe(true)
  const add = registered[0]!.inputSchema as { required: string[]; properties: { kind: { enum: string[] } } }
  expect(add.required).toEqual(['kind', 'title'])
  expect(add.properties.kind.enum).toEqual(['task', 'run', 'terminal', 'link'])
})

test('add refuses a kind missing its field and adds nothing', async ($, on) => {
  world(on)
  await startSession($)

  const refused = await $.tool.call({ tool: ADD, kind: 'run', title: 'x' })
  expect(refused).toMatchObject({ deny: 'kind run needs a script.' })
  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
})

test('add, list and withdraw work the list', async ($, on) => {
  world(on)
  await startSession($)

  const added = await $.tool.call({ tool: ADD, kind: 'run', title: 'Sign in', script: 'gcloud auth login' })
  expect(added.result).toMatch(/^Added #1 /)

  const listed = await $.tool.call({ tool: LIST })
  expect(listed.result).toBe('#1 [open] Sign in\n    script: gcloud auth login')

  const withdrawn = await $.tool.call({ tool: WITHDRAW, id: '1' })
  expect(withdrawn.result).toBe('Withdrew #1.')
  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')

  expect((await $.tool.call({ tool: WITHDRAW, id: '9' })).result).toBe('No to-do #9.')
})

test('the three tools are allowed without a prompt; other tools pass through', async ($, on) => {
  world(on)
  on('tool.check', () => ({ decision: 'ask' }))
  await startSession($)

  for (const tool of [ADD, LIST, WITHDRAW]) {
    expect(await $.tool.check({ tool, input: {} })).toMatchObject({ decision: 'allow' })
  }
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).toMatchObject({ decision: 'ask' })
})

test('the system prompt gains one guidance section naming the registered add tool', async ($, on) => {
  world(on, { prefix: 'mcp__x__' })
  await startSession($)

  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const mine = sections.filter(s => s.id === 'human-todos:guidance')
  expect(mine).toHaveLength(1)
  expect(mine[0]?.scope).toBe('session')
  expect(mine[0]?.text).toContain('mcp__x__add')
  expect(mine[0]?.text).toContain('mcp__x__withdraw')
})

test('the add description names every kind and forbids asking for "done"', () => {
  const text = addDescription('Human Todos')
  for (const kind of ['task', 'run', 'terminal', 'link']) expect(text).toContain(kind)
  expect(text).toContain('never ask them to type "done"')
})
