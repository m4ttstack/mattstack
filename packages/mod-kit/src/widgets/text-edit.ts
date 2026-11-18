import type { ClientKeyEvent } from 'claude-code'

// A one-line text being edited: the text, and the caret's place in it as a count of code points from the start.
export type TextEdit = { text: string; at: number }

type Key = Pick<ClientKeyEvent, 'key' | 'ctrl' | 'meta'>

// Names the engine gives special keys; any other key is a character to insert.
const NAMED = new Set(['up', 'down', 'left', 'right', 'return', 'enter', 'tab', 'backspace', 'delete', 'escape', 'pageup', 'pagedown', 'home', 'end', 'insert'])

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch)

// Where a word move lands: back over spaces then over the word before them, or forward over the word then the spaces.
function wordBack(chars: string[], at: number): number {
  let i = at
  while (i > 0 && isSpace(chars[i - 1])) i--
  while (i > 0 && !isSpace(chars[i - 1])) i--
  return i
}
function wordForward(chars: string[], at: number): number {
  let i = at
  while (i < chars.length && isSpace(chars[i])) i++
  while (i < chars.length && !isSpace(chars[i])) i++
  return i
}

// The macOS text motions as terminals send them: option sends meta, and cmd+delete, cmd+← and cmd+→ arrive as ctrl+u,
// home (or ctrl+a) and end (or ctrl+e). Returns undefined for a key that is not an edit, so the caller can use it.
// - characters insert at the caret; space arrives as ' ' or 'space'
// - backspace deletes back a character; option+backspace or ctrl+w a word; cmd+backspace (ctrl+u) to the start
// - delete deletes forward a character; option+delete a word; ctrl+k to the end
// - ← → move a character; option+← → (or option+b / option+f) a word; cmd+← → (home, end, ctrl+a, ctrl+e) to an end
export function editText(edit: TextEdit, ev: Key): TextEdit | undefined {
  const chars = Array.from(edit.text)
  const at = Math.min(Math.max(0, edit.at), chars.length)
  const cut = (from: number, to: number): TextEdit => ({ text: [...chars.slice(0, from), ...chars.slice(to)].join(''), at: from })
  const move = (to: number): TextEdit => ({ text: edit.text, at: to })
  const { key } = ev
  if (key === 'backspace') {
    if (ev.meta) return cut(wordBack(chars, at), at)
    return at === 0 ? move(0) : cut(at - 1, at)
  }
  if (key === 'delete') {
    if (ev.meta) return cut(at, wordForward(chars, at))
    return cut(at, Math.min(chars.length, at + 1))
  }
  if (ev.ctrl && key === 'w') return cut(wordBack(chars, at), at)
  if (ev.ctrl && key === 'u') return cut(0, at)
  if (ev.ctrl && key === 'k') return cut(at, chars.length)
  if ((ev.ctrl && key === 'a') || key === 'home') return move(0)
  if ((ev.ctrl && key === 'e') || key === 'end') return move(chars.length)
  if (key === 'left') return move(ev.meta ? wordBack(chars, at) : Math.max(0, at - 1))
  if (key === 'right') return move(ev.meta ? wordForward(chars, at) : Math.min(chars.length, at + 1))
  if (ev.meta && key === 'b') return move(wordBack(chars, at))
  if (ev.meta && key === 'f') return move(wordForward(chars, at))
  if (ev.ctrl || ev.meta) return undefined
  const ch = key === 'space' ? ' ' : key
  if (NAMED.has(ch) || ch === '') return undefined
  const typed = Array.from(ch)
  return { text: [...chars.slice(0, at), ...typed, ...chars.slice(at)].join(''), at: at + typed.length }
}

// The text split into rows of at most `width` cells at word breaks, every character kept (a row keeps the spaces that
// end it), so a caret's place maps onto a row and column. A word wider than a row is cut.
export function wrapKeeping(text: string, width: number): string[] {
  const room = Math.max(1, width)
  const rows: string[] = []
  let row: string[] = []
  for (const piece of text.match(/\S+|\s+/g) ?? ['']) {
    const chars = Array.from(piece)
    if (/^\s+$/.test(piece) || row.length + chars.length <= room) {
      row.push(...chars)
      continue
    }
    if (row.length > 0) rows.push(row.join(''))
    row = []
    for (let i = 0; i < chars.length; i += room) {
      const chunk = chars.slice(i, i + room)
      if (chunk.length === room && i + room < chars.length) rows.push(chunk.join(''))
      else row = chunk
    }
  }
  rows.push(row.join(''))
  return rows
}

// The row and column a caret at `at` sits on in wrapKeeping's rows; a caret at a row's end sits on that row.
export function caretRow(rows: string[], at: number): { row: number; col: number } {
  let left = at
  for (let r = 0; r < rows.length; r++) {
    const len = Array.from(rows[r]!).length
    if (left <= len && (left < len || r === rows.length - 1)) return { row: r, col: left }
    left -= len
  }
  const last = rows.length - 1
  return { row: last, col: Array.from(rows[last] ?? '').length }
}
