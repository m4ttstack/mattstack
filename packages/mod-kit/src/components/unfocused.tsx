import type { Span } from '../draw/text'
import { muted } from '../draw/theme'
import { kitComponent, type KitLine } from './core'

// Its children laid out as on an unfocused surface, in the muted shades, with no actions or labels left for the pointer to light or press,
// so an unfocused variant can sit in the same Panel as live controls.
export const Unfocused = kitComponent('Unfocused', (props: { children?: unknown }, ctx) =>
  ctx.layout(props.children, { focused: false }).map((line): KitLine => line.map(({ action, isLabel, ...span }): Span<string> => muted(span))),
)
