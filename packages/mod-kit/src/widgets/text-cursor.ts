import { firstGrapheme } from '../draw/cells'
import { sp, type Span } from '../draw/text'
import { DIM } from '../draw/theme'

export function textCursor(value: string, placeholder: string, showCursor: boolean): Span<never>[] {
  if (!showCursor) return value === '' ? [sp(placeholder, DIM)] : [sp(value)]
  if (value === '') {
    const head = firstGrapheme(placeholder)
    return [sp(head, { inverse: true }), sp(placeholder.slice(head.length), DIM)]
  }
  return [sp(value), sp(' ', { inverse: true })]
}
