import type { EngineEventOf, EngineResultOf } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { Link } from '../core/link.ts'
import { call } from '../core/rpc.ts'
import { createDisplay, type FormQuestion } from './display.ts'
import { surface, type FormDialogs } from './gate-form.ts'

type Render = EngineEventOf['ui.render']
type RenderResult = EngineResultOf['ui.render']

export const PANEL_PANE_ID = 'gate-panel'
/** The `by` rt records for an answer a person gave in the waiting session's own pane. */
export const PANEL_BY = 'pane-person'

const GATE_ID = /^[A-Za-z0-9_-]{1,128}$/
const ROW_PREFIX = 'Waiting on your answer: '
/** What a plain Button draws ahead of its label: the hotkey and a colon. */
const HOTKEY_CELLS = 3

/** The parts of rt's gate row (packages/rt-client GateRow) this block reads. */
type PanelGate = {
  id: string
  status: string
  questions: FormQuestion[]
  origin?: { presentation?: string; session?: string } | null
}

const isQuestion = (q: unknown): q is FormQuestion => {
  const x = q as Partial<FormQuestion> | null
  return !!x && typeof x.id === 'string' && typeof x.label === 'string' && Array.isArray(x.options)
}

const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()

function clip(text: string, cells: number): string {
  if (cells <= 1) return text.slice(0, Math.max(cells, 0))
  return text.length <= cells ? text : `${text.slice(0, cells - 1).trimEnd()}…`
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
    const answers = await display.formPane(api, { id: gate.id, questions: gate.questions })
    if (asks === token) paneFor = null
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

  function row(api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>): Promise<RenderResult> {
    const listed = waiting()
    const shown = listed[0]
    if (e.component !== 'AbovePrompt' || !shown || e.props.hasSurvey) return next(e)
    const el = api.ui.elements(e)
    const columns = Number.isFinite(e.props.bodyColumns) && e.props.bodyColumns > 0 ? e.props.bodyColumns : Infinity
    const label = clip(`${ROW_PREFIX}${oneLine(shown.questions[0]!.label)}`, Math.max(columns - HOTKEY_CELLS, 1))
    const button = el.Button({ key: 'gate-panel', label, hotkey: '1', plain: true, onPress: () => void ask(api, shown) })
    if (listed.length === 1) return Promise.resolve(button)
    const more = el.Text({ dimColor: true, children: [clip(`${listed.length - 1} more waiting after this one`, columns)] })
    return Promise.resolve(el.Box({ flexDirection: 'column', children: [button, more] }))
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
