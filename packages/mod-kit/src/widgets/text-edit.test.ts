import { describe, expect, test } from 'bun:test'

import { caretRow, editText, wrapKeeping } from './text-edit'

const at = (text: string) => ({ text: text.replace('|', ''), at: text.indexOf('|') })
const show = (edit: { text: string; at: number } | undefined) => (edit ? `${edit.text.slice(0, edit.at)}|${edit.text.slice(edit.at)}` : 'none')

describe('editText', () => {
  test('characters and space insert at the caret', () => {
    expect(show(editText(at('ab|cd'), { key: 'x' }))).toBe('abx|cd')
    expect(show(editText(at('ab|'), { key: 'space' }))).toBe('ab |')
  })

  test('backspace deletes a character, option a word, cmd (ctrl+u) to the start, ctrl+w a word', () => {
    expect(show(editText(at('use the other|'), { key: 'backspace' }))).toBe('use the othe|')
    expect(show(editText(at('use the other|'), { key: 'backspace', meta: true }))).toBe('use the |')
    expect(show(editText(at('use the  |'), { key: 'backspace', meta: true }))).toBe('use |')
    expect(show(editText(at('use the|other'), { key: 'u', ctrl: true }))).toBe('|other')
    expect(show(editText(at('use the|'), { key: 'w', ctrl: true }))).toBe('use |')
  })

  test('delete removes forward: a character, option a word, ctrl+k to the end', () => {
    expect(show(editText(at('a|bc'), { key: 'delete' }))).toBe('a|c')
    expect(show(editText(at('use| the other'), { key: 'delete', meta: true }))).toBe('use| other')
    expect(show(editText(at('use |the other'), { key: 'k', ctrl: true }))).toBe('use |')
  })

  test('arrows move a character, option a word, cmd (home, end, ctrl+a, ctrl+e) to an end', () => {
    expect(show(editText(at('ab|c'), { key: 'left' }))).toBe('a|bc')
    expect(show(editText(at('use the oth|er'), { key: 'left', meta: true }))).toBe('use the |other')
    expect(show(editText(at('use| the other'), { key: 'right', meta: true }))).toBe('use the| other')
    expect(show(editText(at('use| the'), { key: 'b', meta: true }))).toBe('|use the')
    expect(show(editText(at('use| the'), { key: 'home' }))).toBe('|use the')
    expect(show(editText(at('use| the'), { key: 'e', ctrl: true }))).toBe('use the|')
  })

  test('keys that are not edits come back undefined for the caller to use', () => {
    for (const key of ['return', 'escape', 'up', 'tab']) expect(editText(at('a|'), { key })).toBeUndefined()
    expect(editText(at('a|'), { key: 'x', ctrl: true })).toBeUndefined()
  })
})

describe('wrapKeeping and caretRow', () => {
  test('rows keep every character, so a caret maps onto a row and column', () => {
    const rows = wrapKeeping('use the other account please', 10)
    expect(rows.join('')).toBe('use the other account please')
    expect(rows.every(r => r.trimEnd().length <= 10)).toBe(true)
    expect(caretRow(rows, 0)).toEqual({ row: 0, col: 0 })
    expect(caretRow(rows, 28)).toEqual({ row: rows.length - 1, col: Array.from(rows.at(-1)!).length })
  })

  test('a word wider than a row is cut across rows', () => {
    expect(wrapKeeping('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})
