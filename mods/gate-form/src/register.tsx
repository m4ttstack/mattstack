import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { BRAND } from '@mattstack/mod-kit'

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

type FormMessage =
  | { type: 'engaged'; formId: string }
  | { type: 'minimize'; formId: string }
  | { type: 'reopen'; formId: string }
  | { type: 'answer'; formId: string; answers?: Record<string, unknown> }
  | { type: 'chat'; formId: string; draft?: Record<string, unknown> }

async function setKeysInForm($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

async function show($: EngineInterface, form: Form): Promise<void> {
  await update($, formAtom, () => form)
  await $.ui.open({ id: PANE, title: form.title, focus: true })
  $.ui.invalidate('ui.render')
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
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'gate-form-demo', description: 'Open the gate form with a demo gate' })
    return next(e)
  })

  on('command.run', { command: 'gate-form-demo' }, async $ => {
    const form = toForm(DEMO.title, DEMO.context, DEMO.questions, 'toast')
    if (typeof form === 'string') return { text: form }
    await show($, form)
    return { text: 'Demo gate form opened.' }
  })

  on('tool.call', { tool: 'mcp__gate-form__ask' }, async ($, e) => {
    const args = e as unknown as { title?: unknown; context?: unknown; questions?: unknown }
    const form = toForm(args.title, args.context, args.questions, 'agent')
    if (typeof form === 'string') return { deny: form }
    await show($, form)
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`,
    }
  })

  on('ui.message', async ($, e, next) => {
    const message = e.data as FormMessage
    // The band's Open, from the Client drawn above the prompt.
    if (message.type === 'reopen') {
      const form = await read($, formAtom)
      if (form && form.id === message.formId && form.status === 'open') await show($, form)
      return next(e)
    }
    if (e.requestId !== PANE) return next(e)
    if (message.type === 'engaged') await setKeysInForm($, true)
    if (message.type === 'minimize') await $.ui.close({ id: PANE })
    if (message.type === 'answer') await settle($, message.formId, { status: 'answered', answers: message.answers ?? {} })
    if (message.type === 'chat') await settle($, message.formId, { status: 'chat', draft: message.draft ?? {} })
    return next(e)
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

  // The answers reach the agent in full; the transcript row shows one summary line, the answers themselves stay in the pane.
  // The row's text is rewritten, as UserMessage's contract allows (the stored message is untouched), rather than redrawn;
  // isExpanded can't gate it, since a short plugin message under its speaker label is drawn expanded too.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const origin = e.props.origin as { kind: string; name?: string }
    if (origin.kind !== 'plugin' || origin.name !== 'gate-form') return next(e)
    return next({ ...e, props: { ...e.props, text: `${BRAND.glyph} mattstack gate  ${summaryOf(e.props.text)}` } })
  })

  // The band reads the engine's pane list, which no atom write tracks, so a close redraws it.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  // A form closed before it was answered waits above the prompt, with a way back to it. Other plugins' bands draw under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const form = await read($, formAtom)
    if (!form || form.status !== 'open' || (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Client = 'Client' in els ? els.Client : undefined
    const rest = await next(e)
    // A surface without Client gets the engine's own Button.
    const band = Client ? (
      <Client key={`band-${form.id}`} module="./band.tsx" props={{ formId: form.id, title: form.title }} />
    ) : (
      <Box flexDirection="row" gap={2}>
        <Text color={BRAND.pink}>{`${BRAND.glyph} mattstack gate waiting `}</Text>
        <Text wrap="truncate-end">{form.title}</Text>
        <Button key="open-gate-form" label="Open" onPress={() => show($, form)} />
      </Box>
    )
    return (
      <Box flexDirection="column">
        {band}
        {rest}
      </Box>
    )
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
