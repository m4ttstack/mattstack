import type { EngineInterface, On } from 'claude-code'

import type { Todo } from '../types'
import { LIVE_LINES_HERDR, LIVE_LINES_LOCAL, PLUGIN, TITLE, buttonsFor, fileName, hardWrap, isActionable, wrapWords } from './items'
import type { ButtonId } from './items'
import { peekTodos, readPane, removeTodos, toggleExpanded } from './store'
import { cleanup, press } from './wiring'

const PANE = 'human-todos'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SCRIPT_ROWS = 2
const FINISHED_SHOWN = 8
const END_OF_LIST = "You've reached the end of the list."

const LABELS: Record<ButtonId, string> = {
  run: 'Run',
  open: 'Open',
  copy: 'Copy',
  done: 'Done',
  skip: 'Skip',
  confirm: 'Confirm',
  cancel: 'Cancel',
  show: 'Show',
  stop: 'Stop',
  forceStop: 'Force stop',
  openLog: 'Open log',
}

const PRIMARY: readonly ButtonId[] = ['run', 'open', 'confirm', 'show']

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
  $.ui.invalidate('ui.render')
}

async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

function markFor(todo: Todo): { mark: string; color: string } {
  if (todo.status === 'failed') return { mark: '✗ ', color: 'error' }
  if (todo.status === 'skipped') return { mark: '– ', color: 'inactive' }
  return { mark: '✓ ', color: 'success' }
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
    const waiting = (await peekTodos($)).filter(t => t.status === 'open' || t.status === 'confirming').length
    if (waiting === 0) return next(e)
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

  // Every child of the body is exactly one terminal row, so its index is the row the engine scrolls by.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { list, openIds, spin: frameNo } = await readPane($)
    const actionable = list.filter(isActionable)
    const finished = list.filter(t => !isActionable(t))
    const spin = SPIN[frameNo % SPIN.length]
    const columns = e.props.bodyColumns ?? 60
    const inner = Math.max(22, columns - 4)
    const width = inner - 2

    const rows: ReturnType<typeof Text>[] = []
    const spans: { first: number; last: number }[] = []
    const blank = (key: string) => rows.push(<Text key={key}> </Text>)
    const indented = (key: string, node: ReturnType<typeof Text>) =>
      rows.push(
        <Box key={key} marginLeft={2}>
          {node}
        </Box>,
      )
    const lines = (key: string, text: string, w: number, props: Record<string, unknown>, indent: boolean) =>
      wrapWords(text, w).forEach((line, n) => {
        const node = (
          <Text key={`${key}-${n}`} wrap="truncate-end" {...props}>
            {line}
          </Text>
        )
        if (indent) indented(`${key}-row-${n}`, node)
        else rows.push(node)
      })

    const buttonsRow = (todo: Todo) =>
      buttonsFor(todo).map(id => (
        <Button
          key={`${id}-${todo.id}`}
          variant={PRIMARY.includes(id) ? 'primary' : undefined}
          label={LABELS[id]}
          onPress={p => {
            void press($, todo, id, p.surface).catch(() => $.ui.toast(`Could not ${LABELS[id].toLowerCase()} #${todo.id}`))
          }}
        />
      ))

    blank('pad-top')
    rows.push(
      <Box key="header" flexDirection="row" justifyContent="space-between">
        <Text bold>{TITLE}</Text>
        <Button key="close" role="dismiss" label="Close" onPress={() => closePane($)} />
      </Box>,
    )
    blank('pad-header')
    if (actionable.length === 0) {
      rows.push(
        <Text key="empty" dimColor>
          Nothing for you right now.
        </Text>,
      )
      if (finished.length > 0) blank('pad-empty')
    }

    for (const todo of actionable) {
      const first = rows.length
      const id = todo.id
      const script = todo.script ? hardWrap(`$ ${todo.script}`, width) : []
      const isConfirming = todo.status === 'confirming'
      const isOpen = openIds.includes(id) || isConfirming
      const shown = isOpen ? script : script.slice(0, SCRIPT_ROWS)
      const hidden = script.length - SCRIPT_ROWS
      const tail = (todo.liveTail ?? []).slice(todo.runner === 'local' ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR)

      lines(`title-${id}`, `${todo.status === 'running' ? `${spin} ` : '○ '}${todo.title}`, inner, { bold: true }, false)
      if (todo.detail) lines(`detail-${id}`, todo.detail, width, { dimColor: true }, true)
      if (todo.status !== 'running' && todo.note) lines(`note-${id}`, todo.note, width, { color: 'warning' }, true)
      shown.forEach((row, n) =>
        indented(
          `s-row-${id}-${n}`,
          <Text key={`s-${id}-${n}`} color="cyan" wrap="truncate-end">
            {row}
          </Text>,
        ),
      )
      if (hidden > 0 && !isConfirming)
        rows.push(
          <Box key={`more-row-${id}`} flexDirection="row" gap={1} marginLeft={2}>
            {!isOpen && <Text dimColor>{`… +${hidden} more`}</Text>}
            <Button key={`more-${id}`} plain label={isOpen ? 'Show less' : 'Show all'} onPress={() => toggleExpanded($, id)} />
          </Box>,
        )
      if (todo.kind === 'run' && todo.cwd)
        indented(
          `cwd-row-${id}`,
          <Text key={`cwd-${id}`} dimColor wrap="truncate-end">
            {`in ${todo.cwd}`}
          </Text>,
        )
      if (todo.url) lines(`url-${id}`, todo.url, width, { color: 'cyan' }, true)
      if (todo.paths?.length) lines(`images-${id}`, todo.paths.map(fileName).join(', '), width, { color: 'cyan' }, true)
      if (todo.status === 'running') {
        blank(`pad-tail-${id}`)
        tail.forEach((line, n) =>
          indented(
            `tail-row-${id}-${n}`,
            <Text key={`tail-${id}-${n}`} dimColor wrap="truncate-end">
              {line}
            </Text>,
          ),
        )
        if (tail.length > 0) blank(`pad-status-${id}`)
        rows.push(
          <Box key={`status-${id}`} flexDirection="row" gap={1} marginLeft={2}>
            <Text color={todo.isStopping ? 'error' : 'warning'}>{`${spin} ${todo.isStopping ? 'Stopping…' : 'Running'} `}</Text>
            {buttonsRow(todo)}
          </Box>,
        )
      } else {
        blank(`pad-buttons-${id}`)
        if (isConfirming) lines(`confirm-${id}`, 'Are you sure you want to run this script?', width, {}, true)
        rows.push(
          <Box key={`buttons-${id}`} flexDirection="row" gap={1} marginLeft={2}>
            {buttonsRow(todo)}
          </Box>,
        )
      }
      spans.push({ first, last: rows.length - 1 })
      blank(`pad-item-${id}`)
    }

    if (finished.length > 0) {
      for (const todo of finished.slice(-FINISHED_SHOWN)) {
        const { mark, color } = markFor(todo)
        spans.push({ first: rows.length, last: rows.length })
        rows.push(
          <Box key={`fin-${todo.id}`} flexDirection="row">
            <Text color={color}>{mark}</Text>
            <Text dimColor wrap="truncate-end">
              {todo.title}
            </Text>
            {todo.exitCode !== undefined && todo.exitCode !== 0 && <Text dimColor>{` (exit ${todo.exitCode})`}</Text>}
          </Box>,
        )
      }
      blank('pad-clear')
      rows.push(
        <Box key="clear-row" flexDirection="row">
          <Button
            key="clear"
            label="Clear finished"
            onPress={async () => {
              const gone = await removeTodos($, t => !isActionable(t))
              void cleanup($, gone).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
            }}
          />
        </Box>,
      )
    }

    const scroll = e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY }
    const overflows = rows.length + 1 > scroll.bodyRows
    if (overflows) {
      if (finished.length > 0) blank('pad-end')
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
  })
}
