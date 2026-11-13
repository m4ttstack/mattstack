import { hang, sp } from '../draw/text'
import { DIM, GRAY, SYMBOL, rail } from '../draw/theme'
import { kitComponent, textOf } from './core'

export type RailProps = { color?: string; dim?: boolean; bold?: boolean; children?: unknown }

// Clack's vertical rail: the bar alone, or text hung beside it, wrapped to the Panel's width with the rail unbroken.
export const Rail = kitComponent('Rail', (props: RailProps, ctx) => {
  const bar = { color: props.color ?? GRAY.color }
  const text = textOf(props.children)
  if (text === '') return [[sp(SYMBOL.bar, bar)]]
  return hang(rail(bar), rail(bar), text, ctx.width, { ...(props.dim && DIM), ...(props.bold && { bold: true }) })
})
