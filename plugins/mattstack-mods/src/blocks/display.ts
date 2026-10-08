import type { EngineEventOf, EngineResultOf } from 'claude-code'
import type { Hub, ModApi } from '../core/hub.ts'
import type { GateOption } from './gate-form.ts'

type Render = EngineEventOf['ui.render']
type RenderResult = EngineResultOf['ui.render']

export type FormQuestion = { id: string; label: string; multi?: boolean; options: GateOption[] }
export type FormGate = { id: string; questions: FormQuestion[] }
/**
 * Keyed by question id, in the shape rt's gate:answer takes: an option value
 * (several for a multi question), `{ value, note }` when a note was typed,
 * or the typed text for a question with no options.
 */
export type Answer = Record<string, string | string[] | { value: string | string[]; note: string }>

export const FORM_PANE_ID = 'mattstack-gate-form'

export type Display = {
  /**
   * Shows `gate` in a focused pane, one question at a time, and resolves with
   * the answers, or null when the person closes it or it cannot be placed.
   * For where the built-in AskUserQuestion dialog cannot be drawn; a second
   * form replaces the first, which resolves null.
   */
  formPane(api: ModApi, gate: FormGate): Promise<Answer | null>
}

type Form = { gate: FormGate; index: number; answers: Answer; picked: string[]; note: string; settle(answer: Answer | null): void }

const optionValue = (o: GateOption) => (typeof o === 'string' ? o : o.value)
const optionLabel = (o: GateOption) => (typeof o === 'string' ? o : o.label || o.value)

/**
 * The display kit: draws its pane through the hub's core render and close
 * hooks, so it never lapses with a block. Each kit owns one pane id.
 */
export function createDisplay(
  hub: Hub,
  pane: {
    id: string
    title: string
    /** Off, options are picked with the arrows and Enter or a click: a focused pane's live hotkeys answer a stray key. */
    hotkeys?: boolean
  } = { id: FORM_PANE_ID, title: 'Gate' },
): Display {
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
    const note = open.note.trim()
    open.answers[q.id] = note && q.options.length > 0 ? { value: value as string | string[], note } : value
    open.index += 1
    open.picked = []
    open.note = ''
    if (open.index >= open.gate.questions.length) finish(api, open.answers, true)
    else api.ui.redraw()
  }

  function draw(api: ModApi, e: Render, open: Form): RenderResult {
    const el = api.ui.elements(e)
    const q = open.gate.questions[open.index]!
    const count = open.gate.questions.length
    const children: RenderResult[] = [el.Text({ children: [count > 1 ? `${q.label} (${open.index + 1} of ${count})` : q.label] })]
    q.options.forEach((o, i) => {
      const value = optionValue(o)
      const mark = q.multi ? (open.picked.includes(value) ? '[x] ' : '[ ] ') : ''
      children.push(
        el.Button({
          key: `option-${i}`,
          label: `${mark}${optionLabel(o)}`,
          ...(pane.hotkeys !== false && i < 9 && { hotkey: String(i + 1) }),
          onPress: () => {
            if (!q.multi) return answer(api, value)
            open.picked = open.picked.includes(value) ? open.picked.filter(v => v !== value) : [...open.picked, value]
            api.ui.redraw()
          },
        }),
      )
    })
    if (q.multi) {
      children.push(el.Button({ key: 'done', label: 'Done', variant: 'primary', onPress: () => open.picked.length > 0 && answer(api, [...open.picked]) }))
    }
    if ('Input' in el) {
      children.push(
        q.options.length > 0
          ? el.Input({ key: 'note', placeholder: 'Add a note, then pick an option', onInput: text => void (open.note = text), onSubmit: text => void (open.note = text) })
          : el.Input({ key: 'answer', placeholder: 'Type your answer', autoFocus: true, onSubmit: text => text.trim() && answer(api, text.trim()) }),
      )
    }
    children.push(el.Button({ key: 'skip', label: 'Skip', role: 'dismiss', onPress: () => finish(api, null, true) }))
    return el.Box({ flexDirection: 'column', children })
  }

  hub.onRender('Pane', async (api, e, next) => (form && e.requestId === pane.id ? draw(api, e, form) : next(e)))
  hub.onClose(pane.id, api => finish(api, null, false))

  return {
    async formPane(api, gate) {
      if (gate.questions.length === 0) return {}
      finish(api, null, false)
      const answered = new Promise<Answer | null>(resolve => {
        form = { gate, index: 0, answers: {}, picked: [], note: '', settle: resolve }
      })
      try {
        await api.ui.open({ id: pane.id, title: pane.title, focus: true, closeOnEscape: true })
      } catch (err) {
        api.ui.log(`mattstack-mods: the gate form pane could not open: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
        finish(api, null, false)
      }
      return answered
    },
  }
}
