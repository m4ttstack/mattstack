import { cellWidth, cutCells, firstGrapheme, tailCells } from '../draw/cells'
import { sp, widthOf, type Span } from '../draw/text'
import { FILL, PLACEHOLDER } from '../draw/theme'

// A filled box `width` cells wide, a cell of padding each side, that scrolls to keep the end of the text in view.
export function inputField(value: string, placeholder: string, width: number, showCursor: boolean): Span<never>[] {
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
  const shown = cellWidth(value) >= room ? tailCells(value, room - 1) : value
  return box([sp(shown, { color: FILL.field.color }), ...(showCursor ? [sp(' ', { color: FILL.field.color, inverse: true })] : [])])
}
