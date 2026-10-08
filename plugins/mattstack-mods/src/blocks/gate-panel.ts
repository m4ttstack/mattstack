import type { EngineEventOf, EngineResultOf, ThemeKey } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'
import { call } from '../core/rpc.ts'
import { createDisplay, type FormQuestion } from './display.ts'
import { joinChunks } from './gate-chunks.ts'
import { surface, type FormDialogs } from './gate-form.ts'
import { clip, HOTKEY_CELLS, kindOf, oneLine, subjectTail, text, type El, type Node } from './gate-view.ts'

type Render = EngineEventOf['ui.render']
type RenderResult = EngineResultOf['ui.render']

export const PANEL_PANE_ID = 'gate-panel'
/** The `by` rt records for an answer a person gave in the waiting session's own pane. */
export const PANEL_BY = 'pane-person'

const GATE_ID = /^[A-Za-z0-9_-]{1,128}$/
const WAITING = 'Waiting on your answer'
const ANSWERING = 'Answering in the panel  →'
const ANSWER = 'Answer'
const ESC_BACK = 'esc back to the prompt'
const ESC_SHORT = 'esc back'
/** Cells between the band's title and its summary. */
const TITLE_GAP = 3
/** The cells the engine keeps at the band's right end for its `[-]`, outside `bodyColumns`. */
const BAND_MARK_CELLS = 5

/** The parts of rt's gate row (packages/rt-client GateRow) this block reads. */
type PanelGate = {
  id: string
  status: string
  kind?: string
  subject?: string
  context?: string | null
  questions: FormQuestion[]
  origin?: { presentation?: string; session?: string } | null
}

const isQuestion = (q: unknown): q is FormQuestion => {
  const x = q as Partial<FormQuestion> | null
  return !!x && typeof x.id === 'string' && typeof x.label === 'string' && Array.isArray(x.options)
}

/** The summary's parts: `<kind> <subject tail>`, `<N> questions`, and question `index`'s label, each '' where a gate lacks it. */
function parts(gate: PanelGate, index: number): [string, string, string] {
  const named = [kindOf(gate.kind), subjectTail(gate.subject)].filter(Boolean).join(' ')
  // The pages the pane draws, with chunks of one question joined, as `index` counts them.
  const pages = joinChunks(gate.questions).questions
  const count = pages.length > 1 ? `${pages.length} questions` : ''
  return [named, count, oneLine((pages[index] ?? pages[0]!).label)]
}

const joinParts = (...said: string[]) => said.filter(Boolean).join(' · ')

/** `<kind> <subject tail> · <N> questions · <first question label>`, leaving out what a gate lacks. */
function summary(gate: PanelGate): string {
  return joinParts(...parts(gate, 0))
}

/** The open band's summaries, fullest first: all of it, then without kind and subject, then the current question alone. */
function openSummaries(gate: PanelGate, index: number): string[] {
  const [named, count, label] = parts(gate, index)
  return [joinParts(named, count, label), joinParts(count, label), label]
}

/**
 * The `gate-panel` block: while this session waits on one of its own open
 * gates with no dialog on screen for it (a herd worker's gates, a wait gate),
 * a band row above the prompt names it, and pressing it (`1` at an empty
 * prompt, or a click) opens a pane where a person answers it.
 * The answer goes to rt as `pane-person`; the session is woken by whatever
 * already waits on the gate. Only a press in the band or the pane reaches
 * `gate:answer`: the block takes no tool call, delivery or command.
 */
