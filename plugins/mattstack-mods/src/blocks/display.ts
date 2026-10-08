import type { EngineEventOf, EngineResultOf } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { GateOption } from './gate-form.ts'
import { choiceSubtext, gateContext, kindOf, questionContext, questionFindings, stripRecommended, subjectTail, text, type El, type Node } from './gate-view.ts'

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

/** Choice hotkeys in order: `s` is Skip's, and digits are never used, since a repeat of the band's `1` would land on one. */
const CHOICE_KEYS = 'abcdefghijklmnopqrtuvwxyz'
/** Cells a plain Button draws ahead of its label: the hotkey and a colon. */
const HOTKEY_CELLS = 3
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
type Form = { gate: FormGate; index: number; answers: Answer; drafts: Draft[]; columns: number; settle(answer: Answer | null): void }

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
    else api.ui.redraw()
  }

  function back(api: ModApi): void {
    if (!form || form.index === 0) return
    form.index -= 1
    api.ui.redraw()
  }

  function header(el: El, open: Form): Node | null {
    const { gate, index } = open
    const count = gate.questions.length
    const name = [kindOf(gate.kind), subjectTail(gate.subject)].filter(Boolean).join(' · ')
    if (!name && count < 2) return null
    const left = name ? text(el, 'subtle', name, { wrap: 'truncate-end' }) : el.Box({})
    if (count < 2) return el.Box({ key: 'header', flexDirection: 'row', children: [left] })
    const dots = gate.questions.map((_, i) =>
      i < index ? text(el, 'success', '●') : i === index ? text(el, 'suggestion', '●') : text(el, 'subtle', '○'),
    )
    return el.Box({
      key: 'header',
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [left, el.Box({ flexDirection: 'row', columnGap: 1, flexShrink: 0, children: [text(el, 'subtle', `question ${index + 1} of ${count}`), el.Box({ flexDirection: 'row', children: dots })] })],
    })
  }

  function choices(api: ModApi, el: El, open: Form, q: FormQuestion, draft: Draft): Node[] {
    const findings = questionFindings(q.context)
    const chosen = q.multi ? -1 : q.options.findIndex(o => optionValue(o) === draft.chosen)
    const focusAt = Math.max(chosen, 0)
    return q.options.map((o, i) => {
      const value = optionValue(o)
      const shown = stripRecommended(optionLabel(o))
      const mark = q.multi ? (draft.picked.includes(value) ? '[x] ' : '[ ] ') : ''
      const button = el.Button({
        key: `option-${i}`,
        label: `${mark}${shown.label}`,
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
      const sub = choiceSubtext(el, shown.recommended, findings.find(f => f.id === value), optionDescription(o))
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
      children.push(text(el, 'subtle', multi ? 'pick any · a letter ticks or unticks · Next moves on' : 'one choice · a letter answers'))
      children.push(el.Box({ flexDirection: 'column', rowGap: 1, children: choices(api, el, open, q, draft) }))
    }
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
    actions.push(el.Button({ key: 'skip', label: 'Skip', plain: true, hotkey: 's', role: 'dismiss', onPress: () => finish(api, null, true) }))
    children.push(el.Box({ flexDirection: 'row', columnGap: 2, children: actions }))

    const footer = !asks ? '⏎ sends · esc back' : multi ? '↑↓ move · letter ticks · ⏎ on Next continues · esc back' : '↑↓ move · ⏎ or a letter answers · esc back'
    children.push(text(el, 'subtle', footer))
    return el.Box({ flexDirection: 'column', rowGap: 1, children })
  }

  hub.onRender('Pane', async (api, e, next) => (form && e.requestId === pane.id ? draw(api, e, form) : next(e)))
  hub.onClose(pane.id, api => finish(api, null, false))

  return {
    async formPane(api, gate, terminalColumns) {
      if (gate.questions.length === 0) return {}
      finish(api, null, false)
      const columns = paneColumns(terminalColumns)
      const answered = new Promise<Answer | null>(resolve => {
        form = { gate, index: 0, answers: {}, drafts: gate.questions.map(() => ({ picked: [], note: '' })), columns, settle: resolve }
      })
      try {
        await api.ui.open({ id: pane.id, title: pane.title, focus: true, closeOnEscape: true, columns })
      } catch (err) {
        api.ui.log(`mattstack-mods: the gate form pane could not open: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
        finish(api, null, false)
      }
      return answered
    },
    progress: () => (form ? { index: form.index, count: form.gate.questions.length } : null),
  }
}
