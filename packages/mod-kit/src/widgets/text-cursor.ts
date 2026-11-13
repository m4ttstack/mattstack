import { sp, type Span } from '../draw/text'
import { DIM } from '../draw/theme'

export function textCursor(value: string, placeholder: string, showCursor: boolean): Span<never>[] {
  if (!showCursor) return value === '' ? [sp(placeholder, DIM)] : [sp(value)]
  if (value === '') return [sp(placeholder.slice(0, 1), { inverse: true }), sp(placeholder.slice(1), DIM)]
  return [sp(value), sp(' ', { inverse: true })]
}
