import { buttonRow, type Button as ButtonSpec, type ButtonTone } from '../widgets/buttons'
import { kitComponent, textOf, type KitCtx } from './core'

export type ButtonProps = { tone?: ButtonTone; disabled?: boolean; onPress?: () => void; label?: string; children?: unknown }

export function buttonOf(props: ButtonProps, ctx: KitCtx): ButtonSpec<string> {
  return { label: props.label ?? textOf(props.children), tone: props.tone, disabled: props.disabled, action: ctx.bind('press', () => props.onPress?.()) }
}

// The label is the text child. Alone in a Panel it sits on a row of its own; in a ButtonRow or Row it takes its place there.
export const Button = kitComponent('Button', (props: ButtonProps, ctx) => [buttonRow([buttonOf(props, ctx)], undefined, ctx.width)])
export type Button<A> = ButtonSpec<A>

export type ButtonRowProps = { right?: unknown; children?: unknown }

// Button children from the indent; `right` is one Button against the far edge.
export const ButtonRow = kitComponent('ButtonRow', (props: ButtonRowProps, ctx) => {
  const buttons = (nodes: unknown) => ctx.parts(nodes).flatMap(part => ('component' in part && part.component === Button ? [buttonOf(part.props, part.ctx)] : []))
  return [buttonRow(buttons(props.children), buttons(props.right)[0], ctx.width)]
})
