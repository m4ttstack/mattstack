import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { TITLE } from '../items'
import { act } from './act'
import { endRows, messageOf } from './model'
import type { PaneButton, PaneModel, PaneRow, Tone } from './model'

// pad-top, the header and pad-header sit above the model's rows.
const HEADER_ROWS = 3
// The engine's Button has one emphasis, so the plain drawer marks these as today, whatever quiet tone the kit drawer gives them.
const PRIMARY = new Set<string>(['run', 'open', 'confirm', 'show'])

const TEXT_PROPS: Record<Tone, Record<string, unknown>> = {
  title: { bold: true },
  dim: { dimColor: true },
  warning: { color: 'warning' },
  script: { color: 'cyan' },
  link: { color: 'cyan' },
  success: { color: 'success' },
  error: { color: 'error' },
  inactive: { color: 'inactive' },
  plain: {},
}

export function paneColumns(e: RenderInput<'Pane'>): number {
  return e.props.bodyColumns ?? 60
}

async function closePane($: EngineInterface, paneId: string): Promise<void> {
  await $.ui.close({ id: paneId })
  $.ui.invalidate('ui.render')
}

// Every child of the body is exactly one terminal row, so its index is the row the engine scrolls by.
export function drawPlainPane($: EngineInterface, e: RenderInput<'Pane'>, model: PaneModel, scroll: { offset: number; bodyRows: number }, paneId: string): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const rows: ReturnType<typeof Text>[] = []
  const blank = (key: string) => rows.push(<Text key={key}> </Text>)

  const button = (b: PaneButton) => {
    const key = b.id === 'clear' ? 'clear' : b.id === 'more' ? `more-${b.todoId}` : `${b.id}-${b.todoId}`
    return (
      <Button
        key={key}
        plain={b.id === 'more' ? true : undefined}
        variant={PRIMARY.has(b.id) ? 'primary' : undefined}
        label={b.label}
        onPress={p => void act($, messageOf(b), p.surface)}
      />
    )
  }

  const draw = (row: PaneRow, key: string) => {
    switch (row.kind) {
      case 'blank':
        return blank(key)
      case 'text': {
        const text = (
          <Text key={`${key}-text`} wrap="truncate-end" {...TEXT_PROPS[row.tone]}>
            {row.text}
          </Text>
        )
        return rows.push(
          row.indent ? (
            <Box key={key} marginLeft={2}>
              {text}
            </Box>
          ) : (
            text
          ),
        )
      }
      case 'finished':
        return rows.push(
          <Box key={key} flexDirection="row">
            <Text {...TEXT_PROPS[row.tone]}>{`${row.mark} `}</Text>
            <Text dimColor wrap="truncate-end">
              {row.title}
            </Text>
            {row.exit !== undefined && <Text dimColor>{` (exit ${row.exit})`}</Text>}
          </Box>,
        )
      case 'buttons': {
        return rows.push(
          <Box key={key} flexDirection="row" gap={row.flush ? undefined : 1} marginLeft={row.flush ? undefined : 2}>
            {row.lead && <Text {...TEXT_PROPS[row.lead.tone]}>{row.lead.pad ? `${row.lead.text} ` : row.lead.text}</Text>}
            {row.buttons.map(button)}
          </Box>,
        )
      }
    }
  }

  blank('pad-top')
  rows.push(
    <Box key="header" flexDirection="row" justifyContent="space-between">
      <Text bold>{TITLE}</Text>
      <Button key="close" role="dismiss" label="Close" onPress={() => closePane($, paneId)} />
    </Box>,
  )
  blank('pad-header')

  model.rows.forEach((row, i) => draw(row, `row-${i}`))
  const overflows = HEADER_ROWS + model.rows.length + 1 > scroll.bodyRows
  if (overflows) endRows(model).forEach((row, i) => draw(row, `end-${i}`))
  blank('pad-bottom')

  return (
    <Box flexDirection="column" paddingX={2}>
      {rows}
    </Box>
  )
}
