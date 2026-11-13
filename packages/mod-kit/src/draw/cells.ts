// A terminal draws a wide character or an emoji in two cells, so every width, pad, cut and hit-test in the kit counts cells, never UTF-16 units.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
const EMOJI = /\p{Emoji_Presentation}|\u20E3/u
// A variation selector 16 asks for emoji presentation only on a base that has one; after a plain letter it does nothing.
const EMOJI_BASE_WITH_VS16 = /^(?![A-Za-z])\p{Emoji}\uFE0F/u
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u

// East Asian Wide and Fullwidth blocks (the emoji blocks are caught by EMOJI).
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
]

function graphemeWidth(grapheme: string): number {
  if (EMOJI.test(grapheme) || EMOJI_BASE_WITH_VS16.test(grapheme)) return 2
  const first = grapheme.codePointAt(0) ?? 0
  if (ZERO_WIDTH.test(grapheme)) return 0
  return WIDE_RANGES.some(([lo, hi]) => first >= lo && first <= hi) ? 2 : 1
}

const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), part => part.segment)

export function cellWidth(text: string): number {
  if (PRINTABLE_ASCII.test(text)) return text.length
  return graphemes(text).reduce((n, grapheme) => n + graphemeWidth(grapheme), 0)
}

// The longest start of `text` that fits `cells`; a wide character that would straddle the edge is left out.
export function cutCells(text: string, cells: number): string {
  if (PRINTABLE_ASCII.test(text)) return text.slice(0, Math.max(0, cells))
  let used = 0
  let out = ''
  for (const grapheme of graphemes(text)) {
    used += graphemeWidth(grapheme)
    if (used > cells) break
    out += grapheme
  }
  return out
}

// The longest end of `text` that fits `cells`.
export function tailCells(text: string, cells: number): string {
  if (PRINTABLE_ASCII.test(text)) return cells <= 0 ? '' : text.slice(-cells)
  let used = 0
  let out = ''
  for (const grapheme of graphemes(text).reverse()) {
    used += graphemeWidth(grapheme)
    if (used > cells) break
    out = grapheme + out
  }
  return out
}

export function padCells(text: string, cells: number): string {
  return text + ' '.repeat(Math.max(0, cells - cellWidth(text)))
}

export function firstGrapheme(text: string): string {
  return segmenter.segment(text)[Symbol.iterator]().next().value?.segment ?? ''
}
