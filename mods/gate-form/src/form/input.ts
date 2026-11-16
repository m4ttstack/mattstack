import type { ClientKeyEvent, JsonValue } from 'claude-code'
import { gridMove, menuHit, menuKey, type GridRow, type GridSpot, type MenuHit, type MenuMove } from '@mattstack/mod-kit'

import type { Form } from '../../types'
import { advance, answersOf, canChat, canSubmit, chosenValue, choicesOf, clickChoice, confirm, controlAnswers, deleteChar, goTo, isConfirm, isOnNav, isReview, isSinglePage, isTyping, menuRows, moveCursor, navAtOf, navIds, toggleAtCursor, typeChar, type NavId, type State } from './state'

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
  if (!canSubmit(form, s)) return undefined
  if (!isSinglePage(form)) return post(form, s, answersOf(form, s))
  return post(form, s, { [form.questions[0]!.id]: chosenValue(form, s) })
}

// The first press arms it; the second sets the form aside. A gate set aside stays open and answerable.
function chat(form: Form, s: State): Effect | undefined {
  if (!canChat(form)) return undefined
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

// A new page starts with the keyboard on its answers and the nav row back on its forward button.
function settled(before: State, effect: Effect | undefined): Effect | undefined {
  if (!effect || effect.state.page === before.page) return effect
  return { ...effect, state: { ...effect.state, onNav: undefined, navAt: 'next', pageTop: undefined, followed: undefined } }
}

export function perform(action: Action, form: Form, armed: State): Effect | undefined {
  return settled(armed, performOn(action, form, armed))
}

function performOn(action: Action, form: Form, armed: State): Effect | undefined {
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
    case 'option': {
      return { state: clickChoice(form, s, action.idx) }
    }
    case 'send':
      return send(form, s)
    case 'menu':
      return moved(form, { ...s, navAt: 'more' }, menuHit(s.menu, menuRows(form), action.hit))
  }
}

// The page as a button grid: a row per choice (or the one text field), then the nav row.
function gridOf(form: Form, s: State): GridRow<string>[] {
  const q = form.questions[s.page]
  const choices = q ? choicesOf(q) : []
  const above: GridRow<string>[] = !q ? [] : choices.length === 0 ? [{ key: 'text', ids: ['text'], main: 0 }] : choices.map((_, i) => ({ key: `choice-${i}`, ids: ['choice'], main: 0 }))
  if (isSinglePage(form)) return above
  const ids = navIds(form, s)
  return [...above, { key: 'nav', ids, main: Math.max(0, ids.indexOf('next')) }]
}

function spotOf(form: Form, s: State, rows: GridRow<string>[]): GridSpot {
  const nav = rows.length - 1
  if (isOnNav(form, s)) return { at: nav, col: rows[nav]!.ids.indexOf(navAtOf(form, s)) }
  const q = form.questions[s.page]
  return { at: q && choicesOf(q).length > 0 ? s.cursor[s.page]! : 0, col: 0 }
}

// Up and down move through the choices and on to the nav row, left and right along the nav row; back up lands on the cursor.
function gridKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  const rows = gridOf(form, s)
  const here = spotOf(form, s, rows)
  const move = gridMove(rows, here, ev)
  if (!move.handled) return undefined
  if (!move.to) return { state: s }
  const nav = isSinglePage(form) ? -1 : rows.length - 1
  if (move.to.at === nav) return { state: { ...s, onNav: true, navAt: rows[nav]!.ids[move.to.col] as NavId } }
  if (here.at === nav) return { state: { ...s, onNav: undefined } }
  return { state: moveCursor(form, s, move.to.at - here.at) }
}

// Enter on the nav row presses the button the keyboard is on, as a click would.
function pressNav(ev: ClientKeyEvent, form: Form, armed: State, s: State): Effect | undefined {
  switch (navAtOf(form, s)) {
    case 'back':
      return { state: goTo(form, s, s.page - 1) }
    case 'next':
      return isReview(form, s) ? send(form, s) : { state: advance(form, s) }
    case 'more':
      return moved(form, { ...s, navAt: 'more' }, menuKey(s.menu, menuRows(form), ev.key))
    case 'chat':
      return chat(form, armed)
  }
}

const isEnter = (ev: ClientKeyEvent) => ev.key === 'return' || ev.key === 'enter'

// Enter on something it activates (an enabled nav button, a More actions row, a choice) shows the press before
// the key acts, as a click would.
export function pressesButton(ev: ClientKeyEvent, form: Form, s: State): boolean {
  if (s.phase !== 'active') return false
  if (isConfirm(form)) return false
  if (!isEnter(ev)) return false
  if (s.menu.open) return true
  if (isSinglePage(form)) return canSubmit(form, s)
  if (!isOnNav(form, s)) {
    const q = form.questions[s.page]
    return q !== undefined && choicesOf(q).length > 0
  }
  return !(navAtOf(form, s) === 'next' && isReview(form, s) && !canSubmit(form, s))
}

// On the review page ←→ still change page (→ has none to go to), so Tab moves between its buttons.
function reviewKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  if (ev.key === 'left') return { state: goTo(form, s, s.page - 1) }
  if (ev.key === 'right') return { state: s }
  if (ev.key !== 'tab') return undefined
  const ids = navIds(form, s)
  const at = ids.indexOf(navAtOf(form, s))
  return { state: { ...s, navAt: ids[(at + (ev.shift ? -1 : 1) + ids.length) % ids.length]! } }
}

function navKey(ev: ClientKeyEvent, form: Form, armed: State, s: State): Effect | undefined {
  if (s.menu.open) return moved(form, s, menuKey(s.menu, menuRows(form), ev.key)) ?? { state: s }
  if (isEnter(ev)) return pressNav(ev, form, armed, s)
  return (isReview(form, s) ? reviewKey(ev, form, s) : undefined) ?? gridKey(ev, form, s)
}

function questionKey(ev: ClientKeyEvent, form: Form, s: State): Effect | undefined {
  const { key } = ev
  const isSpace = key === ' ' || key === 'space'
  const typing = isTyping(form, s)
  if (isEnter(ev)) return isSinglePage(form) ? (send(form, s) ?? { state: s }) : { state: confirm(form, s) }
  if (key === 'left' || key === 'right') return { state: goTo(form, s, s.page + (key === 'left' ? -1 : 1)) }
  if (key === 'up' || key === 'down') return gridKey(ev, form, s)
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
  // A confirm's answers are the engine's Buttons, drawn by the hooks module, which take the keys themselves.
  if (isConfirm(form)) return undefined
  // Tab forward is Next (it takes a chosen cursor as the answer); shift+Tab only looks back.
  if (ev.key === 'tab' && isSinglePage(form)) return { state: s }
  if (ev.key === 'tab' && !isReview(form, s)) return settled(s, { state: ev.shift ? goTo(form, s, s.page - 1) : advance(form, s) })
  return settled(s, isOnNav(form, s) ? navKey(ev, form, armed, s) : questionKey(ev, form, s))
}
