import type { EngineInterface, On, RenderElement } from 'claude-code'

import { BRAND } from '../draw/theme'
import { DEFAULT_BAND_LABEL } from './band-client'

export type HideablePane = {
  id: string
  // The band's lead-in, after the mark: "mattstack <label>".
  label?: string
}

// What the pane is waiting on while it is closed, as the mod reads it from its own state.
export type Waiting = { formId: string; title: string }

export async function showPane($: EngineInterface, pane: HideablePane, title: string): Promise<void> {
  await $.ui.open({ id: pane.id, title, focus: true })
  $.ui.invalidate('ui.render')
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
export async function bandAbovePrompt($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], rest: RenderElement, waiting: Waiting, pane: HideablePane) {
  const label = pane.label ?? DEFAULT_BAND_LABEL
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Client = 'Client' in els ? els.Client : undefined
  // A surface without Client gets the engine's own Button.
  const band = Client ? (
    <Client key={`band-${waiting.formId}`} module="./band.tsx" props={{ formId: waiting.formId, title: waiting.title, label }} />
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
