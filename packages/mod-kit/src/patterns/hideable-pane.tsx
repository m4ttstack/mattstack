import type { EngineInterface, On, RenderElement } from 'claude-code'

import { BRAND } from '../draw/theme'

export type HideablePane = {
  id: string
  // The band's lead-in, after the mark: "mattstack <label>".
  label?: string
}

const DEFAULT_BAND_LABEL = 'mattstack waiting'

// What the pane is waiting on while it is closed, as the mod reads it from its own state.
export type Waiting = { formId: string; title: string }

// Resolves to whether the pane was drawn: an open the person did not ask for waits undrawn on a narrow terminal.
export async function showPane($: EngineInterface, pane: HideablePane, title: string): Promise<boolean> {
  const opened = await $.ui.open({ id: pane.id, title, focus: true })
  $.ui.invalidate('ui.render')
  return opened.isPlaced
}

// The mod's one ui.message hook passes each post to paneMessage: { type: 'hide' } from the pane closes it,
// { type: 'reopen', formId } from the band opens it again while `waiting` is that form.
export async function paneMessage($: EngineInterface, e: { data: unknown; requestId: string }, pane: HideablePane, waiting: Waiting | undefined): Promise<void> {
  const message = e.data as { type?: unknown; formId?: unknown } | null
  if (message?.type === 'reopen' && waiting && waiting.formId === message.formId) await showPane($, pane, waiting.title)
  if (message?.type === 'hide' && e.requestId === pane.id) await $.ui.close({ id: pane.id })
}

// The band reads the engine's pane list, which no atom write tracks, so a close redraws it.
export function registerPaneRedraw(on: On): void {
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })
}

// The AbovePrompt drawing while `waiting` holds a form whose pane is not placed; the mod's hook reads its own state to say so.
// The mod's src/band.tsx is `export { bandClient as default } from '@mattstack/mod-kit'`, listed in its mod.json clients.
// `engineShow`: Show is the engine's own Button, not the band Client's. A Client's post is code, not the person's press,
// so a pane it reopens counts as unasked and stays undrawn below 144 columns (110 once asked); the engine's press places it at any width.
export async function bandAbovePrompt($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], rest: RenderElement, waiting: Waiting, pane: HideablePane, options: { engineShow?: boolean } = {}) {
  const label = pane.label ?? DEFAULT_BAND_LABEL
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Client = 'Client' in els ? els.Client : undefined
  const show = <Button key={`open-${pane.id}`} label="Show" onPress={() => showPane($, pane, waiting.title)} />
  // A surface without Client gets the engine's own Button.
  const band = Client ? (
    options.engineShow ? (
      <Box flexDirection="row" gap={2}>
        <Client key={`band-${waiting.formId}`} module="./band.tsx" flexGrow={1} props={{ formId: waiting.formId, title: waiting.title, label, bareText: true }} />
        {show}
      </Box>
    ) : (
      <Client key={`band-${waiting.formId}`} module="./band.tsx" props={{ formId: waiting.formId, title: waiting.title, label }} />
    )
  ) : (
    <Box flexDirection="row" gap={2}>
      <Text color={BRAND.pink}>{`${BRAND.glyph} ${label} `}</Text>
      <Text wrap="truncate-end">{waiting.title}</Text>
      <Button key={`open-${pane.id}`} label="Open" onPress={() => showPane($, pane, waiting.title)} />
    </Box>
  )
  return (
    <Box flexDirection="column">
      {band}
      {rest}
    </Box>
  )
}

export async function isPlaced($: EngineInterface, pane: HideablePane): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === pane.id && p.isPlaced)
}

// The pane body's height in rows. A Client is only as tall as what it draws unless told otherwise, and a click below its
// lines misses it, so a pane's Client takes this as its `height` to take a click anywhere in the body.
export function paneRows(e: { props: { scroll?: { bodyRows?: number } }; viewport?: { rows?: number } }): number {
  return e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30
}

// The wheel's running total per pane, for a Client that draws only the rows that fit: the engine scrolls nothing it
// cannot see past, so the mod's `ui.scroll` hook (its matcher must be a literal) hands each turn here, and the Client
// takes the change in the total since it last looked. A module value, since a hook may not write state while drawing.
const wheels = new Map<string, number>()

export function addWheel($: EngineInterface, paneId: string, by: number): void {
  wheels.set(paneId, (wheels.get(paneId) ?? 0) + by)
  $.ui.invalidate('ui.render')
}

export const wheelTotal = (paneId: string): number => wheels.get(paneId) ?? 0
