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
    const hint = placeholder.slice(0, room)
    return box([sp(hint.slice(0, 1) || ' ', showCursor ? { ...PLACEHOLDER, inverse: true } : PLACEHOLDER), sp(hint.slice(1), PLACEHOLDER)])
  }
  const shown = value.length >= room ? value.slice(value.length - room + 1) : value
  return box([sp(shown, { color: FILL.field.color }), ...(showCursor ? [sp(' ', { color: FILL.field.color, inverse: true })] : [])])
}
