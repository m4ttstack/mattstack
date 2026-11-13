import { cellWidth, cutCells, firstGrapheme } from './cells'

// `quiet` marks a button drawn without a fill at rest, so the pointer states give it a fill of its own; it draws nothing itself.
// `chip` is the fill a control drawn flat on a coloured bar takes under the pointer; it draws nothing itself.
export type Style = { color?: string; bg?: string; dim?: boolean; bold?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; quiet?: boolean; chip?: string }

// A span or a whole line can carry the action a click on it performs, so a pointer handler only has to look up what it hit.
export type Span<A> = Style & { t: string; action?: A; isLabel?: true }
export type Line<A> = Span<A>[] & { action?: A }

export function sp<A = never>(t: string, style: Omit<Span<A>, 't'> = {}): Span<A> {
  return { t, ...style }
}

export function withAction<A>(lines: Line<A>[], action: A): Line<A>[] {
  for (const line of lines) line.action = action
  return lines
}

export function widthOf(spans: Span<unknown>[]): number {
  return spans.reduce((n, span) => n + cellWidth(span.t), 0)
}

function spanAt<A>(line: Line<A>, x: number): Span<A> | undefined {
  let from = 0
  for (const span of line) {
    const to = from + cellWidth(span.t)
    if (span.action !== undefined && x >= from && x < to) return span
    from = to
  }
  return undefined
}

export function hitAt<A>(line: Line<A> | undefined, x: number): A | undefined {
  if (!line) return undefined
  return spanAt(line, x)?.action ?? line.action
}

const actionKey = (action: unknown): string => JSON.stringify(action)

// Two controls can share an action (a tab and a Next button both go to a page), so a span's hover key names its row too.
// A whole-line action keeps a key of its own: it spans several rows and is lit on all of them.
export function spanHoverKey<A>(span: Span<A>, row: number): string | undefined {
  return span.action === undefined ? undefined : `${row}:${actionKey(span.action)}`
}

export function lineHoverKey<A>(line: Line<A>): string | undefined {
  return line.action === undefined ? undefined : actionKey(line.action)
}

export function hoverKeyAt<A>(lines: Line<A>[], row: number, x: number): string | undefined {
  const line = lines[row]
  if (!line) return undefined
  const span = spanAt(line, x)
  return span ? spanHoverKey(span, row) : lineHoverKey(line)
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    let row = ''
    for (const word of raw.split(' ')) {
      const next = row === '' ? word : `${row} ${word}`
      if (cellWidth(next) > width && row !== '') {
        out.push(row)
        row = word
      } else row = next
      // Only a lone word can still be too wide; it breaks at the row edge, and a grapheme wider than the row keeps a row to itself.
      while (cellWidth(row) > width) {
        const piece = cutCells(row, width) || firstGrapheme(row)
        if (piece === row) break
        out.push(piece)
        row = row.slice(piece.length)
      }
    }
    out.push(row)
  }
  return out
}

// The first row takes `first` as its prefix and every wrapped row after it takes `rest`, so the rail stays unbroken.
export function hang<A>(first: Span<A>[], rest: Span<A>[], text: string, width: number, style: Omit<Span<A>, 't'> = {}): Line<A>[] {
  const room = Math.max(10, width - widthOf(first))
  return wrap(text, room).map((row, n) => [...(n === 0 ? first : rest), sp(row, style)])
}
