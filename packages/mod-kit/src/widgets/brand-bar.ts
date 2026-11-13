import { sp, type Line } from '../draw/text'
import { BRAND, ICON } from '../draw/theme'

// The text cut to `room` cells with an ellipsis, or padded out to it.
const fit = (text: string, room: number) => (text.length <= room ? text.padEnd(room) : `${text.slice(0, Math.max(0, room - 1))}…`)

// The mattstack header every kit surface opens with: a full-width pink bar, plum lettering,
// and a hide button at its right end when the surface can be put away.
export function brandBar<A = never>(label: string, width: number, hide?: A): Line<A> {
  const look = { bg: BRAND.pink, color: BRAND.plum, bold: true }
  const text = `  ${BRAND.glyph}  ${label}`
  if (hide === undefined) return [sp(fit(text, width), look)]
  const button = ` ${ICON.minimize} Hide `
  return [sp(fit(text, width - button.length - 1), look), sp(button, { bg: BRAND.pinkDeep, color: BRAND.plum, action: hide }), sp(' ', look)]
}
