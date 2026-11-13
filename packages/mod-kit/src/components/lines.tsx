import type { RenderElement } from 'claude-code'

import { sp, type Line, type Span as TextSpan, type Style } from '../draw/text'
import { buttonSpan } from '../widgets/buttons'
import { Button, buttonOf } from './buttons'
import { kitComponent, textOf, type KitCtx, type KitLine } from './core'

export type LinesProps<A> = { lines: Line<A>[]; onAction?: (action: A) => void }

// Equal actions get one key, so a choice's rows still light together and a span keeps a key of its own per row.
function keyed<A>(lines: Line<A>[], key: (action: A) => string): KitLine[] {
  return lines.map(line => {
    const out: KitLine = line.map(({ action, ...span }) => (action === undefined ? span : { ...span, action: key(action) }))
    if (line.action !== undefined) out.action = key(line.action)
    return out
  })
}

// Lines a mod already builds, drawn as they are; a click on one of their actions reaches onAction with it.
export const Lines = kitComponent('Lines', (props: LinesProps<unknown>, ctx) =>
  keyed(props.lines, action => ctx.bind(JSON.stringify(action), () => props.onAction?.(action))),
) as unknown as { <A>(props: LinesProps<A>): RenderElement; toLines: (props: LinesProps<unknown>, ctx: KitCtx) => KitLine[] }

export type SpanProps = Style & { children?: unknown }

// Styled text inside a Row.
export const Span = kitComponent('Span', ({ children, ...style }: SpanProps) => [[sp(textOf(children), style)]])
export type Span<A> = TextSpan<A>

// One line of its children side by side: text, Spans, Buttons (filled, no indent), or the first line of any other kit component.
export const Row = kitComponent('Row', (props: { children?: unknown }, ctx) => [
  ctx.parts(props.children).flatMap(part => {
    if ('text' in part) return [sp(part.text)]
    if (part.component === Button) return [buttonSpan(buttonOf(part.props, part.ctx))]
    return part.component.toLines(part.props, part.ctx)[0] ?? []
  }),
])