export function registerGatePanel(hub: Hub, link: Link, dialogs?: FormDialogs): void {
  const display = createDisplay(hub, { id: PANEL_PANE_ID, title: 'Gate' })
  let gates: PanelGate[] = []
  /** The terminal's width as the band's most recent render gave it, for the pane's width request. */
  let terminalColumns: number | undefined
  /** The listed gates the row may name: a gate whose AskUserQuestion dialog is up already has its answer surface. */
  const waiting = () => (dialogs ? gates.filter(g => !dialogs.up(g.id)) : gates)
  const watches = new Map<string, AbortController>()
  let paneFor: string | null = null
  /** Counts presses, so only the newest ask's ending stops tracking the pane. */
  let asks = 0
  const live = () => hub.liveBlocks().includes('gate-panel')
  let running: Promise<void> | null = null
  let queued = false
  let last: ModApi | null = null

  function log(api: ModApi, text: string): void {
    try {
      api.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  function tell(api: ModApi, text: string): void {
    try {
      api.ui.log(text)
    } catch {
      // A failed log must not change what the block does.
    }
  }

  function closePane(api: ModApi): void {
    if (paneFor === null) return
    paneFor = null
    api.ui.close(PANEL_PANE_ID).catch(() => {})
  }

  function drop(api: ModApi): void {
    for (const stop of watches.values()) stop.abort()
    watches.clear()
    gates = []
    closePane(api)
    api.ui.redraw()
  }

  /** Reads this session's open gates and watches each one's events from the head of the bus. */
  async function load(api: ModApi): Promise<void> {
    const session = await api.session.id()
    // The cursor is taken before the list, so a change landing in between is
    // still an event after it.
    const head = await call<{ cursor?: number }>(api, 'events:head', {})
    if (!head.ok || typeof head.data?.cursor !== 'number') {
      log(api, `gate panel: events:head failed${head.ok ? '' : ` (${head.error.code}: ${head.error.message})`}`)
      return
    }
    const listed = await call<{ gates?: PanelGate[] }>(api, 'gate:list', { open: true, session })
    if (!listed.ok || !Array.isArray(listed.data?.gates)) {
      log(api, `gate panel: gate:list failed${listed.ok ? '' : ` (${listed.error.code}: ${listed.error.message})`}`)
      return
    }
    // A clear while this load was out has already stopped every watch.
    if (!live()) return
    // A daemon from before the session filter answers every gate, so the
    // asking session is checked here too.
    const open = listed.data.gates.filter(
      g =>
        GATE_ID.test(g.id) &&
        g.status === 'open' &&
        g.origin?.session === session &&
        Array.isArray(g.questions) &&
        g.questions.length > 0 &&
        g.questions.every(isQuestion),
    )
    const ids = new Set(open.map(g => g.id))
    for (const [id, stop] of watches) {
      if (ids.has(id)) continue
      stop.abort()
      watches.delete(id)
    }
    if (paneFor !== null && !ids.has(paneFor)) closePane(api)
    gates = open
    for (const g of open) if (!watches.has(g.id)) watch(api, g.id, head.data.cursor)
    api.ui.redraw()
  }

  /** One load at a time; a trigger landing during one runs one more after it. */
  function refresh(api: ModApi): Promise<void> {
    last = api
    if (running) {
      queued = true
      return running
    }
    running = (async () => {
      do {
        queued = false
        try {
          await load(api)
        } catch (err) {
          log(api, `gate panel: could not read this session's gates: ${err instanceof Error ? err.message : String(err)}`)
        }
      } while (queued)
    })().finally(() => {
      running = null
    })
    return running
  }

  function watch(api: ModApi, id: string, cursor: number): void {
    const stop = new AbortController()
    watches.set(id, stop)
    link.wait(`gate/*/${id}`, cursor, events => events.length > 0, stop.signal).then(
      () => {
        if (watches.get(id) !== stop) return
        watches.delete(id)
        if (live()) void refresh(api)
      },
      err => {
        if (watches.get(id) === stop) watches.delete(id)
        if (!stop.signal.aborted) log(api, `gate panel: the watch on gate ${id} ended: ${err instanceof Error ? err.message : String(err)}`)
      },
    )
  }

  /** Asks `gate` in the pane and records what the person answered there. */
  async function ask(api: ModApi, gate: PanelGate): Promise<void> {
    const token = ++asks
    paneFor = gate.id
    api.ui.redraw()
    const asked = { id: gate.id, questions: gate.questions, kind: gate.kind, subject: gate.subject, context: gate.context }
    const answers = await display.formPane(api, asked, terminalColumns)
    if (asks === token) paneFor = null
    api.ui.redraw()
    if (!answers) return
    const out = await call<{ row?: { answer?: { by?: string } | null }; conflict?: boolean }>(api, 'gate:answer', {
      id: gate.id,
      answers,
      by: PANEL_BY,
    })
    if (!out.ok) {
      tell(api, `Your answer to gate ${gate.id} did not go through: ${out.error.message}.`)
      void refresh(api)
      return
    }
    if (out.data?.conflict) {
      tell(api, `Gate ${gate.id} was already answered by ${surface(out.data.row?.answer?.by)}, so your answer was not recorded.`)
    } else {
      log(api, `gate ${gate.id} answered in the pane`)
    }
    gates = gates.filter(g => g.id !== gate.id)
    api.ui.redraw()
  }

  /**
   * One band row: the title, the gate's summary and `aside` clipped to the
   * cells left, and `right` at the right end. With no room the summary goes.
   */
  function line(el: El, title: string, said: string, saidColor: ThemeKey, aside: string, right: Node, rightCells: number, columns: number): Node {
    const room = columns - title.length - TITLE_GAP - rightCells - 1 - aside.length
    const left = [text(el, 'suggestion', title, { bold: true, wrap: 'truncate-end' })]
    if (room > 1) {
      const summed = [text(el, saidColor, clip(said, room), { wrap: 'truncate-end' })]
      if (aside) summed.push(text(el, 'inactive', aside, { wrap: 'truncate-end' }))
      left.push(el.Box({ flexDirection: 'row', flexShrink: 1, children: summed }))
    }
    return el.Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [el.Box({ flexDirection: 'row', columnGap: TITLE_GAP, flexShrink: 1, children: left }), el.Box({ flexShrink: 0, children: [right] })],
    })
  }

  function row(api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>): Promise<RenderResult> {
    if (e.component !== 'AbovePrompt') return next(e)
    const columns = Number.isFinite(e.props.bodyColumns) && e.props.bodyColumns > 0 ? e.props.bodyColumns : Infinity
    // The viewport is the terminal's own width; the band's column narrows beside a docked pane.
    const viewport = e.viewport?.columns
    if (typeof viewport === 'number' && Number.isFinite(viewport) && viewport > 0) terminalColumns = viewport
    else if (columns !== Infinity) terminalColumns = columns + BAND_MARK_CELLS
    const listed = waiting()
    const open = paneFor === null ? undefined : listed.find(g => g.id === paneFor)
    const shown = open ?? listed[0]
    // The pane's gate just left the list: draw no Button until the pane closes.
    if (!shown || e.props.hasSurvey || (paneFor !== null && !open)) return next(e)
    const el = api.ui.elements(e)
    let first: Node
    if (open) {
      // No Button while the pane is open, so a second `1` at the prompt presses nothing.
      const at = display.progress()
      const count = at?.count ?? joinChunks(open.questions).questions.length
      const long = count > 1 && at ? ` · question ${at.index + 1} of ${count}` : ''
      const short = count > 1 && at ? ` · ${at.index + 1}/${count}` : ''
      // Beside a docked pane the band is narrow. The hint, then the counter,
      // take their short forms; then the summary drops the kind and subject,
      // then the question count, and last the question it is on is clipped.
      const plans: [string, string][] = [
        [ESC_BACK, long],
        [ESC_SHORT, long],
        [ESC_SHORT, short],
      ]
      const fixed = ANSWERING.length + TITLE_GAP + 1
      const summaries = openSummaries(open, at?.index ?? 0)
      let chosen: [string, string, string] = [summaries.at(-1)!, ...plans.at(-1)!]
      search: for (const said of summaries) {
        for (const [h, w] of plans) {
          if (said.length <= columns - fixed - h.length - w.length) {
            chosen = [said, h, w]
            break search
          }
        }
      }
      const [said, hint, where] = chosen
      const esc = clip(hint, columns - 1)
      first = line(el, ANSWERING, said, 'inactive', where, text(el, 'inactive', esc, { wrap: 'truncate-end' }), esc.length, columns)
    } else {
      const label = clip(ANSWER, columns - HOTKEY_CELLS - 1)
      const button = el.Button({ key: 'gate-panel', label, hotkey: '1', plain: true, onPress: () => void ask(api, shown) })
      first = line(el, WAITING, summary(shown), 'text', '', button, HOTKEY_CELLS + label.length, columns)
    }
    if (listed.length === 1) return Promise.resolve(first)
    const more = text(el, 'inactive', clip(`${listed.length - 1} more waiting after this one`, columns))
    return Promise.resolve(el.Box({ flexDirection: 'column', children: [first, more] }))
  }

  dialogs?.onChange(api => {
    if (paneFor !== null && dialogs.up(paneFor)) closePane(api)
    api.ui.redraw()
  })

  link.onLinked(api => {
    if (live()) void refresh(api)
  })

  hub.onCleared(block => {
    if (block !== 'gate-panel') return
    for (const stop of watches.values()) stop.abort()
    watches.clear()
    gates = []
    if (last) closePane(last)
  })

  hub.onLifecycle('session-end', async api => drop(api))

  hub.block('gate-panel', async (_api, scope) => {
    scope.onRender('AbovePrompt', async (api, e, next) => row(api, e, next))
    scope.onLifecycle('turn-end', async api => {
      void refresh(api)
    })
  })
}
