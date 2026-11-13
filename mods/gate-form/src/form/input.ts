import type { ClientKeyEvent, JsonValue } from 'claude-code'
import { menuHit, menuKey, type MenuHit, type MenuMove } from '@mattstack/mod-kit'

import type { Form } from '../../types'
import { advance, answersOf, canSubmit, clickChoice, confirm, controlAnswers, deleteChar, goTo, isTyping, menuRows, moveCursor, toggleAtCursor, typeChar, type State } from './state'

export type Action =
  | { type: 'page'; page: number }
  | { type: 'hide' }
  | { type: 'scroll-tabs'; from: number }
  | { type: 'advance' }
  | { type: 'option'; idx: number }
  | { type: 'send' }
  | { type: 'chat' }
  | { type: 'menu'; hit: MenuHit }

export type Effect = { state: State; post?: JsonValue }

const disarm = (s: State): State => ({ ...s, chatArmed: undefined })

function post(form: Form, s: State, answers: Record<string, unknown>, control?: string): Effect {
  return { state: { ...s, phase: 'submitted', sent: form.attempt ?? 0, control }, post: { type: 'answer', formId: form.id, answers: answers as JsonValue } }
}

function send(form: Form, s: State): Effect | undefined {
  return canSubmit(form, s) ? post(form, s, answersOf(form, s)) : undefined
}

// The first press arms it; the second sets the form aside. A gate set aside stays open and answerable.
function chat(form: Form, s: State): Effect {
  if (!s.chatArmed) return { state: { ...s, chatArmed: true } }
  const state = form.source === 'gate' ? disarm(s) : { ...disarm(s), phase: 'chat' as const }
  return { state, post: { type: 'chat', formId: form.id, draft: answersOf(form, s) as JsonValue } }
}

function moved(form: Form, s: State, move: MenuMove | undefined): Effect | undefined {
  if (!move) return undefined
  const state = { ...s, menu: move.state }
  const control = move.picked === undefined ? undefined : controlAnswers(move.picked)
  return control ? post(form, state, control.answers, control.label) : { state }
}

export function perform(action: Action, form: Form, armed: State): Effect | undefined {
  // Only the hooks module can close the pane, so hiding asks it to.
  if (action.type === 'hide') return { state: armed, post: { type: 'hide', formId: form.id } }
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
    case 'menu':
      return moved(form, { ...s, navAt: 'more' }, menuHit(s.menu, menuRows(form), action.hit))
  }
}

// Left and right move between Submit and More actions, then left pages back; Enter presses the one selected.
function reviewKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  const rows = menuRows(form)
  if (s.menu.open) return moved(form, s, menuKey(s.menu, rows, ev.key)) ?? { state: s }
  const onMore = s.navAt === 'more' && rows.length > 0
  if (ev.key === 'right' && rows.length > 0) return { state: { ...s, navAt: 'more' } }
  if (ev.key === 'left') return onMore ? { state: { ...s, navAt: 'submit' } } : { state: goTo(form, s, s.page - 1) }
  if (ev.key !== 'return' && ev.key !== 'enter') return undefined
  return onMore ? moved(form, s, menuKey(s.menu, rows, ev.key)) : send(form, s)
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
  // Tab forward is Next (it takes a chosen cursor as the answer); shift+Tab only looks back.
  if (ev.key === 'tab') return { state: ev.shift ? goTo(form, s, s.page - 1) : advance(form, s) }
  return s.page === form.questions.length ? reviewKey(ev, form, s) : questionKey(ev, form, s)
}
