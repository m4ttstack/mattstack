import type { EngineEventOf, EngineResultOf } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { GateOption } from './gate-form.ts'
import {
  choiceSubtext,
  gateContext,
  HOTKEY_CELLS,
  kindOf,
  questionContext,
  questionFindings,
  stripRecommended,
  stripSeverityTags,
  subjectTail,
  text,
  type El,
  type Node,
} from './gate-view.ts'

type Render = EngineEventOf['ui.render']
type RenderResult = EngineResultOf['ui.render']

export type FormQuestion = { id: string; label: string; multi?: boolean; options: GateOption[]; context?: string | null }
export type FormGate = { id: string; questions: FormQuestion[]; kind?: string; subject?: string; context?: string | null }
/**
 * Keyed by question id, in the shape rt's gate:answer takes: an option value
 * (several for a multi question), `{ value, note }` when a note was typed,
 * or the typed text for a question with no options.
 */
export type Answer = Record<string, string | string[] | { value: string | string[]; note: string }>

export const FORM_PANE_ID = 'mattstack-gate-form'

/** Choice hotkeys in order: digits are never used, since a repeat of the band's `1` would land on one. */
const CHOICE_KEYS = 'abcdefghijklmnopqrstuvwxyz'
/**
 * How long after the pane opens or its question changes a choice's press is
 * ignored, unless the person moved onto that choice: `1` and then typing on
 * would otherwise answer with whatever letter came next.
 */
const QUIET_MS = 700
const PANE_MAX_COLUMNS = 80
const PANE_SHARE = 0.4
/** The terminal width assumed when no band render has said what it is. */
const TERMINAL_COLUMNS = 80

/** The dock width the pane asks for: 40% of the terminal, at most 80 columns. */
export const paneColumns = (terminalColumns = TERMINAL_COLUMNS) => Math.max(1, Math.min(PANE_MAX_COLUMNS, Math.floor(PANE_SHARE * terminalColumns)))

export type Display = {
  /**
   * Shows `gate` in a focused pane, one question at a time, and resolves with
   * the answers, or null when the person closes it or it cannot be placed.
   * For where the built-in AskUserQuestion dialog cannot be drawn; a second
   * form replaces the first, which resolves null. `terminalColumns` sizes
   * the dock the pane asks for.
   */
  formPane(api: ModApi, gate: FormGate, terminalColumns?: number): Promise<Answer | null>
  /** The open form's question, counted from 0, and how many it has; null with no form open. */
  progress(): { index: number; count: number } | null
}

/** What the person has put on one question so far, kept for Back. */
type Draft = { picked: string[]; note: string; chosen?: string; typed?: string }
type Form = {
  gate: FormGate
  index: number
  answers: Answer
  drafts: Draft[]
  columns: number
  settle(answer: Answer | null): void
  /** The keys the arrows step through, in the order last drawn. */
  stops: string[]
  /** The element the focus ring is on, as the last `ui.focus` landed it. */
  ring: string | null
  /** The element the person put the ring on since the question last changed. */
  moved: string | null
  /** When the current quiet window ends. */
  quietUntil: Promise<number>
}

/** Runs an engine call whose failure (a deny, a site not holding the keys) changes nothing here. */
function quietly(run: () => Promise<unknown>): void {
  try {
    run().catch(() => {})
  } catch {
    // As above: a call the surface cannot take is skipped.
  }
}

const optionValue = (o: GateOption) => (typeof o === 'string' ? o : o.value)
const optionLabel = (o: GateOption) => (typeof o === 'string' ? o : o.label || o.value)
const optionDescription = (o: GateOption) => (typeof o === 'string' ? undefined : o.description)

/**
 * The display kit: draws its pane through the hub's core render and close
 * hooks, so it never lapses with a block. Each kit owns one pane id.
 */
