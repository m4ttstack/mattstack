import { hang, sp, type Line } from '../draw/text'
import { DIM, DONE, GRAY, ICON, SYMBOL, WARN, rail } from '../draw/theme'
import { buttonRow, type Button } from '../widgets/buttons'

export type Drawn<A> = { head: Line<A>[]; page: Line<A>[]; foot: Line<A>[] }

// The page grown to `height` rows with copies of `filler`; a page already taller is left as it is.
export function padToHeight<A>(page: Line<A>[], height: number, filler: Line<A>): Line<A>[] {
  const padding = Array.from({ length: Math.max(0, height - page.length) }, () => [...filler] as Line<A>)
  return [...page, ...padding]
}

// What fits in `rows`: the head, then the end of the body. A body that overflows is drawn again by `withoutContext`,
// which gives up the head's optional room first. `pad` holds the page to a height (room allowing) so what follows keeps its row.
export function fitToRows<A>(drawn: Drawn<A>, rows: number, withoutContext: () => Drawn<A>, pad?: { height: number; filler: Line<A> }): Line<A>[] {
  const roomUnder = (head: Line<A>[]) => Math.max(6, rows - head.length)
  const { head, page, foot } = drawn.page.length + drawn.foot.length > roomUnder(drawn.head) ? withoutContext() : drawn
  const room = roomUnder(head)
  const padded = pad ? padToHeight(page, Math.min(pad.height, room - foot.length), pad.filler) : page
  const body = [...padded, ...foot]
  return [...head, ...body.slice(Math.max(0, body.length - room))]
}

// Back and next at the left, one side button against the far edge.
export type NavSpec<A> = { back: Button<A>; next?: Button<A>; aside?: Button<A> }

export function navRow<A>(spec: NavSpec<A>, width: number): Line<A> {
  return buttonRow(spec.next ? [spec.back, spec.next] : [spec.back], spec.aside, width)
}

// An item with no `summary` reads "not answered". One with an `action` is clickable as a whole, so the list is also how a person goes back.
export type ReviewItem<A> = { label: string; summary?: string; action?: A }

export function reviewList<A>(items: ReviewItem<A>[], width: number): Line<A>[] {
  const bar = rail<A>(GRAY)
  return items.flatMap(item => {
    const isDone = item.summary !== undefined
    const symbol = isDone ? sp<A>(ICON.done, DONE) : sp<A>(ICON.missing, WARN)
    const entry: Line<A>[] = [
      ...hang([symbol, sp('  ')], bar, item.label, width, item.action !== undefined ? { isLabel: true } : {}),
      ...(isDone ? hang(bar, bar, item.summary!, width, DIM) : [[...bar, sp('not answered', WARN)] as Line<A>]),
    ]
    if (item.action !== undefined) for (const line of entry) line.action = item.action
    return [[sp(SYMBOL.bar, GRAY)] as Line<A>, ...entry]
  })
}
