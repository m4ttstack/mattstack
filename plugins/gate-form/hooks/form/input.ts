import type { ClientKeyEvent, JsonValue } from 'claude-code'

import type { Form } from '../../types'
import { advance, answersOf, clickChoice, confirm, deleteChar, goTo, isTyping, moveCursor, toggleAtCursor, typeChar, type State } from './state'

export type Action = { type: 'page'; page: number } | { type: 'scroll-tabs'; from: number } | { type: 'advance' } | { type: 'option'; idx: number } | { type: 'send' } | { type: 'chat' }

export type Effect = { state: State; post?: JsonValue }

const disarm = (s: State): State => ({ ...s, chatArmed: undefined })

function send(form: Form, s: State): Effect {
  return { state: { ...s, phase: 'submitted' }, post: { type: 'answer', formId: form.id, answers: answersOf(form, s) as JsonValue } }
}

// The first press arms it; the second sets the form aside.
function chat(form: Form, s: State): Effect {
  if (!s.chatArmed) return { state: { ...s, chatArmed: true } }
  return { state: { ...disarm(s), phase: 'chat' }, post: { type: 'chat', formId: form.id, draft: answersOf(form, s) as JsonValue } }
}

export function perform(action: Action, form: Form, armed: State): Effect | undefined {
  if (armed.phase !== 'active') return undefined
  if (action.type === 'chat') return chat(form, armed)
  const s = disarm(armed)
  switch (action.type) {
    case 'scroll-tabs':
      return { state: { ...s, tabsFrom: action.from } }
    case 'page':
      return { state: goTo(form, s, action.page) }
    case 'advance':
      return { state: advance(form, s) }
    case 'option':
      return { state: clickChoice(form, s, action.idx) }
    case 'send':
      return send(form, s)
  }
}

function reviewKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  if (ev.key === 'left') return { state: goTo(form, s, s.page - 1) }
  if (ev.key === 'return' || ev.key === 'enter') return send(form, s)
  return undefined
}

function questionKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  const { key } = ev
  const isSpace = key === ' ' || key === 'space'
  const typing = isTyping(form, s)
  if (key === 'return' || key === 'enter') return { state: confirm(form, s) }
  if (key === 'left' || key === 'right') return { state: goTo(form, s, s.page + (key === 'left' ? -1 : 1)) }
  if (key === 'up' || key === 'down') return { state: moveCursor(form, s, key === 'up' ? -1 : 1) }
  if (isSpace && form.questions[s.page]?.multi && !typing) return { state: toggleAtCursor(form, s) }
  if (!typing) return undefined
  if (key === 'backspace' || key === 'delete') return { state: deleteChar(s) }
  const ch = isSpace ? ' ' : key
  if (ch.length === 1 && !ev.ctrl && !ev.meta) return { state: typeChar(s, ch) }
  return undefined
}

export function keyEffect(ev: ClientKeyEvent, form: Form, armed: State): Effect | undefined {
  if (armed.phase !== 'active') return undefined
  if (ev.ctrl && (ev.key === 'x' || ev.key === 'c')) return chat(form, armed)
  const s = disarm(armed)
  if (ev.key === 'tab') return { state: goTo(form, s, s.page + (ev.shift ? -1 : 1)) }
  return s.page === form.questions.length ? reviewKey(ev, form, s) : questionKey(ev, form, s)
}
