import { sp, type Line } from '../draw/text'
import { SCROLL } from '../draw/theme'

// One line per window row: a blank, the track or thumb cell, a blank. A list that fits gets blank lines, so rows keep their width.
export function scrollBar<A = never>(rows: number, total: number, offset: number): Line<A>[] {
  if (total <= rows) return Array.from({ length: rows }, () => [sp('   ')])
  const size = Math.max(1, Math.round((rows * rows) / total))
  const at = Math.min(Math.max(0, offset), total - rows)
  const top = Math.round((at / (total - rows)) * (rows - size))
  return Array.from({ length: rows }, (_, n) => [sp(' '), sp(' ', { bg: n >= top && n < top + size ? SCROLL.thumb : SCROLL.track }), sp(' ')])
}
