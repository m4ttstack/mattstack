import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderSurface, ToolCallInput, ToolCallResult } from 'claude-code'
import { bandAbovePrompt, isEngaged, isPlaced, paneMessage, registerPaneRedraw, showPane, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { Form, LegacyForm } from '../types'
import { DEMO } from './gate/demo'
import { addForm, currentForm, fitForm, fromLegacy, openCount, patchForm } from './gate/forms'
import { agentFields, formFromRow, gateForm, readKitResult, spilledGate, toForm } from './gate/parse'
import { GATE_ANSWERED, GATE_ASIDE, GATE_INSTRUCTION, agentReply, toastReply, type Outcome } from './gate/reply'
import { rtError, runRt } from './gate/rt'
import { INPUT_SCHEMA, TOOL_DESCRIPTION } from './gate/schema'

const PANE = 'gate-form'
const TOOL = 'ask'
const GATE_TITLE = 'Decision gate'
// Under the engine's 100,000-character cap on a Client's props, with room for the props beside the form.
const FORM_BUDGET = 95_000

const formsAtom = atom({ plugin: 'gate-form', key: 'forms' } as const, [] as Form[], { shape: 'forms-1' })
// The one form the form-3 code kept, read once into the list.
const legacyAtom = atom({ plugin: 'gate-form', key: 'form' } as const, null as LegacyForm | null, { shape: 'form-3' })
// The engine reports the pane's focus but not its Client's, so a click or key in the form sets this and typing in the prompt clears it.
const keysAtom = atom({ plugin: 'gate-form', key: 'keysInForm' } as const, false)
// tool.call carries no surface, so the band, which draws every frame, records the one this session draws on.
// A render hook may not write state, so this lives in the module; a reload forgets it until the next frame.
const drawn: { surface?: RenderSurface } = {}

type FormMessage = { type: 'answer'; formId: string; answers?: Record<string, unknown> } | { type: 'chat'; formId: string; draft?: Record<string, unknown> }
type Next = (e: ToolCallInput) => Promise<ToolCallResult>

const GATE_PANE: HideablePane = { id: PANE, label: 'mattstack gate waiting' }

async function readForms($: EngineInterface): Promise<Form[]> {
  const forms = await read($, formsAtom)
  return forms.length > 0 ? forms : fromLegacy(await read($, legacyAtom))
}

async function writeForms($: EngineInterface, change: (list: Form[]) => Form[]): Promise<Form[]> {
  const legacy = fromLegacy(await read($, legacyAtom))
  let written: Form[] = []
  await update($, formsAtom, list => (written = change(list.length > 0 || legacy.length === 0 ? list : legacy)))
  if (legacy.length > 0) await update($, legacyAtom, () => null)
  return written
}

// A form closed before it was answered waits above the prompt, with a way back to it.
async function waitingForm($: EngineInterface): Promise<Waiting | undefined> {
  const forms = await readForms($)
  const form = currentForm(forms)
  if (!form || form.status !== 'open') return undefined
  const more = openCount(forms) - 1
  return { formId: form.id, title: more > 0 ? `${form.title}, ${more} more waiting` : form.title }
}

async function setKeysInForm($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

async function wake($: EngineInterface, text: string, what: string): Promise<void> {
  const warn = () => $.ui.toast(`Could not tell Claude about ${what}`)
  void $.prompt
    .submit({ text })
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
}

// The pane moves on to the next open form, if any.
async function showCurrent($: EngineInterface, forms: Form[]): Promise<void> {
  const next = currentForm(forms)
  if (next?.status === 'open') await showPane($, GATE_PANE, next.title)
  else $.ui.invalidate('ui.render')
}

// The pane's own answer: no doorbell rings for it, so the mod wakes the agent once rt has recorded it.
async function answerGate($: EngineInterface, form: Form, answers: Record<string, unknown>): Promise<void> {
  const gateId = form.gateId ?? ''
  const args = ['gate', 'answer', gateId, '--answers', JSON.stringify(answers), '--by', 'pane', '--session', await $.session.id()]
  let error: string | undefined
  try {
    const ran = await runRt($, args)
    if (ran.exitCode !== 0) error = rtError(ran)
    else if ((JSON.parse(ran.stdout) as { conflict?: unknown }).conflict === true) error = `gate ${gateId} was already answered`
  } catch (failure) {
    error = `rt could not run: ${failure instanceof Error ? failure.message : String(failure)}`
  }
  if (error !== undefined) {
    await writeForms($, list => patchForm(list, form.id, { error, attempt: (form.attempt ?? 0) + 1 }))
    return
  }
  const forms = await writeForms($, list => patchForm(list, form.id, { status: 'answered', error: undefined }))
  await wake($, GATE_ANSWERED(gateId), `the answer to gate ${gateId}`)
  await showCurrent($, forms)
}

// A gate set aside stays open: the person comes back to it from the band.
async function setGateAside($: EngineInterface, form: Form): Promise<void> {
  await wake($, GATE_ASIDE(form.gateId ?? ''), `setting gate ${form.gateId} aside`)
  await $.ui.close({ id: PANE })
}

// Answers reach the agent as its next input: a tool call can't wait for a person past its 10s budget.
async function settle($: EngineInterface, formId: string, outcome: Outcome): Promise<void> {
  const form = (await readForms($)).find(f => f.id === formId)
  if (!form || form.status !== 'open') return
  if (form.source === 'gate') {
    if (outcome.status === 'answered') return answerGate($, form, outcome.answers)
    return setGateAside($, form)
  }
  const status: Form['status'] = outcome.status === 'answered' ? 'answered' : 'cancelled'
  await writeForms($, list => patchForm(list, formId, { status }))
  if (form.source === 'demo') return $.ui.toast(toastReply(form, outcome))
  await wake($, agentReply(form, outcome), `the answers for ${formId}`)
}

async function openForm($: EngineInterface, form: Form, supersededId?: string | null): Promise<void> {
  await writeForms($, list => addForm(list, form, supersededId))
  const shown = currentForm(await readForms($))
  await showPane($, GATE_PANE, shown?.title ?? form.title)
}

// Only a main-loop call on a surface that draws the form takes it; a hand-back opens nothing to draw.
function canDraw(e: ToolCallInput): boolean {
  const surface = drawn.surface
  const args = e as unknown as { handBack?: unknown }
  return e.agentId === undefined && args.handBack !== true && (surface === 'terminal' || surface === 'desktop')
}

const textOf = (out: ToolCallResult): string => {
  if (typeof out.text === 'string') return out.text
  const result: unknown = out.result
  if (typeof result === 'string') return result
  const blocks = Array.isArray(result) ? result : ((result as { content?: unknown } | null)?.content ?? [])
  return (Array.isArray(blocks) ? blocks : []).map(b => (typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('')
}

// The tool's own shape, its text replaced.
function withText(result: unknown, text: string): unknown {
  if (Array.isArray(result)) return [{ type: 'text', text }]
  if (result && typeof result === 'object' && 'content' in result) return { ...(result as object), content: [{ type: 'text', text }], structuredContent: undefined }
  return text
}

async function takeGate($: EngineInterface, e: ToolCallInput, next: Next): Promise<ToolCallResult> {
  if (!canDraw(e)) return next(e)
  const out = await next({ ...e, kitForm: true } as ToolCallInput)
  if (out.deny !== undefined || out.isError) return out
  const text = textOf(out)
  const kit = readKitResult(text)
  if (kit.kind === 'other') return out
  const kind = (e as unknown as { kind?: unknown }).kind
  const title = typeof kind === 'string' && kind.trim() !== '' ? kind : GATE_TITLE
  if (kit.kind === 'kit') {
    const form = gateForm(kit.fields, title)
    if (typeof form === 'string') return out
    await openForm($, form, kit.fields.supersededId as string | null | undefined)
    return { result: withText(out.result, JSON.stringify(agentFields(kit.fields))) as never }
  }
  return takeSpilled($, out, text)
}

async function takeSpilled($: EngineInterface, out: ToolCallResult, text: string): Promise<ToolCallResult> {
  const known = (await readForms($)).flatMap(f => (f.gateId ? [f.gateId] : []))
  let row
  try {
    const ran = await runRt($, ['gate', 'list', '--open', '--json'])
    row = ran.exitCode === 0 ? spilledGate(ran.stdout, await $.session.id(), known) : undefined
  } catch {
    row = undefined
  }
  const form = row && formFromRow(row)
  if (!row || !form || typeof form === 'string') return out
  await openForm($, form)
  return { result: withText(out.result, `${text}\n\n${GATE_INSTRUCTION(row.id)}`) as never }
}

// A function declaration, not a const arrow: a bundler keeps it one, and the engine's source check requires it.
export function register(on: On): void {
  registerPaneRedraw(on)

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'gate-form-demo', description: 'Open the gate form with a demo gate' })
    return next(e)
  })

  on('command.run', { command: 'gate-form-demo' }, async $ => {
    const form = toForm(DEMO.title, DEMO.context, DEMO.questions, 'demo')
    if (typeof form === 'string') return { text: form }
    await openForm($, form)
    return { text: 'Demo gate form opened.' }
  })

  on('tool.call', { tool: 'mcp__gate-form__ask' }, async ($, e) => {
    const args = e as unknown as { title?: unknown; context?: unknown; questions?: unknown }
    const form = toForm(args.title, args.context, args.questions, 'ask')
    if (typeof form === 'string') return { deny: form }
    await openForm($, form)
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`,
    }
  })

  // A failed takeover leaves the call as the tool answered it: `next` replays a settled call rather than opening a second gate.
  on('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__gate_ask' }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__gate_open' }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e))

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
    drawn.surface = e.surface
    if (e.props.hasSurvey) return next(e)
    const waiting = await waitingForm($)
    if (!waiting || (await isPlaced($, GATE_PANE))) return next(e)
    return bandAbovePrompt($, e, await next(e), waiting, GATE_PANE)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Client = 'Client' in els ? els.Client : undefined
    const form = currentForm(await readForms($))
    if (!form) return <Text dimColor>No questions right now.</Text>
    if (!Client) return <Text dimColor>This screen can't draw the form yet. Answer in the terminal.</Text>
    const rows = Math.max(8, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30) - 3)
    const focused = e.props.isFocused || (await read($, keysAtom))
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client key={`form-${form.id}`} module="./form.tsx" props={{ form: fitForm(form, FORM_BUDGET), rows, cols: (e.props.bodyColumns ?? 60) - 2, focused }} />
        {form.status === 'open' ? null : (
          <Box flexDirection="row" gap={1}>
            <Button key="close" role="dismiss" label="Close" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
        )}
      </Box>
    )
  })
}
