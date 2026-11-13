import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { bandAbovePrompt, isEngaged, isPlaced, paneMessage, registerPaneRedraw, registerTranscriptSummary, showPane, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { Form } from '../types'
import { DEMO } from './gate/demo'
import { toForm } from './gate/parse'
import { agentReply, summaryOf, toastReply, type Outcome } from './gate/reply'
import { INPUT_SCHEMA, TOOL_DESCRIPTION } from './gate/schema'

const PANE = 'gate-form'
const TOOL = 'ask'

const formAtom = atom({ plugin: 'gate-form', key: 'form' } as const, null as Form | null, { shape: 'form-3' })
// The engine reports the pane's focus but not its Client's, so a click or key in the form sets this and typing in the prompt clears it.
const keysAtom = atom({ plugin: 'gate-form', key: 'keysInForm' } as const, false)

type FormMessage = { type: 'answer'; formId: string; answers?: Record<string, unknown> } | { type: 'chat'; formId: string; draft?: Record<string, unknown> }

// A form closed before it was answered waits above the prompt, with a way back to it.
async function waitingForm($: EngineInterface): Promise<Waiting | undefined> {
  const form = await read($, formAtom)
  return form && form.status === 'open' ? { formId: form.id, title: form.title } : undefined
}

const GATE_PANE: HideablePane = { id: PANE, label: 'mattstack gate waiting' }

async function setKeysInForm($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

// Answers reach the agent as its next input: a tool call can't wait for a person past its 10s budget.
async function settle($: EngineInterface, formId: string, outcome: Outcome): Promise<void> {
  const form = await read($, formAtom)
  if (!form || form.id !== formId || form.status !== 'open') return
  const status: Form['status'] = outcome.status === 'answered' ? 'answered' : 'cancelled'
  await update($, formAtom, f => (f && f.id === formId ? { ...f, status } : f))
  if (form.replyTo === 'toast') return $.ui.toast(toastReply(form, outcome))
  const warn = () => $.ui.toast(`Could not send the answers for ${formId} to Claude`)
  void $.prompt
    .submit({ text: agentReply(form, outcome) })
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
}

// A function declaration, not a const arrow: a bundler keeps it one, and the engine's source check requires it.
export function register(on: On): void {
  registerPaneRedraw(on)
  registerTranscriptSummary(on, { plugin: 'gate-form', label: 'mattstack gate', summary: summaryOf })

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'gate-form-demo', description: 'Open the gate form with a demo gate' })
    return next(e)
  })

  on('command.run', { command: 'gate-form-demo' }, async $ => {
    const form = toForm(DEMO.title, DEMO.context, DEMO.questions, 'toast')
    if (typeof form === 'string') return { text: form }
    await update($, formAtom, () => form)
    await showPane($, GATE_PANE, form.title)
    return { text: 'Demo gate form opened.' }
  })

  on('tool.call', { tool: 'mcp__gate-form__ask' }, async ($, e) => {
    const args = e as unknown as { title?: unknown; context?: unknown; questions?: unknown }
    const form = toForm(args.title, args.context, args.questions, 'agent')
    if (typeof form === 'string') return { deny: form }
    await update($, formAtom, () => form)
    await showPane($, GATE_PANE, form.title)
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`,
    }
  })

  on('prompt.edit', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })
  on('ui.focus', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (isEngaged(e)) await setKeysInForm($, true)
    await paneMessage($, e, GATE_PANE, await waitingForm($))
    if (e.requestId !== PANE) return next(e)
    const message = e.data as FormMessage
    if (message.type === 'answer') await settle($, message.formId, { status: 'answered', answers: message.answers ?? {} })
    if (message.type === 'chat') await settle($, message.formId, { status: 'chat', draft: message.draft ?? {} })
    return next(e)
  })

  // Other plugins' bands draw under this one.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const waiting = await waitingForm($)
    if (!waiting || (await isPlaced($, GATE_PANE))) return next(e)
    return bandAbovePrompt($, e, await next(e), waiting, GATE_PANE)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Client = 'Client' in els ? els.Client : undefined
    const form = await read($, formAtom)
    if (!form) return <Text dimColor>No questions right now.</Text>
    if (!Client) return <Text dimColor>This screen can't draw the form yet. Answer in the terminal.</Text>
    const rows = Math.max(8, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30) - 3)
    const focused = e.props.isFocused || (await read($, keysAtom))
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client key={`form-${form.id}`} module="./form.tsx" props={{ form, rows, cols: (e.props.bodyColumns ?? 60) - 2, focused }} />
        {form.status === 'open' ? null : (
          <Box flexDirection="row" gap={1}>
            <Button key="close" role="dismiss" label="Close" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
        )}
      </Box>
    )
  })
}
