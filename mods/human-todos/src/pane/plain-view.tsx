import type { EngineInterface, RenderElement, RenderInput, RenderSurface } from 'claude-code'

import { PLUGIN, TITLE, isActionable } from '../items'
import { peekTodos, removeTodos, toggleExpanded } from '../store'
import { cleanup, press } from '../wiring'
import { LABELS } from './model'
import type { PaneButton, PaneModel, Tone } from './model'

// pad-top, the header and pad-header sit above the model's rows.
const HEADER_ROWS = 3
const END_OF_LIST = "You've reached the end of the list."

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

async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PLUGIN })
  $.ui.invalidate('ui.render')
}

async function clearFinished($: EngineInterface): Promise<void> {
  const gone = await removeTodos($, t => !isActionable(t))
  void cleanup($, gone).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
}

async function pressTodo($: EngineInterface, button: PaneButton, surface: RenderSurface): Promise<void> {
  const todo = (await peekTodos($)).find(t => t.id === button.todoId)
  if (!todo || button.id === 'more' || button.id === 'clear') return
  try {
    await press($, todo, button.id, surface)
  } catch {
    $.ui.toast(`Could not ${LABELS[button.id].toLowerCase()} #${todo.id}`)
  }
}

// Every child of the body is exactly one terminal row, so its index is the row the engine scrolls by.
export function drawPlainPane($: EngineInterface, e: RenderInput<'Pane'>, model: PaneModel, scroll: { offset: number; bodyRows: number }): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const columns = paneColumns(e)
  const rows: ReturnType<typeof Text>[] = []
  const blank = (key: string) => rows.push(<Text key={key}> </Text>)

  const button = (b: PaneButton) => {
    const key = b.id === 'clear' ? 'clear' : b.id === 'more' ? `more-${b.todoId}` : `${b.id}-${b.todoId}`
    return (
      <Button
        key={key}
        plain={b.id === 'more' ? true : undefined}
        variant={b.tone === 'primary' ? 'primary' : undefined}
        label={b.label}
        onPress={p => (b.id === 'more' && b.todoId ? toggleExpanded($, b.todoId) : b.id === 'clear' ? clearFinished($) : void pressTodo($, b, p.surface))}
      />
    )
  }

  blank('pad-top')
  rows.push(
    <Box key="header" flexDirection="row" justifyContent="space-between">
      <Text bold>{TITLE}</Text>
      <Button key="close" role="dismiss" label="Close" onPress={() => closePane($)} />
    </Box>,
  )
  blank('pad-header')

  model.rows.forEach((row, i) => {
    const key = `row-${i}`
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
        const isClear = row.buttons.some(b => b.id === 'clear')
        return rows.push(
          <Box key={key} flexDirection="row" gap={isClear ? undefined : 1} marginLeft={isClear ? undefined : 2}>
            {/* pane.test.tsx pins the status lead with its trailing space; the "+N more" lead has none. */}
            {row.lead && <Text {...TEXT_PROPS[row.lead.tone]}>{row.lead.tone === 'dim' ? row.lead.text : `${row.lead.text} `}</Text>}
            {row.buttons.map(button)}
          </Box>,
        )
      }
    }
  })

  const overflows = HEADER_ROWS + model.rows.length + 1 > scroll.bodyRows
  if (overflows) {
    if (model.hasFinished) blank('pad-end')
    rows.push(
      <Text key="end" dimColor>
        {END_OF_LIST}
      </Text>,
    )
  }
  blank('pad-bottom')

  const hints: ReturnType<typeof Text>[] = []
  if (overflows && e.surface === 'terminal') {
    const bottom = scroll.offset + scroll.bodyRows - 1
    const spans = model.spans.map(s => ({ first: s.first + HEADER_ROWS, last: s.last + HEADER_ROWS }))
    const above = spans.filter(s => s.first < scroll.offset).length
    const below = spans.filter(s => s.last > bottom).length
    const hint = (key: string, top: number, text: string) => (
      <Box key={key} position="absolute" top={top} left={0} right={0}>
        <Text color="suggestion" wrap="truncate-end">
          {`  ${text}`.padEnd(columns)}
        </Text>
      </Box>
    )
    if (above > 0) hints.push(hint('more-above', scroll.offset, `↑ ${above} more`))
    if (below > 0) hints.push(hint('more-below', bottom, `↓ ${below} more`))
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      {rows}
      {hints}
    </Box>
  )
}
