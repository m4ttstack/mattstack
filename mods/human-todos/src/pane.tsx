import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { bandAbovePrompt, isEngaged, isPlaced, paneMessage, paneRows, registerPaneRedraw, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { Todo } from '../types'
import { PLUGIN, TITLE } from './items'
import { act } from './pane/act'
import { kitLayout, kitView, maxOffset, modelWidth } from './pane/kit-layout'
import { drawPlainPane, paneColumns } from './pane/plain-view'
import { bandModel, paneModel } from './pane/model'
import type { PaneMessage, PaneModel } from './pane/model'
import { peekTodos, readPane } from './store'

// A literal on purpose: the engine's matcher scan reads a string literal, not the imported PLUGIN.
const PANE = 'human-todos'
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TODO_PANE: HideablePane = { id: PANE, label: 'Human Todos waiting' }

// The engine reports the pane's focus but not its Client's, so a click in the pane sets this and typing in the prompt clears it.
const keysAtom = atom({ plugin: 'human-todos', key: 'keysInPane' } as const, false)
// The kit drawer's first row in view: the mod scrolls it, since the Client draws only the rows that fit.
const scrollAtom = atom({ plugin: 'human-todos', key: 'scrollOffset' } as const, 0)

// The sizes the kit drawer is drawn at, by surface: ui.scroll carries no width, and a shrink neither size.
// Every surface shares the one stored offset and clamps it to its own window when it draws, so the stored one may go as far as
// the surface that can go furthest; clamping to whichever drew last would cut a bigger surface back to a smaller one.
const kitSizes = new Map<string, { columns: number; bodyRows: number }>()

export async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
  $.ui.invalidate('ui.render')
}

// The kit drawer offers each item's message row; the plain drawer has no field to type in.
function modelOf(pane: { list: Todo[]; openIds: string[]; spin: number; composing: string | null; composeLines: number }, width: number, messages = true): PaneModel {
  return paneModel({ list: pane.list, expanded: pane.openIds, spin: SPIN[pane.spin % SPIN.length] ?? '', width, messages, composing: pane.composing, composeLines: pane.composeLines })
}

async function waitingBand($: EngineInterface): Promise<Waiting | undefined> {
  const band = bandModel(await peekTodos($))
  return band && { formId: PANE, title: band.title }
}

async function setKeysInPane($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

// `to` is the wanted offset from the stored one, clamped first to the list as it is now.
async function scrollKit($: EngineInterface, to: (from: number) => number): Promise<void> {
  if (kitSizes.size === 0) return
  const pane = await readPane($)
  const most = Math.max(...[...kitSizes.values()].map(({ columns, bodyRows }) => maxOffset(kitLayout(modelOf(pane, modelWidth(columns)), columns, bodyRows))))
  const from = Math.min(await read($, scrollAtom), most)
  const next = Math.min(Math.max(0, to(from)), most)
  if (next !== (await read($, scrollAtom))) await update($, scrollAtom, () => next)
}

// The Client clamps only what it draws, so after the list shrinks the stored offset is clamped too, or a regrown list reopens at the old depth.
export async function clampScroll($: EngineInterface): Promise<void> {
  await scrollKit($, from => from)
}

export function registerPane(on: On): void {
  registerPaneRedraw(on)

  on('command.run', { command: 'todos' }, async $ => {
    await openPane($)
    return { text: `${TITLE} pane opened.` }
  })

  // Typing into an open message card raises prompt.edit too, so while one is open the keys stay with the pane;
  // clearing them here would flash the pane's keyboard marks off and on with every key.
  on('prompt.edit', async ($, e, next) => {
    if ((await readPane($)).composing === null) await setKeysInPane($, false)
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
    // The keys moved the selection out of view: the Client asks for the offset that shows it.
    const reveal = e.data as { type?: unknown; offset?: unknown }
    if (e.requestId === PANE && reveal.type === 'scrollTo' && typeof reveal.offset === 'number') {
      const offset = reveal.offset
      await scrollKit($, () => offset)
    }
    // Not awaited, as a Button's onPress is not: a run's start can wait on a slow probe, and the post must not hold it.
    if (e.requestId === PANE) void act($, e.data as PaneMessage, e.surface)
    return next(e)
  })

  // A tree taller than its window is the plain drawer's, which the engine scrolls; the kit drawer only ever draws what fits.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows || kitSizes.size === 0) return next(e)
    await scrollKit($, from => from + e.by)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (await isPlaced($, TODO_PANE)) return next(e)
    const band = bandModel(await peekTodos($))
    if (!band) return next(e)
    if (e.surface === 'terminal' || e.surface === 'desktop') return bandAbovePrompt($, e, await next(e), { formId: PANE, title: band.title }, TODO_PANE, { engineShow: true })
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
      return drawPlainPane($, e, modelOf(pane, inner - 2, false), e.props.scroll ?? { offset: 0, bodyRows: Number.POSITIVE_INFINITY }, PANE)
    }
    const { Box, Client, Text, Input, Button } = $.ui.resolve(e)
    const width = paneColumns(e)
    const paneBody = paneRows(e)
    const todo = pane.composing === null ? undefined : pane.list.find(t => t.id === pane.composing)
    // An engine Input takes no keys inside a Client, and a Client hands its key listener no paste, so the message
    // field docks under the list, drawn by this hook.
    const bodyRows = todo ? Math.max(3, paneBody - DOCK_ROWS) : paneBody
    kitSizes.set(e.surface, { columns: width, bodyRows })
    const props = {
      view: kitView(modelOf({ ...pane, composing: null }, modelWidth(width)), width, bodyRows, await read($, scrollAtom)),
      focused: e.props.isFocused || (await read($, keysAtom)),
      width,
    }
    const list = <Client key="human-todos-pane" module="./pane/kit-view.tsx" height={bodyRows} props={props} />
    if (!todo) return list
    const id = todo.id
    const send = (done: boolean) => {
      const text = drafts.get(id) ?? ''
      if (text.trim() === '') return
      drafts.delete(id)
      void act($, { type: 'send', id, text, done }, e.surface)
    }
    return (
      <Box flexDirection="column">
        {list}
        <Text dimColor>{'─'.repeat(Math.max(1, width - 2))}</Text>
        <Text color="suggestion" wrap="truncate-end">{`Message about “${todo.title}”`}</Text>
        <Input
          key={`message-${id}`}
          rows={DRAFT_ROWS}
          autoFocus
          placeholder="Type or paste a message for Claude"
          value={drafts.get(id) ?? ''}
          submitLabel="send"
          onInput={value => {
            drafts.set(id, value)
          }}
          onSubmit={value => {
            drafts.set(id, value)
            send(false)
          }}
        />
        <Box flexDirection="row" gap={2} justifyContent="flex-end">
          <Button
            key={`message-cancel-${id}`}
            label="Cancel"
            onPress={() => {
              drafts.delete(id)
              void act($, { type: 'press', id, button: 'cancelMessage' }, e.surface)
            }}
          />
          <Button key={`message-done-${id}`} label="Send & mark done" onPress={() => send(true)} />
          <Button key={`message-send-${id}`} label="Send" onPress={() => send(false)} />
        </Box>
      </Box>
    )
  })
}

// The docked message field: a rule, the title line, the field's rows and the buttons row.
const DRAFT_ROWS = 3
const DOCK_ROWS = DRAFT_ROWS + 3
// Each open message's draft, by item, so a redraw of the pane hands the Input back what the person typed.
const drafts = new Map<string, string>()
