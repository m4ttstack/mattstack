import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderSurface } from 'claude-code'
import { bandAbovePrompt, isEngaged, isPlaced, paneMessage, registerPaneRedraw, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { Todo } from '../types'
import { PLUGIN, TITLE } from './items'
import { toggleExpanded } from './store'
import { clearFinished, pressTodo } from './pane/act'
import { kitLayout, maxOffset, modelWidth } from './pane/kit-layout'
import type { PaneMessage } from './pane/kit-layout'
import { drawPlainPane, paneColumns } from './pane/plain-view'
import { bandModel, paneModel } from './pane/model'
import type { PaneModel } from './pane/model'
import { peekTodos, readPane } from './store'

// A literal on purpose: the engine's matcher scan reads a string literal, not the imported PLUGIN.
const PANE = 'human-todos'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TODO_PANE: HideablePane = { id: PANE, label: 'Human Todos waiting' }

// The engine reports the pane's focus but not its Client's, so a click in the pane sets this and typing in the prompt clears it.
const keysAtom = atom({ plugin: 'human-todos', key: 'keysInPane' } as const, false)
// The kit drawer's first row in view: the mod scrolls it, since the Client draws only the rows that fit.
const scrollAtom = atom({ plugin: 'human-todos', key: 'scrollOffset' } as const, 0)

// ui.scroll carries no width, so the scroll hook lays the list out at the width the kit drawer last drew.
let kitColumns: number | undefined

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
  $.ui.invalidate('ui.render')
}

function modelOf(pane: { list: Todo[]; openIds: string[]; spin: number }, width: number): PaneModel {
  return paneModel({ list: pane.list, expanded: pane.openIds, spin: SPIN[pane.spin % SPIN.length] ?? '', width })
}

async function waitingBand($: EngineInterface): Promise<Waiting | undefined> {
  const band = bandModel(await peekTodos($))
  return band && { formId: PANE, title: band.title }
}

async function setKeysInPane($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

async function act($: EngineInterface, message: PaneMessage, surface: RenderSurface): Promise<void> {
  if (message.type === 'press') return pressTodo($, message.id, message.button, surface)
  if (message.type === 'toggle') return toggleExpanded($, message.id)
  if (message.type === 'clear') return clearFinished($)
}

async function scrollKit($: EngineInterface, by: number, bodyRows: number, columns: number): Promise<void> {
  const most = maxOffset(kitLayout(modelOf(await readPane($), modelWidth(columns)), columns, bodyRows))
  const from = Math.min(await read($, scrollAtom), most)
  const to = Math.min(Math.max(0, from + by), most)
  if (to !== (await read($, scrollAtom))) await update($, scrollAtom, () => to)
}

export function registerPane(on: On): void {
  registerPaneRedraw(on)

  on('command.run', { command: 'todos' }, async $ => {
    await openPane($)
    return { text: `${TITLE} pane opened.` }
  })

  on('prompt.edit', async ($, e, next) => {
    await setKeysInPane($, false)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await setKeysInPane($, false)
    return next(e)
  })
  on('ui.focus', async ($, e, next) => {
    await setKeysInPane($, false)
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (isEngaged(e)) await setKeysInPane($, true)
    await paneMessage($, e, TODO_PANE, await waitingBand($))
    // Not awaited, as a Button's onPress is not: a run's start can wait on a slow probe, and the post must not hold it.
    if (e.requestId === PANE) void act($, e.data as PaneMessage, e.surface).catch(() => $.ui.toast(`Could not update ${TITLE}`))
    return next(e)
  })

  // A tree taller than its window is the plain drawer's, which the engine scrolls; the kit drawer only ever draws what fits.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows || kitColumns === undefined) return next(e)
    await scrollKit($, e.by, e.bodyRows, kitColumns)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (await isPlaced($, TODO_PANE)) return next(e)
    const band = bandModel(await peekTodos($))
    if (!band) return next(e)
    if (e.surface === 'terminal' || e.surface === 'desktop') return bandAbovePrompt($, e, await next(e), { formId: PANE, title: band.title }, TODO_PANE)
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
    const pane = await readPane($)
    // Only terminal and desktop draw a Client; vscode and mobile keep the engine-drawn pane.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const inner = Math.max(22, paneColumns(e) - 4)
      return drawPlainPane($, e, modelOf(pane, inner - 2), e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY }, PANE)
    }
    const { Client } = $.ui.resolve(e)
    const width = paneColumns(e)
    kitColumns = width
    const props = {
      model: modelOf(pane, modelWidth(width)),
      focused: e.props.isFocused || (await read($, keysAtom)),
      width,
      offset: await read($, scrollAtom),
      bodyRows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 30,
    }
    return <Client key="human-todos-pane" module="./pane/kit-view.tsx" props={props} />
  })
}
