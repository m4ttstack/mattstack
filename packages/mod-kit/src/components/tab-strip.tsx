import { tabStrip } from '../widgets/tab-strip'
import { kitComponent } from './core'

export type TabProps = { label: string; mark?: string; isDone?: boolean }

export type TabStripProps = { tabs: TabProps[]; current: number; from?: number; onSelect?: (tab: number) => void; onScroll?: (from: number) => void }

export const TabStrip = kitComponent('TabStrip', (props: TabStripProps, ctx) => [
  tabStrip({
    tabs: props.tabs.map((tab, k) => ({ label: tab.label, mark: tab.mark, isDone: tab.isDone ?? false, action: ctx.bind(`tab:${k}`, () => props.onSelect?.(k)) })),
    current: props.current,
    width: ctx.width,
    from: props.from ?? 0,
    scrollTo: from => ctx.bind(`scroll:${from}`, () => props.onScroll?.(from)),
  }),
])
