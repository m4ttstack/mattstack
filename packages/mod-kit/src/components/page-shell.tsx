import { sp } from '../draw/text'
import { ACCENT, SYMBOL } from '../draw/theme'
import { fitToRows } from '../patterns/page-shell'
import { kitComponent, type KitLine } from './core'

// `context` sits under the head and is the first thing given up when the page overflows `rows`;
// `padTo` holds the page to that many rows (room allowing), so the foot keeps its row from page to page.
export type PageShellProps = { rows: number; head?: unknown; context?: unknown; foot?: unknown; padTo?: number; children?: unknown }

export const PageShell = kitComponent('PageShell', (props: PageShellProps, ctx) => {
  const head = ctx.layout(props.head)
  const context = ctx.layout(props.context)
  const page = ctx.layout(props.children)
  const foot = ctx.layout(props.foot)
  const pad = props.padTo === undefined ? undefined : { height: props.padTo, filler: [sp(SYMBOL.bar, ACCENT)] as KitLine }
  return fitToRows({ head: [...head, ...context], page, foot }, props.rows, () => ({ head, page, foot }), pad)
})
