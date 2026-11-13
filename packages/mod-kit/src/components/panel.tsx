import { renderLines } from '../draw/render'
import { ctxFor, rendering } from './core'

export type PanelProps = { width?: number; children?: unknown }

// The root of a kit drawing: lays its children out as lines and draws them. The pointer hits these lines, so a Client has one Panel.
export function Panel(props: PanelProps) {
  const render = rendering('Panel')
  if (render.lines) throw new Error('kit: a Client draws one Panel')
  const lines = ctxFor(render, 'panel', { width: props.width ?? render.width, focused: render.focused }).layout(props.children)
  render.lines = lines
  return renderLines(lines, render.elements, render.look)
}