export function createDisplay(hub: Hub, pane: { id: string; title: string } = { id: FORM_PANE_ID, title: 'Gate' }): Display {
  let form: Form | null = null

  function finish(api: ModApi, answer: Answer | null, closing: boolean): void {
    const done = form
    if (!done) return
    form = null
    done.settle(answer)
    if (closing) api.ui.close(pane.id).catch(() => {})
  }

  function answer(api: ModApi, value: Answer[string]): void {
    const open = form
    if (!open) return
    const q = open.gate.questions[open.index]!
    const note = open.drafts[open.index]!.note.trim()
    open.answers[q.id] = note && q.options.length > 0 ? { value: value as string | string[], note } : value
    open.index += 1
    if (open.index >= open.gate.questions.length) finish(api, open.answers, true)
    else turned(api, open)
  }

  function back(api: ModApi): void {
    if (!form || form.index === 0) return
    form.index -= 1
    turned(api, form)
  }

  function hush(api: ModApi, open: Form): void {
    open.moved = null
    try {
      open.quietUntil = api.clock.now().then(
        now => now + QUIET_MS,
        () => 0,
      )
    } catch {
      open.quietUntil = Promise.resolve(0)
    }
  }

  /** Where the ring starts on the question shown: the earlier pick of a single question, else its first choice, or its field. */
  function landing(open: Form): string {
    const q = open.gate.questions[open.index]!
    if (q.options.length === 0) return 'answer'
    const chosen = q.multi ? -1 : q.options.findIndex(o => optionValue(o) === open.drafts[open.index]!.chosen)
    return `option-${Math.max(chosen, 0)}`
  }

  /**
   * After the question changes: drawn from its top, the ring on its landing.
   * The pane holds the keys already, where autoFocus no longer applies, and
   * the engine keeps a window's offset and a ring's slot across a redraw.
   */
  function turned(api: ModApi, open: Form): void {
    api.ui.redraw()
    hush(api, open)
    quietly(() => api.ui.scroll({ in: pane.id, to: 'start' }))
    quietly(() => api.ui.focus(pane.id, landing(open)))
  }

  function header(el: El, open: Form): Node | null {
    const { gate, index } = open
    const count = gate.questions.length
    const name = [kindOf(gate.kind), subjectTail(gate.subject)].filter(Boolean).join(' · ')
    if (!name && count < 2) return null
    const left = name ? text(el, 'inactive', name, { wrap: 'truncate-end' }) : el.Box({})
    if (count < 2) return el.Box({ key: 'header', flexDirection: 'row', children: [left] })
    const dots = gate.questions.map((_, i) =>
      i < index ? text(el, 'success', '●') : i === index ? text(el, 'suggestion', '●') : text(el, 'inactive', '○'),
    )
    return el.Box({
      key: 'header',
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [left, el.Box({ flexDirection: 'row', columnGap: 1, flexShrink: 0, children: [text(el, 'inactive', `question ${index + 1} of ${count}`), el.Box({ flexDirection: 'row', children: dots })] })],
    })
  }

  function choices(api: ModApi, el: El, q: FormQuestion, draft: Draft, width: number): Node[] {
    const findings = questionFindings(q.context)
    const chosen = q.multi ? -1 : q.options.findIndex(o => optionValue(o) === draft.chosen)
    const focusAt = Math.max(chosen, 0)
    return q.options.map((o, i) => {
      const value = optionValue(o)
      const shown = stripRecommended(optionLabel(o))
      const finding = findings.find(f => f.id === value)
      const mark = q.multi ? (draft.picked.includes(value) ? '[x] ' : '[ ] ') : ''
      const button = el.Button({
        key: `option-${i}`,
        label: `${mark}${finding ? stripSeverityTags(shown.label) : shown.label}`,
        plain: true,
        ...(i < CHOICE_KEYS.length && { hotkey: CHOICE_KEYS[i] }),
        ...(i === focusAt && { autoFocus: true as const }),
        onPress: () => {
          if (!q.multi) {
            draft.chosen = value
            return answer(api, value)
          }
          draft.picked = draft.picked.includes(value) ? draft.picked.filter(v => v !== value) : [...draft.picked, value]
          api.ui.redraw()
        },
      })
      const sub = choiceSubtext(el, shown.recommended, finding, optionDescription(o), width - HOTKEY_CELLS)
      if (!q.multi && i === chosen) sub.unshift(text(el, 'suggestion', 'your answer'))
      const under = sub.length > 0 ? [el.Box({ flexDirection: 'column', paddingLeft: HOTKEY_CELLS, children: sub })] : []
      return el.Box({ key: `choice-${i}`, flexDirection: 'column', children: [button, ...under] })
    })
  }

  function draw(api: ModApi, e: Render, open: Form): RenderResult {
    const el = api.ui.elements(e)
    const { gate, index } = open
    const q = gate.questions[index]!
    const draft = open.drafts[index]!
    const multi = q.multi === true
    const asks = q.options.length > 0
    const last = index === gate.questions.length - 1
    const bodyColumns = e.component === 'Pane' ? e.props.bodyColumns : undefined
    const width = typeof bodyColumns === 'number' && bodyColumns > 0 ? bodyColumns : open.columns
    const children: Node[] = []

    const head = header(el, open)
    if (head) children.push(head)
    const context = index === 0 ? gateContext(el, gate.context, width) : null
    if (context) children.push(context)
    const asked = questionContext(el, q.context, width)
    children.push(el.Box({ flexDirection: 'column', children: [text(el, 'text', q.label, { bold: true, wrap: 'wrap' }), ...(asked ? [asked] : [])] }))

    if (asks) {
      children.push(text(el, 'inactive', multi ? 'pick any · a letter ticks or unticks · Next moves on' : 'one choice · a letter answers'))
      children.push(el.Box({ flexDirection: 'column', rowGap: 1, children: choices(api, el, q, draft, width) }))
    }
    const stops = q.options.map((_, i) => `option-${i}`)
    if ('Input' in el) {
      const field = asks
        ? el.Input({
            key: 'note',
            label: 'Note',
            placeholder: multi ? 'optional, posted with your picks' : 'optional, sent with your answer',
            value: draft.note,
            onInput: typed => void (draft.note = typed),
            onSubmit: typed => void (draft.note = typed),
          })
        : el.Input({
            key: 'answer',
            placeholder: 'Type your answer',
            autoFocus: true,
            ...(draft.typed && { value: draft.typed }),
            onSubmit: typed => {
              if (!typed.trim()) return
              draft.typed = typed.trim()
              answer(api, typed.trim())
            },
          })
      children.push(el.Box({ borderStyle: 'round', borderColor: 'subtle', paddingX: 1, children: [field] }))
      if (asks) stops.push('note')
    }

    const actions: Node[] = []
    if (multi && asks) {
      const n = draft.picked.length
      actions.push(
        el.Button({
          key: 'next',
          label: last ? `Done: ${n} picked` : `Next: ${n} picked →`,
          variant: 'primary',
          onPress: () => void (draft.picked.length > 0 && answer(api, [...draft.picked])),
        }),
      )
    }
    if (index > 0) actions.push(el.Button({ key: 'back', label: '← Back', dimColor: true, onPress: () => back(api) }))
    if (actions.length > 0) children.push(el.Box({ flexDirection: 'row', columnGap: 2, children: actions }))
    if (asks) stops.push(...(multi ? ['next'] : []), ...(index > 0 ? ['back'] : []))
    open.stops = stops

    const footer = !asks ? '⏎ sends · esc closes' : multi ? '↑↓ move · ⏎ or letter ticks · Next continues · esc closes' : '↑↓ move · ⏎ or a letter answers · esc closes'
    children.push(text(el, 'inactive', footer))
    return el.Box({ flexDirection: 'column', rowGap: 1, children })
  }

  hub.onRender('Pane', async (api, e, next) => (form && e.requestId === pane.id ? draw(api, e, form) : next(e)))
  hub.onClose(pane.id, api => finish(api, null, false))
  hub.onPane(pane.id, {
    async focus(_api, e, next) {
      const out = await next(e)
      const open = form
      if (open && !out.deny) {
        open.ring = e.element ?? null
        if (e.origin.kind === 'person' && e.element) open.moved = e.element
      }
      return out
    },
    // The engine scrolls an overflowing pane on the arrows; a person's
    // one-row move by key steps the ring through the controls instead, and
    // scrolls past the first and the last.
    async scroll(api, e, next) {
      const open = form
      if (!open || e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) !== 1) return next(e)
      if (open.gate.questions[open.index]!.options.length === 0) return next(e)
      const at = open.ring === null ? -1 : open.stops.indexOf(open.ring)
      const to = at < 0 ? undefined : open.stops[at + e.by]
      if (!to) return next(e)
      // Set before the move lands, so a second arrow steps on from this one.
      open.ring = to
      open.moved = to
      quietly(() => api.ui.focus(pane.id, to))
      quietly(() => api.ui.scroll({ in: pane.id, to: { key: to } }))
      return {}
    },
    // ui.press does not say whether a hotkey, Enter or a click pressed: in the
    // quiet window only a choice the person moved onto is let through.
    async press(api, e, next) {
      const open = form
      if (!open || !e.element.startsWith('option-') || e.element === open.moved) return next(e)
      const until = await open.quietUntil
      let now: number
      try {
        now = await api.clock.now()
      } catch {
        // With no clock to read, the window cannot be judged: the press goes through.
        return next(e)
      }
      if (now >= until) return next(e)
      api.ui.log(`mattstack-mods: ignored ${e.element}, pressed within ${QUIET_MS} ms of its question showing`, { to: 'debug' })
      return { element: e.element }
    },
  })

  return {
    async formPane(api, gate, terminalColumns) {
      if (gate.questions.length === 0) return {}
      finish(api, null, false)
      const columns = paneColumns(terminalColumns)
      const answered = new Promise<Answer | null>(resolve => {
        form = {
          gate,
          index: 0,
          answers: {},
          drafts: gate.questions.map(() => ({ picked: [], note: '' })),
          columns,
          settle: resolve,
          stops: [],
          ring: null,
          moved: null,
          quietUntil: Promise.resolve(0),
        }
      })
      const opening = form!
      try {
        await api.ui.open({ id: pane.id, title: pane.title, focus: true, closeOnEscape: true, columns })
        if (form === opening) hush(api, opening)
      } catch (err) {
        api.ui.log(`mattstack-mods: the gate form pane could not open: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
        finish(api, null, false)
      }
      return answered
    },
    progress: () => (form ? { index: form.index, count: form.gate.questions.length } : null),
  }
}
