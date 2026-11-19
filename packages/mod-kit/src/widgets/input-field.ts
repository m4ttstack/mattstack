import { cellWidth, cutCells, firstGrapheme, tailCells } from '../draw/cells'
import { sp, widthOf, type Span } from '../draw/text'
import { FILL, PLACEHOLDER } from '../draw/theme'

// A filled box `width` cells wide, a cell of padding each side, that scrolls to keep the caret in view. `at` is the
// caret's place in code points (editText's), the end when left out; the caret is the cell it sits on, drawn inverse.
export function inputField(value: string, placeholder: string, width: number, showCursor: boolean, at?: number): Span<never>[] {
  const room = width - 2
  const box = (spans: Span<never>[]): Span<never>[] => [
    sp(' ', FILL.field),
    ...spans.map(span => ({ ...span, bg: FILL.field.bg })),
    sp(' '.repeat(Math.max(0, width - 1 - widthOf(spans))), FILL.field),
  ]
  if (value === '') {
    const hint = cutCells(placeholder, room)
    const head = firstGrapheme(hint)
    return box([sp(head || ' ', showCursor ? { ...PLACEHOLDER, inverse: true } : PLACEHOLDER), sp(hint.slice(head.length), PLACEHOLDER)])
  }
  const chars = Array.from(value)
  const caret = Math.min(Math.max(0, at ?? chars.length), chars.length)
  if (caret === chars.length) {
    const shown = cellWidth(value) >= room ? tailCells(value, room - 1) : value
    return box([sp(shown, { color: FILL.field.color }), ...(showCursor ? [sp(' ', { color: FILL.field.color, inverse: true })] : [])])
  }
  // A caret inside the text: the window starts as late as it must for the caret's cell to fit.
  const look = { color: FILL.field.color }
  let from = 0
  while (from < caret && cellWidth(chars.slice(from, caret + 1).join('')) > room) from++
  const before = chars.slice(from, caret).join('')
  const after = cutCells(chars.slice(caret + 1).join(''), Math.max(0, room - cellWidth(before) - cellWidth(chars[caret]!)))
  return box([sp(before, look), sp(chars[caret]!, showCursor ? { ...look, inverse: true } : look), sp(after, look)])
}
