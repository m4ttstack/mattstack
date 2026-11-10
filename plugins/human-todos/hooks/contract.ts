import type { On } from 'claude-code'

import type { AddInput } from '../types'
import { TITLE, checkKind, describe } from './items'
import { addTodo, listTodos, removeTodos, resetList, restoreList } from './store'
import { cleanup, openPane, syncSpinner } from './wiring'

const PREFIX = 'mcp__human-todos__'

type ToolNames = { add: string; list: string; withdraw: string }

export function addDescription(paneTitle: string): string {
  return `Add a step only the user can do to their "${paneTitle}" pane, which stays beside the transcript while replies scroll away. Use it whenever you need the user to act: a command you cannot run (denied, needs sudo, a TTY, a login or a credential), a step in a browser or another app, or an account or physical action. Add the step as soon as you hit the wall, instead of only writing it in your reply, and keep working on anything else meanwhile. Pick the kind: task (by hand), run (a command the pane runs for them and reports back), terminal (needs their terminal: sudo, password or login prompts), link (a web page). You get a message when they finish, skip, stop or run it, so never ask them to type "done".`
}

export function guidance(names: ToolNames): string {
  return `# To-dos for the user
When you need the user to do something you cannot do yourself (a command that needs their terminal, sudo, an interactive login or a credential; a step in a browser or another app; a physical or account action), add it with ${names.add} instead of only writing it in your reply. Long replies scroll away; the list stays in a "${TITLE}" pane beside the transcript.
- Every item has a \`kind\`, which decides the buttons the user gets:
  - \`task\`: something they do by hand (an account setting, a physical step, a decision). Done or Skip.
  - \`run\`: a shell command that runs without a TTY. Give \`script\`; the pane offers Run and sends you the exit code and output.
  - \`terminal\`: a command that needs their terminal (sudo, a login or password prompt). Give \`script\`; the pane offers Copy.
  - \`link\`: a step on a web page. Give \`url\`; the pane offers Open.
- When the user ticks, skips or runs an item, you receive a message saying so. Do not ask them to type "done".
- Use ${names.list} to see what is still open, and ${names.withdraw} when an item is no longer needed.`
}

export function registerContract(on: On): void {
  let names: ToolNames = { add: `${PREFIX}add`, list: `${PREFIX}list`, withdraw: `${PREFIX}withdraw` }

  on('session.start', async ($, e, next) => {
    const add = await $.tool.register({
      name: 'add',
      description: addDescription(TITLE),
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['task', 'run', 'terminal', 'link'],
            description: 'task: done by hand. run: script the pane can Run (needs script). terminal: script that needs a TTY, offered as Copy (needs script). link: a web page step (needs url).',
          },
          title: { type: 'string', description: 'Short imperative, e.g. "Sign in to gcloud"' },
          detail: { type: 'string', description: 'Optional one or two lines of context' },
          script: { type: 'string', description: 'The shell command, for kind run or terminal (run uses zsh -lc)' },
          url: { type: 'string', description: 'The http(s) page, for kind link' },
          cwd: { type: 'string', description: 'For kind run: directory to run in; defaults to the session cwd' },
        },
        required: ['kind', 'title'],
      },
    })
    const list = await $.tool.register({
      name: 'list',
      description: `List the items in the user's "${TITLE}" pane with their status.`,
      isDeferred: false,
    })
    const withdraw = await $.tool.register({
      name: 'withdraw',
      description: `Remove an item from the user's "${TITLE}" pane when it is no longer needed.`,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    })
    names = { add: add.tool, list: list.tool, withdraw: withdraw.tool }
    await $.command.register({ name: 'todos', description: `Open the ${TITLE} pane` })
    await $.command.register({
      name: 'todos-runner',
      description: 'Choose where Run executes scripts: auto, herdr or local',
      argumentHint: 'auto|herdr|local',
    })

    const started = await next(e)
    await restoreList($)
    await syncSpinner($)
    return started
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      const dropped = await listTodos($)
      await resetList($)
      await cleanup($, dropped).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
    }
    return ended
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return {
      sections: [...composed.sections, { id: 'human-todos:guidance', text: guidance(names), scope: 'session' as const }],
    }
  })

  on('tool.check', { tool: 'mcp__human-todos__add' }, () => ({ decision: 'allow' as const }))
  on('tool.check', { tool: 'mcp__human-todos__list' }, () => ({ decision: 'allow' as const }))
  on('tool.check', { tool: 'mcp__human-todos__withdraw' }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: 'mcp__human-todos__add' }, async ($, e) => {
    const input = e as unknown as AddInput
    const missing = checkKind(input)
    if (missing) return { deny: missing }
    const todo = await addTodo($, input)
    await openPane($)
    return {
      result: `Added #${todo.id} to the user's ${TITLE} pane. You will get a message when they act on it; carry on with other work meanwhile.`,
    }
  })

  on('tool.call', { tool: 'mcp__human-todos__list' }, async $ => {
    return { result: describe(await listTodos($)) }
  })

  on('tool.call', { tool: 'mcp__human-todos__withdraw' }, async ($, e) => {
    const id = String((e as unknown as { id: string | number }).id).replace(/^#/, '')
    const gone = await removeTodos($, t => t.id === id)
    if (gone.length === 0) return { result: `No to-do #${id}.` }
    await cleanup($, gone)
    return { result: `Withdrew #${id}.` }
  })
}
