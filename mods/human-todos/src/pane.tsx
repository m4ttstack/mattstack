import type { EngineInterface, On } from 'claude-code'

import { PLUGIN, TITLE } from './items'
import { drawPlainPane, paneColumns } from './pane/plain-view'
import { bandModel, paneModel } from './pane/model'
import { peekTodos, readPane } from './store'

// A literal on purpose: the engine's matcher scan reads a string literal, not the imported PLUGIN.
const PANE = 'human-todos'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
  $.ui.invalidate('ui.render')
}

export function registerPane(on: On): void {
  // The band reads the engine's pane list, which no atom write tracks, so a close redraws it.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('command.run', { command: 'todos' }, async $ => {
    await openPane($)
    return { text: `${TITLE} pane opened.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)) return next(e)
    const band = bandModel(await peekTodos($))
    if (!band) return next(e)
    const { waiting } = band
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2}>
        <Text color="warning">{`○ ${waiting} ${waiting === 1 ? TITLE.replace(/s$/, '') : TITLE}`}</Text>
        <Button key="open-pane" label="Open" onPress={() => openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'plugin' } } }, async ($, e, next) => {
    const origin = e.props.origin as { kind: string; name?: string }
    if (e.props.isExpanded || origin.name !== PLUGIN) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const [first, ...rest] = e.props.text.split('\n')
    const extra = rest.filter(line => line.trim() !== '' && !line.startsWith('```')).length
    const summary = (first ?? '').replace(`[${TITLE}] `, '')
    return (
      <Box flexDirection="row">
        <Text color="suggestion">{`${TITLE} `}</Text>
        <Text dimColor wrap="truncate-end">
          {summary}
          {extra > 0 ? `  (+${extra} ${extra === 1 ? 'line' : 'lines'}, ctrl+o)` : ''}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { list, openIds, spin: frameNo } = await readPane($)
    const inner = Math.max(22, paneColumns(e) - 4)
    const model = paneModel({ list, expanded: openIds, spin: SPIN[frameNo % SPIN.length] ?? '', width: inner - 2 })
    return drawPlainPane($, e, model, e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY })
  })
}
