import type { EngineInterface, On } from 'claude-code'

import type { Todo } from '../types'
import { LIVE_LINES_HERDR, LIVE_LINES_LOCAL, PLUGIN, TITLE, buttonsFor, hardWrap, isActionable } from './items'
import type { ButtonId } from './items'
import { peekTodos, readPane, removeTodos, toggleExpanded } from './store'
import { cleanup, press } from './wiring'

const PANE = PLUGIN
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SCRIPT_ROWS = 2
const FINISHED_SHOWN = 8

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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { list, openIds, spin: frameNo } = await readPane($)
    const actionable = list.filter(isActionable)
    const finished = list.filter(t => !isActionable(t))
    const spin = SPIN[frameNo % SPIN.length]
    const width = Math.max(20, (e.props.bodyColumns ?? 60) - 6)

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

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
          <Text bold>{TITLE}</Text>
          <Button key="close" role="dismiss" label="Close" onPress={() => closePane($)} />
        </Box>
        {actionable.length === 0 && <Text dimColor>Nothing for you right now.</Text>}
        {actionable.length === 0 && finished.length > 0 && <Text> </Text>}
        {actionable.map(todo => {
          const rows = todo.script ? hardWrap(`$ ${todo.script}`, width) : []
          const isConfirming = todo.status === 'confirming'
          const isOpen = openIds.includes(todo.id) || isConfirming
          const shown = isOpen ? rows : rows.slice(0, SCRIPT_ROWS)
          const hidden = rows.length - SCRIPT_ROWS
          const tail = (todo.liveTail ?? []).slice(todo.runner === 'local' ? -LIVE_LINES_LOCAL : -LIVE_LINES_HERDR)
          return (
            <Box key={`item-${todo.id}`} flexDirection="column" marginBottom={1}>
              <Text bold>{`${todo.status === 'running' ? `${spin} ` : '○ '}${todo.title}`}</Text>
              <Box flexDirection="column" marginLeft={2}>
                {todo.detail && <Text dimColor>{todo.detail}</Text>}
                {todo.status !== 'running' && todo.note && <Text color="warning">{todo.note}</Text>}
                {shown.length > 0 && (
                  <Box flexDirection="column">
                    {shown.map((row, n) => (
                      <Text key={`s-${todo.id}-${n}`} color="cyan" wrap="truncate-end">
                        {row}
                      </Text>
                    ))}
                    {hidden > 0 && !isConfirming && (
                      <Box flexDirection="row" gap={1}>
                        {!isOpen && <Text dimColor>{`… +${hidden} more`}</Text>}
                        <Button key={`more-${todo.id}`} plain label={isOpen ? 'Show less' : 'Show all'} onPress={() => toggleExpanded($, todo.id)} />
                      </Box>
                    )}
                  </Box>
                )}
                {todo.kind === 'run' && todo.cwd && (
                  <Text dimColor wrap="truncate-end">
                    {`in ${todo.cwd}`}
                  </Text>
                )}
                {todo.url && <Text color="cyan">{todo.url}</Text>}
                {todo.status === 'running' ? (
                  <Box marginTop={1} flexDirection="column">
                    {tail.map((line, n) => (
                      <Text key={`tail-${todo.id}-${n}`} dimColor wrap="truncate-end">
                        {line}
                      </Text>
                    ))}
                    <Box flexDirection="row" gap={1} marginTop={tail.length > 0 ? 1 : 0}>
                      <Text color={todo.isStopping ? 'error' : 'warning'}>{`${spin} ${todo.isStopping ? 'Stopping…' : 'Running'} `}</Text>
                      {buttonsRow(todo)}
                    </Box>
                  </Box>
                ) : (
                  <Box flexDirection="column" marginTop={1}>
                    {isConfirming && <Text>Are you sure you want to run this script?</Text>}
                    <Box flexDirection="row" gap={1}>
                      {buttonsRow(todo)}
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
        {finished.length > 0 && (
          <Box flexDirection="column">
            {finished.slice(-FINISHED_SHOWN).map(todo => {
              const { mark, color } = markFor(todo)
              return (
                <Box key={`fin-${todo.id}`} flexDirection="row">
                  <Text color={color}>{mark}</Text>
                  <Text dimColor>{todo.title}</Text>
                  {todo.exitCode !== undefined && todo.exitCode !== 0 && <Text dimColor>{` (exit ${todo.exitCode})`}</Text>}
                </Box>
              )
            })}
            <Text> </Text>
            <Button
              key="clear"
              label="Clear finished"
              onPress={async () => {
                const gone = await removeTodos($, t => !isActionable(t))
                void cleanup($, gone).catch(() => $.ui.toast('Could not tidy up after the cleared items'))
              }}
            />
          </Box>
        )}
      </Box>
    )
  })
}
