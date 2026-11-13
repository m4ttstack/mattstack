import { sp, type Line } from '../draw/text'
import { BRAND, ICON } from '../draw/theme'

// The mattstack header every kit surface opens with: a full-width pink bar, plum lettering,
// and a hide button at its right end when the surface can be put away.
export function brandBar<A = never>(label: string, width: number, hide?: A): Line<A> {
  const look = { bg: BRAND.pink, color: BRAND.plum, bold: true }
  const text = `  ${BRAND.glyph}  ${label}`
  if (hide === undefined) return [sp(text.padEnd(width), look)]
  const button = ` ${ICON.minimize} Hide `
  return [sp(text.padEnd(width - button.length - 1), look), sp(button, { bg: BRAND.pinkDeep, color: BRAND.plum, action: hide }), sp(' ', look)]
}
